// Pure helpers for talking to Wikisource's MediaWiki API and the WS Export
// tool. Kept free of the built-in `network`/`parse` modules so it can be
// unit-tested directly under bun.
//
// Endpoint shapes used (all verified against the live API):
// - search:      /w/api.php?action=query&list=search&srsearch=<q>&srlimit& sroffset
// - chapters:    /w/api.php?action=query&list=allpages&apprefix=<Book Title/>
// - listing:     /w/api.php?action=query&list=categorymembers&cmtitle=Category:Featured texts
// - page HTML:   /w/api.php?action=parse&page=<Title>&prop=text&redirects=1
// - full EPUB:   https://ws-export.wmcloud.org/?format=epub&lang=<lang>&page=<Title>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

/** Language editions offered in the extension settings dropdown. */
export const LANGUAGES: { value: string; label: string }[] = [
	{ value: "en", label: "English — en.wikisource.org" },
	{ value: "de", label: "German — de.wikisource.org" },
	{ value: "fr", label: "French — fr.wikisource.org" },
	{ value: "es", label: "Spanish — es.wikisource.org" },
	{ value: "it", label: "Italian — it.wikisource.org" },
	{ value: "ru", label: "Russian — ru.wikisource.org" },
	{ value: "pl", label: "Polish — pl.wikisource.org" },
	{ value: "zh", label: "Chinese — zh.wikisource.org" },
];

/**
 * Curated browse listings per language (categorymembers). English is the only
 * edition with a verified "featured texts" category; other languages fall
 * back to the alphabetical works listing in browse().
 */
export const FEATURED_CATEGORIES: Record<string, string> = {
	en: "Category:Featured texts",
};

export const LANGUAGE_SETTING_ID = "wikisource_lang";

export const USER_AGENT =
	"Dion-Wikisource-Extension/1.0 (Dion media app; https://www.wikisource.org)";

// ---------------------------------------------------------------------------
// URL helpers (the runtime VM has no URL globals, encode by hand)
// ---------------------------------------------------------------------------

/** Encodes a query string from key/value pairs. */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

/** MediaWiki page name -> wiki path (spaces to underscores, segments kept). */
export function wikiPath(title: string): string {
	return title
		.replace(/ /g, "_")
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

export function wikiUrl(lang: string, title: string): string {
	return `https://${lang}.wikisource.org/wiki/${wikiPath(title)}`;
}

export function apiUrl(lang: string, pairs: [string, string][]): string {
	return `https://${lang}.wikisource.org/w/api.php?${encodeQuery([
		["format", "json"],
		...pairs,
	])}`;
}

/**
 * WS Export renders any work to an EPUB. This is the exact URL shape the
 * "Download as EPUB" sidebar links on wikisource use (verified on the live
 * site); the tool serves the generated file from this URL directly.
 */
export function wsExportUrl(lang: string, title: string): string {
	return `https://ws-export.wmcloud.org/?${encodeQuery([
		["format", "epub"],
		["lang", lang],
		["page", title.replace(/ /g, "_")],
	])}`;
}

// ---------------------------------------------------------------------------
// Entry/Episode ids
// ---------------------------------------------------------------------------
// MediaWiki titles cannot contain "|", so `<lang>|<title>` (and
// `<lang>|<title>|epub` for the full-book episode) is collision free.

export interface EntryData {
	lang: string;
	title: string;
	snippet?: string;
}

export interface EpisodeData {
	lang: string;
	title: string;
	epub?: boolean;
}

export function makeUid(lang: string, title: string): string {
	return `${lang}|${title}`;
}

export function makeEpubUid(lang: string, title: string): string {
	return `${lang}|${title}|epub`;
}

/** Parses `<lang>|<title>[|epub]` uids. Unknown languages fall back to "en". */
export function parseUid(uid: string): {
	lang: string;
	title: string;
	epub: boolean;
} {
	const parts = uid.split("|");
	const lang = parts.length > 1 && parts[0] ? parts[0] : "en";
	const epub = parts.length > 2 && parts[parts.length - 1] === "epub";
	const titleParts = parts.splice(1, parts.length - 1 - (epub ? 1 : 0));
	const title = titleParts.join("|");
	return { lang, title, epub };
}

export function makeIdData(data: EntryData | EpisodeData): string {
	return JSON.stringify(data);
}

export function parseIdData(
	iddata: string | null | undefined,
): (EntryData & EpisodeData) | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<EntryData & EpisodeData>;
		if (typeof parsed.title !== "string" || parsed.title.length === 0) {
			return null;
		}
		return {
			lang: typeof parsed.lang === "string" && parsed.lang ? parsed.lang : "en",
			title: parsed.title,
			snippet:
				typeof parsed.snippet === "string" && parsed.snippet.length > 0
					? parsed.snippet
					: undefined,
			epub: parsed.epub === true,
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	shy: "\u00ad",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	bull: "•",
	dagger: "†",
	midpoint: "·",
	deg: "°",
	sect: "§",
	para: "¶",
	pound: "£",
	euro: "€",
	yen: "¥",
	cent: "¢",
	copy: "©",
	reg: "®",
	trade: "™",
	times: "×",
	divide: "÷",
	laquo: "«",
	raquo: "»",
};

/** Decodes the common named entities plus decimal/hex numeric references. */
export function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			codePointToChar(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			codePointToChar(Number.parseInt(dec, 10)),
		)
		.replace(
			/&([a-zA-Z]+);/g,
			(match, name: string) => NAMED_ENTITIES[name] ?? match,
		);
}

function codePointToChar(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
		return "";
	}
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

/** Strips HTML tags (<br> becomes a space) and decodes entities. Style and
 * script blocks are removed wholesale — page templates embed CSS in ways that
 * would otherwise leak into the text. */
export function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<br\s*\/?>/gi, " "),
	)
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Normalises nbsp / zero-width chars / whitespace runs in parsed text. */
export function cleanParagraphText(text: string): string {
	return text
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// Sorting / naming
// ---------------------------------------------------------------------------

/** Natural sort so "Chapter 2" sorts before "Chapter 10". */
export function naturalCompare(a: string, b: string): number {
	const ax = a.split(/(\d+)/);
	const bx = b.split(/(\d+)/);
	const len = Math.max(ax.length, bx.length);
	for (let i = 0; i < len; i++) {
		const x = ax[i];
		const y = bx[i];
		if (x === undefined) {
			return -1;
		}
		if (y === undefined) {
			return 1;
		}
		if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
			const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10);
			if (diff !== 0) {
				return diff;
			}
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/** "Book/Chapter 1" -> "Chapter 1"; falls back to the full title. */
export function chapterName(chapter: string, book: string): string {
	const prefix = `${book}/`;
	if (chapter.startsWith(prefix)) {
		const name = chapter.slice(prefix.length);
		if (name.length > 0) {
			return name;
		}
	}
	return chapter;
}

// ---------------------------------------------------------------------------
// Raw HTML scanning (string level; the runtime DOM parser is only used for
// paragraph conversion, these regexes are easier to keep deterministic)
// ---------------------------------------------------------------------------

/** Author from the hidden ws-data block the header template renders. */
export function extractAuthor(html: string): string | null {
	const match = /<span[^>]*id="ws-author"[^>]*>([\s\S]*?)<\/span>/.exec(html);
	if (!match) {
		return null;
	}
	const author = stripHtml(match[1] ?? "");
	return author.length > 0 ? author : null;
}

/**
 * First usable illustration as a cover: skips the small icons/logos that ship
 * with the header template by requiring a minimum rendered width (either the
 * width attribute or the thumbnail size encoded in the file path).
 */
export function findCoverUrl(html: string, minWidth = 120): string | null {
	const tagRe = /<img\b[^>]*>/gi;
	let tag: RegExpExecArray | null;
	while ((tag = tagRe.exec(html)) !== null) {
		const source = /src="([^"]+)"/.exec(tag[0])?.[1];
		if (!source || !source.startsWith("//")) {
			continue;
		}
		let width = Number.parseInt(/width="(\d+)"/.exec(tag[0])?.[1] ?? "", 10);
		if (!Number.isFinite(width)) {
			const thumb = /\/(\d{2,})px-/.exec(source)?.[1];
			width = thumb ? Number.parseInt(thumb, 10) : Number.NaN;
		}
		if (Number.isFinite(width) && width >= minWidth) {
			// The parser output appends utm tracking params; drop them.
			return `https:${source.split("?")[0]}`;
		}
	}
	return null;
}

/** True when the page is a "Versions of X" disambiguation page. */
export function hasVersionsList(html: string): boolean {
	return /class="[^"]*\bsubNote\b[^"]*"/.test(html);
}

const LINK_NAMESPACE_PREFIXES =
	/^(Author|Portal|Category|File|Image|Help|Template|Wikisource|WikiDrive|Special|Talk|User|Index|Page|Proofread|Module|MediaWiki|Translation|Subject|Media|w|s|d|m|c|wikt|b|v|q|n|wikisource):/i;

/**
 * First content link of a versions list ("Versions of X include:") that is a
 * readable work and not a header/nav/sister-project link. Returns the page
 * title (spaces, decoded) or null.
 */
export function extractVersionsLink(html: string): string | null {
	const hrefRe = /<a\b[^>]*href="((?:\/wiki|\.\/)[^"#]+)"/gi;
	let match: RegExpExecArray | null;
	while ((match = hrefRe.exec(html)) !== null) {
		const href = match[1] ?? "";
		const path = href.startsWith("./") ? href.slice(1) : href.slice(6); // strip "/wiki" -> keep leading "/"
		const title = cleanParagraphText(
			decodeEntities(decodeURIComponentSafe(path.replace(/_/g, " "))),
		).replace(/^\//, "");
		if (
			title.length === 0 ||
			LINK_NAMESPACE_PREFIXES.test(title) ||
			title.includes(":") // any namespace-ish link (colon before content)
		) {
			continue;
		}
		return title;
	}
	return null;
}

function decodeURIComponentSafe(input: string): string {
	try {
		return decodeURIComponent(input);
	} catch {
		return input;
	}
}

/**
 * First substantial body paragraph of a page, used as the description for
 * works that were not found through search (search snippets are preferred).
 */
export function firstParagraphText(html: string, maxChars = 400): string {
	const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
	let match: RegExpExecArray | null;
	while ((match = pRe.exec(html)) !== null) {
		const attrs = match[1] ?? "";
		if (/ws-noexport|noprint|plainSister|searchaux/.test(attrs)) {
			continue;
		}
		const text = stripHtml(match[2] ?? "");
		if (text.length < 40) {
			continue;
		}
		return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
	}
	return "";
}

// ---------------------------------------------------------------------------
// MediaWiki API response shapes
// ---------------------------------------------------------------------------

export interface ApiError {
	error?: { code?: string; info?: string };
}

export interface SearchResponse extends ApiError {
	continue?: { sroffset?: number };
	query?: {
		search?: { ns?: number; title?: string; snippet?: string }[];
	};
}

export interface AllpagesResponse extends ApiError {
	continue?: { apcontinue?: string };
	query?: { allpages?: { ns?: number; title?: string }[] };
}

export interface CategorymembersResponse extends ApiError {
	continue?: { cmcontinue?: string };
	query?: { categorymembers?: { ns?: number; title?: string }[] };
}

export interface ParseResponse extends ApiError {
	parse?: {
		title?: string;
		text?: { "*": string };
	};
}

/** Human-readable error for a MediaWiki API error payload. */
export function apiErrorMessage(data: ApiError, fallback: string): string {
	return data.error?.info ? `${fallback}: ${data.error.info}` : fallback;
}
