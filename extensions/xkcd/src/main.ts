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
} from "@dion-js/runtime-types/runtime";
import { fetch, type DionResponse } from "network";
import {
	AUTHOR,
	LATEST_API_URL,
	LICENSE_NOTE,
	PAGE_SIZE,
	comicApiUrl,
	comicPageUrl,
	comicToDetail,
	comicsToEntries,
	matchesComic,
	paginate,
	toNum,
	type XkcdComic,
} from "./comic.ts";

// ---------------------------------------------------------------------------
// API client
//
// There is no bulk or search endpoint, so every strip is fetched from its own
// `/<num>/info.0.json` document. Strips are tiny and essentially immutable, so
// a session-wide cache keyed by strip number feeds both browse pages and the
// client-side search window. Gap numbers (e.g. #404) answer HTTP 404 and are
// simply skipped.
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_RANGE = 500;
const FETCH_CONCURRENCY = 20;

/** Session cache of fetched comics, keyed by strip number. */
const comicCache = new Map<number, XkcdComic>();

let latestNumPromise: Promise<number> | null = null;

function comicFromResponse(
	res: DionResponse,
	fallback: number,
): XkcdComic | undefined {
	if (!res.ok) {
		// 404 = intentional gap number or not-yet-released strip.
		return undefined;
	}
	const comic = res.json as XkcdComic;
	const num = toNum(comic.num) ?? fallback;
	const normalized = { ...comic, num };
	comicCache.set(num, normalized);
	return normalized;
}

async function fetchLatestNum(): Promise<number> {
	const res = await fetch(LATEST_API_URL);
	if (!res.ok) {
		throw new Error(`xkcd: latest comic request failed (${res.status})`);
	}
	const comic = comicFromResponse(res, 0);
	const num = comic ? toNum(comic.num) : null;
	if (!comic || !num) {
		throw new Error("xkcd: latest comic response has no valid strip number");
	}
	return num;
}

/** Latest strip number, cached for the session (retried after a failure). */
function latestNum(): Promise<number> {
	latestNumPromise ??= fetchLatestNum().catch((err: unknown) => {
		latestNumPromise = null;
		throw err;
	});
	return latestNumPromise;
}

/** Fetch one comic; undefined for gap numbers. Results are cached. */
async function fetchComic(num: number): Promise<XkcdComic | undefined> {
	const cached = comicCache.get(num);
	if (cached) {
		return cached;
	}
	const res = await fetch(comicApiUrl(num));
	return comicFromResponse(res, num);
}

/** Fetch a batch of comics newest-first, skipping gaps. */
async function fetchComics(nums: number[]): Promise<XkcdComic[]> {
	const comics: XkcdComic[] = [];
	for (let i = 0; i < nums.length; i += FETCH_CONCURRENCY) {
		const chunk = nums.slice(i, i + FETCH_CONCURRENCY);
		const fetched = await Promise.all(chunk.map((num) => fetchComic(num)));
		for (const comic of fetched) {
			if (comic) {
				comics.push(comic);
			}
		}
	}
	return comics;
}

/** Strip numbers `from` down to `to` (inclusive). */
function numRange(from: number, to: number): number[] {
	const nums: number[] = [];
	for (let num = from; num >= to; num--) {
		nums.push(num);
	}
	return nums;
}

/**
 * The cached search window: the `range` most recent strips. Fetches whatever
 * is missing from the cache and returns the documents newest-first.
 */
async function searchWindow(range: number): Promise<XkcdComic[]> {
	const latest = await latestNum();
	const oldest = Math.max(1, latest - range + 1);
	const missing = numRange(latest, oldest).filter(
		(num) => !comicCache.has(num),
	);
	await fetchComics(missing);
	const comics: XkcdComic[] = [];
	for (const num of numRange(latest, oldest)) {
		const comic = comicCache.get(num);
		if (comic) {
			comics.push(comic);
		}
	}
	return comics;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		searchRange: new ExtensionSetting<string>(
			"search_range",
			String(DEFAULT_SEARCH_RANGE),
			"Extension",
		)
			.setLabel("Searchable range (most recent strips)")
			.setUI(
				new Dropdown([
					{ value: "100", label: "Latest 100" },
					{ value: "250", label: "Latest 250" },
					{ value: "500", label: "Latest 500" },
					{ value: "1000", label: "Latest 1000" },
				]),
			),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const latest = await latestNum();
		const newest = latest - Math.max(0, page) * PAGE_SIZE;
		if (newest < 1) {
			return { content: [], hasnext: false };
		}
		const oldest = Math.max(1, newest - PAGE_SIZE + 1);
		const comics = await fetchComics(numRange(newest, oldest));
		return {
			content: comicsToEntries(comics),
			hasnext: newest - PAGE_SIZE >= 1,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const configured = Number(await this.settings.searchRange.get());
		const range =
			Number.isFinite(configured) && configured > 0
				? configured
				: DEFAULT_SEARCH_RANGE;
		const hits = (await searchWindow(range)).filter((comic) =>
			matchesComic(comic, query),
		);
		return paginate(comicsToEntries(hits), page);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const num = toNum(entryid.uid);
		if (!num) {
			throw new Error(`xkcd: invalid entry id "${entryid.uid}"`);
		}
		const comic = await fetchComic(num);
		const detail = comic ? comicToDetail(comic) : null;
		if (!detail) {
			throw new Error(`xkcd: comic ${num} not found`);
		}
		const entry: EntryDetailed = {
			...detail,
			ui: detailUI(num),
		};
		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const num = toNum(epid.uid);
		if (!num) {
			throw new Error(`xkcd: invalid episode id "${epid.uid}"`);
		}
		const comic = await fetchComic(num);
		if (!comic?.img) {
			throw new Error(`xkcd: comic ${num} has no image`);
		}
		return {
			settings,
			source: {
				type: "Imagelist",
				links: [{ url: comic.img }],
				audio: null,
			},
		};
	}
}

/** License attribution + a link to the canonical strip page. */
function detailUI(num: number): CustomUI {
	return Column(
		Text(LICENSE_NOTE),
		Text(`Written by ${AUTHOR}.`),
		Link(comicPageUrl(num), "View on xkcd.com"),
	);
}
