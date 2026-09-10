// ---------------------------------------------------------------------------
// Pure parsing / URL helpers for vorleser.net.
//
// This module intentionally has no imports from the host builtins (`network`,
// `parse`, ...) so it can be unit-tested directly with bun:test.
//
// vorleser.net (relaunched TYPO3 site) serves plain HTML with no API. All
// relevant pages embed `article.audiobook` cards (title link, author, lazy
// cover, runtime) and book pages add a schema.org JSON-LD block plus a
// `/hoerbuch/download/<slug>` link that streams a single MP3. Like the other
// HTML-only extensions in this repo, the pages are parsed with targeted
// regexes instead of the runtime HTML parser.
// ---------------------------------------------------------------------------

export const BASE = "https://www.vorleser.net";

/** Special pages usable as browse categories (verified `article.audiobook` listings). */
export const CATEGORY_ALL = "alle";
export const CATEGORY_NEW = "neu";
export const CATEGORY_HALLOWEEN = "halloween";
export const CATEGORY_CHRISTMAS = "weihnachten";

export interface ListingEntry {
	slug: string;
	title: string;
	author: string;
	cover: string;
	/** Raw runtime label from the card, e.g. "02h:42m", "14m:44s", "01m". */
	duration: string;
}

export interface Listing {
	entries: ListingEntry[];
	/** Highest A-Z pager page (1-based); 1 for the unpaged curated pages. */
	totalPages: number;
}

export interface BookPage {
	slug: string;
	title: string;
	authors: string[];
	/** Volunteers reading the book ("Sprecher*innen"). */
	speakers: string[];
	description: string;
	cover: string;
	categories: string[];
	/** Raw runtime label from the data list, e.g. "02h:42m". */
	duration: string;
	/** Site-relative download href, empty when the book has no free MP3. */
	downloadHref: string;
}

// ---------------------------------------------------------------------------
// Entities and text cleanup
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	szlig: "ß",
	auml: "ä",
	Auml: "Ä",
	ouml: "ö",
	Ouml: "Ö",
	uuml: "ü",
	Uuml: "Ü",
	aring: "å",
	aelig: "æ",
	oslash: "ø",
	eacute: "é",
	egrave: "è",
	agrave: "à",
	ccedil: "ç",
	laquo: "«",
	raquo: "»",
	deg: "°",
	copy: "©",
	reg: "®",
	euro: "€",
};

/**
 * Decode HTML entities in a single pass (named + decimal + hex) so already
 * encoded input like "&amp;lt;" degrades to "&lt;" instead of "<".
 * German umlauts arrive both as raw UTF-8 and as &auml;/&uuml;/&#228;.
 */
export function decodeEntities(input: string): string {
	return input.replace(
		/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(match: string, body: string): string => {
			if (body.startsWith("#x") || body.startsWith("#X")) {
				const code = Number.parseInt(body.slice(2), 16);
				return Number.isFinite(code) ? safeCodePoint(code) : match;
			}
			if (body.startsWith("#")) {
				const code = Number.parseInt(body.slice(1), 10);
				return Number.isFinite(code) ? safeCodePoint(code) : match;
			}
			return NAMED_ENTITIES[body] ?? match;
		},
	);
}

function safeCodePoint(code: number): string {
	return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** Turn an HTML fragment into plain text with paragraph breaks. */
export function stripHtml(html: string): string {
	const text = decodeEntities(
		html
			.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n\n")
			.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
			.replace(/<[^>]+>/g, ""),
	);
	return text
		.replace(/[ \t]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Collapse whitespace runs; the markup indents heavily. */
function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Collect capture group 1 of every match. The regex must carry the `g` flag.
 * Note: iterate the original literal — rebuilding via `re.source` breaks on
 * the runtime VM, whose `source` getter double-escapes `\/`.
 */
function matchAll(text: string, re: RegExp): string[] {
	const out: string[] = [];
	re.lastIndex = 0;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		out.push(m[1] ?? "");
	}
	re.lastIndex = 0;
	return out;
}

/** Resolve a site-relative URL ("files/...", "fileadmin/...", "/...") against BASE. */
export function absolute(url: string): string {
	const trimmed = url.trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return trimmed;
	}
	if (trimmed.startsWith("//")) {
		return `https:${trimmed}`;
	}
	if (trimmed.startsWith("/")) {
		return `${BASE}${trimmed}`;
	}
	if (trimmed.length === 0) {
		return "";
	}
	return `${BASE}/${trimmed}`;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/** Slugs are path segments under /hoerbuch/ — reject anything unsafe. */
export function isValidSlug(slug: string): boolean {
	return /^[\w-]+$/.test(slug);
}

export function bookUrl(slug: string): string {
	return `${BASE}/hoerbuch/${slug}`;
}

/** The per-book MP3 (single file, audio/mpeg). 404s/stream-only books lack it. */
export function downloadUrl(slug: string): string {
	return `${BASE}/hoerbuch/download/${slug}`;
}

/** A-Z listing URL; `page` is 0-based, the site pager starts at 1. */
export function listingUrl(page: number): string {
	const normalized = Math.max(0, page);
	return normalized === 0
		? `${BASE}/hoerbuecher/l`
		: `${BASE}/hoerbuecher/l/${normalized + 1}`;
}

/** URL of a curated single-page listing ("neu", "halloween", "weihnachten"). */
export function curatedUrl(category: string): string | null {
	switch (category) {
		case CATEGORY_NEW:
			return `${BASE}/neue-hoerbuecher`;
		case CATEGORY_HALLOWEEN:
			return `${BASE}/halloween`;
		case CATEGORY_CHRISTMAS:
			return `${BASE}/weihnachten`;
		default:
			return null;
	}
}

/**
 * Site search (ke_search) URL; `page` is 0-based, ke_search pages start at 1.
 * The runtime VM has no URL globals, so encode the query by hand.
 */
export function searchUrl(term: string, page: number): string {
	const normalized = Math.max(0, page);
	return `${BASE}/suche?tx_kesearch_pi1%5Bsword%5D=${encodeURIComponent(term)}&tx_kesearch_pi1%5Bpage%5D=${normalized + 1}&tx_kesearch_pi1%5BresetFilters%5D=0`;
}

// ---------------------------------------------------------------------------
// Listing pages (A-Z list, curated pages, search results)
// ---------------------------------------------------------------------------

const CARD_SPLIT_RE = /<article class="audiobook"/g;
const CARD_SLUG_RE = /href="\/hoerbuch\/([^"]+)"[^>]*title="Detail:/;
const CARD_TITLE_RE = /<span>([\s\S]*?)<\/span>/;
const CARD_AUTHOR_RE = /<p class="author">([\s\S]*?)<\/p>/;
const CARD_COVER_RE = /data-src="([^"]+)"/;
const CARD_DURATION_RE =
	/aria-label="Spieldauer"[\s\S]*?<\/span>\s*([^<]+?)\s*<\/span>/;
const PAGER_LINK_RE = /href="\/hoerbuecher\/l\/(\d+)#audiobooks-list-87"/g;
const RESULT_COUNT_RE = /Wir haben\s*<span[^>]*>([\d.\s]+)<\/span>\s*Treffer/i;

/** Parse one page of `article.audiobook` cards (listing, curated or search). */
export function parseListing(html: string): ListingEntry[] {
	const entries: ListingEntry[] = [];
	for (const chunk of html.split(CARD_SPLIT_RE).slice(1)) {
		const slug = decodeEntities(CARD_SLUG_RE.exec(chunk)?.[1] ?? "");
		if (slug.length === 0 || !isValidSlug(slug)) {
			continue;
		}
		const title = collapseWhitespace(
			decodeEntities(CARD_TITLE_RE.exec(chunk)?.[1] ?? ""),
		);
		const author = collapseWhitespace(
			stripHtml(CARD_AUTHOR_RE.exec(chunk)?.[1] ?? ""),
		);
		entries.push({
			slug,
			title: title || slugToTitle(slug),
			author,
			cover: absolute(CARD_COVER_RE.exec(chunk)?.[1] ?? ""),
			duration: collapseWhitespace(
				decodeEntities(CARD_DURATION_RE.exec(chunk)?.[1] ?? ""),
			),
		});
	}
	return entries;
}

/** Total (1-based) pages of the A-Z listing from the pager links. */
export function parseTotalPages(html: string): number {
	let max = 1;
	for (const page of matchAll(html, PAGER_LINK_RE)) {
		const parsed = Number(page);
		if (Number.isInteger(parsed) && parsed > max) {
			max = parsed;
		}
	}
	return max;
}

/** Total hits of a search page ("Wir haben <span>53</span> Treffer für dich."), 0 if none. */
export function parseResultCount(html: string): number {
	const raw = RESULT_COUNT_RE.exec(html)?.[1];
	if (raw === undefined) {
		return 0;
	}
	const count = Number(raw.replace(/[.\s]/g, ""));
	return Number.isFinite(count) && count > 0 ? count : 0;
}

/** "winnetou-i-einleitung" -> "Winnetou-I-Einleitung" fallback title. */
export function slugToTitle(slug: string): string {
	return collapseWhitespace(decodeEntities(slug.replace(/-+/g, " "))).replace(
		/(^|\s)\S/g,
		(part: string) => part.toUpperCase(),
	);
}

// ---------------------------------------------------------------------------
// Book detail page
// ---------------------------------------------------------------------------

const BOOK_TITLE_RE = /<h1 class="title"><span>([\s\S]*?)<\/span><\/h1>/;
const BOOK_AUTHOR_BLOCK_RE = /<p class="author">([\s\S]*?)<\/p>/;
const AUTHOR_LINK_RE = /<a[^>]*>([\s\S]*?)<\/a>/g;
const SPEAKER_DD_RE = /<dd class="speaker">([\s\S]*?)<\/dd>/g;
const BOOK_DURATION_RE = /Spieldauer<\/dt>\s*<dd>([^<]+)<\/dd>/;
const BOOK_CATEGORIES_RE = /Kategorien<\/dt>\s*<dd>([^<]+)<\/dd>/;
const BOOK_DOWNLOAD_RE = /href="(\/hoerbuch\/download\/[^"]+)"/;

/** Parse a book detail page (`/hoerbuch/<slug>`). */
export function parseBookPage(html: string, slug: string): BookPage {
	return {
		slug,
		title:
			collapseWhitespace(decodeEntities(BOOK_TITLE_RE.exec(html)?.[1] ?? "")) ||
			slugToTitle(slug),
		authors: extractAuthors(html),
		speakers: extractSpeakers(html),
		description: extractDescription(html),
		cover: absolute(BOOK_COVER(html)),
		categories: extractCategories(html),
		duration: collapseWhitespace(
			decodeEntities(BOOK_DURATION_RE.exec(html)?.[1] ?? ""),
		),
		downloadHref: decodeEntities(BOOK_DOWNLOAD_RE.exec(html)?.[1] ?? ""),
	};
}

/** First lazy cover image on the page (the hero cover). */
function BOOK_COVER(html: string): string {
	return CARD_COVER_RE.exec(html)?.[1] ?? "";
}

function extractAuthors(html: string): string[] {
	const block = BOOK_AUTHOR_BLOCK_RE.exec(html)?.[1];
	if (block === undefined) {
		return [];
	}
	const authors = matchAll(block, AUTHOR_LINK_RE)
		.map((author) => collapseWhitespace(decodeEntities(author)))
		.filter((author) => author.length > 0);
	if (authors.length > 0) {
		return authors;
	}
	// Fallback: plain-text author (no <a> wrapper).
	const plain = collapseWhitespace(stripHtml(block));
	return plain.length > 0 ? [plain] : [];
}

function extractSpeakers(html: string): string[] {
	const speakers: string[] = [];
	// split with a capture group puts each dd body at odd indices.
	const parts = html.split(SPEAKER_DD_RE);
	for (let i = 1; i < parts.length; i += 2) {
		const body = parts[i] ?? "";
		const links = matchAll(body, AUTHOR_LINK_RE)
			.map((speaker) => collapseWhitespace(decodeEntities(speaker)))
			.filter((speaker) => speaker.length > 0);
		if (links.length > 0) {
			speakers.push(...links);
			continue;
		}
		const plain = collapseWhitespace(stripHtml(body));
		if (plain.length > 0) {
			speakers.push(plain);
		}
	}
	return speakers;
}

function extractCategories(html: string): string[] {
	const raw = BOOK_CATEGORIES_RE.exec(html)?.[1];
	if (raw === undefined) {
		return [];
	}
	return decodeEntities(raw)
		.split(",")
		.map((category) => collapseWhitespace(category))
		.filter((category) => category.length > 0);
}

function extractDescription(html: string): string {
	const start = html.indexOf('-description">');
	if (start === -1) {
		return "";
	}
	// Skip the section's <h2>Beschreibung</h2>, then take up to the container's
	// closing </div> (descriptions only contain inline tags and <p>).
	const h2End = html.indexOf("</h2>", start);
	const from = h2End === -1 ? start : h2End + "</h2>".length;
	const end = html.indexOf("</div>", from);
	const segment = end === -1 ? html.slice(from) : html.slice(from, end);
	return stripHtml(segment);
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** Parse runtime labels like "02h:42m", "14m:44s", "01m" into seconds. */
export function durationToSeconds(raw: string): number {
	const text = raw.trim();
	if (text.length === 0) {
		return 0;
	}
	let total = 0;
	const hours = /(\d+)\s*h/i.exec(text)?.[1];
	const minutes = /(\d+)\s*m/i.exec(text)?.[1];
	const seconds = /(\d+)\s*s(?!u)/i.exec(text)?.[1];
	if (hours !== undefined) {
		total += Number(hours) * 3600;
	}
	if (minutes !== undefined) {
		total += Number(minutes) * 60;
	}
	if (seconds !== undefined) {
		total += Number(seconds);
	}
	return total;
}

function formatSeconds(total: number): string {
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = Math.round(total % 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Normalize a site runtime label to h:mm:ss / m:ss ("02h:42m" -> "2:42:00"). */
export function normalizeDuration(raw: string): string {
	const total = durationToSeconds(raw);
	return total > 0 ? formatSeconds(total) : "";
}

/** Compact human runtime like "2h 42m" for the detail meta table. */
export function humanRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.round((totalSeconds % 3600) / 60);
	if (h <= 0) {
		return `${m}m`;
	}
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
