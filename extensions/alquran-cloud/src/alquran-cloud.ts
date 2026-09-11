// Pure helpers and static data for the AlQuran.cloud JSON API
// (https://alquran.cloud/api). Kept free of the built-in `network`/`parse`
// modules so it can be unit-tested directly under bun (same pattern as
// extensions/bible-api).
//
// Endpoint shapes (all verified against the live API):
// - list:      https://api.alquran.cloud/v1/surah
//              -> { code, status, data: [{ number, name, englishName,
//                   englishNameTranslation, numberOfAyahs, revelationType }] }
// - surah:     https://api.alquran.cloud/v1/surah/<n>/<edition>
//              -> { code, status, data: { number, name, englishName,
//                   englishNameTranslation, revelationType, numberOfAyahs,
//                   ayahs: [{ number (global 1..6236), text, numberInSurah,
//                   juz, page, sajda, ... }] } }
//              For audio editions (<n>/ar.alafasy) every ayah additionally
//              carries `audio` / `audioSecondary` MP3 URLs on
//              cdn.islamic.network (bitrate folder varies per reciter:
//              128/192, so the URL must be taken from the response).
// - multi:     https://api.alquran.cloud/v1/surah/<n>/editions/<csv>
//              -> data is an ARRAY of the above, one per edition (verified
//              with quran-uthmani,en.sahih).
// - editions:  https://api.alquran.cloud/v1/edition?format=text&type=translation
//
// The 114-surah table never changes, so it is also hardcoded below as a
// fallback in case the list endpoint is unreachable (generated from
// GET /v1/surah; the ayah counts sum to the canonical 6236).
//
// The API is fair-use rate limited — callers must cache responses.

import type { Paragraph, StreamSource } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE = "https://api.alquran.cloud/v1";
export const SITE_BASE = "https://alquran.cloud";

export const PAGE_SIZE = 24;
export const SURAH_COUNT = 114;

/** Full Arabic text of the Quran in the Uthmani script. */
export const ARABIC_EDITION = "quran-uthmani";

export const TRANSLATION_SETTING_ID = "alquran_translation";
export const RECITER_SETTING_ID = "alquran_reciter";

// ---------------------------------------------------------------------------
// Static surah table (fallback for GET /v1/surah; generated from the API)
// ---------------------------------------------------------------------------

export interface SurahInfo {
	/** Surah number, 1..114 — used as the entry uid. */
	number: number;
	/** Transliterated name, e.g. "Al-Kahf". */
	englishName: string;
	/** English meaning of the name, e.g. "The Cave". */
	englishNameTranslation: string;
	numberOfAyahs: number;
	revelationType: "Meccan" | "Medinan";
}

// "number|englishName|englishNameTranslation|numberOfAyahs|M(eccan)/D(edinan)"
const FALLBACK_TABLE = `1|Al-Faatiha|The Opening|7|M;
2|Al-Baqara|The Cow|286|D;
3|Aal-i-Imraan|The Family of Imraan|200|D;
4|An-Nisaa|The Women|176|D;
5|Al-Maaida|The Table|120|D;
6|Al-An'aam|The Cattle|165|M;
7|Al-A'raaf|The Heights|206|M;
8|Al-Anfaal|The Spoils of War|75|D;
9|At-Tawba|The Repentance|129|D;
10|Yunus|Jonas|109|M;
11|Hud|Hud|123|M;
12|Yusuf|Joseph|111|M;
13|Ar-Ra'd|The Thunder|43|D;
14|Ibrahim|Abraham|52|M;
15|Al-Hijr|The Rock|99|M;
16|An-Nahl|The Bee|128|M;
17|Al-Israa|The Night Journey|111|M;
18|Al-Kahf|The Cave|110|M;
19|Maryam|Mary|98|M;
20|Taa-Haa|Taa-Haa|135|M;
21|Al-Anbiyaa|The Prophets|112|M;
22|Al-Hajj|The Pilgrimage|78|D;
23|Al-Muminoon|The Believers|118|M;
24|An-Noor|The Light|64|D;
25|Al-Furqaan|The Criterion|77|M;
26|Ash-Shu'araa|The Poets|227|M;
27|An-Naml|The Ant|93|M;
28|Al-Qasas|The Stories|88|M;
29|Al-Ankaboot|The Spider|69|M;
30|Ar-Room|The Romans|60|M;
31|Luqman|Luqman|34|M;
32|As-Sajda|The Prostration|30|M;
33|Al-Ahzaab|The Clans|73|D;
34|Saba|Sheba|54|M;
35|Faatir|The Originator|45|M;
36|Yaseen|Yaseen|83|M;
37|As-Saaffaat|Those drawn up in Ranks|182|M;
38|Saad|The letter Saad|88|M;
39|Az-Zumar|The Groups|75|M;
40|Ghafir|The Forgiver|85|M;
41|Fussilat|Explained in detail|54|M;
42|Ash-Shura|Consultation|53|M;
43|Az-Zukhruf|Ornaments of gold|89|M;
44|Ad-Dukhaan|The Smoke|59|M;
45|Al-Jaathiya|Crouching|37|M;
46|Al-Ahqaf|The Dunes|35|M;
47|Muhammad|Muhammad|38|D;
48|Al-Fath|The Victory|29|D;
49|Al-Hujuraat|The Inner Apartments|18|D;
50|Qaaf|The letter Qaaf|45|M;
51|Adh-Dhaariyat|The Winnowing Winds|60|M;
52|At-Tur|The Mount|49|M;
53|An-Najm|The Star|62|M;
54|Al-Qamar|The Moon|55|M;
55|Ar-Rahmaan|The Beneficent|78|D;
56|Al-Waaqia|The Inevitable|96|M;
57|Al-Hadid|The Iron|29|D;
58|Al-Mujaadila|The Pleading Woman|22|D;
59|Al-Hashr|The Exile|24|D;
60|Al-Mumtahana|She that is to be examined|13|D;
61|As-Saff|The Ranks|14|D;
62|Al-Jumu'a|Friday|11|D;
63|Al-Munaafiqoon|The Hypocrites|11|D;
64|At-Taghaabun|Mutual Disillusion|18|D;
65|At-Talaaq|Divorce|12|D;
66|At-Tahrim|The Prohibition|12|D;
67|Al-Mulk|The Sovereignty|30|M;
68|Al-Qalam|The Pen|52|M;
69|Al-Haaqqa|The Reality|52|M;
70|Al-Ma'aarij|The Ascending Stairways|44|M;
71|Nooh|Noah|28|M;
72|Al-Jinn|The Jinn|28|M;
73|Al-Muzzammil|The Enshrouded One|20|M;
74|Al-Muddaththir|The Cloaked One|56|M;
75|Al-Qiyaama|The Resurrection|40|M;
76|Al-Insaan|Man|31|D;
77|Al-Mursalaat|The Emissaries|50|M;
78|An-Naba|The Announcement|40|M;
79|An-Naazi'aat|Those who drag forth|46|M;
80|Abasa|He frowned|42|M;
81|At-Takwir|The Overthrowing|29|M;
82|Al-Infitaar|The Cleaving|19|M;
83|Al-Mutaffifin|Defrauding|36|M;
84|Al-Inshiqaaq|The Splitting Open|25|M;
85|Al-Burooj|The Constellations|22|M;
86|At-Taariq|The Morning Star|17|M;
87|Al-A'laa|The Most High|19|M;
88|Al-Ghaashiya|The Overwhelming|26|M;
89|Al-Fajr|The Dawn|30|M;
90|Al-Balad|The City|20|M;
91|Ash-Shams|The Sun|15|M;
92|Al-Lail|The Night|21|M;
93|Ad-Dhuhaa|The Morning Hours|11|M;
94|Ash-Sharh|The Consolation|8|M;
95|At-Tin|The Fig|8|M;
96|Al-Alaq|The Clot|19|M;
97|Al-Qadr|The Power, Fate|5|M;
98|Al-Bayyina|The Evidence|8|D;
99|Az-Zalzala|The Earthquake|8|D;
100|Al-Aadiyaat|The Chargers|11|M;
101|Al-Qaari'a|The Calamity|11|M;
102|At-Takaathur|Competition|8|M;
103|Al-Asr|The Declining Day, Epoch|3|M;
104|Al-Humaza|The Traducer|9|M;
105|Al-Fil|The Elephant|5|M;
106|Quraish|Quraysh|4|M;
107|Al-Maa'un|Almsgiving|7|M;
108|Al-Kawthar|Abundance|3|M;
109|Al-Kaafiroon|The Disbelievers|6|M;
110|An-Nasr|Divine Support|3|D;
111|Al-Masad|The Palm Fibre|5|M;
112|Al-Ikhlaas|Sincerity|4|M;
113|Al-Falaq|The Dawn|5|M;
114|An-Naas|Mankind|6|M`;

export const FALLBACK_SURAHS: SurahInfo[] = FALLBACK_TABLE.split(/\r?\n/)
	.map((line) => line.trim().replace(/;$/, ""))
	.filter((line) => line.length > 0)
	.map((line) => {
		const [number, englishName, englishNameTranslation, ayahs, rev] =
			line.split("|");
		return {
			number: Number(number),
			englishName: englishName ?? "",
			englishNameTranslation: englishNameTranslation ?? "",
			numberOfAyahs: Number(ayahs),
			revelationType: rev === "D" ? "Medinan" : "Meccan",
		} satisfies SurahInfo;
	});

// ---------------------------------------------------------------------------
// Editions (identifiers verified live against GET /v1/surah/112/editions/...)
// ---------------------------------------------------------------------------

export const TRANSLATIONS: { value: string; label: string }[] = [
	{ value: "en.sahih", label: "Saheeh International (English)" },
	{ value: "en.asad", label: "Muhammad Asad (English)" },
	{ value: "en.pickthall", label: "Marmaduke Pickthall (English)" },
	{ value: "en.arberry", label: "A. J. Arberry (English)" },
	{ value: "en.yusufali", label: "Abdullah Yusuf Ali (English)" },
	{ value: "en.hilali", label: "Hilali & Khan (English)" },
	{ value: "en.qaribullah", label: "Qaribullah & Darwish (English)" },
	{ value: "en.itani", label: "Talal Itani, Clear Quran (English)" },
	{ value: "fr.hamidullah", label: "Muhammad Hamidullah (French)" },
	{ value: "de.aburida", label: "Ludwig Abel, Abu Rida (German)" },
	{ value: "es.cortes", label: "Julio Cortes (Spanish)" },
	{ value: "tr.diyanet", label: "Diyanet Isleri (Turkish)" },
	{ value: "id.indonesian", label: "Bahasa Indonesia (Indonesian)" },
	{ value: "ru.kuliev", label: "Elmir Kuliev (Russian)" },
	{ value: "ur.jalandhry", label: "Fateh Muhammad Jalandhry (Urdu)" },
];

/** Verse-by-verse audio editions (all probed live — every one returns
 * per-ayah MP3 URLs on cdn.islamic.network). */
export const RECITERS: { value: string; label: string }[] = [
	{ value: "ar.alafasy", label: "Mishary Rashid Alafasy" },
	{ value: "ar.husary", label: "Mahmoud Khalil Al-Husary" },
	{ value: "ar.minshawi", label: "Mohamed Siddiq El-Minshawi" },
	{ value: "ar.abdurrahmaansudais", label: "Abdurrahmaan As-Sudais" },
	{ value: "ar.shaatree", label: "Abu Bakr Ash-Shaatree" },
	{ value: "ar.muhammadayyoub", label: "Muhammad Ayyoub" },
	{ value: "ar.abdullahbasfar", label: "Abdullah Basfar" },
	{ value: "ar.hanirifai", label: "Hani Ar-Rifai" },
];

/** BCP-47 language of an edition identifier like "en.sahih" / "de.aburida". */
export function editionLanguage(edition: string): string {
	const dot = edition.indexOf(".");
	return dot > 0 ? edition.slice(0, dot) : "ar";
}

export function editionLabel(
	list: { value: string; label: string }[],
	value: string,
): string {
	return list.find((item) => item.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Remote data shapes (parsed defensively — everything crosses the VM
// boundary as untyped JSON)
// ---------------------------------------------------------------------------

export interface ApiAyah {
	/** Global ayah number 1..6236 — the cdn.islamic.network file name. */
	number?: number;
	text?: string;
	numberInSurah?: number;
	/** Present on audio editions: the canonical MP3 URL for this reciter. */
	audio?: string;
	audioSecondary?: string[];
}

export interface ApiSurah {
	number?: number;
	/** Arabic name, e.g. "سُورَةُ الكَهۡفِ". */
	name?: string;
	englishName?: string;
	englishNameTranslation?: string;
	revelationType?: string;
	numberOfAyahs?: number;
	ayahs?: ApiAyah[];
}

/** Normalise an /v1/surah list item into a SurahInfo; undefined if invalid. */
export function parseSurahInfo(raw: unknown): SurahInfo | undefined {
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	const rawSurah = raw as Record<string, unknown>;
	const number = Number(rawSurah.number);
	const englishName = rawSurah.englishName;
	const englishNameTranslation = rawSurah.englishNameTranslation;
	const numberOfAyahs = Number(rawSurah.numberOfAyahs);
	if (
		!Number.isInteger(number) ||
		number < 1 ||
		number > SURAH_COUNT ||
		typeof englishName !== "string" ||
		typeof englishNameTranslation !== "string" ||
		!Number.isInteger(numberOfAyahs) ||
		numberOfAyahs < 1
	) {
		return undefined;
	}
	return {
		number,
		englishName,
		englishNameTranslation,
		numberOfAyahs,
		revelationType:
			rawSurah.revelationType === "Medinan" ? "Medinan" : "Meccan",
	};
}

// ---------------------------------------------------------------------------
// Lookups & ids
// ---------------------------------------------------------------------------

export function findSurah(uid: string): SurahInfo | undefined {
	const number = Number(uid);
	return FALLBACK_SURAHS.find((surah) => surah.number === number);
}

export function makeSurahUid(surah: SurahInfo): string {
	return String(surah.number);
}

export type EpisodeKind = "read" | "listen";

export function makeEpisodeUid(surah: SurahInfo, kind: EpisodeKind): string {
	return `${surah.number}#${kind}`;
}

export function parseEpisodeUid(uid: string): {
	surah: SurahInfo;
	kind: EpisodeKind;
} {
	const [surahRaw, kindRaw] = uid.split("#");
	const surah = surahRaw === undefined ? undefined : findSurah(surahRaw);
	if (surah === undefined || (kindRaw !== "read" && kindRaw !== "listen")) {
		throw new Error(`alquran-cloud: invalid episode reference "${uid}"`);
	}
	return { surah, kind: kindRaw };
}

// ---------------------------------------------------------------------------
// URLs (the runtime VM has no URL globals — build by hand)
// ---------------------------------------------------------------------------

export function surahListUrl(): string {
	return `${API_BASE}/surah`;
}

/** Single edition. Works for text AND audio editions (both verified). */
export function surahEditionUrl(surah: number, edition: string): string {
	return `${API_BASE}/surah/${surah}/${edition}`;
}

/** Multi-edition fetch (verified for text editions): data is an array. */
export function surahEditionsUrl(surah: number, editions: string[]): string {
	return `${API_BASE}/surah/${surah}/editions/${editions.map(encodeURIComponent).join(",")}`;
}

/** Human-facing page for a surah on alquran.cloud. */
export function surahPageUrl(surah: number): string {
	return `${SITE_BASE}/surah/${surah}`;
}

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

/** First word of the Bismillah ("bism") in the API's Uthmani orthography.
 * Matching word-by-word instead of the whole phrase: the API's diacritic
 * ordering inside later words differs from what a hand-typed literal would
 * produce. */
const BISMILLAH_FIRST_WORD = "بِسْمِ";

/** Al-Fatiha opens WITH the Bismillah (it is ayah 1) and At-Tawba omits it;
 * for every other surah the API prepends it to ayah 1's text. */
const SURAHS_WITHOUT_PREFIXED_BISMILLAH = new Set([1, 9]);

/**
 * The API prepends the 4-word Bismillah to ayah 1 of every surah except
 * Al-Fatiha (1) and At-Tawba (9). Translations do not include it, so strip
 * it to keep the Arabic lines aligned with the chosen translation.
 */
export function stripBismillah(
	surahNumber: number,
	numberInSurah: number,
	text: string,
): string {
	if (
		SURAHS_WITHOUT_PREFIXED_BISMILLAH.has(surahNumber) ||
		numberInSurah !== 1
	) {
		return text;
	}
	const words = text.split(" ");
	if (words.length <= 4 || words[0] !== BISMILLAH_FIRST_WORD) {
		return text;
	}
	return words.slice(4).join(" ");
}

/** Ayah text arrives with stray newlines/spaces; collapse them. */
export function formatAyahText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Source builders (pure — unit-tested with inline fixtures)
// ---------------------------------------------------------------------------

function ayahText(surah: SurahInfo, ayah: ApiAyah): string {
	const numberInSurah = Number(ayah.numberInSurah);
	const raw = typeof ayah.text === "string" ? ayah.text : "";
	return formatAyahText(stripBismillah(surah.number, numberInSurah, raw));
}

/** Bold bold ayah number prefix, then the Uthmani Arabic; the translation
 * follows as its own italic paragraph. */
export function buildReadParagraphs(
	surah: SurahInfo,
	arabic: ApiSurah,
	translation: ApiSurah,
): Paragraph[] {
	const paragraphs: Paragraph[] = [
		{
			type: "Text",
			content: `Surah ${surah.number} — ${surah.englishName} (${surah.englishNameTranslation})`,
			style: { bold: true },
		},
	];
	const arabicAyahs = arabic.ayahs ?? [];
	const translatedAyahs = translation.ayahs ?? [];
	const count = Math.min(arabicAyahs.length, translatedAyahs.length);
	for (let i = 0; i < count; i++) {
		const arab = arabicAyahs[i];
		const translated = translatedAyahs[i];
		if (arab === undefined || translated === undefined) {
			continue;
		}
		const arabicText = ayahText(surah, arab);
		const translatedText = formatAyahText(
			typeof translated.text === "string" ? translated.text : "",
		);
		const numberInSurah = Number(arab.numberInSurah ?? i + 1);
		if (arabicText.length === 0 && translatedText.length === 0) {
			continue;
		}
		if (arabicText.length > 0) {
			paragraphs.push({
				type: "Mixed",
				content: [
					{ type: "Text", content: `${numberInSurah} `, style: { bold: true } },
					{ type: "Text", content: arabicText, style: null },
				],
			});
		}
		if (translatedText.length > 0) {
			paragraphs.push({
				type: "Text",
				content: translatedText,
				style: { italic: true },
			});
		}
	}
	return paragraphs;
}

/** One StreamSource per ayah (the player treats them as a playlist); MP3
 * URLs come straight from the audio-edition response, so per-reciter
 * bitrates need no hardcoding. */
export function buildAudioSources(
	surah: SurahInfo,
	recitation: ApiSurah,
): StreamSource[] {
	const sources: StreamSource[] = [];
	for (const ayah of recitation.ayahs ?? []) {
		if (typeof ayah.audio !== "string" || ayah.audio.length === 0) {
			continue;
		}
		const numberInSurah = Number(ayah.numberInSurah);
		sources.push({
			name: `${Number.isInteger(numberInSurah) ? numberInSurah : sources.length + 1}. ${surah.englishName}`,
			lang: "ar",
			url: { url: ayah.audio },
		});
	}
	return sources;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Case-insensitive match over transliterated names, name translations and
 * the surah number ("18" finds Al-Kahf). */
export function searchSurahs(surahs: SurahInfo[], term: string): SurahInfo[] {
	const needle = term.trim().toLowerCase();
	if (needle.length === 0) {
		return [];
	}
	const asNumber = /^\d+$/.test(needle) ? Number(needle) : undefined;
	return surahs.filter((surah) => {
		return (
			surah.englishName.toLowerCase().includes(needle) ||
			surah.englishNameTranslation.toLowerCase().includes(needle) ||
			(asNumber !== undefined && surah.number === asNumber)
		);
	});
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** "18. Al-Kahf (The Cave)" */
export function makeEntryTitle(surah: SurahInfo): string {
	return `${surah.number}. ${surah.englishName} (${surah.englishNameTranslation})`;
}

export function surahDescription(surah: SurahInfo): string {
	return (
		`${surah.englishNameTranslation} — surah ${surah.number} of the Quran, ` +
		`${surah.revelationType.toLowerCase()}, ${surah.numberOfAyahs} ` +
		`${surah.numberOfAyahs === 1 ? "ayah" : "ayahs"}.`
	);
}
