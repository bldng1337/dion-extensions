// Pure helpers for the Digital Comic Museum extension. Kept free of the
// built-in `network`/`parse` modules so they can be unit-tested directly
// with inline fixtures.
//
// digitalcomicmuseum.com itself serves its pages and downloads behind a
// Cloudflare JS challenge and gates downloads behind a free account, so a
// plain HTTP client cannot read it. Instead this extension reads the open
// Internet Archive mirrors: items that credit the Digital Comic Museum in
// their indexed metadata ("digital comic museum" / "digital comics museum")
// and expose either individual page images (JPEG scans) or a PDF derivative
// (Text PDF / Image Container PDF / Additional Text PDF). Items that only
// carry a CBZ/CBR archive are rejected, because the Dion runtime cannot
// unpack archives.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

export const SEARCH_URL = "https://archive.org/advancedsearch.php";
export const METADATA_URL = "https://archive.org/metadata/";
export const DCM_URL = "https://digitalcomicmuseum.com/";

/** Sort used while browsing; search leaves the order to IA relevance. */
export const BROWSE_SORT = "downloads desc";

export const SEARCH_FIELDS = ["identifier", "title", "creator", "year"];

/**
 * Marks items that credit the Digital Comic Museum. The advancedsearch
 * default field covers description/subject/creator, which is where mirror
 * uploads name the museum.
 */
export const CREDIT_CLAUSE =
	'("digital comic museum" OR "digital comics museum")';

/**
 * Restricts results to items the extension can actually read: page-image
 * items (mediatype:image) or texts items with a PDF derivative. CBZ-only
 * mirror items are excluded up front.
 */
export const READABLE_CLAUSE =
	'(mediatype:image OR format:"Text PDF" OR format:"Image Container PDF" OR format:"Additional Text PDF")';

// ---------------------------------------------------------------------------
// Query / URL helpers
// ---------------------------------------------------------------------------

/**
 * advancedsearch expects a field query like `title:(foo bar)`; strip
 * characters that have query-syntax meaning so user input cannot break out
 * of the group.
 */
export function sanitizeQueryTerm(term: string): string {
	return term.replace(/["()[\]{}:]/g, " ").trim();
}

/** The advancedsearch `q` value; `term` narrows the mirror set by title. */
export function buildSearchQuery(term?: string): string {
	const clauses = [CREDIT_CLAUSE, READABLE_CLAUSE];
	const cleaned = term === undefined ? "" : sanitizeQueryTerm(term);
	if (cleaned.length > 0) {
		clauses.push(`title:(${cleaned})`);
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

/**
 * advancedsearch listing URL. Dion pages are 0-based, IA pages are 1-based.
 * Browse (term === undefined) sorts by downloads; search omits `sort` so IA
 * ranks by relevance.
 */
export function searchUrl(page: number, term?: string): string {
	const pairs: [string, string][] = [
		["q", buildSearchQuery(term)],
		["rows", String(PAGE_SIZE)],
	];
	if (term === undefined) {
		pairs.push(["sort", BROWSE_SORT]);
	}
	pairs.push(
		["page", String(Math.max(0, page) + 1)],
		["output", "json"],
		...SEARCH_FIELDS.map((field): [string, string] => ["fl[]", field]),
	);
	return `${SEARCH_URL}?${encodeQuery(pairs)}`;
}

export function metadataUrl(identifier: string): string {
	return `${METADATA_URL}${encodeURIComponent(identifier)}`;
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
};

/** Decodes the HTML entities archive.org metadata uses (named + numeric). */
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

/** Flattens a snippet of description HTML to plain text. */
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

/**
 * Normalizes an archive.org description: the field can be missing, a plain
 * string, an array of paragraphs or a blob of HTML. Overlong descriptions
 * are trimmed at a sentence or paragraph boundary.
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
// Metadata value normalization
// ---------------------------------------------------------------------------

/**
 * First non-empty string of a metadata field. archive.org returns most
 * fields as a string, but occasionally as an array (or a number).
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

// ---------------------------------------------------------------------------
// File picking
// ---------------------------------------------------------------------------

/** Subset of archive.org metadata `files[]` entries we care about. */
export interface IaFileEntry {
	name?: string;
	format?: string;
}

/** The readable files of an item: page image names and/or a PDF derivative. */
export interface ReadableFiles {
	pages: string[];
	pdf: string | null;
}

/** Page images are exact JPEG/PNG scans; "JPEG Thumb" etc. never qualify. */
const PAGE_FORMATS = new Set(["jpeg", "png"]);

export function isPageFile(file: IaFileEntry): boolean {
	const name = typeof file.name === "string" ? file.name : "";
	if (name.length === 0 || name.startsWith("__ia_thumb")) {
		return false;
	}
	if (name.endsWith("_thumb.jpg") || name.endsWith("_thumb.png")) {
		return false;
	}
	return PAGE_FORMATS.has((file.format ?? "").toLowerCase());
}

/**
 * Natural-order comparison for file names so `page_2.jpg` sorts before
 * `page_10.jpg`. Digit runs compare numerically, everything else
 * case-insensitively; digits sort before letters at equal positions.
 */
export function compareNatural(a: string, b: string): number {
	const aParts = a.toLowerCase().match(/\d+|\D+/g) ?? [];
	const bParts = b.toLowerCase().match(/\d+|\D+/g) ?? [];
	const shared = Math.min(aParts.length, bParts.length);
	for (let i = 0; i < shared; i++) {
		const ap = aParts[i] ?? "";
		const bp = bParts[i] ?? "";
		const aDigits = /^\d/.test(ap);
		const bDigits = /^\d/.test(bp);
		if (aDigits && bDigits) {
			const diff = Number(ap) - Number(bp);
			if (diff !== 0) {
				return diff;
			}
		} else if (aDigits !== bDigits) {
			return aDigits ? -1 : 1;
		} else if (ap !== bp) {
			return ap < bp ? -1 : 1;
		}
	}
	return aParts.length - bParts.length;
}

/** The page image file names of an item, naturally sorted. */
export function pickPageFiles(
	files: IaFileEntry[] | undefined | null,
): string[] {
	const names: string[] = [];
	for (const file of files ?? []) {
		const name = typeof file.name === "string" ? file.name : "";
		if (name.length > 0 && isPageFile(file)) {
			names.push(name);
		}
	}
	return names.sort(compareNatural);
}

/** PDF derivatives in preference order (best first). */
const PDF_FORMATS = ["text pdf", "image container pdf", "additional text pdf"];

/** The most readable PDF derivative of an item, or null. */
export function pickPdfFile(
	files: IaFileEntry[] | undefined | null,
): string | null {
	const byFormat = new Map<string, string>();
	for (const file of files ?? []) {
		const name = typeof file.name === "string" ? file.name : "";
		const format = (file.format ?? "").toLowerCase();
		if (name.length > 0 && PDF_FORMATS.includes(format)) {
			byFormat.set(format, name);
		}
	}
	for (const format of PDF_FORMATS) {
		const name = byFormat.get(format);
		if (name !== undefined) {
			return name;
		}
	}
	return null;
}

/** Everything readable in an item; pages win over the PDF when both exist. */
export function pickReadableFiles(
	files: IaFileEntry[] | undefined | null,
): ReadableFiles {
	return { pages: pickPageFiles(files), pdf: pickPdfFile(files) };
}

/** True when an item has nothing the runtime can open (CBZ/CBR-only). */
export function isUnreadable(files: ReadableFiles): boolean {
	return files.pages.length === 0 && files.pdf === null;
}

// ---------------------------------------------------------------------------
// Episode iddata serialization
// ---------------------------------------------------------------------------

/** Parses the readable-files JSON carried in an EpisodeId's `iddata`. */
export function parseReadableFiles(
	iddata: string | null | undefined,
): ReadableFiles | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<ReadableFiles>;
		const pages = Array.isArray(parsed.pages)
			? parsed.pages.filter(
					(name): name is string => typeof name === "string" && name.length > 0,
				)
			: [];
		const pdf =
			typeof parsed.pdf === "string" && parsed.pdf ? parsed.pdf : null;
		return { pages, pdf };
	} catch {
		return null;
	}
}

/** Serializes readable files into an EpisodeId's `iddata`. */
export function serializeReadableFiles(files: ReadableFiles): string {
	return JSON.stringify(files);
}
