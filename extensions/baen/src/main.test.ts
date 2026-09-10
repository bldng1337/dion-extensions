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
	Paragraph,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	chapterFileUrl,
	chaptersUrl,
	cleanText,
	coverPageUrl,
	decodeEntities,
	fileNameFor,
	isChapterFileName,
	isNavText,
	makeEpisodeIdData,
	makeEpisodeUid,
	parseCatalog,
	parseCoverMeta,
	parseEpisodeIdData,
	parseEpisodeUid,
	parseLastPgCount,
	parseTocEntries,
	type TocEntry,
	stripHtml,
} from "./baen.ts";

let extension: Extension;

let browseResult: Entry[];
let browseDetail: EntryDetailedResult;

// Excerpts of real reader pages (1632 by Eric Flint, SKU 0671578499).
const FRAMES_HTML = `
<html><head><title>1632 by Eric Flint - Baen Books</title><script language="JavaScript"><!--
var lastPg = new Array(0,5,7,9,24,28,100,217,360,480,604,710,832,950,1002,1067,1166,1244,1289,1341,1345,1413);
//--></script></head><body></body></html>`;

const TOC_HTML = `
<html><head><meta name="author" content="Eric Flint" /></head><body>
<p style="text-align: right"><a href="0671578499__c_.htm">Back</a> | <a href="0671578499___1.htm">Next</a><br /><a href="0671578499_toc.htm">Contents</a></p>
<h1 align="center">1632</h1>
<h2 align="center">Table of Contents</h2>
<a href="0671578499___1.htm"><b>Dedication</b></a><br /><br />
<a href="0671578499___2.htm"><b>Maps</b></a><br /><br />
<a href="0671578499___4.htm"><b><b>Prologue</b></b></a><br /><br />
<a href="0671578499___5.htm"><b><b>Part One</b></b></a><br />
<div style="margin-left: 2em;"><a href="0671578499___6.htm"><b><b>Chapter 1</b></b></a><br />
<b><b>Chapter 2</b></b></a><br />
<a href="0671578499__41.htm"><b><b>Chapter 34</b></b></a><br />
</div>
</body></html>`;

const COVER_HTML = `
<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<title>1632 by Eric Flint - Baen Books</title>
<meta name="Publisher" content="Baen Books" />
<meta name="Copyright" content="© 2000 by Eric Flint" />
<meta name="author" content="Eric Flint" /></head>
<body onload="setStyle()" style="font-family:sans-serif" >
<p style="text-align: right"><a href="0671578499__c_.htm">Next</a></p>
<div style="text-align: center">
<table border="0" width="95%" cellspacing="4"><tr><td valign="top" align="left" colspan="2">
<hr /><h1 align="center">1632</h1><hr />
<h3 align="center"><img align="left" border="0" hspace="10" src="0671578499.jpg" width=150px/></h3>
<p style="text-align: center">The Ultimate Y2K Glitch....</p>
<p style="text-align: left">1632 In the year 1632 in northern Germany a reasonable person might conclude that things couldn't get much worse.</p>
<p style="text-align: center"><b>THEN, EVERYTHING CHANGED....</b></p>
<p style="text-align: left">When the dust settles, Mike leads a small group of armed miners to find out what's going on.</p>
<p style="text-align: center">Cover Art by Larry Elmore<br>Interior maps by Randy Asplund</p>
<br clear="all" /><hr />
</td></tr></table>
</div>
<p style="text-align: right"><a href="0671578499_toc.htm">Next</a></p>
</body></html>`;

const CATALOG_JSON = {
	returnCode: "single cat",
	totalBooks: 2,
	numOfBooks: 2,
	productData: [
		{
			id: "1234",
			name: "On Basilisk Station",
			sku: "0743435710",
			price: "Free Library Book",
			productUrl: "https://www.baen.com/on-basilisk-station.html",
			imageUrl: [
				"https://www.baen.com/media/catalog/product/0/7/0743435710-med.jpg",
			],
			isFree: true,
			productType: "downloadable",
		},
		{
			id: "1235",
			name: "On Basilisk Station",
			sku: "0743435710",
			productUrl: "https://www.baen.com/on-basilisk-station.html",
			imageUrl: [],
		},
		{ id: "1236", sku: "", name: "Broken" },
	],
};

function textParagraphs(paragraphs: Paragraph[]): string[] {
	return paragraphs
		.filter((p) => p.type === "Text" && p.content.length > 0)
		.map((p) => (p.type === "Text" ? p.content : ""));
}

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("text helpers", () => {
	it("should decode named and numeric entities", () => {
		expect(decodeEntities("AT&amp;T &lt;b&gt; &#39;x&#39; &#x27;y&#x27;")).toBe(
			"AT&T <b> 'x' 'y'",
		);
		expect(decodeEntities("&nbsp;&mdash;&hellip;&#8220;q&#8221;")).toBe(
			" —…“q”",
		);
		expect(stripHtml("<p>Hello <b>world</b>!</p><!-- c -->")).toBe(
			"Hello world!",
		);
	});

	it("should normalise nbsp and zero-width characters", () => {
		expect(cleanText("To\u00a0be\u200b or\u200e not ")).toBe("To be or not");
	});

	it("should detect reader navigation paragraphs", () => {
		expect(isNavText("Back | Next Contents")).toBe(true);
		expect(isNavText("Back")).toBe(true);
		expect(isNavText("Framed")).toBe(true);
		expect(isNavText("Back | Next")).toBe(true);
		expect(isNavText("Mike Stearns followed his gaze. Next morning")).toBe(
			false,
		);
		expect(isNavText("")).toBe(true);
	});
});

describe("url helpers", () => {
	it("should build the reader page urls", () => {
		expect(chaptersUrl("0671578499")).toBe(
			"https://www.baen.com/Chapters/0671578499/0671578499.htm",
		);
		expect(coverPageUrl("BB2025FS")).toBe(
			"https://www.baen.com/Chapters/BB2025FS/BB2025FS__c_.htm",
		);
		expect(chapterFileUrl("0671578499", "0671578499___6.htm")).toBe(
			"https://www.baen.com/Chapters/0671578499/0671578499___6.htm",
		);
	});

	it("should build underscore-padded chapter file names", () => {
		expect(fileNameFor("0671578499", 1)).toBe("0671578499___1.htm");
		expect(fileNameFor("0671578499", 9)).toBe("0671578499___9.htm");
		expect(fileNameFor("0671578499", 10)).toBe("0671578499__10.htm");
		expect(fileNameFor("0671578499", 100)).toBe("0671578499_100.htm");
	});

	it("should recognise chapter file names", () => {
		expect(isChapterFileName("0671578499___6.htm")).toBe(true);
		expect(isChapterFileName("BB2025FS___2.htm")).toBe(true);
		expect(isChapterFileName("0671578499__c_.htm")).toBe(true);
		expect(isChapterFileName("0671578499_toc.htm")).toBe(false);
		expect(isChapterFileName("0671578499.htm")).toBe(false);
		expect(isChapterFileName("../secret.htm")).toBe(false);
	});
});

describe("id helpers", () => {
	it("should round-trip episode ids", () => {
		expect(
			parseEpisodeUid(makeEpisodeUid("0671578499", "0671578499___6.htm")),
		).toEqual({
			sku: "0671578499",
			file: "0671578499___6.htm",
		});
		const data = { sku: "BB2025FS", file: "BB2025FS___1.htm" };
		expect(parseEpisodeIdData(makeEpisodeIdData(data.sku, data.file))).toEqual(
			data,
		);
	});

	it("should fall back to the cover page for bare uids and reject junk", () => {
		expect(parseEpisodeUid("0671578499")).toEqual({
			sku: "0671578499",
			file: "0671578499__c_.htm",
		});
		expect(parseEpisodeUid("sku|../evil.htm")).toBeNull();
		expect(parseEpisodeIdData(undefined)).toBeNull();
		expect(parseEpisodeIdData("not json")).toBeNull();
		expect(parseEpisodeIdData('{"sku":"x","file":"y_toc.htm"}')).toBeNull();
	});
});

describe("reader parsing", () => {
	it("should count readable chapter files from the frameset", () => {
		expect(parseLastPgCount(FRAMES_HTML)).toBe(22);
		expect(parseLastPgCount("<html><body>nothing</body></html>")).toBeNull();
	});

	it("should extract toc entries including href-less ones, in order", () => {
		const entries: TocEntry[] = parseTocEntries(TOC_HTML);
		expect(entries.length).toBe(7);
		expect(entries[0]).toEqual({
			file: "0671578499___1.htm",
			number: 1,
			name: "Dedication",
			byline: null,
		});
		expect(entries[2]?.name).toBe("Prologue");
		// The broken entry without an opening <a href> tag.
		expect(entries[5]).toEqual({
			file: null,
			number: null,
			name: "Chapter 2",
			byline: null,
		});
		// A link pointing beyond the hosted preview range.
		expect(entries[6]?.file).toBe("0671578499__41.htm");
		expect(entries[6]?.number).toBe(41);
	});

	it("should capture bylines after the title link", () => {
		const entries = parseTocEntries(
			'<a href="BB2025FS___1.htm"><b>Skjaldm&#243;&#240;ir</b></a> by Michael Z. Williamson and Jessica Schlenker<br />',
		);
		expect(entries.length).toBe(1);
		expect(entries[0]?.name).toBe("Skjaldmóðir");
		expect(entries[0]?.byline).toBe(
			"Michael Z. Williamson and Jessica Schlenker",
		);
	});

	it("should extract title, author and blurb from the cover page", () => {
		const meta = parseCoverMeta(COVER_HTML);
		expect(meta.title).toBe("1632");
		expect(meta.author).toBe("Eric Flint");
		expect(meta.copyright).toBe("© 2000 by Eric Flint");
		expect(meta.blurb).toStartWith("The Ultimate Y2K Glitch....");
		expect(meta.blurb).toContain("THEN, EVERYTHING CHANGED....");
		expect(meta.blurb).not.toContain("Back |");
	});

	it("should parse the catalog json and dedupe by sku", () => {
		const books = parseCatalog(CATALOG_JSON);
		expect(books.length).toBe(1);
		expect(books[0]).toEqual({
			sku: "0743435710",
			name: "On Basilisk Station",
			url: "https://www.baen.com/on-basilisk-station.html",
			cover:
				"https://www.baen.com/media/catalog/product/0/7/0743435710-med.jpg",
		});
		expect(parseCatalog({ productData: "junk" })).toEqual([]);
		expect(parseCatalog(null)).toEqual([]);
	});
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Book");
	}, 120_000);

	it("should declare its network permission", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(["www.baen.com"]);
		}
	});

	it("should browse the free library", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		const first = result.content[0]!;
		expect(first.media_type).toBe("Book");
		expect(first.id.uid.length).toBeGreaterThan(0);
		expect(first.title.length).toBeGreaterThan(0);
		if (first.cover != null) {
			expect(first.cover.url.startsWith("https://")).toBe(true);
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate browse results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		for (const uid of ids1) {
			expect(ids0).not.toContain(uid);
		}
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should search by title", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "basilisk");
		expect(result.content.length).toBeGreaterThan(0);
		expect(
			result.content.some((e) => e.title.includes("On Basilisk Station")),
		).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should detail 1632 with open chapters", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "0671578499" }, {});
		const entry = result.entry;
		expect(entry.media_type).toBe("Book");
		expect(entry.titles[0]).toBe("1632");
		expect(entry.author?.[0]).toBe("Eric Flint");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.status).toBe("Complete");
		expect(entry.language).toBe("en");
		expect(entry.cover?.url.startsWith("https://")).toBe(true);
		// The open web reader hosts the front chapters of the book.
		expect(entry.episodes.length).toBeGreaterThanOrEqual(5);
		expect(entry.episodes.map((e) => e.name)).toContain("Chapter 1");
		// UI links (site page + web reader) instead of login-gated downloads.
		expect(entry.ui).toBeDefined();
		expect(result.settings).toEqual({});
		await assertValidEntry(entry);
		browseDetail = result;
	}, 120_000);

	it("should source a chapter as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseDetail === undefined) throw new Error("No detail result");
		const episode = browseDetail.entry.episodes.find(
			(e) => e.name === "Chapter 1",
		);
		expect(episode).toBeDefined();
		if (episode === undefined) throw new Error("Chapter 1 not found");
		const result = await extension!.source(episode.id, browseDetail.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		const texts = textParagraphs(result.source.paragraphs);
		expect(texts.length).toBeGreaterThan(5);
		expect(texts.some((t) => t.includes("Mike Stearns"))).toBe(true);
		// The chapter heading is rendered as a bold paragraph, nav as none.
		expect(texts[0]).toBe("Chapter 1");
		expect(result.settings).toEqual({});
		await assertValidSource(result.source);
	}, 120_000);

	it("should resolve episodes from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: makeEpisodeUid("0671578499", "0671578499___6.htm") },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(textParagraphs(result.source.paragraphs).length).toBeGreaterThan(5);
		await assertValidSource(result.source);
	}, 120_000);

	it("should search by author once a book was opened", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "eric flint");
		expect(result.content.some((e) => e.id.uid === "0671578499")).toBe(true);
	}, 120_000);
});
