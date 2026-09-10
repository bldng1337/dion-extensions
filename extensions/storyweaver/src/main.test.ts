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
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	bestImageUrl,
	bookToEntry,
	booksSearchUrl,
	booksToEntries,
	cleanText,
	decodeEntities,
	humanCount,
	languageCode,
	type SwBook,
	type SwReaderPage,
	orderReaderPages,
	parsePublishedDate,
	personNames,
	readerPageUrls,
	storyApiUrl,
	storyPageUrl,
	storyReadUrl,
	storyToDetail,
} from "./storyweaver.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from the live API)
// ---------------------------------------------------------------------------

const RED_RAINCOAT: SwBook = {
	id: 369,
	title: "The Red Raincoat",
	language: "English",
	level: "1",
	slug: "369-the-red-raincoat",
	description:
		"Manu has a new raincoat. He can&#39;t wait to wear it, but the rain makes him wait... and wait... and wait.",
	coverImage: {
		sizes: [
			{
				height: 268,
				width: 268,
				url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/721019/size1/beedc107df0b5447c6735b02a11b27ef.jpg",
			},
			{
				height: 960,
				width: 959,
				url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/721019/size7/beedc107df0b5447c6735b02a11b27ef.jpg",
			},
		],
	},
	authors: [{ name: "Kiran Kasturia", slug: "104-kiran-kasturia" }],
	illustrators: [{ name: "Zainab Tambawalla", slug: "110-zainab-tambawalla" }],
	publisher: { name: "Pratham Books", slug: "441-pratham-books" },
	readsCount: 406804,
	likesCount: 39617,
	recommended: true,
	isAudio: true,
};

const ID_ONLY: SwBook = {
	id: 2,
	title: "Smile &amp; Wave",
};

const BROKEN: SwBook = { title: "no id at all" };

/** Reader pages for The Red Raincoat, deliberately shuffled. */
const READER_PAGES: SwReaderPage[] = [
	{
		pageId: 5244,
		pagePostion: 11,
		pageType: "AttributionPage",
		isLastStoryPage: false,
	},
	{
		pageId: 5232,
		pagePostion: 4,
		pageType: "StoryPage",
		isLastStoryPage: false,
		coverImage: {
			sizes: [
				{
					height: 128,
					width: 268,
					url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/4568/size1/6307adabee20b8399316a92eefbc18bf.jpg",
				},
				{
					height: 459,
					width: 959,
					url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/4568/size7/6307adabee20b8399316a92eefbc18bf.jpg",
				},
			],
		},
	},
	{
		pageId: 5227,
		pagePostion: 1,
		pageType: "FrontCoverPage",
		isLastStoryPage: false,
		coverImage: {
			sizes: [
				{
					height: 459,
					width: 959,
					url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/4565/size7/748905bc4d8b1f3b47335c6a42175c78.jpg",
				},
			],
		},
	},
	{
		pageId: 5238,
		pagePostion: 10,
		pageType: "StoryPage",
		isLastStoryPage: true,
		coverImage: {
			sizes: [
				{
					height: 459,
					width: 959,
					url: "https://storage.googleapis.com/static.storyweaver.org.in/illustration_crops/4574/size7/baa4efbce56aa6ee579793586fe65228.jpg",
				},
			],
		},
	},
	{
		pageId: 5239,
		pagePostion: 12,
		pageType: "BackCoverPage",
		isLastStoryPage: false,
		coverImage: { sizes: [{ height: 459, width: 959, url: "" }] },
	},
];

const STORY_DETAIL = {
	id: 369,
	name: "The Red Raincoat",
	slug: "369-the-red-raincoat",
	language: "English",
	level: "1",
	description: "Manu has a new raincoat.",
	copyrightNotice:
		"This book has been published on StoryWeaver by Pratham Books.",
	publishedDate: "18-06-2015",
	authors: [{ name: "Kiran Kasturia" }],
	illustrators: [{ name: "Zainab Tambawalla" }],
	publisher: { name: "Pratham Books" },
	readsCount: 406805,
	likesCount: 39617,
};

// ---------------------------------------------------------------------------
// Unit tests for the mapping helpers
// ---------------------------------------------------------------------------

describe("storyweaver helpers", () => {
	it("should build API and site urls", () => {
		expect(storyPageUrl("369-the-red-raincoat")).toBe(
			"https://storyweaver.org.in/stories/369-the-red-raincoat",
		);
		expect(storyApiUrl("369-the-red-raincoat")).toBe(
			"https://storyweaver.org.in/node/api/v1/stories/369-the-red-raincoat",
		);
		expect(storyReadUrl("369")).toBe(
			"https://storyweaver.org.in/api/v1/stories/369/read?story_pages=true",
		);
	});
	it("should build catalogue urls with encoded filters", () => {
		expect(booksSearchUrl({ page: 1 })).toBe(
			"https://storyweaver.org.in/node/api/v1/books-search?page=1&per_page=20",
		);
		expect(
			booksSearchUrl({
				page: 0,
				query: "red raincoat",
				sort: "New Arrivals",
				language: "English",
			}),
		).toBe(
			"https://storyweaver.org.in/node/api/v1/books-search?page=1&per_page=20&query=red%20raincoat&sort=New%20Arrivals&languages%5B%5D=English",
		);
		expect(
			booksSearchUrl({ page: 3, sort: "Editor's Picks", perPage: 50 }),
		).toBe(
			"https://storyweaver.org.in/node/api/v1/books-search?page=3&per_page=50&sort=Editor's%20Picks",
		);
	});
	it("should decode entities and collapse whitespace", () => {
		expect(decodeEntities("Tom &amp; Jerry&#39;s &lt;big&gt; day")).toBe(
			"Tom & Jerry's <big> day",
		);
		expect(decodeEntities("&#x275B;&#955;")).toBe("❛λ");
		expect(cleanText("  a&#160;&nbsp;b  ")).toBe("a b");
		expect(cleanText(undefined)).toBe("");
	});
	it("should pick the largest image rendition", () => {
		expect(bestImageUrl(RED_RAINCOAT.coverImage)).toContain("size7");
		expect(bestImageUrl(READER_PAGES[2]?.coverImage)).toContain("4565/size7");
		expect(
			bestImageUrl({ sizes: [{ height: 5, width: 5, url: "https://a/b" }] }),
		).toBe("https://a/b");
		expect(bestImageUrl({ sizes: [{ url: "" }, {}] })).toBeUndefined();
		expect(bestImageUrl(undefined)).toBeUndefined();
	});
	it("should extract person names", () => {
		expect(personNames(RED_RAINCOAT.authors)).toEqual(["Kiran Kasturia"]);
		expect(personNames([{ name: " A " }, {}, { name: "" }])).toEqual(["A"]);
		expect(personNames(undefined)).toEqual([]);
	});
	it("should map languages to codes and dates to ISO", () => {
		expect(languageCode("English")).toBe("en");
		expect(languageCode("Hindi")).toBe("hi");
		expect(languageCode("Kokboroka")).toBe("Kokboroka");
		expect(languageCode(undefined)).toBe("");
		expect(parsePublishedDate("18-06-2015")).toBe("2015-06-18");
		expect(parsePublishedDate("8-6-2015")).toBe("2015-06-08");
		expect(parsePublishedDate("2015-06-18")).toBeUndefined();
		expect(parsePublishedDate(undefined)).toBeUndefined();
	});
	it("should format compact human counts", () => {
		expect(humanCount(406804)).toBe("407k");
		expect(humanCount(39617)).toBe("40k");
		expect(humanCount(4200)).toBe("4.2k");
		expect(humanCount(12_400_000)).toBe("12M");
		expect(humanCount(999)).toBe("999");
		expect(humanCount(0)).toBe("0");
		expect(humanCount(undefined)).toBeUndefined();
		expect(humanCount(-5)).toBeUndefined();
	});
	it("should map books to list entries", () => {
		const entry = bookToEntry(RED_RAINCOAT)!;
		expect(entry.id.uid).toBe("369-the-red-raincoat");
		expect(entry.url).toBe(
			"https://storyweaver.org.in/stories/369-the-red-raincoat",
		);
		expect(entry.title).toBe("The Red Raincoat");
		expect(entry.media_type).toBe("Comic");
		expect(entry.cover?.url).toContain("size7");
		expect(entry.author).toEqual(["Kiran Kasturia"]);
		// No slug: falls back to the numeric id; entities in titles decode.
		const idOnly = bookToEntry(ID_ONLY)!;
		expect(idOnly.id.uid).toBe("2");
		expect(idOnly.title).toBe("Smile & Wave");
		expect(idOnly.cover).toBeUndefined();
		expect(idOnly.author).toBeUndefined();
		expect(bookToEntry(BROKEN)).toBeNull();
		expect(booksToEntries([RED_RAINCOAT, BROKEN, {}]).length).toBe(1);
	});
	it("should order reader pages and trim attribution pages", () => {
		const urls = readerPageUrls(READER_PAGES);
		expect(urls.length).toBe(3);
		expect(urls[0]).toContain("4565");
		expect(urls[1]).toContain("4568");
		expect(urls[2]).toContain("4574");
		// Without the marker nothing is trimmed, but the imageless trailing
		// attribution page is still dropped by the image filter.
		const unmarked = READER_PAGES.filter(
			(page) => page.isLastStoryPage !== true,
		);
		expect(orderReaderPages(unmarked).length).toBe(2);
		expect(orderReaderPages([])).toEqual([]);
	});
	it("should map a story to a detail with a single Read episode", () => {
		const detail = storyToDetail(STORY_DETAIL, "369")!;
		expect(detail.id.uid).toBe("369");
		expect(detail.titles).toEqual(["The Red Raincoat"]);
		expect(detail.media_type).toBe("Comic");
		expect(detail.status).toBe("Complete");
		expect(detail.language).toBe("en");
		expect(detail.author).toEqual(["Kiran Kasturia"]);
		expect(detail.description).toBe("Manu has a new raincoat.");
		expect(detail.episodes.length).toBe(1);
		expect(detail.episodes[0]!.name).toBe("Read");
		expect(detail.episodes[0]!.id.uid).toBe("369-the-red-raincoat");
		expect(detail.episodes[0]!.url).toBe(
			"https://storyweaver.org.in/stories/369-the-red-raincoat",
		);
		expect(detail.meta).toEqual({
			Level: "Level 1",
			Publisher: "Pratham Books",
			Published: "2015-06-18",
			Reads: "407k",
			Likes: "40k",
		});
		expect(storyToDetail({ name: "   " }, "369")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Live flow against storyweaver.org.in through the built extension
// ---------------------------------------------------------------------------

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	// The host persists its cookie jar under .dist/<name>/.cookies and
	// StoryWeaver only serves a few anonymous story reads per `_session_id`,
	// so start every test run with a clean jar and thus a fresh session.
	try {
		rmSync(join(import.meta.path, "../../.dist/storyweaver/.cookies"), {
			force: true,
		});
	} catch {
		// No jar from a previous run - nothing to clean.
	}
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
				expect.arrayContaining([
					"storyweaver.org.in",
					"storage.googleapis.com",
				]),
			);
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(20);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(entry.id.uid.length).toBeGreaterThan(0);
			expect(entry.cover?.url).toStartWith("https://storage.googleapis.com/");
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "tiger");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
		}
		await assertValidEntries(result.content);
	}, 120_000);
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
		expect(result.entry.episodes[0]!.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.episodes[0]!.url).toBe(browseResult[0]!.url);
		expect(result.entry.ui).toBeDefined();
		// Attribution text is part of the custom UI.
		expect(JSON.stringify(result.entry.ui)).toContain("CC BY 4.0");
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
			expect(result.source.links.length).toBeGreaterThan(1);
			for (const link of result.source.links) {
				expect(link.url).toStartWith("https://storage.googleapis.com/");
			}
			expect(result.source.audio).toBeNull();
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 60_000);
	it("should serve a known book with its attribution pages trimmed", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "369-the-red-raincoat" }, {});
		expect(result.entry.id.uid).toBe("369-the-red-raincoat");
		expect(result.entry.titles).toEqual(["The Red Raincoat"]);
		expect(result.entry.language).toBe("en");
		expect(result.entry.episodes[0]!.id.uid).toBe("369-the-red-raincoat");
		const sourced = await extension!.source(
			result.entry.episodes[0]!.id,
			result.settings,
		);
		expect(sourced.source.type).toBe("Imagelist");
		if (sourced.source.type === "Imagelist") {
			// The live story has 10 illustrated pages; trailing attribution
			// pages (without images) must be trimmed from the reading order.
			expect(sourced.source.links.length).toBeGreaterThanOrEqual(5);
			expect(sourced.source.links[0]!.url).toContain("/4565/");
		}
		await assertValidSource(sourced.source);
	}, 60_000);
	it("should reject empty and unknown entry ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: " " }, {})).rejects.toThrow();
		await expect(
			extension!.detail({ uid: "999999999-not-a-real-story" }, {}),
		).rejects.toThrow();
	}, 30_000);
});
