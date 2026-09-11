// Pure helpers for talking to Wikibooks' MediaWiki API. Kept free of the
// built-in `network`/`parse` modules so it can be unit-tested directly under
// bun.
//
// Endpoint shapes used (all verified against the live API):
// - search:      /w/api.php?action=query&list=search&srsearch=<q>&srlimit& sroffset
// - browse (en): /w/api.php?action=query&list=categorymembers&cmtitle=Category:Featured books
// - listing:     /w/api.php?action=query&list=allpages&apnamespace=0&apfilterredir=nonredirects
// - chapters:    /w/api.php?action=query&list=allpages&apprefix=<Book Title/>
//                Books living in a custom namespace (Cookbook:, Wikijunior:)
//                resolve their namespace id via meta=siteinfo&siprop=namespaces
//                and list with apprefix=<Leaf/> in that namespace.
// - page HTML:   /w/api.php?action=parse&page=<Title>&prop=text&redirects=1

import type { Paragraph, TextStyle } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

/** Language editions offered in the extension settings dropdown. All nine
 * subdomains were verified to answer /w/api.php. */
export const LANGUAGES: { value: string; label: string }[] = [
	{ value: "en", label: "English — en.wikibooks.org" },
	{ value: "de", label: "German — de.wikibooks.org" },
	{ value: "fr", label: "French — fr.wikibooks.org" },
	{ value: "es", label: "Spanish — es.wikibooks.org" },
	{ value: "it", label: "Italian — it.wikibooks.org" },
	{ value: "pt", label: "Portuguese — pt.wikibooks.org" },
	{ value: "ru", label: "Russian — ru.wikibooks.org" },
	{ value: "zh", label: "Chinese — zh.wikibooks.org" },
	{ value: "ja", label: "Japanese — ja.wikibooks.org" },
];

/**
 * Curated browse listings per language (categorymembers). English has a
 * verified "Featured books" category; other languages fall back to the
 * alphabetical works listing in browse().
 */
export const FEATURED_CATEGORIES: Record<string, string> = {
	en: "Category:Featured books",
};

export const LANGUAGE_SETTING_ID = "wikibooks_lang";

export const USER_AGENT =
	"Dion-Wikibooks-Extension/1.0 (Dion media app; https://www.wikibooks.org)";

/** Attribution note shown in the detail view. Wikibooks text is dual-licensed. */
export const ATTRIBUTION =
	"Text is available under the Creative Commons Attribution-ShareAlike License (and, for many books, the GNU Free Documentation License); additional terms may apply. Wikibooks is a Wikimedia project written by volunteers.";

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
	return `https://${lang}.wikibooks.org/wiki/${wikiPath(title)}`;
}

export function apiUrl(lang: string, pairs: [string, string][]): string {
	return `https://${lang}.wikibooks.org/w/api.php?${encodeQuery([
		["format", "json"],
		...pairs,
	])}`;
}

// ---------------------------------------------------------------------------
// Entry/Episode ids
// ---------------------------------------------------------------------------
// MediaWiki titles cannot contain "|", so `<lang>|<title>` is collision free.

export interface EntryData {
	lang: string;
	title: string;
	snippet?: string;
}

export interface EpisodeData {
	lang: string;
	title: string;
}

export interface IdData {
	lang: string;
	title: string;
	snippet?: string;
}

export function makeUid(lang: string, title: string): string {
	return `${lang}|${title}`;
}

/** Parses `<lang>|<title>` uids. Unknown languages fall back to "en". */
export function parseUid(uid: string): { lang: string; title: string } {
	const parts = uid.split("|");
	const lang = parts.length > 1 && parts[0] ? parts[0] : "en";
	const title = parts.slice(1).join("|");
	return { lang, title };
}

export function makeIdData(data: EntryData | EpisodeData): string {
	return JSON.stringify(data);
}

export function parseIdData(iddata: string | null | undefined): IdData | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<IdData>;
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

/** Removes [edit] section markers and [12]-style citation superscripts that
 * MediaWiki renders into the page text. */
export function stripEditAndCiteMarkers(text: string): string {
	return text.replace(/\[(?:\s*edit\s*|\d+[a-z]?)\]/gi, "");
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
// Namespaces
// ---------------------------------------------------------------------------
// Wikibooks keeps whole book families in custom namespaces ("Cookbook:",
// "Wikijunior:" on en) whose ids differ per language edition, so the map is
// resolved dynamically from meta=siteinfo.

export interface NamespacesResponse extends ApiError {
	query?: {
		namespaces?: Record<
			string,
			{ id?: number; "*"?: string; canonical?: string }
		>;
	};
}

function normalizeNamespaceName(name: string): string {
	return name.replace(/ /g, "_").toLowerCase();
}

/** Builds a lowercase name/canonical name -> namespace id map from a
 * siteinfo namespaces payload, skipping virtual namespaces. */
export function parseNamespaceMap(
	data: NamespacesResponse,
): Record<string, number> {
	const map: Record<string, number> = {};
	for (const ns of Object.values(data.query?.namespaces ?? {})) {
		const id = ns.id;
		if (typeof id !== "number" || id < 0) {
			continue;
		}
		const name = ns["*"];
		if (typeof name === "string" && name.length > 0) {
			map[normalizeNamespaceName(name)] = id;
		}
		const canonical = ns.canonical;
		if (typeof canonical === "string" && canonical.length > 0) {
			map[normalizeNamespaceName(canonical)] = id;
		}
	}
	return map;
}

export interface NamespaceSplit {
	namespace: number;
	leaf: string;
}

/**
 * Splits "Wikijunior:Solar System" into namespace 110 + leaf "Solar System"
 * using the wiki's namespace map. Titles without a colon, or whose prefix is
 * not a known namespace, are main space (ns 0).
 */
export function splitTitleNamespace(
	title: string,
	namespaces: Record<string, number>,
): NamespaceSplit {
	const colon = title.indexOf(":");
	if (colon <= 0) {
		return { namespace: 0, leaf: title };
	}
	const id = namespaces[normalizeNamespaceName(title.slice(0, colon))];
	if (id === undefined) {
		return { namespace: 0, leaf: title };
	}
	return { namespace: id, leaf: title.slice(colon + 1) };
}

// ---------------------------------------------------------------------------
// Raw HTML scanning (string level; the runtime DOM parser is only used for
// paragraph conversion, these regexes are easier to keep deterministic)
// ---------------------------------------------------------------------------

/**
 * First usable illustration as a cover: skips the small icons/logos that ship
 * with book templates by requiring a minimum rendered width (either the
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

/**
 * First substantial body paragraph of a page, used as the description for
 * books that were not found through search (search snippets are preferred).
 */
export function firstParagraphText(html: string, maxChars = 400): string {
	const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
	let match: RegExpExecArray | null;
	while ((match = pRe.exec(html)) !== null) {
		const attrs = match[1] ?? "";
		if (/noprint|searchaux|mw-empty-elt|docinfo/.test(attrs)) {
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
// Rendered HTML -> Paragraph conversion
// ---------------------------------------------------------------------------

/** Minimal structural view of a parsed DOM element. The runtime's DionElement
 * satisfies this interface, which keeps the walker unit-testable under bun
 * without importing the host-provided `parse` module. */
export interface ElementLike {
	name: string;
	text: string;
	attr(name: string): string;
	children: { length: number; get(index: number): ElementLike | undefined };
}

/** Inline/noise tags whose text is either covered by the parent block or
 * never wanted (images, scripts, styles). */
const SKIP_TAGS = new Set([
	"style",
	"script",
	"link",
	"meta",
	"img",
	"figure",
	"audio",
	"video",
	"source",
	"track",
	"picture",
	"input",
	"button",
	"select",
	"textarea",
	"canvas",
	"svg",
	"sup",
]);

/** Header/navigation templates, maintenance boxes, reference lists, TOCs,
 * edit notices — everything that is not the book's running prose. */
const SKIP_CLASSES = new Set([
	"noprint",
	"mw-editsection",
	"mw-references-wrap",
	"references",
	"reference",
	"mw-ref",
	"reflink",
	"toc",
	"toccolours",
	"navbox",
	"navigation",
	"horizontal-navbox",
	"sidebar",
	"infobox",
	"metadata",
	"mbox",
	"ambox",
	"ombox",
	"tmbox",
	"dmbox",
	"docinfo",
	"catlinks",
	"printfooter",
	"magnify",
	"licenseContainer",
	"licensetpl",
	"mw-jump-link",
	"mw-empty-elt",
	"shortcut",
]);

const SKIP_IDS = new Set([
	"toc",
	"siteSub",
	"jump-to-nav",
	"catlinks",
	"footer",
	"mw-navigation",
]);

/** Block elements emitted as one text paragraph (their whole subtree text). */
const EMIT_TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"dt",
	"dd",
	"td",
	"th",
	"figcaption",
	"pre",
	"center",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Structural wrappers that are recursed into. MediaWiki wraps orphan text
 * in <p> automatically, so recursing loses no visible text. */
const CONTAINER_TAGS = new Set([
	"div",
	"section",
	"article",
	"main",
	"header",
	"footer",
	"blockquote",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"ul",
	"ol",
	"dl",
]);

function isSkippable(cls: string, id: string): boolean {
	if (id.length > 0 && SKIP_IDS.has(id)) {
		return true;
	}
	for (const token of cls.split(/\s+/)) {
		if (token.length > 0 && SKIP_CLASSES.has(token)) {
			return true;
		}
	}
	return false;
}

/** Template CSS sometimes leaks into an element's text extraction. */
function isCssJunk(text: string): boolean {
	return (
		text.includes(".mw-parser-output") ||
		text.startsWith("@media") ||
		(text.includes("{") && text.includes("}"))
	);
}

function pushParagraph(
	out: Paragraph[],
	text: string,
	style: TextStyle | null,
) {
	if (text.length > 0 && !isCssJunk(text)) {
		out.push({ type: "Text", content: text, style });
	}
}

function walk(el: ElementLike, out: Paragraph[], depth: number): void {
	if (depth > 24) {
		return;
	}
	const children = el.children;
	for (let i = 0; i < children.length; i++) {
		const child = children.get(i);
		if (!child) {
			continue;
		}
		const name = child.name.toLowerCase();
		if (SKIP_TAGS.has(name)) {
			continue;
		}
		if (isSkippable(child.attr("class") ?? "", child.attr("id") ?? "")) {
			continue;
		}
		if (EMIT_TAGS.has(name)) {
			const text = stripEditAndCiteMarkers(cleanParagraphText(child.text));
			if (name === "li") {
				pushParagraph(out, `• ${text}`, null);
			} else if (HEADING_TAGS.has(name)) {
				pushParagraph(out, text, { bold: true });
			} else if (name === "figcaption") {
				pushParagraph(out, text, { italic: true });
			} else {
				pushParagraph(out, text, null);
			}
			continue;
		}
		if (CONTAINER_TAGS.has(name)) {
			walk(child, out, depth + 1);
		}
		// Inline elements (span, a, b, i, …) contribute their text through
		// the emitting block ancestor.
	}
}

/**
 * Converts a parsed `div.mw-parser-output` tree into reading paragraphs.
 * Accepts any ElementLike so it can be tested without the runtime parser.
 */
export function collectParagraphs(root: ElementLike): Paragraph[] {
	const out: Paragraph[] = [];
	walk(root, out, 0);
	if (out.length === 0) {
		// Last resort for exotic structures: flatten the whole page.
		const text = stripEditAndCiteMarkers(cleanParagraphText(root.text));
		pushParagraph(out, text, null);
	}
	return out;
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
