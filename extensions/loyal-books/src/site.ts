// ---------------------------------------------------------------------------
// Pure parsing / URL helpers for loyalbooks.com.
//
// This module intentionally has no imports from the host builtins (`network`,
// `parse`, ...) so it can be unit-tested directly with bun:test.
//
// The site serves machine-generated HTML 4.01 whose markup has been stable for
// years, so — like the LibriVox RSS handling — listings, the sitemap, book
// pages and podcast feeds are parsed with targeted regexes instead of the
// runtime HTML parser.
// ---------------------------------------------------------------------------

export const BASE = "https://www.loyalbooks.com";
export const SITEMAP_URL = `${BASE}/sitemap.xml`;

/** Special browse categories besides the genre pages. */
export const CATEGORY_POPULAR = "popular";
export const CATEGORY_ALL = "all";

export interface ListingEntry {
	slug: string;
	title: string;
	author: string;
	cover: string;
}

export interface Listing {
	entries: ListingEntry[];
	totalPages: number;
}

export interface CatalogItem {
	slug: string;
	title: string;
	author: string;
	cover: string;
}

export interface FeedChapter {
	title: string;
	url: string;
	duration: string;
}

export interface BookFeed {
	language: string;
	chapters: FeedChapter[];
}

export interface BookPage {
	title: string;
	author: string;
	cover: string;
	description: string;
	genres: string[];
	zipUrl: string;
	/** Canonical slug from <link rel="canonical">, empty when absent. */
	canonicalSlug: string;
	/** Chapters recovered from the jPlayer playlist (feed fallback). */
	chapters: FeedChapter[];
}

// ---------------------------------------------------------------------------
// Entities and text cleanup
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apost: "'",
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	micro: "µ",
	deg: "°",
	copy: "©",
	reg: "®",
	trade: "™",
	eacute: "é",
	egrave: "è",
	agrave: "à",
	ccedil: "ç",
	uuml: "ü",
	ouml: "ö",
	auml: "ä",
	szlig: "ß",
	laquo: "«",
	raquo: "»",
};

/**
 * Decode HTML entities in a single pass (named + decimal + hex) so already
 * encoded input like "&amp;lt;" degrades to "&lt;" instead of "<".
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
			return NAMED_ENTITIES[body.toLowerCase()] ?? match;
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

/** Collapse whitespace runs; titles in the markup are heavily indented. */
function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** The site links chapter files over http; upgrade to https. */
export function httpsUp(url: string): string {
	return url.startsWith("http://") ? `https://${url.slice(7)}` : url;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function bookUrl(slug: string): string {
	return `${BASE}/book/${slug}`;
}

export function feedUrl(slug: string): string {
	return `${BASE}/book/${slug}/feed`;
}

/**
 * Listing URL for a browse page, or null when the sitemap catalog should be
 * used instead ("All books" with English listings). `page` is 0-based; the
 * site's own pager starts at 1.
 */
export function listingUrl(
	language: string,
	category: string,
	page: number,
): string | null {
	// The site 302-redirects "?page=1" to the bare URL, so omit the param
	// on the first page.
	const pagePart = page > 0 ? `?page=${page + 1}` : "";
	if (language !== "English") {
		// Non-English books live under /language/<Name>; genre does not apply.
		return `${BASE}/language/${language}${pagePart}`;
	}
	if (category === CATEGORY_ALL) {
		return null;
	}
	if (category === CATEGORY_POPULAR) {
		return `${BASE}/Top_100${pagePart}`;
	}
	return `${BASE}/genre/${category}${pagePart}`;
}

export function makeEpisodeId(slug: string, index: number): string {
	return `${slug}#${index}`;
}

/** Episode ids are "<slug>#<index>"; slugs may contain "-", never "#". */
export function parseEpisodeId(
	uid: string,
): { slug: string; index: number } | null {
	const sep = uid.lastIndexOf("#");
	if (sep <= 0) {
		return null;
	}
	const slug = uid.slice(0, sep);
	const index = Number(uid.slice(sep + 1));
	if (slug.length === 0 || !Number.isInteger(index) || index < 0) {
		return null;
	}
	return { slug, index };
}

// ---------------------------------------------------------------------------
// Listing pages (genre / language / Top_100)
// ---------------------------------------------------------------------------

const CELL_RE = /<td class="layout2-blue"[^>]*>([\s\S]*?)<\/td>/g;
const CELL_HREF_RE = /href="\/book\/([^"]+)"/;
const CELL_TITLE_RE = /<b>([\s\S]*?)<\/b>/;
const CELL_AUTHOR_RE = /<\/b><\/a>\s*<br\s*\/?>([\s\S]*?)\s*<br[\s/>]/i;
const CELL_IMG_RE = /<img[^>]*class="layout"[^>]*src="([^"]+)"/;
const PAGES_RE = /Page\s+\d+\s+of\s+(\d+)/;

/** Parse a genre/language/Top_100 listing page into book entries. */
export function parseListing(html: string): Listing {
	const entries: ListingEntry[] = [];
	for (const cell of matchAll(html, CELL_RE)) {
		const slug = CELL_HREF_RE.exec(cell)?.[1];
		if (!slug) {
			continue;
		}
		const title = collapseWhitespace(
			decodeEntities(CELL_TITLE_RE.exec(cell)?.[1] ?? ""),
		);
		const cover = absolute(CELL_IMG_RE.exec(cell)?.[1] ?? "");
		const author = collapseWhitespace(
			decodeEntities(CELL_AUTHOR_RE.exec(cell)?.[1] ?? ""),
		);
		entries.push({
			slug: decodeEntities(slug),
			title: title || slugToTitle(slug),
			author,
			cover,
		});
	}
	const totalPages = Number(PAGES_RE.exec(html)?.[1] ?? 1);
	return { entries, totalPages };
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

/** Resolve a site-relative URL like /image/layout2/x.jpg against BASE. */
export function absolute(url: string): string {
	if (url.startsWith("//")) {
		return `https:${url}`;
	}
	if (url.startsWith("/")) {
		return `${BASE}${url}`;
	}
	return url;
}

// ---------------------------------------------------------------------------
// Sitemap (full catalog, powers search and the "All books" listing)
// ---------------------------------------------------------------------------

const LOC_RE = /<loc>([^<]+)<\/loc>/;
const BOOK_PATH_RE = /\/book\/([^<]+)$/;
const COVER_RE = /<image:loc>([^<]+)<\/image:loc>/;
const IMAGE_TITLE_RE = /<image:title>([\s\S]*?)<\/image:title>/;

/**
 * Parse sitemap.xml into a deduplicated book catalog. The `<image:title>`
 * blocks carry "Title By: Author" strings and `<image:loc>` the detail cover;
 * entries without them fall back to a prettified slug.
 */
export function parseCatalog(xml: string): CatalogItem[] {
	const items: CatalogItem[] = [];
	const seen = new Set<string>();
	for (const chunk of xml.split(/<url>/).slice(1)) {
		const loc = LOC_RE.exec(chunk)?.[1];
		if (!loc) {
			continue;
		}
		const slug = BOOK_PATH_RE.exec(loc.trim())?.[1];
		if (!slug) {
			continue;
		}
		const imageTitle = IMAGE_TITLE_RE.exec(chunk)?.[1];
		const parts = splitTitleAuthor(decodeEntities(imageTitle ?? ""));
		const title = parts.title || slugToTitle(slug);
		const author = parts.author;
		const key = `${title.toLowerCase()}|${author.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		items.push({
			slug,
			title,
			author,
			cover: httpsUp(absolute(COVER_RE.exec(chunk)?.[1] ?? "")),
		});
	}
	return items;
}

/** Split sitemap image titles like "Title By: Author Name". */
export function splitTitleAuthor(raw: string): {
	title: string;
	author: string;
} {
	const idx = raw.lastIndexOf(" By: ");
	if (idx <= 0) {
		return { title: collapseWhitespace(raw), author: "" };
	}
	return {
		title: collapseWhitespace(raw.slice(0, idx)),
		author: collapseWhitespace(raw.slice(idx + 5)),
	};
}

/** "the-return-of-sherlock-holmes" -> "The Return Of Sherlock Holmes". */
export function slugToTitle(slug: string): string {
	return collapseWhitespace(decodeEntities(slug.replace(/-+/g, " "))).replace(
		/(^|\s)\S/g,
		(part: string) => part.toUpperCase(),
	);
}

// ---------------------------------------------------------------------------
// Per-book podcast feed (chapter list with MP3 enclosures)
// ---------------------------------------------------------------------------

/** Strip CDATA wrappers, stray tags and entities from feed text. */
function feedText(raw: string): string {
	return collapseWhitespace(
		decodeEntities(
			raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, ""),
		),
	);
}

/**
 * Parse a per-book RSS feed: `<language>` plus one chapter per `<item>` with
 * an `<enclosure>` MP3 and an `<itunes:duration>`. Returns an empty feed for
 * non-RSS bodies (the site answers 404s with an HTML page).
 */
export function parseBookFeed(xml: string): BookFeed {
	if (!xml.includes("<rss")) {
		return { language: "", chapters: [] };
	}
	const language = collapseWhitespace(
		/<language>([^<]+)<\/language>/.exec(xml)?.[1] ?? "",
	);
	const chapters: FeedChapter[] = [];
	for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
		const url = /<enclosure[^>]*url="([^"]+)"/.exec(chunk)?.[1];
		if (!url) {
			continue;
		}
		const title = /<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1] ?? "";
		const duration =
			/<itunes:duration>([\s\S]*?)<\/itunes:duration>/.exec(chunk)?.[1] ?? "";
		chapters.push({
			title: feedText(title),
			url: httpsUp(url.trim()),
			duration: feedText(duration),
		});
	}
	return { language, chapters };
}

// ---------------------------------------------------------------------------
// Book detail page
// ---------------------------------------------------------------------------

const CANONICAL_RE = /<link rel="canonical" href="[^"]*\/book\/([^"]+)"/;
const NAME_RE = /<span itemprop="name">([\s\S]*?)<\/span>/;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/;
const AUTHOR_RE = /itemprop="author"[^>]*>([\s\S]*?)<\/a>/;
const COVER_IMG_RE = /<img[^>]*itemprop="image"[^>]*src="([^"]+)"/;
const OG_IMAGE_RE = /<meta property="og:image" content="([^"]+)"/;
const META_DESC_RE = /<meta name="description" content="([^"]*)"/;
const GENRE_LINK_RE = /<a href="\/genre\/[^"]*">([\s\S]*?)<\/a>/g;
const ZIP_RE = /href="(https?:\/\/[^"]+\.zip)"/;
const PLAYLIST_RE =
	/\{name:\s*"((?:[^"\\]|\\.)*)",\s*free:\s*true,\s*mp3:\s*"([^"]+)"/g;

/** Parse a book detail page (schema.org microdata + jPlayer playlist). */
export function parseBookPage(html: string): BookPage {
	return {
		title: pageTitle(html),
		author: collapseWhitespace(decodeEntities(AUTHOR_RE.exec(html)?.[1] ?? "")),
		cover: absolute(
			(
				COVER_IMG_RE.exec(html)?.[1] ??
				OG_IMAGE_RE.exec(html)?.[1] ??
				""
			).trim(),
		),
		description: pageDescription(html),
		genres: pageGenres(html),
		zipUrl: httpsUp(ZIP_RE.exec(html)?.[1] ?? ""),
		canonicalSlug: decodeEntities(CANONICAL_RE.exec(html)?.[1] ?? ""),
		chapters: parsePlaylist(html),
	};
}

function pageTitle(html: string): string {
	const name = collapseWhitespace(
		decodeEntities(NAME_RE.exec(html)?.[1] ?? ""),
	);
	if (name.length > 0) {
		return name;
	}
	// Fallback: "<h1><span itemprop=name>Title</span></h1>" minus the suffix.
	const h1 = collapseWhitespace(decodeEntities(H1_RE.exec(html)?.[1] ?? ""));
	return h1.replace(/\s*-\s*Free at Loyal Books$/i, "").trim();
}

function pageDescription(html: string): string {
	const start = html.indexOf('<span itemprop="description">');
	if (start !== -1) {
		const from = html.indexOf(">", start) + 1;
		const end = html.indexOf("</span>", from);
		let segment = end === -1 ? html.slice(from) : html.slice(from, end);
		// The description is wrapped in <font class="book-description">;
		// cut at the last closing font tag in case fonts are nested.
		const lastFont = segment.toLowerCase().lastIndexOf("</font>");
		if (lastFont !== -1) {
			segment = segment.slice(0, lastFont);
		}
		const text = stripHtml(segment);
		if (text.length > 0) {
			return text;
		}
	}
	// Fallback: the short meta description.
	return collapseWhitespace(decodeEntities(META_DESC_RE.exec(html)?.[1] ?? ""));
}

function pageGenres(html: string): string[] {
	const tableStart = html.indexOf('summary="Genres for this book"');
	if (tableStart === -1) {
		return [];
	}
	const tableEnd = html.indexOf("</table>", tableStart);
	const section =
		tableEnd === -1 ? html.slice(tableStart) : html.slice(tableStart, tableEnd);
	const genres: string[] = [];
	for (const label of matchAll(section, GENRE_LINK_RE)) {
		const genre = collapseWhitespace(decodeEntities(label));
		if (genre.length > 0 && !genres.includes(genre)) {
			genres.push(genre);
		}
	}
	return genres;
}

/**
 * Chapters embedded in the book page's jPlayer playlist, used when the
 * podcast feed is unavailable:
 * `{name:"01 – Chapter", free:true, mp3:"http://.../file.mp3"}`
 */
export function parsePlaylist(html: string): FeedChapter[] {
	const chapters: FeedChapter[] = [];
	for (const [name, url] of matchAll2(html, PLAYLIST_RE)) {
		if (url.length === 0) {
			continue;
		}
		chapters.push({
			title: collapseWhitespace(decodeEntities(name.replace(/\\(.)/g, "$1"))),
			url: httpsUp(url.trim()),
			duration: "",
		});
	}
	return chapters;
}

/** Like matchAll but collects capture groups 1 and 2. */
function matchAll2(text: string, re: RegExp): [string, string][] {
	const out: [string, string][] = [];
	re.lastIndex = 0;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		out.push([m[1] ?? "", m[2] ?? ""]);
	}
	re.lastIndex = 0;
	return out;
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const LANG_RE = /^[a-z]{2,3}$/;

/** "en-us" -> "en", "de" -> "de", unknown -> "". */
export function languageCode(tag: string): string {
	const code = tag.trim().toLowerCase().split("-")[0] ?? "";
	return LANG_RE.test(code) ? code : "";
}

/** Normalize itunes:duration ("00:08:26", "8:26", "506") to h:mm:ss / m:ss. */
export function normalizeDuration(raw: string): string {
	const value = raw.trim();
	if (/^\d+$/.test(value)) {
		return formatSeconds(Number(value));
	}
	const total = durationToSeconds(value);
	return total > 0 ? formatSeconds(total) : "";
}

function formatSeconds(total: number): string {
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = Math.round(total % 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parse "mm:ss" / "h:mm:ss" into seconds, or 0 when unparsable. */
export function durationToSeconds(raw: string): number {
	const value = raw.trim();
	if (value.length === 0) {
		return 0;
	}
	if (/^\d+$/.test(value)) {
		return Number(value);
	}
	const total = value
		.split(":")
		.reverse()
		.reduce(
			(acc: number, part: string, i: number) => acc + Number(part) * 60 ** i,
			0,
		);
	return Number.isFinite(total) ? total : 0;
}

/** Compact human runtime like "11h 7m" for the detail meta table. */
export function humanRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.round((totalSeconds % 3600) / 60);
	if (h <= 0) {
		return `${m}m`;
	}
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
