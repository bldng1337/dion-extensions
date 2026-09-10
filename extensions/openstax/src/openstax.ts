// Pure helpers for talking to OpenStax's CMS JSON API. Kept free of the
// built-in `network`/`parse` modules so it can be unit-tested directly.
//
// OpenStax's website is a Preact SPA over a Wagtail CMS. The catalog the site
// itself prefetches lives at /apps/cms/api/books/ which redirects (302) to the
// canonical page endpoint /apps/cms/api/v2/pages/30/ — we use the final URL so
// no redirect handling is needed. Per-book detail records come from the Wagtail
// pages API filtered by slug.

import type { Entry } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://openstax.org";

/** Full catalog (the redirect target of the site's `/apps/cms/api/books/`). */
export const CATALOG_URL = `${BASE}/apps/cms/api/v2/pages/30/?format=json`;

/** The catalog is small (~110 books); page it client-side. */
export const PAGE_SIZE = 24;

export const FORMAT_SETTING_ID = "openstax_format";
export const FORMAT_PDF = "pdf";
export const FORMAT_PDF_HIRES = "pdf-hires";
export const FORMAT_EPUB = "epub";

// ---------------------------------------------------------------------------
// Remote data shapes (subset of the fields we consume)
// ---------------------------------------------------------------------------

/** A book record as it appears in the catalog listing. */
export interface CatalogBook {
	slug?: string; // "books/college-physics-2e"
	book_state?: string; // "live" | "retired" | "deprecated"
	title?: string;
	subjects?: string[];
	cover_url?: string;
	pdf_url?: string;
	high_resolution_pdf_url?: string;
}

export interface AuthorBlock {
	type?: string;
	value?: {
		name?: string;
		university?: string;
		country?: string;
		senior_author?: boolean;
	};
}

/** A book record from the pages API detail query (superset of CatalogBook). */
export interface DetailBook extends CatalogBook {
	description?: string; // rich-text HTML
	authors?: AuthorBlock[];
	book_subjects?: { subject_name?: string }[];
	license_name?: string;
	license_version?: string;
	license_url?: string;
	publish_date?: string;
	updated?: string | null;
	digital_isbn_13?: string;
	print_isbn_13?: string;
	webview_rex_link?: string;
	// OpenStax discontinued EPUB downloads; kept so the format setting picks
	// the option up automatically if it ever returns.
	epub_url?: string;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function bookUrl(slug: string): string {
	return `${BASE}/details/books/${slug}`;
}

/** Detail query for one book. The runtime VM has no URL globals, so build the
 * query string with encodeURIComponent. */
export function detailUrl(slug: string): string {
	return (
		`${BASE}/apps/cms/api/v2/pages/?type=books.Book&fields=*&format=json&slug=` +
		encodeURIComponent(slug)
	);
}

// ---------------------------------------------------------------------------
// Slug / state helpers
// ---------------------------------------------------------------------------

/** Catalog slugs are "books/<slug>"; detail slugs are bare "<slug>". Returns
 * the bare slug, or null for missing/foreign slugs. */
export function bookSlug(slug: string | undefined): string | null {
	if (!slug) {
		return null;
	}
	const bare = slug.startsWith("books/") ? slug.slice("books/".length) : slug;
	return bare.length > 0 && !bare.includes("/") ? bare : null;
}

/** Only "live" books are presented; retired editions keep stale links. */
export function isLive(book: CatalogBook): boolean {
	return book.book_state === "live";
}

// ---------------------------------------------------------------------------
// HTML / entity decoding
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	rsquo: "\u2019",
	lsquo: "\u2018",
	rdquo: "\u201d",
	ldquo: "\u201c",
	mdash: "\u2014",
	ndash: "\u2013",
	hellip: "\u2026",
	copy: "\u00a9",
	reg: "\u00ae",
	trade: "\u2122",
	eacute: "\u00e9",
};

/** Decodes the common named entities plus decimal/hex numeric references. */
export function decodeEntities(input: string): string {
	return input
		.replace(/&([a-zA-Z]+);/g, (match, name: string) => {
			const decoded = NAMED_ENTITIES[name.toLowerCase()];
			return decoded ?? match;
		})
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			String.fromCodePoint(Number(dec)),
		);
}

/** Converts CMS rich-text HTML (paragraphs, italics, links) to plain text. */
export function stripHtml(html: string): string {
	const text = html
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n\n")
		.replace(/<[^>]+>/g, "");
	return decodeEntities(text)
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Catalog mapping / filtering
// ---------------------------------------------------------------------------

function compareTitles(a: string, b: string): number {
	const lowerA = a.toLowerCase();
	const lowerB = b.toLowerCase();
	return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : 0;
}

/** Deterministic order regardless of API listing order. */
export function sortBooks<T extends { title?: string }>(books: T[]): T[] {
	return [...books].sort((a, b) => compareTitles(a.title ?? "", b.title ?? ""));
}

/** Maps a live catalog record to an Entry, or null when unusable. */
export function catalogToEntry(book: CatalogBook): Entry | null {
	const slug = bookSlug(book.slug);
	if (!slug || !isLive(book)) {
		return null;
	}
	return {
		id: { uid: slug },
		url: bookUrl(slug),
		title: (book.title ?? "").trim() || slug,
		media_type: "Book",
		cover: book.cover_url ? { url: book.cover_url } : undefined,
	};
}

/** Every whitespace-separated term must occur in the title or a subject. */
export function matchesFilter(
	book: { title?: string; subjects?: string[] },
	query: string,
): boolean {
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);
	if (terms.length === 0) {
		return false;
	}
	const haystack = [book.title ?? "", ...(book.subjects ?? [])]
		.join(" ")
		.toLowerCase();
	return terms.every((t) => haystack.includes(t));
}

/** Slices `items` for a 0-based page; also reports whether more remain. */
export function pageSlice<T>(
	items: T[],
	page: number,
	size: number,
): {
	content: T[];
	hasnext: boolean;
} {
	const start = Math.max(0, page) * size;
	return {
		content: items.slice(start, start + size),
		hasnext: start + size < items.length,
	};
}

// ---------------------------------------------------------------------------
// Download formats
// ---------------------------------------------------------------------------

/** Whole-book download candidates (OpenStax ships single-file textbooks). */
export interface Downloads {
	pdf: string | null;
	hires: string | null;
	epub: string | null;
}

function strOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function downloadsFromBook(book: {
	pdf_url?: string;
	high_resolution_pdf_url?: string;
	epub_url?: string;
}): Downloads {
	const pdf = strOrNull(book.pdf_url);
	const hires = strOrNull(book.high_resolution_pdf_url);
	return {
		pdf: pdf ?? hires,
		hires: hires ?? pdf,
		epub: strOrNull(book.epub_url),
	};
}

/** Parses the Downloads JSON carried in the episode `iddata`. */
export function parseDownloads(
	iddata: string | null | undefined,
): Downloads | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Record<string, unknown>;
		return {
			pdf: strOrNull(parsed.pdf),
			hires: strOrNull(parsed.hires),
			epub: strOrNull(parsed.epub),
		};
	} catch {
		return null;
	}
}

/** Dropdown options for the formats a book actually offers. */
export function formatOptions(downloads: Downloads): {
	value: string;
	label: string;
}[] {
	const options: { value: string; label: string }[] = [];
	if (downloads.pdf || downloads.hires) {
		options.push({ value: FORMAT_PDF, label: "PDF" });
	}
	if (downloads.hires && downloads.pdf && downloads.hires !== downloads.pdf) {
		options.push({
			value: FORMAT_PDF_HIRES,
			label: "PDF (high resolution)",
		});
	}
	if (downloads.epub) {
		options.push({ value: FORMAT_EPUB, label: "EPUB" });
	}
	return options;
}

export interface DownloadPick {
	kind: "pdf" | "epub";
	url: string;
}

/** Resolves the requested format to a URL, falling back to whatever other
 * format is available. Null when the book offers no download at all. */
export function pickDownload(
	downloads: Downloads,
	format: string,
): DownloadPick | null {
	if (format === FORMAT_EPUB && downloads.epub) {
		return { kind: "epub", url: downloads.epub };
	}
	const pdfUrl =
		format === FORMAT_PDF_HIRES
			? (downloads.hires ?? downloads.pdf)
			: (downloads.pdf ?? downloads.hires);
	if (pdfUrl) {
		return { kind: "pdf", url: pdfUrl };
	}
	if (downloads.epub) {
		return { kind: "epub", url: downloads.epub };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Detail field helpers
// ---------------------------------------------------------------------------

export function authorNames(book: { authors?: AuthorBlock[] }): string[] {
	return (book.authors ?? [])
		.map((block) => (block.value?.name ?? "").trim())
		.filter((name) => name.length > 0);
}

export function subjectNames(book: {
	book_subjects?: { subject_name?: string }[];
}): string[] {
	return (book.book_subjects ?? [])
		.map((s) => (s.subject_name ?? "").trim())
		.filter((name) => name.length > 0);
}

/** "2022-07-13T12:13:00-05:00" -> "2022-07-13"; passes through "". */
export function datePart(iso: string | null | undefined): string {
	return typeof iso === "string" ? iso.slice(0, 10) : "";
}

export function licenseLabel(name?: string, version?: string): string {
	const trimmed = (name ?? "").trim();
	const ver = (version ?? "").trim();
	if (!trimmed) {
		return "CC BY-NC-SA 4.0";
	}
	return ver ? `${trimmed} ${ver}` : trimmed;
}

/** Required CC BY-NC-SA attribution line for the detail UI/description. */
export function attributionText(name?: string, version?: string): string {
	return `Content © OpenStax, ${licenseLabel(name, version)}. Attribution required, non-commercial use.`;
}
