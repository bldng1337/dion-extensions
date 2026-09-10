// Pure helpers for talking to the Baen Free Library. Kept free of the
// built-in `network`/`parse` modules so it can be unit-tested directly under
// bun.
//
// Endpoints (all verified against the live site, 2026-09):
// - catalog:  GET /allbooks/category/getBooks?categoryId=2012&page=1&pageSize=100
//             &filter=name&dir=ASC&hideBundles=0&hideEarcs=0&showAvailable=0
//             (empty filter/dir yields zero results; params are required)
// - reader:   /Chapters/<SKU>/<SKU>.htm          frameset, holds lastPg array
//             /Chapters/<SKU>/<SKU>__c_.htm      cover page: title/author/blurb
//             /Chapters/<SKU>/<SKU>_toc.htm      table of contents
//             /Chapters/<SKU>/<SKU>__<N>.htm     chapter page (see fileNameFor)
// - covers:   /media/catalog/product/... (from the catalog JSON) and the
//             /Chapters/<SKU>/<SKU>.jpg image
//
// Downloads (EPUB/MOBI) are served through /download/index/owned/id/<n> which
// redirects to the login page since the 2024 site redesign - the open reading
// path is the web reader only.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://www.baen.com";

/** Category id of the Baen "Free Library" listing. */
export const FREE_LIBRARY_CATEGORY_ID = "2012";

/** Books per browse page (82 free books => 3 pages). */
export const PAGE_SIZE = 30;

export const USER_AGENT =
	"Dion-Baen-Extension/1.0 (Dion media app; https://www.baen.com)";

/** Full catalog listing in one request (82 books fit easily). */
export function catalogUrl(): string {
	return `${BASE}/allbooks/category/getBooks?${encodeQuery([
		["categoryId", FREE_LIBRARY_CATEGORY_ID],
		["page", "1"],
		["pageSize", "100"],
		["filter", "name"],
		["dir", "ASC"],
		["hideBundles", "0"],
		["hideEarcs", "0"],
		["showAvailable", "0"],
	])}`;
}

/** Encodes a query string from key/value pairs (no URL globals in the VM). */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

export function chaptersUrl(sku: string): string {
	return `${BASE}/Chapters/${encodeURIComponent(sku)}/${encodeURIComponent(sku)}.htm`;
}

export function coverPageUrl(sku: string): string {
	return `${BASE}/Chapters/${encodeURIComponent(sku)}/${encodeURIComponent(sku)}__c_.htm`;
}

export function tocPageUrl(sku: string): string {
	return `${BASE}/Chapters/${encodeURIComponent(sku)}/${encodeURIComponent(sku)}_toc.htm`;
}

export function chapterFileUrl(sku: string, file: string): string {
	return `${BASE}/Chapters/${encodeURIComponent(sku)}/${encodeURIComponent(file)}`;
}

/**
 * The Baen chapter files use underscore-padded numbers: files 1-9 are
 * `<SKU>___N.htm` (three underscores), 10-99 `<SKU>__N.htm`, and so on - the
 * whole suffix is right-aligned in a four character field. Only used as a
 * fallback; the real file names come from the TOC hrefs.
 */
export function fileNameFor(sku: string, number: number): string {
	const digits = String(number);
	const padding = "_".repeat(Math.max(1, 4 - digits.length));
	return `${sku}${padding}${digits}.htm`;
}

/** Chapter file names look like `<SKU>___6.htm`; the reader cover page
 * (`<SKU>__c_.htm`) is accepted too. Used for safety checks. */
export function isChapterFileName(file: string): boolean {
	return /^[\w.+-]+_(?:\d+|c_)\.htm$/i.test(file);
}

// ---------------------------------------------------------------------------
// Entry/episode ids
// ---------------------------------------------------------------------------
// SKUs never contain "|", so `<SKU>|<file>` is collision free.

export interface EpisodeRef {
	sku: string;
	file: string;
}

export function makeEpisodeUid(sku: string, file: string): string {
	return `${sku}|${file}`;
}

export function makeEpisodeIdData(sku: string, file: string): string {
	return JSON.stringify({ sku, file } satisfies EpisodeRef);
}

/** Parses `<SKU>|<file>` uids. Files default to the reader cover page. */
export function parseEpisodeUid(uid: string): EpisodeRef | null {
	const index = uid.indexOf("|");
	if (index <= 0) {
		return uid.length > 0 ? { sku: uid, file: `${uid}__c_.htm` } : null;
	}
	const sku = uid.slice(0, index);
	const file = uid.slice(index + 1);
	if (sku.length === 0 || !isChapterFileName(file)) {
		return null;
	}
	return { sku, file };
}

export function parseEpisodeIdData(
	iddata: string | null | undefined,
): EpisodeRef | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<EpisodeRef>;
		if (typeof parsed.sku !== "string" || parsed.sku.length === 0) {
			return null;
		}
		if (typeof parsed.file !== "string" || !isChapterFileName(parsed.file)) {
			return null;
		}
		return { sku: parsed.sku, file: parsed.file };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Catalog parsing
// ---------------------------------------------------------------------------

export interface CatalogBook {
	sku: string;
	name: string;
	url: string;
	cover: string | null;
}

interface RawProduct {
	name?: unknown;
	sku?: unknown;
	productUrl?: unknown;
	imageUrl?: unknown;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Maps the getBooks JSON payload to catalog books (deduped by SKU). */
export function parseCatalog(body: unknown): CatalogBook[] {
	const products =
		(body as { productData?: unknown } | null)?.productData ?? [];
	if (!Array.isArray(products)) {
		return [];
	}
	const books: CatalogBook[] = [];
	const seen = new Set<string>();
	for (const raw of products) {
		if (typeof raw !== "object" || raw === null) {
			continue;
		}
		const product = raw as RawProduct;
		const sku = asString(product.sku);
		if (!sku || seen.has(sku)) {
			continue;
		}
		seen.add(sku);
		const url = asString(product.productUrl) ?? chaptersUrl(sku);
		const images = Array.isArray(product.imageUrl) ? product.imageUrl : [];
		const cover = images.map(asString).find((u) => u !== null) ?? null;
		books.push({
			sku,
			name: (asString(product.name) ?? sku).trim(),
			url,
			cover,
		});
	}
	return books;
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
	middot: "·",
	deg: "°",
	sect: "§",
	copy: "©",
	reg: "®",
	trade: "™",
	laquo: "«",
	raquo: "»",
	eacute: "é",
	egrave: "è",
	aacute: "á",
	oacute: "ó",
	uacute: "ú",
	ntilde: "ñ",
};

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

/** Strips tags and comments from html and decodes entities. */
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
export function cleanText(text: string): string {
	return text
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Lowercases and removes diacritics for forgiving search matching. */
export function normalizeForSearch(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

/**
 * True for the reader's "Back | Next / Contents / Framed" navigation
 * paragraphs: they contain nothing but those words and separators.
 */
export function isNavText(text: string): boolean {
	const stripped = text
		.replace(/back|next|contents|framed/gi, "")
		.replace(/[|\s]/g, "");
	return stripped.length === 0;
}

// ---------------------------------------------------------------------------
// Reader page parsing
// ---------------------------------------------------------------------------

/**
 * The reader frameset (`<SKU>.htm`) embeds
 * `var lastPg = new Array(0, 5, 7, ...)` - one entry per readable chapter
 * file, the last paragraph number of that file. The array length is the
 * highest available chapter file number. Returns null when absent.
 */
export function parseLastPgCount(html: string): number | null {
	const match = /lastPg\s*=\s*new\s+Array\s*\(([^)]*)\)/.exec(html);
	if (!match) {
		return null;
	}
	const items = (match[1] ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return items.length > 0 ? items.length : null;
}

export interface TocEntry {
	/** Chapter file base name (e.g. `0671578499___6.htm`), null if the TOC
	 * entry lost its link (the published TOC HTML is broken in places). */
	file: string | null;
	/** 1-based chapter file number, null when unknown. */
	number: number | null;
	name: string;
	/** Trailing "by ..." credit line, if any. */
	byline: string | null;
}

const TOC_ENTRY_RE =
	/(?:<a\s[^>]*?href="([^"]+)"[^>]*>\s*)?<b>([\s\S]*?)<\/b>\s*<\/a>([^<]*)/gi;

function chapterNumberFromHref(href: string): number | null {
	const match = /(\d+)\.htm$/i.exec(href);
	if (!match) {
		return null;
	}
	const number = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(number) ? number : null;
}

/**
 * Extracts the chapter entries from a `_toc.htm` page. The published TOC HTML
 * is malformed - many entries lost their opening `<a href=...>` tag - so this
 * matches both linked and bare `<b>title</b></a>` entries in document order.
 */
export function parseTocEntries(html: string): TocEntry[] {
	const entries: TocEntry[] = [];
	TOC_ENTRY_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TOC_ENTRY_RE.exec(html)) !== null) {
		const href = match[1] ?? null;
		const name = stripHtml(match[2] ?? "");
		if (name.length === 0) {
			continue;
		}
		let file: string | null = null;
		let number: number | null = null;
		if (href && isChapterFileName(href.split("/").pop() ?? "")) {
			file = (href.split("/").pop() ?? "").trim();
			number = chapterNumberFromHref(file);
		}
		const byline = stripHtml(match[3] ?? "").replace(/^by\s+/i, "");
		entries.push({
			file,
			number,
			name,
			byline: byline.length > 0 ? byline : null,
		});
	}
	return entries;
}

/** A TOC entry is readable when its file is within the hosted range. */
export function isReadableTocEntry(
	entry: TocEntry,
	lastPgCount: number | null,
): boolean {
	if (entry.file === null || entry.number === null) {
		return false;
	}
	return lastPgCount === null || entry.number < lastPgCount;
}

export interface CoverMeta {
	title: string | null;
	author: string | null;
	copyright: string | null;
	blurb: string;
}

function blurbFromCoverHtml(html: string): string {
	// The blurb lives between the <h1> title and the following <hr>. The
	// first <hr> directly after the </h1> is decoration and skipped.
	let section = html;
	const h1End = html.search(/<\/h1\s*>/i);
	if (h1End >= 0) {
		section = html.slice(h1End + 5).replace(/^\s*<hr\s*\/?>/i, "");
	}
	const hr = section.search(/<hr\s*\/?>/i);
	if (hr >= 0) {
		section = section.slice(0, hr);
	}
	const paragraphs: string[] = [];
	const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
	let match: RegExpExecArray | null;
	while ((match = pRe.exec(section)) !== null) {
		const text = stripHtml(match[1] ?? "");
		if (text.length === 0 || isNavText(text)) {
			continue;
		}
		paragraphs.push(text);
	}
	let blurb = paragraphs.join("\n\n");
	if (blurb.length > 1500) {
		blurb = `${blurb.slice(0, 1500).trim()}…`;
	}
	return blurb;
}

/** Title/author/copyright/blurb from the reader's `<SKU>__c_.htm` page. */
export function parseCoverMeta(html: string): CoverMeta {
	const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
	const title = titleMatch ? stripHtml(titleMatch[1] ?? "") : null;
	const authorMatch =
		/<meta\s+name="?author"?\s+content="([^"]*)"/i.exec(html) ??
		/<meta\s+content="([^"]*)"\s+name="?author"?/i.exec(html);
	const copyrightMatch =
		/<meta\s+name="?copyright"?\s+content="([^"]*)"/i.exec(html) ??
		/<meta\s+content="([^"]*)"\s+name="?copyright"?/i.exec(html);
	return {
		title: title && title.length > 0 ? title : null,
		author: authorMatch ? stripHtml(authorMatch[1] ?? "") || null : null,
		copyright: copyrightMatch
			? stripHtml(copyrightMatch[1] ?? "") || null
			: null,
		blurb: blurbFromCoverHtml(html),
	};
}
