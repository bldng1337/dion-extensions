// Pure helpers for talking to Project Gutenberg's OPDS catalog. Kept free of
// the built-in `network`/`parse` modules so it can be unit-tested directly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE = "https://www.gutenberg.org";
// Gutenberg's OPDS feeds return 25 entries per page.
export const PAGE_SIZE = 25;

export const SHELF_SETTING_ID = "gutenberg_shelf";
export const FORMAT_SETTING_ID = "gutenberg_format";
export const EPUB_WITH_IMAGES = "with_images";
export const EPUB_NO_IMAGES = "no_images";

/** Curated subset of https://www.gutenberg.org/ebooks/bookshelf/ */
export const SHELVES: { value: string; label: string }[] = [
	{ value: "popular", label: "Most Popular" },
	{ value: "13", label: "Best Books Ever Listings" },
	{ value: "82", label: "Adventure" },
	{ value: "411", label: "General Fiction" },
	{ value: "412", label: "Romantic Fiction" },
	{ value: "41", label: "Historical Fiction" },
	{ value: "68", label: "Science Fiction" },
	{ value: "403", label: "Science Fiction by Women" },
	{ value: "62", label: "Precursors of Science Fiction" },
	{ value: "36", label: "Fantasy" },
	{ value: "39", label: "Gothic Fiction" },
	{ value: "42", label: "Horror" },
	{ value: "51", label: "Mystery Fiction" },
	{ value: "30", label: "Detective Fiction" },
	{ value: "28", label: "Crime Fiction" },
	{ value: "29", label: "Crime Nonfiction" },
	{ value: "44", label: "Humor" },
	{ value: "77", label: "Western" },
	{ value: "60", label: "Poetry" },
	{ value: "69", label: "Short Stories" },
	{ value: "59", label: "Plays" },
	{ value: "55", label: "One Act Plays" },
	{ value: "56", label: "Opera" },
	{ value: "57", label: "Philosophy" },
	{ value: "52", label: "Mythology" },
	{ value: "37", label: "Folklore" },
	{ value: "216", label: "Children's Myths, Fairy Tales, etc." },
	{ value: "20", label: "Children's Literature" },
	{ value: "18", label: "Children's Fiction" },
	{ value: "17", label: "Children's Book Series" },
	{ value: "22", label: "Children's Picture Books" },
	{ value: "23", label: "Christmas" },
	{ value: "16", label: "Biographies" },
	{ value: "40", label: "Harvard Classics" },
	{ value: "24", label: "Classical Antiquity" },
	{ value: "160", label: "Arthurian Legends" },
	{ value: "58", label: "Pirates, Buccaneers, Corsairs, etc." },
	{ value: "75", label: "Travel" },
	{ value: "80", label: "Women's Travel Journals" },
	{ value: "54", label: "Natural History" },
	{ value: "101", label: "Astronomy" },
	{ value: "102", label: "Mathematics" },
	{ value: "103", label: "Physics" },
	{ value: "64", label: "Psychology" },
	{ value: "134", label: "Sociology" },
	{ value: "48", label: "Medicine" },
	{ value: "50", label: "Music" },
	{ value: "11", label: "Art" },
	{ value: "66", label: "Reference" },
	{ value: "46", label: "Language Education" },
	{ value: "138", label: "Education" },
	{ value: "67", label: "School Stories" },
	{ value: "70", label: "Slavery" },
	{ value: "285", label: "The Journal of Negro History" },
	{ value: "119", label: "Christianity" },
	{ value: "128", label: "Judaism" },
	{ value: "126", label: "Islam" },
	{ value: "125", label: "Hinduism" },
	{ value: "116", label: "Buddhism" },
	{ value: "199", label: "Atheism" },
	{ value: "142", label: "World War I" },
	{ value: "325", label: "World War II" },
	{ value: "141", label: "US Civil War" },
	{ value: "336", label: "Banned Books from Anne Haight's list" },
	{
		value: "422",
		label: "Banned Books List from the American Library Association",
	},
];

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function bookUrl(id: string): string {
	return `${BASE}/ebooks/${id}`;
}

export function coverUrl(id: string): string {
	return `${BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`;
}

// ---------------------------------------------------------------------------
// OPDS parsing helpers
// ---------------------------------------------------------------------------

/** EPUB download candidates for a book: canonical "with images" and
 * "no images" download URLs, null when the feed doesn't offer one. */
export interface EpubCandidates {
	img: string | null;
	noimg: string | null;
}

/** Matches the <id> of book entries in listing feeds, e.g.
 * "https://www.gutenberg.org/ebooks/1342.opds". Non-book subsection entries
 * (subject/bookshelf search hits) don't end in /ebooks/<digits>.opds. */
const BOOK_ID_PATTERN = /\/ebooks\/(\d+)\.opds\/?$/;

/** Extracts the numeric book id from an OPDS entry <id>, or null. */
export function bookUid(idText: string): string | null {
	const match = BOOK_ID_PATTERN.exec(idText.trim());
	return match?.[1] ?? null;
}

/** Value after a "Label:" prefix inside one of the content paragraphs. */
export function prefixedValue(paragraph: string, prefix: string): string {
	return paragraph.slice(prefix.length).trim();
}

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
			img: typeof parsed.img === "string" && parsed.img ? parsed.img : null,
			noimg:
				typeof parsed.noimg === "string" && parsed.noimg ? parsed.noimg : null,
		};
	} catch {
		return null;
	}
}

/** Picks the EPUB URL matching the user's preferred format, falling back to
 * whatever is available. Returns null when the book has no EPUB at all. */
export function pickEpubUrl(
	candidates: EpubCandidates,
	format: string,
): string | null {
	const first = format === EPUB_NO_IMAGES ? candidates.noimg : candidates.img;
	const second = format === EPUB_NO_IMAGES ? candidates.img : candidates.noimg;
	return first ?? second;
}

// ---------------------------------------------------------------------------
// Feed scanning
// ---------------------------------------------------------------------------

/** Extracts the EPUB download candidates offered by a detail feed. Done via
 * pattern matching on the raw body instead of DOM scanning: the runtime's HTML
 * parser does not reliably expose repeated `<link>` elements. The feed's
 * acquisition hrefs are exactly Gutenberg's canonical download URLs, so a hit
 * lets us construct the same URL directly. */
export function epubCandidatesFromFeed(
	body: string,
	uid: string,
): EpubCandidates {
	const hasImages = new RegExp(`/ebooks/${uid}\\.epub3?\\.images`).test(body);
	const hasNoImages = body.includes(`/ebooks/${uid}.epub.noimages`);
	return {
		img: hasImages ? `${BASE}/ebooks/${uid}.epub3.images` : null,
		noimg: hasNoImages ? `${BASE}/ebooks/${uid}.epub.noimages` : null,
	};
}
