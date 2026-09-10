// Pure helpers for the Comic Book Plus extension. Kept free of the built-in
// `network`/`parse` modules so they can be unit-tested directly with inline
// fixtures copied from live pages.
//
// comicbookplus.com is an old-school PHP site that needs no login for reading:
// every book has an online reader at `/?dlid=<n>` whose page images follow the
// plain convention `<website><comicloc>/<n>.jpg` (n = 0..pages-1). The image
// host is embedded per book in a small obfuscated JS variable (`website` is
// assembled from string concatenations and is either comicbookplus.com or the
// box01.comicbookplus.com image host). The site rejects requests without a
// User-Agent and serves page images only with a Referer on the same site, so
// every link carries those headers. Full CBR/CBZ downloads need a free
// account, but the per-page images do not. The site search is a Google
// Custom Search widget (not machine-readable), so search runs client-side
// over the server's book listings, which are cached aggressively.

import type {
	Entry,
	EntryDetailed,
	Episode,
	Link,
} from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SITE_URL = "https://comicbookplus.com/";
export const PAGE_SIZE = 50;

/** The site rejects empty User-Agents; identify ourselves instead. */
export const USER_AGENT =
	"Mozilla/5.0 (compatible; Dion comic-book-plus extension)";

/** Hotlink protection: page images must come with a same-site Referer. */
export function refererFor(url: string): { [key: string]: string } {
	return { Referer: url, "User-Agent": USER_AGENT };
}

/** Default headers for the extension's own HTML fetches. */
export function htmlHeaders(): { [key: string]: string } {
	return { "User-Agent": USER_AGENT, Referer: SITE_URL };
}

/**
 * Book listing keys, all verified `/?cbplus=<key>_l_s_<page>` listings
 * (0-based, 50 books per page). The genres are series indexes, not book
 * listings, so they are not offered here.
 */
export const CATEGORIES = [
	{ value: "latestuploads", label: "Latest uploads" },
	{ value: "mostdownloads", label: "Most downloaded" },
	{ value: "mostviewed", label: "Most viewed" },
	{ value: "mostrated", label: "Most rated" },
	{ value: "topuserratings", label: "Highest rated" },
	{ value: "mostcommented", label: "Most commented" },
] as const;

export const DEFAULT_CATEGORY = "latestuploads";

/** Listing pages scanned for one client-side search (newest first). */
export const SEARCH_SCAN_PAGES = 4;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** The runtime VM ships no URL globals, so build query strings by hand. */
export function listingUrl(category: string, page: number): string {
	const key = CATEGORIES.some((c) => c.value === category)
		? category
		: DEFAULT_CATEGORY;
	return `${SITE_URL}?cbplus=${key}_l_s_${Math.max(0, page)}`;
}

/** The online reader page of one book (also the book's canonical URL). */
export function readerUrl(dlid: string | number): string {
	return `${SITE_URL}?dlid=${dlid}`;
}

/** The listing markup carries an explicit next-page link when one exists. */
export function hasNextListingPage(
	html: string,
	category: string,
	page: number,
): boolean {
	return html.includes(
		`cbplus=${category}_l_s_${Math.max(0, page) + 1}#topcbp`,
	);
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
	middot: "·",
	bull: "•",
};

/** Decodes the HTML entities CBP pages use (named + numeric). */
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

/** Flattens a snippet of listing HTML to single-line plain text. */
export function cleanText(html: string): string {
	return decodeEntities(
		html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""),
	)
		.replace(/\s+/g, " ")
		.trim();
}

/** Flattens a snippet of HTML to plain text, preserving line breaks. */
export function cleanBlock(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Listing parsing
// ---------------------------------------------------------------------------

/** One book row of a `/?cbplus=<key>_l_s_<page>` listing. */
export interface ListingItem {
	dlid: number;
	title: string;
	cover?: string;
	/** Series the issue belongs to ("School Friend") and its cid, when shown. */
	series?: string;
	seriesCid?: number;
	/** Publisher section ("UK Comic Books") and its cid, when shown. */
	section?: string;
	/** Schema.org genre ("Comic Book"); missing on some listings. */
	genre?: string;
	pages?: number;
	/** Issue cover date ("1951-12-08"), when the site shows one. */
	coverDate?: string;
	/** Upload date ("2026-09-09"). */
	added?: string;
	rating?: number;
	views?: number;
}

export interface ListingPage {
	items: ListingItem[];
	hasNext: boolean;
}

const ITEM_MARKER = 'itemtype="https://schema.org/Book"';

/** Splits a listing page into the per-book HTML chunks. */
export function splitListingItems(html: string): string[] {
	return html
		.split(ITEM_MARKER)
		.slice(1)
		.map((chunk) => chunk.slice(0, 6000));
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(html);
	return match?.[1];
}

/**
 * Parses a digit string into a positive integer. The `| 0` keeps the value a
 * VM-level integer: the runtime bridge rejects float-typed numbers for the
 * runtime's integer fields (length, rating, views).
 */
function toInt(raw: string | undefined): number | undefined {
	if (raw === undefined || !/^\d+$/.test(raw)) {
		return undefined;
	}
	const n = Number(raw) | 0;
	return n > 0 ? n : undefined;
}

/** Parses one listing chunk; null when it holds no usable book row. */
export function parseListingItem(block: string): ListingItem | null {
	const row =
		/<a href="\/\?dlid=(\d+)" class="ya" itemprop="name">([\s\S]*?)<\/a>/.exec(
			block,
		);
	if (!row) {
		return null;
	}
	const dlid = Number(row[1]);
	const title = cleanText(row[2] ?? "");
	if (!Number.isInteger(dlid) || dlid <= 0 || title.length === 0) {
		return null;
	}
	const item: ListingItem = { dlid, title };

	const cover = firstMatch(
		block,
		/<meta itemprop="thumbnailUrl" content="([^"]+)"/,
	);
	if (cover) {
		item.cover = cover;
	}
	const series =
		/<td class="x">Title:<\/td><td class="y"><a href="\/\?cid=(\d+)">([\s\S]*?)<\/a>/.exec(
			block,
		);
	if (series) {
		item.seriesCid = Number(series[1]);
		item.series = cleanText(series[2] ?? "");
	}
	const section = firstMatch(
		block,
		/<td class="x">Section:<\/td><td class="y"><a href="\/\?cid=\d+">([\s\S]*?)<\/a>/,
	);
	if (section) {
		item.section = cleanText(section);
	}
	const genre = firstMatch(block, /<meta itemprop="genre" content="([^"]*)"/);
	if (genre) {
		item.genre = cleanText(genre);
	}
	const pages = toInt(firstMatch(block, /itemprop="numberOfPages">(\d+)</));
	if (pages !== undefined) {
		item.pages = pages;
	}
	const coverDate = firstMatch(
		block,
		/Cover Date:<\/td><td class="y"><time[^>]* datetime="(\d{4}-\d{2}-\d{2})"/,
	);
	if (coverDate) {
		item.coverDate = coverDate;
	}
	const added = firstMatch(
		block,
		/itemprop="dateModified" datetime="(\d{4}-\d{2}-\d{2})/,
	);
	if (added) {
		item.added = added;
	}
	const rating = toInt(
		firstMatch(block, /<span itemprop="ratingValue">(\d+)</),
	);
	if (rating !== undefined) {
		item.rating = rating;
	}
	const views = toInt(firstMatch(block, /UserPageVisits:(\d+)/));
	if (views !== undefined) {
		item.views = views;
	}
	return item;
}

/** Radio shows and other non-comic rows must not become Comic entries. */
export function isComicItem(item: ListingItem): boolean {
	if (item.genre === undefined) {
		return true;
	}
	return item.genre.toLowerCase().includes("comic");
}

/** Parses one listing page. */
export function parseListing(
	html: string,
	category: string,
	page: number,
): ListingPage {
	const items: ListingItem[] = [];
	for (const block of splitListingItems(html)) {
		const item = parseListingItem(block);
		if (item && isComicItem(item)) {
			items.push(item);
		}
	}
	return { items, hasNext: hasNextListingPage(html, category, page) };
}

// ---------------------------------------------------------------------------
// Reader page parsing
// ---------------------------------------------------------------------------

/** The online-reader facts of one book, parsed from its `/?dlid=` page. */
export interface ReaderInfo {
	dlid: number;
	title: string;
	/** Publisher named in the page title ("UK Comic Books"), when present. */
	publisher?: string;
	/** Image host for the page images (with trailing slash). */
	website: string;
	/** Image path under the host, e.g. "viewer/31/311ef87...". */
	loc: string;
	pages: number;
	cover?: string;
	description?: string;
	/** Scanners' notes shown under the reader. */
	notes?: string;
	/** Series the issue belongs to, when the page names it. */
	series?: string;
	uploaded?: string;
	language?: string;
	coverDate?: string;
}

/**
 * The reader embeds its facts in a tiny script, obfuscating the image host as
 * `website="ht"+"tps://box01.comicbookplus."+"com/";`. Joins the fragments.
 */
export function parseConcatJsString(raw: string): string {
	return raw.replace(/["'+\s]/g, "");
}

/**
 * Parses a reader page. Throws when the page is not a book reader (the site
 * answers 200 with an error layout for unknown dlids).
 */
export function parseReader(html: string, dlid: number): ReaderInfo {
	const nameMeta = firstMatch(html, /<meta itemprop="name" content="([^"]*)"/);
	const websiteRaw = /website=([^;]+);/.exec(html)?.[1];
	const loc = firstMatch(html, /comicloc="([^"]+)";/);
	const pagesRaw = firstMatch(html, /comicnumpages=(\d+);/);
	if (!nameMeta || !websiteRaw || !loc || !pagesRaw) {
		throw new Error(
			`comic-book-plus: book ${dlid} has no online reader on its page`,
		);
	}
	const website = parseConcatJsString(websiteRaw);
	const pages = toInt(pagesRaw);
	if (!/^https?:\/\//.test(website) || pages === undefined) {
		throw new Error(
			`comic-book-plus: book ${dlid} has a malformed online reader`,
		);
	}

	// Page title is "Title (Publisher) - Comic Book Plus".
	const named = /^(.*?)\s*\((.*)\)\s*-\s*Comic Book Plus$/.exec(
		cleanText(nameMeta),
	);
	const title =
		(named ? (named[1] ?? "") : cleanText(nameMeta)) || `Book ${dlid}`;
	const publisher = named && named[2] ? cleanText(named[2]) : undefined;

	const info: ReaderInfo = { dlid, title, publisher, website, loc, pages };

	const cover = firstMatch(html, /<meta itemprop="image" content="([^"]+)"/);
	if (cover) {
		info.cover = cover;
	}
	const description = firstMatch(
		html,
		/<meta itemprop="description" content="([^"]*)"/,
	);
	if (description) {
		info.description = cleanText(description);
	}
	const notes = firstMatch(
		html,
		/Notes<\/td><td class="leftfloatbold[^"]*">([\s\S]*?)<\/td>/,
	);
	if (notes) {
		const text = cleanBlock(notes);
		if (text.length > 0) {
			info.notes = text;
		}
	}
	const series =
		/Title<\/td>[\s\S]{0,200}?<a href="\/\?cid=(\d+)">([\s\S]*?)<\/a>/.exec(
			html,
		);
	if (series) {
		info.series = cleanText(series[2] ?? "");
	}
	const uploaded = firstMatch(
		html,
		/itemprop="dateModified" datetime="([^"]+)"/,
	);
	if (uploaded) {
		info.uploaded = uploaded;
	}
	const language =
		firstMatch(html, /<meta itemprop="inLanguage" content="([^"]+)"/) ??
		firstMatch(html, /itemprop="inLanguage">([^<]+)</);
	if (language) {
		info.language = cleanText(language);
	}
	// Dated issues carry a datePublished ("1951-12", month precision);
	// undated ones just say "Unknown".
	const coverDate = firstMatch(
		html,
		/itemprop="datePublished" datetime="(\d{4}(?:-\d{2}){0,2})"/,
	);
	if (coverDate) {
		info.coverDate = coverDate;
	}
	return info;
}

/** The image URL of one reader page (n is 0-based). */
export function pageImageUrl(info: ReaderInfo, n: number): string {
	const host = info.website.endsWith("/") ? info.website : `${info.website}/`;
	const path = info.loc.startsWith("/") ? info.loc.slice(1) : info.loc;
	return `${host}${path}/${n}.jpg`;
}

/** All page image URLs of a book, in reading order. */
export function readerPageUrls(info: ReaderInfo): string[] {
	const urls: string[] = [];
	for (let n = 0; n < info.pages; n++) {
		urls.push(pageImageUrl(info, n));
	}
	return urls;
}

/** A page-image link; the Referer unlocks the site's hotlink protection. */
export function pageImageLink(info: ReaderInfo, n: number): Link {
	return {
		url: pageImageUrl(info, n),
		header: refererFor(readerUrl(info.dlid)),
	};
}

// ---------------------------------------------------------------------------
// Episode iddata serialization
// ---------------------------------------------------------------------------

/** The reader facts an episode carries along so source() can skip a fetch. */
export interface EpisodeReader {
	website: string;
	loc: string;
	pages: number;
}

export function serializeReader(info: ReaderInfo): string {
	const episode: EpisodeReader = {
		website: info.website,
		loc: info.loc,
		pages: info.pages,
	};
	return JSON.stringify(episode);
}

export function parseEpisodeReader(
	iddata: string | null | undefined,
): EpisodeReader | null {
	if (!iddata) {
		return null;
	}
	try {
		const parsed = JSON.parse(iddata) as Partial<EpisodeReader>;
		if (
			typeof parsed.website === "string" &&
			parsed.website.length > 0 &&
			typeof parsed.loc === "string" &&
			parsed.loc.length > 0 &&
			typeof parsed.pages === "number" &&
			parsed.pages > 0
		) {
			return {
				website: parsed.website,
				loc: parsed.loc,
				pages: parsed.pages,
			};
		}
		return null;
	} catch {
		return null;
	}
}

/** A minimal ReaderInfo view over serialized episode data. */
export function episodeToReaderInfo(
	dlid: number,
	episode: EpisodeReader,
): ReaderInfo {
	return {
		dlid,
		title: `Book ${dlid}`,
		website: episode.website,
		loc: episode.loc,
		pages: episode.pages,
	};
}

// ---------------------------------------------------------------------------
// Query matching
// ---------------------------------------------------------------------------

/** Case-insensitive substring match over the book and series titles. */
export function matchesItem(item: ListingItem, query: string): boolean {
	const term = query.trim().toLowerCase();
	if (term.length === 0) {
		return false;
	}
	return (
		item.title.toLowerCase().includes(term) ||
		(item.series ?? "").toLowerCase().includes(term)
	);
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** One browse/search row per book. */
export function itemToEntry(item: ListingItem): Entry {
	const url = readerUrl(item.dlid);
	const cover: Link | undefined = item.cover
		? { url: item.cover, header: refererFor(SITE_URL) }
		: undefined;
	return {
		id: { uid: String(item.dlid) },
		url,
		title: item.title,
		media_type: "Comic",
		cover,
		author: item.section ? [item.section] : undefined,
		length: item.pages,
		rating: item.rating,
		views: item.views,
	};
}

/** The plain-text description built from the reader page metadata. */
export function readerDescription(info: ReaderInfo): string {
	const parts: string[] = [];
	if (info.description) {
		parts.push(info.description);
	}
	if (info.notes && info.notes !== info.description) {
		parts.push(`Notes: ${info.notes}`);
	}
	return parts.join("\n\n");
}

/** Base detail view (without custom UI). */
export function readerToDetail(info: ReaderInfo): EntryDetailed {
	const url = readerUrl(info.dlid);
	const cover: Link | undefined = info.cover
		? { url: info.cover, header: refererFor(SITE_URL) }
		: undefined;
	const author = info.publisher ? [info.publisher] : undefined;

	const meta: Record<string, string> = {};
	if (info.series) {
		meta.Series = info.series;
	}
	if (info.publisher) {
		meta.Publisher = info.publisher;
	}
	if (info.coverDate) {
		meta["Cover date"] = info.coverDate;
	}
	if (info.uploaded) {
		meta.Uploaded = info.uploaded.slice(0, 10);
	}

	const episode: Episode = {
		id: { uid: String(info.dlid), iddata: serializeReader(info) },
		name: "Read",
		url,
	};

	return {
		id: { uid: String(info.dlid) },
		url,
		titles: [info.title],
		author,
		media_type: "Comic",
		status: "Complete",
		description: readerDescription(info),
		language: info.language || "en",
		cover,
		poster: cover,
		episodes: [episode],
		length: info.pages,
		meta,
	};
}
