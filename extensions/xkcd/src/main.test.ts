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
	cleanTranscript,
	comicApiUrl,
	comicDate,
	comicDescription,
	comicPageUrl,
	comicToDetail,
	comicToEntry,
	comicTitle,
	comicsToEntries,
	type XkcdComic,
	matchesComic,
	paginate,
	toNum,
} from "./comic.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from the live API)
// ---------------------------------------------------------------------------

const WOODPECKER: XkcdComic = {
	num: 614,
	safe_title: "Woodpecker",
	alt: "If you don't have an extension cord I can get that too. Because we're friends! Right?",
	transcript:
		"[[A man with a beret and a woman are standing on a boardwalk.]]\nMan: A woodpecker!\n{{Title text: If you don't have an extension cord I can get that too. Because we're friends! Right?}}",
	img: "https://imgs.xkcd.com/comics/woodpecker.png",
	year: "2009",
	month: "7",
	day: "24",
};

const BARREL: XkcdComic = {
	num: "1",
	title: "Barrel - Part 1",
	alt: "Don't we all.",
	transcript:
		"[[A boy sits in a barrel which is floating in an ocean.]]\n{{Alt: Don't we all.}}",
	img: "https://imgs.xkcd.com/comics/barrel_cropped_(1).jpg",
	year: "2006",
	month: "1",
	day: "1",
};

const NO_TRANSCRIPT: XkcdComic = {
	num: 3296,
	safe_title: "Fault Taunting",
	alt: "One of the first things they teach you is to NEVER play with the geology toy over a mantle hotspot.",
	transcript: "",
	img: "https://imgs.xkcd.com/comics/fault_taunting.png",
};

// ---------------------------------------------------------------------------
// Unit tests for the mapping helpers
// ---------------------------------------------------------------------------

describe("xkcd helpers", () => {
	it("should build API and site urls", () => {
		expect(comicApiUrl(614)).toBe("https://xkcd.com/614/info.0.json");
		expect(comicPageUrl(1)).toBe("https://xkcd.com/1/");
	});
	it("should coerce string-typed numbers from the API", () => {
		expect(toNum("404")).toBe(404);
		expect(toNum(12)).toBe(12);
		expect(toNum(" 7 ")).toBe(7);
		expect(toNum("abc")).toBeNull();
		expect(toNum(1.5)).toBeNull();
		expect(toNum(0)).toBeNull();
		expect(toNum(-3)).toBeNull();
		expect(toNum(undefined)).toBeNull();
	});
	it("should format the release date zero-padded", () => {
		expect(comicDate(WOODPECKER)).toBe("2009-07-24");
		expect(comicDate(BARREL)).toBe("2006-01-01");
		expect(comicDate({ num: 1, year: 2024, month: "12", day: "5" })).toBe(
			"2024-12-05",
		);
		expect(comicDate({ num: 1 })).toBeUndefined();
		expect(
			comicDate({ num: 1, year: "x", month: "1", day: "1" }),
		).toBeUndefined();
	});
	it("should fall back to a generic title", () => {
		expect(comicTitle(WOODPECKER, 614)).toBe("Woodpecker");
		expect(comicTitle(BARREL, 1)).toBe("Barrel - Part 1");
		expect(comicTitle({}, 5)).toBe("xkcd #5");
	});
	it("should strip annotation blocks out of transcripts", () => {
		expect(
			cleanTranscript("Man: A woodpecker!\n{{Title text: hover text}}"),
		).toBe("Man: A woodpecker!");
		expect(cleanTranscript("[[A boy sits in a barrel.]]\n{Alt: hover}")).toBe(
			"[[A boy sits in a barrel.]]",
		);
		expect(cleanTranscript("  \n\n  ")).toBe("");
	});
	it("should build the description from alt text plus transcript", () => {
		const description = comicDescription(WOODPECKER);
		expect(description).toStartWith(WOODPECKER.alt!);
		expect(description).toContain("Transcript:");
		expect(description).not.toContain("{{");
		expect(description).not.toContain("Title text");
		// The alt text is duplicated inside transcript annotations only.
		expect(comicDescription(BARREL).indexOf("Don't we all.")).toBe(0);
		expect(comicDescription(BARREL).match(/Don't we all\./g)?.length).toBe(1);
	});
	it("should omit the transcript section when there is none", () => {
		expect(comicDescription(NO_TRANSCRIPT)).toBe(NO_TRANSCRIPT.alt!);
		expect(comicDescription({})).toBe("");
	});
	it("should match comics against title, alt and transcript", () => {
		expect(matchesComic(WOODPECKER, "WOODPECKER")).toBe(true);
		expect(matchesComic(WOODPECKER, "extension cord")).toBe(true);
		expect(matchesComic(BARREL, "barrel")).toBe(true);
		expect(matchesComic(NO_TRANSCRIPT, "geology toy")).toBe(true);
		expect(matchesComic(WOODPECKER, "quantum")).toBe(false);
		expect(matchesComic(WOODPECKER, "   ")).toBe(false);
	});
	it("should map a comic to a list entry", () => {
		const entry = comicToEntry(WOODPECKER)!;
		expect(entry.id.uid).toBe("614");
		expect(entry.url).toBe("https://xkcd.com/614/");
		expect(entry.title).toBe("Woodpecker");
		expect(entry.media_type).toBe("Comic");
		expect(entry.cover?.url).toBe(
			"https://imgs.xkcd.com/comics/woodpecker.png",
		);
		expect(entry.author).toEqual(["Randall Munroe"]);
		// String numbers are coerced; jpg images are kept as-is.
		expect(comicToEntry(BARREL)!.cover?.url).toBe(
			"https://imgs.xkcd.com/comics/barrel_cropped_(1).jpg",
		);
		expect(comicToEntry({})).toBeNull();
		expect(comicToEntry({ num: "x" })).toBeNull();
		expect(comicsToEntries([WOODPECKER, {}, BARREL]).length).toBe(2);
	});
	it("should map a comic to a detail with a single Read episode", () => {
		const detail = comicToDetail(WOODPECKER)!;
		expect(detail.id.uid).toBe("614");
		expect(detail.titles).toEqual(["Woodpecker"]);
		expect(detail.media_type).toBe("Comic");
		expect(detail.status).toBe("Complete");
		expect(detail.language).toBe("en");
		expect(detail.author).toEqual(["Randall Munroe"]);
		expect(detail.episodes.length).toBe(1);
		expect(detail.episodes[0]!.name).toBe("Read");
		expect(detail.episodes[0]!.id.uid).toBe("614");
		expect(detail.episodes[0]!.url).toBe("https://xkcd.com/614/");
		expect(detail.meta).toEqual({ Released: "2009-07-24" });
		expect(comicToDetail({})).toBeNull();
	});
	it("should paginate a newest-first list", () => {
		const items = [1, 2, 3, 4, 5, 6, 7];
		const page0 = paginate(items, 0, 3);
		expect(page0).toEqual({ content: [1, 2, 3], hasnext: true });
		expect(paginate(items, 2, 3)).toEqual({ content: [7], hasnext: false });
		expect(paginate(items, 5, 3)).toEqual({ content: [], hasnext: false });
		expect(paginate(items, -1, 3).content).toEqual([1, 2, 3]);
	});
});

// ---------------------------------------------------------------------------
// Live flow against xkcd.com through the built extension
// ---------------------------------------------------------------------------

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Comic");
		expect(data.extension_type).toContainEqual({
			type: "EntryProvider",
			has_search: true,
		});
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining(["xkcd.com", "imgs.xkcd.com"]),
			);
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(25);
		expect(result.hasnext).toBe(true);
		for (let i = 0; i < result.content.length; i++) {
			const entry = result.content[i]!;
			expect(entry.media_type).toBe("Comic");
			expect(Number.isInteger(Number(entry.id.uid))).toBe(true);
			expect(entry.cover?.url).toStartWith("https://imgs.xkcd.com/");
			if (i > 0) {
				// Newest-first ordering.
				expect(Number(entry.id.uid)).toBeLessThan(
					Number(result.content[i - 1]!.id.uid),
				);
			}
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should return nothing past the oldest strip", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(10_000);
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});
	it("should be able to search the cached window", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "standard");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
		}
		// #3232 "Countdown Standard" sits well inside the default 500-strip window.
		expect(result.content.some((e) => e.id.uid === "3232")).toBe(true);
		await assertValidEntries(result.content);
	}, 300_000);
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
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.name).toBe("Read");
		expect(result.entry.episodes[0]!.url).toBe(
			`https://xkcd.com/${browseResult[0]!.id.uid}/`,
		);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.cover?.url).toStartWith("https://imgs.xkcd.com/");
		expect(result.entry.ui).toBeDefined();
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 60_000);
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Imagelist");
		if (result.source.type === "Imagelist") {
			expect(result.source.links.length).toBe(1);
			expect(result.source.links[0]!.url).toStartWith("https://imgs.xkcd.com/");
			expect(result.source.audio).toBeNull();
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 60_000);
	it("should handle an early jpg strip with a transcript annotation", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "1" }, {});
		expect(result.entry.id.uid).toBe("1");
		expect(result.entry.titles).toEqual(["Barrel - Part 1"]);
		expect(result.entry.description).toContain("Don't we all.");
		expect(result.entry.description).not.toContain("{{Alt");
		expect(result.entry.cover?.url).toEndWith(".jpg");
		const sourced = await extension!.source(
			result.entry.episodes[0]!.id,
			result.settings,
		);
		expect(sourced.source.type).toBe("Imagelist");
		if (sourced.source.type === "Imagelist") {
			expect(sourced.source.links[0]!.url).toEndWith(".jpg");
		}
		await assertValidSource(sourced.source);
	}, 60_000);
	it("should reject malformed entry and episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.detail({ uid: "not-a-number" }, {}),
		).rejects.toThrow();
		await expect(
			extension!.source({ uid: "not-a-number" }, {}),
		).rejects.toThrow();
	}, 30_000);
});
