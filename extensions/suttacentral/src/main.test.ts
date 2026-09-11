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
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	apiUrl,
	bilaraToParagraphs,
	cleanSegmentText,
	encodeQuery,
	episodeName,
	pickTranslation,
	siteUrl,
	type BilaraSutta,
	type SuttaTranslation,
} from "./sc.ts";

let extension: Extension;

let browseResult: Entry[];
let dhpDetail: EntryDetailedResult;
let searchResult: Entry[];

// A trimmed fixture in the shape of /api/bilarasuttas responses: an ordered
// segment list mixing headings, verse lines, prose and an untranslated
// segment (only present in root_text).
const BILARA_FIXTURE: BilaraSutta = {
	keys_order: ["x:0.1", "x:0.2", "x:1.1", "x:1.2", "x:2.1", "x:3.1"],
	html_text: {
		"x:0.1": "<h1 class='range-title'>{}</h1>",
		"x:0.2": "<article id='x'><h2 class='sutta-title'>{}</h2>",
		"x:1.1": "<blockquote class='gatha'><p><span class='verse-line'>{}</span>",
		"x:1.2": "<span class='verse-line'>{}</span></p></blockquote>",
		"x:2.1": "<p>{}</p>",
		"x:3.1": "<p>{}</p>",
	},
	translation_text: {
		"x:0.1": "The Range",
		"x:0.2": "Title &amp; more",
		"x:1.1": "Verse one",
		"x:2.1": "Prose with a <b>bold bit</b>",
	},
	root_text: {
		"x:0.1": "Mūla",
		"x:0.2": "Adhikaraṇa",
		"x:1.1": "Pādo ekō",
		"x:1.2": "Pādo dvi",
		"x:2.1": "Prose root",
		"x:3.1": "Root only",
	},
};

const TRANSLATIONS: SuttaTranslation[] = [
	{ lang: "pli", author_uid: "ms", is_root: true, segmented: true },
	{ lang: "en", author_uid: "bodhi", segmented: false },
	{ lang: "en", author_uid: "sujato", segmented: true },
	{ lang: "de", author_uid: "sabbamitta", segmented: true },
];

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
	searchResult = [];
});

describe("helpers", () => {
	it("should build api urls with encoded query strings", () => {
		expect(apiUrl("bilarasuttas/mn1/sujato", [["lang", "en"]])).toBe(
			"https://suttacentral.net/api/bilarasuttas/mn1/sujato?lang=en",
		);
		expect(apiUrl("suttaplex/dhp")).toBe(
			"https://suttacentral.net/api/suttaplex/dhp",
		);
		expect(
			encodeQuery([
				["q", "a b"],
				["x", "&="],
			]),
		).toBe("q=a%20b&x=%26%3D");
	});

	it("should build on-site urls", () => {
		expect(siteUrl("dhp")).toBe("https://suttacentral.net/dhp");
		expect(siteUrl("mn1", "en", "sujato")).toBe(
			"https://suttacentral.net/mn1/en/sujato",
		);
	});

	it("should prefer the requested segmented translation", () => {
		const picked = pickTranslation(TRANSLATIONS, "de");
		expect(picked?.lang).toBe("de");
		expect(picked?.author_uid).toBe("sabbamitta");
	});

	it("should fall back to english and then to any segmented translation", () => {
		const only = [
			{ lang: "pli", author_uid: "ms", is_root: true, segmented: true },
			{ lang: "lt", author_uid: "piyadassi", segmented: true },
		];
		expect(pickTranslation(only, "de")?.lang).toBe("lt");
		const withEn = [
			{ lang: "pli", author_uid: "ms", is_root: true, segmented: true },
			{ lang: "en", author_uid: "sujato", segmented: true },
			{ lang: "lt", author_uid: "piyadassi", segmented: true },
		];
		expect(pickTranslation(withEn, "de")?.author_uid).toBe("sujato");
	});

	it("should never pick legacy (non-segmented) translations", () => {
		const legacy = [
			{ lang: "en", author_uid: "bodhi", segmented: false },
			{ lang: "zh", author_uid: "zhuang", segmented: false },
		];
		expect(pickTranslation(legacy, "en")).toBeUndefined();
		expect(pickTranslation(undefined, "en")).toBeUndefined();
	});

	it("should compose readable episode names", () => {
		expect(episodeName("MN 1", "The Root of All Things", "mn1")).toBe(
			"MN 1 — The Root of All Things",
		);
		expect(episodeName(null, "1. Pairs ", "dhp1-20")).toBe("1. Pairs");
		expect(episodeName("", "", "kp1")).toBe("kp1");
	});

	it("should strip markup and entities from segment text", () => {
		expect(cleanSegmentText("Prose with a <b>bold bit</b>")).toBe(
			"Prose with a bold bit",
		);
		expect(cleanSegmentText("Title &amp; &#8220;more&#8221; ")).toBe(
			"Title & “more”",
		);
	});

	it("should map bilara segments to reading paragraphs", () => {
		// Only Text paragraphs are produced by the mapper; this keeps the
		// assertions below honest about that.
		const text = (paragraph: Paragraph | undefined) => {
			expect(paragraph?.type).toBe("Text");
			return paragraph && paragraph.type === "Text"
				? paragraph
				: { content: "", style: null };
		};
		const paragraphs = bilaraToParagraphs(BILARA_FIXTURE);
		expect(paragraphs).toHaveLength(6);
		// Headings (range + sutta title) become bold.
		expect(paragraphs[0]).toEqual({
			type: "Text",
			content: "The Range",
			style: { bold: true },
		});
		expect(text(paragraphs[1]).style?.bold).toBe(true);
		expect(text(paragraphs[1]).content).toBe("Title & more");
		// Verse line present in both root and translation stays plain.
		expect(text(paragraphs[2]).style ?? null).toBeNull();
		expect(text(paragraphs[2]).content).toBe("Verse one");
		// Untranslated segment falls back to the Pali root in italics.
		expect(text(paragraphs[3]).style?.italic).toBe(true);
		expect(text(paragraphs[3]).content).toBe("Pādo dvi");
		expect(text(paragraphs[5]).content).toBe("Root only");
	});

	it("should tolerate an empty bilara payload", () => {
		expect(bilaraToParagraphs({})).toEqual([]);
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
			expect(network.domains).toEqual(["suttacentral.net"]);
		}
	}, 120_000);

	it("should browse curated collections", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.id.uid).toBe("dhp");
		expect(result.content[0]!.title).toContain("Dhammapada");
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate browse results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toContain("dhp");
		expect(ids1).toContain("vv");
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should full-text search suttas", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "suffering");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(false);
		await assertValidEntries(result.content);
		searchResult = result.content;
	}, 120_000);

	it("should return no results for an empty search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content).toHaveLength(0);
	}, 120_000);

	it("should detail the Dhammapada with its chapters as episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const dhp = browseResult.find((e) => e.id.uid === "dhp");
		if (!dhp) throw new Error("Dhammapada entry not browsed");
		const result = await extension!.detail(dhp.id, {});
		expect(result.entry.id.uid).toBe("dhp");
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.description).toContain("CC0");
		expect(result.entry.episodes.length).toBe(26);
		expect(result.entry.episodes[0]!.id.uid).toBe("dhp1-20");
		expect(result.entry.episodes[0]!.name).toContain("Pairs");
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		dhpDetail = result;
	}, 120_000);

	it("should source a Dhammapada chapter as paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (dhpDetail === undefined) throw new Error("No dhp detail");
		const episode = dhpDetail.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			dhpDetail.settings as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		const paragraphs = result.source.paragraphs;
		expect(paragraphs.length).toBeGreaterThan(10);
		// Chapter title heading is bold.
		expect(paragraphs.some((p) => p.type === "Text" && p.style?.bold)).toBe(
			true,
		);
		// Attribution footer.
		const last = paragraphs[paragraphs.length - 1]!;
		if (last.type !== "Text") throw new Error("Last paragraph not text");
		expect(last.content).toContain("suttacentral.net");
		expect(result.settings).toEqual({});
		await assertValidSource(result.source);
	}, 120_000);

	it("should detail a nikaya with grouped chapters", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "dn" }, {});
		expect(result.entry.episodes.length).toBe(34);
		expect(result.entry.episodes[0]!.id.uid).toBe("dn1");
		await assertValidEntry(result.entry);
	}, 120_000);

	it("should detail a search hit as a single-sutta entry and source it", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (searchResult.length === 0) throw new Error("No search result");
		const hit = searchResult[0]!;
		const result = await extension!.detail(hit.id, {});
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.id.uid).toBe(hit.id.uid);
		await assertValidEntry(result.entry);
		const source = await extension!.source(
			result.entry.episodes[0]!.id,
			result.settings as { [key: string]: Setting },
		);
		expect(source.source.type).toBe("Paragraphlist");
		if (source.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(source.source.paragraphs.length).toBeGreaterThan(0);
		await assertValidSource(source.source);
	}, 120_000);

	it("should throw for an unknown uid", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		expect(
			extension!.detail({ uid: "does-not-exist-xyz" }, {}),
		).rejects.toThrow();
	}, 120_000);
});
