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
	Episode,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	chapterName,
	cleanParagraphText,
	decodeEntities,
	extractAuthor,
	extractVersionsLink,
	findCoverUrl,
	firstParagraphText,
	makeEpubUid,
	makeIdData,
	makeUid,
	naturalCompare,
	parseIdData,
	parseUid,
	stripHtml,
	wikiUrl,
	wsExportUrl,
} from "./wikisource.ts";

let extension: Extension;

let browseResult: Entry[];
let browseDetail: EntryDetailedResult;

// A trimmed excerpt of a real "versions of" page render (header sister links
// first, then the versions list) — see extractVersionsLink.
const VERSIONS_HTML = `
<div class="mw-parser-output">
<ul class="plainSister"><li class="sisitem"><a href="/wiki/Portal:Portals">related portals</a>:
<a href="/wiki/Portal:Mystery">Mystery</a></li>
<li class="sisitem"><a href="/wiki/Author:Arthur_Conan_Doyle">Arthur Conan Doyle</a></li></ul>
<div class="subNote"><span id="nofooter">Versions of <b><i>A Scandal in Bohemia</i></b> include:</span></div>
<ul><li>"<a href="/wiki/The_Strand_Magazine/Volume_2/Issue_7/A_Scandal_in_Bohemia">A Scandal in Bohemia</a>",
as originally published in <a href="/wiki/The_Strand_Magazine">The Strand Magazine</a> (1891)</li>
<li>"<a class="new" href="/w/index.php?title=Foo">missing</a>"</li></ul>
<p>To Sherlock Holmes she is always <i>the woman</i>.</p>
</div>`;

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
		expect(decodeEntities("&nbsp;&mdash;&hellip;")).toBe(" —…");
		expect(decodeEntities("caf&#233;")).toBe("café");
	});

	it("should strip tags, style blocks and comments from html", () => {
		expect(
			stripHtml(
				"<p><style>.mw-parser-output .x{color:red}</style>Hello <b>world</b>!</p><!-- c -->",
			),
		).toBe("Hello world!");
		expect(stripHtml('<span class="searchmatch">Sherlock</span> Holmes')).toBe(
			"Sherlock Holmes",
		);
	});

	it("should normalise nbsp and zero-width characters", () => {
		expect(cleanParagraphText("To\u00a0be\u200b or\u200e not ")).toBe(
			"To be or not",
		);
	});

	it("should naturally sort chapter titles", () => {
		const sorted = ["Book/Chapter 10", "Book/Chapter 2", "Book/Chapter 1"].sort(
			naturalCompare,
		);
		expect(sorted).toEqual([
			"Book/Chapter 1",
			"Book/Chapter 2",
			"Book/Chapter 10",
		]);
	});

	it("should strip the book prefix from chapter names", () => {
		expect(chapterName("Book/Chapter 1", "Book")).toBe("Chapter 1");
		expect(chapterName("Other/Chapter 1", "Book")).toBe("Other/Chapter 1");
	});
});

describe("id helpers", () => {
	it("should round-trip entry uids", () => {
		expect(parseUid(makeUid("fr", "L'Avare"))).toEqual({
			lang: "fr",
			title: "L'Avare",
			epub: false,
		});
		expect(
			parseUid(makeUid("en", "The Return of Sherlock Holmes/Chapter 1")),
		).toEqual({
			lang: "en",
			title: "The Return of Sherlock Holmes/Chapter 1",
			epub: false,
		});
	});

	it("should mark full-book epub uids", () => {
		expect(parseUid(makeEpubUid("en", "Annabel Lee"))).toEqual({
			lang: "en",
			title: "Annabel Lee",
			epub: true,
		});
	});

	it("should round-trip iddata and reject malformed payloads", () => {
		const data = { lang: "de", title: "Faust", snippet: "<b>Faust</b>" };
		expect(parseIdData(makeIdData(data))).toEqual({ ...data, epub: false });
		expect(parseIdData(undefined)).toBeNull();
		expect(parseIdData("not json")).toBeNull();
		expect(parseIdData('{"lang":"en"}')).toBeNull();
	});
});

describe("url helpers", () => {
	it("should build on-wiki urls with underscored, encoded titles", () => {
		// encodeURIComponent leaves sub-delims like ' ( ) as-is, which is valid.
		expect(wikiUrl("en", "Alice's Adventures in Wonderland (1866)")).toBe(
			"https://en.wikisource.org/wiki/Alice's_Adventures_in_Wonderland_(1866)",
		);
	});

	it("should build ws-export epub urls in the sidebar link format", () => {
		expect(wsExportUrl("en", "The Return of Sherlock Holmes")).toBe(
			"https://ws-export.wmcloud.org/?format=epub&lang=en&page=The_Return_of_Sherlock_Holmes",
		);
	});
});

describe("html scanning helpers", () => {
	it("should extract the author from the ws-data block", () => {
		expect(
			extractAuthor(
				'<div id="ws-data"><span id="ws-title">X</span><span id="ws-author">Arthur&#160;Conan Doyle</span></div>',
			),
		).toBe("Arthur Conan Doyle");
		expect(extractAuthor("<p>no header here</p>")).toBeNull();
	});

	it("should pick the first sizeable illustration as cover and skip icons", () => {
		const html = `
<img alt="Sister Projects" src="//thumb.wikimedia.org/Wikimedia-logo.svg/20px-x.png?utm_source=e" width="20" height="20">
<img src="//thumb.wikimedia.org/6/62/PD-icon.svg/60px-x.png" width="60">
<img src="//thumb.wikimedia.org/commons/6/6d/Alice_frontispiece-937x1333.jpg/500px-Alice_frontispiece-937x1333.jpg?utm_source=en.wikisource.org" width="300">`;
		expect(findCoverUrl(html)).toBe(
			"https://thumb.wikimedia.org/commons/6/6d/Alice_frontispiece-937x1333.jpg/500px-Alice_frontispiece-937x1333.jpg",
		);
	});

	it("should fall back to the thumbnail size in the file path", () => {
		expect(
			findCoverUrl(
				'<img src="//upload.wikimedia.org/x/a/Scan.jpg/400px-Scan.jpg">',
			),
		).toBe("https://upload.wikimedia.org/x/a/Scan.jpg/400px-Scan.jpg");
		expect(findCoverUrl('<img src="//x/20px-tiny.png" width="20">')).toBeNull();
	});

	it("should find the first readable work link on a versions page", () => {
		expect(extractVersionsLink(VERSIONS_HTML)).toBe(
			"The Strand Magazine/Volume 2/Issue 7/A Scandal in Bohemia",
		);
	});

	it("should use the first substantial paragraph as description", () => {
		const html = `<p class="plainSister searchaux">related portals: Mystery</p>
<p>Too short.</p>
<p>To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex.</p>`;
		const text = firstParagraphText(html);
		expect(text).toStartWith("To Sherlock Holmes she is always the woman.");
		expect(firstParagraphText("<div><p>tiny</p></div>")).toBe("");
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

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"en.wikisource.org",
					"de.wikisource.org",
					"zh.wikisource.org",
					"ws-export.wmcloud.org",
				]),
			);
		}
	});

	it("should browse featured texts", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.id.uid.startsWith("en|")).toBe(true);
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate browse results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should search for works", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "Sherlock Holmes");
		expect(result.content.length).toBeGreaterThan(0);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("sherlock"))).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should detail the first browsed work", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult.length === 0) throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.language).toBe("en");
		expect(result.entry.status).toBe("Complete");
		expect(result.entry.description.length).toBeGreaterThan(0);
		// At least one reading episode plus the full-book EPUB episode.
		expect(result.entry.episodes.length).toBeGreaterThanOrEqual(2);
		const last = result.entry.episodes[result.entry.episodes.length - 1]!;
		expect(last.name).toBe("Full book (EPUB)");
		if (result.entry.cover != null) {
			expect(result.entry.cover.url.startsWith("https://")).toBe(true);
		}
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		browseDetail = result;
	}, 120_000);

	it("should source the first episode of the browsed work", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseDetail === undefined) throw new Error("No detail result");
		const episode = browseDetail.entry.episodes[0]!;
		const result = await extension!.source(episode.id, browseDetail.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(0);
		await assertValidSource(result.source);
	}, 120_000);

	it("should detail a chaptered book with naturally sorted chapters", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail(
			{ uid: makeUid("en", "The Return of Sherlock Holmes") },
			{},
		);
		const entry = result.entry;
		expect(entry.titles[0]).toBe("The Return of Sherlock Holmes");
		expect(entry.author?.[0]).toBe("Arthur Conan Doyle");
		expect(entry.episodes.length).toBe(14); // 13 chapters + full book
		expect(entry.episodes[0]!.name).toBe("Chapter 1");
		const names = entry.episodes.map((e) => e.name);
		expect(names.indexOf("Chapter 2")).toBeLessThan(
			names.indexOf("Chapter 10"),
		);
		expect(names[names.length - 1]).toBe("Full book (EPUB)");
		expect(entry.cover?.url.startsWith("https://")).toBe(true);
		await assertValidEntry(entry);
	}, 120_000);

	it("should source a chapter as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{
				uid: makeUid("en", "The Return of Sherlock Holmes/Chapter 1"),
				iddata: makeIdData({
					lang: "en",
					title: "The Return of Sherlock Holmes/Chapter 1",
				}),
			},
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
		const texts = result.source.paragraphs.filter(
			(p) => p.type === "Text" && p.content.length > 0,
		);
		expect(texts.length).toBeGreaterThan(5);
		expect(result.settings).toEqual({});
		await assertValidSource(result.source);
	}, 120_000);

	it("should source the full book as a ws-export epub link", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{
				uid: makeEpubUid("en", "The Return of Sherlock Holmes"),
				iddata: makeIdData({
					lang: "en",
					title: "The Return of Sherlock Holmes",
					epub: true,
				}),
			},
			{},
		);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toBe(
			wsExportUrl("en", "The Return of Sherlock Holmes"),
		);
		expect(result.source.link.url).toContain(
			"page=The_Return_of_Sherlock_Holmes",
		);
	}, 120_000);

	it("should follow versions pages to readable text", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// The chapter subpage redirects to a "Versions of …" page whose first
		// work link (the Strand Magazine printing) must be followed.
		const detail = await extension!.detail(
			{ uid: makeUid("en", "The Adventures of Sherlock Holmes") },
			{},
		);
		const scandal: Episode | undefined = detail.entry.episodes.find(
			(e) => e.name === "A Scandal in Bohemia",
		);
		expect(scandal).toBeDefined();
		if (scandal === undefined) throw new Error("Chapter not found");
		const result = await extension!.source(scandal.id, detail.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
	}, 120_000);

	it("should resolve episodes from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: makeUid("en", "The Return of Sherlock Holmes/Chapter 2") },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
	}, 120_000);
});
