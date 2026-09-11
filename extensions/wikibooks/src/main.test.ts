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
	apiUrl,
	chapterName,
	cleanParagraphText,
	collectParagraphs,
	decodeEntities,
	findCoverUrl,
	firstParagraphText,
	type ElementLike,
	makeIdData,
	makeUid,
	naturalCompare,
	parseIdData,
	parseNamespaceMap,
	parseUid,
	splitTitleNamespace,
	stripEditAndCiteMarkers,
	stripHtml,
	type NamespacesResponse,
	wikiUrl,
} from "./wikibooks.ts";

let extension: Extension;

let browseResult: Entry[];
let browseDetail: EntryDetailedResult;

// A minimal stand-in for the runtime's parsed DOM elements so the
// HTML->paragraph walker can be exercised under plain bun.
class FakeEl implements ElementLike {
	name: string;
	private attrs: Record<string, string>;
	private kids: (FakeEl | string)[];

	constructor(
		name: string,
		attrs: Record<string, string>,
		kids: (FakeEl | string)[],
	) {
		this.name = name;
		this.attrs = attrs;
		this.kids = kids;
	}

	get text(): string {
		return this.kids
			.map((kid) => (typeof kid === "string" ? kid : kid.text))
			.join("");
	}

	attr(name: string): string {
		return this.attrs[name] ?? "";
	}

	get children(): {
		length: number;
		get(index: number): ElementLike | undefined;
	} {
		return {
			length: this.kids.length,
			get: (index: number): ElementLike | undefined => {
				const kid = this.kids[index];
				return typeof kid === "string" ? undefined : kid;
			},
		};
	}
}

function el(
	name: string,
	attrs: Record<string, string>,
	...kids: (FakeEl | string)[]
): FakeEl {
	return new FakeEl(name, attrs, kids);
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
		expect(decodeEntities("&nbsp;&mdash;&hellip;")).toBe(" —…");
		expect(decodeEntities("caf&#233;")).toBe("café");
	});

	it("should strip tags, style blocks and comments from html", () => {
		expect(
			stripHtml(
				"<p><style>.mw-parser-output .x{color:red}</style>Hello <b>world</b>!</p><!-- c -->",
			),
		).toBe("Hello world!");
		expect(stripHtml('<span class="searchmatch">Cookbook</span> recipes')).toBe(
			"Cookbook recipes",
		);
	});

	it("should normalise nbsp and zero-width characters", () => {
		expect(cleanParagraphText("Earth\u00a0facts\u200b or\u200e not ")).toBe(
			"Earth facts or not",
		);
	});

	it("should remove [edit] markers and citation superscripts", () => {
		expect(stripEditAndCiteMarkers("Earth Facts[edit]")).toBe("Earth Facts");
		expect(stripEditAndCiteMarkers("Water covers most of it.[12]")).toBe(
			"Water covers most of it.",
		);
		expect(stripEditAndCiteMarkers("Plain [b] brackets stay")).toBe(
			"Plain [b] brackets stay",
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
		expect(chapterName("Ada Programming/Chapter 1", "Ada Programming")).toBe(
			"Chapter 1",
		);
		expect(
			chapterName("Wikijunior:Solar System/Earth", "Wikijunior:Solar System"),
		).toBe("Earth");
		expect(chapterName("Other/Chapter 1", "Book")).toBe("Other/Chapter 1");
	});
});

describe("id helpers", () => {
	it("should round-trip entry uids, including colon titles", () => {
		expect(parseUid(makeUid("fr", "L'Avare"))).toEqual({
			lang: "fr",
			title: "L'Avare",
		});
		expect(parseUid(makeUid("en", "Wikijunior:Solar System/Earth"))).toEqual({
			lang: "en",
			title: "Wikijunior:Solar System/Earth",
		});
		expect(parseUid("nolang")).toEqual({ lang: "en", title: "" });
	});

	it("should round-trip iddata and reject malformed payloads", () => {
		const data = { lang: "de", title: "Deutsch als Fremdsprache" };
		expect(parseIdData(makeIdData(data))).toEqual(data);
		const withSnippet = {
			lang: "en",
			title: "Coding Cookbook",
			snippet: "a <b>cookbook</b>",
		};
		expect(parseIdData(makeIdData(withSnippet))).toEqual(withSnippet);
		expect(parseIdData(undefined)).toBeNull();
		expect(parseIdData("not json")).toBeNull();
		expect(parseIdData('{"lang":"en"}')).toBeNull();
	});
});

describe("url helpers", () => {
	it("should build on-wiki urls with underscored, encoded segments", () => {
		expect(wikiUrl("en", "Ada Programming/Basic")).toBe(
			"https://en.wikibooks.org/wiki/Ada_Programming/Basic",
		);
		// encodeURIComponent percent-encodes ':' in the namespace prefix.
		expect(wikiUrl("en", "Wikijunior:Solar System/Earth")).toBe(
			"https://en.wikibooks.org/wiki/Wikijunior%3ASolar_System/Earth",
		);
	});

	it("should build api urls with encoded query pairs", () => {
		expect(
			apiUrl("en", [
				["action", "parse"],
				["page", "Wikijunior:Solar System"],
			]),
		).toBe(
			"https://en.wikibooks.org/w/api.php?format=json&action=parse&page=Wikijunior%3ASolar%20System",
		);
	});
});

describe("namespace helpers", () => {
	// Trimmed excerpt of en.wikibooks.org siteinfo namespaces (verified live:
	// Cookbook is ns 102, Wikijunior ns 110); Modul shows a localized name
	// differing from the canonical one.
	const NS_FIXTURE: NamespacesResponse = {
		query: {
			namespaces: {
				"-2": { id: -2, "*": "Media", canonical: "Media" },
				"0": { id: 0, "*": "" },
				"14": { id: 14, "*": "Category", canonical: "Category" },
				"102": { id: 102, "*": "Cookbook", canonical: "Cookbook" },
				"110": { id: 110, "*": "Wikijunior", canonical: "Wikijunior" },
				"828": { id: 828, "*": "Modul", canonical: "Module" },
			},
		},
	};

	it("should build a name map, skipping virtual and empty namespaces", () => {
		const map = parseNamespaceMap(NS_FIXTURE);
		expect(map.cookbook).toBe(102);
		expect(map.wikijunior).toBe(110);
		expect(map.category).toBe(14);
		expect(map.module).toBe(828);
		expect(map.media).toBeUndefined();
		expect(map[""]).toBeUndefined();
	});

	it("should split custom-namespace book titles from their leaf", () => {
		const map = parseNamespaceMap(NS_FIXTURE);
		expect(splitTitleNamespace("Wikijunior:Solar System", map)).toEqual({
			namespace: 110,
			leaf: "Solar System",
		});
		// Namespace matching is case-insensitive.
		expect(splitTitleNamespace("cookbook:Bread", map)).toEqual({
			namespace: 102,
			leaf: "Bread",
		});
		// Canonical names resolve even when the localized name differs.
		expect(splitTitleNamespace("Module:Math", map)).toEqual({
			namespace: 828,
			leaf: "Math",
		});
	});

	it("should treat unknown or missing prefixes as main space", () => {
		const map = parseNamespaceMap(NS_FIXTURE);
		expect(splitTitleNamespace("Ada Programming/Basic", map)).toEqual({
			namespace: 0,
			leaf: "Ada Programming/Basic",
		});
		expect(splitTitleNamespace("Nonsense:Foo", map)).toEqual({
			namespace: 0,
			leaf: "Nonsense:Foo",
		});
		expect(splitTitleNamespace(":Leading colon", map)).toEqual({
			namespace: 0,
			leaf: ":Leading colon",
		});
	});
});

describe("html scanning helpers", () => {
	it("should pick the first sizeable illustration as cover and skip icons", () => {
		const html = `
<img alt="Featured book" src="//upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Featured_book_en.svg/60px-Featured_book_en.svg.png?utm_source=en.wikibooks.org" width="60">
<img src="//upload.wikimedia.org/wikipedia/commons/thumb/6/60/00_percent.svg/20px-00_percent.svg.png?utm_source=en.wikibooks.org" width="20">
<img src="//upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/250px-The_Earth_seen_from_Apollo_17.jpg?utm_source=en.wikibooks.org">`;
		expect(findCoverUrl(html)).toBe(
			"https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/250px-The_Earth_seen_from_Apollo_17.jpg",
		);
	});

	it("should skip tiny icons without a width attribute", () => {
		expect(
			findCoverUrl('<img src="//upload.wikimedia.org/x/20px-tiny.png">'),
		).toBeNull();
	});

	it("should use the first substantial paragraph as description", () => {
		const html = `<p class="noprint">navigation furniture</p>
<p>Too short.</p>
<p>The Earth is the third planet from the Sun and the only astronomical object known to harbor life, with liquid water covering most of its surface.</p>`;
		const text = firstParagraphText(html);
		expect(text).toStartWith("The Earth is the third planet from the Sun");
		expect(firstParagraphText("<div><p>tiny</p></div>")).toBe("");
	});
});

describe("html -> paragraph walker", () => {
	it("should emit prose, headings, lists and inline text while skipping noise", () => {
		const tree = el(
			"div",
			{ class: "mw-parser-output" },
			el(
				"div",
				{ class: "noprint" },
				el("p", {}, "Navigation junk that must be skipped"),
			),
			el("p", {}, "Earth is the planet we live on."),
			el(
				"div",
				{ class: "mw-heading mw-heading2" },
				el("h2", {}, "Earth Facts"),
				el("span", { class: "mw-editsection" }, "[", "edit", "]"),
			),
			el(
				"ul",
				{},
				el("li", {}, "The Earth is the third planet from the Sun"),
				el("li", {}, "Oxygen is necessary for life"),
			),
			el("p", {}, "Water covers ", el("b", {}, "most"), " of the surface."),
			el(
				"table",
				{ class: "navbox" },
				el("tr", {}, el("td", {}, "navbox cell junk")),
			),
			el("figure", {}, el("img", { src: "//upload.wikimedia.org/x.jpg" })),
			el("p", { class: "mw-empty-elt" }, ""),
			el("p", {}, ".mw-parser-output .junk { color: red }"),
			el(
				"p",
				{},
				"Read more on ",
				el("a", { href: "/wiki/Solar_System" }, "the Solar System"),
				" page.",
			),
		);

		const paragraphs = collectParagraphs(tree);
		const texts = paragraphs.map((p) =>
			p.type === "Text" ? p.content : "<not-text>",
		);
		expect(texts).toEqual([
			"Earth is the planet we live on.",
			"Earth Facts",
			"• The Earth is the third planet from the Sun",
			"• Oxygen is necessary for life",
			"Water covers most of the surface.",
			"Read more on the Solar System page.",
		]);
		expect(paragraphs[1]).toEqual({
			type: "Text",
			content: "Earth Facts",
			style: { bold: true },
		});
	});

	it("should strip legacy inline [edit] markers from headings", () => {
		const tree = el(
			"div",
			{ class: "mw-parser-output" },
			el(
				"h3",
				{},
				"Old-style heading",
				el("span", { class: "mw-editsection" }, "[edit]"),
			),
		);
		expect(collectParagraphs(tree)).toEqual([
			{ type: "Text", content: "Old-style heading", style: { bold: true } },
		]);
	});

	it("should flatten pages with no block content as a fallback", () => {
		const tree = el(
			"div",
			{ class: "mw-parser-output" },
			el("span", {}, "only inline text"),
		);
		expect(collectParagraphs(tree)).toEqual([
			{ type: "Text", content: "only inline text", style: null },
		]);
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
					"en.wikibooks.org",
					"de.wikibooks.org",
					"zh.wikibooks.org",
					"www.wikibooks.org",
					"upload.wikimedia.org",
				]),
			);
		}
	});

	it("should browse featured books", async () => {
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

	it("should search for books", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "cookbook");
		expect(result.content.length).toBeGreaterThan(0);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("cookbook"))).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should detail the first browsed book and echo settings", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult.length === 0) throw new Error("No browse result");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail(browseResult[0]!.id, {
			probe,
		});
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.language).toBe("en");
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBeGreaterThanOrEqual(1);
		if (result.entry.cover != null) {
			expect(result.entry.cover.url.startsWith("https://")).toBe(true);
		}
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(result.entry);
		browseDetail = result;
	}, 120_000);

	it("should source the first episode of the browsed book", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseDetail === undefined) throw new Error("No detail result");
		const episode = browseDetail.entry.episodes[0]!;
		const result = await extension!.source(episode.id, browseDetail.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(0);
		expect(result.settings).toEqual(browseDetail.settings);
		await assertValidSource(result.source);
	}, 120_000);

	it("should detail a chaptered custom-namespace book with sorted chapters", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail(
			{
				uid: makeUid("en", "Wikijunior:Solar System"),
				iddata: makeIdData({
					lang: "en",
					title: "Wikijunior:Solar System",
				}),
			},
			{},
		);
		const entry = result.entry;
		expect(entry.titles[0]).toBe("Wikijunior:Solar System");
		expect(entry.episodes.length).toBeGreaterThan(5);
		const names = entry.episodes.map((e) => e.name);
		// Chapter names must be stripped of the book prefix...
		expect(
			names.some((name) => name.startsWith("Wikijunior:Solar System/")),
		).toBe(false);
		expect(names).toContain("Earth");
		// ...and naturally sorted.
		expect(names).toEqual([...names].sort(naturalCompare));
		await assertValidEntry(entry);
	}, 120_000);

	it("should source a chapter as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{
				uid: makeUid("en", "Wikijunior:Solar System/Earth"),
				iddata: makeIdData({
					lang: "en",
					title: "Wikijunior:Solar System/Earth",
				}),
			},
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
		const texts = result.source.paragraphs
			.map((p) => (p.type === "Text" ? p.content : ""))
			.filter((content) => content.length > 0);
		expect(texts.length).toBeGreaterThan(5);
		expect(
			texts.some((content) =>
				content.startsWith("Earth is the planet we live on"),
			),
		).toBe(true);
		expect(result.settings).toEqual({});
		await assertValidSource(result.source);
	}, 120_000);

	it("should resolve episodes from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: makeUid("en", "Wikijunior:Solar System/Mars") },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(5);
	}, 120_000);
});
