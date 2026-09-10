/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
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
	SettingValue,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import type { AuthorLink, BookCard, BookInfo } from "./site.ts";
import {
	BASE,
	FORMAT_EPUB,
	FORMAT_PDF,
	FORMAT_SETTING_ID,
	bookUidFromHref,
	decodeEntities,
	hasNextPage,
	isAuthorPageHref,
	matchesQuery,
	parseAuthorList,
	parseBookCards,
	parseBookPage,
	parseDownloadCandidates,
	parseSitemap,
	pickDownload,
	slugTitle,
	tokenizeQuery,
} from "./site.ts";

let extension: Extension;
let searchFirst: Entry;
let detailResult: EntryDetailedResult;

function formatSettings(value: string): Record<string, Setting> {
	return {
		[FORMAT_SETTING_ID]: {
			label: "Format",
			value: { type: "String", data: value } as SettingValue,
			default: { type: "String", data: FORMAT_EPUB } as SettingValue,
			visible: true,
			ui: null,
		},
	};
}

// ---------------------------------------------------------------------------
// Inline fixtures modelled on the real site markup
// ---------------------------------------------------------------------------

const LISTING_FIXTURE = `<section class="book-grid" aria-label="Ebook list">
<article class="book-card">
    <a class="book-cover" href="https://www.globalgreyebooks.com/household-tales-ebook.html"><img src="https://www.globalgreyebooks.com/content/book-covers/brothers-grimm_household-tales.jpg" alt="cover page for the Global Grey edition of Household Tales by Jacob and Wilhelm Grimm" title="Household Tales by Jacob and Wilhelm Grimm"
           loading="lazy" />
    </a>

    <div class="book-meta">
      <h2 class="book-title">
        <a href="https://www.globalgreyebooks.com/household-tales-ebook.html">Household Tales</a>
      </h2>
      <p class="book-author">Jacob and Wilhelm Grimm</p>
    </div>
  </article>

<article class="book-card">
    <a class="book-cover" href="https://www.globalgreyebooks.com/book-page/dukes-children-ebook.html"><img src="https://www.globalgreyebooks.com/content/book-covers-2/anthony-trollope_dukes-children.jpg" alt="cover page for the Global Grey edition of The Duke's Children by Anthony Trollope"
           loading="lazy" />
    </a>

    <div class="book-meta">
      <h2 class="book-title">
        <a href="https://www.globalgreyebooks.com/book-page/dukes-children-ebook.html">The Duke&#8217;s Children</a>
      </h2>
    </div>
  </article>
</section>

<nav class="pager" aria-label="Pagination">
    <a class="page-link is-current" href="https://www.globalgreyebooks.com/category/ebooks/fables-fairy-tales-page-1.html" aria-current="page">1</a>
    <a class="page-link" href="https://www.globalgreyebooks.com/category/ebooks/fables-fairy-tales-page-2.html">2</a>
</nav>`;

const BOOK_FIXTURE = `<html><head>
<meta name="dc.title" content="The Duke's Children">
<meta name="dc.creator" content="Anthony Trollope">
<meta name="dc.language" content="en">
<meta name="dc.date" content="1880">
<meta property="og:image" content="https://www.globalgreyebooks.com/content/book-covers-2/anthony-trollope_dukes-children-large.jpg">
<meta property="og:description" content="Backup description.">
<script type="application/ld+json">
{
"@context": "https://schema.org",
"@type": "Book",
"name": "The Duke's Children",
"datePublished": "1880",
"inLanguage": "en",
"numberOfPages": "431",
"genre": ["Family Saga", "Political Novel"],
"isPartOf": {
"@type": "BookSeries",
"name": "Palliser",
"position": "6"
},
"author": {
"@type": "Person",
"name": "Anthony Trollope"
},
"description": "A widowed duke struggles to steer his three headstrong children.",
"image": "https://www.globalgreyebooks.com/content/book-covers-2/anthony-trollope_dukes-children-large.jpg",
"thumbnailUrl": "https://www.globalgreyebooks.com/content/book-covers-2/anthony-trollope_dukes-children.jpg",
"sameAs": "https://en.wikipedia.org/wiki/The_Duke's_Children"
}
</script>
</head><body>
<div class="download-group"> <a href="https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.pdf" download target="_blank" class="btn-download">PDF<span>Standard Format</span></a>
<a href="https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.epub" class="btn-download">EPUB<span>For E-Readers/Kindle</span></a>
<a href="https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.azw3" class="btn-download">AZW3<span>For Kindle</span></a>
<a href="https://www.globalgreyebooks.com/online-books-2/anthony-trollope_dukes-children_complete-text.html" class="btn-download">Online<span>Read in browser</span></a>
</div>
<div class="prose">
<h3 class="prose-subhead">What It's About</h3>
<p>The final novel in Trollope's <a href="https://www.globalgreyebooks.com/anthony-trollope-books.html#palliser"><u>Palliser series</u></a> opens with the sudden death of the Duchess of Omnium.</p>
<p>Second paragraph.</p>
</div>
</body></html>`;

const FALLBACK_FIXTURE = `<html><head>
<meta name="dc.title" content="Backup Title">
<meta name="author" content="Backup Author">
<meta name="dc.language" content="de">
<meta name="dc.date" content="1900">
</head><body>
<h1 id="book-title" class="book-title">
Backup Title
</h1>
<div class="download-group"> <a href="/ebooks/backup-author_backup.epub">EPUB</a>
<a href="/ebooks/backup-author_backup.pdf">PDF</a>
</div>
</body></html>`;

const SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.globalgreyebooks.com</loc></url>
<url><loc>https://www.globalgreyebooks.com/recently-added.html</loc></url>
<url><loc>https://www.globalgreyebooks.com/household-tales-ebook.html</loc></url>
<url><loc>https://www.globalgreyebooks.com/book-page/dukes-children-ebook.html</loc></url>
<url><loc>https://www.globalgreyebooks.com/category/ebooks/folklore-page-1.html</loc></url>
<url><loc>https://www.globalgreyebooks.com/online-ebooks/brothers-grimm_household-tales_complete-text.html</loc></url>
</urlset>`;

const AUTHORS_FIXTURE = `<ul class="nav-menu" id="nav-menu">
<li><a href="https://www.globalgreyebooks.com/recently-added.html">Recent</a></li>
<li><a href="https://www.globalgreyebooks.com/ebook-categories.html">Categories</a></li>
</ul>
<ul class="author-list">
<li><a href="https://www.globalgreyebooks.com/jacob-abbott-books.html">Abbott, Jacob</a></li>
<li><a href="https://www.globalgreyebooks.com/household-tales-ebook.html">Brothers Grimm</a></li>
<li><a href="https://www.globalgreyebooks.com/aesop-for-children-ebook.html">Aesop</a></li>
</ul>`;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
});

describe("site helpers", () => {
	it("should decode html entities", () => {
		expect(decodeEntities("The Duke&#8217;s Children")).toBe(
			"The Duke’s Children",
		);
		expect(decodeEntities("Fables &amp; Fairy Tales")).toBe(
			"Fables & Fairy Tales",
		);
		expect(decodeEntities("A&#x2014;B")).toBe("A—B");
		expect(decodeEntities("&mdash;&hellip;&quot;")).toBe('—…"');
		expect(decodeEntities("&unknownentity;")).toBe("&unknownentity;");
	});

	it("should extract book uids from hrefs", () => {
		expect(
			bookUidFromHref(
				"https://www.globalgreyebooks.com/household-tales-ebook.html",
			),
		).toBe("household-tales-ebook");
		expect(
			bookUidFromHref(
				"https://www.globalgreyebooks.com/book-page/dukes-children-ebook.html",
			),
		).toBe("book-page/dukes-children-ebook");
		expect(bookUidFromHref("/grimm-fairy-tales-ebook.html")).toBe(
			"grimm-fairy-tales-ebook",
		);
		expect(
			bookUidFromHref("https://www.globalgreyebooks.com/ebook-categories.html"),
		).toBeNull();
		expect(
			bookUidFromHref(
				"https://www.globalgreyebooks.com/category/ebooks/folklore-page-1.html",
			),
		).toBeNull();
		expect(
			bookUidFromHref(
				"https://www.globalgreyebooks.com/jacob-abbott-books.html",
			),
		).toBeNull();
	});

	it("should derive display titles from uid slugs", () => {
		expect(slugTitle("household-tales-ebook")).toBe("Household Tales");
		expect(slugTitle("book-page/dukes-children-ebook")).toBe("Dukes Children");
		expect(slugTitle("celtic-mythology-and-religion-ebook")).toBe(
			"Celtic Mythology And Religion",
		);
	});

	it("should tokenize and match queries", () => {
		expect(tokenizeQuery("  Household   Tales! ")).toEqual([
			"household",
			"tales",
		]);
		expect(matchesQuery("household-tales-ebook", ["household", "tales"])).toBe(
			true,
		);
		expect(matchesQuery("household-tales-ebook", ["norse"])).toBe(false);
		expect(matchesQuery("brothers grimm", ["grimm"])).toBe(true);
	});

	it("should parse a book card listing", () => {
		const cards: BookCard[] = parseBookCards(LISTING_FIXTURE);
		expect(cards.length).toBe(2);
		expect(cards[0]).toEqual({
			uid: "household-tales-ebook",
			title: "Household Tales",
			author: "Jacob and Wilhelm Grimm",
			cover:
				"https://www.globalgreyebooks.com/content/book-covers/brothers-grimm_household-tales.jpg",
		});
		expect(cards[1]!.uid).toBe("book-page/dukes-children-ebook");
		expect(cards[1]!.title).toBe("The Duke’s Children");
		expect(cards[1]!.author).toBe("");
	});

	it("should detect the next page from the pager links", () => {
		expect(hasNextPage(LISTING_FIXTURE, 0)).toBe(true);
		expect(hasNextPage(LISTING_FIXTURE, 1)).toBe(false);
	});

	it("should parse the sitemap into ebook uids", () => {
		expect(parseSitemap(SITEMAP_FIXTURE)).toEqual([
			"household-tales-ebook",
			"book-page/dukes-children-ebook",
		]);
	});

	it("should parse the authors index", () => {
		const authors: AuthorLink[] = parseAuthorList(AUTHORS_FIXTURE);
		expect(authors).toEqual([
			{
				name: "Abbott, Jacob",
				href: "https://www.globalgreyebooks.com/jacob-abbott-books.html",
			},
			{ name: "Brothers Grimm", href: `${BASE}/household-tales-ebook.html` },
			{ name: "Aesop", href: `${BASE}/aesop-for-children-ebook.html` },
		]);
		expect(isAuthorPageHref(authors[0]!.href)).toBe(true);
		expect(isAuthorPageHref(authors[1]!.href)).toBe(false);
	});

	it("should parse a book page from its JSON-LD", () => {
		const info: BookInfo = parseBookPage(BOOK_FIXTURE);
		expect(info.title).toBe("The Duke's Children");
		expect(info.author).toBe("Anthony Trollope");
		expect(info.year).toBe("1880");
		expect(info.language).toBe("en");
		expect(info.genres).toEqual(["Family Saga", "Political Novel"]);
		expect(info.pages).toBe(431);
		expect(info.series).toBe("Palliser #6");
		expect(info.cover).toBe(
			"https://www.globalgreyebooks.com/content/book-covers-2/anthony-trollope_dukes-children.jpg",
		);
		expect(info.wikipedia).toBe(
			"https://en.wikipedia.org/wiki/The_Duke's_Children",
		);
		expect(info.downloads.epub).toBe(
			"https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.epub",
		);
		expect(info.downloads.pdf).toBe(
			"https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.pdf",
		);
		expect(info.downloads.azw3).toBe(
			"https://www.globalgreyebooks.com/ebooks-2/anthony-trollope_dukes-children.azw3",
		);
		// The prose description wins over the JSON-LD one-liner.
		expect(info.description).toContain("final novel");
		expect(info.description).toContain("Second paragraph.");
		expect(info.description).not.toContain("<");
	});

	it("should fall back to meta tags without JSON-LD", () => {
		const info: BookInfo = parseBookPage(FALLBACK_FIXTURE);
		expect(info.title).toBe("Backup Title");
		expect(info.author).toBe("Backup Author");
		expect(info.year).toBe("1900");
		expect(info.language).toBe("de");
		expect(info.downloads.epub).toBe(
			`${BASE}/ebooks/backup-author_backup.epub`,
		);
		expect(info.downloads.pdf).toBe(`${BASE}/ebooks/backup-author_backup.pdf`);
		expect(info.description).toBe("");
	});

	it("should parse and pick download candidates", () => {
		expect(parseDownloadCandidates(undefined)).toBeNull();
		expect(parseDownloadCandidates("not json")).toBeNull();
		expect(
			parseDownloadCandidates(JSON.stringify({ epub: "/a.epub", pdf: "" })),
		).toEqual({ epub: "/a.epub", pdf: null });

		const candidates = { epub: "/a.epub", pdf: "/a.pdf" };
		expect(pickDownload(candidates, FORMAT_EPUB)).toEqual({
			url: "/a.epub",
			type: "Epub",
		});
		expect(pickDownload(candidates, FORMAT_PDF)).toEqual({
			url: "/a.pdf",
			type: "Pdf",
		});
		expect(pickDownload({ epub: null, pdf: "/a.pdf" }, FORMAT_EPUB)).toEqual({
			url: "/a.pdf",
			type: "Pdf",
		});
		expect(pickDownload({ epub: "/a.epub", pdf: null }, FORMAT_PDF)).toEqual({
			url: "/a.epub",
			type: "Epub",
		});
		expect(pickDownload({ epub: null, pdf: null }, FORMAT_EPUB)).toBeNull();
	});
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
	});

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"globalgreyebooks.com",
					"www.globalgreyebooks.com",
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
		expect(result.content[0]!.author?.length).toBeGreaterThan(0);
		expect(result.content[0]!.cover?.url).toContain("book-covers");
		await assertValidEntries(result.content);
	});

	it("should paginate browse results", async () => {
		const page0 = await extension!.browse(0);
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = page0.content.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
	});

	it("should search by author", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "grimm");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		expect(result.content[0]!.author?.[0]).toContain("Grimm");
		searchFirst = result.content[0]!;
	});

	it("should search by title via the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "mythology");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("mythology"))).toBe(true);
	});

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail(
			{ uid: "book-page/dukes-children-ebook" },
			{},
		);
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.titles[0]).toBe("The Duke's Children");
		expect(entry.author?.[0]).toContain("Trollope");
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.language.startsWith("en")).toBe(true);
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.genres?.length).toBeGreaterThan(0);
		expect(entry.meta?.["First published"]).toBe("1880");
		expect(entry.meta?.Series).toContain("Palliser");
		expect(entry.cover?.url).toContain("book-covers");
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Read");
		// The per-entry format setting is defined on first detail.
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		// The download candidates ride along in the episode iddata.
		const candidates = parseDownloadCandidates(entry.episodes[0]!.id.iddata);
		expect(candidates?.epub).toContain(".epub");
		expect(candidates?.pdf).toContain(".pdf");
		detailResult = result;
		await assertValidEntry(entry);
	});

	it("should be able to source with the default format", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toContain(
			"/ebooks-2/anthony-trollope_dukes-children.epub",
		);
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		await assertValidSource(result.source);
	});

	it("should honor the pdf format setting", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			formatSettings(FORMAT_PDF),
		);
		expect(result.source.type).toBe("Pdf");
		if (result.source.type !== "Pdf") throw new Error("Not a pdf source");
		expect(result.source.link.url).toContain(
			"/ebooks-2/anthony-trollope_dukes-children.pdf",
		);
		expect(result.settings[FORMAT_SETTING_ID]).toBeDefined();
	});

	it("should source an episode that skipped detail", async () => {
		if (searchFirst === undefined) throw new Error("No search result");
		// No iddata and no settings: source re-reads the book page itself.
		const result = await extension!.source({ uid: searchFirst.id.uid }, {});
		expect(result.source.type).toBe("Epub");
		await assertValidSource(result.source);
	});
});
