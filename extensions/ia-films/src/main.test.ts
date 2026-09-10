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
	buildQuery,
	clockRuntime,
	COLLECTIONS,
	COLLECTION_SETTING_ID,
	coverUrl,
	decodeEntities,
	detailsUrl,
	episodeUid,
	fileStem,
	fileUrl,
	humanRuntime,
	isRestricted,
	metadataRuntime,
	normalizeDescription,
	parseEpisodeUid,
	parseLength,
	pickVideos,
	publicationYear,
	sanitizeQueryTerm,
	selectVideos,
	splitGenres,
	stemToTitle,
	videoFormatRank,
	type IaVideoFile,
	type PickedVideo,
} from "./films.ts";

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

describe("ia films helpers", () => {
	it("should sanitize user text out of query syntax", () => {
		expect(sanitizeQueryTerm('charade "1963"')).toBe("charade 1963");
		expect(sanitizeQueryTerm("title:nosferatu")).toBe("title nosferatu");
		expect(sanitizeQueryTerm("duck (and) [cover]")).toBe("duck and cover");
		expect(sanitizeQueryTerm("   ")).toBe("");
	});

	it("should build openly-downloadable movie search queries", () => {
		expect(buildQuery({ collection: "feature_films" })).toBe(
			'mediatype:movies AND -access-restricted-item:true AND format:("h.264" OR "h.264 IA" OR "MPEG4" OR "512Kb MPEG4" OR "HiRes MPEG4" OR "Ogg Video") AND collection:feature_films',
		);
		expect(
			buildQuery({ collection: "prelinger", term: "duck and cover" }),
		).toBe(
			'mediatype:movies AND -access-restricted-item:true AND format:("h.264" OR "h.264 IA" OR "MPEG4" OR "512Kb MPEG4" OR "HiRes MPEG4" OR "Ogg Video") AND collection:prelinger AND title:(duck and cover)',
		);
		expect(buildQuery({ term: "flash (gordon)" })).toBe(
			'mediatype:movies AND -access-restricted-item:true AND format:("h.264" OR "h.264 IA" OR "MPEG4" OR "512Kb MPEG4" OR "HiRes MPEG4" OR "Ogg Video") AND collection:feature_films AND title:(flash gordon)',
		);
	});

	it("should rank streamable video formats and reject the rest", () => {
		expect(videoFormatRank({ name: "a.mp4", format: "h.264 IA" })).toBe(9);
		expect(videoFormatRank({ name: "a.mp4", format: "h.264" })).toBe(8);
		expect(videoFormatRank({ name: "a.mp4", format: "HiRes MPEG4" })).toBe(7);
		expect(videoFormatRank({ name: "a.mp4", format: "MPEG4" })).toBe(6);
		expect(videoFormatRank({ name: "a.mp4", format: "512Kb MPEG4" })).toBe(5);
		expect(videoFormatRank({ name: "a.ogv", format: "Ogg Video" })).toBe(4);
		expect(videoFormatRank({ name: "a.mkv", format: "Matroska" })).toBe(3);
		expect(videoFormatRank({ name: "a.mov", format: "QuickTime" })).toBe(2);
		expect(videoFormatRank({ name: "a.mpeg", format: "MPEG2" })).toBe(1);
		// Sloppily tagged uploads: plain video extensions are still playable.
		expect(videoFormatRank({ name: "a.mp4", format: "" })).toBe(2);
		expect(videoFormatRank({ name: "a.mp4" })).toBe(2);
		expect(videoFormatRank({ name: "a.bin", format: "" })).toBeUndefined();
		// Junk that must never surface.
		expect(videoFormatRank({ name: "a.png", format: "PNG" })).toBeUndefined();
		expect(
			videoFormatRank({ name: "a.jpg", format: "Thumbnail" }),
		).toBeUndefined();
		expect(
			videoFormatRank({ name: "a.gif", format: "Animated GIF" }),
		).toBeUndefined();
		expect(
			videoFormatRank({ name: "a.torrent", format: "Archive BitTorrent" }),
		).toBeUndefined();
		expect(
			videoFormatRank({ name: "a.xml", format: "Metadata" }),
		).toBeUndefined();
	});

	it("should strip derivative suffixes from video file names", () => {
		expect(fileStem("DuckandC1951.ia.mp4")).toBe("DuckandC1951");
		expect(fileStem("DuckandC1951_512kb.mp4")).toBe("DuckandC1951");
		expect(fileStem("DuckandC1951_edit.mp4")).toBe("DuckandC1951");
		expect(fileStem("DuckandC1951.mpeg")).toBe("DuckandC1951");
		expect(fileStem("DuckandC1951.ogv")).toBe("DuckandC1951");
		expect(fileStem("VTS_01_1.mp4")).toBe("VTS_01_1");
	});

	it("should pick one best file per video, skipping non-video files", () => {
		// Real derivative layout of the "Duck and Cover" (1951) item.
		const files: IaVideoFile[] = [
			{ name: "DuckandC1951.ia.mp4", format: "h.264 IA", length: "554.99" },
			{ name: "DuckandC1951.mp4", format: "MPEG4", length: "554.95" },
			{
				name: "DuckandC1951_edit.mp4",
				format: "HiRes MPEG4",
				length: "555.18",
			},
			{ name: "DuckandC1951_512kb.mp4", format: "512Kb MPEG4" },
			{ name: "DuckandC1951.ogv", format: "Ogg Video" },
			{ name: "DuckandC1951.mpeg", format: "MPEG2" },
			// Junk that must be skipped.
			{
				name: "DuckandC1951.thumbs/DuckandC1951_000001.jpg",
				format: "Thumbnail",
			},
			{ name: "DuckandC1951_archive.torrent", format: "Archive BitTorrent" },
			{ name: "__ia_thumb.jpg", format: "Item Tile" },
			{ format: "h.264" },
			{ name: "Nameless.bin" },
		];
		expect(pickVideos(files)).toEqual([
			{
				name: "DuckandC1951.ia.mp4",
				title: undefined,
				duration: 555,
				size: undefined,
			},
		]);
	});

	it("should fall back to ogv/mpeg2 derivatives for items without h.264", () => {
		// Real derivative layout of the "Flash Gordon" chapter items.
		const files: IaVideoFile[] = [
			{ name: "flash_gordon_ep01.mpeg", format: "MPEG2", length: "1106.41" },
			{
				name: "flash_gordon_ep01.ogv",
				format: "Ogg Video",
				length: "1106.47",
			},
			{
				name: "flash_gordon_ep01_512kb.mp4",
				format: "512Kb MPEG4",
				length: "1106.47",
			},
		];
		expect(pickVideos(files)).toEqual([
			{
				name: "flash_gordon_ep01_512kb.mp4",
				title: undefined,
				duration: 1106,
				size: undefined,
			},
		]);
		expect(pickVideos(undefined)).toEqual([]);
		expect(pickVideos([{ name: "a.txt", format: "Text" }])).toEqual([]);
	});

	it("should expose a dominant feature plus extras as a single Watch", () => {
		// Real derivative layout of the "night_of_the_living_dead_dvd" item:
		// full feature + DVD split parts + 10s VIDEO_TS lead-in.
		const videos: PickedVideo[] = [
			{ name: "Night.mp4", duration: 5732, size: 596399542 },
			{ name: "Night.ogv", duration: 5732, size: 441276820 },
			{ name: "VIDEO_TS.mp4", duration: 10, size: 879152 },
			{ name: "VTS_01_1.mp4", duration: 2520, size: 262619874 },
			{ name: "VTS_01_2.mp4", duration: 2536, size: 264385830 },
			{ name: "VTS_01_3.mp4", duration: 662, size: 68807560 },
		];
		const selection = selectVideos(pickVideos(filesFromVideos(videos)));
		expect(selection).toEqual({
			mode: "single",
			video: { name: "Night.mp4", duration: 5732, size: 596399542 },
		});
	});

	it("should expose comparable videos as multi-part episodes", () => {
		// A DVD rip split into parts with no full-length file: every part is
		// an episode, but the 10s junk lead-in is dropped.
		const parts: PickedVideo[] = [
			{ name: "VIDEO_TS.mp4", duration: 10 },
			{ name: "VTS_01_1.mp4", duration: 2520 },
			{ name: "VTS_01_2.mp4", duration: 2536 },
			{ name: "VTS_01_3.mp4", duration: 662 },
		];
		const selection = selectVideos(pickVideos(filesFromVideos(parts)));
		expect(selection.mode).toBe("multi");
		if (selection.mode === "multi") {
			expect(selection.videos.map((v) => v.name)).toEqual([
				"VTS_01_1.mp4",
				"VTS_01_2.mp4",
				"VTS_01_3.mp4",
			]);
		}
		// A single-item serial upload: chapters of comparable runtime.
		const chapters: PickedVideo[] = [
			{ name: "ch1.mp4", duration: 1140 },
			{ name: "ch2.mp4", duration: 1150 },
			{ name: "ch3.mp4", duration: 1130 },
		];
		const serial = selectVideos(pickVideos(filesFromVideos(chapters)));
		expect(serial.mode).toBe("multi");
	});

	it("should fall back to the largest file when durations are unknown", () => {
		const selection = selectVideos([
			{ name: "a.mp4", size: 100 },
			{ name: "b.mp4", size: 300 },
		]);
		expect(selection).toEqual({
			mode: "single",
			video: { name: "b.mp4", size: 300 },
		});
		expect(selectVideos([])).toEqual({ mode: "none" });
	});

	it("should roundtrip episode ids with awkward file names", () => {
		const uid = episodeUid("an-item", "Chapter 1 #2 (remix).mp4");
		expect(parseEpisodeUid(uid)).toEqual({
			identifier: "an-item",
			fileName: "Chapter 1 #2 (remix).mp4",
		});
		expect(parseEpisodeUid("no-hash")).toBeNull();
		expect(parseEpisodeUid("")).toBeNull();
		expect(parseEpisodeUid("#name.mp4")).toBeNull();
		expect(parseEpisodeUid("id#")).toBeNull();
		expect(parseEpisodeUid("id#%zzbad")).toBeNull();
	});

	it("should parse and format runtimes", () => {
		expect(humanRuntime(4320)).toBe("1h 12m");
		expect(humanRuntime(555)).toBe("9m");
		expect(clockRuntime(555)).toBe("9:15");
		expect(clockRuntime(4466)).toBe("1:14:26");
		expect(parseLength("554.99")).toBe(555);
		expect(parseLength("9:15")).toBe(555);
		expect(parseLength("1:17:26")).toBe(4646);
		// Decimal seconds in clock strings must not leak floats into ids.
		expect(parseLength("1:33.13")).toBe(93);
		expect(parseLength("not a time")).toBeUndefined();
		expect(parseLength(undefined)).toBeUndefined();
		expect(metadataRuntime({ runtime: "9:15" })).toBe(555);
		expect(metadataRuntime({})).toBeUndefined();
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

	it("should split IA subject strings into genres", () => {
		expect(splitGenres("Action;Adventure;Serial;Sci-Fi;Flash Gordon")).toEqual([
			"Action",
			"Adventure",
			"Serial",
			"Sci-Fi",
			"Flash Gordon",
		]);
		expect(splitGenres(["horror", " zombies "])).toEqual(["horror", "zombies"]);
		expect(splitGenres("")).toEqual([]);
		expect(splitGenres(undefined)).toEqual([]);
		expect(splitGenres("a;b;c;d;e;f;g;h;i;j;k;l")).toHaveLength(10);
	});

	it("should read restriction flags and years from metadata", () => {
		expect(isRestricted({ "access-restricted-item": "true" })).toBe(true);
		expect(isRestricted({ "access-restricted-item": true })).toBe(true);
		expect(isRestricted({ identifier: "x" })).toBe(false);
		expect(isRestricted(undefined)).toBe(false);
		expect(publicationYear({ year: 1951 })).toBe("1951");
		expect(publicationYear({ date: "1938-01-01T00:00:00Z" })).toBe("1938");
		expect(publicationYear({})).toBeUndefined();
	});

	it("should only list verified collections", () => {
		// film_noir and serials do not exist as collections on archive.org;
		// these names were verified against advancedsearch.php.
		expect(COLLECTIONS.map((c) => c.value)).toEqual([
			"feature_films",
			"prelinger",
			"moviesandfilms",
			"Film_Noir",
		]);
	});

	it("should humanize file stems into episode names", () => {
		expect(stemToTitle("VTS_01_1")).toBe("VTS 01 1");
		expect(stemToTitle("flash_gordon_ep01")).toBe("flash gordon ep01");
		expect(stemToTitle("")).toBe("");
	});

	it("should encode archive urls", () => {
		expect(detailsUrl("an item")).toBe("https://archive.org/details/an%20item");
		expect(coverUrl("an-item")).toBe(
			"https://archive.org/services/img/an-item",
		);
		expect(fileUrl("an-item", "Chapter 1.mp4")).toBe(
			"https://archive.org/download/an-item/Chapter%201.mp4",
		);
	});
});

/** Builds a metadata files[] fixture from picked videos (name/format/length). */
function filesFromVideos(videos: PickedVideo[]): IaVideoFile[] {
	return videos.map((v) => ({
		name: v.name,
		format: "h.264",
		length: v.duration?.toString(),
		size: v.size?.toString(),
	}));
}

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Video");
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

	it("should be able to browse feature films", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Video");
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
			expect(entry.url).toStartWith("https://archive.org/details/");
		}
		// assertValidEntries checks entry/cover URLs live; only run it on the
		// first entries so one flaky archive.org thumbnail response cannot
		// fail the whole 20-entry page.
		await assertValidEntries(result.content.slice(0, 3));
		browseResult = result.content;
	}, 120_000);

	it("should be able to browse a different collection", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await extension!.setSetting(COLLECTION_SETTING_ID, "Search", {
			type: "String",
			data: "prelinger",
		});
		const result = await extension!.browse(0);
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content.slice(0, 3)) {
			expect(entry.media_type).toBe("Video");
		}
		await extension!.setSetting(COLLECTION_SETTING_ID, "Search", {
			type: "String",
			data: "feature_films",
		});
	}, 120_000);

	it("should be able to search for a film", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "nosferatu");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Video");
			expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
		}
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("nosferatu"))).toBe(true);
		searchResult = result.content;
	}, 120_000);

	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should be able to detail a searched film", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (searchResult === undefined || (searchResult?.length ?? 0) <= 0)
			throw new Error("No search result");
		const result = await extension!.detail(searchResult[0]!.id, {});
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.id.uid).toBe(searchResult[0]!.id.uid);
		expect(entry.media_type).toBe("Video");
		expect(entry.status).toBe("Complete");
		expect(entry.titles[0]!.length).toBeGreaterThan(0);
		expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
		expect(entry.episodes.length).toBeGreaterThan(0);
		for (const episode of entry.episodes) {
			expect(episode.name.length).toBeGreaterThan(0);
			expect(episode.url).toStartWith("https://archive.org/download/");
			expect(episode.id.uid).toContain("#");
		}
		expect(result.settings).toEqual({});
		await assertValidEntry(entry);
	}, 120_000);

	it("should detail a small film with a single Watch episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// "duck and cover": the top feature_films hit is the 9-minute civil
		// defense short, whose item carries exactly one deduplicated video.
		const result = await extension!.search(0, "duck and cover");
		expect(result.content.length).toBeGreaterThan(0);
		const target = result.content[0]!;
		const detail = await extension!.detail(target.id, {});
		const entry = detail.entry;
		expect(entry.id.uid).toBe(target.id.uid);
		expect(entry.media_type).toBe("Video");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.genres).toBeDefined();
		expect(entry.meta?.Runtime).toBeDefined();
		expect(entry.meta?.Year).toBeDefined();
		// One video after derivative deduplication -> a single Watch episode.
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Watch");
		expect(entry.episodes[0]!.url).toStartWith(
			`https://archive.org/download/${target.id.uid}/`,
		);
		expect(entry.episodes[0]!.description).toContain("Runtime:");
		detailResult = detail;
		await assertValidEntry(entry);
	}, 120_000);

	it("should be able to source the Watch episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			detailResult.settings as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Video");
		if (result.source.type === "Video") {
			expect(result.source.sub).toEqual([]);
			expect(result.source.sources.length).toBe(1);
			const stream = result.source.sources[0]!;
			expect(stream.lang).toBe("en");
			expect(stream.name.length).toBeGreaterThan(0);
			expect(stream.url.url).toStartWith("https://archive.org/download/");
			expect(stream.url.url).toMatch(/\.mp4$/);
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 300_000);

	it("should source a browsed entry end-to-end", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const detail = await extension!.detail(browseResult[0]!.id, {});
		expect(detail.entry.episodes.length).toBeGreaterThan(0);
		expect(detail.entry.meta).toBeDefined();
		await assertValidEntry(detail.entry);
		const source = await extension!.source(detail.entry.episodes[0]!.id, {});
		expect(source.source.type).toBe("Video");
		if (source.source.type === "Video") {
			expect(source.source.sources.length).toBe(1);
		}
	}, 300_000);

	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	});

	it("should reject items without playable video", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// Unknown identifier: the metadata endpoint answers {} with no files.
		await expect(
			extension!.detail({ uid: "ia-films-no-such-item-xyz" }, {}),
		).rejects.toThrow();
	}, 60_000);
});
