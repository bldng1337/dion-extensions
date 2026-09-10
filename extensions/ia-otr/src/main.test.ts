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
	audioFormatRank,
	buildSearchQuery,
	coverUrl,
	decodeEntities,
	detailsUrl,
	episodeUid,
	fileStem,
	fileUrl,
	humanDuration,
	humanRuntime,
	isRestricted,
	normalizeDescription,
	parseEpisodeUid,
	pickEpisodeFiles,
	publicationYear,
	SERIES,
	sanitizeQueryTerm,
	type IaFileEntry,
} from "./otr.ts";

let extension: Extension;

let browseResult: Entry[];
let searchResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
	searchResult = [];
});

describe("ia otr helpers", () => {
	it("should sanitize user text out of query syntax", () => {
		expect(sanitizeQueryTerm('x "minus" one')).toBe("x minus one");
		expect(sanitizeQueryTerm("title:foo")).toBe("title foo");
		expect(sanitizeQueryTerm("x(y)[z]{w}")).toBe("x y z w");
		expect(sanitizeQueryTerm("   ")).toBe("");
	});

	it("should build oldtimeradio-restricted search queries", () => {
		expect(buildSearchQuery("x minus one")).toBe(
			"collection:oldtimeradio AND mediatype:audio AND -access-restricted-item:true AND title:(x minus one)",
		);
		expect(buildSearchQuery("jack (benny)")).toBe(
			"collection:oldtimeradio AND mediatype:audio AND -access-restricted-item:true AND title:(jack benny)",
		);
	});

	it("should rank playable formats and reject the rest", () => {
		expect(audioFormatRank("128Kbps MP3")).toBe(4);
		expect(audioFormatRank("VBR MP3")).toBe(3);
		expect(audioFormatRank("64Kbps MP3")).toBe(2);
		expect(audioFormatRank("32Kbps MP3")).toBe(1);
		expect(audioFormatRank("Ogg Vorbis")).toBe(0);
		expect(audioFormatRank("ogg")).toBe(0);
		expect(audioFormatRank("Text")).toBeUndefined();
		expect(audioFormatRank("PNG")).toBeUndefined();
		expect(audioFormatRank("")).toBeUndefined();
	});

	it("should pick one best file per episode, skipping non-audio", () => {
		const files: IaFileEntry[] = [
			// Episode 1: original VBR beats its 64kb/ogg derivatives.
			{
				name: "Ep1.mp3",
				format: "VBR MP3",
				title: "Episode 1",
				length: "1678.48",
			},
			{ name: "Ep1_64kb.mp3", format: "64Kbps MP3" },
			{ name: "Ep1.ogg", format: "Ogg Vorbis" },
			// Episode 2: only a 128kbps derivative exists.
			{
				name: "Ep2.mp3",
				format: "128Kbps MP3",
				title: "  Episode 2  ",
				length: "22:04",
			},
			// Episode 3: the 128kb derivative beats the VBR original.
			{ name: "Ep3.mp3", format: "VBR MP3" },
			{ name: "Ep3_128kb.mp3", format: "128Kbps MP3", title: "Episode 3" },
			// Junk that must be skipped.
			{ name: "Ep1_spectrogram.png", format: "PNG" },
			{ name: "Ep1_meta.xml", format: "Metadata" },
			{ format: "VBR MP3" },
			{ name: "Nameless.mp3" },
		];
		expect(pickEpisodeFiles(files)).toEqual([
			{ name: "Ep1.mp3", title: "Episode 1", length: "1678.48" },
			{ name: "Ep2.mp3", title: "Episode 2", length: "22:04" },
			{ name: "Ep3_128kb.mp3", title: "Episode 3", length: undefined },
		]);
	});

	it("should fall back to ogg for items without mp3s", () => {
		expect(
			pickEpisodeFiles([
				{ name: "a.ogg", format: "Ogg Vorbis", length: "600" },
				{ name: "b.flac", format: "Flac" },
			]),
		).toEqual([{ name: "a.ogg", title: undefined, length: "600" }]);
		expect(pickEpisodeFiles(undefined)).toEqual([]);
		expect(pickEpisodeFiles([{ name: "a.txt", format: "Text" }])).toEqual([]);
	});

	it("should strip derivative suffixes from file names", () => {
		expect(fileStem("Theater_Five_64-08-03_ep001_Hit_and_Run_64kb.mp3")).toBe(
			"Theater_Five_64-08-03_ep001_Hit_and_Run",
		);
		expect(fileStem("XMinusOne55-04-24001NoContact.mp3")).toBe(
			"XMinusOne55-04-24001NoContact",
		);
		expect(fileStem("Show_55-04-24_ep_vbr.ogg")).toBe("Show_55-04-24_ep");
	});

	it("should roundtrip episode ids with awkward file names", () => {
		const uid = episodeUid("an-item", "Ep 1 #2 (remix).mp3");
		expect(parseEpisodeUid(uid)).toEqual({
			identifier: "an-item",
			fileName: "Ep 1 #2 (remix).mp3",
		});
		expect(parseEpisodeUid("no-hash")).toBeNull();
		expect(parseEpisodeUid("")).toBeNull();
		expect(parseEpisodeUid("#name.mp3")).toBeNull();
		expect(parseEpisodeUid("id#")).toBeNull();
		expect(parseEpisodeUid("id#%zzbad")).toBeNull();
	});

	it("should format file lengths as human runtimes", () => {
		expect(humanRuntime(4320)).toBe("1h 12m");
		expect(humanRuntime(1800)).toBe("30m");
		expect(humanDuration("1678.48")).toBe("28m");
		expect(humanDuration("22:04")).toBe("22:04");
		expect(humanDuration("1:02:03")).toBe("1:02:03");
		expect(humanDuration("not a time")).toBeUndefined();
		expect(humanDuration(undefined)).toBeUndefined();
	});

	it("should decode entities and normalize descriptions", () => {
		expect(decodeEntities("A &amp; B &#039;s &quot;q&quot;")).toBe(
			'A & B \'s "q"',
		);
		expect(normalizeDescription(undefined)).toBe("");
		expect(normalizeDescription(["Para one", "Para two"])).toBe(
			"Para one\n\nPara two",
		);
		expect(
			normalizeDescription("<p>Hello <b>world</b> &amp; friends</p>"),
		).toBe("Hello world & friends");
		const long = `${"A".repeat(60)}. ${"B".repeat(2000)}`;
		expect(normalizeDescription(long, 100)).toBe(`${"A".repeat(60)} […]`);
	});

	it("should read restriction flags and years from metadata", () => {
		expect(isRestricted({ "access-restricted-item": "true" })).toBe(true);
		expect(isRestricted({ "access-restricted-item": true })).toBe(true);
		expect(isRestricted({ identifier: "x" })).toBe(false);
		expect(isRestricted(undefined)).toBe(false);
		expect(publicationYear({ year: 1952 })).toBe("1952");
		expect(publicationYear({ date: "1952-09-06" })).toBe("1952");
		expect(publicationYear({})).toBeUndefined();
	});

	it("should encode archive urls", () => {
		expect(detailsUrl("an item")).toBe("https://archive.org/details/an%20item");
		expect(coverUrl("an-item")).toBe(
			"https://archive.org/services/img/an-item",
		);
		expect(fileUrl("an-item", "Ep 1.mp3")).toBe(
			"https://archive.org/download/an-item/Ep%201.mp3",
		);
	});

	it("should curate unique, verified series", () => {
		expect(SERIES.length).toBeGreaterThan(15);
		const ids = SERIES.map((s) => s.identifier);
		expect(new Set(ids).size).toBe(ids.length);
		for (const seed of SERIES) {
			expect(seed.name.length).toBeGreaterThan(0);
			expect(seed.identifier.length).toBeGreaterThan(0);
		}
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
			expect(network.domains).toEqual(
				expect.arrayContaining(["archive.org", "www.archive.org"]),
			);
		}
	});

	it("should be able to browse curated series", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
			expect(entry.url).toStartWith("https://archive.org/details/");
		}
		// assertValidEntries checks cover URLs live; only run it on the first
		// entries so one flaky archive.org thumbnail response (502/504) cannot
		// fail the whole 20-entry page.
		await assertValidEntries(result.content.slice(0, 3));
		browseResult = result.content;
	}, 60_000);
	it("should page through the series list to the end", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page = await extension!.browse(1);
		await assertValidEntries(page.content);
		// 21 curated series at 20 per page: page 2 holds the remainder.
		expect(page.content.length + browseResult.length).toBeGreaterThanOrEqual(
			21,
		);
		expect(page.hasnext).toBe(false);
	}, 60_000);

	it("should be able to search for a series", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "x minus one");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
		}
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("x minus"))).toBe(true);
		searchResult = result.content;
	}, 60_000);

	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should be able to detail a searched series", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (searchResult === undefined || (searchResult?.length ?? 0) <= 0)
			throw new Error("No search result");
		const result = await extension!.detail(searchResult[0]!.id, {});
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.id.uid).toBe(searchResult[0]!.id.uid);
		expect(entry.media_type).toBe("Audio");
		expect(entry.status).toBe("Complete");
		expect(entry.titles[0]!.length).toBeGreaterThan(0);
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
		// Full-series sets hold every episode as its own MP3.
		expect(entry.episodes.length).toBeGreaterThan(10);
		for (const episode of entry.episodes.slice(0, 5)) {
			expect(episode.name.length).toBeGreaterThan(0);
			expect(episode.url).toStartWith("https://archive.org/download/");
			expect(episode.id.uid).toContain("#");
		}
		expect(result.settings).toEqual({});
		detailResult = result;
		await assertValidEntry(entry);
	}, 120_000);

	it("should be able to source an episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			detailResult.settings as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBe(1);
			const stream = result.source.sources[0]!;
			expect(stream.lang).toBe("en");
			expect(stream.url.url).toStartWith("https://archive.org/download/");
			expect(stream.url.url).toMatch(/\.mp3$/);
			expect(stream.name.length).toBeGreaterThan(0);
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 60_000);

	it("should detail a huge curated set with hundreds of episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		// The first curated series (Suspense) carries 900+ episode files.
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result.entry.episodes.length).toBeGreaterThan(100);
		expect(result.entry.episodes[0]!.id.uid).toContain("#");
		await assertValidEntry(result.entry);
		// And one of its episodes must resolve to a stream.
		const source = await extension!.source(result.entry.episodes[0]!.id, {});
		expect(source.source.type).toBe("Audio");
		await assertValidSource(source.source);
	}, 240_000);

	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	});

	it("should reject items without playable audio", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// Unknown identifier: the metadata endpoint answers {} with no files.
		await expect(
			extension!.detail({ uid: "ia-otr-no-such-item-xyz" }, {}),
		).rejects.toThrow();
	}, 60_000);
});
