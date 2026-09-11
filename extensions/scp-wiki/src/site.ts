// Pure helpers for scraping the SCP Wiki (https://scp-wiki.wikidot.com).
// Kept free of the built-in `network`/`parse` modules so they can be
// unit-tested directly with inline fixtures.
//
// Verified site structure (Wikidot-hosted, server-rendered HTML):
// - Series listings: /scp-series (SCP-001-999), /scp-series-2 (1000-1999),
//   ... up to /scp-series-10 (9000-9999). Each holds one `<li>` per entry:
//   `<li><a href="/scp-173">SCP-173</a> - The Sculpture - <strong>The
//   Original</strong></li>` (the trailing `<strong>` part is an editorial
//   annotation; titles may also carry `<em>`/`<span>`/`<tt>` markup and
//   entities).
// - Article pages: /scp-173 etc. `<title>SCP-173 - SCP Foundation</title>`,
//   a rating widget (`<span class="rate-points">...<span class="number
//   ...">+11045</span>`), the article inside `<div id="page-content">`
//   followed by the wikiwalk nav and the licensebox citation block
//   (containing `"SCP-173" by Moto42, from the SCP Wiki. ... Licensed under
//   CC BY-SA`), then `<div class="page-tags">` outside page-content.
//   Article text is mostly `<p><strong>Label:</strong> text</p>` paragraphs
//   plus blockquotes, tables and (on newer pages) heavy CSS components
//   (infobars, tabviews) — the parsers below degrade gracefully on those,
//   keeping whatever readable text exists.
// - There is no usable unauthenticated search API; the Wikidot API requires
//   auth keys, so search runs client-side over the cached series listings.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://scp-wiki.wikidot.com";

/** Entries per browse/search page. */
export const PAGE_SIZE = 24;

export const USER_AGENT =
	"Dion-ScpWiki-Extension/1.0 (Dion media app; https://scp-wiki.wikidot.com)";

/** A series listing page ("Series I".."Series X"). */
export interface SeriesRef {
	/** Page slug, e.g. "scp-series-2". */
	slug: string;
	/** Display label, e.g. "Series II (SCP-1000-SCP-1999)". */
	label: string;
}

export const SERIES: SeriesRef[] = [
	{ slug: "scp-series", label: "Series I (SCP-001-SCP-999)" },
	{ slug: "scp-series-2", label: "Series II (SCP-1000-SCP-1999)" },
	{ slug: "scp-series-3", label: "Series III (SCP-2000-SCP-2999)" },
	{ slug: "scp-series-4", label: "Series IV (SCP-3000-SCP-3999)" },
	{ slug: "scp-series-5", label: "Series V (SCP-4000-SCP-4999)" },
	{ slug: "scp-series-6", label: "Series VI (SCP-5000-SCP-5999)" },
	{ slug: "scp-series-7", label: "Series VII (SCP-6000-SCP-6999)" },
	{ slug: "scp-series-8", label: "Series VIII (SCP-7000-SCP-7999)" },
	{ slug: "scp-series-9", label: "Series IX (SCP-8000-SCP-8999)" },
	{ slug: "scp-series-10", label: "Series X (SCP-9000-SCP-9999)" },
];

/** Dropdown value that spans all series listings. */
export const ALL_SERIES = "all";

export const SERIES_SETTING_ID = "series";

/** Attribution/share-alike note shown in every detail view (CC BY-SA 3.0). */
export const ATTRIBUTION_NOTE =
	"SCP articles are collaborative horror/sci-fi fiction licensed under CC BY-SA 3.0. Content may include mature themes; individual pages carry their own warnings. Written by the SCP Wiki community — attribute the author, link the source, and share adaptations under the same license.";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Named entities common on Wikidot pages. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	laquo: "«",
	raquo: "»",
	middot: "·",
	bull: "•",
	dagger: "†",
	permil: "‰",
	eacute: "é",
	egrave: "è",
	uuml: "ü",
	ouml: "ö",
	auml: "ä",
	szlig: "ß",
	ntilde: "ñ",
	ccedil: "ç",
	deg: "°",
	plusmn: "±",
	frac12: "½",
	frac14: "¼",
	sup2: "²",
	sup3: "³",
	micro: "µ",
	sect: "§",
	para: "¶",
	copy: "©",
	reg: "®",
	trade: "™",
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
			(match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
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

/** Normalises one line of article text (entities, invisible characters). */
function cleanLine(text: string): string {
	return decodeEntities(text)
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b\u200e\u200f\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Article uids are the page slug, e.g. "scp-173". */
const ARTICLE_UID_PATTERN = /^scp-\d+$/;

export function parseArticleSlug(uid: string): { slug: string } | null {
	const slug = uid.trim().toLowerCase();
	return ARTICLE_UID_PATTERN.test(slug) ? { slug } : null;
}

/** The article page URL for a uid, e.g. "scp-173". */
export function articleUrl(uid: string): string {
	return `${BASE}/${uid}`;
}

/** The series listing URL for a series slug. */
export function seriesUrl(slug: string): string {
	return `${BASE}/${slug}`;
}

/** Uppercase article number for a slug, e.g. "scp-173" -> "SCP-173". */
export function articleNumber(slug: string): string {
	return slug.toUpperCase();
}

/** Episode uids are "<slug>#read" (every article is one episode). */
export function episodeUid(slug: string): string {
	return `${slug}#read`;
}

export function parseEpisodeUid(uid: string): { slug: string } | null {
	const hash = uid.lastIndexOf("#");
	const slug = (hash > 0 ? uid.slice(0, hash) : uid).trim().toLowerCase();
	return parseArticleSlug(slug) ? { slug } : null;
}

/** User-facing browse/search title: "SCP-173 — The Sculpture". */
export function composeTitle(
	number: string,
	seriesTitle: string | null,
): string {
	return seriesTitle ? `${number} — ${seriesTitle}` : number;
}

// ---------------------------------------------------------------------------
// Series listing pages
// ---------------------------------------------------------------------------

/** One entry of a series listing. */
export interface SeriesItem {
	/** Article slug/uid, e.g. "scp-173". */
	slug: string;
	/** Article URL. */
	url: string;
	/** Number, e.g. "SCP-173". */
	number: string;
	/** Title from the listing ("The Sculpture"), without the number. */
	title: string | null;
}

const SERIES_ITEM =
	/<li>\s*<a href="\/(scp-\d+)">\s*SCP-\d+\s*<\/a>([\s\S]*?)<\/li>/g;

/** Parses a series listing page into its entries (deduplicated). */
export function parseSeriesList(body: string): SeriesItem[] {
	const items: SeriesItem[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(SERIES_ITEM)) {
		const slug = (match[1] ?? "").toLowerCase();
		if (slug.length === 0 || seen.has(slug)) {
			continue;
		}
		seen.add(slug);
		let html = match[2] ?? "";
		// Drop trailing editorial annotations like " - <strong>The Original</strong>".
		html = html.replace(
			/\s*[-–—]\s*<(?:strong|b)>[\s\S]*?<\/(?:strong|b)>\s*$/i,
			"",
		);
		const title = htmlToText(html)
			.replace(/^[-–—:,.\s]+/, "")
			.trim();
		items.push({
			slug,
			url: articleUrl(slug),
			number: articleNumber(slug),
			title: title.length > 0 ? title : null,
		});
	}
	return items;
}

// ---------------------------------------------------------------------------
// Article pages
// ---------------------------------------------------------------------------

/** Cuts a page down to the article body inside `<div id="page-content">`,
 * stopping before the wikiwalk nav, licensebox, page tags or page info
 * blocks (whichever comes first). */
export function extractArticleRegion(body: string): string {
	const start = body.search(/<div id="page-content"[^>]*>/i);
	if (start < 0) {
		return "";
	}
	let to = body.length;
	for (const marker of [
		/<div class="footer-wikiwalk-nav">/i,
		/<div class="licensebox">/i,
		/<div class="page-tags">/i,
		/<div id="page-info">/i,
	]) {
		const match = marker.exec(body.slice(start));
		if (match && start + match.index < to) {
			to = start + match.index;
		}
	}
	return body.slice(start, to);
}

const PARA_SEP = "\u2029";
const BOLD_SENTINEL_START = "\u0001";
const BOLD_SENTINEL_END = "\u0002";
/** Inline line-break marker (a single <BR>). */
const LINE_BREAK = "\u0003";

/** Collapses a region into paragraph-separated text: block boundaries become
 * paragraph breaks, bold runs are sentinel-wrapped, tables become simple
 * "cell | cell" lines and all other markup is stripped. */
function normalizeRegion(region: string): string {
	return (
		region
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
			// The +/− rating widget is site chrome.
			.replace(/<div class="page-rate-widget-box">[\s\S]*?<\/div>/gi, " ")
			.replace(/<div class="footer-wikiwalk-nav">[\s\S]*$/i, " ")
			// Headings and inline bold runs keep their text as bold sentinels.
			.replace(
				/<(?:h[1-6])\b[^>]*>([\s\S]*?)<\/(?:h[1-6])>/gi,
				(_, inner: string) =>
					`${PARA_SEP}${BOLD_SENTINEL_START}${htmlToText(inner)}${BOLD_SENTINEL_END}${PARA_SEP}`,
			)
			.replace(
				/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
				(_, inner: string) =>
					`${BOLD_SENTINEL_START}${htmlToText(inner)}${BOLD_SENTINEL_END}`,
			)
			// Tables become simple text lines with cell separators.
			.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ")
			.replace(/<hr\b[^>]*>/gi, PARA_SEP)
			.replace(
				/<\/(?:p|blockquote|div|li|tr|ul|ol|table|dl|dd|dt)>/gi,
				PARA_SEP,
			)
			// Runs of two or more <BR> separate paragraphs; a single <BR> is an
			// inline line break.
			.replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, PARA_SEP)
			.replace(/\s*<br\s*\/?>\s*/gi, LINE_BREAK)
			.replace(/<[^>]+>/g, "")
	);
}

/** A run of text with a bold flag. */
export interface SourceText {
	content: string;
	bold: boolean;
}

/** One parsed article paragraph, ready to map onto a runtime Paragraph. */
export type SourceParagraph =
	| { kind: "text"; content: string; bold: boolean }
	| { kind: "mixed"; parts: SourceText[] };

function parseChunk(chunk: string): SourceParagraph | null {
	const parts: SourceText[] = [];
	// biome-ignore lint/suspicious/noControlCharactersInRegex: private bold sentinels
	const boldRun = /\u0001([^\u0001\u0002]*)\u0002/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = boldRun.exec(chunk)) !== null) {
		const before = chunk
			.slice(last, match.index)
			.split(LINE_BREAK)
			.map(cleanLine)
			.filter((line) => line.length > 0)
			.join("\n");
		if (before.length > 0) {
			parts.push({ content: before, bold: false });
		}
		const boldText = (match[1] ?? "")
			.split(LINE_BREAK)
			.map(cleanLine)
			.filter((line) => line.length > 0)
			.join("\n");
		if (boldText.length > 0) {
			parts.push({ content: boldText, bold: true });
		}
		last = match.index + match[0].length;
	}
	const tail = chunk
		.slice(last)
		.split(LINE_BREAK)
		.map(cleanLine)
		.filter((line) => line.length > 0)
		.join("\n");
	if (tail.length > 0) {
		parts.push({ content: tail, bold: false });
	}
	if (parts.length === 0) {
		return null;
	}
	if (parts.length === 1 && parts[0]) {
		const part = parts[0];
		return { kind: "text", content: part.content, bold: part.bold };
	}
	if (parts.every((part) => part.bold)) {
		return {
			kind: "text",
			content: parts.map((part) => part.content).join(" "),
			bold: true,
		};
	}
	return { kind: "mixed", parts };
}

/** Parses an article region into readable paragraphs. Component-heavy
 * (experimental-format) pages degrade to their readable text lines. */
export function parseArticleParagraphs(region: string): SourceParagraph[] {
	const paragraphs: SourceParagraph[] = [];
	for (const chunk of normalizeRegion(region).split(PARA_SEP)) {
		const paragraph = parseChunk(chunk);
		if (paragraph) {
			paragraphs.push(paragraph);
		}
	}
	return paragraphs;
}

/** Plain text of a paragraph (mixed parts joined with spaces). */
export function paragraphText(paragraph: SourceParagraph): string {
	return paragraph.kind === "text"
		? paragraph.content
		: paragraph.parts.map((part) => part.content).join(" ");
}

/** Page `<title>` ("SCP-173 - SCP Foundation") reduced to the page name. */
export function parsePageTitle(body: string): string | null {
	const raw = /<title>([^<]*)<\/title>/i.exec(body)?.[1];
	if (!raw) {
		return null;
	}
	const title = decodeEntities(raw)
		.replace(/\s*[-–—]\s*SCP Foundation\s*$/i, "")
		.trim();
	return title.length > 0 ? title : null;
}

/** The object class ("Euclid") from the "Object Class:" line, when the page
 * uses the classic label form. */
export function parseObjectClass(body: string): string | null {
	const match =
		/<(?:strong|b)>\s*Object Class\s*:?\s*<\/(?:strong|b)>(?:\s|<[^>]+>)*([^<]+)/i.exec(
			body,
		);
	if (!match) {
		return null;
	}
	const value = cleanLine(match[1] ?? "").replace(/[,;]$/, "");
	return value.length > 0 ? value : null;
}

/** The item number ("SCP-173") from the "Item #:" line, when present. */
export function parseItemNumber(body: string): string | null {
	const match =
		/<(?:strong|b)>\s*Item\s*#\s*:?\s*<\/(?:strong|b)>(?:\s|<[^>]+>)*([^<]+)/i.exec(
			body,
		);
	if (!match) {
		return null;
	}
	const value = cleanLine(match[1] ?? "");
	return value.length > 0 ? value : null;
}

/** The page rating from the +/− widget ("+11045" -> 11045). */
export function parseRating(body: string): number | null {
	const match =
		/class="rate-points"[\s\S]{0,200}?class="number[^"]*">\s*([+-]?\d+)\s*</i.exec(
			body,
		);
	if (!match) {
		return null;
	}
	const value = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(value) ? value : null;
}

/** The author credited in the licensebox citation
 * ('"SCP-173" by Moto42, from the SCP Wiki'). */
export function parseLicenseAuthor(body: string): string | null {
	const start = body.search(/<div class="licensebox">/i);
	if (start < 0) {
		return null;
	}
	const tail = body.slice(start);
	const endMatch = /<div class="page-tags">|<div id="page-info"|$/.exec(tail);
	const region = htmlToText(
		tail.slice(0, endMatch ? endMatch.index : tail.length),
	);
	const fromMatch = /"\s*by\s+(.+?),?\s+from\s+the/i.exec(region);
	const name = (fromMatch?.[1] ?? "").trim();
	return name.length > 0 ? name : null;
}

/** Page tags from the page-tags block ("euclid", "horror", ...), without
 * internal system tags (those starting with "_"). */
export function parseTags(body: string, limit = 8): string[] {
	const block = /<div class="page-tags">([\s\S]*?)<\/div>/i.exec(body)?.[1];
	if (!block) {
		return [];
	}
	const tags: string[] = [];
	for (const match of block.matchAll(
		/href="\/system:page-tags\/tag\/([^"]+)"/g,
	)) {
		// Hrefs carry an "#pages" anchor ("/tag/euclid#pages").
		const tag = (decodeEntities(match[1] ?? "").split("#")[0] ?? "").trim();
		if (tag.length === 0 || tag.startsWith("_") || tags.includes(tag)) {
			continue;
		}
		tags.push(tag);
		if (tags.length >= limit) {
			break;
		}
	}
	return tags;
}

/** Best-effort extraction of a content warning block, if the page carries
 * one (class names containing "warning"). */
export function parseContentWarning(region: string): string | null {
	const match =
		/<(?:div|p|span)[^>]*class="[^"]*warning[^"]*"[^>]*>([\s\S]{0,600}?)<\/(?:div|p|span)>/i.exec(
			region,
		);
	if (!match) {
		return null;
	}
	const text = htmlToText(match[1] ?? "");
	return text.length >= 10 ? text : null;
}

const LABELLED_LINE = /^[A-Z0-9][A-Za-z0-9 .'’/-]{0,60}:\s/;

/** Composes the detail description: the "Description:" section text plus up
 * to two following prose paragraphs, prefixed with any content warning.
 * Falls back to the first prose paragraph of the article. */
export function composeDescription(
	paragraphs: SourceParagraph[],
	warning: string | null,
): string {
	const texts = paragraphs.map(paragraphText);
	let description = "";
	const idx = texts.findIndex((text) => /^Description\s*:/i.test(text));
	if (idx >= 0) {
		description = (texts[idx] ?? "").replace(/^Description\s*:\s*/i, "");
		let appended = 0;
		for (let i = idx + 1; i < texts.length && appended < 2; i++) {
			const text = texts[i];
			if (
				!text ||
				text.endsWith(":") ||
				text.includes(" | ") ||
				LABELLED_LINE.test(text)
			) {
				break;
			}
			description = `${description} ${text}`.trim();
			appended += 1;
		}
	} else {
		description =
			texts.find((text) => text.length >= 40 && !text.endsWith(":")) ??
			texts[0] ??
			"";
	}
	const warningPrefix = warning ? `Content warning: ${warning}. ` : "";
	return `${warningPrefix}${description}`.trim();
}
