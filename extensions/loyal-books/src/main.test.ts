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
	absolute,
	bookUrl,
	decodeEntities,
	durationToSeconds,
	feedUrl,
	humanRuntime,
	languageCode,
	listingUrl,
	makeEpisodeId,
	normalizeDuration,
	parseBookFeed,
	parseBookPage,
	parseCatalog,
	parseEpisodeId,
	parseListing,
	parsePlaylist,
	slugToTitle,
	splitTitleAuthor,
	stripHtml,
	httpsUp,
} from "./site.ts";

let extension: Extension;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

// ---------------------------------------------------------------------------
// Unit tests for the site parsing helpers (fixtures from the real markup)
// ---------------------------------------------------------------------------

const LISTING_FIXTURE = `<html><body>
<table class="layout2-blue" summary="Audio books"><tr><th class="layout2-blue" colspan="4"><h1>Featured free audio books &#8212; Fiction</h1></th></tr><tr>
<td class="layout2-blue" width="25%" valign="top" align="center">
<a href="/book/tom-sawyer-by-mark-twain">
<img class="layout" src="/image/layout2/49.jpg" alt="The Adventures of Tom Sawyer by Mark Twain"></a><br>
<a href="/book/tom-sawyer-by-mark-twain">
<b>The Adventures of Tom Sawyer</b></a><br>Mark Twain
<br><a href="/book/tom-sawyer-by-mark-twain">
<div class="s-desktop" id="star5"</div>
</a>
</td>
<td class="layout2-blue" width="25%" valign="top" align="center">
<a href="/book/les-miserables-vol-1-by-victor-hugo">
<b>Les Mis&eacute;rables</b></a><br>Victor Hugo
<br><a href="/book/les-miserables-vol-1-by-victor-hugo">
<div class="s-desktop" id="star5"</div>
</a>
</td>
</tr></table>
<div class="result-pages">Page 1 of 89&nbsp;
<ul style="display: inline;"><li><a href="/genre/Fiction?page=2">></a></li></ul></div>
</body></html>`;

const SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>http://www.loyalbooks.com</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
<url><loc>http://www.loyalbooks.com/genre/Fiction</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
<url><loc>http://www.loyalbooks.com/book/a-midsummer-nights-dream-by-william-shakespeare</loc><changefreq>weekly</changefreq><priority>0.7</priority><image:image><image:loc>http://www.loyalbooks.com/image/detail/midsummer_nights_dream.jpg</image:loc><image:title>A Midsummer Night&apos;s Dream By: William Shakespeare</image:title></image:image></url>
<url><loc>http://www.loyalbooks.com/book/Anna-Karenina-by-Leo-Tolstoy</loc><changefreq>weekly</changefreq><priority>0.7</priority><image:image><image:loc>http://www.loyalbooks.com/image/detail/Anna-Karenina.jpg</image:loc><image:title>Anna Karenina By: Leo Tolstoy</image:title></image:image></url>
<url><loc>http://www.loyalbooks.com/book/a-midsummer-nights-dream-by-william-shakespeare-2</loc><changefreq>weekly</changefreq><priority>0.6</priority><image:image><image:loc>http://www.loyalbooks.com/image/detail/midsummer_nights_dream.jpg</image:loc><image:title>A Midsummer Night&apos;s Dream By: William Shakespeare</image:title></image:image></url>
<url><loc>http://www.loyalbooks.com/book/20000-lieues-sous-les-mers</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>
</urlset>`;

const FEED_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
<title><![CDATA[Alice im Wunderland by Lewis Carroll]]></title>
<link>http://www.loyalbooks.com/book/Alices-Abenteuer-im-Wunderland</link>
<language>de</language>
<itunes:author>Loyal Books</itunes:author>
<item>
<title><![CDATA[01 &#8211; Kapitel 1: Hinab in den Kaninchenbau]]></title>
<enclosure url="http://www.archive.org/download/alices_abenteuer_0911/alicesabenteuer_01_carroll_64kb.mp3" length="12000000" type="audio/mpeg" />
<guid>http://www.archive.org/download/alices_abenteuer_0911/alicesabenteuer_01_carroll_64kb.mp3</guid>
<itunes:duration>17:13</itunes:duration>
</item>
<item>
<title>02 &#8211; Kapitel 2</title>
<enclosure url="https://www.archive.org/download/alices_abenteuer_0911/alicesabenteuer_02_carroll_64kb.mp3" length="1" type="audio/mpeg" />
<itunes:duration>1:02:03</itunes:duration>
</item>
</channel></rss>`;

const BOOK_PAGE_FIXTURE = `<html><head>
<title>Frankenstein by Mary Wollstonecraft Shelley - Free at Loyal Books</title>
<meta name="description" content=" Short meta description. ">
<link rel="canonical" href="https://www.loyalbooks.com/book/frankenstein-or-modern-prometheus-by-mary-w-shelley">
<meta property="og:image" content="https://www.loyalbooks.com/image/detail/Frankenstein-or-Modern-Prome.jpg">
</head><body>
<div itemscope itemtype="http://schema.org/Book">
<table class="book" summary="Audio book details">
<tr><th class="book"><div style="float:left; padding-right:35px;"><h1 style="font-size:25px; padding:2px;"><span itemprop="name">Frankenstein</span></h1></div></th></tr>
<tr><td class="book">
<img itemprop="image" class="cover" src="/image/detail/Frankenstein-or-Modern-Prome.jpg" alt="Frankenstein by Mary Shelley">
<font class="book-author">By: <a href="/author?author=Mary+Wollstonecraft+Shelley" itemprop="author">Mary Wollstonecraft Shelley</a> (1797-1851)</font><p>
<span itemprop="description"><font class="book-description"><p>First paragraph about the creature.</p>
<p>Second paragraph with <i>italics</i> &amp; an entity &#8212; dash.</p>
</font></span>
</td></tr></table>
<table class="link" summary="Genres for this book">
<tr><th class="link">Genres for this book</th></tr>
<tr><td class="link">
<a href="/genre/Fiction">Fiction</a>
<a href="/genre/Science_fiction">Science fiction</a>
</td></tr></table>
<a href="http://www.archive.org/download/frankenstein_0911_librivox/frankenstein_0911_librivox_64kb_mp3.zip" class="download">
<div class="s-book" id="zip"></div><font class="download-big">MP3 Download</font></a>
<script>
audioPlaylist = new Playlist("jplayer", [
{name:"01 &#8211; Letter 1", free:true, mp3:"http://www.archive.org/download/frankenstein_0911_librivox/frankenstein_01_shelley_64kb.mp3"},
{name:"02 \\"Quoted\\" Chapter", free:true, mp3:"http://www.archive.org/download/frankenstein_0911_librivox/frankenstein_02_shelley_64kb.mp3"}
], {
ready: function() {}
});
</script>
</body></html>`;

describe("site helpers", () => {
	it("should decode html entities in one pass", () => {
		expect(decodeEntities("&amp;lt; &amp; &quot;x&quot; &#8212; &#x27;")).toBe(
			'&lt; & "x" — \'',
		);
		expect(decodeEntities("plain text")).toBe("plain text");
		expect(decodeEntities("&unknown; &#0; &#999999999999;")).toBe(
			"&unknown;  ",
		);
	});

	it("should strip html into readable text", () => {
		expect(stripHtml("<p>One</p>\n  <p>Two</p><br>End")).toBe(
			"One\n\nTwo\n\nEnd",
		);
		expect(stripHtml("A <i>italic</i> &amp; bold <b>word</b>")).toBe(
			"A italic & bold word",
		);
	});

	it("should parse listing pages", () => {
		const { entries, totalPages } = parseListing(LISTING_FIXTURE);
		expect(totalPages).toBe(89);
		expect(entries.length).toBe(2);
		expect(entries[0]!.slug).toBe("tom-sawyer-by-mark-twain");
		expect(entries[0]!.title).toBe("The Adventures of Tom Sawyer");
		expect(entries[0]!.author).toBe("Mark Twain");
		expect(entries[0]!.cover).toBe(
			"https://www.loyalbooks.com/image/layout2/49.jpg",
		);
		expect(entries[1]!.title).toBe("Les Misérables");
		expect(entries[1]!.author).toBe("Victor Hugo");
		expect(entries[1]!.cover).toBe("");
	});

	it("should build listing urls per language and category", () => {
		expect(listingUrl("English", "popular", 0)).toBe(
			"https://www.loyalbooks.com/Top_100",
		);
		expect(listingUrl("English", "Fiction", 2)).toBe(
			"https://www.loyalbooks.com/genre/Fiction?page=3",
		);
		expect(listingUrl("English", "all", 0)).toBeNull();
		expect(listingUrl("German", "Fiction", 0)).toBe(
			"https://www.loyalbooks.com/language/German",
		);
	});

	it("should parse the sitemap catalog with dedupe", () => {
		const items = parseCatalog(SITEMAP_FIXTURE);
		expect(items.length).toBe(3);
		expect(items[0]!.slug).toBe(
			"a-midsummer-nights-dream-by-william-shakespeare",
		);
		expect(items[0]!.title).toBe("A Midsummer Night's Dream");
		expect(items[0]!.author).toBe("William Shakespeare");
		expect(items[0]!.cover).toBe(
			"https://www.loyalbooks.com/image/detail/midsummer_nights_dream.jpg",
		);
		expect(items[2]!.slug).toBe("20000-lieues-sous-les-mers");
		expect(items[2]!.title).toBe("20000 Lieues Sous Les Mers");
		expect(items[2]!.author).toBe("");
	});

	it("should split image titles and prettify slugs", () => {
		expect(splitTitleAuthor("Anna Karenina By: Leo Tolstoy")).toEqual({
			title: "Anna Karenina",
			author: "Leo Tolstoy",
		});
		expect(splitTitleAuthor("Just A Title")).toEqual({
			title: "Just A Title",
			author: "",
		});
		expect(slugToTitle("the-return-of-sherlock-holmes")).toBe(
			"The Return Of Sherlock Holmes",
		);
	});

	it("should parse podcast feeds with chapter enclosures", () => {
		const feed = parseBookFeed(FEED_FIXTURE);
		expect(feed.language).toBe("de");
		expect(feed.chapters.length).toBe(2);
		expect(feed.chapters[0]!.title).toBe(
			"01 – Kapitel 1: Hinab in den Kaninchenbau",
		);
		expect(feed.chapters[0]!.url).toBe(
			"https://www.archive.org/download/alices_abenteuer_0911/alicesabenteuer_01_carroll_64kb.mp3",
		);
		expect(feed.chapters[0]!.duration).toBe("17:13");
		expect(feed.chapters[1]!.url.startsWith("https://")).toBe(true);
		// HTML 404 pages must parse as an empty feed, not throw.
		expect(parseBookFeed("<html>404 Page not found</html>")).toEqual({
			language: "",
			chapters: [],
		});
	});

	it("should parse book pages", () => {
		const page = parseBookPage(BOOK_PAGE_FIXTURE);
		expect(page.title).toBe("Frankenstein");
		expect(page.author).toBe("Mary Wollstonecraft Shelley");
		expect(page.cover).toBe(
			"https://www.loyalbooks.com/image/detail/Frankenstein-or-Modern-Prome.jpg",
		);
		expect(page.description).toContain("First paragraph about the creature.");
		expect(page.description).toContain("italics & an entity — dash");
		expect(page.genres).toEqual(["Fiction", "Science fiction"]);
		expect(page.canonicalSlug).toBe(
			"frankenstein-or-modern-prometheus-by-mary-w-shelley",
		);
		expect(page.zipUrl).toBe(
			"https://www.archive.org/download/frankenstein_0911_librivox/frankenstein_0911_librivox_64kb_mp3.zip",
		);
		expect(page.chapters.length).toBe(2);
		expect(page.chapters[0]!.title).toBe("01 – Letter 1");
		expect(page.chapters[0]!.url).toBe(
			"https://www.archive.org/download/frankenstein_0911_librivox/frankenstein_01_shelley_64kb.mp3",
		);
		expect(page.chapters[1]!.title).toBe('02 "Quoted" Chapter');
	});

	it("should fall back to the meta description", () => {
		const page = parseBookPage(
			'<html><head><meta name="description" content=" Short meta. "></head><body></body></html>',
		);
		expect(page.description).toBe("Short meta.");
	});

	it("should parse jPlayer playlists standalone", () => {
		expect(parsePlaylist(BOOK_PAGE_FIXTURE).length).toBe(2);
		expect(parsePlaylist("<html>no playlist</html>").length).toBe(0);
	});

	it("should round-trip episode ids", () => {
		expect(parseEpisodeId(makeEpisodeId("Book-Slug", 3))).toEqual({
			slug: "Book-Slug",
			index: 3,
		});
		expect(parseEpisodeId("no-index")).toBeNull();
		expect(parseEpisodeId("book#x")).toBeNull();
		expect(parseEpisodeId("book#-1")).toBeNull();
		expect(parseEpisodeId("#0")).toBeNull();
	});

	it("should normalize durations and languages", () => {
		expect(normalizeDuration("25:56")).toBe("25:56");
		expect(normalizeDuration("1:02:03")).toBe("1:02:03");
		expect(normalizeDuration("00:08:26")).toBe("8:26");
		expect(normalizeDuration("506")).toBe("8:26");
		expect(durationToSeconds("17:13")).toBe(1033);
		expect(humanRuntime(durationToSeconds("11:06:58"))).toBe("11h 7m");
		expect(languageCode("en-us")).toBe("en");
		expect(languageCode("de")).toBe("de");
		expect(languageCode("")).toBe("");
		expect(languageCode("nonsense")).toBe("");
	});

	it("should build and upgrade urls", () => {
		expect(bookUrl("Book")).toBe("https://www.loyalbooks.com/book/Book");
		expect(feedUrl("Book")).toBe("https://www.loyalbooks.com/book/Book/feed");
		expect(httpsUp("http://www.archive.org/x.mp3")).toBe(
			"https://www.archive.org/x.mp3",
		);
		expect(httpsUp("https://a/x.mp3")).toBe("https://a/x.mp3");
		expect(absolute("/image/layout2/x.jpg")).toBe(
			"https://www.loyalbooks.com/image/layout2/x.jpg",
		);
		expect(absolute("https://a/x.jpg")).toBe("https://a/x.jpg");
	});
});

// ---------------------------------------------------------------------------
// Live flow against the real site through the native runtime
// ---------------------------------------------------------------------------

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Audio");
	});

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"www.loyalbooks.com",
					"archive.org",
					"www.archive.org",
				]),
			);
		}
	});

	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate browse results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((entry) => entry.id.uid);
		const ids1 = page1.content.map((entry) => entry.id.uid);
		expect(ids1).not.toEqual(ids0);
	}, 120_000);

	it("should be able to search the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "sherlock");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			const haystack =
				`${entry.title} ${(entry.author ?? []).join(" ")}`.toLowerCase();
			expect(haystack).toContain("sherlock");
		}
		await assertValidEntries(result.content);
	}, 300_000);

	it("should paginate search results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// "the" matches far more than one catalog page worth of books.
		const page1 = await extension!.search(1, "the");
		expect(page1.content.length).toBeGreaterThan(0);
	}, 120_000);

	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult.length <= 0) throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBeGreaterThan(0);
		for (const episode of result.entry.episodes) {
			expect(episode.url).toMatch(/\.mp3$/);
		}
		// detail must echo the settings it received
		expect(result.settings).toEqual({});
		detailResult = result;
		await assertValidEntry(result.entry);
	}, 180_000);

	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult.entry.episodes.length <= 0) {
			throw new Error("No detail result");
		}
		const result = await extension!.source(
			detailResult.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBeGreaterThan(0);
			expect(result.source.sources[0]!.url.url).toMatch(/\.mp3$/);
			expect(result.source.sources[0]!.lang.length).toBeGreaterThan(0);
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 120_000);

	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	}, 30_000);
});
