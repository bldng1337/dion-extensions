import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	EntryDetailedResult,
	EntryDetailed,
	EntryId,
	EntryList,
	Entry,
	Episode,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";

// ---------------------------------------------------------------------------
// Endpoints
//
// LibriVox's own JSON API powers the book metadata (title/description/authors
// and the per-book RSS feed with chapter enclosures). The API has no free-text
// search (its `title` param is exact-match only), so browse and search go
// through archive.org's advancedsearch API over the `librivoxaudio` collection
// instead. Every archive.org item carries a `call_number` field holding the
// LibriVox book id, which lets us hand the canonical id to the LibriVox API.
// ---------------------------------------------------------------------------

const API_URL = "https://librivox.org/api/feed/audiobooks/";
const RSS_URL = "https://librivox.org/rss/";
const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_URL = "https://archive.org/metadata/";

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Remote data shapes
// ---------------------------------------------------------------------------

interface LibrivoxAuthor {
	first_name?: string;
	last_name?: string;
}

interface LibriVoxBook {
	id: string;
	title: string;
	description?: string;
	url_text_source?: string;
	language?: string;
	copyright_year?: string;
	num_sections?: string;
	url_rss?: string;
	url_zip_file?: string;
	url_librivox?: string;
	totaltime?: string;
	totaltimesecs?: number;
	authors?: LibrivoxAuthor[];
}

interface IaSearchDoc {
	identifier: string;
	title?: string;
	creator?: string | string[];
	call_number?: string | string[];
	year?: string | number;
}

interface IaSearchResponse {
	response?: {
		numFound?: number;
		docs?: IaSearchDoc[];
	};
}

interface IaMetadataResponse {
	metadata?: {
		call_number?: string | string[];
	};
}

interface RssChapter {
	title: string;
	url: string;
	duration: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode the entities LibriVox descriptions use. */
function stripHtml(html: string): string {
	const text = html
		.replace(/<br\s*\/?>/gi, "\n\n")
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
	return text.replace(/\n{3,}/g, "\n\n").trim();
}

function formatSeconds(total: number): string {
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = Math.round(total % 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Compact human runtime like "1h 12m" for the detail meta table. */
function humanRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.round((totalSeconds % 3600) / 60);
	if (h <= 0) {
		return `${m}m`;
	}
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Normalize itunes:duration values ("00:08:26", "8:26", "506") to m:ss / h:mm:ss. */
function normalizeDuration(raw: string): string {
	const value = raw.trim();
	if (/^\d+$/.test(value)) {
		return formatSeconds(Number(value));
	}
	return formatSeconds(
		value
			.split(":")
			.reverse()
			.reduce((acc, part, i) => acc + Number(part) * 60 ** i, 0),
	);
}

function authorName(a: LibrivoxAuthor): string {
	return `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
}

function firstString(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) {
		return value.find((v) => v.length > 0);
	}
	return value !== undefined && value.length > 0 ? value : undefined;
}

function archiveThumbUrl(identifier: string): string {
	return `https://archive.org/services/img/${identifier}`;
}

/** Archive.org identifiers are filesystem-safe, LibriVox ids are numeric. */
function isNumericId(uid: string): boolean {
	return /^\d+$/.test(uid);
}

/**
 * archive.org advancedsearch expects a field query like `title:(foo bar)`;
 * strip characters that have query-syntax meaning so user input can't break
 * out of the group.
 */
function sanitizeQueryTerm(filter: string): string {
	return filter.replace(/["()[\]{}:]/g, " ").trim();
}

// ---------------------------------------------------------------------------
// LibriVox API + archive.org clients
// ---------------------------------------------------------------------------

async function fetchBooks(
	query: Record<string, string>,
): Promise<LibriVoxBook[]> {
	const params = encodeQuery([["format", "json"], ...Object.entries(query)]);
	const res = await fetch(`${API_URL}?${params}`);
	if (!res.ok) {
		throw new Error(`LibriVox API request failed (${res.status})`);
	}
	// The API answers `{"error":"Audiobooks could not be found"}` for misses.
	const data = res.json as { books?: LibriVoxBook[]; error?: string };
	return data.books ?? [];
}

async function fetchBook(id: string): Promise<LibriVoxBook | undefined> {
	const books = await fetchBooks({ id });
	return books[0];
}

/**
 * Resolve a LibriVox book for an entry id. Ids are numeric LibriVox book ids;
 * entries found before a `call_number` was known carry the archive identifier
 * in `iddata` instead, so fall back to looking the number up there.
 */
async function resolveBook(
	entryid: EntryId,
): Promise<{ book: LibriVoxBook; identifier: string | undefined }> {
	if (isNumericId(entryid.uid)) {
		const book = await fetchBook(entryid.uid);
		if (book) {
			return { book, identifier: entryid.iddata ?? undefined };
		}
	}
	const identifier = isNumericId(entryid.uid)
		? (entryid.iddata ?? undefined)
		: entryid.uid;
	if (!identifier) {
		throw new Error(`LibriVox: could not resolve entry ${entryid.uid}`);
	}
	const res = await fetch(`${IA_METADATA_URL}${identifier}`);
	if (!res.ok) {
		throw new Error(`archive.org metadata request failed (${res.status})`);
	}
	const data = res.json as IaMetadataResponse;
	const bookId = firstString(data.metadata?.call_number);
	if (!bookId) {
		throw new Error(
			`LibriVox: archive item ${identifier} has no LibriVox book id`,
		);
	}
	const book = await fetchBook(bookId);
	if (!book) {
		throw new Error(`LibriVox: book ${bookId} not found`);
	}
	return { book, identifier };
}

interface IaSearchResult {
	docs: IaSearchDoc[];
	hasMore: boolean;
}

/** The runtime VM ships no URL globals, so encode query strings by hand. */
function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

async function searchArchive(
	query: string,
	page: number,
	sort: string,
): Promise<IaSearchResult> {
	const query_ = encodeQuery([
		["q", query],
		["rows", String(PAGE_SIZE)],
		["page", String(Math.max(1, page))],
		["sort", sort],
		["output", "json"],
		...["identifier", "title", "creator", "call_number"].map(
			(field): [string, string] => ["fl[]", field],
		),
	]);
	const res = await fetch(`${IA_SEARCH_URL}?${query_}`);
	if (!res.ok) {
		throw new Error(`archive.org search request failed (${res.status})`);
	}
	const data = res.json as IaSearchResponse;
	const numFound = data.response?.numFound ?? 0;
	const docs = data.response?.docs ?? [];
	return { docs, hasMore: page * PAGE_SIZE < numFound };
}

// ---------------------------------------------------------------------------
// RSS (chapter list) parsing
// ---------------------------------------------------------------------------

function cdataText(raw: string): string {
	return raw
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/<[^>]+>/g, "")
		.trim();
}

/**
 * The chapter feed is the only place LibriVox exposes per-chapter streams, so
 * parse the XML directly instead of going through the HTML parser, which
 * mangles namespaced podcast tags.
 */
function parseRss(xml: string): {
	cover: string | undefined;
	chapters: RssChapter[];
} {
	const cover = /<itunes:image[^>]*href="([^"]+)"/.exec(xml)?.[1];
	const chapters: RssChapter[] = [];
	for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
		const title = /<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1];
		const url = /<enclosure[^>]*url="([^"]+)"/.exec(chunk)?.[1];
		if (!url) {
			continue;
		}
		const duration = /<itunes:duration>([\s\S]*?)<\/itunes:duration>/.exec(
			chunk,
		)?.[1];
		chapters.push({
			title: title ? cdataText(title) : "",
			url,
			duration: duration ? cdataText(duration) : "",
		});
	}
	return { cover, chapters };
}

// Chapter feeds change only when a project updates, and playback requests one
// section at a time, so keep parsed feeds per book for the session.
const chapterCache = new Map<
	string,
	{ cover: string | undefined; chapters: RssChapter[] }
>();

async function fetchChapters(
	bookId: string,
): Promise<{ cover: string | undefined; chapters: RssChapter[] }> {
	const cached = chapterCache.get(bookId);
	if (cached) {
		return cached;
	}
	const res = await fetch(`${RSS_URL}${bookId}`);
	if (!res.ok) {
		throw new Error(`LibriVox RSS request failed (${res.status})`);
	}
	const parsed = parseRss(res.body);
	chapterCache.set(bookId, parsed);
	return parsed;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function iaDocToEntry(doc: IaSearchDoc): Entry {
	const identifier = doc.identifier;
	// Prefer the numeric LibriVox book id; keep the archive identifier around
	// in `iddata` so detail() can always resolve covers and fallback lookups.
	const bookId = firstString(doc.call_number);
	return {
		id: { uid: bookId ?? identifier, iddata: identifier },
		url: `https://archive.org/details/${identifier}`,
		title: doc.title ?? identifier,
		media_type: "Audio",
		cover: { url: archiveThumbUrl(identifier) },
		author: doc.creator === undefined ? undefined : [doc.creator].flat(),
	};
}

const LANGUAGE_CODES: Record<string, string> = {
	english: "en",
	french: "fr",
	german: "de",
	spanish: "es",
	italian: "it",
	dutch: "nl",
	portuguese: "pt",
	russian: "ru",
	finnish: "fi",
	swedish: "sv",
	danish: "da",
	norwegian: "no",
	polish: "pl",
	greek: "el",
	latin: "la",
	chinese: "zh",
	japanese: "ja",
	hebrew: "he",
	arabic: "ar",
	hungarian: "hu",
	czech: "cs",
	turkish: "tr",
	irish: "ga",
	serbian: "sr",
	ukrainian: "uk",
	bulgarian: "bg",
	slovak: "sk",
	slovenian: "sl",
	estonian: "et",
	afrikaans: "af",
	hindi: "hi",
	persian: "fa",
	multilingual: "mul",
};

function languageCode(language: string | undefined): string {
	const key = (language ?? "").trim().toLowerCase();
	return LANGUAGE_CODES[key] ?? "en";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const { docs, hasMore } = await searchArchive(
			"collection:librivoxaudio",
			page,
			"addeddate desc",
		);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = sanitizeQueryTerm(filter);
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const { docs, hasMore } = await searchArchive(
			`collection:librivoxaudio AND (title:(${term}) OR creator:(${term}))`,
			page,
			"downloads desc",
		);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const { book, identifier } = await resolveBook(entryid);
		const { cover: rssCover, chapters } = await fetchChapters(book.id);

		const authors = (book.authors ?? [])
			.map(authorName)
			.filter((name) => name.length > 0);

		const meta: Record<string, string> = {};
		if (book.totaltimesecs !== undefined) {
			meta.Runtime = humanRuntime(book.totaltimesecs);
		}
		if (book.language) {
			meta.Language = book.language;
		}
		if (book.copyright_year) {
			meta["Copyright Year"] = book.copyright_year;
		}
		if (book.url_text_source) {
			meta["Text Source"] = book.url_text_source;
		}

		const links: CustomUI[] = [];
		if (book.url_librivox) {
			links.push(Link(book.url_librivox, "LibriVox page"));
		}
		if (book.url_text_source) {
			links.push(Link(book.url_text_source, "Text source"));
		}
		if (book.url_zip_file) {
			links.push(Link(book.url_zip_file, "Download all (zip)"));
		}
		const coverUrl =
			rssCover ?? (identifier ? archiveThumbUrl(identifier) : undefined);

		const entry: EntryDetailed = {
			id: { uid: book.id },
			url: book.url_librivox ?? `https://librivox.org/`,
			titles: [book.title],
			author: authors.length > 0 ? authors : undefined,
			media_type: "Audio",
			status: "Complete",
			description: stripHtml(book.description ?? ""),
			language: book.language ?? "",
			cover: coverUrl ? { url: coverUrl } : undefined,
			poster: coverUrl ? { url: coverUrl } : undefined,
			episodes: chapters.map(
				(chapter, index): Episode => ({
					id: {
						uid: `${book.id}#${index}`,
						iddata: languageCode(book.language),
					},
					name:
						chapter.title.length > 0 ? chapter.title : `Section ${index + 1}`,
					url: chapter.url,
					description: chapter.duration
						? `Runtime: ${normalizeDuration(chapter.duration)}`
						: undefined,
				}),
			),
			meta,
			ui: links.length > 0 ? Column(Text("Links"), ...links) : undefined,
		};

		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const [bookId, indexRaw] = epid.uid.split("#");
		const index = Number(indexRaw);
		if (!bookId || !Number.isInteger(index) || index < 0) {
			throw new Error(`LibriVox: invalid episode id ${epid.uid}`);
		}
		const { chapters } = await fetchChapters(bookId);
		const chapter = chapters[index];
		if (!chapter) {
			throw new Error(
				`LibriVox: section ${index} not found for book ${bookId}`,
			);
		}
		return {
			settings,
			source: {
				type: "Audio",
				sources: [
					{
						name:
							chapter.title.length > 0 ? chapter.title : `Section ${index + 1}`,
						lang: languageCode(epid.iddata ?? undefined),
						url: { url: chapter.url },
					},
				],
				chapters: null,
			},
		};
	}
}
