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
	type BookPage,
	BASE,
	CATEGORY_ALL,
	CATEGORY_CHRISTMAS,
	CATEGORY_HALLOWEEN,
	CATEGORY_NEW,
	absolute,
	bookUrl,
	curatedUrl,
	downloadUrl,
	humanRuntime,
	isValidSlug,
	listingUrl,
	type ListingEntry,
	normalizeDuration,
	parseBookPage,
	parseListing,
	parseResultCount,
	parseTotalPages,
	durationToSeconds,
	searchUrl,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// vorleser.net offers free German audiobook recordings of public-domain texts.
// The relaunched site (TYPO3, "beta") has no API; everything is plain HTML:
//   - /hoerbuecher/l/<N>   full A-Z catalog, 12 cards per page (pager 1-based)
//   - /neue-hoerbuecher, /halloween, /weihnachten
//                          curated single-page listings (same card markup)
//   - /suche?tx_kesearch_pi1[sword]=...&tx_kesearch_pi1[page]=N
//                          site search (ke_search), 10 hits per page
//   - /hoerbuch/<slug>     book detail page (title, author, Sprecher*innen,
//                          description, cover, categories, runtime)
//   - /hoerbuch/download/<slug>
//                          the recording itself: ONE mp3 per book entry
//                          (long works are split into separate entries)
// Some entries are stream-only stubs without a download link; those get no
// episodes. Recordings are free for private use only, which the detail UI
// points out.
// ---------------------------------------------------------------------------

/** ke_search serves 10 hits per page — used to compute search pagination. */
const SEARCH_PAGE_SIZE = 10;

const CATEGORY_OPTIONS = [
	{ value: CATEGORY_ALL, label: "Alle Hörbücher (A-Z)" },
	{ value: CATEGORY_NEW, label: "Neue Hörbücher" },
	{ value: CATEGORY_HALLOWEEN, label: "Halloween & Grusel" },
	{ value: CATEGORY_CHRISTMAS, label: "Weihnachten" },
];

// ---------------------------------------------------------------------------
// Remote access (with per-session caches — be polite to the site)
// ---------------------------------------------------------------------------

async function fetchText(url: string, what: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`vorleser.net: ${what} request failed (${res.status})`);
	}
	return res.body;
}

interface CachedListing {
	entries: ListingEntry[];
	totalPages: number;
}

const listingCache = new Map<string, CachedListing>();

async function loadListing(url: string): Promise<CachedListing> {
	const cached = listingCache.get(url);
	if (cached) {
		return cached;
	}
	const html = await fetchText(url, "listing");
	const listing: CachedListing = {
		entries: parseListing(html),
		totalPages: parseTotalPages(html),
	};
	listingCache.set(url, listing);
	return listing;
}

const bookCache = new Map<string, BookPage>();

async function loadBook(slug: string): Promise<BookPage> {
	const cached = bookCache.get(slug);
	if (cached) {
		return cached;
	}
	const book = parseBookPage(await fetchText(bookUrl(slug), "book page"), slug);
	bookCache.set(slug, book);
	return book;
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

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		category: new ExtensionSetting<string>("category", CATEGORY_ALL, "Search")
			.setLabel("Kategorie")
			.setUI(new Dropdown(CATEGORY_OPTIONS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const category = await this.settings.category.get();
		if (category === CATEGORY_ALL) {
			const listing = await loadListing(listingUrl(page));
			return {
				content: listing.entries.map(listingToEntry),
				hasnext: Math.max(0, page) + 1 < listing.totalPages,
			};
		}
		// The curated pages are single-page listings.
		if (page > 0) {
			return { content: [], hasnext: false };
		}
		const url = curatedUrl(category);
		if (url === null) {
			return { content: [], hasnext: false };
		}
		const listing = await loadListing(url);
		return { content: listing.entries.map(listingToEntry), hasnext: false };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const html = await fetchText(searchUrl(term, page), "search");
		const total = parseResultCount(html);
		if (total === 0) {
			return { content: [], hasnext: false };
		}
		return {
			content: parseListing(html).map(listingToEntry),
			hasnext: (Math.max(0, page) + 1) * SEARCH_PAGE_SIZE < total,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const slug = entryid.uid;
		if (!isValidSlug(slug)) {
			throw new Error(`vorleser.net: invalid entry id ${slug}`);
		}
		const book = await loadBook(slug);

		const meta: Record<string, string> = {};
		if (book.speakers.length > 0) {
			meta["Sprecher*innen"] = book.speakers.join(", ");
		}
		const seconds = durationToSeconds(book.duration);
		if (seconds > 0) {
			meta.Spieldauer = humanRuntime(seconds);
		}

		// One book entry == one downloadable mp3. Stream-only stubs (no
		// /hoerbuch/download/ link) get no episodes at all.
		const episodes: Episode[] =
			book.downloadHref.length > 0
				? [
						{
							id: { uid: slug, iddata: "de" },
							name: book.title,
							url: absolute(book.downloadHref),
							description:
								normalizeDuration(book.duration).length > 0
									? `Spieldauer: ${normalizeDuration(book.duration)}`
									: undefined,
						},
					]
				: [];

		const entry: EntryDetailed = {
			id: { uid: slug },
			url: bookUrl(slug),
			titles: [book.title],
			author: book.authors.length > 0 ? book.authors : undefined,
			media_type: "Audio",
			status: "Complete",
			description: book.description,
			language: "de",
			cover: book.cover.length > 0 ? { url: book.cover } : undefined,
			poster: book.cover.length > 0 ? { url: book.cover } : undefined,
			genres: book.categories.length > 0 ? book.categories : undefined,
			episodes,
			meta: Object.keys(meta).length > 0 ? meta : undefined,
			ui: detailUi(book),
		};

		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const slug = epid.uid;
		if (!isValidSlug(slug)) {
			throw new Error(`vorleser.net: invalid episode id ${slug}`);
		}
		const url = downloadUrl(slug);
		// Only consult the cache — a missing download must not fail playback
		// for books whose page we simply have not fetched yet.
		const cached = bookCache.get(slug);
		if (cached && cached.downloadHref.length === 0) {
			throw new Error(
				`vorleser.net: "${cached.title}" has no free download (stream-only entry)`,
			);
		}
		const name = cached?.title ?? slug;
		return {
			settings,
			source: {
				type: "Audio",
				sources: [{ name, lang: "de", url: { url } }],
			},
		};
	}
}

// ---------------------------------------------------------------------------
// Detail UI (site link + terms note)
// ---------------------------------------------------------------------------

function detailUi(book: BookPage): CustomUI {
	return Column(
		Text("Hinweis", { bold: true }),
		Text(
			"Die Aufnahmen stehen auf vorleser.net kostenlos zur privaten Nutzung bereit. Eine Weiterverbreitung ist nicht gestattet.",
		),
		book.speakers.length > 0
			? Text(`Gelesen von: ${book.speakers.join(", ")}`)
			: undefined,
		Link(bookUrl(book.slug), "Auf vorleser.net öffnen"),
		Link(`${BASE}/agb`, "AGB von vorleser.net"),
	);
}
