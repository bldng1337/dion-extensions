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
	bookIdFromUrl,
	cleanText,
	decodeEntities,
	isPassageUrl,
	metaValue,
	normalizeLanguage,
	parseDisplayTotal,
	slicePage,
	thumbnailUrl,
} from "./lit2go.ts";

let extension: Extension;

let browseResult: Entry[];
let searchResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
}, 30_000);

describe("text helpers", () => {
	it("should decode named, decimal and hex HTML entities", () => {
		expect(decodeEntities("AT&amp;T &lt;b&gt; &quot;x&quot; &#39;y&#39;")).toBe(
			"AT&T <b> \"x\" 'y'",
		);
		expect(decodeEntities("caf&#233; and caf&#xE9;")).toBe("café and café");
		expect(decodeEntities("Alice&rsquo;s&nbsp;book&hellip;")).toBe(
			"Alice's book…",
		);
		// Double-escaped input must only be decoded one level.
		expect(decodeEntities("&amp;lt;")).toBe("&lt;");
	});

	it("should collapse whitespace and strip stray tags", () => {
		expect(cleanText("  Alice's \n\t Adventures  in&nbsp;Wonderland ")).toBe(
			"Alice's Adventures in Wonderland",
		);
		expect(cleanText("a <em>nested</em> tag")).toBe("a nested tag");
		expect(cleanText(undefined)).toBe("");
	});

	it("should extract book ids and classify lit2go urls", () => {
		expect(bookIdFromUrl("https://etc.usf.edu/lit2go/21/huck/")).toBe("21");
		expect(
			bookIdFromUrl("https://etc.usf.edu/lit2go/21/huck/3/chapter-one/"),
		).toBe("21");
		expect(bookIdFromUrl("https://example.com/other/21/x/")).toBeUndefined();

		expect(
			isPassageUrl("https://etc.usf.edu/lit2go/21/huck/3/chapter-one/"),
		).toBe(true);
		expect(isPassageUrl("https://etc.usf.edu/lit2go/21/huck/")).toBe(false);
		expect(isPassageUrl("https://etc.usf.edu/lit2go/21/huck/3/")).toBe(false);
	});

	it("should build thumbnail urls from book ids", () => {
		expect(thumbnailUrl("1")).toBe(
			"https://etc.usf.edu/lit2go/static/thumbnails/books/1.png",
		);
	});

	it("should slice cached listings into pages", () => {
		const items = [1, 2, 3, 4, 5];
		expect(slicePage(items, 0, 2)).toEqual({ items: [1, 2], hasnext: true });
		expect(slicePage(items, 2, 2)).toEqual({ items: [5], hasnext: false });
		expect(slicePage(items, 9, 2)).toEqual({ items: [], hasnext: false });
		expect(slicePage(items, -1, 2)).toEqual({ items: [1, 2], hasnext: true });
	});

	it("should read totals out of the search header", () => {
		expect(parseDisplayTotal("Displaying 1–25 of 100")).toBe(100);
		expect(parseDisplayTotal("Displaying 1–4 of 1,234 results")).toBe(1234);
		expect(parseDisplayTotal("no numbers here")).toBeUndefined();
		expect(parseDisplayTotal(undefined)).toBeUndefined();
	});

	it("should split metadata list items", () => {
		expect(metaValue("Year Published: 1865")).toEqual({
			key: "Year Published",
			value: "1865",
		});
		expect(metaValue("Language:English")).toEqual({
			key: "Language",
			value: "English",
		});
		expect(metaValue("no colon")).toBeUndefined();
		expect(metaValue(": empty key")).toBeUndefined();
		expect(metaValue("Empty value:")).toBeUndefined();
	});

	it("should normalize the site language", () => {
		expect(normalizeLanguage("English")).toBe("en");
		expect(normalizeLanguage("english")).toBe("en");
		expect(normalizeLanguage(undefined)).toBe("en");
	});
});

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
			expect(network.domains).toContain("etc.usf.edu");
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		await assertValidEntries(result.content);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			expect(entry.cover?.url).toStartWith("https://etc.usf.edu/");
			expect(/^\d+$/.test(entry.id.uid)).toBe(true);
		}
		browseResult = result.content;
	}, 60_000);
	it("should paginate browse pages", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const second = await extension!.browse(1);
		await assertValidEntries(second.content);
		expect(second.content.length).toBeGreaterThan(0);
		expect(second.content[0]!.id.uid).not.toBe(browseResult[0]!.id.uid);
	}, 60_000);
	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "alice");
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		expect(
			result.content.some((entry) =>
				entry.title.toLowerCase().includes("alice"),
			),
		).toBe(true);
		searchResult = result.content;
	}, 60_000);
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
		expect(result.entry.episodes.length).toBeGreaterThan(0);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.cover).toBeDefined();
		expect(result.entry.media_type).toBe("Audio");
		expect(result.entry.language).toBe("en");
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 120_000);
	it("should resolve entries without iddata via the book listing", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const result = await extension!.detail(
			{ uid: detailResult.entry.id.uid },
			{},
		);
		expect(result.entry.id.uid).toBe(detailResult.entry.id.uid);
	}, 120_000);
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(result.source);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBeGreaterThan(0);
			const stream = result.source.sources[0]!;
			expect(stream.url.url).toMatch(/^https:\/\/etc\.usf\.edu\/.+\.mp3$/);
			expect(stream.lang).toBe("en");
		}
		expect(result.settings).toEqual(detailResult.settings);
	}, 120_000);
	it("should be able to source from search results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (searchResult === undefined || searchResult.length <= 0)
			throw new Error("No search result");
		const detail = await extension!.detail(searchResult[0]!.id, {});
		const result = await extension!.source(
			detail.entry.episodes[0]!.id,
			detail.settings as {
				[key: string]: Setting;
			},
		);
		await assertValidSource(result.source);
	}, 120_000);
	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.source({ uid: "https://etc.usf.edu/lit2go/21/huck/" }, {}),
		).rejects.toThrow();
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	}, 30_000);
});
