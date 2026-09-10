import type { Entry, EntryDetailed } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints & constants
//
// StoryWeaver (storyweaver.org.in, Pratham Books) is a React SPA over a JSON
// API. Two backends share the site origin: a Node service under
// `/node/api/v1` (book catalogue, story metadata) and the older Rails API
// under `/api/v1` (the book reader payload with page images). Every API call
// requires the `_session_id` cookie issued when the homepage is fetched, so
// the extension warms the host cookie jar with one homepage request per
// session before talking to the API.
//
// Verified endpoints:
//   GET /node/api/v1/books-search?page=1&per_page=20&sort=New Arrivals
//       [&query=...&languages[]=English]   -> { ok, metadata, data: Book[] }
//   GET /node/api/v1/stories/<slug|id>     -> { ok, data: StoryDetail }
//   GET /api/v1/stories/<slug|id>/read?story_pages=true
//                                          -> { ok, data: { pages: [...] } }
//
// Page images are plain illustrations (text is overlaid by the web reader,
// nothing is baked in); sizes 1-7 are offered, 7 is the largest. PDF downloads
// require a logged-in account, so only the Imagelist source is provided.
// Content is CC BY 4.0 - attribution is shown in the entry UI.
// ---------------------------------------------------------------------------

export const SITE_URL = "https://storyweaver.org.in/";
export const BOOKS_SEARCH_URL =
	"https://storyweaver.org.in/node/api/v1/books-search";
export const STORY_API_URL = "https://storyweaver.org.in/node/api/v1/stories/";
export const STORY_READ_URL = "https://storyweaver.org.in/api/v1/stories/";

export const PAGE_SIZE = 20;

export const LICENSE_NOTE = "StoryWeaver, Pratham Books, CC BY 4.0.";

/** Browse sort options (server-side `sort` param), value = API value. */
export const SORT_OPTIONS = [
	{ value: "New Arrivals", label: "New Arrivals" },
	{ value: "Most Read", label: "Most Read" },
	{ value: "Most Liked", label: "Most Liked" },
	{ value: "Most Viewed", label: "Most Viewed" },
	{ value: "Editor's Picks", label: "Editor's Picks" },
] as const;

/** Language filter options; `value` is the API's language name. */
export const LANGUAGE_OPTIONS = [
	{ value: "", label: "All languages" },
	{ value: "English", label: "English" },
	{ value: "Hindi", label: "Hindi" },
	{ value: "Marathi", label: "Marathi" },
	{ value: "Tamil", label: "Tamil" },
	{ value: "Spanish", label: "Spanish" },
	{ value: "German", label: "German" },
	{ value: "French", label: "French" },
] as const;

const LANGUAGE_CODES: Record<string, string> = {
	English: "en",
	Hindi: "hi",
	Marathi: "mr",
	Tamil: "ta",
	Spanish: "es",
	German: "de",
	French: "fr",
};

// ---------------------------------------------------------------------------
// Remote data shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface SwImageSize {
	height?: number;
	width?: number;
	url?: string;
}

export interface SwCoverImage {
	sizes?: SwImageSize[];
}

export interface SwPerson {
	name?: string;
	slug?: string;
}

export interface SwPublisher {
	name?: string;
	slug?: string;
}

/** One row of `/node/api/v1/books-search`. */
export interface SwBook {
	id?: number;
	title?: string;
	slug?: string;
	language?: string;
	level?: string;
	description?: string;
	coverImage?: SwCoverImage;
	authors?: SwPerson[];
	illustrators?: SwPerson[];
	publisher?: SwPublisher | null;
	readsCount?: number;
	likesCount?: number;
	recommended?: boolean;
	editorsPick?: boolean;
	isAudio?: boolean;
}

export interface SwBooksSearchMeta {
	hits?: number;
	page?: number;
	perPage?: number;
	totalPages?: number;
}

export interface SwBooksSearchResponse {
	ok?: boolean;
	metadata?: SwBooksSearchMeta;
	data?: SwBook[];
}

/** `/node/api/v1/stories/<slug|id>`. */
export interface SwStoryDetail {
	id?: number;
	name?: string;
	slug?: string;
	language?: string;
	level?: string;
	description?: string;
	copyrightNotice?: string;
	publishedDate?: string;
	orientation?: string;
	authors?: SwPerson[];
	illustrators?: SwPerson[];
	publisher?: SwPublisher | null;
	readsCount?: number;
	likesCount?: number;
	isAudio?: boolean;
	status?: string;
	coverImage?: SwCoverImage;
}

export interface SwStoryDetailResponse {
	ok?: boolean;
	data?: SwStoryDetail;
}

/** One page of `/api/v1/stories/<slug|id>/read?story_pages=true`. */
export interface SwReaderPage {
	pageId?: number;
	/** sic: the API really spells it without the "o". */
	pagePostion?: number;
	pageType?: string;
	isLastStoryPage?: boolean;
	coverImage?: SwCoverImage;
}

export interface SwReaderData {
	slug?: string;
	language?: string;
	level?: string;
	orientation?: string;
	pages?: SwReaderPage[];
}

export interface SwReaderResponse {
	ok?: boolean;
	data?: SwReaderData;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Decode the HTML entities the API leaves in titles and descriptions. */
export function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&hellip;/gi, "…")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		);
}

/** Collapse runs of whitespace left behind by entity decoding. */
export function cleanText(text: string | undefined): string {
	return decodeEntities(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Canonical site page for one story. */
export function storyPageUrl(slug: string): string {
	return `https://storyweaver.org.in/stories/${slug}`;
}

/** Catalogue URL (`books-search`); `language` is the API's language name. */
export function booksSearchUrl(opts: {
	page: number;
	query?: string;
	sort?: string;
	language?: string;
	perPage?: number;
}): string {
	const params: [string, string][] = [
		["page", String(Math.max(1, opts.page))],
		["per_page", String(opts.perPage ?? PAGE_SIZE)],
	];
	if (opts.query !== undefined && opts.query.length > 0) {
		params.push(["query", opts.query]);
	}
	if (opts.sort !== undefined && opts.sort.length > 0) {
		params.push(["sort", opts.sort]);
	}
	if (opts.language !== undefined && opts.language.length > 0) {
		params.push(["languages[]", opts.language]);
	}
	return `${BOOKS_SEARCH_URL}?${params
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&")}`;
}

/** Story metadata endpoint; accepts the slug or the numeric id. */
export function storyApiUrl(slug: string): string {
	return `${STORY_API_URL}${encodeURIComponent(slug)}`;
}

/** Reader payload with page images; accepts the slug or the numeric id. */
export function storyReadUrl(slug: string): string {
	return `${STORY_READ_URL}${encodeURIComponent(slug)}/read?story_pages=true`;
}

/**
 * Largest available rendition of a cover/page image; the API lists sizes
 * smallest-first, but don't trust the order - measure.
 */
export function bestImageUrl(
	cover: SwCoverImage | undefined,
): string | undefined {
	let best: string | undefined;
	let bestArea = -1;
	for (const size of cover?.sizes ?? []) {
		const url = size.url ?? "";
		if (url.length === 0) {
			continue;
		}
		const area = (size.width ?? 0) * (size.height ?? 0);
		if (area > bestArea) {
			bestArea = area;
			best = url;
		}
	}
	return best;
}

/** Person names ("Kiran Kasturia"), skipping blank entries. */
export function personNames(people: SwPerson[] | undefined): string[] {
	return (people ?? [])
		.map((person) => cleanText(person.name))
		.filter((name) => name.length > 0);
}

/** ISO code for the languages offered in the filter, else the raw name. */
export function languageCode(language: string | undefined): string {
	const key = cleanText(language);
	return LANGUAGE_CODES[key] ?? key;
}

/** "18-06-2015" (DD-MM-YYYY) -> "2015-06-18"; undefined when unparsable. */
export function parsePublishedDate(
	raw: string | undefined,
): string | undefined {
	const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw ?? "");
	const [, day, month, year] = match ?? [];
	if (!day || !month || !year) {
		return undefined;
	}
	const pad = (n: string) => n.padStart(2, "0");
	return `${year}-${pad(month)}-${pad(day)}`;
}

/** Compact human count like "406.8k" for the detail meta table. */
export function humanCount(count: number | undefined): string | undefined {
	if (count === undefined || !Number.isFinite(count) || count < 0) {
		return undefined;
	}
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
	}
	return String(Math.round(count));
}

/** Entry id: prefer the slug, fall back to the numeric id. */
export function bookUid(book: SwBook): string | null {
	const slug = cleanText(book.slug);
	if (slug.length > 0) {
		return slug;
	}
	if (typeof book.id === "number" && Number.isInteger(book.id) && book.id > 0) {
		return String(book.id);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** One browse row per book; null when the payload has no usable id. */
export function bookToEntry(book: SwBook): Entry | null {
	const uid = bookUid(book);
	if (!uid) {
		return null;
	}
	const title = cleanText(book.title);
	if (title.length === 0) {
		return null;
	}
	const cover = bestImageUrl(book.coverImage);
	const author = personNames(book.authors);
	return {
		id: { uid },
		url: storyPageUrl(uid),
		title,
		media_type: "Comic",
		cover: cover ? { url: cover } : undefined,
		author: author.length > 0 ? author : undefined,
	};
}

/** Map a batch of books to entries, skipping unusable documents. */
export function booksToEntries(books: SwBook[]): Entry[] {
	const entries: Entry[] = [];
	for (const book of books) {
		const entry = bookToEntry(book);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * Reading order for the reader payload: sort pages by `pagePostion` (sic),
 * cut everything after the last story page (trailing attribution/license
 * pages), and keep only pages that actually have an illustration.
 */
export function orderReaderPages(pages: SwReaderPage[]): SwReaderPage[] {
	const ordered = [...pages].sort((a, b) => {
		const pa = a.pagePostion ?? Number.MAX_SAFE_INTEGER;
		const pb = b.pagePostion ?? Number.MAX_SAFE_INTEGER;
		if (pa !== pb) {
			return pa - pb;
		}
		return (a.pageId ?? 0) - (b.pageId ?? 0);
	});
	const lastStoryIndex = ordered.findIndex(
		(page) => page.isLastStoryPage === true,
	);
	const storyPages =
		lastStoryIndex >= 0 ? ordered.slice(0, lastStoryIndex + 1) : ordered;
	return storyPages.filter(
		(page) => bestImageUrl(page.coverImage) !== undefined,
	);
}

/** Page image URLs in reading order. */
export function readerPageUrls(pages: SwReaderPage[]): string[] {
	const urls: string[] = [];
	for (const page of orderReaderPages(pages)) {
		const url = bestImageUrl(page.coverImage);
		if (url) {
			urls.push(url);
		}
	}
	return urls;
}

/** Base detail view (without custom UI); null when the payload is unusable. */
export function storyToDetail(
	story: SwStoryDetail,
	uid: string,
): EntryDetailed | null {
	const title = cleanText(story.name);
	if (title.length === 0) {
		return null;
	}
	const slug = cleanText(story.slug) || uid;
	const url = storyPageUrl(slug);
	const author = personNames(story.authors);
	const cover = bestImageUrl(story.coverImage);
	const published = parsePublishedDate(story.publishedDate);
	const meta: Record<string, string> = {};
	const level = cleanText(story.level);
	if (level.length > 0) {
		meta.Level = `Level ${level}`;
	}
	const publisher = cleanText(story.publisher?.name);
	if (publisher.length > 0) {
		meta.Publisher = publisher;
	}
	if (published) {
		meta.Published = published;
	}
	const reads = humanCount(story.readsCount);
	if (reads) {
		meta.Reads = reads;
	}
	const likes = humanCount(story.likesCount);
	if (likes) {
		meta.Likes = likes;
	}
	const description = cleanText(story.description);
	return {
		id: { uid },
		url,
		titles: [title],
		author: author.length > 0 ? author : undefined,
		media_type: "Comic",
		status: "Complete",
		description,
		language: languageCode(story.language),
		cover: cover ? { url: cover } : undefined,
		poster: cover ? { url: cover } : undefined,
		episodes: [
			{
				id: { uid: slug },
				name: "Read",
				url,
			},
		],
		meta: Object.keys(meta).length > 0 ? meta : null,
	};
}
