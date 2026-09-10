// Pure helpers for the Internet Archive Books & Texts extension. Kept free
// of the built-in `network`/`parse` modules so they can be unit-tested
// directly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

export const COLLECTION_SETTING_ID = "ia_books_collection";
export const LANGUAGE_SETTING_ID = "ia_books_language";
export const SORT_SETTING_ID = "ia_books_sort";
export const FORMAT_SETTING_ID = "ia_books_format";

export const FORMAT_EPUB = "epub";
export const FORMAT_PDF = "pdf";

/** Curated openly accessible collections inside archive.org's texts. */
export const COLLECTIONS: { value: string; label: string }[] = [
	{ value: "all", label: "All openly downloadable texts" },
	{ value: "americana", label: "Americana" },
	{ value: "toronto", label: "University of Toronto" },
	{ value: "gutenberg", label: "Project Gutenberg mirrors" },
	{ value: "medicalheritagelibrary", label: "Medical Heritage Library" },
	{ value: "library_of_congress", label: "Library of Congress" },
];

/** archive.org language field codes (MARC). */
export const LANGUAGES: { value: string; label: string }[] = [
	{ value: "all", label: "Any language" },
	{ value: "eng", label: "English" },
	{ value: "fre", label: "French" },
	{ value: "ger", label: "German" },
	{ value: "spa", label: "Spanish" },
	{ value: "ita", label: "Italian" },
];

/** Sort clauses accepted by the advancedsearch API (verified to work). */
export const SORTS: { value: string; label: string }[] = [
	{ value: "downloads desc", label: "Most downloaded" },
	{ value: "addeddate desc", label: "Recently added" },
	{ value: "year desc", label: "Newest publications" },
	{ value: "year asc", label: "Oldest publications" },
];

/** Options for the per-entry format dropdown. */
export const FILE_FORMAT_OPTIONS: { value: string; label: string }[] = [
	{ value: FORMAT_EPUB, label: "EPUB" },
	{ value: FORMAT_PDF, label: "PDF" },
];

// ---------------------------------------------------------------------------
// URL / query helpers
// ---------------------------------------------------------------------------

/**
 * archive.org advancedsearch expects a field query like `title:(foo bar)`;
 * strip characters that have query-syntax meaning so user input can't break
 * out of the group.
 */
export function sanitizeQueryTerm(filter: string): string {
	return filter.replace(/["()[\]{}:]/g, " ").trim();
}

/**
 * Builds the advancedsearch `q` string. Always restricted to openly
 * downloadable texts: a direct EPUB or "Text PDF" derivative and no
 * `access-restricted-item` flag (which marks lending/print-disabled items).
 */
export function buildQuery(options: {
	collection?: string;
	language?: string;
	term?: string;
}): string {
	const clauses = [
		"mediatype:texts",
		'format:("Text PDF" OR EPUB)',
		"-access-restricted-item:true",
	];
	if (options.collection && options.collection !== "all") {
		clauses.push(`collection:${options.collection}`);
	}
	if (options.language && options.language !== "all") {
		clauses.push(`language:${options.language}`);
	}
	const term =
		options.term === undefined ? "" : sanitizeQueryTerm(options.term);
	if (term.length > 0) {
		clauses.push(`(title:(${term}) OR creator:(${term}))`);
	}
	return clauses.join(" AND ");
}

/** The runtime VM ships no URL globals, so encode query strings by hand. */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

export function detailsUrl(identifier: string): string {
	return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

export function coverUrl(identifier: string): string {
	return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

export function fileUrl(identifier: string, name: string): string {
	return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

/**
 * First non-empty string of a metadata field. archive.org returns most
 * fields as a string, but occasionally as an array (or a number), and the
 * raw metadata is typed as a bag of unknowns.
 */
export function firstString(value: unknown): string | undefined {
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string") {
		return value.length > 0 ? value : undefined;
	}
	if (Array.isArray(value)) {
		const first = value.find((v) => typeof v === "string" && v.length > 0);
		return first as string | undefined;
	}
	return undefined;
}

/** All non-empty strings of a metadata field, whatever shape it arrives in. */
export function stringList(value: unknown): string[] {
	return [value]
		.flat()
		.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Lending/print-disabled items carry `access-restricted-item` in their
 * metadata; their only PDF derivative is an encrypted LCP file. */
export function isRestricted(
	metadata: Record<string, unknown> | undefined | null,
): boolean {
	const flag = metadata?.["access-restricted-item"];
	return flag === true || flag === "true";
}

/** Publication year: prefer the indexed `year`, fall back to `date`'s year. */
export function publicationYear(
	metadata: Record<string, unknown> | undefined | null,
): string | undefined {
	const year = metadata?.year;
	if (typeof year === "number") {
		return String(year);
	}
	if (typeof year === "string" && year.length > 0) {
		return year;
	}
	const date = metadata?.date;
	if (typeof date === "string") {
		const match = /^\d{4}/.exec(date.trim());
		if (match) {
			return match[0];
		}
	}
	return undefined;
}

/** Strip HTML tags and decode the entities archive.org descriptions use. */
export function stripHtml(html: string): string {
	const text = html
		.replace(/<br\s*\/?>/gi, "\n\n")
		.replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&hellip;/gi, "…")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		);
	return text
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Normalizes an archive.org description: the field can be missing, a plain
 * string, an array of paragraphs or a blob of HTML. Very long descriptions
 * (some run to tens of thousands of characters) are trimmed at a sentence or
 * paragraph boundary.
 */
export function normalizeDescription(
	description: unknown,
	maxLength = 1200,
): string {
	let raw: string;
	if (typeof description === "string") {
		raw = description;
	} else if (Array.isArray(description)) {
		raw = description
			.map((part) => (typeof part === "string" ? part : ""))
			.join("\n\n");
	} else {
		raw = "";
	}
	const text = stripHtml(raw);
	if (text.length <= maxLength) {
		return text;
	}
	const cut = text.slice(0, maxLength);
	const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
	const keep = lastBreak > maxLength * 0.5 ? lastBreak : maxLength;
	return `${cut.slice(0, keep).trim()} […]`;
}

// ---------------------------------------------------------------------------
// Downloadable file picking
// ---------------------------------------------------------------------------

/** The openly downloadable book files an item exposes. */
export interface DownloadableFiles {
	epub: string | null;
	pdf: string | null;
}

/** Subset of archive.org metadata `files[]` entries we care about. */
export interface IaFileEntry {
	name?: string;
	format?: string;
}

/**
 * Picks the EPUB and "Text PDF" derivative file names from an item's files[]
 * array. Encrypted derivatives ("LCP Encrypted PDF" etc.) and files without a
 * name are ignored, so only direct downloads are ever surfaced.
 */
export function pickFiles(
	files: IaFileEntry[] | undefined | null,
): DownloadableFiles {
	let epub: string | null = null;
	let pdf: string | null = null;
	for (const file of files ?? []) {
		const name = typeof file?.name === "string" ? file.name : "";
		if (name.length === 0) {
			continue;
		}
		const format = (file?.format ?? "").toUpperCase();
		if (epub === null && format === "EPUB") {
			epub = name;
		} else if (pdf === null && format === "TEXT PDF") {
			pdf = name;
		}
	}
	return { epub, pdf };
}

/** Parses the download candidates JSON carried in an EpisodeId's `iddata`. */
export function parseFiles(
	iddata: string | null | undefined,
): DownloadableFiles | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<DownloadableFiles>;
		return {
			epub: typeof parsed.epub === "string" && parsed.epub ? parsed.epub : null,
			pdf: typeof parsed.pdf === "string" && parsed.pdf ? parsed.pdf : null,
		};
	} catch {
		return null;
	}
}

/** Serializes download candidates into an EpisodeId's `iddata`. */
export function serializeFiles(files: DownloadableFiles): string {
	return JSON.stringify(files);
}

/**
 * Resolves the per-entry format setting (EPUB preferred, PDF fallback) into
 * the concrete source type and file name, falling back to whichever format
 * is available. Returns null when the item has neither file.
 */
export function pickSource(
	candidates: DownloadableFiles,
	format: string,
): { type: "Epub" | "Pdf"; name: string } | null {
	const wantEpub = format !== FORMAT_PDF;
	const primary = wantEpub ? candidates.epub : candidates.pdf;
	const fallback = wantEpub ? candidates.pdf : candidates.epub;
	if (primary !== null) {
		return { type: wantEpub ? "Epub" : "Pdf", name: primary };
	}
	if (fallback !== null) {
		return { type: wantEpub ? "Pdf" : "Epub", name: fallback };
	}
	return null;
}
