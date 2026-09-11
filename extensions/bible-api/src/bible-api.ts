// Pure helpers and static data for the bible-api.com JSON API. Kept free of
// the built-in `network`/`parse` modules so it can be unit-tested directly
// under bun (same pattern as extensions/wikisource).
//
// Endpoint shapes (all verified against the live API):
// - verse:   https://bible-api.com/john+3:16
// - chapter: https://bible-api.com/john+3 (whole chapter via chapter reference)
// - range:   https://bible-api.com/jude+1:1-25
// - any of the above accept ?translation=<id>
// - responses: { reference, verses: [{book_id, book_name, chapter, verse, text}],
//                text, translation_id, translation_name, translation_note }
//   or { error: "not found" } (HTTP 404); "Retry later" when rate limited.
//
// The API has no book/chapter listing endpoint, so the 66-book Protestant
// canon (with chapter counts and USFM book codes) is hardcoded below. The
// book codes double as a query format that works for EVERY translation,
// including the non-English ones (`JHN+3` resolves to John/Joannes/João/Ioan).
//
// Rate limit: 15 requests per 30 seconds per IP — callers must cache.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE = "https://bible-api.com";

export const PAGE_SIZE = 24;

export const TRANSLATION_SETTING_ID = "bible_api_translation";

// ---------------------------------------------------------------------------
// Static canon table (name, chapter count, USFM book code, traditional title)
// ---------------------------------------------------------------------------

export interface BookInfo {
	/** USFM book code, e.g. "JHN" — used as entry uid and in queries. */
	id: string;
	name: string;
	chapters: number;
	summary: string;
}

export const BOOKS: BookInfo[] = [
	{
		id: "GEN",
		name: "Genesis",
		chapters: 50,
		summary: "The First Book of Moses, Called Genesis",
	},
	{
		id: "EXO",
		name: "Exodus",
		chapters: 40,
		summary: "The Second Book of Moses, Called Exodus",
	},
	{
		id: "LEV",
		name: "Leviticus",
		chapters: 27,
		summary: "The Third Book of Moses, Called Leviticus",
	},
	{
		id: "NUM",
		name: "Numbers",
		chapters: 36,
		summary: "The Fourth Book of Moses, Called Numbers",
	},
	{
		id: "DEU",
		name: "Deuteronomy",
		chapters: 34,
		summary: "The Fifth Book of Moses, Called Deuteronomy",
	},
	{ id: "JOS", name: "Joshua", chapters: 24, summary: "The Book of Joshua" },
	{ id: "JDG", name: "Judges", chapters: 21, summary: "The Book of Judges" },
	{ id: "RUT", name: "Ruth", chapters: 4, summary: "The Book of Ruth" },
	{
		id: "1SA",
		name: "1 Samuel",
		chapters: 31,
		summary: "The First Book of Samuel",
	},
	{
		id: "2SA",
		name: "2 Samuel",
		chapters: 24,
		summary: "The Second Book of Samuel",
	},
	{
		id: "1KI",
		name: "1 Kings",
		chapters: 22,
		summary: "The First Book of Kings",
	},
	{
		id: "2KI",
		name: "2 Kings",
		chapters: 25,
		summary: "The Second Book of Kings",
	},
	{
		id: "1CH",
		name: "1 Chronicles",
		chapters: 29,
		summary: "The First Book of Chronicles",
	},
	{
		id: "2CH",
		name: "2 Chronicles",
		chapters: 36,
		summary: "The Second Book of Chronicles",
	},
	{ id: "EZR", name: "Ezra", chapters: 10, summary: "The Book of Ezra" },
	{
		id: "NEH",
		name: "Nehemiah",
		chapters: 13,
		summary: "The Book of Nehemiah",
	},
	{ id: "EST", name: "Esther", chapters: 10, summary: "The Book of Esther" },
	{ id: "JOB", name: "Job", chapters: 42, summary: "The Book of Job" },
	{ id: "PSA", name: "Psalms", chapters: 150, summary: "The Psalms" },
	{
		id: "PRO",
		name: "Proverbs",
		chapters: 31,
		summary: "The Proverbs of Solomon",
	},
	{
		id: "ECC",
		name: "Ecclesiastes",
		chapters: 12,
		summary: "Ecclesiastes, or the Preacher",
	},
	{
		id: "SNG",
		name: "Song of Solomon",
		chapters: 8,
		summary: "The Song of Solomon",
	},
	{
		id: "ISA",
		name: "Isaiah",
		chapters: 66,
		summary: "The Book of the Prophet Isaiah",
	},
	{
		id: "JER",
		name: "Jeremiah",
		chapters: 52,
		summary: "The Book of the Prophet Jeremiah",
	},
	{
		id: "LAM",
		name: "Lamentations",
		chapters: 5,
		summary: "The Lamentations of Jeremiah",
	},
	{
		id: "EZK",
		name: "Ezekiel",
		chapters: 48,
		summary: "The Book of the Prophet Ezekiel",
	},
	{ id: "DAN", name: "Daniel", chapters: 12, summary: "The Book of Daniel" },
	{
		id: "HOS",
		name: "Hosea",
		chapters: 14,
		summary: "The Book of the Prophet Hosea",
	},
	{
		id: "JOL",
		name: "Joel",
		chapters: 3,
		summary: "The Book of the Prophet Joel",
	},
	{
		id: "AMO",
		name: "Amos",
		chapters: 9,
		summary: "The Book of the Prophet Amos",
	},
	{
		id: "OBA",
		name: "Obadiah",
		chapters: 1,
		summary: "The Book of the Prophet Obadiah",
	},
	{
		id: "JON",
		name: "Jonah",
		chapters: 4,
		summary: "The Book of the Prophet Jonah",
	},
	{
		id: "MIC",
		name: "Micah",
		chapters: 7,
		summary: "The Book of the Prophet Micah",
	},
	{
		id: "NAM",
		name: "Nahum",
		chapters: 3,
		summary: "The Book of the Prophet Nahum",
	},
	{
		id: "HAB",
		name: "Habakkuk",
		chapters: 3,
		summary: "The Book of the Prophet Habakkuk",
	},
	{
		id: "ZEP",
		name: "Zephaniah",
		chapters: 3,
		summary: "The Book of the Prophet Zephaniah",
	},
	{
		id: "HAG",
		name: "Haggai",
		chapters: 2,
		summary: "The Book of the Prophet Haggai",
	},
	{
		id: "ZEC",
		name: "Zechariah",
		chapters: 14,
		summary: "The Book of the Prophet Zechariah",
	},
	{
		id: "MAL",
		name: "Malachi",
		chapters: 4,
		summary: "The Book of the Prophet Malachi",
	},
	{
		id: "MAT",
		name: "Matthew",
		chapters: 28,
		summary: "The Gospel According to St. Matthew",
	},
	{
		id: "MRK",
		name: "Mark",
		chapters: 16,
		summary: "The Gospel According to St. Mark",
	},
	{
		id: "LUK",
		name: "Luke",
		chapters: 24,
		summary: "The Gospel According to St. Luke",
	},
	{
		id: "JHN",
		name: "John",
		chapters: 21,
		summary: "The Gospel According to St. John",
	},
	{
		id: "ACT",
		name: "Acts",
		chapters: 28,
		summary: "The Acts of the Apostles",
	},
	{
		id: "ROM",
		name: "Romans",
		chapters: 16,
		summary: "The Epistle of Paul the Apostle to the Romans",
	},
	{
		id: "1CO",
		name: "1 Corinthians",
		chapters: 16,
		summary: "The First Epistle of Paul the Apostle to the Corinthians",
	},
	{
		id: "2CO",
		name: "2 Corinthians",
		chapters: 13,
		summary: "The Second Epistle of Paul the Apostle to the Corinthians",
	},
	{
		id: "GAL",
		name: "Galatians",
		chapters: 6,
		summary: "The Epistle of Paul the Apostle to the Galatians",
	},
	{
		id: "EPH",
		name: "Ephesians",
		chapters: 6,
		summary: "The Epistle of Paul the Apostle to the Ephesians",
	},
	{
		id: "PHP",
		name: "Philippians",
		chapters: 4,
		summary: "The Epistle of Paul the Apostle to the Philippians",
	},
	{
		id: "COL",
		name: "Colossians",
		chapters: 4,
		summary: "The Epistle of Paul the Apostle to the Colossians",
	},
	{
		id: "1TH",
		name: "1 Thessalonians",
		chapters: 5,
		summary: "The First Epistle of Paul the Apostle to the Thessalonians",
	},
	{
		id: "2TH",
		name: "2 Thessalonians",
		chapters: 3,
		summary: "The Second Epistle of Paul the Apostle to the Thessalonians",
	},
	{
		id: "1TI",
		name: "1 Timothy",
		chapters: 6,
		summary: "The First Epistle of Paul to Timothy",
	},
	{
		id: "2TI",
		name: "2 Timothy",
		chapters: 4,
		summary: "The Second Epistle of Paul to Timothy",
	},
	{
		id: "TIT",
		name: "Titus",
		chapters: 3,
		summary: "The Epistle of Paul to Titus",
	},
	{
		id: "PHM",
		name: "Philemon",
		chapters: 1,
		summary: "The Epistle of Paul to Philemon",
	},
	{
		id: "HEB",
		name: "Hebrews",
		chapters: 13,
		summary: "The Epistle of Paul the Apostle to the Hebrews",
	},
	{
		id: "JAS",
		name: "James",
		chapters: 5,
		summary: "The General Epistle of James",
	},
	{
		id: "1PE",
		name: "1 Peter",
		chapters: 5,
		summary: "The First General Epistle of Peter",
	},
	{
		id: "2PE",
		name: "2 Peter",
		chapters: 3,
		summary: "The Second General Epistle of Peter",
	},
	{
		id: "1JN",
		name: "1 John",
		chapters: 5,
		summary: "The First General Epistle of John",
	},
	{
		id: "2JN",
		name: "2 John",
		chapters: 1,
		summary: "The Second Epistle of John",
	},
	{
		id: "3JN",
		name: "3 John",
		chapters: 1,
		summary: "The Third Epistle of John",
	},
	{
		id: "JUD",
		name: "Jude",
		chapters: 1,
		summary: "The General Epistle of Jude",
	},
	{
		id: "REV",
		name: "Revelation",
		chapters: 22,
		summary: "The Revelation of St. John the Divine",
	},
];

/**
 * For single-chapter books the API reads `Jude 1` as the first *verse*, so the
 * whole chapter needs an explicit verse range — and the API 404s on ranges
 * that run past the end, so the verse counts must be exact (identical across
 * all offered translations).
 */
const SINGLE_CHAPTER_VERSES: Record<string, number> = {
	OBA: 21,
	PHM: 25,
	"2JN": 13,
	"3JN": 14,
	JUD: 25,
};

// ---------------------------------------------------------------------------
// Translations (each verified live against `?translation=`)
// ---------------------------------------------------------------------------

export const TRANSLATIONS: { value: string; label: string }[] = [
	{ value: "web", label: "WEB — World English Bible" },
	{ value: "kjv", label: "KJV — King James Version" },
	{ value: "bbe", label: "BBE — Bible in Basic English" },
	{ value: "webbe", label: "WEBBE — World English Bible, British Edition" },
	{
		value: "oeb-us",
		label: "OEB-US — Open English Bible, US Edition (NT only)",
	},
	{
		value: "oeb-cw",
		label: "OEB-CW — Open English Bible, Commonwealth Edition (NT only)",
	},
	{ value: "clementine", label: "Clementine Latin Vulgate (Latin)" },
	{ value: "almeida", label: "João Ferreira de Almeida (Portuguese)" },
	{ value: "rccv", label: "Cornilescu Version (Romanian)" },
];

/** Static fallback names, shown if the per-translation probe fails. */
export const TRANSLATION_NAMES: Record<string, string> = {
	web: "World English Bible",
	kjv: "King James Version",
	bbe: "Bible in Basic English",
	webbe: "World English Bible, British Edition",
	"oeb-us": "Open English Bible, US Edition",
	"oeb-cw": "Open English Bible, Commonwealth Edition",
	clementine: "Clementine Latin Vulgate",
	almeida: "João Ferreira de Almeida",
	rccv: "Protestant Romanian Corrected Cornilescu Version",
};

/** BCP-47 language per translation, for `EntryDetailed.language`. */
export const TRANSLATION_LANGUAGES: Record<string, string> = {
	web: "en",
	kjv: "en",
	bbe: "en",
	webbe: "en",
	"oeb-us": "en",
	"oeb-cw": "en",
	clementine: "la",
	almeida: "pt",
	rccv: "ro",
};

// ---------------------------------------------------------------------------
// Lookups & queries
// ---------------------------------------------------------------------------

export function findBook(uid: string): BookInfo | undefined {
	const key = uid.trim().toLowerCase();
	return BOOKS.find(
		(book) => book.id.toLowerCase() === key || book.name.toLowerCase() === key,
	);
}

/** Case-insensitive substring match over the 66 book names (whitespace is
 * ignored on both sides, so "1john" finds "1 John"). */
export function searchBooks(term: string): BookInfo[] {
	const needle = term.trim().toLowerCase();
	if (needle.length === 0) {
		return [];
	}
	const compact = needle.replace(/\s+/g, "");
	return BOOKS.filter((book) => {
		const name = book.name.toLowerCase();
		return name.includes(needle) || name.replace(/\s+/g, "").includes(compact);
	});
}

/**
 * Query string for a whole chapter. Multi-chapter books use a chapter
 * reference (`JHN+3`); single-chapter books need an exact verse range
 * (`JUD+1:1-25`) because `Jude 1` alone means verse 1.
 */
export function chapterQuery(book: BookInfo, chapter: number): string {
	if (book.chapters > 1) {
		return `${book.id}+${chapter}`;
	}
	const verses = SINGLE_CHAPTER_VERSES[book.id] ?? 1;
	return `${book.id}+1:1-${verses}`;
}

/** The runtime VM has no URL globals, so build URLs by hand. The `+`
 * separators are intentional (they encode spaces in the reference). */
export function passageUrl(query: string, translation?: string): string {
	const suffix = translation
		? `?translation=${encodeURIComponent(translation)}`
		: "";
	return `${API_BASE}/${query}${suffix}`;
}

export function makeEpisodeUid(book: BookInfo, chapter: number): string {
	return `${book.id}#${chapter}`;
}

export function parseEpisodeUid(uid: string): {
	book: BookInfo;
	chapter: number;
} {
	const [bookId, chapterRaw] = uid.split("#");
	const book = bookId === undefined ? undefined : findBook(bookId);
	const chapter = Number(chapterRaw);
	if (
		book === undefined ||
		!Number.isInteger(chapter) ||
		chapter < 1 ||
		chapter > book.chapters
	) {
		throw new Error(`bible-api: invalid chapter reference "${uid}"`);
	}
	return { book, chapter };
}

/** Verse text arrives with stray newlines/spaces; collapse them. */
export function formatVerseText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function bookDescription(book: BookInfo): string {
	const chapters =
		book.chapters === 1 ? "1 chapter" : `${book.chapters} chapters`;
	return `${book.summary} — ${chapters}.`;
}
