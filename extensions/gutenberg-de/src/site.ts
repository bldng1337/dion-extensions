// Pure helpers for scraping Projekt Gutenberg-DE (https://projekt-gutenberg.org).
// Kept free of the built-in `network`/`parse` modules so they can be
// unit-tested directly with inline fixtures.
//
// Verified site structure (the 2026 WordPress relaunch):
// - Browse "new":   /bibliothek/neu-in-der-bibliothek/        (single page, ~50 items)
// - Browse A-Z:     /bibliothek/?gl_letter=A&gl_page=N        (100 items/page,
//                    per-letter totals in "<strong>855</strong> Bücher",
//                    pager status "Seite N von M"; letter "#" holds numeric titles)
// - Search:         /suche/?gutenberg_search=1&q=<q>&gl_scope[]=authors&gl_scope[]=titles
//                    (single result page; book hits link /authors/<a>/books/<b>)
// - Book page:      /authors/<author>/books/<book>            (title, author,
//                    description "Verlag: … | Jahr: …", chapter <option> list)
// - Chapter page:   /authors/<author>/books/<book>/chapter/<n> (text inside the
//                    first .book-reader__chapter-content-wrapper; duplicated a
//                    second time inside the hidden reading-mode block)
//
// The site's terms allow private-use consumption only; this extension fetches
// per-user on demand and never bundles or re-serves content.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://projekt-gutenberg.org";
/** The site's title-catalog listing pages render 100 items each. */
export const PAGE_SIZE = 100;
/** Letters of the "Buchtitel A–Z" catalog, in listing order. */
export const LETTERS = [
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
	"M",
	"N",
	"O",
	"P",
	"Q",
	"R",
	"S",
	"T",
	"U",
	"V",
	"W",
	"X",
	"Y",
	"Z",
	"#",
];

export const USER_AGENT =
	"Dion-GutenbergDE-Extension/1.0 (Dion media app; https://projekt-gutenberg.org)";

/** Shown in every detail view: the site allows private use only. */
export const PRIVATE_USE_NOTE =
	" Nur für den privaten Gebrauch — die Texte sind gemeinfrei, die Nutzungsbedingungen von Projekt Gutenberg-DE bleiben trotzdem zu beachten.";

export const NEW_URL = `${BASE}/bibliothek/neu-in-der-bibliothek/`;

// ---------------------------------------------------------------------------
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Encodes a query string from key/value pairs (no URL global in the VM). */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

/** The paginated "Buchtitel A–Z" catalog page for a letter (1-based pages). */
export function bibliothekUrl(letter: string, page: number): string {
	return `${BASE}/bibliothek/?${encodeQuery([
		["gl_letter", letter],
		["gl_page", String(Math.max(1, page))],
	])}`;
}

/** The GET search URL; scopes mirror the site form's defaults. */
export function searchUrl(query: string): string {
	return `${BASE}/suche/?${encodeQuery([
		["gutenberg_search", "1"],
		["q", query],
		["gl_scope[]", "authors"],
		["gl_scope[]", "titles"],
	])}`;
}

/** Book pages live at /authors/<author>/books/<book>; the uid is
 * "<author>/<book>". Returns null for non-book links (author hits, nav). */
const BOOK_HREF_PATTERN =
	/^(?:https?:\/\/(?:www\.)?projekt-gutenberg\.org)?\/authors\/([a-z0-9-]+)\/books\/([a-z0-9-]+)/;

export function bookUidFromHref(href: string): string | null {
	const match = BOOK_HREF_PATTERN.exec(href.trim().toLowerCase());
	return match ? `${match[1]}/${match[2]}` : null;
}

export function parseBookUid(
	uid: string,
): { author: string; book: string } | null {
	const parts = uid.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return null;
	}
	return { author: parts[0], book: parts[1] };
}

/** Book pages live under /authors/<author>/books/<book>/ (trailing slash —
 * the slash-less variants only answer with 301s). */
export function bookUrl(uid: string): string {
	const parsed = parseBookUid(uid);
	if (!parsed) {
		return `${BASE}/authors/${uid}/`;
	}
	return `${BASE}/authors/${parsed.author}/books/${parsed.book}/`;
}

export function chapterUrl(uid: string, chapter: number): string {
	const parsed = parseBookUid(uid);
	if (!parsed) {
		return `${BASE}/authors/${uid}/chapter/${chapter}/`;
	}
	return `${BASE}/authors/${parsed.author}/books/${parsed.book}/chapter/${chapter}/`;
}

/** Episode uids are "<bookUid>#<chapter number>". */
export function episodeUid(bookUid: string, chapter: number): string {
	return `${bookUid}#${chapter}`;
}

export function parseEpisodeUid(
	uid: string,
): { bookUid: string; chapter: number } | null {
	const hash = uid.lastIndexOf("#");
	if (hash <= 0) {
		return null;
	}
	const chapter = Number.parseInt(uid.slice(hash + 1), 10);
	if (!Number.isFinite(chapter) || chapter <= 0) {
		return null;
	}
	const bookUid = uid.slice(0, hash);
	return parseBookUid(bookUid) ? { bookUid, chapter } : null;
}

/** Best-effort display title derived from a book uid slug (used when a
 * listing item has no title span; detail() replaces it with the real one). */
export function titleFromSlug(uid: string): string {
	const book = parseBookUid(uid)?.book ?? uid;
	return book
		.split("-")
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Named entities common on the site (German-heavy), case-sensitive. */
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
	bdquo: "„",
	sbquo: "‚",
	laquo: "«",
	raquo: "»",
	sect: "§",
	deg: "°",
	euro: "€",
	szlig: "ß",
	auml: "ä",
	ouml: "ö",
	uuml: "ü",
	Auml: "Ä",
	Ouml: "Ö",
	Uuml: "Ü",
	aacute: "á",
	agrave: "à",
	ecirc: "ê",
	eacute: "é",
	egrave: "è",
	ccedil: "ç",
	icirc: "î",
	ocirc: "ô",
	ugrave: "ù",
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

/** Decodes named (incl. German umlauts) and numeric HTML entities. */
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

/** Flattens a snippet of HTML to single-line plain text. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<br\s*\/?>/gi, " ")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Normalises whitespace inside one line of reading text. */
function cleanLine(text: string): string {
	return text
		.replace(/\u00ad/g, "")
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// Listing pages (browse catalog, new additions, search results)
// ---------------------------------------------------------------------------

export interface IndexItem {
	/** Book uid ("<author>/<book>") when the link points at a book page. */
	uid: string | null;
	href: string;
	title: string;
	/** Author line of listing items, when present. */
	author: string;
}

/** Parses `book-app__index-item` lists shared by the catalog, the "new
 * additions" page and the search results. Non-book links (author hits,
 * navigation) keep their href with uid=null so callers can filter. */
export function parseIndexItems(body: string): IndexItem[] {
	const items: IndexItem[] = [];
	for (const chunk of body.split('<li class="book-app__index-item').slice(1)) {
		const end = chunk.indexOf("</li>");
		const scope = end >= 0 ? chunk.slice(0, end) : chunk;
		const aTag = scope.match(/<a\b[^>]*>/)?.[0] ?? "";
		const href = aTag.match(/href="([^"]+)"/)?.[1];
		if (!href) {
			continue;
		}
		const title = decodeEntities(
			(
				scope.match(/class="book-app__index-title">\s*([^<]*?)\s*</)?.[1] ?? ""
			).trim(),
		);
		const author = decodeEntities(
			(
				scope.match(
					/class="book-app__index-meta book-app__index-meta--author">\s*([^<]*?)\s*</,
				)?.[1] ?? ""
			).trim(),
		);
		items.push({
			uid: bookUidFromHref(href),
			href,
			title,
			author,
		});
	}
	return items;
}

export interface CatalogPageInfo {
	items: IndexItem[];
	/** "<strong>855</strong> Bücher" total of the whole letter. */
	total: number;
	/** "Seite N von M" pager status; absent on single-page letters. */
	page: number;
	pages: number;
}

/** Parses a /bibliothek/ listing page including its pagination metadata. */
export function parseCatalogPage(body: string): CatalogPageInfo {
	const total = Number.parseInt(
		body.match(
			/class="book-app__pagination-info">\s*<strong>(\d+)<\/strong>\s*B/,
		)?.[1] ?? "",
		10,
	);
	const status = body.match(
		/class="book-app__pagination-status">\s*Seite (\d+) von (\d+)\s*</,
	);
	return {
		items: parseIndexItems(body),
		total: Number.isFinite(total) ? total : 0,
		page: status ? Number.parseInt(status[1] ?? "1", 10) : 1,
		pages: status ? Number.parseInt(status[2] ?? "1", 10) : 1,
	};
}

/**
 * Maps a flat 0-based page number onto the A–Z catalog: letters are walked in
 * order, each spanning `counts[i]` listing pages (a letter with no books
 * spans 0 pages). Returns null once every letter is exhausted.
 */
export function locateCatalogPage(
	flatPage: number,
	counts: number[],
): { letter: string; pageNumber: number; hasNext: boolean } | null {
	let rest = Math.max(0, flatPage);
	for (let i = 0; i < LETTERS.length; i++) {
		const pages = counts[i] ?? 0;
		if (rest < pages) {
			return {
				letter: LETTERS[i] ?? "#",
				pageNumber: rest + 1,
				hasNext: rest + 1 < pages || i < LETTERS.length - 1,
			};
		}
		rest -= pages;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Book pages
// ---------------------------------------------------------------------------

export interface ChapterRef {
	n: number;
	name: string;
	url: string;
}

export interface BookInfo {
	uid: string;
	title: string;
	author: string | null;
	description: string;
	chapters: ChapterRef[];
}

/** Strips the "4. " numbering prefix the chapter selector renders. */
export function cleanChapterName(label: string, n: number): string {
	const text = decodeEntities(label)
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const stripped = text.replace(/^\d+\.\s*/, "").trim();
	if (stripped.length > 0) {
		return stripped;
	}
	return text.length > 0 ? text : `Kapitel ${n}`;
}

/** Parses a book start page: title, author, description and the chapter
 * selector (`<option value="…/chapter/N">N. Label</option>`). */
export function parseBookPage(body: string, uid: string): BookInfo {
	const title = decodeEntities(
		(
			body.match(
				/<h1 class="book-reader__title">\s*([\s\S]*?)\s*<\/h1>/,
			)?.[1] ?? ""
		)
			.replace(/<[^>]+>/g, "")
			.trim(),
	);
	const author = decodeEntities(
		(
			body.match(
				/class="book-reader__author-link">\s*([\s\S]*?)\s*<\/a>/,
			)?.[1] ?? ""
		)
			.replace(/<[^>]+>/g, "")
			.trim(),
	);
	const description = htmlToText(
		body.match(/<p class="book-reader__description">([\s\S]*?)<\/p>/)?.[1] ??
			"",
	);

	const chapters: ChapterRef[] = [];
	const seen = new Set<number>();
	for (const match of body.matchAll(
		/<option value="([^"]*\/chapter\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/option>/g,
	)) {
		const n = Number.parseInt(match[2] ?? "0", 10);
		if (!Number.isFinite(n) || n <= 0 || seen.has(n)) {
			continue;
		}
		seen.add(n);
		chapters.push({
			n,
			name: cleanChapterName(match[3] ?? "", n),
			url: chapterUrl(uid, n),
		});
	}
	chapters.sort((a, b) => a.n - b.n);

	return {
		uid,
		title: title || titleFromSlug(uid),
		author: author.length > 0 ? author : null,
		description,
		chapters,
	};
}

/** "Verlag: Reclam Verlag | Jahr: 1971"-style description split into
 * key/value pairs for the detail meta map. */
export function parsePublishInfo(description: string): Record<string, string> {
	const meta: Record<string, string> = {};
	for (const part of description.split("|")) {
		const colon = part.indexOf(":");
		if (colon <= 0) {
			continue;
		}
		const key = cleanLine(part.slice(0, colon));
		const value = cleanLine(part.slice(colon + 1));
		if (key.length > 0 && value.length > 0) {
			meta[key] = value;
		}
	}
	return meta;
}

// ---------------------------------------------------------------------------
// Chapter pages -> reading paragraphs
// ---------------------------------------------------------------------------

function extractFirstWrapper(html: string): string {
	const marker = html.indexOf("book-reader__chapter-content-wrapper");
	if (marker < 0) {
		return "";
	}
	const open = html.indexOf(">", marker);
	if (open < 0) {
		return "";
	}
	// The wrapper only contains <p> elements, so the next </div> closes it.
	const close = html.indexOf("</div>", open);
	return close >= 0 ? html.slice(open + 1, close) : html.slice(open + 1);
}

/**
 * Converts one `<p>` chunk of the chapter HTML into paragraph text.
 * Verse line breaks (`<br>`) are preserved as newlines.
 */
export function paragraphText(chunk: string): string {
	const lines = chunk
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((line) => cleanLine(decodeEntities(line)))
		.filter((line) => line.length > 0);
	return lines.join("\n");
}

/**
 * Rewrites headings inside the content wrapper into paragraphs so the
 * `</p>`-splitting scanner below picks them up (the wrapper otherwise
 * only holds block content: headings and `<p>` elements).
 */
function normalizeBlocks(html: string): string {
	return html.replace(
		/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
		'<p class="gb-heading">$2</p>',
	);
}

/** Speaker names in dramas: `<p><span class="speaker">Don Juan</span>. Text…</p>`. */
const SPEAKER_SPAN =
	/<span\b[^>]*\bclass="[^"]*\bspeaker[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

export interface ChapterParagraph {
	content: string;
	style: "bold" | "italic" | null;
}

/** Classifies and cleans the paragraphs of a chapter's HTML body:
 * speaker names become their own bold paragraph, scene settings
 * (`p.scene`) and stage directions (`span.regie`) italic, scene headings
 * (`h1`–`h6`) bold, verse `<br>` breaks become newlines. */
export function chapterParagraphs(html: string): ChapterParagraph[] {
	const out: ChapterParagraph[] = [];
	for (const chunk of normalizeBlocks(html).split(/<\/p>/i)) {
		// Each chunk holds one "<p …>body" pair; text before the first
		// paragraph (wrapper markup) is dropped.
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
		const text = paragraphText(body);
		if (text.length === 0) {
			continue;
		}
		if (/class="[^"]*\bgb-heading/.test(openTag)) {
			out.push({ content: text, style: "bold" });
			continue;
		}
		// The speaker span sits inline at the start of a dialogue paragraph;
		// emit the name as its own bold line and keep the verse unstyled
		// (bolding the whole paragraph would highlight every dialogue line).
		const speaker = SPEAKER_SPAN.exec(body);
		if (speaker) {
			const name = paragraphText(speaker[1] ?? "");
			const after = body.slice(speaker.index + speaker[0].length);
			// Trailing punctuation ("Don Juan.") belongs to the name line.
			const punctMatch = after.match(/^\s*([.,:;!?—–])/);
			const punct = punctMatch?.[1] ?? "";
			const rest = paragraphText(after.slice(punctMatch?.[0].length ?? 0));
			if (name.length > 0) {
				out.push({ content: `${name}${punct}`, style: "bold" });
				if (rest.length > 0) {
					out.push({ content: rest, style: null });
				}
				continue;
			}
			// Empty speaker span: fall through to the plain-text handling.
		}
		let style: "bold" | "italic" | null = null;
		if (/class="[^"]*\bregie/.test(body)) {
			// Italic only when the paragraph carries nothing but the
			// stage direction span.
			const outsideSpans = body
				.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, " ")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]+>/g, "");
			if (cleanLine(decodeEntities(outsideSpans)).length === 0) {
				style = "italic";
			}
		} else if (/class="[^"]*\bscene/.test(openTag)) {
			// Scene settings ("Rom. Gegend des spanischen Platzes.").
			style = "italic";
		}
		out.push({ content: text, style });
	}
	return out;
}

/**
 * Parses a chapter page into reading paragraphs: the chapter heading as a
 * bold lead paragraph followed by the text of the first content wrapper
 * (the page repeats its content inside the hidden reading-mode block,
 * which must be skipped).
 */
export function parseChapter(body: string): ChapterParagraph[] {
	const out: ChapterParagraph[] = [];
	const heading = htmlToText(
		body.match(
			/class="book-reader__chapter-heading">\s*([\s\S]*?)\s*<\/h2>/,
		)?.[1] ?? "",
	);
	if (heading.length > 0) {
		out.push({ content: heading, style: "bold" });
	}
	out.push(...chapterParagraphs(extractFirstWrapper(body)));
	return out;
}
