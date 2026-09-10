import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
	Link as DionLink,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	type EpisodeReader,
	CATEGORIES,
	DEFAULT_CATEGORY,
	episodeToReaderInfo,
	htmlHeaders,
	itemToEntry,
	type ListingItem,
	type ListingPage,
	listingUrl,
	matchesItem,
	parseEpisodeReader,
	parseListing,
	parseReader,
	pageImageLink,
	readerToDetail,
	readerUrl,
	type ReaderInfo,
	SEARCH_SCAN_PAGES,
} from "./cbp.ts";

// ---------------------------------------------------------------------------
// Site client
//
// comicbookplus.com needs no login for reading: listings are plain HTML at
// /?cbplus=<key>_l_s_<page> and every book has an online reader at
// /?dlid=<n> whose page images follow the plain <host>/<loc>/<n>.jpg
// convention (see cbp.ts). Downloads (CBR/CBZ) need a free account but are
// never touched — the reader's own page images are the source.
//
// Everything is cached aggressively for the session: listing pages feed both
// browse and the client-side search, and reader pages feed detail and source,
// so repeated calls stay polite to the small volunteer-run site.
// ---------------------------------------------------------------------------

const listingCache = new Map<string, Promise<ListingPage>>();

/** One listing page; past-the-end pages answer 404 and yield an empty page. */
async function fetchListing(
	category: string,
	page: number,
): Promise<ListingPage> {
	const key = `${category}:${page}`;
	const cached = listingCache.get(key);
	if (cached) {
		return cached;
	}
	const promise = (async () => {
		const res = await fetch(listingUrl(category, page), {
			headers: htmlHeaders(),
		});
		if (res.status === 404) {
			return { items: [], hasNext: false };
		}
		if (!res.ok) {
			throw new Error(
				`comic-book-plus: listing request failed (${res.status})`,
			);
		}
		return parseListing(res.body, category, page);
	})().catch((err: unknown) => {
		// Retry the next time instead of caching the failure forever.
		listingCache.delete(key);
		throw err;
	});
	listingCache.set(key, promise);
	return promise;
}

/** Reader pages rarely change; cache them per book for the session. */
const readerCache = new Map<string, Promise<ReaderInfo>>();

async function fetchReader(dlid: number): Promise<ReaderInfo> {
	const key = String(dlid);
	const cached = readerCache.get(key);
	if (cached) {
		return cached;
	}
	const promise = (async () => {
		const res = await fetch(readerUrl(dlid), { headers: htmlHeaders() });
		if (!res.ok) {
			throw new Error(
				`comic-book-plus: reader request for book ${dlid} failed (${res.status})`,
			);
		}
		return parseReader(res.body, dlid);
	})().catch((err: unknown) => {
		readerCache.delete(key);
		throw err;
	});
	readerCache.set(key, promise);
	return promise;
}

/** Parses the positive numeric dlid used as entry/episode id. */
function parseDlid(uid: string): number {
	const dlid = Number(uid);
	if (!/^\d+$/.test(uid) || !Number.isInteger(dlid) || dlid <= 0) {
		throw new Error(`comic-book-plus: invalid book id "${uid}"`);
	}
	return dlid;
}

/** Client-side pagination over a fully scanned hit list. */
function paginate<T>(
	items: T[],
	page: number,
	size: number,
): { content: T[]; hasnext: boolean } {
	const start = Math.max(0, page) * size;
	const content = items.slice(start, start + size);
	return { content, hasnext: start + size < items.length };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		category: new ExtensionSetting<string>(
			"category",
			DEFAULT_CATEGORY,
			"Search",
		)
			.setLabel("Category")
			.setUI(new Dropdown(CATEGORIES.map((c) => ({ ...c })))),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/** Paged book listing of the selected category. */
	async browse(page: number): Promise<EntryList> {
		const category = await this.currentCategory();
		const listing = await fetchListing(category, page);
		return {
			content: listing.items.map(itemToEntry),
			hasnext: listing.hasNext && listing.items.length > 0,
		};
	}

	/**
	 * The site's own search is a Google widget that needs a browser, so search
	 * scans the category listings (newest first, cached) client-side and
	 * matches the filter against book and series titles.
	 */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const category = await this.currentCategory();
		const scanned: ListingItem[] = [];
		for (let p = 0; p < SEARCH_SCAN_PAGES; p++) {
			const listing = await fetchListing(category, p);
			scanned.push(...listing.items);
			if (!listing.hasNext) {
				break;
			}
		}
		const hits = scanned.filter((item) => matchesItem(item, query));
		const result = paginate(hits, page, 50);
		return {
			content: result.content.map(itemToEntry),
			hasnext: result.hasnext,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const dlid = parseDlid(entryid.uid);
		const info = await fetchReader(dlid);
		const entry: EntryDetailed = {
			...readerToDetail(info),
			ui: detailUI(info),
		};
		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const dlid = parseDlid(epid.uid);
		const episode: EpisodeReader | null = parseEpisodeReader(epid.iddata);
		let info: ReaderInfo;
		try {
			// Also warms the site session (cookies) for the image requests.
			info = await fetchReader(dlid);
		} catch (err) {
			// The reader facts ride along in the episode iddata, so a book can
			// still be opened when its reader page cannot be (re)fetched.
			if (!episode) {
				throw err;
			}
			info = episodeToReaderInfo(dlid, episode);
		}
		const links: DionLink[] = [];
		for (let n = 0; n < info.pages; n++) {
			links.push(pageImageLink(info, n));
		}
		return {
			source: {
				type: "Imagelist",
				links,
				audio: null,
			},
			settings,
		};
	}

	private async currentCategory(): Promise<string> {
		const value = await this.settings.category.get();
		return typeof value === "string" && value.length > 0
			? value
			: DEFAULT_CATEGORY;
	}
}

/** Attribution note shown on every detail page. */
const SOURCE_NOTE =
	"Comic Book Plus hosts public-domain comic scans; reading online is free. " +
	"Full downloads need a free site account — page images do not.";

function detailUI(info: ReaderInfo): CustomUI {
	return Column(
		Text(SOURCE_NOTE),
		info.series ? Text(`Series: ${info.series}`) : undefined,
		Link(readerUrl(info.dlid), "View on comicbookplus.com"),
	);
}
