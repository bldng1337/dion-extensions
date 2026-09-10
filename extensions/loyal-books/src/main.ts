import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	Episode,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	type BookFeed,
	type CatalogItem,
	CATEGORY_ALL,
	CATEGORY_POPULAR,
	type FeedChapter,
	type ListingEntry,
	SITEMAP_URL,
	bookUrl,
	durationToSeconds,
	feedUrl,
	humanRuntime,
	languageCode,
	listingUrl,
	makeEpisodeId,
	normalizeDuration,
	parseBookFeed,
	parseBookPage,
	parseCatalog,
	parseEpisodeId,
	parseListing,
	slugToTitle,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// Loyal Books re-hosts LibriVox recordings and serves plain HTML — there is no
// JSON API and no server-side search (the site search box is Google Custom
// Search). Verified machine access:
//   - /Top_100, /genre/<Name>, /language/<Name> listing pages (?page=N)
//   - /book/<slug> detail pages (schema.org microdata, jPlayer playlist)
//   - /book/<slug>/feed  podcast RSS with one MP3 enclosure per chapter
//     (files on www.archive.org)
//   - /sitemap.xml  the full catalog; every entry carries a cover and a
//     "Title By: Author" string, which powers search + the "All books" list
// ---------------------------------------------------------------------------

/** Client-side page size for catalog-backed lists (search / "All books"). */
const CATALOG_PAGE_SIZE = 24;

const GENRES = [
	"Adventure",
	"Children",
	"Comedy",
	"Fairy_tales",
	"Fantasy",
	"Fiction",
	"Historical_Fiction",
	"History",
	"Humor",
	"Literature",
	"Mystery",
	"Non-fiction",
	"Philosophy",
	"Poetry",
	"Religion",
	"Romance",
	"Science_fiction",
	"Short_stories",
	"Teen_Young_adult",
];

// English listings use the genre axis; every other entry below is a verified
// /language/<Name> listing (the genre dropdown does not apply to those).
const LANGUAGES = [
	"English",
	"German",
	"French",
	"Spanish",
	"Italian",
	"Japanese",
	"Chinese",
];

const CATEGORY_OPTIONS = [
	{ value: CATEGORY_POPULAR, label: "Popular" },
	{ value: CATEGORY_ALL, label: "All books (A-Z)" },
	...GENRES.map((genre) => ({
		value: genre,
		label: genre.replace(/_/g, " "),
	})),
];

const LANGUAGE_OPTIONS = LANGUAGES.map((language) => ({
	value: language,
	label: language,
}));

// ---------------------------------------------------------------------------
// Remote access
// ---------------------------------------------------------------------------

async function fetchText(url: string, what: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Loyal Books: ${what} request failed (${res.status})`);
	}
	return res.body;
}

/**
 * Fetch and parse the per-book podcast feed. The site answers unknown feeds
 * with an HTML 404 page, so anything that is not RSS parses as empty instead
 * of throwing — callers fall back to the book page playlist.
 */
async function fetchBookFeed(slug: string): Promise<BookFeed> {
	try {
		const body = await fetchText(feedUrl(slug), "book feed");
		return parseBookFeed(body);
	} catch {
		return { language: "", chapters: [] };
	}
}

// Chapters change only when a project is updated and playback asks for one
// section at a time, so keep parsed chapter lists per book for the session.
const chapterCache = new Map<string, FeedChapter[]>();

async function loadChapters(slug: string): Promise<FeedChapter[]> {
	const cached = chapterCache.get(slug);
	if (cached) {
		return cached;
	}
	const feed = await fetchBookFeed(slug);
	let chapters = feed.chapters;
	if (chapters.length === 0) {
		// Feed missing (e.g. slug casing drift) — recover from the jPlayer
		// playlist embedded in the book page.
		const page = parseBookPage(await fetchText(bookUrl(slug), "book page"));
		chapters = page.chapters;
	}
	chapterCache.set(slug, chapters);
	return chapters;
}

// The sitemap is ~6.6 MB and changes rarely; parse it once per session.
let catalogCache: CatalogItem[] | undefined;

async function loadCatalog(): Promise<CatalogItem[]> {
	if (!catalogCache) {
		const xml = await fetchText(SITEMAP_URL, "sitemap");
		catalogCache = parseCatalog(xml);
	}
	return catalogCache;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function listingToEntry(item: ListingEntry): Entry {
	return {
		id: { uid: item.slug },
		url: bookUrl(item.slug),
		title: item.title,
		media_type: "Audio",
		author: item.author.length > 0 ? [item.author] : undefined,
		cover: item.cover.length > 0 ? { url: item.cover } : undefined,
	};
}

function catalogToEntry(item: CatalogItem): Entry {
	return {
		id: { uid: item.slug },
		url: bookUrl(item.slug),
		title: item.title,
		media_type: "Audio",
		author: item.author.length > 0 ? [item.author] : undefined,
		cover: item.cover.length > 0 ? { url: item.cover } : undefined,
	};
}

function catalogPage(items: CatalogItem[], page: number): EntryList {
	const start = Math.max(0, page) * CATALOG_PAGE_SIZE;
	const content = items
		.slice(start, start + CATALOG_PAGE_SIZE)
		.map(catalogToEntry);
	return { content, hasnext: start + CATALOG_PAGE_SIZE < items.length };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		category: new ExtensionSetting<string>(
			"category",
			CATEGORY_POPULAR,
			"Search",
		)
			.setLabel("Browse")
			.setUI(new Dropdown(CATEGORY_OPTIONS)),
		language: new ExtensionSetting<string>("language", "English", "Search")
			.setLabel("Language")
			.setUI(new Dropdown(LANGUAGE_OPTIONS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const language = await this.settings.language.get();
		const category = await this.settings.category.get();
		const url = listingUrl(language, category, page);
		if (url === null) {
			// "All books": paginate the sitemap catalog client-side.
			return catalogPage(await loadCatalog(), page);
		}
		const { entries, totalPages } = parseListing(
			await fetchText(url, "listing"),
		);
		return {
			content: entries.map(listingToEntry),
			hasnext: Math.max(0, page) + 1 < totalPages,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		// No server-side search exists (the site embeds Google Custom Search),
		// so filter the full catalog client-side.
		const terms = filter
			.toLowerCase()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		if (terms.length === 0) {
			return { content: [], hasnext: false };
		}
		const catalog = await loadCatalog();
		const matches = catalog.filter((item) => {
			const haystack = `${item.title} ${item.author}`.toLowerCase();
			return terms.every((term) => haystack.includes(term));
		});
		return catalogPage(matches, page);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const slug = entryid.uid;
		const book = parseBookPage(await fetchText(bookUrl(slug), "book page"));
		const feedSlug = book.canonicalSlug.length > 0 ? book.canonicalSlug : slug;
		const feed = await fetchBookFeed(feedSlug);
		const chapters = feed.chapters.length > 0 ? feed.chapters : book.chapters;
		const lang = languageCode(feed.language);
		chapterCache.set(feedSlug, chapters);

		const title = book.title.length > 0 ? book.title : slugToTitle(slug);
		const totalSeconds = chapters.reduce(
			(acc: number, chapter) => acc + durationToSeconds(chapter.duration),
			0,
		);

		const meta: Record<string, string> = {};
		if (totalSeconds > 0) {
			meta.Runtime = humanRuntime(totalSeconds);
		}
		if (feed.language.length > 0) {
			meta.Language = languageCode(feed.language) || feed.language;
		}

		const links: (CustomUI | undefined)[] = [
			Link(feedUrl(feedSlug), "Podcast RSS feed"),
			book.zipUrl.length > 0
				? Link(book.zipUrl, "Download all (zip)")
				: undefined,
		];

		const entry: EntryDetailed = {
			id: { uid: slug },
			url: bookUrl(slug),
			titles: [title],
			author: book.author.length > 0 ? [book.author] : undefined,
			media_type: "Audio",
			status: "Complete",
			description: book.description,
			language: lang,
			cover: book.cover.length > 0 ? { url: book.cover } : undefined,
			poster: book.cover.length > 0 ? { url: book.cover } : undefined,
			genres: book.genres.length > 0 ? book.genres : undefined,
			episodes: chapters.map(
				(chapter, index): Episode => ({
					id: { uid: makeEpisodeId(feedSlug, index), iddata: lang },
					name:
						chapter.title.length > 0 ? chapter.title : `Section ${index + 1}`,
					url: chapter.url,
					description: chapter.duration
						? `Runtime: ${normalizeDuration(chapter.duration)}`
						: undefined,
				}),
			),
			meta: Object.keys(meta).length > 0 ? meta : undefined,
			ui: links.some((link) => link !== undefined)
				? Column(Text("Links"), ...links)
				: undefined,
		};

		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const parsed = parseEpisodeId(epid.uid);
		if (!parsed) {
			throw new Error(`Loyal Books: invalid episode id ${epid.uid}`);
		}
		const { slug, index } = parsed;
		const chapters = await loadChapters(slug);
		const chapter = chapters[index];
		if (!chapter) {
			throw new Error(
				`Loyal Books: section ${index + 1} not found for book ${slug}`,
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
						lang: epid.iddata ?? "",
						url: { url: chapter.url },
					},
				],
			},
		};
	}
}
