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
	bibliothekUrl,
	bookUidFromHref,
	bookUrl,
	chapterParagraphs,
	chapterUrl,
	cleanChapterName,
	decodeEntities,
	encodeQuery,
	episodeUid,
	htmlToText,
	locateCatalogPage,
	parseBookPage,
	parseBookUid,
	parseCatalogPage,
	parseChapter,
	parseEpisodeUid,
	parseIndexItems,
	parsePublishInfo,
	paragraphText,
	searchUrl,
	titleFromSlug,
} from "./site.ts";

let extension: Extension;

let browseResult: Entry[];
let searchResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
	searchResult = [];
});

// -- Pure helpers -----------------------------------------------------------

describe("text helpers", () => {
	it("should decode named and numeric entities, including umlauts", () => {
		expect(
			decodeEntities("Pl&auml;tze &amp; Stra&szlig;en &#8211; &Uuml;bel"),
		).toBe("Plätze & Straßen – Übel");
		expect(decodeEntities("&#228;&#x00E7;&#x27;")).toBe("äç'");
		// Unknown named entities stay as-is instead of mangling the text.
		expect(decodeEntities("&faustraub;")).toBe("&faustraub;");
	});

	it("should flatten html snippets to single-line text", () => {
		expect(
			htmlToText(
				"<style>.x{color:red}</style><p>Verlag:&nbsp;Manesse <!-- c --> | Jahr: 1990</p><script>nope()</script>",
			),
		).toBe("Verlag: Manesse | Jahr: 1990");
	});

	it("should encode query pairs for the VM (no URL global)", () => {
		expect(
			encodeQuery([
				["q", "faust & co"],
				["gl_scope[]", "titles"],
			]),
		).toBe("q=faust%20%26%20co&gl_scope%5B%5D=titles");
	});

	it("should build the catalog, search, book and chapter urls", () => {
		expect(bibliothekUrl("A", 2)).toBe(
			"https://projekt-gutenberg.org/bibliothek/?gl_letter=A&gl_page=2",
		);
		expect(searchUrl("faust")).toBe(
			"https://projekt-gutenberg.org/suche/?gutenberg_search=1&q=faust&gl_scope%5B%5D=authors&gl_scope%5B%5D=titles",
		);
		// Book pages live under /authors/<author>/books/<book>/ (trailing
		// slash — the slash-less variants only answer with 301s).
		expect(bookUrl("goethe/faust-2")).toBe(
			"https://projekt-gutenberg.org/authors/goethe/books/faust-2/",
		);
		expect(chapterUrl("goethe/faust-2", 3)).toBe(
			"https://projekt-gutenberg.org/authors/goethe/books/faust-2/chapter/3/",
		);
	});

	it("should derive display titles from slugs", () => {
		expect(titleFromSlug("goethe/die-leiden-des-jungen-werthers")).toBe(
			"Die Leiden Des Jungen Werthers",
		);
		expect(titleFromSlug("goethe/faust-2")).toBe("Faust 2");
	});
});

describe("id helpers", () => {
	it("should extract book uids from listing hrefs", () => {
		expect(
			bookUidFromHref(
				"https://projekt-gutenberg.org/authors/ivan-sergejevich-turgenev/books/faust",
			),
		).toBe("ivan-sergejevich-turgenev/faust");
		expect(
			bookUidFromHref(
				"https://www.projekt-gutenberg.org/authors/goethe/books/werther/",
			),
		).toBe("goethe/werther");
		expect(bookUidFromHref("/authors/goethe/books/faust")).toBe("goethe/faust");
		// Author-group hits and navigation links are no books.
		expect(bookUidFromHref("/authors/goethe")).toBeNull();
		expect(bookUidFromHref("/bibliothek/")).toBeNull();
	});

	it("should round-trip book uids and reject malformed ones", () => {
		expect(parseBookUid("goethe/faust")).toEqual({
			author: "goethe",
			book: "faust",
		});
		expect(parseBookUid("goethe")).toBeNull();
		expect(parseBookUid("goethe/faust/extra")).toBeNull();
		expect(parseBookUid("goethe/")).toBeNull();
	});

	it("should round-trip episode uids", () => {
		expect(parseEpisodeUid(episodeUid("goethe/faust", 12))).toEqual({
			bookUid: "goethe/faust",
			chapter: 12,
		});
		expect(parseEpisodeUid("goethe/faust")).toBeNull();
		expect(parseEpisodeUid("goethe/faust#0")).toBeNull();
		expect(parseEpisodeUid("goethe/faust#x")).toBeNull();
		expect(parseEpisodeUid("notabook#3")).toBeNull();
	});
});

describe("listing pages", () => {
	// Trimmed excerpt of a real /bibliothek/ result (verified live).
	const LIST_FIXTURE = `
	<div class="book-app__pagination-info"> <strong>855</strong> Bücher </div>
	<span class="book-app__pagination-status"> Seite 2 von 9 </span>
	<ul class="book-app__index-list">
	<li class="book-app__index-item">
	<a class="book-app__index-link" href="https://projekt-gutenberg.org/authors/ivan-sergejevich-turgenev/books/faust">
	<span class="book-app__index-title">Faust</span>
	<span class="book-app__index-meta book-app__index-meta--author">Ivan Sergejevich Turgenev</span>
	</a>
	</li>
	<li class="book-app__index-item">
	<a class="book-app__index-link" href="/authors/goethe">
	<span class="book-app__index-title">Goethe (Autorenseite)</span>
	</a>
	</li>
	</ul>`;

	it("should parse index items and keep non-book links unresolvable", () => {
		const items = parseIndexItems(LIST_FIXTURE);
		expect(items.length).toBe(2);
		expect(items[0]).toEqual({
			uid: "ivan-sergejevich-turgenev/faust",
			href: "https://projekt-gutenberg.org/authors/ivan-sergejevich-turgenev/books/faust",
			title: "Faust",
			author: "Ivan Sergejevich Turgenev",
		});
		// Author-group hit: href kept, uid null so callers can filter it.
		expect(items[1]?.uid).toBeNull();
		expect(items[1]?.href).toBe("/authors/goethe");
	});

	it("should parse catalog pagination metadata", () => {
		const info = parseCatalogPage(LIST_FIXTURE);
		expect(info.total).toBe(855);
		expect(info.page).toBe(2);
		expect(info.pages).toBe(9);
		expect(info.items.length).toBe(2);
		// Missing pagination blocks degrade to a single page.
		const bare = parseCatalogPage(
			'<ul><li class="book-app__index-item"></li></ul>',
		);
		expect(bare.total).toBe(0);
		expect(bare.pages).toBe(1);
	});

	it("should map flat pages onto the A–Z catalog letters", () => {
		// Letter A spans 2 pages, B none, C one.
		const counts = [2, 0, 1];
		expect(locateCatalogPage(0, counts)).toEqual({
			letter: "A",
			pageNumber: 1,
			hasNext: true,
		});
		expect(locateCatalogPage(1, counts)?.pageNumber).toBe(2);
		expect(locateCatalogPage(2, counts)).toEqual({
			letter: "C",
			pageNumber: 1,
			hasNext: true,
		});
		expect(locateCatalogPage(3, counts)).toBeNull();
		// The very last page of the last letter ("#", index 26) has no successor.
		const last = locateCatalogPage(0, new Array(27).fill(0).fill(1, 26));
		expect(last).toEqual({ letter: "#", pageNumber: 1, hasNext: false });
	});
});

describe("book pages", () => {
	// Trimmed excerpt of a real book start page (verified live).
	const BOOK_FIXTURE = `
	<h1 class="book-reader__title">Faust</h1>
	von <a href="https://projekt-gutenberg.org/authors/ivan-sergejevich-turgenev" class="book-reader__author-link">
	Ivan Sergejevich Turgenev </a>
	<p class="book-reader__description">Verlag: Manesse Verlag | Jahr: 1990 | &Uuml;bersetzer: Friedrich von Bodenstedt</p>
	<select>
	<option value="/authors/ivan-sergejevich-turgenev/books/faust/chapter/2" > 2. Der zweite Brief </option>
	<option value="/authors/ivan-sergejevich-turgenev/books/faust/chapter/1" selected="selected"> 1. Titelseite </option>
	<option value="/authors/ivan-sergejevich-turgenev/books/faust/chapter/1" > 1. Titelseite </option>
	</select>`;

	it("should parse title, author, description and publish info", () => {
		const info = parseBookPage(BOOK_FIXTURE, "ivan-sergejevich-turgenev/faust");
		expect(info.title).toBe("Faust");
		expect(info.author).toBe("Ivan Sergejevich Turgenev");
		expect(info.description).toBe(
			"Verlag: Manesse Verlag | Jahr: 1990 | Übersetzer: Friedrich von Bodenstedt",
		);
		expect(parsePublishInfo(info.description)).toEqual({
			Verlag: "Manesse Verlag",
			Jahr: "1990",
			Übersetzer: "Friedrich von Bodenstedt",
		});
	});

	it("should collect chapters sorted and deduplicated by number", () => {
		const info = parseBookPage(BOOK_FIXTURE, "ivan-sergejevich-turgenev/faust");
		expect(info.chapters.map((c) => c.n)).toEqual([1, 2]);
		expect(info.chapters[0]).toEqual({
			n: 1,
			name: "Titelseite",
			url: chapterUrl("ivan-sergejevich-turgenev/faust", 1),
		});
		expect(info.chapters[1]?.name).toBe("Der zweite Brief");
	});

	it("should strip the numbering prefix from chapter names", () => {
		expect(cleanChapterName("10. Kapitel 10", 10)).toBe("Kapitel 10");
		expect(cleanChapterName("Titelseite", 1)).toBe("Titelseite");
		expect(cleanChapterName("", 3)).toBe("Kapitel 3");
	});
});

describe("chapter pages", () => {
	it("should keep verse line breaks and clean entities", () => {
		expect(
			paragraphText(
				"Still sind die Pl&auml;tze,<br /> nur<br /> die Stra&szlig;en.",
			),
		).toBe("Still sind die Plätze,\nnur\ndie Straßen.");
		expect(paragraphText("<p></p>")).toBe("");
	});

	it("should classify drama markup: speakers bold, directions italic", () => {
		// Structure verified live on Grabbe's "Don Juan und Faust".
		const html =
			"<h4>Erste Szene</h4>" +
			'<p class="scene">Rom. Gegend des spanischen Platzes.</p>' +
			'<p class="center"><span class="regie">Don Juan tritt auf, gleich nachher Leporello.</span></p>' +
			'<p><span class="speaker">Don Juan</span>. Still sind die Pl&auml;tze und die Stra&szlig;en,<br /> nur<br /> Springbrunnen pl&auml;tschern.</p>' +
			"<p></p>";
		expect(chapterParagraphs(html)).toEqual([
			{ content: "Erste Szene", style: "bold" },
			{ content: "Rom. Gegend des spanischen Platzes.", style: "italic" },
			{
				content: "Don Juan tritt auf, gleich nachher Leporello.",
				style: "italic",
			},
			// The speaker name becomes its own bold line…
			{ content: "Don Juan.", style: "bold" },
			// …while the verse itself stays unstyled (with verse line breaks).
			{
				content:
					"Still sind die Plätze und die Straßen,\nnur\nSpringbrunnen plätschern.",
				style: null,
			},
		]);
	});

	it("should parse the chapter heading and skip the duplicated reading-mode block", () => {
		const body = `
		<h2 class="book-reader__chapter-heading">Titelseite</h2>
		<div class="book-reader__chapter-content-wrapper">
		<h2 class="title">Faust.<br />Erz&auml;hlung in neun Briefen</h2>
		<p class="center">Deutsch von Friedrich von Bodenstedt</p>
		</div>
		<div class="book-reader__reading-mode" aria-hidden="true">
		<div class="book-reader__chapter-content-wrapper">
		<p>Dupliziert und zu &uuml;berspringen.</p>
		</div>
		</div>`;
		const paragraphs = parseChapter(body);
		expect(paragraphs).toEqual([
			{ content: "Titelseite", style: "bold" },
			{ content: "Faust.\nErzählung in neun Briefen", style: "bold" },
			{ content: "Deutsch von Friedrich von Bodenstedt", style: null },
		]);
		expect(paragraphs.some((p) => p.content.includes("Dupliziert"))).toBe(
			false,
		);
	});
});

// -- Live flow through the built extension ----------------------------------

describe("Extension", () => {
	it("should start as a German book source", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Book");
		expect(data.lang).toContain("de");
	}, 120_000);

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"projekt-gutenberg.org",
					"www.projekt-gutenberg.org",
				]),
			);
		}
	});

	it("should browse the newest additions", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.id.uid).toContain("/");
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate into the A–Z catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should search for faust", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "faust");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(false);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("faust"))).toBe(true);
		await assertValidEntries(result.content);
		searchResult = result.content;
	}, 120_000);

	it("should return no results for an empty search", async () => {
		const empty = await extension!.search(0, "   ");
		expect(empty.content.length).toBe(0);
		expect(empty.hasnext).toBe(false);
	});

	it("should detail the first search hit and echo settings", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (searchResult.length === 0) throw new Error("No search result");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail(searchResult[0]!.id, { probe });
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.language).toBe("de");
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBeGreaterThanOrEqual(1);
		expect(
			result.entry.url.startsWith("https://projekt-gutenberg.org/authors/"),
		).toBe(true);
		// The detail UI carries the mandatory private-use note.
		expect(JSON.stringify(result.entry.ui)).toContain("privaten Gebrauch");
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 120_000);

	it("should detail a known chaptered book with sorted episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail(
			{ uid: "ivan-sergejevich-turgenev/faust" },
			{},
		);
		const entry = result.entry;
		expect(entry.titles[0]).toBe("Faust");
		expect(entry.author?.some((a) => a.includes("Turgenev"))).toBe(true);
		expect(entry.episodes.length).toBe(10);
		expect(entry.episodes[0]!.name).toBe("Titelseite");
		expect(entry.episodes[0]!.id.uid).toBe("ivan-sergejevich-turgenev/faust#1");
		expect(entry.meta?.Verlag).toBe("Manesse Verlag");
		await assertValidEntry(entry);
	}, 120_000);

	it("should source a chapter as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(0);
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 120_000);

	it("should source prose with umlauts, headings and speaker styles", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{
				uid: episodeUid("ivan-sergejevich-turgenev/faust", 3),
				iddata: JSON.stringify({
					book: "ivan-sergejevich-turgenev/faust",
					n: 3,
				}),
			},
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		// Umlaut entities decoded, real prose present.
		expect(texts.some((t) => t.includes("wichtige Neuigkeit"))).toBe(true);
		// The chapter heading leads as a bold paragraph. (The host expands
		// TextStyle with null keys, so assert field-wise.)
		const heading = result.source.paragraphs[0];
		expect(heading?.type).toBe("Text");
		if (heading?.type === "Text") {
			expect(heading.content).toBe("Kapitel 3");
			expect(heading.style?.bold).toBe(true);
			expect(heading.style?.italic).toBeFalsy();
		}
		await assertValidSource(result.source);
	}, 120_000);

	it("should resolve episodes from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: episodeUid("ivan-sergejevich-turgenev/faust", 1) },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(0);
	}, 120_000);
});
