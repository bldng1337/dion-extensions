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
	ARABIC_EDITION,
	type ApiSurah,
	buildAudioSources,
	buildReadParagraphs,
	editionLanguage,
	FALLBACK_SURAHS,
	findSurah,
	formatAyahText,
	makeEpisodeUid,
	makeEntryTitle,
	PAGE_SIZE,
	parseEpisodeUid,
	RECITERS,
	searchSurahs,
	stripBismillah,
	surahDescription,
	surahEditionsUrl,
	surahEditionUrl,
	surahListUrl,
	surahPageUrl,
	TRANSLATIONS,
} from "./alquran-cloud.ts";

// AlQuran.cloud is fair-use rate limited, so the live part of this suite
// keeps a small budget (~9 requests): browse/search/detail need no content
// fetches (the 114-surah list is one cached call, detail works from it),
// source() makes one cached editions call per episode, and the remaining
// traffic comes from the URL validators in @dion-js/extension-test-utils.
// The Listen source skips assertValidSource on purpose — it would download
// all 110 per-ayah MP3s; a single ranged probe covers reachability.

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

	it("should browse the 114 surahs with one cached list call", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page0 = await extension!.browse(0);
		expect(page0.content).toHaveLength(PAGE_SIZE);
		expect(page0.hasnext).toBe(true);
		expect(page0.length).toBe(114);
		expect(page0.content[0]!.title).toBe("1. Al-Faatiha (The Opening)");
		const uids = new Set(page0.content.map((entry) => entry.id.uid));
		expect(uids.size).toBe(PAGE_SIZE);
		for (const entry of page0.content) {
			expect(entry.media_type).toBe("Book");
			expect(entry.title).toMatch(/^\d+\. .+ \(.+\)$/);
			expect(entry.url.startsWith("https://alquran.cloud/surah/")).toBe(true);
		}
		const last = await extension!.browse(4);
		expect(last.content).toHaveLength(114 - 4 * PAGE_SIZE);
		expect(last.hasnext).toBe(false);
	});

	it("should search surahs by name", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "kahf");
		expect(result).toBeDefined();
		expect(result.content.map((entry) => entry.title)).toEqual([
			"18. Al-Kahf (The Cave)",
		]);
		expect(result.hasnext).toBe(false);
		searchResults = result.content;
		// Validates the surah page URL (single small request).
		await assertValidEntries(searchResults);
	});

	it("should detail Al-Kahf with Read and Listen episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const kahf = searchResults.find((entry) => entry.id.uid === "18");
		expect(kahf).toBeDefined();
		const result = await extension!.detail(kahf!.id, {});
		expect(result).toBeDefined();
		detailResult = result;

		const entry = result.entry;
		expect(entry.id.uid).toBe("18");
		expect(entry.titles[0]).toBe("18. Al-Kahf (The Cave)");
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.description).toContain("110 ayahs");
		expect(entry.language).toBe("en");
		expect(entry.episodes).toHaveLength(2);
		expect(entry.episodes.map((episode) => episode.name)).toEqual([
			"Read",
			"Listen (recitation)",
		]);
		expect(entry.meta?.Translation).toBeDefined();
		expect(entry.meta?.Recitation).toBeDefined();
		// Settings must be echoed back untouched.
		expect(result.settings).toEqual({});

		// Validates entry.url, both episode urls and the attribution link.
		await assertValidEntry(entry);
	});

	it("should source the Read episode as Arabic interleaved with translation", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const episodes: Episode[] = detailResult?.entry.episodes ?? [];
		const read = episodes.find((episode) => episode.id.uid === "18#read");
		expect(read).toBeDefined();
		const result = await extension!.source(
			read!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(result.source);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") throw new Error("bad source");

		const paragraphs = result.source.paragraphs;
		// Heading + Al-Kahf's 110 ayahs (Arabic + translation each).
		expect(paragraphs.length).toBe(221);
		const heading = paragraphs[0]!;
		expect(heading.type).toBe("Text");
		if (heading.type !== "Text") throw new Error("bad paragraph");
		expect(heading.style?.bold).toBe(true);
		expect(heading.content).toBe("Surah 18 — Al-Kahf (The Cave)");

		// Ayah 1: bold number prefix + Arabic without the API's Bismillah
		// prefix, followed by the italic Saheeh International translation.
		const arabicPara = paragraphs[1]!;
		expect(arabicPara.type).toBe("Mixed");
		if (arabicPara.type !== "Mixed") throw new Error("bad paragraph");
		const numberPrefix = arabicPara.content[0];
		if (numberPrefix?.type !== "Text") throw new Error("bad mixed content");
		expect(numberPrefix.content).toBe("1 ");
		expect(numberPrefix.style?.bold).toBe(true);
		const arabicText = arabicPara.content[1];
		if (arabicText?.type !== "Text") throw new Error("bad mixed content");
		expect(arabicText.content.startsWith("بِسْمِ")).toBe(false);
		expect(arabicText.content.length).toBeGreaterThan(50);

		const translationPara = paragraphs[2]!;
		expect(translationPara.type).toBe("Text");
		if (translationPara.type !== "Text") throw new Error("bad paragraph");
		expect(translationPara.style?.italic).toBe(true);
		expect(translationPara.content.startsWith("[All] praise")).toBe(true);

		// Settings must be echoed back untouched.
		expect(result.settings).toEqual(detailResult.settings);
	});

	it("should source the Listen episode as per-ayah audio", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const episodes: Episode[] = detailResult?.entry.episodes ?? [];
		const listen = episodes.find((episode) => episode.id.uid === "18#listen");
		expect(listen).toBeDefined();
		const result = await extension!.source(
			listen!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Audio");
		if (result.source.type !== "Audio") throw new Error("bad source");
		const sources = result.source.sources;
		expect(sources).toHaveLength(110);
		expect(sources[0]!.name).toBe("1. Al-Kahf");
		expect(sources[0]!.lang).toBe("ar");
		expect(sources[0]!.url.url).toBe(
			"https://cdn.islamic.network/quran/audio/128/ar.alafasy/2141.mp3",
		);
		expect(sources[109]!.url.url).toBe(
			"https://cdn.islamic.network/quran/audio/128/ar.alafasy/2250.mp3",
		);
		// One ranged probe instead of assertValidSource (110 full MP3s). The
		// CDN occasionally answers 502 for a few seconds, so retry once.
		let probe = await fetch(sources[0]!.url.url, {
			headers: { Range: "bytes=0-0" },
		});
		if (!probe.ok && probe.status !== 206) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			probe = await fetch(sources[0]!.url.url, {
				headers: { Range: "bytes=0-0" },
			});
		}
		expect(probe.ok || probe.status === 206).toBe(true);
		// Settings must be echoed back untouched.
		expect(result.settings).toEqual(detailResult.settings);
	});

	it("should reject unknown surahs and episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		expect(findSurah("999")).toBeUndefined();
		await expect(extension!.detail({ uid: "999" }, {})).rejects.toThrow(
			/unknown surah/,
		);
		await expect(extension!.source({ uid: "18#dance" }, {})).rejects.toThrow(
			/invalid episode reference/,
		);
		await expect(extension!.source({ uid: "abc#read" }, {})).rejects.toThrow(
			/invalid episode reference/,
		);
	});
});

describe("helpers (unit)", () => {
	it("should expose the complete 114-surah table", () => {
		expect(FALLBACK_SURAHS).toHaveLength(114);
		const numbers = new Set(FALLBACK_SURAHS.map((surah) => surah.number));
		expect(numbers.size).toBe(114);
		for (let i = 1; i <= 114; i++) {
			expect(numbers.has(i)).toBe(true);
		}
		const totalAyahs = FALLBACK_SURAHS.reduce(
			(sum, surah) => sum + surah.numberOfAyahs,
			0,
		);
		expect(totalAyahs).toBe(6236);
		expect(findSurah("1")?.numberOfAyahs).toBe(7);
		expect(findSurah("2")?.numberOfAyahs).toBe(286);
		expect(findSurah("18")?.englishName).toBe("Al-Kahf");
		expect(findSurah("114")?.numberOfAyahs).toBe(6);
	});

	it("should offer verified translation and reciter editions", () => {
		expect(TRANSLATIONS.length).toBeGreaterThanOrEqual(10);
		expect(TRANSLATIONS[0]).toEqual({
			value: "en.sahih",
			label: "Saheeh International (English)",
		});
		const translationIds = new Set(TRANSLATIONS.map((t) => t.value));
		expect(translationIds.size).toBe(TRANSLATIONS.length);
		for (const id of translationIds) {
			expect(id).toMatch(/^[a-z]{2,3}\.[a-z]+$/);
		}
		expect(RECITERS.length).toBeGreaterThanOrEqual(5);
		const reciterIds = new Set(RECITERS.map((r) => r.value));
		expect(reciterIds.size).toBe(RECITERS.length);
		for (const id of reciterIds) {
			expect(id.startsWith("ar.")).toBe(true);
		}
		expect(reciterIds.has("ar.alafasy")).toBe(true);
	});

	it("should map edition identifiers to languages", () => {
		expect(editionLanguage("en.sahih")).toBe("en");
		expect(editionLanguage("de.aburida")).toBe("de");
		expect(editionLanguage("ur.jalandhry")).toBe("ur");
		expect(editionLanguage(ARABIC_EDITION)).toBe("ar");
	});

	it("should build api urls without URL globals", () => {
		expect(surahListUrl()).toBe("https://api.alquran.cloud/v1/surah");
		expect(surahEditionUrl(18, "en.sahih")).toBe(
			"https://api.alquran.cloud/v1/surah/18/en.sahih",
		);
		expect(surahEditionsUrl(18, ["quran-uthmani", "en.sahih"])).toBe(
			"https://api.alquran.cloud/v1/surah/18/editions/quran-uthmani,en.sahih",
		);
		expect(surahPageUrl(18)).toBe("https://alquran.cloud/surah/18");
	});

	it("should strip the API's prefixed Bismillah from ayah 1", () => {
		const ayah1 = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ٱلْحَمْدُ لِلَّهِ";
		expect(stripBismillah(18, 1, ayah1)).toBe("ٱلْحَمْدُ لِلَّهِ");
		// Al-Fatiha (1) opens with the Bismillah as ayah 1 itself; At-Tawba (9)
		// has none prefixed. Other ayahs are never touched.
		expect(stripBismillah(1, 1, ayah1)).toBe(ayah1);
		expect(stripBismillah(9, 1, ayah1)).toBe(ayah1);
		expect(stripBismillah(18, 2, ayah1)).toBe(ayah1);
		// Non-Bismillah text is left alone (also fewer than 5 words).
		expect(stripBismillah(18, 1, "abc def ghi jkl")).toBe("abc def ghi jkl");
	});

	it("should clean ayah text for reading", () => {
		expect(formatAyahText("\n\ttext with  stray spaces \n")).toBe(
			"text with stray spaces",
		);
		expect(formatAyahText("   ")).toBe("");
	});

	it("should round-trip episode ids", () => {
		const kahf = findSurah("18")!;
		expect(makeEpisodeUid(kahf, "read")).toBe("18#read");
		expect(makeEpisodeUid(kahf, "listen")).toBe("18#listen");
		expect(parseEpisodeUid("18#read")).toEqual({ surah: kahf, kind: "read" });
		expect(parseEpisodeUid("18#listen").kind).toBe("listen");
	});

	it("should reject invalid episode ids", () => {
		expect(() => parseEpisodeUid("18")).toThrow();
		expect(() => parseEpisodeUid("18#dance")).toThrow();
		expect(() => parseEpisodeUid("999#read")).toThrow();
		expect(() => parseEpisodeUid("abc#read")).toThrow();
	});

	it("should match surah names, meanings and numbers", () => {
		expect(searchSurahs(FALLBACK_SURAHS, "kahf").map((s) => s.number)).toEqual([
			18,
		]);
		expect(
			searchSurahs(FALLBACK_SURAHS, "the cave").map((s) => s.number),
		).toEqual([18]);
		expect(
			searchSurahs(FALLBACK_SURAHS, "18").map((s) => s.englishName),
		).toEqual(["Al-Kahf"]);
		expect(
			searchSurahs(FALLBACK_SURAHS, "  Mary ").map((s) => s.number),
		).toEqual([19]);
		expect(searchSurahs(FALLBACK_SURAHS, "")).toEqual([]);
		expect(searchSurahs(FALLBACK_SURAHS, "zzz")).toEqual([]);
	});

	it("should format entry titles and descriptions", () => {
		const kahf = findSurah("18")!;
		expect(makeEntryTitle(kahf)).toBe("18. Al-Kahf (The Cave)");
		expect(surahDescription(kahf)).toBe(
			"The Cave — surah 18 of the Quran, meccan, 110 ayahs.",
		);
	});

	it("should build read paragraphs with bold numbers, arabic and translation", () => {
		const kahf = findSurah("18")!;
		const arabic: ApiSurah = {
			ayahs: [
				{ numberInSurah: 1, text: "بِسْمِ w2 w3 w4 ٱلْحَمْدُ لِلَّهِ" },
				{ numberInSurah: 2, text: "\nمَّٰكِثِينَ فِيهِ أَبَدًا  " },
			],
		};
		const translated: ApiSurah = {
			ayahs: [
				{ numberInSurah: 1, text: "[All] praise is [due] to Allah." },
				{ numberInSurah: 2, text: "In which they will remain forever" },
			],
		};
		const paragraphs = buildReadParagraphs(kahf, arabic, translated);
		expect(paragraphs).toHaveLength(5); // heading + 2 ayahs x 2

		const heading = paragraphs[0]!;
		if (heading.type !== "Text") throw new Error("bad paragraph");
		expect(heading.style?.bold).toBe(true);
		expect(heading.content).toBe("Surah 18 — Al-Kahf (The Cave)");

		const ayah1 = paragraphs[1]!;
		if (ayah1.type !== "Mixed") throw new Error("bad paragraph");
		expect(ayah1.content[0]).toEqual({
			type: "Text",
			content: "1 ",
			style: { bold: true },
		});
		if (ayah1.content[1]?.type !== "Text") throw new Error("bad paragraph");
		expect(ayah1.content[1].content).toBe("ٱلْحَمْدُ لِلَّهِ");

		const translation1 = paragraphs[2]!;
		if (translation1.type !== "Text") throw new Error("bad paragraph");
		expect(translation1.style?.italic).toBe(true);
		expect(translation1.content).toBe("[All] praise is [due] to Allah.");

		const ayah2 = paragraphs[3]!;
		if (ayah2.type !== "Mixed") throw new Error("bad paragraph");
		if (ayah2.content[0]?.type !== "Text") throw new Error("bad paragraph");
		expect(ayah2.content[0].content).toBe("2 ");
		if (ayah2.content[1]?.type !== "Text") throw new Error("bad paragraph");
		expect(ayah2.content[1].content).toBe("مَّٰكِثِينَ فِيهِ أَبَدًا");

		const translation2 = paragraphs[4]!;
		if (translation2.type !== "Text") throw new Error("bad paragraph");
		expect(translation2.content).toBe("In which they will remain forever");
	});

	it("should build audio sources from a recitation response", () => {
		const kahf = findSurah("18")!;
		const recitation: ApiSurah = {
			ayahs: [
				{
					numberInSurah: 1,
					audio:
						"https://cdn.islamic.network/quran/audio/128/ar.alafasy/2141.mp3",
				},
				{
					numberInSurah: 2,
					audio:
						"https://cdn.islamic.network/quran/audio/128/ar.alafasy/2142.mp3",
				},
				{ numberInSurah: 3 }, // no audio url -> skipped
			],
		};
		expect(buildAudioSources(kahf, recitation)).toEqual([
			{
				name: "1. Al-Kahf",
				lang: "ar",
				url: {
					url: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/2141.mp3",
				},
			},
			{
				name: "2. Al-Kahf",
				lang: "ar",
				url: {
					url: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/2142.mp3",
				},
			},
		]);
		expect(buildAudioSources(kahf, {})).toEqual([]);
	});
});
