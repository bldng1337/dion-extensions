// Pure helpers for scraping standardebooks.org. Kept free of the built-in
// `network`/`parse` modules so they can be unit-tested directly with inline
// fixtures. The site marks up its pages with schema.org microdata, which is
// regular enough to parse from the raw document.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://standardebooks.org";
/** The ebook listing caps at 48 items per page (12/24/48 select on the site). */
export const PAGE_SIZE = 48;

export const SORT_SETTING_ID = "standard_ebooks_sort";
export const FORMAT_SETTING_ID = "standard_ebooks_format";
export const FORMAT_COMPATIBLE = "compatible";
export const FORMAT_ADVANCED = "advanced";

export const SORTS: { value: string; label: string }[] = [
	{ value: "default", label: "S.E. release date (new → old)" },
	{ value: "author-alpha", label: "Author name (a → z)" },
	{ value: "reading-ease", label: "Reading ease (easy → hard)" },
	{ value: "length", label: "Length (short → long)" },
	{ value: "popularity", label: "Popularity (most → least)" },
];

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
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	eacute: "é",
	egrave: "è",
	aacute: "á",
	agrave: "à",
	uuml: "ü",
	ouml: "ö",
	auml: "ä",
	ccedil: "ç",
};

/** Decodes the HTML entities Standard Ebooks uses (named + numeric). */
export function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			codepointToString(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			codepointToString(Number.parseInt(dec, 10)),
		)
		.replace(
			/&([a-zA-Z]+);/g,
			(match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
		);
}

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

/** Flattens a snippet of body HTML (the description block) to plain text,
 * keeping paragraph breaks. */
export function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** The entry uid is the book path below /ebooks/, e.g.
 * "jane-austen/pride-and-prejudice" or
 * "thomas-mann/short-fiction/various-translators" for translations. */
export function bookPathToUid(path: string): string | null {
	const trimmed = path
		.trim()
		.replace(/^https?:\/\/standardebooks\.org\//, "/")
		.replace(/^\//, "")
		.replace(/\/+$/, "");
	if (!/^ebooks\/[a-z0-9-]+(\/[a-z0-9-]+){1,2}$/.test(trimmed)) {
		return null;
	}
	return trimmed.slice("ebooks/".length);
}

export function bookUrl(uid: string): string {
	return `${BASE}/ebooks/${uid}`;
}

/** Stable cover image for a book (served from its downloads directory). */
export function coverUrl(uid: string): string {
	return `${bookUrl(uid)}/downloads/cover.jpg`;
}

/**
 * Download filenames mirror the book path with slashes turned into
 * underscores: "/ebooks/jane-austen/pride-and-prejudice" becomes
 * "jane-austen_pride-and-prejudice.epub". Lets `source` construct the
 * compatible-EPUB URL without having seen the book page.
 */
export function fallbackEpubUrl(uid: string): string {
	return `${bookUrl(uid)}/downloads/${uid.replace(/\//g, "_")}.epub?source=download`;
}

/** The plain download URLs redirect through a donation interstitial; the
 * `source=download` query parameter makes the server hand over the file. */
export function withDownloadParam(href: string): string {
	if (href.startsWith("/")) {
		href = `${BASE}${href}`;
	}
	return href.includes("?") ? href : `${href}?source=download`;
}

// ---------------------------------------------------------------------------
// Listing pages (/ebooks, /ebooks?query=…)
// ---------------------------------------------------------------------------

export interface ListedBook {
	uid: string;
	title: string;
	authors: string[];
	translators: string[];
	wordCount: number | null;
	subjects: string[];
}

/** Parses an ebook listing page into its books. The site renders every item
 * as `<li typeof="schema:Book" about="/ebooks/<path>">` inside the
 * `<ol class="ebooks-list">` wrapper (whose items contain nested `<li>`s for
 * subject tags, so chunks can't simply be cut at the first `</li>`). */
export function parseListing(body: string): ListedBook[] {
	const list =
		body.match(/<ol class="ebooks-list[^"]*">([\s\S]*?)<\/ol>/)?.[1] ?? "";
	const books: ListedBook[] = [];
	for (const li of list.split(/<li typeof="schema:Book"/).slice(1)) {
		const uid = bookPathToUid(attr(li.match(/about="([^"]*)"/)));
		if (!uid) {
			continue;
		}
		const title = decodeEntities(
			group(li.match(/<span property="schema:name">([^<]*)<\/span>/)).trim(),
		);
		if (!title) {
			continue;
		}
		const authors = [
			...li.matchAll(/<p class="author">\s*<a[^>]*>([^<]+)<\/a>/g),
		]
			.map((m) => decodeEntities((m[1] ?? "").trim()))
			.filter((a) => a.length > 0);
		const translators = parseTranslatedBy(li);
		const wordCount = Number.parseInt(
			group(li.match(/<p>([\d,]+) words?[ <]/)).replace(/,/g, ""),
			10,
		);
		books.push({
			uid,
			title,
			authors,
			translators,
			wordCount: Number.isFinite(wordCount) ? wordCount : null,
			subjects: parseSubjects(li),
		});
	}
	return books;
}

/** `hasnext` for a listing page: the pagination nav links to every page. */
export function hasNextPage(body: string, page: number): boolean {
	// Dion pages are 0-based, site pages 1-based; links are html-escaped.
	return new RegExp(`[?&]page=${page + 2}(&amp;|&|")`).test(body);
}

/** Groups digits for display: 121970 -> "121,970". */
export function formatCount(n: number): string {
	return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------------------------------
// Book pages (/ebooks/<author>/<book>[/<translator>])
// ---------------------------------------------------------------------------

/** EPUB download candidates found on a book page, as site-relative hrefs. */
export interface EpubCandidates {
	compatible: string | null;
	advanced: string | null;
}

export interface BookInfo {
	uid: string | null;
	title: string;
	authors: string[];
	translators: string[];
	description: string;
	abstract: string;
	language: string;
	wordCount: number | null;
	readingTime: string;
	readingEase: string;
	subjects: string[];
	collections: string[];
	wikipedia: string;
	epub: EpubCandidates;
	azw3: string | null;
	kepub: string | null;
	released: string;
}

/** Parses a per-book page (schema.org microdata) into display data. */
export function parseBookPage(body: string): BookInfo {
	const title = decodeEntities(
		group(body.match(/<h1 property="schema:name">([^<]*)<\/h1>/)).trim(),
	);
	const authors = [
		...body.matchAll(
			/<a property="schema:author"[^>]*>\s*<span property="schema:name">([^<]*)<\/span>/g,
		),
	]
		.map((m) => decodeEntities((m[1] ?? "").trim()))
		.filter((a) => a.length > 0);

	const aside = body.match(/<aside id="reading-ease">([\s\S]*?)<\/aside>/)?.[1];

	const description = stripHtml(
		group(body.match(/<div property="schema:description">([\s\S]*?)<\/div>/)),
	);

	const epub: EpubCandidates = { compatible: null, advanced: null };
	for (const m of body.matchAll(
		/href="(\/ebooks\/[^"]+\/downloads\/[^"]+?\.epub)"/g,
	)) {
		const href = m[1] ?? "";
		if (!href) {
			continue;
		}
		if (href.endsWith("_advanced.epub")) {
			epub.advanced = epub.advanced ?? href;
		} else if (!href.endsWith(".kepub.epub")) {
			epub.compatible = epub.compatible ?? href;
		}
	}

	return {
		uid: bookPathToUid(
			attr(body.match(/<meta property="schema:url" content="([^"]*)"/)),
		),
		title,
		authors,
		translators: aside ? parseTranslatedBy(aside) : [],
		description,
		abstract: decodeEntities(
			(
				body.match(/<meta property="schema:abstract" content="([^"]*)"/)?.[1] ??
				""
			).trim(),
		),
		language:
			body.match(/<meta property="schema:inLanguage" content="([^"]*)"/)?.[1] ??
			"en",
		wordCount: toCount(
			body.match(/<meta property="schema:wordCount" content="(\d+)"/)?.[1],
		),
		readingTime: group((aside ?? "").match(/words \(([^)]+)\)/)),
		readingEase: group(
			(aside ?? "").match(/reading ease of ([0-9.]+ \([^)]+\))/),
		),
		subjects: aside ? parseSubjects(aside) : [],
		collections: [
			...body.matchAll(/<a[^>]*property="schema:isPartOf"[^>]*>([^<]+)<\/a>/g),
		].map((m) => decodeEntities((m[1] ?? "").trim())),
		wikipedia: group(
			body.match(
				/<meta property="schema:sameAs" content="(https:\/\/en\.wikipedia\.org\/[^"]*)"/,
			),
		),
		epub,
		azw3:
			body.match(/href="(\/ebooks\/[^"]+\/downloads\/[^"]+?\.azw3)"/)?.[1] ??
			null,
		kepub:
			body.match(
				/href="(\/ebooks\/[^"]+\/downloads\/[^"]+?\.kepub\.epub)"/,
			)?.[1] ?? null,
		released: group(
			body.match(/<meta property="schema:datePublished" content="([^"]*)"/),
		),
	};
}

// ---------------------------------------------------------------------------
// Episode iddata / format helpers
// ---------------------------------------------------------------------------

/** Parses the EPUB candidates JSON carried in an EpisodeId's `iddata`. */
export function parseEpubCandidates(
	iddata: string | null | undefined,
): EpubCandidates | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<EpubCandidates>;
		return {
			compatible: orNull(parsed.compatible),
			advanced: orNull(parsed.advanced),
		};
	} catch {
		return null;
	}
}

/** Picks the EPUB href matching the preferred format, falling back to
 * whichever variant exists. Returns null when the book has no EPUB. */
export function pickEpubHref(
	candidates: EpubCandidates,
	format: string,
): string | null {
	const first =
		format === FORMAT_ADVANCED ? candidates.advanced : candidates.compatible;
	const second =
		format === FORMAT_ADVANCED ? candidates.compatible : candidates.advanced;
	return first ?? second;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** First capture group of a match, or "". */
function group(match: RegExpMatchArray | null): string {
	return match?.[1] ?? "";
}

function attr(match: RegExpMatchArray | null): string {
	return group(match);
}

function orNull(value: string | null | undefined): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function toCount(raw: string | undefined): number | null {
	const n = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(n) ? n : null;
}

/** Subject tags rendered as `<a href="/subjects/…">Label</a>` list items. */
function parseSubjects(scoped: string): string[] {
	return [...scoped.matchAll(/<a href="\/subjects\/[^"]*">([^<]+)<\/a>/g)]
		.map((m) => decodeEntities((m[1] ?? "").trim()))
		.filter((s) => s.length > 0);
}

/** "Translated by A, B, and C." paragraphs link each translator name. */
function parseTranslatedBy(scoped: string): string[] {
	const inner = scoped.match(/<p>Translated by ([\s\S]*?)<\/p>/)?.[1];
	if (!inner) {
		return [];
	}
	return [...inner.matchAll(/<a[^>]*>([^<]+)<\/a>/g)]
		.map((m) => decodeEntities((m[1] ?? "").trim()))
		.filter((t) => t.length > 0);
}
