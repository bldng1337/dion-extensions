// Pure helpers for scraping globalgreyebooks.com. Kept free of the built-in
// `network`/`parse` modules so they can be unit-tested directly with inline
// fixtures. The site is approximately static: category listing pages carry
// `<article class="book-card">` items, book pages carry schema.org JSON-LD
// plus a download group with direct .epub/.pdf/.azw3 links, and the full
// catalog of book page URLs is available in sitemap.xml.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://www.globalgreyebooks.com";
/** The category grids render 24 book cards per page. */
export const PAGE_SIZE = 24;
/** Maximum author pages fetched to expand one search query. */
export const MAX_AUTHOR_FETCHES = 4;

export const CATEGORY_SETTING_ID = "global_grey_category";
export const FORMAT_SETTING_ID = "global_grey_format";
export const FORMAT_EPUB = "epub";
export const FORMAT_PDF = "pdf";
/** Special browse target for the single-page "recently added" listing. */
export const RECENT_VALUE = "recent";

/** Browse targets: the "Recently Added" page plus every category listed on
 * https://www.globalgreyebooks.com/ebook-categories.html (group: subcategory). */
export const CATEGORIES: { value: string; label: string }[] = [
	{ value: "recent", label: "Recently Added" },
	{ value: "childrens-literature", label: "Childrens Literature (All)" },
	{
		value: "fables-fairy-tales",
		label: "Childrens Literature: Fables & Fairy Tales",
	},
	{ value: "childrens-fiction", label: "Childrens Literature: Fiction" },
	{
		value: "childrens-non-fiction",
		label: "Childrens Literature: Non-Fiction",
	},
	{ value: "drama", label: "Drama (All)" },
	{ value: "drama-ancient", label: "Drama: Ancient" },
	{ value: "drama-general", label: "Drama: General" },
	{ value: "drama-shakespeare", label: "Drama: Shakespeare" },
	{ value: "fiction", label: "Fiction (All)" },
	{ value: "fiction-adventure", label: "Fiction: Adventure" },
	{ value: "fiction-comedy-satire", label: "Fiction: Comedy & Satire" },
	{ value: "fiction-fantasy-scifi", label: "Fiction: Fantasy & Sci-Fi" },
	{ value: "fiction-general", label: "Fiction: General" },
	{ value: "fiction-historical", label: "Fiction: Historical" },
	{ value: "fiction-horror-occult", label: "Fiction: Horror & Occult" },
	{ value: "fiction-mystery-thriller", label: "Fiction: Mystery & Thriller" },
	{ value: "folklore-mythology", label: "Folklore and Mythology (All)" },
	{ value: "folklore", label: "Folklore and Mythology: Folklore" },
	{ value: "mythology", label: "Folklore and Mythology: Mythology" },
	{ value: "history", label: "History (All)" },
	{ value: "history-ancient", label: "History: Ancient" },
	{ value: "history-general", label: "History: General" },
	{ value: "history-medieval", label: "History: Medieval" },
	{ value: "history-modern", label: "History: Modern" },
	{ value: "mystic-texts", label: "Mystic Texts & Mysticism (All)" },
	{
		value: "mysticism-christian",
		label: "Mystic Texts & Mysticism: Christian Mysticism",
	},
	{ value: "mysticism-general", label: "Mystic Texts & Mysticism: General" },
	{
		value: "mysticism-kabbalah",
		label: "Mystic Texts & Mysticism: Jewish Mysticism and Kabbalah",
	},
	{ value: "mysticism-sufism", label: "Mystic Texts & Mysticism: Sufism" },
	{ value: "non-fiction", label: "Non-Fiction (All)" },
	{ value: "articles-essays", label: "Non-Fiction: Articles & Essays" },
	{ value: "autobiographies", label: "Non-Fiction: Autobiographies" },
	{ value: "biographies", label: "Non-Fiction: Biographies" },
	{ value: "memoirs", label: "Non-Fiction: Memoirs" },
	{ value: "science", label: "Non-Fiction: Science" },
	{ value: "travel", label: "Non-Fiction: Travel" },
	{ value: "occult", label: "Occult Teachings and Traditions (All)" },
	{
		value: "occult-general",
		label: "Occult Teachings and Traditions: General",
	},
	{
		value: "hermeticism",
		label: "Occult Teachings and Traditions: Hermeticism",
	},
	{
		value: "magic-grimoires",
		label: "Occult Teachings and Traditions: Magic & Grimoires",
	},
	{
		value: "secret-societies",
		label: "Occult Teachings and Traditions: Secret Societies",
	},
	{ value: "paranormal-mysteries", label: "Paranormal and Mysteries (All)" },
	{ value: "after-life", label: "Paranormal and Mysteries: After-Life" },
	{ value: "aliens-ufos", label: "Paranormal and Mysteries: Aliens & UFOs" },
	{ value: "paranormal-general", label: "Paranormal and Mysteries: General" },
	{ value: "philosophy", label: "Philosophy and Wisdom (All)" },
	{ value: "philosophy-eastern", label: "Philosophy and Wisdom: Eastern" },
	{ value: "philosophy-general", label: "Philosophy and Wisdom: General" },
	{
		value: "philosophy-greco-roman",
		label: "Philosophy and Wisdom: Greco-Roman",
	},
	{ value: "philosophy-theology", label: "Philosophy and Wisdom: Theology" },
	{ value: "poetry", label: "Poetry (All)" },
	{ value: "poetry-general", label: "Poetry: General" },
	{ value: "poetry-epic", label: "Poetry: Epic" },
	{ value: "religion", label: "Religion (All)" },
	{ value: "buddhism", label: "Religion: Buddhism" },
	{ value: "christianity", label: "Religion: Christianity" },
	{ value: "comparative", label: "Religion: Comparative" },
	{ value: "hinduism", label: "Religion: Hinduism" },
	{ value: "islam", label: "Religion: Islam" },
	{ value: "judaism", label: "Religion: Judaism" },
	{ value: "religion-other", label: "Religion: Other" },
	{ value: "self-help", label: "Self-Help and New Thought (All)" },
	{ value: "self-help-general", label: "Self-Help and New Thought: General" },
	{
		value: "self-help-spiritual",
		label: "Self-Help and New Thought: Spiritual",
	},
	{ value: "social-science", label: "Social Science (All)" },
	{
		value: "anthropology-sociology",
		label: "Social Science: Anthropology & Sociology",
	},
	{
		value: "customs-traditions",
		label: "Social Science: Customs & Traditions",
	},
	{
		value: "politics-government",
		label: "Social Science: Society, Politics & Government",
	},
	{ value: "psychology", label: "Social Science: Psychology" },
	{ value: "womens-rights", label: "Social Science: Women's Rights" },
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

/** Decodes the HTML entities Global Grey uses (named + numeric). */
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
// URL / uid helpers
// ---------------------------------------------------------------------------

/** Book pages live at "/<slug>-ebook.html" or "/book-page/<slug>-ebook.html"
 * (both forms exist; each book has exactly one canonical variant). */
const EBOOK_HREF_PATTERN =
	/^(?:https?:\/\/(?:www\.)?globalgreyebooks\.com)?\/((?:book-page\/)?[a-z0-9-]+-ebook)\.html$/;

/** The entry uid is the book page path, e.g. "household-tales-ebook" or
 * "book-page/dukes-children-ebook". Returns null for non-book links. */
export function bookUidFromHref(href: string): string | null {
	const match = EBOOK_HREF_PATTERN.exec(href.trim());
	return match?.[1] ?? null;
}

export function bookUrl(uid: string): string {
	return `${BASE}/${uid}.html`;
}

/** Makes a site href absolute (the site marks most hrefs absolute already). */
export function absoluteUrl(href: string): string {
	return href.startsWith("/") ? `${BASE}${href}` : href;
}

/** Best-effort display title derived from a book uid slug. detail() replaces
 * this with the real title from the book page. */
export function slugTitle(uid: string): string {
	const last = uid.split("/").pop() ?? uid;
	const base = last.endsWith("-ebook") ? last.slice(0, -"-ebook".length) : last;
	return base
		.split("-")
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

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
// Listing pages (category grids, author pages, recently added)
// ---------------------------------------------------------------------------

export interface BookCard {
	uid: string;
	title: string;
	author: string;
	cover: string | null;
}

/** Parses a book grid (category page, author page, recently added) into its
 * book cards. Cards are `<article class="book-card">` elements with a cover
 * link, an `<h2 class="book-title">` link and an optional author paragraph. */
export function parseBookCards(body: string): BookCard[] {
	const cards: BookCard[] = [];
	for (const chunk of body.split('<article class="book-card">').slice(1)) {
		const href = chunk.match(/href="([^"]+)"/)?.[1] ?? "";
		const uid = bookUidFromHref(href);
		if (!uid) {
			continue;
		}
		const title = decodeEntities(
			(
				chunk.match(/<h2 class="book-title">\s*<a[^>]*>([^<]*)<\/a>/)?.[1] ?? ""
			).trim(),
		);
		cards.push({
			uid,
			title: title || slugTitle(uid),
			author: decodeEntities(
				(chunk.match(/<p class="book-author">([^<]*)<\/p>/)?.[1] ?? "").trim(),
			),
			cover: chunk.match(/<img src="([^"]+)"/)?.[1]?.trim() || null,
		});
	}
	return cards;
}

/** `hasnext` for a category page: the pager nav links to every page of the
 * category, so page N+1's link appears in page N's body. Dion pages are
 * 0-based, site pages 1-based. */
export function hasNextPage(body: string, page: number): boolean {
	return body.includes(`-page-${page + 2}.html`);
}

// ---------------------------------------------------------------------------
// Catalog sources for search (sitemap + authors index)
// ---------------------------------------------------------------------------

/** Extracts every book page uid from sitemap.xml, deduplicated. The site has
 * no server-side search (only a Google form), so the sitemap doubles as the
 * title index; authors are indexed via the authors page. */
export function parseSitemap(xml: string): string[] {
	const uids: string[] = [];
	const seen = new Set<string>();
	for (const match of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
		const uid = bookUidFromHref((match[1] ?? "").trim());
		if (uid && !seen.has(uid)) {
			seen.add(uid);
			uids.push(uid);
		}
	}
	return uids;
}

export interface AuthorLink {
	name: string;
	href: string;
}

/** True when the href points at an author page listing that author's books. */
export function isAuthorPageHref(href: string): boolean {
	return /-books\.html$/.test(href);
}

/** Parses the authors index into { name, href } pairs. Multi-book authors
 * link "-books.html" pages; single-book authors link their ebook page
 * directly. Navigation/footer list items don't match either shape. */
export function parseAuthorList(body: string): AuthorLink[] {
	const authors: AuthorLink[] = [];
	for (const match of body.matchAll(
		/<li[^>]*>\s*<a href="([^"]+)">([^<]*)<\/a>\s*<\/li>/g,
	)) {
		const href = (match[1] ?? "").trim();
		const name = decodeEntities((match[2] ?? "").trim());
		if (!name || !href) {
			continue;
		}
		if (isAuthorPageHref(href) || bookUidFromHref(href) !== null) {
			authors.push({ name, href });
		}
	}
	return authors;
}

// ---------------------------------------------------------------------------
// Book pages
// ---------------------------------------------------------------------------

export interface BookDownloads {
	epub: string | null;
	pdf: string | null;
	azw3: string | null;
}

export interface BookInfo {
	title: string;
	author: string | null;
	year: string;
	language: string;
	description: string;
	genres: string[];
	cover: string | null;
	pages: number | null;
	series: string;
	translator: string;
	wikipedia: string;
	downloads: BookDownloads;
}

/** Direct download links from the download group of a book page. */
export function parseDownloads(body: string): BookDownloads {
	const scope =
		body.match(/<div class="download-group">([\s\S]*?)<\/div>/)?.[1] ?? body;
	return {
		epub: downloadHref(scope, "epub"),
		pdf: downloadHref(scope, "pdf"),
		azw3: downloadHref(scope, "azw3"),
	};
}

function downloadHref(scope: string, ext: string): string | null {
	const href = scope.match(new RegExp(`href="([^"]+\\.${ext})"`))?.[1];
	return href ? absoluteUrl(href) : null;
}

/** Parses a book page. Prefers the schema.org JSON-LD block the site embeds
 * in every book page; falls back to Dublin Core / Open Graph meta tags and
 * heading markup for robustness. */
export function parseBookPage(body: string): BookInfo {
	const ld = jsonLd(body);
	const title =
		str(ld?.name) ||
		decodeEntities(
			(
				body.match(/<h1[^>]*class="book-title">([\s\S]*?)<\/h1>/)?.[1] ?? ""
			).trim(),
		) ||
		metaContent(body, "dc.title");

	const seriesPart = partOf(ld);
	return {
		title,
		author: personNames(ld?.author)[0] ?? (metaContent(body, "author") || null),
		year: str(ld?.datePublished) || metaContent(body, "dc.date"),
		language: str(ld?.inLanguage) || metaContent(body, "dc.language") || "en",
		description:
			stripHtml(
				body.match(/<div class="prose">([\s\S]*?)<\/div>/)?.[1] ?? "",
			) ||
			str(ld?.description) ||
			metaProperty(body, "og:description"),
		genres: strList(ld?.genre),
		cover:
			str(ld?.thumbnailUrl) ||
			str(ld?.image) ||
			metaProperty(body, "og:image") ||
			null,
		pages: toCount(ld?.numberOfPages),
		series: seriesPart,
		translator: personNames(ld?.translator)[0] ?? "",
		wikipedia:
			strList(ld?.sameAs).find((url) =>
				url.startsWith("https://en.wikipedia.org/"),
			) ?? "",
		downloads: parseDownloads(body),
	};
}

/** The JSON-LD block of a book page, or null when missing/malformed. */
function jsonLd(body: string): Record<string, unknown> | null {
	const raw = body.match(
		/<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
	)?.[1];
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** First capture group of `<meta name="..." content="...">`, or "". */
function metaContent(body: string, name: string): string {
	return decodeEntities(
		(
			body.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ??
			""
		).trim(),
	);
}

/** First capture group of `<meta property="..." content="...">`, or "". */
function metaProperty(body: string, property: string): string {
	return decodeEntities(
		(
			body.match(
				new RegExp(`<meta property="${property}" content="([^"]*)"`),
			)?.[1] ?? ""
		).trim(),
	);
}

/** A JSON-LD value as a trimmed string ("" when absent). */
function str(value: unknown): string {
	if (typeof value === "string") {
		return value.trim();
	}
	if (typeof value === "number") {
		return String(value);
	}
	return "";
}

/** A JSON-LD value as a list of non-empty strings. */
function strList(value: unknown): string[] {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	if (Array.isArray(value)) {
		return value.map((v) => str(v)).filter((s) => s.length > 0);
	}
	return [];
}

/** Person names from a JSON-LD author/translator value, which may be a
 * string, a Person object, or an array of either. */
function personNames(value: unknown): string[] {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((v) => personNames(v));
	}
	if (typeof value === "object" && value !== null) {
		return personNames((value as Record<string, unknown>).name);
	}
	return [];
}

/** Series label from the JSON-LD "isPartOf" BookSeries, e.g. "Palliser #6". */
function partOf(ld: Record<string, unknown> | null): string {
	const value = ld?.isPartOf;
	if (typeof value !== "object" || value === null) {
		return "";
	}
	const record = value as Record<string, unknown>;
	const name = str(record.name);
	if (!name) {
		return "";
	}
	const position = str(record.position);
	return position ? `${name} #${position}` : name;
}

function toCount(value: unknown): number | null {
	const n = Number.parseInt(str(value), 10);
	return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Episode iddata / format helpers
// ---------------------------------------------------------------------------

/** The download candidates carried in an EpisodeId's `iddata` (the formats
 * the Dion runtime can consume; azw3 is linked from the entry UI instead). */
export interface DownloadCandidates {
	epub: string | null;
	pdf: string | null;
}

/** Parses the download candidates JSON carried in an EpisodeId's `iddata`. */
export function parseDownloadCandidates(
	iddata: string | null | undefined,
): DownloadCandidates | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<DownloadCandidates>;
		return {
			epub: orNull(parsed.epub),
			pdf: orNull(parsed.pdf),
		};
	} catch {
		return null;
	}
}

/** Picks the download matching the user's preferred format, falling back to
 * whichever variant exists. Returns null when the book has neither. */
export function pickDownload(
	candidates: DownloadCandidates,
	format: string,
): { url: string; type: "Epub" | "Pdf" } | null {
	const first = format === FORMAT_PDF ? candidates.pdf : candidates.epub;
	const second = format === FORMAT_PDF ? candidates.epub : candidates.pdf;
	const url = first ?? second;
	if (!url) {
		return null;
	}
	return { url, type: url === candidates.epub ? "Epub" : "Pdf" };
}

function orNull(value: string | null | undefined): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
