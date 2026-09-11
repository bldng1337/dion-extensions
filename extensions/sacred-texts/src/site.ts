// Pure helpers for scraping the Internet Sacred Text Archive
// (https://sacred-texts.com). Kept free of the built-in `network`/`parse`
// modules so they can be unit-tested directly with inline fixtures.
//
// Verified site structure (the 2026 SvelteKit relaunch; the old static site is
// gone, legacy paths like /hin/sok/index.htm now serve the new template):
// - Topic listings: /categories/<slug> (e.g. /categories/icelandic) — some
//   slugs 301 to the canonical legacy tree (…/neu/ice/index.htm); both render
//   the same template with <li class="book book--book"> cards (title, author,
//   note, year) grouped under <h2> sections. No pagination.
// - Book overview: legacy paths (/hin/sok/index.htm) are canonical; the
//   /book/<slug> form 301s to them. Carries <h1 id="book-title">,
//   bo-author-name, bo-description, og:image and the paginated chapter table
//   ("bo-toc-row" anchors, "Chapter page N of M" via ?chaptersPage=N).
// - Chapter reader: /book/<slug>/read/<chapter> (307s browsers to
//   /book/<slug>/shell/<chapter>; both serve the same server-rendered HTML).
//   The text lives in the balanced <div data-slot="reader-prose"> block:
//   <h1>-<h3> headings, <p> paragraphs with inline <i>/<b>, verse <br> line
//   breaks, page-number anchors (<a>p. 12</a>) and "[paragraph continues]"
//   markers.
// - Search: the site's own search is a client-side app backed by an
//   authenticated API (401) — not usable. /sitemaps/books.xml lists ~3000
//   book URLs (either /book/<slug> or a legacy …/index.htm path) and doubles
//   as a title index.
//
// The texts are public domain in the US; the site's terms allow redistribution
// with attribution. Every detail view therefore links back to the source book.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://sacred-texts.com";
/** Browse/search result pages are sliced to this many entries. */
export const PAGE_SIZE = 24;

/** Browser-like UA: the site 404s/blank-challenges unusual clients on some
 * routes and 307s `read/` URLs to the `shell/` reader for browsers. */
export const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const TOPIC_SETTING_ID = "sacred_texts_topic";

/** Browse targets: verified top-level topic categories. Each value is a
 * /categories/<slug> path; slugs the site redirects to its legacy tree are
 * followed automatically (the runtime fetch follows redirects). */
export const TOPICS: { value: string; label: string }[] = [
	{ value: "comparative", label: "Comparative Religion" },
	{ value: "classics", label: "The Classics" },
	{ value: "ancient-near-east", label: "Ancient Near East" },
	{ value: "egyptian", label: "Ancient Egypt" },
	{ value: "hinduism", label: "Hinduism" },
	{ value: "buddhism", label: "Buddhism" },
	{ value: "islam", label: "Islam" },
	{ value: "judaism", label: "Judaism" },
	{ value: "christianity", label: "Christianity" },
	{ value: "bible", label: "The Bible" },
	{ value: "legends-sagas", label: "Legends & Sagas" },
	{ value: "icelandic", label: "Icelandic Lore (Eddas & Sagas)" },
	{ value: "celtic", label: "Celtic" },
	{ value: "native-american", label: "Native American" },
	{ value: "esoteric-occult", label: "Esoteric & Occult" },
	{ value: "alchemy", label: "Alchemy" },
];

/** Shown in every detail view: attribution + backlink required by the site. */
export const ATTRIBUTION =
	"Texts courtesy of the Internet Sacred Text Archive (public domain, non-commercial use with attribution). Please visit sacred-texts.com to support the archive.";

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
	shy: "­",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	sbquo: "‚",
	bdquo: "„",
	laquo: "«",
	raquo: "»",
	sect: "§",
	para: "¶",
	dagger: "†",
	deg: "°",
	middot: "·",
	bull: "•",
	// Accented characters common in the archive's older translations.
	aacute: "á",
	agrave: "à",
	acirc: "â",
	aring: "å",
	atilde: "ã",
	ccedil: "ç",
	eacute: "é",
	egrave: "è",
	ecirc: "ê",
	euml: "ë",
	iacute: "í",
	igrave: "ì",
	icirc: "î",
	iuml: "ï",
	ntilde: "ñ",
	oacute: "ó",
	ograve: "ò",
	ocirc: "ô",
	oslash: "ø",
	otilde: "õ",
	ouml: "ö",
	uacute: "ú",
	ugrave: "ù",
	ucirc: "û",
	uuml: "ü",
	yuml: "ÿ",
	szlig: "ß",
	auml: "ä",
	Auml: "Ä",
	Ouml: "Ö",
	Uuml: "Ü",
	aelig: "æ",
	thorn: "þ",
	eth: "ð",
};

function codepointToString(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
		return "";
	}
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

/** Decodes named and numeric HTML entities; unknown names stay as-is. */
export function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			codepointToString(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			codepointToString(Number.parseInt(dec, 10)),
		)
		.replace(
			/&([a-zA-Z][a-zA-Z0-9]*);/g,
			(match, name: string) => NAMED_ENTITIES[name] ?? match,
		);
}

/** Flattens a snippet of HTML to plain text, keeping paragraph breaks. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/\u00ad/g, "")
		.replace(/\u00a0/g, " ")
		.split("\n")
		.map((line) => line.replace(/[\t ]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Single-line text for titles/author fields. */
export function inlineText(html: string): string {
	return htmlToText(html)
		.replace(/\s*\n+\s*/g, " ")
		.trim();
}

/** Normalises one line of reading text. */
function cleanLine(text: string): string {
	return text
		.replace(/\u00ad/g, "")
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\u202a-\u202e\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Book references use the site path (no host) as uid: either the new
 * "book/<slug>" form or a legacy "hin/sok/index.htm" path. */
export function uidFromHref(href: string): string | null {
	const trimmed = href
		.trim()
		.replace(/^https?:\/\/(?:www\.)?sacred-texts\.com/i, "")
		.replace(/^(\.\.\/)+/, "")
		.replace(/^\/+/, "");
	const book = /^book\/([a-z0-9-]+)$/.exec(trimmed);
	if (book) {
		return `book/${book[1]}`;
	}
	const legacy = /^([a-z0-9][a-z0-9/-]*\/index\.htm)$/i.exec(trimmed);
	if (legacy) {
		return (legacy[1] ?? "").toLowerCase();
	}
	return null;
}

export function bookUrl(uid: string): string {
	return `${BASE}/${uid.replace(/^\/+/, "")}`;
}

/** Best-effort display title for a uid (used by sitemap search hits;
 * detail() replaces it with the real title from the book page). */
export function titleFromUid(uid: string): string {
	let raw = uid;
	const book = /^book\/([a-z0-9-]+)$/.exec(uid);
	if (book) {
		raw = book[1] ?? uid;
	} else if (/\/index\.htm$/i.test(uid)) {
		const parts = uid.split("/");
		raw = parts[parts.length - 2] ?? uid;
	}
	return raw
		.split("-")
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** The listing page of one browse topic. */
export function topicUrl(topic: string): string {
	return `${BASE}/categories/${topic}`;
}

/** Episode uids are "<bookUid>#<chapterSlug>". */
export function chapterUid(bookUid: string, slug: string): string {
	return `${bookUid}#${slug}`;
}

export function parseChapterUid(
	uid: string,
): { bookUid: string; slug: string } | null {
	const hash = uid.lastIndexOf("#");
	if (hash <= 0 || hash >= uid.length - 1) {
		return null;
	}
	return { bookUid: uid.slice(0, hash), slug: uid.slice(hash + 1) };
}

/** Extracts the chapter slug from a reader href, e.g.
 * "/book/the-poetic-edda/read/voluspo" -> "voluspo". */
export function chapterSlugFromHref(href: string): string | null {
	const match = /\/read\/([a-z0-9-]+)/i.exec(href);
	return match?.[1] ?? null;
}

/** Reader hrefs served to browsers 307 to the "shell" variant; fetch the
 * shell route directly to save a round trip. */
export function toShellUrl(href: string): string {
	const path = href
		.trim()
		.replace(/^https?:\/\/(?:www\.)?sacred-texts\.com/i, "")
		.replace(/^\/+/, "");
	return `${BASE}/${path.replace(/\/read\//, "/shell/")}`;
}

// ---------------------------------------------------------------------------
// Matching (client-side search)
// ---------------------------------------------------------------------------

/** True when every query token occurs in the (already lowercased) haystack. */
export function matchesQuery(haystack: string, tokens: string[]): boolean {
	return tokens.every((token) => haystack.includes(token));
}

/** Splits a raw search query into lowercase tokens. */
export function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------
// Topic listing pages (browse + search corpus)
// ---------------------------------------------------------------------------

export interface BookCard {
	uid: string;
	title: string;
	author: string | null;
	note: string | null;
	year: string | null;
}

/** Parses a topic listing page into its book cards. Cards are
 * `<li class="book book--book">` elements; category/external/subitem rows are
 * skipped. The SvelteKit template renders every card three times (multiple
 * hydration passes), so duplicates are dropped. */
export function parseBookCards(body: string): BookCard[] {
	const cards: BookCard[] = [];
	const seen = new Set<string>();
	for (const chunk of body.split('<li class="book book--book').slice(1)) {
		const end = chunk.indexOf("</li>");
		const scope = end >= 0 ? chunk.slice(0, end) : chunk;
		// The title anchor carries its class first, then more attributes
		// (href, ...), so match the whole tag before pulling out the href.
		const anchor = scope.match(/<a\b[^>]*class="book-title[^>]*>/)?.[0];
		const href = anchor?.match(/href="([^"]+)"/)?.[1];
		const uid = href ? uidFromHref(href) : null;
		if (!uid || seen.has(uid)) {
			continue;
		}
		seen.add(uid);
		const titleStart = anchor ? scope.indexOf(anchor) + anchor.length : -1;
		const titleEnd = titleStart >= 0 ? scope.indexOf("</a>", titleStart) : -1;
		const titleHtml =
			titleStart >= 0 && titleEnd >= 0 ? scope.slice(titleStart, titleEnd) : "";
		cards.push({
			uid,
			title: inlineText(titleHtml) || titleFromUid(uid),
			author:
				inlineText(
					scope.match(/class="book-author[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "",
				) || null,
			note:
				inlineText(
					scope.match(/class="book-note[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "",
				) || null,
			year:
				inlineText(
					scope.match(/class="book-year[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "",
				) || null,
		});
	}
	return cards;
}

// ---------------------------------------------------------------------------
// Book overview pages (detail)
// ---------------------------------------------------------------------------

export interface ChapterRef {
	slug: string;
	name: string;
	/** Absolute URL of the (shell) reader page. */
	url: string;
}

export interface BookOverview {
	uid: string;
	title: string;
	author: string | null;
	description: string;
	cover: string | null;
	chapters: ChapterRef[];
	/** Total number of paginated TOC pages ("Chapter page N of M"). */
	chapterPages: number;
}

/** Parses a book overview page: title, author, description, cover and the
 * first page of its chapter table. */
export function parseOverview(body: string, uid: string): BookOverview {
	const title = decodeEntities(
		(body.match(/<h1 id="book-title">\s*([^<]*?)\s*</)?.[1] ?? "").trim(),
	);
	const authorRaw = decodeEntities(
		(body.match(/class="bo-author-name">\s*([^<]*?)\s*</)?.[1] ?? "").trim(),
	);
	const description = htmlToText(
		body.match(/class="bo-description">([\s\S]*?)<\/div>/)?.[1] ?? "",
	);
	const cover = body.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
	const chapterPages = Number.parseInt(
		body.match(/aria-label="Chapter page \d+ of (\d+)"/)?.[1] ?? "1",
		10,
	);

	return {
		uid,
		title: title || titleFromUid(uid),
		author:
			authorRaw.length > 0 && !/unknown author/i.test(authorRaw)
				? authorRaw
				: null,
		description,
		cover: cover ? decodeEntities(cover) : null,
		chapters: parseTocRows(body),
		chapterPages: Number.isFinite(chapterPages) ? Math.max(1, chapterPages) : 1,
	};
}

/** Parses "bo-toc-row" anchors of a book overview (one TOC page worth).
 * Rows are rendered three times by the template; duplicates by slug are
 * dropped, document order kept. */
export function parseTocRows(body: string): ChapterRef[] {
	const chapters: ChapterRef[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(
		/<a class="bo-toc-row"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
	)) {
		const href = match[1] ?? "";
		const slug = chapterSlugFromHref(href);
		if (!slug || seen.has(slug)) {
			continue;
		}
		seen.add(slug);
		const scope = match[2] ?? "";
		const name = inlineText(
			scope.match(/class="bo-toc-title">([\s\S]*?)<\/span>/)?.[1] ?? "",
		);
		chapters.push({
			slug,
			name: name || titleFromUid(`book/${slug}`),
			url: toShellUrl(href),
		});
	}
	return chapters;
}

/** Builds the overview URL for one paginated TOC page (1-based). */
export function overviewPageUrl(uid: string, chapterPage: number): string {
	const base = bookUrl(uid);
	return chapterPage <= 1 ? base : `${base}?chaptersPage=${chapterPage}`;
}

// ---------------------------------------------------------------------------
// Chapter reader pages (source)
// ---------------------------------------------------------------------------

/**
 * Extracts the inner HTML of the balanced `<div data-slot="reader-prose">`
 * block that carries the chapter text. Returns "" when absent (SPA shells of
 * error pages, aggregate listings, etc.).
 */
export function extractProse(html: string): string {
	const marker = html.indexOf('data-slot="reader-prose"');
	if (marker < 0) {
		return "";
	}
	const openStart = html.lastIndexOf("<div", marker);
	if (openStart < 0) {
		return "";
	}
	const openEnd = html.indexOf(">", openStart);
	if (openEnd < 0) {
		return "";
	}
	const tagPattern = /<div\b|<\/div>/g;
	tagPattern.lastIndex = openEnd + 1;
	let depth = 1;
	let match: RegExpExecArray | null;
	while ((match = tagPattern.exec(html)) !== null) {
		if (match[0] === "<div") {
			depth++;
		} else {
			depth--;
			if (depth === 0) {
				return html.slice(openEnd + 1, match.index);
			}
		}
	}
	// Unbalanced fallback: everything up to the end of the document.
	return html.slice(openEnd + 1);
}

/** Page-number anchors like `<a>p. 12</a>` (also roman numerals). */
const PAGE_NUMBER_ANCHOR =
	/^<a\b[^>]*>\s*p{1,2}\.\s*[0-9]+[0-9a-z]*\s*<\/a>\s*$/i;
/** Fully-cleaned paragraph shapes that are reading-flow markers. */
const PAGE_NUMBER_TEXT = /^p{1,2}\.\s*[0-9]+[0-9a-z]*\.?$/i;
const CONTINUES_MARKER = /^\[\s*paragraph continues\s*\]$/i;

/** Rewrites headings and divider containers into paragraphs so the
 * `</p>`-splitting scanner below picks them up. */
function normalizeBlocks(html: string): string {
	return html
		.replace(/<div\b[^>]*>/gi, "<p>")
		.replace(/<\/div>/gi, "</p>")
		.replace(
			/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
			'<p class="stx-heading">$2</p>',
		);
}

export interface ChapterParagraph {
	content: string;
	style: "bold" | "italic" | null;
}

/** Flattens one `<p>` body to reading text; verse `<br>` breaks become
 * newlines. */
export function paragraphText(chunk: string): string {
	const lines = chunk
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((line) => cleanLine(decodeEntities(line)))
		.filter((line) => line.length > 0);
	return lines.join("\n");
}

/** True when the chunk's visible text is entirely wrapped in <i> elements. */
function isFullyItalic(chunk: string): boolean {
	if (!/<i[\s>]/i.test(chunk)) {
		return false;
	}
	const outside = chunk
		.replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, " ")
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<[^>]+>/g, "");
	return cleanLine(decodeEntities(outside)).length === 0;
}

/** Classifies and cleans the paragraphs of a reader-prose block:
 * h1-h6 headings become bold paragraphs, page-number anchors and
 * "[paragraph continues]" markers are dropped, fully-italic paragraphs keep
 * their style, verse line breaks are preserved. */
export function chapterParagraphs(proseHtml: string): ChapterParagraph[] {
	const out: ChapterParagraph[] = [];
	for (const chunk of normalizeBlocks(proseHtml).split(/<\/p>/i)) {
		const open = chunk.lastIndexOf("<p");
		if (open < 0) {
			continue;
		}
		const openEnd = chunk.indexOf(">", open);
		if (openEnd < 0) {
			continue;
		}
		const openTag = chunk.slice(open, openEnd + 1);
		const body = chunk.slice(openEnd + 1);
		if (PAGE_NUMBER_ANCHOR.test(body.trim())) {
			continue;
		}
		const text = paragraphText(body);
		if (text.length === 0 || CONTINUES_MARKER.test(text)) {
			continue;
		}
		// Page-number anchors with attributes (class etc.) survive the anchor
		// regex above; catch them by their cleaned text.
		if (!text.includes("\n") && PAGE_NUMBER_TEXT.test(text)) {
			continue;
		}
		if (/class="[^"]*\bstx-heading/.test(openTag)) {
			out.push({ content: text, style: "bold" });
			continue;
		}
		out.push({ content: text, style: isFullyItalic(body) ? "italic" : null });
	}
	return out;
}

/** Full chapter-page pipeline: prose extraction + paragraph conversion. */
export function parseChapter(body: string): ChapterParagraph[] {
	return chapterParagraphs(extractProse(body));
}

/**
 * Extracts the chapter HTML from a SvelteKit `__data.json` payload. The
 * payload is devalue-encoded (each route node's `data` is a flat array whose
 * elements reference each other by index); the chapter HTML is carried as the
 * longest string containing markup (the `contentHtml` value). This endpoint
 * is the reliable fetch from the runtime's HTTP client — the cached HTML
 * shell of the same page is served with a content encoding it cannot read.
 * Returns null when the payload carries no chapter content.
 */
export function chapterHtmlFromDataPayload(body: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	let best: string | null = null;
	const nodes = (parsed as { nodes?: { data?: unknown }[] })?.nodes;
	if (!Array.isArray(nodes)) {
		return null;
	}
	// SvelteKit payloads carry one devalue array per route node (layout +
	// page); the chapter content lives in the page node's array.
	for (const node of nodes) {
		const data = node?.data;
		if (!Array.isArray(data)) {
			continue;
		}
		for (const entry of data) {
			if (typeof entry !== "string") {
				continue;
			}
			// devalue escapes markup-significant characters as literal
			// \u003C sequences that survive JSON.parse; decode them back.
			const decoded = entry.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
				codepointToString(Number.parseInt(hex, 16)),
			);
			if (
				decoded.includes("<p") &&
				(best === null || decoded.length > best.length)
			) {
				best = decoded;
			}
		}
	}
	return best;
}

/** Chapter pipeline for a `__data.json` payload. */
export function parseChapterData(payload: string): ChapterParagraph[] {
	const html = chapterHtmlFromDataPayload(payload);
	return html ? chapterParagraphs(html) : [];
}

// ---------------------------------------------------------------------------
// Books sitemap (search corpus extension)
// ---------------------------------------------------------------------------

export interface BookRef {
	uid: string;
	title: string;
}

/** Extracts every book URL from /sitemaps/books.xml. Locations are either
 * "/book/<slug>" or a legacy "…/index.htm" path; both become uids. */
export function parseBooksSitemap(xml: string): BookRef[] {
	const refs: BookRef[] = [];
	const seen = new Set<string>();
	for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
		const uid = uidFromHref(match[1] ?? "");
		if (!uid || seen.has(uid)) {
			continue;
		}
		seen.add(uid);
		refs.push({ uid, title: titleFromUid(uid) });
	}
	return refs;
}
