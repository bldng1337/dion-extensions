import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Divider, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	Episode,
	EpisodeId,
	EventData,
	EventResult,
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import type { BookInfo, CatalogPageInfo, IndexItem } from "./site.ts";
import {
	bibliothekUrl,
	bookUrl,
	chapterUrl,
	episodeUid,
	LETTERS,
	NEW_URL,
	parseBookPage,
	parseBookUid,
	parseCatalogPage,
	parseChapter,
	parseEpisodeUid,
	parseIndexItems,
	parsePublishInfo,
	PRIVATE_USE_NOTE,
	searchUrl,
	titleFromSlug,
	USER_AGENT,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (past-the-end listings), error otherwise. */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
		},
	});
	if (!res.ok) {
		if (res.status === 404) {
			return null;
		}
		throw new Error(
			`Projekt Gutenberg-DE request failed (${res.status}): ${url}`,
		);
	}
	return res.body;
}

/** An index listing item as a browse/search Entry; author-group hits and
 * navigation links (no book href) are dropped. */
function itemToEntry(item: IndexItem): Entry | null {
	if (item.uid === null) {
		return null;
	}
	return {
		id: { uid: item.uid },
		url: bookUrl(item.uid),
		title: item.title || titleFromSlug(item.uid),
		media_type: "Book",
		author: item.author ? [item.author] : null,
	};
}

function itemsToEntries(items: IndexItem[]): Entry[] {
	return items.flatMap((item) => itemToEntry(item) ?? []);
}

// ---------------------------------------------------------------------------
// Session caches — listings, book pages and chapters are fetched at most once
// per session to keep the request count polite.
// ---------------------------------------------------------------------------

const listingCache = new Map<string, IndexItem[]>();
/** Cached /bibliothek/ listing pages (items + pagination counts). */
const catalogCache = new Map<string, CatalogPageInfo>();
const bookCache = new Map<string, BookInfo>();
/** Chapter HTML is large; keep a bounded cache of parsed chapters. */
const chapterCache = new Map<string, Paragraph[]>();
const CHAPTER_CACHE_LIMIT = 24;

async function listingItems(url: string): Promise<IndexItem[]> {
	const cached = listingCache.get(url);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(url);
	const items = body ? parseIndexItems(body) : [];
	listingCache.set(url, items);
	return items;
}

/** One "Buchtitel A–Z" listing page, fetched at most once per session. The
 * letter's first page also teaches the pager how many pages the letter spans. */
async function catalogPage(
	letter: string,
	page: number,
): Promise<CatalogPageInfo> {
	const key = `${letter}#${page}`;
	const cached = catalogCache.get(key);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(bibliothekUrl(letter, page));
	const info: CatalogPageInfo = body
		? parseCatalogPage(body)
		: { items: [], total: 0, page, pages: 0 };
	catalogCache.set(key, info);
	return info;
}

/** Number of listing pages a catalog letter spans ("Seite N von M"). */
async function letterPages(letter: string): Promise<number> {
	return (await catalogPage(letter, 1)).pages;
}

async function bookInfo(uid: string): Promise<BookInfo> {
	const cached = bookCache.get(uid);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(bookUrl(uid));
	if (body === null) {
		throw new Error(`Projekt Gutenberg-DE: book "${uid}" not found`);
	}
	const info = parseBookPage(body, uid);
	bookCache.set(uid, info);
	return info;
}

async function chapterParagraphsFor(
	bookUid: string,
	chapter: number,
): Promise<Paragraph[]> {
	const key = `${bookUid}#${chapter}`;
	const cached = chapterCache.get(key);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(chapterUrl(bookUid, chapter));
	if (body === null) {
		throw new Error(
			`Projekt Gutenberg-DE: chapter ${chapter} of "${bookUid}" not found`,
		);
	}
	const paragraphs: Paragraph[] = parseChapter(body).map((p) => ({
		type: "Text",
		content: p.content,
		style:
			p.style === "bold"
				? { bold: true }
				: p.style === "italic"
					? { italic: true }
					: null,
	}));
	if (chapterCache.size >= CHAPTER_CACHE_LIMIT) {
		chapterCache.clear();
	}
	chapterCache.set(key, paragraphs);
	return paragraphs;
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

	/**
	 * Page 0 lists the newest additions ("/bibliothek/neu-in-der-bibliothek/");
	 * following pages walk the canonical "Buchtitel A–Z" catalog
	 * ("/bibliothek/?gl_letter=L&gl_page=N", 100 items per page), continuing
	 * from letter to letter until the catalog is exhausted.
	 */
	async browse(page: number): Promise<EntryList> {
		if (Math.max(0, page) === 0) {
			return {
				content: itemsToEntries(await listingItems(NEW_URL)),
				hasnext: true,
			};
		}

		// Walk the A–Z catalog, learning each letter's page count on the way
		// (cached per session, so deep pages skip already-counted letters).
		let flat = Math.max(0, page) - 1;
		for (let i = 0; i < LETTERS.length; i++) {
			const letter = LETTERS[i] ?? "#";
			const pages = await letterPages(letter);
			if (flat < pages) {
				const info = await catalogPage(letter, flat + 1);
				return {
					content: itemsToEntries(info.items),
					hasnext: flat + 1 < pages || i < LETTERS.length - 1,
				};
			}
			flat -= pages;
		}
		return { content: [], hasnext: false };
	}

	/** The site's server-side search (scopes "Autoren + Titel", the web
	 * form's defaults). The result page is not paginated; author-group hits
	 * are skipped because they link to author pages, not books. */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0 || Math.max(0, page) > 0) {
			return { content: [], hasnext: false };
		}
		return {
			content: itemsToEntries(await listingItems(searchUrl(query))),
			hasnext: false,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const parsed = parseBookUid(uid);
		if (!parsed) {
			throw new Error(`Projekt Gutenberg-DE: invalid book id "${uid}"`);
		}
		const info = await bookInfo(uid);

		const chapters =
			info.chapters.length > 0
				? info.chapters
				: [{ n: 1, name: "Lesen", url: chapterUrl(uid, 1) }];
		const episodes: Episode[] = chapters.map((chapter) => ({
			id: {
				uid: episodeUid(uid, chapter.n),
				iddata: JSON.stringify({ book: uid, n: chapter.n }),
			},
			name: chapter.name,
			url: chapter.url,
		}));

		const meta = parsePublishInfo(info.description);
		const description =
			info.description ||
			`„${info.title}“${info.author ? ` von ${info.author}` : ""} — Volltext auf Projekt Gutenberg-DE.`;

		const entry: EntryDetailed = {
			id: { uid },
			url: bookUrl(uid),
			titles: [info.title],
			author: info.author ? [info.author] : null,
			media_type: "Book",
			status: "Complete",
			description,
			language: "de",
			episodes,
			meta: Object.keys(meta).length > 0 ? meta : null,
			ui: Column(
				Text(PRIVATE_USE_NOTE),
				Divider(),
				Link(bookUrl(uid), "Auf Projekt Gutenberg-DE öffnen"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let bookUid = "";
		let chapter = 0;
		try {
			const data = JSON.parse(epid.iddata ?? "") as {
				book?: unknown;
				n?: unknown;
			};
			if (typeof data.book === "string" && typeof data.n === "number") {
				bookUid = data.book;
				chapter = data.n;
			}
		} catch {
			// no/malformed iddata: fall back to the uid below
		}
		if (!parseBookUid(bookUid)) {
			const parsed = parseEpisodeUid(epid.uid);
			if (!parsed) {
				throw new Error(
					`Projekt Gutenberg-DE: invalid chapter id "${epid.uid}"`,
				);
			}
			bookUid = parsed.bookUid;
			chapter = parsed.chapter;
		}

		const paragraphs = await chapterParagraphsFor(bookUid, chapter);
		if (paragraphs.length === 0) {
			throw new Error(
				`Projekt Gutenberg-DE: no readable text in chapter ${chapter} of "${bookUid}"`,
			);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
