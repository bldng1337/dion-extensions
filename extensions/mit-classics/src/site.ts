// Pure helpers for scraping The Internet Classics Archive
// (https://classics.mit.edu). Kept free of the built-in `network`/`parse`
// modules so they can be unit-tested directly with inline fixtures.
//
// Verified site structure (the 1994-era site, served over HTTPS since the
// HTTP origin only answers with a redirect):
// - Browse index:   /Browse/index.html              (one link per author,
//                    "browse-<Name>.html" with the display name as link text)
// - Author page:    /Browse/browse-<Name>.html      ("Works by <Name>" heading,
//                    one block per work: <A HREF="/<Dir>/<work>.html" ...
//                    ><U>Title</U></A> followed by a small-font info block
//                    with "Written …", "Translated by …" and, for texts not
//                    hosted locally, "From the Perseus Project")
// - Work page:      /<Dir>/<work>.html              (byline block "By …",
//                    "Written …", "Translated by …"; either a table of
//                    contents — "has been divided into the following
//                    sections" — or the full text of a single-page work
//                    between the NAME="start" and NAME="end" anchors)
// - Section page:   /<Dir>/<work>.<n>.<x>.html      (<!--PART_TITLE: …-->
//                    comment, byline, then the text between NAME="start"
//                    and NAME="end"; <BR><BR> separates paragraphs, a
//                    single <BR> separates verse lines; <B>…</B> marks
//                    speaker names and headings)
// - Search: the site's search form is a Google Custom Search engine, so
//   there is no site-GET-addressable search; search is done client-side
//   over the cached catalog instead.
//
// Roughly 220 of the ~440 listed works are hosted locally; the rest point to
// the Perseus Project and are skipped (they have no readable text here).
// Some of the longest single-page works are truncated on the site itself —
// nothing can be done about that at parse time.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The site answers on HTTPS; plain HTTP only redirects there. */
export const BASE = "https://classics.mit.edu";

/** Works per browse page. */
export const PAGE_SIZE = 24;

export const BROWSE_INDEX_URL = `${BASE}/Browse/index.html`;

/** How many author pages the catalog feed fetches per round. */
export const AUTHOR_BATCH = 6;

export const USER_AGENT =
	"Dion-MitClassics-Extension/1.0 (Dion media app; https://classics.mit.edu)";

/** Public-domain note shown in every detail view. */
export const PUBLIC_DOMAIN_NOTE =
	"Public-domain English translations from The Internet Classics Archive (classics.mit.edu), a service of MIT.";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Named entities common on the (Latin/Greek-heavy) site, case-sensitive. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	ap: "'",
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	middot: "·",
	aelig: "æ",
	AElig: "Æ",
	agrave: "à",
	aacute: "á",
	acirc: "â",
	egrave: "è",
	eacute: "é",
	ecirc: "ê",
	igrave: "ì",
	iacute: "í",
	ograve: "ò",
	oacute: "ó",
	ocirc: "ô",
	ugrave: "ù",
	uacute: "ú",
	ucirc: "û",
	ccedil: "ç",
	ntilde: "ñ",
	szlig: "ß",
	auml: "ä",
	ouml: "ö",
	uuml: "ü",
	Auml: "Ä",
	Ouml: "Ö",
	Uuml: "Ü",
	oslash: "ø",
	aring: "å",
	// Greek letters (site bylines and transliteration notes).
	alpha: "α",
	beta: "β",
	gamma: "γ",
	delta: "δ",
	epsilon: "ε",
	zeta: "ζ",
	eta: "η",
	theta: "θ",
	iota: "ι",
	kappa: "κ",
	lambda: "λ",
	mu: "μ",
	nu: "ν",
	xi: "ξ",
	omicron: "ο",
	pi: "π",
	rho: "ρ",
	sigma: "σ",
	tau: "τ",
	upsilon: "υ",
	phi: "φ",
	chi: "χ",
	psi: "ψ",
	omega: "ω",
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
		.replace(/\u00ad/g, "")
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Work uids are "<Dir>/<file>" without extension, e.g. "Homer/iliad". */
const WORK_UID_PATTERN = /^\/?([A-Za-z_]+)\/([A-Za-z_0-9]+)$/;

export function parseWorkUid(
	uid: string,
): { dir: string; file: string } | null {
	const match = WORK_UID_PATTERN.exec(uid.trim());
	return match ? { dir: match[1] ?? "", file: match[2] ?? "" } : null;
}

/** The work index page URL for a uid. */
export function workUrl(uid: string): string {
	return `${BASE}/${uid}.html`;
}

/** Author browse pages live at /Browse/browse-<Name>.html. */
export function authorBrowseUrl(name: string): string {
	return `${BASE}/Browse/browse-${name}.html`;
}

/** Episode uids are "<workUid>#<1-based section index>". */
export function episodeUid(workUid: string, n: number): string {
	return `${workUid}#${n}`;
}

export function parseEpisodeUid(
	uid: string,
): { workUid: string; n: number } | null {
	const hash = uid.lastIndexOf("#");
	if (hash <= 0) {
		return null;
	}
	const n = Number.parseInt(uid.slice(hash + 1), 10);
	if (!Number.isFinite(n) || n <= 0) {
		return null;
	}
	const workUid = uid.slice(0, hash);
	return parseWorkUid(workUid) ? { workUid, n } : null;
}

// ---------------------------------------------------------------------------
// Browse index and author pages
// ---------------------------------------------------------------------------

export interface AuthorRef {
	/** Slug used in browse-<slug>.html, e.g. "Homer". */
	slug: string;
	/** Display name as linked on the browse index, e.g. "Homer". */
	name: string;
}

/** Parses the /Browse/index.html author list. */
export function parseAuthors(body: string): AuthorRef[] {
	const authors: AuthorRef[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(
		/href="browse-([A-Za-z]+)\.html"[^>]*>([^<]*)</gi,
	)) {
		const slug = match[1] ?? "";
		if (slug.length === 0 || seen.has(slug)) {
			continue;
		}
		seen.add(slug);
		authors.push({ slug, name: decodeEntities((match[2] ?? "").trim()) });
	}
	return authors;
}

export interface CatalogWork {
	/** "<Dir>/<file>" uid, e.g. "Homer/iliad". */
	uid: string;
	/** Absolute work page URL. */
	url: string;
	title: string;
	/** Author display name (from the author page heading). */
	author: string;
	/** "Written 800 B.C.E" line, when present. */
	written: string | null;
	/** "Translated by Samuel Butler" translator name, when present. */
	translator: string | null;
}

const WORK_LINK =
	/href="(\/[A-Za-z_]+\/[A-Za-z_0-9.]+\.html)"[^>]*target="_parent"><u>([^<]*)<\/u><\/a>\s*<font size="-1">((?:(?!<\/font>)[\s\S])*)<\/font>/gi;

/** Parses one author page ("Works by Homer") into its locally readable
 * works. Works whose info block mentions the Perseus Project are skipped:
 * their text is not hosted on this site. */
export function parseAuthorWorks(body: string): CatalogWork[] {
	const heading = body.match(/<b>works by\s+([^<]+)<\/b>/i)?.[1];
	const author = heading ? cleanLine(decodeEntities(heading)) : "";
	const works: CatalogWork[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(WORK_LINK)) {
		const href = match[1] ?? "";
		const title = decodeEntities((match[2] ?? "").trim());
		const info = (match[3] ?? "").replace(/<br\s*\/?>/gi, "\n");
		if (href.includes(":") || /perseus/i.test(info)) {
			continue;
		}
		const uid = href.replace(/\.html$/i, "").replace(/^\//, "");
		if (seen.has(uid)) {
			continue;
		}
		seen.add(uid);
		let written: string | null = null;
		let translator: string | null = null;
		for (const line of info.split("\n")) {
			const text = cleanLine(decodeEntities(line));
			const writtenMatch = /^written\s+(.+)$/i.exec(text);
			const translatedMatch = /^translated by\s+(.+)$/i.exec(text);
			if (writtenMatch) {
				written = writtenMatch[1] ?? null;
			} else if (translatedMatch) {
				translator = translatedMatch[1] ?? null;
			}
		}
		works.push({
			uid,
			url: `${BASE}/${href.replace(/^\//, "")}`,
			title: title.length > 0 ? title : uid,
			author,
			written,
			translator,
		});
	}
	return works;
}

// ---------------------------------------------------------------------------
// Work pages (table of contents or single-page full text)
// ---------------------------------------------------------------------------

export interface SectionRef {
	/** 1-based order of the section within the work. */
	n: number;
	/** Display name, e.g. "Book I". */
	name: string;
	/** Absolute section page URL. */
	url: string;
}

export interface WorkInfo {
	uid: string;
	title: string;
	author: string | null;
	written: string | null;
	translator: string | null;
	/** Sections of a sectioned work; empty for single-page works. */
	sections: SectionRef[];
	/** True when the work page itself holds the full text (one episode). */
	singlePage: boolean;
}

/** Parses the byline block ("By Homer / Written 800 B.C.E / Translated by
 * Samuel Butler") that follows the work title. */
function parseByline(body: string): {
	author: string | null;
	written: string | null;
	translator: string | null;
} {
	const titleStart = body.search(/<font size="\+2"><b>/i);
	let region = "";
	if (titleStart >= 0) {
		const end = body.indexOf("</div>", titleStart);
		region = body.slice(
			titleStart,
			end >= 0 ? end : Math.min(body.length, titleStart + 4000),
		);
	}
	let author: string | null = null;
	let written: string | null = null;
	let translator: string | null = null;
	for (const line of region.replace(/<br\s*\/?>/gi, "\n").split("\n")) {
		const text = cleanLine(decodeEntities(line.replace(/<[^>]+>/g, "")));
		const byMatch = /^by\s+(.+)$/i.exec(text);
		const writtenMatch = /^written\s+(.+)$/i.exec(text);
		const translatedMatch = /^translated by\s+(.+)$/i.exec(text);
		if (byMatch && !author) {
			author = byMatch[1] ?? null;
		} else if (writtenMatch && !written) {
			written = writtenMatch[1] ?? null;
		} else if (translatedMatch && !translator) {
			translator = translatedMatch[1] ?? null;
		}
	}
	return { author, written, translator };
}

/** Parses a work index page: byline plus either the section table ("has been
 * divided into the following sections") or single-page full text. */
export function parseWorkPage(body: string, uid: string): WorkInfo {
	const title = decodeEntities(
		(body.match(/<font size="\+2"><b>([^<]*)<\/b>/i)?.[1] ?? "").trim(),
	);
	const byline = parseByline(body);

	// Sectioned works: collect the .html links between the "divided into"
	// marker and the closing NAME="end" anchor (the download paragraph in
	// between only links .txt files).
	const sections: SectionRef[] = [];
	const tocStart = body.search(/has been divided into/i);
	if (tocStart >= 0) {
		const tocEnd = body.indexOf('name="end"', tocStart);
		const region = body.slice(tocStart, tocEnd >= 0 ? tocEnd : body.length);
		const base = workUrl(uid);
		const dir = base.slice(0, base.lastIndexOf("/") + 1);
		let n = 0;
		for (const match of region.matchAll(
			/href="([A-Za-z_0-9.]+\.html)"[^>]*>([^<]+)</gi,
		)) {
			const href = match[1] ?? "";
			const name = cleanLine(decodeEntities(match[2] ?? ""));
			if (href.includes(":") || name.length === 0) {
				continue;
			}
			n += 1;
			sections.push({ n, name, url: `${dir}${href}` });
		}
	}

	return {
		uid,
		title: title.length > 0 ? title : uid,
		author: byline.author,
		written: byline.written,
		translator: byline.translator,
		sections,
		singlePage: sections.length === 0 && /name="start"/i.test(body),
	};
}

/** Composes the user-facing detail description from the byline pieces. */
export function workDescription(info: WorkInfo): string {
	const parts: string[] = [];
	if (info.author) {
		parts.push(`By ${info.author}`);
	}
	if (info.written) {
		parts.push(`Written ${info.written}`);
	}
	if (info.translator) {
		parts.push(`Translated by ${info.translator}`);
	}
	if (info.sections.length > 0) {
		parts.push(`Divided into ${info.sections.length} sections`);
	}
	return parts.join(". ");
}

// ---------------------------------------------------------------------------
// Section pages -> reading paragraphs
// ---------------------------------------------------------------------------

export interface SectionParagraph {
	content: string;
	style: "bold" | null;
}

/** Cuts a page down to the readable region between the NAME="start" and
 * NAME="end" anchors (falling back to cutting at the footer navigation
 * table, which uses the same markup as the header). */
export function extractContentRegion(body: string): string {
	const startMatch = /<a\s+name="start"[^>]*>/i.exec(body);
	const from = startMatch ? startMatch.index + startMatch[0].length : 0;
	let to = body.length;
	const endMatch = /<a\s+name="end"[^>]*>/i.exec(body.slice(from));
	if (endMatch) {
		to = from + endMatch.index;
	} else {
		// Footer nav table (mirrors the header chrome).
		const footer =
			/<div\s+align="center"[^>]*>\s*<table[^>]*cellspacing="15"/i.exec(
				body.slice(from),
			);
		if (footer) {
			to = from + footer.index;
		}
	}
	return body.slice(from, to);
}

const SECTION_TITLE = /<!--\s*part_title:\s*(.*?)-->/i;

const BOLD_SENTINEL_START = "\u0001";
const BOLD_SENTINEL_END = "\u0002";
/** Paragraph separator used while normalising the content region. */
const PARA_SEP = "\u2029";
/** Verse line-break marker (a single <BR>); raw newlines are plain source
 * wrapping and fold into spaces. */
const LINE_BREAK = "\u0003";

/**
 * Parses a section (or single-page work) body into reading paragraphs:
 * the part title ("Book I") leads as a bold paragraph, `<B>…</B>` speaker
 * names and headings become their own bold paragraphs, `<BR><BR>` separates
 * paragraphs, single `<BR>` keeps verse line breaks, and all entities are
 * decoded. Site chrome (anchors, nav tables, hr rules) is dropped.
 */
export function parseSection(
	body: string,
	fallbackHeading: string | null,
): SectionParagraph[] {
	const titleMatch = SECTION_TITLE.exec(body);
	const heading =
		titleMatch?.[1] !== undefined
			? htmlToText(titleMatch[1])
			: (fallbackHeading ?? "");

	const out: SectionParagraph[] = [];
	if (heading.length > 0) {
		out.push({ content: heading, style: "bold" });
	}

	const html = extractContentRegion(body)
		.replace(/<!--[\s\S]*?-->/g, " ")
		// Anchors (NAME="10" line markers) and hr rules disappear; hr counts
		// as a paragraph break.
		.replace(/<a\s[^>]*>|<\/a>/gi, "")
		.replace(/<hr\b[^>]*>/gi, PARA_SEP)
		// Bold regions (headings, speaker names) become delimited standalone
		// paragraphs; bold text inside these pages is plain text.
		.replace(
			/<b\b[^>]*>([\s\S]*?)<\/b>/gi,
			(_, inner: string) =>
				`${PARA_SEP}${BOLD_SENTINEL_START}${htmlToText(inner)}${BOLD_SENTINEL_END}${PARA_SEP}`,
		)
		// Block containers collapse into whitespace.
		.replace(/<\/?(blockquote|div|table|tr|td|th|font|p)\b[^>]*>/gi, " ")
		// Runs of two or more <BR> separate paragraphs; a single <BR> is a
		// verse line break (kept via the marker below). Raw newlines in the
		// HTML source are mere wrapping and later fold into spaces.
		.replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, PARA_SEP)
		.replace(/\s*<br\s*\/?>\s*/gi, LINE_BREAK)
		.replace(/<[^>]+>/g, "");

	for (const chunk of html.split(PARA_SEP)) {
		let text = chunk;
		let bold = false;
		if (
			text.includes(BOLD_SENTINEL_START) ||
			text.includes(BOLD_SENTINEL_END)
		) {
			bold = true;
			text = text
				.split(BOLD_SENTINEL_START)
				.join("")
				.split(BOLD_SENTINEL_END)
				.join("");
		}
		const lines = text
			.split(LINE_BREAK)
			.map((line) => cleanLine(decodeEntities(line)))
			.filter((line) => line.length > 0);
		const content = lines.join("\n");
		if (content.length === 0) {
			continue;
		}
		out.push({ content, style: bold ? "bold" : null });
	}
	return out;
}
