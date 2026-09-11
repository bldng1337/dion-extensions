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
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	BOOKS,
	chapterQuery,
	findBook,
	formatVerseText,
	makeEpisodeUid,
	PAGE_SIZE,
	parseEpisodeUid,
	passageUrl,
	searchBooks,
	TRANSLATIONS,
} from "./bible-api.ts";

// bible-api.com allows 15 requests per 30 seconds per IP, so the live part of
// this suite keeps a deliberately small budget (~13 calls): browse/search
// listing shapes are checked without hitting the network validators, the
// extension itself caches passages, and the remaining traffic comes from the
// URL validators in @dion-js/extension-test-utils.

let extension: Extension;
let client: MockManagerClient;

let searchResults: Entry[] = [];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	searchResults = [];
});

describe("Extension (live)", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
	});

	it("should browse the 66 books with no network calls", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page0 = await extension!.browse(0);
		expect(page0.content).toHaveLength(PAGE_SIZE);
		expect(page0.hasnext).toBe(true);
		expect(page0.length).toBe(66);
		expect(page0.content[0]!.title).toBe("Genesis");
		const uids = new Set(page0.content.map((entry) => entry.id.uid));
		expect(uids.size).toBe(PAGE_SIZE);
		for (const entry of page0.content) {
			expect(entry.media_type).toBe("Book");
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.url.startsWith("https://bible-api.com/")).toBe(true);
		}
		const last = await extension!.browse(2);
		expect(last.content).toHaveLength(66 - 2 * PAGE_SIZE);
		expect(last.hasnext).toBe(false);
	});

	it("should search for books by name", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "john");
		expect(result).toBeDefined();
		expect(result.content.map((entry) => entry.title)).toEqual([
			"John",
			"1 John",
			"2 John",
			"3 John",
		]);
		expect(result.hasnext).toBe(false);
		searchResults = result.content;
		// The only network-heavy step: validates up to 5 entry URLs.
		await assertValidEntries(searchResults);
	});

	it("should detail John with one episode per chapter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const john = searchResults.find((entry) => entry.id.uid === "JHN");
		expect(john).toBeDefined();
		const result = await extension!.detail(john!.id, {});
		expect(result).toBeDefined();
		detailResult = result;

		const entry = result.entry;
		expect(entry.id.uid).toBe("JHN");
		expect(entry.titles[0]).toBe("John");
		expect(entry.media_type).toBe("Book");
		expect(entry.episodes).toHaveLength(21);
		expect(entry.episodes[0]!.name).toBe("Chapter 1");
		expect(entry.description).toContain("21 chapters");
		expect(entry.language).toBe("en");
		expect(entry.meta?.Translation).toBeDefined();
		// Settings must be echoed back untouched.
		expect(result.settings).toEqual({});

		await assertValidEntry(entry);
	});

	it("should source John 1 as a Paragraphlist with verses", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const episodes: Episode[] = detailResult?.entry.episodes ?? [];
		expect(episodes.length).toBeGreaterThan(0);
		const result = await extension!.source(
			episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(result.source);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") throw new Error("bad source");
		const paragraphs = result.source.paragraphs;
		// Heading + John 1's 51 verses.
		expect(paragraphs.length).toBeGreaterThanOrEqual(50);
		expect(paragraphs[0]!.type).toBe("Text");
		if (paragraphs[0]!.type !== "Text") throw new Error("bad paragraph");
		expect(paragraphs[0]!.style?.bold).toBe(true);
		const firstVerse = paragraphs[1]!;
		if (firstVerse.type !== "Text") throw new Error("bad paragraph");
		expect(firstVerse.content).toMatch(/^1 In the beginning/);
		// Settings must be echoed back untouched.
		expect(result.settings).toEqual(detailResult.settings);
	});

	it("should reject an unknown book", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		expect(findBook("NOTABOOK")).toBeUndefined();
		await expect(extension!.detail({ uid: "NOTABOOK" }, {})).rejects.toThrow(
			/unknown Bible book/,
		);
		await expect(extension!.source({ uid: "JHN#99" }, {})).rejects.toThrow(
			/invalid chapter reference/,
		);
	});
});

describe("helpers (unit)", () => {
	it("should expose the complete 66-book canon", () => {
		expect(BOOKS).toHaveLength(66);
		const ids = new Set(BOOKS.map((book) => book.id));
		expect(ids.size).toBe(66);
		for (const book of BOOKS) {
			expect(book.chapters).toBeGreaterThanOrEqual(1);
		}
		expect(findBook("GEN")?.chapters).toBe(50);
		expect(findBook("PSA")?.chapters).toBe(150);
		expect(findBook("REV")?.chapters).toBe(22);
	});

	it("should offer the verified translations", () => {
		expect(TRANSLATIONS.map((t) => t.value)).toEqual([
			"web",
			"kjv",
			"bbe",
			"webbe",
			"oeb-us",
			"oeb-cw",
			"clementine",
			"almeida",
			"rccv",
		]);
	});

	it("should build chapter queries with ranges for single-chapter books", () => {
		const john = findBook("JHN")!;
		expect(chapterQuery(john, 3)).toBe("JHN+3");
		expect(chapterQuery(findBook("GEN")!, 1)).toBe("GEN+1");
		expect(chapterQuery(findBook("JUD")!, 1)).toBe("JUD+1:1-25");
		expect(chapterQuery(findBook("OBA")!, 1)).toBe("OBA+1:1-21");
		expect(chapterQuery(findBook("PHM")!, 1)).toBe("PHM+1:1-25");
		expect(chapterQuery(findBook("2JN")!, 1)).toBe("2JN+1:1-13");
		expect(chapterQuery(findBook("3JN")!, 1)).toBe("3JN+1:1-14");
	});

	it("should build passage urls without URL globals", () => {
		expect(passageUrl("JHN+3")).toBe("https://bible-api.com/JHN+3");
		expect(passageUrl("JHN+3", "kjv")).toBe(
			"https://bible-api.com/JHN+3?translation=kjv",
		);
	});

	it("should round-trip episode ids", () => {
		const john = findBook("JHN")!;
		const uid = makeEpisodeUid(john, 3);
		expect(uid).toBe("JHN#3");
		expect(parseEpisodeUid(uid)).toEqual({ book: john, chapter: 3 });
	});

	it("should reject invalid episode ids", () => {
		expect(() => parseEpisodeUid("JHN#22")).toThrow(); // John has 21 chapters
		expect(() => parseEpisodeUid("JHN#0")).toThrow();
		expect(() => parseEpisodeUid("JHN")).toThrow();
		expect(() => parseEpisodeUid("NOTABOOK#1")).toThrow();
	});

	it("should clean verse text for reading", () => {
		expect(formatVerseText("\nFor God so loved the world.\n\n")).toBe(
			"For God so loved the world.",
		);
		expect(formatVerseText("Jesus answered him,\n“Most certainly.”")).toBe(
			"Jesus answered him, “Most certainly.”",
		);
		expect(formatVerseText("   ")).toBe("");
	});

	it("should match book names case-insensitively", () => {
		expect(searchBooks("john").map((book) => book.name)).toEqual([
			"John",
			"1 John",
			"2 John",
			"3 John",
		]);
		expect(searchBooks("1 samuel").map((book) => book.id)).toEqual(["1SA"]);
		expect(searchBooks("1john").map((book) => book.id)).toEqual(["1JN"]);
		expect(searchBooks("")).toEqual([]);
		expect(searchBooks("zzz")).toEqual([]);
	});
});
