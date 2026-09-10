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
	bookAuthor,
	bookDescription,
	bookJsonUrl,
	bookLang,
	bookPageUrl,
	bookToDetail,
	buildAudio,
	catalogBookToEntry,
	cleanText,
	catalogBooks,
	decodeEntities,
	type UflBook,
	type UflCatalog,
	type UflNarration,
	joinUrl,
	languageName,
	matchesTitle,
	narrationJsonUrl,
	narrationLangs,
	pageImages,
	paginate,
	personCredits,
	stripHtml,
	s3Url,
	PAGE_SIZE,
} from "./ufl.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from the live JSON documents)
// ---------------------------------------------------------------------------

/** libInfoCombo.json excerpt: lib 13 + "New and Favorite" sharing BKID 164. */
const CATALOG: UflCatalog = {
	"13": {
		Title: "Family",
		WLangAbbv: "eng",
		CoverRoot: "http://files.uniteforliteracy.com/book/$BKID/picset/th240/",
		Books: [
			{ BKID: 164, Cover: "17_0.jpg", AltText: "Big Sister" },
			{ BKID: 3250, Cover: "0_0.jpg", AltText: "My Big Brother" },
			{ AltText: "No id at all" },
			{ BKID: 178, Cover: "eng_galnew_cover.jpg", AltText: "" },
		],
	},
	"762": {
		Title: "New and Favorite",
		WLangAbbv: "eng",
		CoverRoot: "http://files.uniteforliteracy.com/book/$BKID/picset/th240/",
		Books: [
			// Duplicate BKID: the first library's row must win.
			{ BKID: 164, Cover: "other_cover.jpg", AltText: "Big Sister" },
			{
				BKID: 178,
				Cover: "eng_galnew_cover.jpg",
				AltText: "Grandma Always Listens",
			},
		],
	},
};

/** book1.json for BKID 164, compressed to the fields the extension uses. */
const BOOK: UflBook = {
	Published: true,
	Title: "Big Sister",
	PicRoot: "http://files.uniteforliteracy.com/book/164/picset/th480/",
	AudioRoot: "http://files.uniteforliteracy.com/book/164/eng/audio/eng/",
	Abbv: "eng",
	AuthorStr: "Holly Hartman",
	ISBN: "978-1-63040-008-8",
	NLangs: [
		{ ID: 2, Abbv: "spa" },
		{ ID: 3, Abbv: "fre" },
		{ ID: 3, Abbv: "fre" },
		{ ID: 5, Abbv: "deu" },
	],
	Pages: [
		{
			PageType: 1,
			ImageUrl: "17_0.jpg",
			CreditList: [{ Text: "Zaiga Cress" }],
			mp3: "eng_bs_titlepage.mp3",
		},
		{
			// Text-only title page: no image, but it does have narration.
			PageType: 4,
			PageText:
				"<div><p>Big Sister<br>by<br>Holly Hartman<br>&copy; 2013 Unite For Literacy</p></div>",
			mp3: "eng_bs_titlepage.mp3",
		},
		{
			PageType: 3,
			ImageUrl: "nav_bs_2.jpg",
			PageText:
				"A big sister is a good person to have in your family. She can help you, and you can help her, too.",
			mp3: "eng_bs_3.mp3",
		},
		{
			PageType: 3,
			ImageUrl: "eng_bsnew_4.jpg",
			PageText: "You can help your big sister with chores.",
			mp3: "eng_bs_5.mp3",
		},
		{
			PageType: 3,
			ImageUrl: "31_9.jpg",
			PageText: "You can be your big sister's friend forever.",
			mp3: "missing", // sic: the site marks unrecorded pages like this
		},
		{
			PageType: 2,
			ImageUrl: "nav_bs_stickynote.jpg",
			mp3: "eng_bs_stickynote.mp3",
		},
	],
};

/** aud_spa.json for BKID 164, truncated: narration pages are index-aligned
 * with book1.json's Pages, but a short file must not break the mapping. */
const NARRATION: UflNarration = {
	AudioRoot: "http://files.uniteforliteracy.com/book/164/eng/audio/spa/",
	Abbv: "spa",
	Pages: [
		{ mp3: "33_0.mp3" },
		{ mp3: "33_1.mp3" },
		{ mp3: "33_2.mp3" },
		{ mp3: "33_3.mp3" },
	],
};

const { linkIndex } = pageImages(BOOK);

// ---------------------------------------------------------------------------
// Unit tests for the mapping helpers
// ---------------------------------------------------------------------------

describe("unite-for-literacy helpers", () => {
	it("should build book, narration and site urls", () => {
		expect(bookJsonUrl("164")).toBe(
			"https://books-cloud.uniteforliteracy.com/book/164/book1.json",
		);
		expect(narrationJsonUrl("164", "spa")).toBe(
			"https://books-cloud.uniteforliteracy.com/book/164/aud_spa.json",
		);
		expect(bookPageUrl("164")).toBe(
			"https://www.uniteforliteracy.com/book?BookId=164",
		);
	});
	it("should rewrite file hosts to their https cloud variants", () => {
		expect(s3Url(BOOK.PicRoot)).toBe(
			"https://files-cloud.uniteforliteracy.com/book/164/picset/th480/",
		);
		expect(s3Url(BOOK.AudioRoot)).toBe(
			"https://files-cloud.uniteforliteracy.com/book/164/eng/audio/eng/",
		);
		expect(s3Url("https://files-cloud.uniteforliteracy.com/x/")).toBe(
			"https://files-cloud.uniteforliteracy.com/x/",
		);
		expect(s3Url(undefined)).toBe("");
		expect(joinUrl("https://a/b/", "c.jpg")).toBe("https://a/b/c.jpg");
		expect(joinUrl("https://a/b", "c.jpg")).toBe("https://a/b/c.jpg");
	});
	it("should flatten the catalogue, dedupe books and skip broken rows", () => {
		const books = catalogBooks(CATALOG);
		expect(books.map((book) => book.bkid)).toEqual(["164", "3250", "178"]);
		expect(books[0]!.title).toBe("Big Sister");
		// First occurrence wins: the lib-13 cover, with $BKID resolved.
		expect(books[0]!.cover).toBe(
			"https://files-cloud.uniteforliteracy.com/book/164/picset/th240/17_0.jpg",
		);
		expect(books[2]!.cover).toBe(
			"https://files-cloud.uniteforliteracy.com/book/178/picset/th240/eng_galnew_cover.jpg",
		);
		const entry = catalogBookToEntry(books[0]!)!;
		expect(entry.id.uid).toBe("164");
		expect(entry.title).toBe("Big Sister");
		expect(entry.media_type).toBe("Comic");
		expect(entry.url).toBe(bookPageUrl("164"));
		expect(entry.cover?.url).toContain("/th240/");
		expect(catalogBookToEntry({ bkid: "1", title: "" })).toBeNull();
	});
	it("should match titles case-insensitively on every token", () => {
		expect(matchesTitle("Big Sister", "sister")).toBe(true);
		expect(matchesTitle("Big Sister", "BIG SIS")).toBe(true);
		expect(matchesTitle("Big Sister", "sister big")).toBe(true);
		expect(matchesTitle("Big Sister", "brother")).toBe(false);
		expect(matchesTitle("Big Sister", "   ")).toBe(false);
	});
	it("should paginate deterministically with a hasnext flag", () => {
		const items = Array.from({ length: 50 }, (_, i) => i);
		const first = paginate(items, 0, 24);
		expect(first.content.length).toBe(24);
		expect(first.hasnext).toBe(true);
		const last = paginate(items, 2, 24);
		expect(last.content.length).toBe(2);
		expect(last.hasnext).toBe(false);
		expect(paginate(items, 9, PAGE_SIZE).content.length).toBe(0);
		expect(paginate(items, -3, 24).content.length).toBe(24);
	});
	it("should decode entities and strip html", () => {
		expect(decodeEntities("Tom &amp; Jerry&#39;s &lt;big&gt; day")).toBe(
			"Tom & Jerry's <big> day",
		);
		expect(stripHtml(BOOK.Pages![1]!.PageText ?? "")).toContain(
			"Big Sister by Holly Hartman",
		);
		expect(stripHtml("<p>a<br>b&nbsp;c</p>")).toBe(" a b c ");
		expect(cleanText("<p>a<br>b&nbsp;c</p>")).toBe("a b c");
		expect(cleanText(undefined)).toBe("");
	});
	it("should map page images and track imagelist positions", () => {
		const { urls, linkIndex: index } = pageImages(BOOK);
		expect(urls.length).toBe(5);
		expect(urls[0]).toBe(
			"https://files-cloud.uniteforliteracy.com/book/164/picset/th480/17_0.jpg",
		);
		// The imageless title page (position 1) maps to -1, story pages after
		// it shift left in the imagelist.
		expect(index).toEqual([0, -1, 1, 2, 3, 4]);
	});
	it("should build per-page audio entries aligned with the imagelist", () => {
		const audio = buildAudio(BOOK, null, linkIndex);
		// Every imaged page has narration except the "missing" one.
		expect(audio.length).toBe(4);
		expect(audio[0]).toEqual({
			link: {
				url: "https://files-cloud.uniteforliteracy.com/book/164/eng/audio/eng/eng_bs_titlepage.mp3",
			},
			from: 0,
			to: 0,
		});
		expect(audio[3]!.from).toBe(4); // the sticky-note page
	});
	it("should override audio with the selected narration language", () => {
		const audio = buildAudio(BOOK, NARRATION, linkIndex);
		// Positions 0/2/3 switch to the Spanish files, position 4 keeps the
		// native "missing" (skipped) and 5 falls back to the native audio.
		expect(audio.length).toBe(4);
		expect(audio[0]!.link.url).toBe(
			"https://files-cloud.uniteforliteracy.com/book/164/eng/audio/spa/33_0.mp3",
		);
		expect(audio[1]!.link.url).toContain("/audio/spa/33_2.mp3");
		expect(audio[1]!.from).toBe(1);
		// The narration file lists fewer pages than the book: the tail falls
		// back to the native narration instead of dropping audio.
		expect(audio[3]!.link.url).toContain("/audio/eng/eng_bs_stickynote.mp3");
		expect(audio[3]!.from).toBe(4);
	});
	it("should extract authors, credits and narration languages", () => {
		expect(bookAuthor(BOOK)).toEqual(["Holly Hartman"]);
		expect(personCredits(BOOK)).toEqual(["Zaiga Cress"]);
		expect(
			bookAuthor({ Pages: [{ CreditList: [{ Text: " A " }, { Text: "A" }] }] }),
		).toEqual(["A"]);
		expect(narrationLangs(BOOK)).toEqual(["spa", "fre", "deu"]);
		expect(bookLang(BOOK)).toBe("eng");
		expect(bookLang({ Abbv: "SPA " })).toBe("spa");
		expect(bookLang({})).toBe("eng");
	});
	it("should build a description from the story page texts", () => {
		const description = bookDescription(BOOK);
		expect(description).toContain(
			"A big sister is a good person to have in your family.",
		);
		expect(description).not.toContain("Holly Hartman"); // title page skipped
		expect(bookDescription({})).toBe("");
		const long = bookDescription({
			Pages: Array.from({ length: 40 }, () => ({
				PageType: 3,
				PageText: "x".repeat(30),
			})),
		});
		expect(long.length).toBe(600);
		expect(long.endsWith("...")).toBe(true);
	});
	it("should map a book to a detail with a single Read episode", () => {
		const detail = bookToDetail(BOOK, "164")!;
		expect(detail.id.uid).toBe("164");
		expect(detail.titles).toEqual(["Big Sister"]);
		expect(detail.media_type).toBe("Comic");
		expect(detail.status).toBe("Complete");
		expect(detail.language).toBe("eng");
		expect(detail.author).toEqual(["Holly Hartman"]);
		expect(detail.episodes.length).toBe(1);
		expect(detail.episodes[0]!.name).toBe("Read");
		expect(detail.episodes[0]!.id.uid).toBe("164");
		expect(detail.episodes[0]!.url).toBe(bookPageUrl("164"));
		expect(detail.cover?.url).toContain("/th480/17_0.jpg");
		expect(detail.meta).toEqual({
			Narrations: "3 languages",
			ISBN: "978-1-63040-008-8",
		});
		expect(bookToDetail({ Title: "  " }, "164")).toBeNull();
		expect(bookToDetail(BOOK, "not-a-number")).toBeNull();
	});
	it("should resolve language names with a fallback", () => {
		expect(languageName("spa", { spa: "Spanish" })).toBe("Spanish");
		expect(languageName("SPA", {})).toBe("Spanish");
		expect(languageName("zzz", {})).toBe("zzz");
	});
});

// ---------------------------------------------------------------------------
// Live narration mapping (plain fetch + helpers, no runtime needed)
// ---------------------------------------------------------------------------

describe("live narration mapping", () => {
	it("should align Spanish narration with the book pages of BKID 164", async () => {
		const bookRes = await fetch(bookJsonUrl("164"));
		expect(bookRes.ok).toBe(true);
		const book = (await bookRes.json()) as UflBook;
		const narrRes = await fetch(narrationJsonUrl("164", "spa"));
		expect(narrRes.ok).toBe(true);
		const narration = (await narrRes.json()) as UflNarration;
		const { urls, linkIndex: index } = pageImages(book);
		const audio = buildAudio(book, narration, index);
		expect(urls.length).toBeGreaterThanOrEqual(10);
		expect(audio.length).toBe(urls.length);
		expect(audio[0]!.link.url).toContain("/audio/spa/");
		for (const [position, entry] of audio.entries()) {
			expect(entry.from).toBe(position);
			expect(entry.to).toBe(position);
		}
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Live flow against uniteforliteracy.com through the built extension
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
					"reader-cloud.uniteforliteracy.com",
					"books-cloud.uniteforliteracy.com",
					"files-cloud.uniteforliteracy.com",
					"static-cloud.uniteforliteracy.com",
				]),
			);
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBe(PAGE_SIZE);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(entry.id.uid.length).toBeGreaterThan(0);
			expect(entry.cover?.url).toStartWith(
				"https://files-cloud.uniteforliteracy.com/",
			);
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "big sister");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(matchesTitle(entry.title, "big sister")).toBe(true);
		}
		// Client-side search is deterministic, so the classic must be there.
		expect(result.content.some((entry) => entry.title === "Big Sister")).toBe(
			true,
		);
		await assertValidEntries(result.content);
	}, 120_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);
	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.name).toBe("Read");
		expect(result.entry.episodes[0]!.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.ui).toBeDefined();
		// Attribution text is part of the custom UI.
		expect(JSON.stringify(result.entry.ui)).toContain("Unite for Literacy");
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 60_000);
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Imagelist");
		if (result.source.type === "Imagelist") {
			expect(result.source.links.length).toBeGreaterThan(1);
			for (const link of result.source.links) {
				expect(link.url).toStartWith(
					"https://files-cloud.uniteforliteracy.com/",
				);
			}
			// The default narration language ("") is the book's own audio.
			expect(result.source.audio).not.toBeNull();
			if (result.source.audio !== null) {
				for (const entry of result.source.audio) {
					expect(entry.from).toBe(entry.to);
					expect(entry.from).toBeGreaterThanOrEqual(0);
					expect(entry.from).toBeLessThan(result.source.links.length);
				}
			}
			await assertValidSource(result.source);
		}
		expect(result.settings).toEqual(detailResult.settings);
	}, 60_000);
	it("should serve a known book with correctly aligned narration", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "164" }, {});
		expect(result.entry.id.uid).toBe("164");
		expect(result.entry.titles).toEqual(["Big Sister"]);
		expect(result.entry.language).toBe("eng");
		expect(result.entry.author).toEqual(["Holly Hartman"]);
		expect(result.entry.episodes[0]!.id.uid).toBe("164");
		const sourced = await extension!.source(
			result.entry.episodes[0]!.id,
			result.settings,
		);
		expect(sourced.source.type).toBe("Imagelist");
		if (sourced.source.type === "Imagelist") {
			// 11 pages carry images (the text-only title page is skipped).
			expect(sourced.source.links.length).toBe(11);
			expect(sourced.source.links[0]!.url).toContain("picset/th480/17_0.jpg");
			expect(sourced.source.audio).not.toBeNull();
			if (sourced.source.audio !== null) {
				// One narration track per imaged page, mapped onto its imagelist
				// position (the imageless page 1 shifts everything after it).
				expect(sourced.source.audio.length).toBe(11);
				for (const [position, entry] of sourced.source.audio.entries()) {
					expect(entry.from).toBe(position);
					expect(entry.to).toBe(position);
					expect(entry.link.url).toContain("/audio/eng/");
				}
			}
			await assertValidSource(sourced.source);
		}
	}, 60_000);
	it("should reject empty, malformed and unknown entry ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "" }, {})).rejects.toThrow();
		await expect(
			extension!.detail({ uid: "big-sister" }, {}),
		).rejects.toThrow();
		// 403 from books-cloud: unpublished/unknown BKID.
		await expect(extension!.detail({ uid: "999999999" }, {})).rejects.toThrow();
		await expect(extension!.source({ uid: "" }, {})).rejects.toThrow();
	}, 60_000);
});
