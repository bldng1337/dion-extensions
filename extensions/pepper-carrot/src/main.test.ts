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
	AUTHOR,
	decodeHtmlEntities,
	type EpisodeMeta,
	episodeNumber,
	episodePageUrl,
	episodeToDetail,
	episodeToEntry,
	fallbackTitle,
	isEpisodeSlug,
	isPageImageUrl,
	LANGUAGES,
	listingUrl,
	matchesEpisode,
	normalizeLang,
	pageImagesFromSrcs,
	pageNumber,
	paginate,
	publishedDateFromCaption,
	cleanText,
	slugFromUrl,
} from "./peppercarrot.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from the live site)
// ---------------------------------------------------------------------------

const EP39_META: EpisodeMeta = {
	slug: "ep39_The-Tavern",
	title: "Episode 39: The Tavern",
	url: "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
	thumb:
		"https://www.peppercarrot.com/cache/gfx_Pepper-and-Carrot_by-David-Revoy_E39_480x399px_89q_330229.jpg",
	published: "2025-11-12",
};

const EP08_META: EpisodeMeta = {
	slug: "ep08_Pepper-s-Birthday-Party",
	title: "Episode 8: Pepper's Birthday Party",
	url: "https://www.peppercarrot.com/en/webcomic/ep08_Pepper-s-Birthday-Party.html",
	published: "2016-06-03",
};

/** Episode page image URLs, deliberately unsorted and mixed with site chrome. */
const UNORDERED_SRCS = [
	"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P10.jpg",
	"https://www.peppercarrot.com/core/img/nav-first.svg",
	"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P02.jpg",
	"https://www.peppercarrot.com/cache/gfx_Pepper-and-Carrot_by-David-Revoy_E39_480x399px_89q_330229.jpg",
	"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P00.jpg",
	"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P01.jpg",
];

// ---------------------------------------------------------------------------
// Unit tests for the mapping helpers
// ---------------------------------------------------------------------------

describe("pepper-carrot helpers", () => {
	it("should build listing and episode urls", () => {
		expect(listingUrl("en")).toBe(
			"https://www.peppercarrot.com/en/webcomics/peppercarrot.html",
		);
		expect(listingUrl("de")).toBe(
			"https://www.peppercarrot.com/de/webcomics/peppercarrot.html",
		);
		expect(episodePageUrl("en", "ep01_Potion-of-Flight")).toBe(
			"https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html",
		);
	});
	it("should extract episode slugs from hrefs", () => {
		expect(
			slugFromUrl(
				"https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
			),
		).toBe("ep39_The-Tavern");
		expect(
			slugFromUrl(
				"https://www.peppercarrot.com/en/webcomic/ep08_Pepper-s-Birthday-Party.html",
			),
		).toBe("ep08_Pepper-s-Birthday-Party");
		expect(slugFromUrl("https://www.peppercarrot.com/en/")).toBeNull();
		expect(slugFromUrl("https://example.com/webcomic/other.html")).toBeNull();
	});
	it("should validate slugs and read the episode number", () => {
		expect(episodeNumber("ep39_The-Tavern")).toBe(39);
		expect(episodeNumber("ep08_Pepper-s-Birthday-Party")).toBe(8);
		expect(episodeNumber("ep1_Foo")).toBe(1);
		expect(episodeNumber("nope")).toBeNull();
		expect(episodeNumber("ep")).toBeNull();
		expect(isEpisodeSlug("ep39_The-Tavern")).toBe(true);
		expect(isEpisodeSlug("episode-39")).toBe(false);
	});
	it("should decode HTML entities in text and attributes", () => {
		expect(decodeHtmlEntities("Pepper&amp;Carrot")).toBe("Pepper&Carrot");
		expect(decodeHtmlEntities("Pepper&#39;s Birthday")).toBe(
			"Pepper's Birthday",
		);
		expect(decodeHtmlEntities("&#x27;quoted&#x27;")).toBe("'quoted'");
		expect(decodeHtmlEntities("100&#37; complete")).toBe("100% complete");
		expect(decodeHtmlEntities("a&nbsp;b")).toBe("a\u00a0b");
		expect(decodeHtmlEntities("&unknown; &amp;")).toBe("&unknown; &");
		expect(decodeHtmlEntities("plain text")).toBe("plain text");
	});
	it("should clean whitespace and entities out of scraped text", () => {
		expect(cleanText("  Episode 39:   The Tavern ")).toBe(
			"Episode 39: The Tavern",
		);
		expect(cleanText("Pepper&amp;Carrot\n and  friends")).toBe(
			"Pepper&Carrot and friends",
		);
		expect(cleanText("Published&nbsp;on&nbsp;2025-11-12.")).toBe(
			"Published on 2025-11-12.",
		);
	});
	it("should read the publication date from listing captions", () => {
		expect(publishedDateFromCaption("Published on 2025-11-12.")).toBe(
			"2025-11-12",
		);
		expect(publishedDateFromCaption("no date here")).toBeNull();
	});
	it("should read page numbers from image urls", () => {
		expect(
			pageNumber(
				"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P00.jpg",
			),
		).toBe(0);
		expect(
			pageNumber(
				"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P12.jpg",
			),
		).toBe(12);
		expect(
			pageNumber(
				"https://www.peppercarrot.com/0_sources/ep01_Potion-of-Flight/low-res/en_Pepper-and-Carrot_by-David-Revoy_E01P7.png",
			),
		).toBe(7);
		expect(
			pageNumber("https://www.peppercarrot.com/core/img/nav-first.svg"),
		).toBe(null);
		expect(
			isPageImageUrl(
				"https://www.peppercarrot.com/0_sources/ep39_The-Tavern/low-res/en_Pepper-and-Carrot_by-David-Revoy_E39P01.jpg",
			),
		).toBe(true);
		expect(
			isPageImageUrl(
				"https://www.peppercarrot.com/cache/gfx_Pepper-and-Carrot_by-David-Revoy_E39_480x399px_89q_330229.jpg",
			),
		).toBe(false);
	});
	it("should filter and sort page images into reading order", () => {
		const pages = pageImagesFromSrcs(UNORDERED_SRCS);
		expect(pages.length).toBe(4);
		expect(pages[0]).toEndWith("_E39P00.jpg");
		expect(pages[1]).toEndWith("_E39P01.jpg");
		expect(pages[2]).toEndWith("_E39P02.jpg");
		expect(pages[3]).toEndWith("_E39P10.jpg");
		// Numeric, not lexicographic ordering (lexicographic would sort P10
		// before P2): the exact sequence above already proves it.
		// Already-ordered input is kept as-is.
		expect(pageImagesFromSrcs([...pages])).toEqual(pages);
		expect(pageImagesFromSrcs([])).toEqual([]);
	});
	it("should match episodes against title and slug", () => {
		expect(matchesEpisode(EP39_META, "tavern")).toBe(true);
		expect(matchesEpisode(EP08_META, "PEPPER")).toBe(true);
		expect(matchesEpisode(EP39_META, "ep39")).toBe(true);
		expect(matchesEpisode(EP08_META, "tavern")).toBe(false);
		expect(matchesEpisode(EP39_META, "   ")).toBe(false);
	});
	it("should normalize language codes", () => {
		expect(normalizeLang("en")).toBe("en");
		expect(normalizeLang(" FR ")).toBe("fr");
		expect(normalizeLang("xx")).toBe("en");
		expect(normalizeLang(undefined)).toBe("en");
		expect(normalizeLang("")).toBe("en");
	});
	it("should offer a sane language dropdown", () => {
		const values = LANGUAGES.map((l) => l.value);
		expect(values[0]).toBe("en");
		expect(new Set(values).size).toBe(values.length);
		for (const value of values) {
			expect(value).toMatch(/^[a-z]{2}$/);
			expect(normalizeLang(value)).toBe(value);
		}
	});
	it("should derive a readable fallback title from a slug", () => {
		expect(fallbackTitle("ep39_The-Tavern")).toBe("Episode 39: The Tavern");
		expect(fallbackTitle("ep05_Special-holiday-episode")).toBe(
			"Episode 5: Special holiday episode",
		);
		expect(fallbackTitle("ep7")).toBe("Episode 7");
	});
	it("should map a listing row to a list entry", () => {
		const entry = episodeToEntry(EP39_META)!;
		expect(entry.id.uid).toBe("ep39_The-Tavern");
		expect(entry.url).toBe(
			"https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
		);
		expect(entry.title).toBe("Episode 39: The Tavern");
		expect(entry.media_type).toBe("Comic");
		expect(entry.cover?.url).toContain("/cache/");
		expect(entry.author).toEqual([AUTHOR]);
		const noThumb = episodeToEntry(EP08_META)!;
		expect(noThumb.cover).toBeUndefined();
		expect(episodeToEntry({ ...EP39_META, slug: "not-a-slug" })).toBeNull();
	});
	it("should map a listing row to a detail with a single Read episode", () => {
		const detail = episodeToDetail(EP39_META, "en", 13);
		expect(detail.id.uid).toBe("ep39_The-Tavern");
		expect(detail.titles).toEqual(["Episode 39: The Tavern"]);
		expect(detail.media_type).toBe("Comic");
		expect(detail.status).toBe("Complete");
		expect(detail.language).toBe("en");
		expect(detail.author).toEqual([AUTHOR]);
		expect(detail.episodes.length).toBe(1);
		expect(detail.episodes[0]!.name).toBe("Read");
		expect(detail.episodes[0]!.id.uid).toBe("ep39_The-Tavern");
		expect(detail.description).toContain("David Revoy");
		expect(detail.description).toContain("Published on 2025-11-12.");
		expect(detail.description).toContain("13 pages.");
		expect(detail.meta).toEqual({ Published: "2025-11-12" });
		expect(detail.cover?.url).toContain("/cache/");
		// Falls back to the first page image when no thumbnail is known.
		const bare = episodeToDetail(
			EP08_META,
			"de",
			6,
			"https://example.com/p0.jpg",
		);
		expect(bare.cover?.url).toBe("https://example.com/p0.jpg");
		expect(bare.language).toBe("de");
	});
	it("should paginate the episode list", () => {
		const items = [1, 2, 3, 4, 5];
		expect(paginate(items, 0, 3)).toEqual({
			content: [1, 2, 3],
			hasnext: true,
		});
		expect(paginate(items, 1, 3)).toEqual({ content: [4, 5], hasnext: false });
		expect(paginate(items, 2, 3)).toEqual({ content: [], hasnext: false });
		expect(paginate(items, -1, 3).content).toEqual([1, 2, 3]);
	});
});

// ---------------------------------------------------------------------------
// Live flow against peppercarrot.com through the built extension
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
			expect(network.domains).toEqual(["www.peppercarrot.com"]);
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(30);
		expect(result.content.length).toBeLessThanOrEqual(40);
		expect(result.hasnext).toBe(false);
		for (let i = 0; i < result.content.length; i++) {
			const entry = result.content[i]!;
			expect(entry.media_type).toBe("Comic");
			expect(isEpisodeSlug(entry.id.uid)).toBe(true);
			expect(entry.url).toContain(`/${entry.id.uid}.html`);
			expect(entry.title.toLowerCase()).toContain("episode");
			expect(entry.author).toEqual([AUTHOR]);
			if (entry.cover) {
				expect(entry.cover.url).toStartWith("https://www.peppercarrot.com/");
			}
			if (i > 0) {
				// Newest-first ordering.
				expect(episodeNumber(entry.id.uid)).toBeLessThan(
					episodeNumber(result.content[i - 1]!.id.uid) as number,
				);
			}
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should return nothing past the last page", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(1);
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 60_000);
	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "pepper");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
		}
		// Episode 8 is "Pepper's Birthday Party".
		expect(
			result.content.some((e) => e.id.uid === "ep08_Pepper-s-Birthday-Party"),
		).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);
	it("should also find episodes by number", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "39");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.some((e) => e.id.uid === "ep39_The-Tavern")).toBe(
			true,
		);
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
		const first = browseResult[0]!;
		const result = await extension!.detail(first.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(first.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.name).toBe("Read");
		expect(result.entry.episodes[0]!.id.uid).toBe(first.id.uid);
		expect(result.entry.episodes[0]!.url).toBe(first.url);
		expect(result.entry.description).toContain("David Revoy");
		expect(result.entry.description).toContain("CC BY 4.0");
		expect(result.entry.language).toBe("en");
		expect(result.entry.cover?.url).toStartWith(
			"https://www.peppercarrot.com/",
		);
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
		expect(result.settings).toEqual(detailResult.settings);
		if (result.source.type === "Imagelist") {
			expect(result.source.links.length).toBeGreaterThanOrEqual(6);
			expect(result.source.audio).toBeNull();
			let previousPage = -1;
			for (const link of result.source.links) {
				expect(link.url).toStartWith(
					`https://www.peppercarrot.com/0_sources/${detailResult!.entry.id.uid}/`,
				);
				const page = pageNumber(link.url);
				expect(page).not.toBeNull();
				// Strict reading order, header page (P00) first.
				expect(page!).toBeGreaterThan(previousPage);
				previousPage = page!;
			}
		}
		await assertValidSource(result.source);
	}, 60_000);
	it("should source an early episode with few pages", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const detail = await extension!.detail(
			{ uid: "ep01_Potion-of-Flight" },
			{},
		);
		expect(detail.entry.id.uid).toBe("ep01_Potion-of-Flight");
		expect(detail.entry.description).toContain("pages.");
		const sourced = await extension!.source(
			detail.entry.episodes[0]!.id,
			detail.settings,
		);
		expect(sourced.source.type).toBe("Imagelist");
		if (sourced.source.type === "Imagelist") {
			expect(sourced.source.links.length).toBeGreaterThanOrEqual(5);
			for (const link of sourced.source.links) {
				expect(link.url).toContain("/0_sources/ep01_Potion-of-Flight/low-res/");
			}
		}
		await assertValidSource(sourced.source);
	}, 60_000);
	it("should reject malformed entry and episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.detail({ uid: "not-a-slug" }, {}),
		).rejects.toThrow();
		await expect(
			extension!.source({ uid: "also-not-a-slug" }, {}),
		).rejects.toThrow();
	}, 30_000);
});
