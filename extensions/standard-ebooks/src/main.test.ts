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
	EntryDetailedResult,
	Setting,
	SettingValue,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	BASE,
	FORMAT_ADVANCED,
	FORMAT_COMPATIBLE,
	FORMAT_SETTING_ID,
	bookPathToUid,
	coverUrl,
	decodeEntities,
	fallbackEpubUrl,
	formatCount,
	hasNextPage,
	parseBookPage,
	parseEpubCandidates,
	parseListing,
	pickEpubHref,
	withDownloadParam,
} from "./site.ts";

let extension: Extension;
let detailResult: EntryDetailedResult;

function formatSettings(value: string): Record<string, Setting> {
	return {
		[FORMAT_SETTING_ID]: {
			label: "EPUB variant",
			value: { type: "String", data: value } as SettingValue,
			default: { type: "String", data: FORMAT_COMPATIBLE } as SettingValue,
			visible: true,
			ui: null,
		},
	};
}

// ---------------------------------------------------------------------------
// Inline fixtures modelled on the real site markup (schema.org microdata)
// ---------------------------------------------------------------------------

const LISTING_FIXTURE = `<ol class="ebooks-list list">
	<li typeof="schema:Book" about="/ebooks/jane-austen/pride-and-prejudice">
		<div class="thumbnail-container" aria-hidden="true">
			<a href="/ebooks/jane-austen/pride-and-prejudice"><picture>
				<img src="/images/covers/jane-austen_pride-and-prejudice/495d/cover@2x.jpg" property="schema:image"/>
			</picture></a>
		</div>
		<p><a href="/ebooks/jane-austen/pride-and-prejudice" property="schema:url"><span property="schema:name">Pride and Prejudice</span></a></p>
		<div><p class="author"><a href="/ebooks/jane-austen">Jane Austen</a></p></div>
		<div class="details">
			<p>121,970 words &#8226; 60.95 reading ease</p>
			<ul class="tags"><li><a href="/subjects/fiction">Fiction</a></li></ul>
		</div>
	</li>
	<li typeof="schema:Book" about="/ebooks/thomas-mann/short-fiction/various-translators">
		<div class="thumbnail-container" aria-hidden="true">
			<a href="/ebooks/thomas-mann/short-fiction/various-translators"><picture>
				<img src="/images/covers/thomas-mann_short-fiction_various-translators/cb6b/cover@2x.jpg" property="schema:image"/>
			</picture></a>
		</div>
		<p><a href="/ebooks/thomas-mann/short-fiction/various-translators" property="schema:url"><span property="schema:name">Short Fiction</span></a></p>
		<div>
			<p class="author"><a href="/ebooks/thomas-mann">Thomas Mann</a></p>
		</div>
		<div class="details">
			<div><p>Translated by <a href="https://en.wikipedia.org/wiki/Kenneth_Burke">Kenneth Burke</a>, and <a href="https://en.wikipedia.org/wiki/Helen_Tracy_Lowe-Porter">H. T. Lowe-Porter</a>.</p></div>
			<p>176,704 words &#8226; 65.76 reading ease</p>
			<ul class="tags">
				<li><a href="/subjects/fiction">Fiction</a></li>
				<li><a href="/subjects/shorts">Shorts</a></li>
			</ul>
		</div>
	</li>
</ol>
<nav class="pagination" aria-label="Pagination">
	<a aria-disabled="true">Back</a>
	<ol>
		<li><a aria-current="page" href="#">1</a></li>
		<li><a href="/ebooks?page=2&amp;view=list">2</a></li>
	</ol>
</nav>`;

const BOOK_FIXTURE = `<article class="ebook" typeof="schema:Book" about="/ebooks/jane-austen/pride-and-prejudice">
	<meta property="schema:abstract" content="A Regency-era novel of manners in which five women try to adjust to their new neighbor, an eligible gentleman."/>
	<meta property="schema:url" content="https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice"/>
	<meta property="schema:sameAs" content="https://en.wikipedia.org/wiki/Pride_and_prejudice"/>
	<header><hgroup>
		<h1 property="schema:name">Pride and Prejudice</h1>
		<p><a property="schema:author" typeof="schema:Person" href="/ebooks/jane-austen">
			<span property="schema:name">Jane Austen</span>
		</a></p>
	</hgroup></header>
	<aside id="reading-ease">
		<meta property="schema:wordCount" content="121970"/>
		<p>121,970 words (7 hours 24 minutes) with a reading ease of 60.95 (average difficulty)</p>
		<p>Part of the <a href="/collections/harvard-classics" property="schema:isPartOf">Harvard Classics Shelf of Fiction</a> set.</p>
		<ul class="tags"><li><a href="/subjects/fiction">Fiction</a></li></ul>
	</aside>
	<section id="description"><h2>Description</h2>
		<div property="schema:description"><p><i>Pride and Prejudice</i> may today be one of <a href="https://standardebooks.org/ebooks/jane-austen">Jane Austen&#8217;s</a> most enduring novels, since its publication in 1813.</p></div>
	</section>
	<section id="read-free">
		<meta property="schema:inLanguage" content="en-GB"/>
		<meta property="schema:datePublished" content="2014-05-25"/>
		<section id="download"><ul>
			<li><a property="schema:contentUrl" href="/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub" class="epub">Compatible epub</a></li>
			<li><a property="schema:contentUrl" href="/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.azw3" class="amazon">azw3</a></li>
			<li><a property="schema:contentUrl" href="/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.kepub.epub" class="kobo">kepub</a></li>
			<li><a property="schema:contentUrl" href="/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice_advanced.epub" class="epub">Advanced epub</a></li>
		</ul></section>
	</section>
</article>`;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
});

describe("site helpers", () => {
	it("should extract book uids from paths and urls", () => {
		expect(bookPathToUid("/ebooks/jane-austen/pride-and-prejudice")).toBe(
			"jane-austen/pride-and-prejudice",
		);
		expect(
			bookPathToUid(
				"https://standardebooks.org/ebooks/thomas-mann/short-fiction/various-translators",
			),
		).toBe("thomas-mann/short-fiction/various-translators");
		expect(bookPathToUid("/ebooks")).toBeNull();
		expect(bookPathToUid("/ebooks/")).toBeNull();
		expect(bookPathToUid("/authors")).toBeNull();
	});

	it("should decode html entities", () => {
		expect(decodeEntities("Pride &amp; Prejudice")).toBe("Pride & Prejudice");
		expect(decodeEntities("Jane&#8217;s")).toBe("Jane’s");
		expect(decodeEntities("A&#x2014;B")).toBe("A—B");
		expect(decodeEntities("&mdash;&hellip;&quot;")).toBe('—…"');
		expect(decodeEntities("&unknownentity;")).toBe("&unknownentity;");
	});

	it("should parse a listing page", () => {
		const books = parseListing(LISTING_FIXTURE);
		expect(books.length).toBe(2);
		expect(books[0]).toEqual({
			uid: "jane-austen/pride-and-prejudice",
			title: "Pride and Prejudice",
			authors: ["Jane Austen"],
			translators: [],
			wordCount: 121970,
			subjects: ["Fiction"],
		});
		expect(books[1]!.uid).toBe("thomas-mann/short-fiction/various-translators");
		expect(books[1]!.authors).toEqual(["Thomas Mann"]);
		expect(books[1]!.translators).toEqual([
			"Kenneth Burke",
			"H. T. Lowe-Porter",
		]);
		expect(books[1]!.wordCount).toBe(176704);
		expect(books[1]!.subjects).toEqual(["Fiction", "Shorts"]);
	});

	it("should detect the next page from pagination links", () => {
		expect(hasNextPage(LISTING_FIXTURE, 0)).toBe(true);
		expect(hasNextPage(LISTING_FIXTURE, 1)).toBe(false);
	});

	it("should parse a book page", () => {
		const info = parseBookPage(BOOK_FIXTURE);
		expect(info.uid).toBe("jane-austen/pride-and-prejudice");
		expect(info.title).toBe("Pride and Prejudice");
		expect(info.authors).toEqual(["Jane Austen"]);
		expect(info.language).toBe("en-GB");
		expect(info.wordCount).toBe(121970);
		expect(info.readingTime).toBe("7 hours 24 minutes");
		expect(info.readingEase).toBe("60.95 (average difficulty)");
		expect(info.subjects).toEqual(["Fiction"]);
		expect(info.collections).toEqual(["Harvard Classics Shelf of Fiction"]);
		expect(info.wikipedia).toBe(
			"https://en.wikipedia.org/wiki/Pride_and_prejudice",
		);
		expect(info.released).toBe("2014-05-25");
		expect(info.epub.compatible).toBe(
			"/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub",
		);
		expect(info.epub.advanced).toBe(
			"/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice_advanced.epub",
		);
		expect(info.azw3).toContain(".azw3");
		expect(info.kepub).toContain(".kepub.epub");
		expect(info.description).toContain("Pride and Prejudice");
		expect(info.description).toContain("Jane Austen’s");
		expect(info.description).not.toContain("<");
	});

	it("should parse and pick epub candidates", () => {
		expect(parseEpubCandidates(undefined)).toBeNull();
		expect(parseEpubCandidates("not json")).toBeNull();
		expect(
			parseEpubCandidates(
				JSON.stringify({ compatible: "/a.epub", advanced: "" }),
			),
		).toEqual({ compatible: "/a.epub", advanced: null });
		const candidates = parseEpubCandidates(
			JSON.stringify({ compatible: "/a.epub", advanced: "/a_advanced.epub" }),
		)!;
		expect(pickEpubHref(candidates, FORMAT_COMPATIBLE)).toBe("/a.epub");
		expect(pickEpubHref(candidates, FORMAT_ADVANCED)).toBe("/a_advanced.epub");
		expect(
			pickEpubHref(
				{ compatible: null, advanced: "/a_advanced.epub" },
				FORMAT_COMPATIBLE,
			),
		).toBe("/a_advanced.epub");
		expect(
			pickEpubHref({ compatible: null, advanced: null }, FORMAT_COMPATIBLE),
		).toBeNull();
	});

	it("should build download and cover urls", () => {
		expect(
			withDownloadParam(
				"/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub",
			),
		).toBe(
			`${BASE}/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download`,
		);
		expect(fallbackEpubUrl("jane-austen/pride-and-prejudice")).toBe(
			`${BASE}/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download`,
		);
		expect(
			fallbackEpubUrl("thomas-mann/short-fiction/various-translators"),
		).toContain(
			"/downloads/thomas-mann_short-fiction_various-translators.epub",
		);
		expect(coverUrl("jane-austen/pride-and-prejudice")).toBe(
			`${BASE}/ebooks/jane-austen/pride-and-prejudice/downloads/cover.jpg`,
		);
		expect(formatCount(121970)).toBe("121,970");
		expect(formatCount(42)).toBe("42");
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
				expect.arrayContaining(["standardebooks.org"]),
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
		expect(result.content[0]!.cover?.url).toContain("/downloads/cover.jpg");
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

	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "pride");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("pride"))).toBe(true);
	});

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail(
			{ uid: "jane-austen/pride-and-prejudice" },
			{},
		);
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.titles[0]).toBe("Pride and Prejudice");
		expect(entry.author?.[0]).toContain("Austen");
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.language).toBe("en-GB");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.genres?.length).toBeGreaterThan(0);
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Pride and Prejudice");
		expect(entry.meta?.Translators).toBeUndefined();
		expect(entry.meta?.Words).toMatch(/^[\d,]+$/);
		expect(entry.meta?.["Reading time"]).toContain("hour");
		expect(entry.meta?.["Reading ease"]).toContain("(");
		// The per-entry format setting is defined on first detail.
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		// The epub download candidates ride along in the episode iddata.
		const candidates = parseEpubCandidates(entry.episodes[0]!.id.iddata);
		expect(candidates?.compatible).toContain(".epub");
		expect(candidates?.advanced).toContain("_advanced.epub");
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
			"/downloads/jane-austen_pride-and-prejudice.epub?source=download",
		);
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		await assertValidSource(result.source);
	});

	it("should honor the advanced format setting", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			formatSettings(FORMAT_ADVANCED),
		);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toContain(
			"/downloads/jane-austen_pride-and-prejudice_advanced.epub?source=download",
		);
		expect(result.settings[FORMAT_SETTING_ID]).toBeDefined();
	});

	it("should fall back to a constructed epub url without iddata", async () => {
		const result = await extension!.source(
			{ uid: "jane-austen/pride-and-prejudice" },
			{},
		);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toBe(
			fallbackEpubUrl("jane-austen/pride-and-prejudice"),
		);
		await assertValidSource(result.source);
	});
});
