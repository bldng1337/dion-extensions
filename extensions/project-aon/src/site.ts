// Pure helpers for scraping Project Aon (https://www.projectaon.org), the
// officially sanctioned digital archive of the Lone Wolf gamebooks and other
// series by Joe Dever. Kept free of the built-in `network`/`parse` modules so
// the helpers can be unit-tested directly with inline fixtures.
//
// Verified site structure (two page layouts coexist):
// - Series index:    /en/xhtml/                       (Apache autoindex, one
//   directory per series: lw/ = Lone Wolf, gs/ = The World of Lone Wolf,
//   fw/ = Freeway Warrior, misc/ = non-gamebook material)
// - Book index:      /en/xhtml/<series>/              (autoindex; book
//   directories are prefixed with their number, e.g. 01fftd/, 29tsoc/)
// - Title page:      /en/xhtml/<series>/<book>/title.htm
//   New layout (Lone Wolf #1+): <article>…</article> inside .maintext,
//   <header><h1>title</h1><h2>authors</h2></header> outside it.
//   Old layout (early books): no <article>/<h1>; the title only appears in
//   <head><title> as "Title: Title Page" and the content in
//   <div class="maintext">. The blurb is the first paragraphs either way.
// - Table of contents: …/toc.htm (a <ul> list of named front/back matter
//   pages plus a "Numbered Sections" entry pointing at numbered.htm)
// - Numbered sections: …/numbered.htm lists href="sectN.htm" for every
//   gamebook section (e.g. 350 in book 1); the pages themselves are
//   …/sect1.htm … sectN.htm with <h3>N</h3>, <p> paragraphs and
//   <p class="choice">…turn to N.</p> choices
// - No per-book cover images exist on the site (only logos, illustrations
//   and action-chart icons), so entries carry no cover.
//
// License note: the books are free to read but internet redistribution is
// forbidden by the Project Aon license — this extension only fetches pages
// from projectaon.org on the user's behalf and never mirrors content.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://www.projectaon.org";

/** English XHTML reading tree. */
export const XHTML_INDEX_URL = `${BASE}/en/xhtml/`;

/** Books per browse page. */
export const PAGE_SIZE = 24;

/** How many book title pages the catalog feed fetches per round. */
export const BOOK_BATCH = 8;

export const USER_AGENT =
	"Dion-ProjectAon-Extension/1.0 (Dion media app; https://www.projectaon.org)";

/** Display names for the known series directories. */
export const SERIES_NAMES: Record<string, string> = {
	lw: "Lone Wolf",
	gs: "The World of Lone Wolf",
	fw: "Freeway Warrior",
};

/** Fallback authors when a title page carries no author heading. */
export const SERIES_AUTHORS: Record<string, string[]> = {
	lw: ["Joe Dever"],
	gs: ["Ian Page"],
	fw: ["Joe Dever"],
};

/** Series browse order (flagship series first, unknown series after). */
const SERIES_ORDER: Record<string, number> = { lw: 0, gs: 1, fw: 2 };

/** License note shown in every detail view. */
export const PROJECT_AON_NOTE =
	"Free to read courtesy of Project Aon (projectaon.org) with the authors' explicit permission. Internet redistribution of these books is forbidden — please do not mirror or share the files; read them here or directly at projectaon.org.";

/** TOC pages that are not useful reading episodes. */
const EXCLUDED_TOC_FILES = new Set([
	"title.htm",
	"toc.htm",
	"numbered.htm",
	"dedicate.htm",
	"acknwldg.htm",
	"errata.htm",
	"footnotz.htm",
	"illstrat.htm",
	"license.htm",
	"maplarge.htm",
]);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Named entities common on the site, case-sensitive. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	copy: "©",
	reg: "®",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	middot: "·",
	bull: "•",
	deg: "°",
	thinsp: "\u2009",
	ensp: "\u2002",
	emsp: "\u2003",
	shy: "\u00ad",
	aacute: "á",
	agrave: "à",
	acirc: "â",
	aelig: "æ",
	auml: "ä",
	ccedil: "ç",
	eacute: "é",
	egrave: "è",
	ecirc: "ê",
	ecolon: "ë",
	iacute: "í",
	igrave: "ì",
	icirc: "î",
	ntilde: "ñ",
	oacute: "ó",
	ograve: "ò",
	ocirc: "ô",
	ouml: "ö",
	oslash: "ø",
	uacute: "ú",
	ugrave: "ù",
	ucirc: "û",
	uuml: "ü",
	yuml: "ÿ",
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

/** Decodes named and numeric HTML entities (the VM has no DOM globals). */
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
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
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
		.replace(/[\u00ad\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/[\u00a0\u2000-\u200a\u202f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Book uids are "<series>/<dir>", e.g. "lw/01fftd". */
const BOOK_UID_PATTERN = /^([a-z0-9_-]+)\/(\d+[a-z0-9_-]+)$/i;

export function parseBookUid(
	uid: string,
): { series: string; dir: string } | null {
	const match = BOOK_UID_PATTERN.exec(uid.trim());
	return match ? { series: match[1] ?? "", dir: match[2] ?? "" } : null;
}

/** URL of a book file ("title.htm", "toc.htm", "sect1.htm", …). */
export function bookFileUrl(uid: string, file: string): string {
	return `${BASE}/en/xhtml/${uid}/${file}`;
}

/** The book title page URL (the entry URL). */
export function bookUrl(uid: string): string {
	return bookFileUrl(uid, "title.htm");
}

/** Episode uids are "<bookUid>#<file>", e.g. "lw/01fftd#sect1". */
export function episodeUid(bookUid: string, file: string): string {
	return `${bookUid}#${file}`;
}

const EPISODE_FILE_PATTERN = /^[a-z0-9_-]+\.htm$/i;

export function parseEpisodeUid(
	uid: string,
): { bookUid: string; file: string } | null {
	const hash = uid.lastIndexOf("#");
	if (hash <= 0) {
		return null;
	}
	const bookUid = uid.slice(0, hash);
	const file = uid.slice(hash + 1);
	if (!EPISODE_FILE_PATTERN.test(file) || !parseBookUid(bookUid)) {
		return null;
	}
	return { bookUid, file };
}

// ---------------------------------------------------------------------------
// Autoindex pages (series and book listings)
// ---------------------------------------------------------------------------

/** Parses the /en/xhtml/ autoindex into ordered series directory names. */
export function parseSeriesDirs(body: string): string[] {
	const dirs: string[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(/href="([a-z0-9_-]+)\/"/gi)) {
		const dir = match[1] ?? "";
		if (dir.length === 0 || seen.has(dir)) {
			continue;
		}
		seen.add(dir);
		dirs.push(dir);
	}
	return dirs.sort((a, b) => {
		const oa = SERIES_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
		const ob = SERIES_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
		return oa === ob ? a.localeCompare(b) : oa - ob;
	});
}

/** Parses a series autoindex into its numbered book directories, in book
 * order ("01fftd" before "02fotw" and "02fotw" before "10tdot"). */
export function parseBookDirs(body: string): string[] {
	const dirs: string[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(/href="(\d+[a-z0-9_-]*)\/"/gi)) {
		const dir = match[1] ?? "";
		if (dir.length === 0 || seen.has(dir)) {
			continue;
		}
		seen.add(dir);
		dirs.push(dir);
	}
	return dirs.sort((a, b) => {
		const na = Number.parseInt(a, 10);
		const nb = Number.parseInt(b, 10);
		if (na !== nb) {
			return na - nb;
		}
		return a.localeCompare(b);
	});
}

// ---------------------------------------------------------------------------
// Book title pages
// ---------------------------------------------------------------------------

export interface BookMeta {
	uid: string;
	title: string;
	authors: string[];
	/** Back-cover blurb from the title page, when present. */
	blurb: string | null;
}

/** Parses a title.htm into title, authors and blurb. Returns null when the
 * page does not look like a book title page (redirect stubs, wiki pages,
 * non-gamebook material). */
export function parseTitlePage(body: string, uid: string): BookMeta | null {
	// Both layouts carry the reading content in .maintext or <article>.
	if (!/<div\s+class="maintext|<article[\s>]/i.test(body)) {
		return null;
	}
	// <title>Flight from the Dark: Title Page</title> — both layouts.
	const headTitle = htmlToText(
		body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "",
	);
	const titleMatch = /^(.*?):\s*Title Page\s*$/i.exec(headTitle);
	let title = titleMatch?.[1]?.trim() ?? "";
	if (title.length === 0) {
		// New layout fallback: the header <h1>.
		title = htmlToText(body.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
	}
	if (title.length === 0 || title.length > 120) {
		return null;
	}

	// New layout: <h1>Title</h1><h2>Authors</h2> header outside <article>.
	let authors: string[] = [];
	const headerMatch = /<h1>[\s\S]*?<\/h1>\s*<h2>([\s\S]*?)<\/h2>/i.exec(body);
	if (headerMatch) {
		const line = htmlToText(headerMatch[1] ?? "");
		if (line.length > 0 && line.length <= 80) {
			authors = parseAuthorLine(line);
		}
	}

	const series = parseBookUid(uid)?.series ?? "";
	if (authors.length === 0) {
		authors = SERIES_AUTHORS[series] ?? [];
	}

	const blurb = parseBlurb(body);
	return { uid, title, authors, blurb };
}

/** Splits "Joe Dever and Gary Chalk" into per-author names. */
export function parseAuthorLine(line: string): string[] {
	return line
		.split(/\s+(?:and|&|,)\s+/i)
		.map((part) => part.trim())
		.filter((part) => part.length > 0 && part.length <= 60);
}

/** The blurb is the opening of the title page text: the first two paragraphs
 * (tagline + back-cover text), before the author/illustrator biographies. */
function parseBlurb(body: string): string | null {
	const region = extractContentRegion(body);
	const paragraphs = region
		.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, " ")
		.replace(/<\/p>/gi, "\u2029")
		.replace(/<[^>]+>/g, "")
		.split("\u2029")
		.map((chunk) => cleanLine(decodeEntities(chunk)))
		.filter((chunk) => chunk.length > 0);
	const lead = paragraphs.slice(0, 2).join("\n\n");
	if (lead.length === 0) {
		return null;
	}
	return capText(lead, 700);
}

/** Truncates text on a word boundary with an ellipsis. */
export function capText(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Table of contents and numbered sections
// ---------------------------------------------------------------------------

export interface TocPage {
	/** Page file name, e.g. "tssf.htm". */
	file: string;
	/** Link text, e.g. "The Story So Far …". */
	name: string;
}

/** Parses toc.htm into the ordered list of named pages (nested <ul> entries
 * flattened in document order, duplicates dropped). Footer navigation is
 * excluded by cutting to the content region first. */
export function parseTocPages(body: string): TocPage[] {
	const pages: TocPage[] = [];
	const seen = new Set<string>();
	for (const match of extractContentRegion(body).matchAll(
		/<a\s+href="([a-z0-9_-]+\.htm)"[^>]*>([\s\S]*?)<\/a>/gi,
	)) {
		const file = (match[1] ?? "").toLowerCase();
		const name = htmlToText(match[2] ?? "");
		if (!EPISODE_FILE_PATTERN.test(file) || seen.has(file)) {
			continue;
		}
		seen.add(file);
		pages.push({ file, name });
	}
	return pages;
}

export interface SectionRef {
	/** Gamebook section number. */
	n: number;
	/** Page file, e.g. "sect1.htm". */
	file: string;
}

/** Parses numbered.htm into the ordered section list (deduplicated, sorted
 * by section number to survive any listing quirks). */
export function parseNumberedSections(body: string): SectionRef[] {
	const sections = new Map<number, string>();
	for (const match of body.matchAll(/href="sect(\d+)\.htm"/gi)) {
		const n = Number.parseInt(match[1] ?? "", 10);
		if (Number.isFinite(n) && n > 0 && !sections.has(n)) {
			sections.set(n, `sect${n}.htm`);
		}
	}
	return [...sections.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([n, file]) => ({ n, file }));
}

export interface EpisodeRef {
	/** Page file, e.g. "tssf.htm" or "sect7.htm". */
	file: string;
	/** Display name, e.g. "The Story So Far …" or "Section 7". */
	name: string;
	/** Absolute page URL. */
	url: string;
}

const SECTION_NAME = /^sect(\d+)\.htm$/i;

/** Builds the ordered episode list: readable front matter from the TOC,
 * then the numbered gamebook sections, then the remaining back matter
 * (maps, action charts, tables) — mirrors the TOC order. */
export function buildEpisodes(
	uid: string,
	tocPages: TocPage[],
	sections: SectionRef[],
): EpisodeRef[] {
	const episodes: EpisodeRef[] = [];
	let sectionsDone = false;
	for (const page of tocPages) {
		if (page.file === "numbered.htm") {
			for (const section of sections) {
				episodes.push({
					file: section.file,
					name: `Section ${section.n}`,
					url: bookFileUrl(uid, section.file),
				});
			}
			sectionsDone = true;
			continue;
		}
		if (EXCLUDED_TOC_FILES.has(page.file) || page.name.length === 0) {
			continue;
		}
		episodes.push({
			file: page.file,
			name: page.name,
			url: bookFileUrl(uid, page.file),
		});
	}
	// A TOC without the numbered.htm marker still gets its sections.
	if (!sectionsDone) {
		for (const section of sections) {
			episodes.push({
				file: section.file,
				name: `Section ${section.n}`,
				url: bookFileUrl(uid, section.file),
			});
		}
	}
	return episodes;
}

/** Section number of a "sectN.htm" file name, for headings/fallbacks. */
export function sectionNumberOf(file: string): number | null {
	const m = SECTION_NAME.exec(file);
	if (!m) {
		return null;
	}
	const n = Number.parseInt(m[1] ?? "", 10);
	return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Page content region
// ---------------------------------------------------------------------------

/**
 * Cuts a page down to its readable region:
 * 1. <article>…</article> (new layout, chrome lives outside);
 * 2. <div class="maintext">… up to the navigation/copyright blocks
 *    (old layout);
 * 3. <body>… minus footer/license/navigation as a last resort.
 */
export function extractContentRegion(body: string): string {
	const articleStart = /<article[\s>]/i.exec(body);
	if (articleStart) {
		const from = articleStart.index + articleStart[0].length;
		const close = body.indexOf("</article>", from);
		return body.slice(from, close >= 0 ? close : body.length);
	}

	const maintextStart =
		/<div\s+class="maintext[^"]*"[^>]*>/i.exec(body) ??
		/<div\s+id="maintext"[^>]*>/i.exec(body);
	if (maintextStart) {
		const from = maintextStart.index + maintextStart[0].length;
		let to = body.length;
		for (const marker of [
			/<div\s+class="navigation"/i,
			/<div\s+id="navigation"/i,
			/<p\s+class="copyright"/i,
			/<footer[\s>]/i,
			/<div\s+id="license"/i,
			/<\/body>/i,
		]) {
			const at = body.slice(from).search(marker);
			if (at >= 0 && from + at < to) {
				to = from + at;
			}
		}
		return body.slice(from, to);
	}

	const bodyStart = /<body[^>]*>/i.exec(body);
	const from = bodyStart ? bodyStart.index + bodyStart[0].length : 0;
	let to = body.length;
	for (const marker of [
		/<footer[\s>]/i,
		/<div\s+id="license"/i,
		/<div\s+class="navigation"/i,
		/<p\s+class="copyright"/i,
		/<\/body>/i,
	]) {
		const at = body.slice(from).search(marker);
		if (at >= 0 && from + at < to) {
			to = from + at;
		}
	}
	return body.slice(from, to);
}

// ---------------------------------------------------------------------------
// Page body -> reading paragraphs
// ---------------------------------------------------------------------------

export interface PageParagraph {
	content: string;
	style: "bold" | null;
}

const BOLD_START = "\u0001";
const BOLD_END = "\u0002";
/** Paragraph separator used while normalising the content region. */
const PARA_SEP = "\u2029";
/** In-paragraph line-break marker (a single <br/>). */
const LINE_BREAK = "\u0003";

/**
 * Parses any reading page (numbered section, rules, story-so-far, charts)
 * into clean paragraphs:
 * - the first heading (e.g. the <h3> section number or the <h2> page title)
 *   leads as a bold paragraph;
 * - <p> boundaries (and list items/table rows/rules) separate paragraphs;
 * - "turn to N" links keep their text ("… turn to 141.");
 * - <b>/<strong> markup marks standalone bold paragraphs (headings, leads);
 *   inline bold inside ordinary sentences is flattened to plain text;
 * - <img>/<figure> illustrations are skipped (Paragraphlist is text-only);
 * - all entities are decoded and site chrome is stripped.
 * `fallbackHeading` becomes the bold lead when the page has no heading.
 */
export function parsePageParagraphs(
	body: string,
	fallbackHeading: string | null,
): PageParagraph[] {
	const html = extractContentRegion(body)
		.replace(/<!--[\s\S]*?-->/g, " ")
		// Illustration-only and non-text nodes cannot render in a
		// Paragraphlist.
		.replace(/<(?:img|area|embed|object|iframe|input|button)\b[^>]*>/gi, " ")
		.replace(/<(script|style|figure|map|svg|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
		// Headings become standalone bold paragraphs.
		.replace(
			/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
			(_, inner: string) =>
				`${PARA_SEP}${BOLD_START}${inner}${BOLD_END}${PARA_SEP}`,
		)
		// Bold/strong markup becomes inline sentinels; a paragraph counts as
		// bold only when the sentinels span the whole paragraph.
		.replace(
			/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi,
			(_, inner: string) => `${BOLD_START}${inner}${BOLD_END}`,
		)
		// Block containers and list/table structure separate paragraphs;
		// table cells keep a readable separator between values.
		.replace(/<\/t[dh]>/gi, " | ")
		.replace(
			/<\/?(?:p|div|ul|ol|li|dl|dt|dd|blockquote|table|thead|tbody|tfoot|caption|tr|center|article|section|nav|footer|aside|form|pre)\b[^>]*>/gi,
			PARA_SEP,
		)
		// Two or more <br/> separate paragraphs; a single one is a line break.
		.replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, PARA_SEP)
		.replace(/\s*<br\s*\/?>\s*/gi, LINE_BREAK)
		.replace(/<hr\b[^>]*>/gi, PARA_SEP)
		// Remaining inline tags (a, cite, em, span, …) just disappear, so
		// "turn to 141" links keep their visible text.
		.replace(/<[^>]+>/g, "");

	const out: PageParagraph[] = [];
	for (const chunk of html.split(PARA_SEP)) {
		let text = chunk;
		let bold = false;
		if (text.includes(BOLD_START)) {
			const count = text.split(BOLD_START).length - 1;
			bold =
				count === 1 &&
				text.trim().startsWith(BOLD_START) &&
				text.trim().endsWith(BOLD_END);
			text = text.split(BOLD_START).join("").split(BOLD_END).join("");
		}
		const content = text
			.split(LINE_BREAK)
			.map((line) => cleanLine(decodeEntities(line)))
			.map((line) =>
				// Collapse table-cell separators and trim stray edge pipes.
				line
					.replace(/(?:\s*\|\s*)+/g, " | ")
					.replace(/(?:\s*\|)+\s*$/g, "")
					.replace(/^(?:\s*\|)+\s*/g, ""),
			)
			.filter((line) => line.length > 0)
			.join("\n");
		if (content.length === 0) {
			continue;
		}
		// Table rows flatten to "a | b | c" — bold detection is pointless
		// there, keep them plain.
		out.push({ content, style: bold ? "bold" : null });
	}

	if (out.length > 0 && out[0]?.style !== "bold" && fallbackHeading) {
		out.unshift({ content: fallbackHeading, style: "bold" });
	}
	return out;
}

/** Message shown for pages that carry only illustrations/tables. */
export const IMAGE_ONLY_NOTE =
	"This page contains only illustrations or tables on Project Aon and cannot be shown as text — see it at projectaon.org.";
