import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	Episode,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	ARABIC_EDITION,
	type ApiSurah,
	buildAudioSources,
	buildReadParagraphs,
	editionLabel,
	editionLanguage,
	findSurah,
	FALLBACK_SURAHS,
	makeEpisodeUid,
	PAGE_SIZE,
	makeEntryTitle,
	makeSurahUid,
	parseEpisodeUid,
	parseSurahInfo,
	RECITERS,
	RECITER_SETTING_ID,
	searchSurahs,
	SURAH_COUNT,
	surahDescription,
	surahEditionsUrl,
	surahEditionUrl,
	surahListUrl,
	surahPageUrl,
	TRANSLATIONS,
	TRANSLATION_SETTING_ID,
	type SurahInfo,
} from "./alquran-cloud.ts";

// ---------------------------------------------------------------------------
// Remote data shapes
// ---------------------------------------------------------------------------

interface ApiEnvelope {
	code?: number;
	status?: string;
	data?: unknown;
}

// ---------------------------------------------------------------------------
// API client (fair-use rate limited — everything is cached per session)
// ---------------------------------------------------------------------------

/** Session cache of the 114-surah list; null until the first fetch. */
let surahListCache: SurahInfo[] | null = null;

/**
 * The 114 surahs, fetched once per session. Falls back to the hardcoded
 * table when the list endpoint fails so browse/search/detail keep working.
 */
async function surahList(): Promise<SurahInfo[]> {
	if (surahListCache !== null) {
		return surahListCache;
	}
	let list: SurahInfo[] = [];
	try {
		const res = await fetch(surahListUrl());
		if (res.ok) {
			const body = (
				typeof res.json === "object" && res.json !== null ? res.json : {}
			) as ApiEnvelope;
			if (Array.isArray(body.data)) {
				list = body.data
					.map(parseSurahInfo)
					.filter((surah): surah is SurahInfo => surah !== undefined);
			}
		}
	} catch {
		list = [];
	}
	if (list.length !== SURAH_COUNT) {
		list = FALLBACK_SURAHS;
	}
	surahListCache = list;
	return list;
}

/** Session cache of fetched surah editions, keyed by "<surah>|<editions>". */
const editionCache = new Map<string, ApiSurah>();

async function fetchSurahEditions(
	surah: number,
	editions: string[],
): Promise<ApiSurah[]> {
	const key = `${surah}|${editions.join(",")}`;
	const cached = editionCache.get(key);
	if (cached !== undefined) {
		return [cached];
	}
	// The single-edition form is verified for both text and audio editions;
	// the /editions/ form (verified for text editions) returns an array.
	const url =
		editions.length === 1
			? surahEditionUrl(surah, editions[0] ?? "")
			: surahEditionsUrl(surah, editions);
	const res = await fetch(url);
	const body = (
		typeof res.json === "object" && res.json !== null ? res.json : {}
	) as ApiEnvelope;
	if (!res.ok) {
		throw new Error(
			`alquran.cloud request failed (HTTP ${res.status}) for surah ${surah} [${editions.join(", ")}]`,
		);
	}
	const rawList = Array.isArray(body.data) ? body.data : [body.data];
	const found: ApiSurah[] = [];
	for (const raw of rawList) {
		if (typeof raw === "object" && raw !== null && Array.isArray(raw.ayahs)) {
			found.push(raw as ApiSurah);
		}
	}
	if (found.length !== editions.length) {
		throw new Error(
			`alquran.cloud: missing editions for surah ${surah} [${editions.join(", ")}]`,
		);
	}
	editionCache.set(key, found[0] as ApiSurah);
	return found;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function surahToEntry(surah: SurahInfo): Entry {
	return {
		id: { uid: makeSurahUid(surah) },
		url: surahPageUrl(surah.number),
		title: makeEntryTitle(surah),
		media_type: "Book",
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		translation: new ExtensionSetting<string>(
			TRANSLATION_SETTING_ID,
			"en.sahih",
			"Extension",
		)
			.setLabel("Translation")
			.setUI(new Dropdown(TRANSLATIONS)),
		reciter: new ExtensionSetting<string>(
			RECITER_SETTING_ID,
			"ar.alafasy",
			"Extension",
		)
			.setLabel("Reciter")
			.setUI(new Dropdown(RECITERS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/**
	 * The host threads the per-entry settings record into detail()/source();
	 * once an edition has been resolved there it rides along in it, otherwise
	 * fall back to the registered extension setting.
	 */
	private async resolveEdition(
		settings: Record<string, Setting>,
		settingId: string,
		fallback: ExtensionSetting<string>,
	): Promise<string> {
		return (
			new SettingStore(settings).tryGet<string>(settingId) ?? fallback.get()
		);
	}

	async browse(page: number): Promise<EntryList> {
		const surahs = await surahList();
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: surahs.slice(start, start + PAGE_SIZE).map(surahToEntry),
			hasnext: start + PAGE_SIZE < surahs.length,
			length: surahs.length,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const surahs = await surahList();
		const results = searchSurahs(surahs, filter);
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: results.slice(start, start + PAGE_SIZE).map(surahToEntry),
			hasnext: start + PAGE_SIZE < results.length,
			length: results.length,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const surah = findSurah(entryid.uid);
		if (surah === undefined) {
			throw new Error(`alquran-cloud: unknown surah "${entryid.uid}"`);
		}
		const translation = await this.resolveEdition(
			settings,
			TRANSLATION_SETTING_ID,
			this.settings.translation,
		);
		const reciter = await this.resolveEdition(
			settings,
			RECITER_SETTING_ID,
			this.settings.reciter,
		);

		const episodes: Episode[] = [
			{
				id: { uid: makeEpisodeUid(surah, "read") },
				name: "Read",
				description: `Uthmani Arabic with ${editionLabel(TRANSLATIONS, translation)}`,
				url: surahPageUrl(surah.number),
			},
			{
				id: { uid: makeEpisodeUid(surah, "listen") },
				name: "Listen (recitation)",
				description: `Recited by ${editionLabel(RECITERS, reciter)}`,
				url: surahPageUrl(surah.number),
			},
		];

		const meta: Record<string, string> = {
			Translation: editionLabel(TRANSLATIONS, translation),
			Recitation: editionLabel(RECITERS, reciter),
			Revelation: surah.revelationType,
			Ayahs: String(surah.numberOfAyahs),
		};

		const ui: CustomUI = Column(
			Text(`Translation: ${editionLabel(TRANSLATIONS, translation)}`),
			Text(`Recitation: ${editionLabel(RECITERS, reciter)}`),
			Text(
				"Quran text and audio by AlQuran.cloud (api.alquran.cloud); audio CDN: cdn.islamic.network.",
			),
			Link("https://alquran.cloud/", "Powered by AlQuran.cloud"),
		);

		const entry: EntryDetailed = {
			id: { uid: surah.number.toString() },
			url: surahPageUrl(surah.number),
			titles: [makeEntryTitle(surah)],
			author: [],
			media_type: "Book",
			status: "Complete",
			description: surahDescription(surah),
			language: editionLanguage(translation),
			episodes,
			genres: [surah.revelationType],
			meta,
			ui,
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const { surah, kind } = parseEpisodeUid(epid.uid);

		if (kind === "read") {
			const translation = await this.resolveEdition(
				settings,
				TRANSLATION_SETTING_ID,
				this.settings.translation,
			);
			const [arabic, translated] = await fetchSurahEditions(surah.number, [
				ARABIC_EDITION,
				translation,
			]);
			return {
				source: {
					type: "Paragraphlist",
					paragraphs: buildReadParagraphs(
						surah,
						arabic as ApiSurah,
						translated as ApiSurah,
					),
				},
				settings: { ...settings },
			};
		}

		const reciter = await this.resolveEdition(
			settings,
			RECITER_SETTING_ID,
			this.settings.reciter,
		);
		const [recitation] = await fetchSurahEditions(surah.number, [reciter]);
		const sources = buildAudioSources(surah, recitation as ApiSurah);
		if (sources.length === 0) {
			throw new Error(
				`alquran.cloud: no audio returned for surah ${surah.number} (${reciter})`,
			);
		}
		return {
			source: { type: "Audio", sources },
			settings: { ...settings },
		};
	}
}
