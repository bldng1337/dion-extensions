import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
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
import type {
	BookCard,
	BookOverview,
	BookRef,
	ChapterParagraph,
} from "./site.ts";
import {
	ATTRIBUTION,
	BASE,
	PAGE_SIZE,
	parseBookCards,
	parseBooksSitemap,
	parseChapter,
	parseChapterData,
	parseChapterUid,
	parseOverview,
	parseTocRows,
	TOPICS,
	TOPIC_SETTING_ID,
	topicUrl,
	USER_AGENT,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (unknown topic/book), error otherwise. */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml,application/xml",
			"Accept-Encoding": "identity",
		},
	});
	if (!res.ok) {
		if (res.status === 404) {
			return null;
		}
		throw new Error(`Sacred Texts request failed (${res.status}): ${url}`);
	}
	return res.body;
}

function cardToEntry(card: BookCard): Entry {
	return {
		id: { uid: card.uid },
		url: `${BASE}/${card.uid}`,
		title: card.title,
		media_type: "Book",
		author: card.author ? [card.author] : null,
	};
}

function refToEntry(ref: BookRef): Entry {
	return {
		id: { uid: ref.uid },
		url: `${BASE}/${ref.uid}`,
		title: ref.title,
		media_type: "Book",
	};
}

// ---------------------------------------------------------------------------
// Session caches — topic listings, the books sitemap, book overviews and
// chapter pages are fetched at most once per session to keep the request
// count polite. Chapter HTML is large, so that cache is bounded.
// ---------------------------------------------------------------------------

const topicCache = new Map<string, BookCard[]>();
let sitemapCache: BookRef[] | null = null;
const overviewCache = new Map<string, BookOverview>();
const chapterCache = new Map<string, Paragraph[]>();
const CHAPTER_CACHE_LIMIT = 8;

/** The book cards of one browse topic, fetched at most once per session. */
async function topicCards(topic: string): Promise<BookCard[]> {
	const cached = topicCache.get(topic);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(topicUrl(topic));
	const cards = body ? parseBookCards(body) : [];
	topicCache.set(topic, cards);
	return cards;
}

/** The /sitemaps/books.xml title index (search corpus extension). */
async function booksSitemap(): Promise<BookRef[]> {
	if (sitemapCache === null) {
		const body = await fetchPage(`${BASE}/sitemaps/books.xml`);
		sitemapCache = body ? parseBooksSitemap(body) : [];
	}
	return sitemapCache;
}

/** The book overview of one uid, including its full (paginated) chapter
 * table. Pages 2..N of the TOC are fetched only when present. */
async function overviewFor(uid: string): Promise<BookOverview> {
	const cached = overviewCache.get(uid);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(`${BASE}/${uid}`);
	if (body === null) {
		throw new Error(`Sacred Texts: book "${uid}" not found`);
	}
	const overview = parseOverview(body, uid);
	for (let page = 2; page <= overview.chapterPages; page++) {
		const next = await fetchPage(`${BASE}/${uid}?chaptersPage=${page}`);
		if (next === null) {
			break;
		}
		for (const chapter of parseTocRows(next)) {
			if (!overview.chapters.some((c) => c.slug === chapter.slug)) {
				overview.chapters.push(chapter);
			}
		}
	}
	overviewCache.set(uid, overview);
	return overview;
}

async function chapterParagraphsFor(
	bookUid: string,
	slug: string,
	url: string,
): Promise<Paragraph[]> {
	const cacheKey = `${bookUid}#${slug}`;
	const cached = chapterCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	// Primary: the SvelteKit data endpoint of the reader page — small, and
	// reliable from the runtime's HTTP client (the cached HTML shell is served
	// with a content encoding it cannot read, see site.ts).
	// Fallback: the reader HTML page itself.
	let parsed: ChapterParagraph[] = [];
	try {
		const dataBody = await fetchPage(`${url}/__data.json`);
		if (dataBody !== null) {
			parsed = parseChapterData(dataBody);
		}
	} catch {
		// data endpoint failed (network/encoding): try the HTML page
	}
	if (parsed.length === 0) {
		const htmlBody = await fetchPage(url);
		if (htmlBody !== null) {
			parsed = parseChapter(htmlBody);
		}
	}
	const paragraphs: Paragraph[] = parsed.map((p: ChapterParagraph) => ({
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
	chapterCache.set(cacheKey, paragraphs);
	return paragraphs;
}

/** Resolves the reader URL of one chapter: prefers the iddata href carried
 * from detail(), reconstructs it for "book/<slug>" uids, and as a last
 * resort re-reads the book overview for legacy uids. */
async function chapterUrlFor(
	bookUid: string,
	slug: string,
	iddata: string | null | undefined,
): Promise<string> {
	if (iddata) {
		try {
			const data = JSON.parse(iddata) as { href?: unknown };
			if (typeof data.href === "string" && data.href.length > 0) {
				return data.href;
			}
		} catch {
			// malformed iddata: fall through
		}
	}
	if (bookUid.startsWith("book/")) {
		return `${BASE}/${bookUid}/shell/${slug}`;
	}
	const overview = await overviewFor(bookUid);
	const chapter = overview.chapters.find((c) => c.slug === slug);
	if (!chapter) {
		throw new Error(
			`Sacred Texts: chapter "${slug}" not listed in "${bookUid}"`,
		);
	}
	return chapter.url;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		topic: new ExtensionSetting<string>(
			TOPIC_SETTING_ID,
			"legends-sagas",
			"Search",
		)
			.setLabel("Browse topic")
			.setUI(new Dropdown(TOPICS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/** Lists the books of the selected topic, 24 per page (the listing page
	 * itself carries the topic's whole catalogue; pages are sliced
	 * client-side). */
	async browse(page: number): Promise<EntryList> {
		const topic = await this.settings.topic.get();
		const cards = await topicCards(topic);
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: cards.slice(start, start + PAGE_SIZE).map(cardToEntry),
			hasnext: start + PAGE_SIZE < cards.length,
			length: cards.length,
		};
	}

	/** The site has no server-side search (its search app needs an
	 * authenticated API), so search runs client-side over two session-cached
	 * indexes: the browse-topic listings (real titles + authors) and the
	 * site's books.xml sitemap (~3000 slug-derived titles). Coverage is
	 * therefore a large subset of the archive, not its full catalogue. */
	async search(page: number, filter: string): Promise<EntryList> {
		const tokens = filter
			.trim()
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((token) => token.length > 0);
		if (tokens.length === 0) {
			return { content: [], hasnext: false };
		}

		const results: Entry[] = [];
		const seen = new Set<string>();
		const push = (entry: Entry) => {
			if (!seen.has(entry.id.uid)) {
				seen.add(entry.id.uid);
				results.push(entry);
			}
		};

		// 1) Topic listings: rich entries with real titles and authors.
		for (const topic of TOPICS) {
			for (const card of await topicCards(topic.value)) {
				const haystack = `${card.title} ${card.author ?? ""}`.toLowerCase();
				if (tokens.every((token) => haystack.includes(token))) {
					push(cardToEntry(card));
				}
			}
		}

		// 2) Sitemap slug titles: extends coverage beyond the curated topics.
		for (const ref of await booksSitemap()) {
			if (tokens.every((token) => ref.title.toLowerCase().includes(token))) {
				push(refToEntry(ref));
			}
		}

		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: results.slice(start, start + PAGE_SIZE),
			hasnext: start + PAGE_SIZE < results.length,
			length: results.length,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const overview = await overviewFor(uid);
		if (overview.chapters.length === 0) {
			throw new Error(
				`Sacred Texts: "${uid}" has no chapter table (aggregate listing pages are not readable)`,
			);
		}

		const episodes: Episode[] = overview.chapters.map((chapter) => ({
			id: {
				uid: `${uid}#${chapter.slug}`,
				iddata: JSON.stringify({
					book: uid,
					slug: chapter.slug,
					href: chapter.url,
				}),
			},
			name: chapter.name,
			url: chapter.url,
		}));

		const entry: EntryDetailed = {
			id: { uid },
			url: `${BASE}/${uid}`,
			titles: [overview.title],
			author: overview.author ? [overview.author] : null,
			media_type: "Book",
			status: "Complete",
			description: overview.description || overview.title,
			language: "en",
			cover: overview.cover ? { url: overview.cover } : null,
			episodes,
			ui: Column(
				Text(ATTRIBUTION),
				Divider(),
				Link(`${BASE}/${uid}`, "View this book on sacred-texts.com"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let bookUid = "";
		let slug = "";
		try {
			const data = JSON.parse(epid.iddata ?? "") as {
				book?: unknown;
				slug?: unknown;
			};
			if (typeof data.book === "string" && typeof data.slug === "string") {
				bookUid = data.book;
				slug = data.slug;
			}
		} catch {
			// no/malformed iddata: fall back to the uid below
		}
		if (!bookUid || !slug) {
			const parsed = parseChapterUid(epid.uid);
			if (!parsed) {
				throw new Error(`Sacred Texts: invalid chapter id "${epid.uid}"`);
			}
			bookUid = parsed.bookUid;
			slug = parsed.slug;
		}

		const url = await chapterUrlFor(bookUid, slug, epid.iddata);
		const paragraphs = await chapterParagraphsFor(bookUid, slug, url);
		if (paragraphs.length === 0) {
			throw new Error(
				`Sacred Texts: no readable text in chapter "${slug}" of "${bookUid}"`,
			);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
