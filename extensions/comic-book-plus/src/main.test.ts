/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	assertValidEntries,
	assertValidEntry,
	assertValidSource,
	getTestExtension,
	MockManagerClient,
} from "@dion-js/extension-test-utils";
import type { Extension } from "@dion-js/runtime";
import type {
	Entry,
	EntryDetailedResult,
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	decodeEntities,
	hasNextListingPage,
	isComicItem,
	type ListingItem,
	listingUrl,
	matchesItem,
	pageImageUrl,
	parseEpisodeReader,
	parseListing,
	parseListingItem,
	parseReader,
	readerPageUrls,
	serializeReader,
	splitListingItems,
} from "./cbp.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from live comicbookplus.com pages)
// ---------------------------------------------------------------------------

/** One real listing row (dlid 102403), trimmed to the fields we parse. */
const ITEM_NEW_HTML = `<div class="cbpLtable" itemscope itemtype="https://schema.org/Book"><meta itemprop="genre" content="Comic Book"><meta itemprop="interactionCount" content="UserComments:0"><meta itemprop="interactionCount" content="UserDownloads:6"><meta itemprop="interactionCount" content="UserPageVisits:21"><meta itemprop="discussionUrl" content="https://comicbookplus.com/?dlid=102403"><meta itemprop="thumbnailUrl" content="https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/mediumthumb.jpg"><meta itemprop="url" content="https://comicbookplus.com/?dlid=102403"><table class="a"><col class="width100px"><col><tr><td colspan="2" class="w"><a href="/?dlid=102403" class="ya" itemprop="name">School Friend 305/9</a></td></tr><tr><td colspan="2" class="v"><a href="/?dlid=102403"><img src="https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/mediumthumb.jpg" width="100" alt="Cover For School Friend 305/9"></a><table class="u"><tr><td class="z">Added:</td><td><time itemprop="dateModified" datetime="2026-09-09">Sep 9, 2026</time></td></tr><tr><td class="z">Pages:</td><td itemprop="numberOfPages">24</td></tr></table></td></tr>
<tr><td class="x">Title:</td><td class="y"><a href="/?cid=2431">School Friend</a></td></tr>
<tr><td class="x">Section:</td><td class="y"><a href="/?cid=270">UK Comic Books</a></td></tr>
<tr><td class="x">Uploader:</td><td class="y" itemprop="editor"><a href="/?cbplus=contributor_marionette_s_s_0">marionette</a></td></tr></table></div>`;

/** A dated, rated listing row (dlid 102399). */
const ITEM_DATED_HTML = `<div class="cbpLtableleft" itemscope itemtype="https://schema.org/Book"><meta itemprop="genre" content="Comic Book"><meta itemprop="interactionCount" content="UserDownloads:22"><meta itemprop="interactionCount" content="UserPageVisits:204"><meta itemprop="thumbnailUrl" content="https://comicbookplus.com/viewer/00/003b1ae2bfdb97e5aa31d7b4236587b5/mediumthumb.jpg"><table class="a"><col class="width100px"><col><tr><td colspan="2" class="w"><a href="/?dlid=102399" class="ya" itemprop="name">School Friend 82</a></td></tr><tr><td colspan="2" class="v"><a href="/?dlid=102399"><img src="https://comicbookplus.com/viewer/00/003b1ae2bfdb97e5aa31d7b4236587b5/mediumthumb.jpg" width="100" alt="Cover For School Friend 82"></a><table class="u"><tr><td class="z">Downloads:</td><td>22</td></tr><tr><td class="z">Rating:</td><td><span itemprop="aggregateRating" itemscope itemtype="https://schema.org/aggregateRating"><span itemprop="ratingValue">7</span>/<span itemprop="bestRating">10</span>&nbsp;(<span itemprop="ratingCount">1</span></span>&nbsp;vote)</td></tr><tr><td class="z">Pages:</td><td itemprop="numberOfPages">20</td></tr></table></td></tr>
<tr><td class="x">Cover Date:</td><td class="y"><time class="nofloat" itemprop="datePublished" datetime="1951-12-08"><a href="/?cbplus=yns_5112_0">Dec&nbsp;8,&nbsp;1951</a></time></tr>
<tr><td class="x">Title:</td><td class="y"><a href="/?cid=2431">School Friend</a></td></tr>
<tr><td class="x">Section:</td><td class="y"><a href="/?cid=270">UK Comic Books</a></td></tr></table></div>`;

/** Radio shows and other non-comic rows must be dropped. */
const ITEM_RADIO_HTML = `<div class="cbpLtable" itemscope itemtype="https://schema.org/Book"><meta itemprop="genre" content="Radio Show"><meta itemprop="thumbnailUrl" content="https://box01.comicbookplus.com/thumbs/radio/show.jpg"><table class="a"><col class="width100px"><col><tr><td colspan="2" class="w"><a href="/?dlid=999999" class="ya" itemprop="name">Some Radio Show 3</a></td></tr><tr><td colspan="2" class="v"><table class="u"><tr><td class="z">Pages:</td><td itemprop="numberOfPages">2</td></tr></table></td></tr></table></div>`;

const LISTING_HTML = `<html><head><title>Latest 1500 Uploaded Books By Date - 1 of 30</title></head><body>
${ITEM_NEW_HTML}
${ITEM_RADIO_HTML}
${ITEM_DATED_HTML}
<a href="/?cbplus=latestuploads_l_s_1#topcbp"><img src="https://box01.comicbookplus.com/images/next.png" alt="Next"></a>
</body></html>`;

const LISTING_HTML_LAST = `<html><head><title>Latest 1500 Uploaded Books By Date - 30 of 30</title></head><body>
<a href="/?cbplus=latestuploads_l_s_28#topcbp"><img src="https://box01.comicbookplus.com/images/prev.png" alt="Prev"></a>
</body></html>`;

/** Reader page of dlid 102403 (new-style image host), trimmed. */
const READER_HTML = `<html><head>
<title>School Friend 305/9 (UK Comic Books) - Comic Book Plus</title>
<meta itemprop="name" content="School Friend 305/9 (UK Comic Books) - Comic Book Plus">
<meta itemprop="description" content="This book has 24 pages and was uploaded by marionette on September 9, 2026. The file size is 53.55mb. Publisher is UK Comic Books">
<meta itemprop="image" content="https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/largethumb.jpg">
<meta itemprop="inLanguage" content="en">
</head><body>
<script>//<![CDATA[
website="ht"+"tps://comicbookplus."+"com/";
preloadimage=new Image();
comicnumpages=24;
comicloc="viewer/31/311ef870a85de14f0f5fade0a262892f";
page=0;
dlid=102403;
//-->
</script>
<tr><td class="rightfloatbold">Title</td><td class="leftfloatbold"><table class="mainbody"><tr class="nopadding"><td class="nopadding"><a href="/?cid=2431">School Friend</a></td><td class="nopadding"></td></tr></table></td></tr>
<tr><td class="rightfloatbold">Date</td><td class="leftfloatbold"> Unknown  | Lang: English (<span itemprop="inLanguage">en</span>)</td></tr>
<tr><td class="rightfloatbold">Uploaded</td><td class="leftfloatbold"><time itemprop="dateModified" datetime="2026-09-09T08:47:00+00:00">September 9, 2026</time> by <span itemprop="editor">marionette</span></td></tr>
<tr><td class="rightfloatbold">Notes</td><td class="leftfloatbold textleft">Due to an unspecified interruption in publication, this issue is numbered 305/9.</td></tr>
</body></html>`;

/** Reader page of a 2013-era book whose images live on box01. */
const READER_OLD_HTML = `<html><head>
<title>School Friend 273 (UK Comic Books) - Comic Book Plus</title>
<meta itemprop="name" content="School Friend 273 (UK Comic Books) - Comic Book Plus">
<meta itemprop="description" content="This book has 20 pages and was uploaded by hoover on February 24, 2013. The file size is 13.74mb. Publisher is UK Comic Books">
<meta itemprop="image" content="https://box01.comicbookplus.com/viewer/40/40c0f2de14e0aa4f24982efc28f2a246/largethumb.jpg">
</head><body>
<script>//<![CDATA[
website="ht"+"tps://box01.comicbookplus."+"com/";
comicnumpages=20;
comicloc="viewer/40/40c0f2de14e0aa4f24982efc28f2a246";
dlid=31003;
//-->
</script>
<tr><td class="rightfloatbold">Date</td><td class="leftfloatbold"><time class="nofloat" itemprop="datePublished" datetime="1951-12"> <a href="/?cbplus=yns_5112_0">Dec 8, 1951</a></time></td></tr>
</body></html>`;

/** The site answers 200 with this layout for unknown dlids. */
const NOT_A_READER_HTML = `<html><head><title> We Could Not Find It - Comic Book Plus</title></head><body>No book here.</body></html>`;

// ---------------------------------------------------------------------------
// Unit tests for the pure helpers
// ---------------------------------------------------------------------------

describe("cbp helpers", () => {
	it("should build listing and reader urls", () => {
		expect(listingUrl("latestuploads", 0)).toBe(
			"https://comicbookplus.com/?cbplus=latestuploads_l_s_0",
		);
		expect(listingUrl("mostdownloads", 1)).toBe(
			"https://comicbookplus.com/?cbplus=mostdownloads_l_s_1",
		);
		// Unknown categories and negative pages fall back to safe values.
		expect(listingUrl("not-a-key", -3)).toBe(
			"https://comicbookplus.com/?cbplus=latestuploads_l_s_0",
		);
		expect(parseListing("", "latestuploads", 0).items.length).toBe(0);
	});

	it("should detect the listing next-page marker", () => {
		expect(hasNextListingPage(LISTING_HTML, "latestuploads", 0)).toBe(true);
		expect(hasNextListingPage(LISTING_HTML_LAST, "latestuploads", 29)).toBe(
			false,
		);
		expect(hasNextListingPage("", "latestuploads", 0)).toBe(false);
	});

	it("should decode named and numeric entities", () => {
		expect(decodeEntities("Tom &amp; Jerry &#39;Fun&#x27;")).toBe(
			"Tom & Jerry 'Fun'",
		);
		expect(decodeEntities("A&nbsp;B &#65;&#x42;C &fake;")).toBe(
			"A B ABC &fake;",
		);
	});

	it("should parse listing items with all listing fields", () => {
		const items = splitListingItems(LISTING_HTML).map(parseListingItem);
		const fresh = items[0] as ListingItem;
		expect(fresh.dlid).toBe(102403);
		expect(fresh.title).toBe("School Friend 305/9");
		expect(fresh.cover).toBe(
			"https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/mediumthumb.jpg",
		);
		expect(fresh.series).toBe("School Friend");
		expect(fresh.seriesCid).toBe(2431);
		expect(fresh.section).toBe("UK Comic Books");
		expect(fresh.genre).toBe("Comic Book");
		expect(fresh.pages).toBe(24);
		expect(fresh.added).toBe("2026-09-09");
		expect(fresh.coverDate).toBeUndefined();
		expect(fresh.rating).toBeUndefined();

		const dated = items[2] as ListingItem;
		expect(dated.dlid).toBe(102399);
		expect(dated.coverDate).toBe("1951-12-08");
		expect(dated.rating).toBe(7);
		expect(dated.views).toBe(204);
	});

	it("should drop rows without a usable book link", () => {
		expect(
			parseListingItem(
				'<div itemscope itemtype="https://schema.org/Book">junk',
			),
		).toBeNull();
	});

	it("should keep only comic genres", () => {
		const items = splitListingItems(LISTING_HTML).map(parseListingItem);
		const parsed = items.filter((item): item is ListingItem => item !== null);
		expect(parsed.length).toBe(3);
		const comics = parsed.filter(isComicItem);
		expect(comics.length).toBe(2);
		expect(comics.every((item) => item.genre?.includes("Comic") ?? true)).toBe(
			true,
		);
		const radio = items[1] as ListingItem;
		expect(isComicItem(radio)).toBe(false);
		// A missing genre is kept rather than dropped.
		expect(isComicItem({ dlid: 1, title: "x" })).toBe(true);
	});

	it("should parse listings with the next-page marker", () => {
		const page = parseListing(LISTING_HTML, "latestuploads", 0);
		expect(page.items.length).toBe(2);
		expect(page.hasNext).toBe(true);
		const last = parseListing(LISTING_HTML_LAST, "latestuploads", 29);
		expect(last.items.length).toBe(0);
		expect(last.hasNext).toBe(false);
	});

	it("should parse the reader page and deobfuscate the image host", () => {
		const info = parseReader(READER_HTML, 102403);
		expect(info.title).toBe("School Friend 305/9");
		expect(info.publisher).toBe("UK Comic Books");
		expect(info.website).toBe("https://comicbookplus.com/");
		expect(info.loc).toBe("viewer/31/311ef870a85de14f0f5fade0a262892f");
		expect(info.pages).toBe(24);
		expect(info.cover).toBe(
			"https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/largethumb.jpg",
		);
		expect(info.series).toBe("School Friend");
		expect(info.language).toBe("en");
		expect(info.uploaded).toBe("2026-09-09T08:47:00+00:00");
		expect(info.notes).toContain("numbered 305/9");
		// "Unknown" cover dates are dropped, not surfaced.
		expect(info.coverDate).toBeUndefined();
	});

	it("should parse old reader pages on the box01 image host", () => {
		const info = parseReader(READER_OLD_HTML, 31003);
		expect(info.title).toBe("School Friend 273");
		expect(info.website).toBe("https://box01.comicbookplus.com/");
		expect(info.pages).toBe(20);
		// Dated issues carry a month-precision datePublished.
		expect(info.coverDate).toBe("1951-12");
	});

	it("should reject pages without a reader", () => {
		expect(() => parseReader(NOT_A_READER_HTML, 1)).toThrow(/no online reader/);
	});

	it("should build page image urls in reading order", () => {
		const info = parseReader(READER_HTML, 102403);
		expect(pageImageUrl(info, 0)).toBe(
			"https://comicbookplus.com/viewer/31/311ef870a85de14f0f5fade0a262892f/0.jpg",
		);
		const urls = readerPageUrls(info);
		expect(urls.length).toBe(24);
		expect(urls[0]).toEndWith("/0.jpg");
		expect(urls[23]).toEndWith("/23.jpg");
		// Tolerate hosts/paths with unusual slash placement.
		const sloppy = parseReader(READER_OLD_HTML, 31003);
		expect(pageImageUrl({ ...sloppy, website: "https://x.com" }, 1)).toBe(
			"https://x.com/viewer/40/40c0f2de14e0aa4f24982efc28f2a246/1.jpg",
		);
		expect(pageImageUrl({ ...sloppy, loc: "/a/b" }, 2)).toBe(
			"https://box01.comicbookplus.com/a/b/2.jpg",
		);
	});

	it("should round-trip reader facts through the episode iddata", () => {
		const info = parseReader(READER_HTML, 102403);
		const parsed = parseEpisodeReader(serializeReader(info));
		expect(parsed).toEqual({
			website: "https://comicbookplus.com/",
			loc: "viewer/31/311ef870a85de14f0f5fade0a262892f",
			pages: 24,
		});
		expect(parseEpisodeReader(null)).toBeNull();
		expect(parseEpisodeReader("not json")).toBeNull();
		expect(parseEpisodeReader('{"website":"https://x/"}')).toBeNull();
	});

	it("should match queries against book and series titles", () => {
		const item = parseListingItem(ITEM_NEW_HTML) as ListingItem;
		expect(matchesItem(item, "school friend")).toBe(true);
		expect(matchesItem(item, "305/9")).toBe(true);
		expect(matchesItem(item, "schoolfriend")).toBe(false);
		expect(matchesItem(item, "  ")).toBe(false);
		// Series-only matches work for issues whose own title differs.
		expect(matchesItem(item, "friend")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Live flow against comicbookplus.com through the built extension
// ---------------------------------------------------------------------------

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Comic");
		expect(data.extension_type).toContainEqual({
			type: "EntryProvider",
			has_search: true,
		});
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"comicbookplus.com",
					"www.comicbookplus.com",
					"box01.comicbookplus.com",
				]),
			);
		}
	});
	it("should be able to browse the latest uploads", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(50);
		expect(result.hasnext).toBe(true);
		const uids = new Set<string>();
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.url).toBe(`https://comicbookplus.com/?dlid=${entry.id.uid}`);
			expect(entry.cover?.url).toContain("thumb");
			expect(uids.has(entry.id.uid)).toBe(false);
			uids.add(entry.id.uid);
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should return nothing past the end of the listing", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(500);
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 60_000);
	it("should be able to search book titles", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "School Friend");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
		}
		expect(
			result.content.some((e) => e.title.toLowerCase().includes("school")),
		).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);
	it("should be able to detail the top browse result", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.media_type).toBe("Comic");
		expect(result.entry.status).toBe("Complete");
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.name).toBe("Read");
		expect(result.entry.episodes[0]!.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.episodes[0]!.id.iddata).toBeDefined();
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.language).toBe("en");
		expect(result.entry.cover?.url).toContain("largethumb");
		expect(result.entry.meta).toBeDefined();
		expect(result.entry.ui).toBeDefined();
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 120_000);
	it("should be able to source the detailed comic", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Imagelist");
		expect(result.settings).toEqual(detailResult.settings);
		if (result.source.type === "Imagelist") {
			expect(result.source.links.length).toBeGreaterThan(0);
			expect(result.source.audio).toBeNull();
			result.source.links.forEach((link, n) => {
				expect(link.url).toEndWith(`/${n}.jpg`);
				// The Referer header unlocks the site's hotlink protection.
				expect(link.header?.Referer).toBe(
					`https://comicbookplus.com/?dlid=${detailResult.entry.id.uid}`,
				);
				expect(link.header?.["User-Agent"]).toBeDefined();
			});
			// The reader page images are directly fetchable with those headers.
			const first = result.source.links[0]!;
			const res = await fetch(first.url, {
				headers: { ...(first.header ?? {}) },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type") ?? "").toStartWith("image/");
		}
		await assertValidSource(result.source);
	}, 120_000);
	it("should source an old book from the box01 image host", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const detail = await extension!.detail({ uid: "31003" }, {});
		expect(detail.entry.titles[0]).toBe("School Friend 273");
		expect(detail.entry.meta?.Publisher).toBe("UK Comic Books");
		expect(detail.entry.meta?.Series).toBe("School Friend");
		// Month-precision cover date parsed from the reader page (1955-08).
		expect(detail.entry.meta?.["Cover date"]).toMatch(/^\d{4}-\d{2}$/);
		await assertValidEntry(detail.entry);
		const result = await extension!.source(
			detail.entry.episodes[0]!.id,
			detail.settings,
		);
		expect(result.source.type).toBe("Imagelist");
		if (result.source.type === "Imagelist") {
			// The live item carries 20 scanned pages, all on box01 in order.
			expect(result.source.links.length).toBe(20);
			for (const link of result.source.links) {
				expect(link.url).toStartWith("https://box01.comicbookplus.com/");
				expect(link.url).toEndWith(".jpg");
			}
		}
		expect(result.settings).toEqual(detail.settings);
		await assertValidSource(result.source);
	}, 120_000);
	it("should reject unknown books", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "999999999" }, {})).rejects.toThrow();
		await expect(extension!.detail({ uid: "not-a-dlid" }, {})).rejects.toThrow(
			/invalid book id/,
		);
	}, 60_000);
});
