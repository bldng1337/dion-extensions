import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, FoldableText, Link, Text } from "@dion-js/runtime-lib/ui.js";
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
	LICENSE_NOTE,
	LANGUAGE_OPTIONS,
	SITE_URL,
	SORT_OPTIONS,
	booksSearchUrl,
	bestImageUrl,
	booksToEntries,
	cleanText,
	orderReaderPages,
	personNames,
	storyApiUrl,
	storyPageUrl,
	storyReadUrl,
	storyToDetail,
	type SwBooksSearchResponse,
	type SwReaderData,
	type SwReaderResponse,
	type SwStoryDetail,
	type SwStoryDetailResponse,
} from "./storyweaver.ts";

// ---------------------------------------------------------------------------
// API client
//
// Every StoryWeaver API call needs the `_session_id` cookie that the site
// issues when the homepage is fetched, so the first request of a session
// warms the host cookie jar (cached in a promise; retried after a failure).
// The catalogue lives under /node/api/v1, the reader payload (page images)
// under /api/v1.
//
// The reader endpoint only serves a handful of anonymous story reads per
// `_session_id` and then answers 401, and the host cookie jar has no
// clear-all API. To keep reading past that, a rotation bumps the session
// epoch and re-warms the homepage while presenting an invalid cookie, which
// makes the server hand out a fresh `_session_id`.
// ---------------------------------------------------------------------------

let sessionPromise: Promise<void> | null = null;
let sessionEpoch = 0;

async function warmSession(): Promise<void> {
	const res = await fetch(
		SITE_URL,
		sessionEpoch > 0
			? { headers: { Cookie: "_session_id=rotated" } }
			: undefined,
	);
	if (!res.ok) {
		throw new Error(`storyweaver: homepage request failed (${res.status})`);
	}
}

/** Fetch the homepage once per session so the cookie jar holds `_session_id`. */
function ensureSession(force = false): Promise<void> {
	if (force) {
		sessionEpoch += 1;
		sessionPromise = null;
	}
	sessionPromise ??= warmSession().catch((err: unknown) => {
		sessionPromise = null;
		throw err;
	});
	return sessionPromise;
}

/** True for the JSON error payloads the API answers with on auth trouble. */
function isAuthRejection(payload: unknown): boolean {
	const data = payload as { status?: string; message?: string } | undefined;
	return (
		data?.status === "fail" &&
		typeof data.message === "string" &&
		data.message.toLowerCase().includes("token")
	);
}

/**
 * GET `url` with a valid session. Retries once through a rotated session when
 * the answer looks like an anonymous-read-limit or stale-session rejection.
 */
async function apiGet(url: string): Promise<DionResponse> {
	await ensureSession();
	let res = await fetch(url);
	if (res.status === 401 || (res.ok && isAuthRejection(res.json))) {
		await ensureSession(true);
		res = await fetch(url);
	}
	if (!res.ok) {
		throw new Error(`storyweaver: request failed (${res.status}) for ${url}`);
	}
	return res;
}

interface BooksPage {
	books: ReturnType<typeof booksToEntries>;
	hasNext: boolean;
}

async function fetchBooksPage(opts: {
	page: number;
	query?: string;
	sort?: string;
	language?: string;
}): Promise<BooksPage> {
	const res = await apiGet(booksSearchUrl(opts));
	const data = res.json as SwBooksSearchResponse;
	if (data.ok !== true) {
		throw new Error(
			`storyweaver: books-search rejected the query "${opts.query ?? ""}"`,
		);
	}
	const books = data.data ?? [];
	const totalPages = data.metadata?.totalPages ?? 0;
	return {
		books: booksToEntries(books),
		hasNext: opts.page < totalPages,
	};
}

async function fetchStoryDetail(uid: string): Promise<SwStoryDetail> {
	const res = await apiGet(storyApiUrl(uid));
	const data = res.json as SwStoryDetailResponse;
	const story = data.data;
	if (data.ok !== true || story === undefined) {
		throw new Error(`storyweaver: story ${uid} not found`);
	}
	return story;
}

async function fetchStoryPages(uid: string): Promise<SwReaderData> {
	const res = await apiGet(storyReadUrl(uid));
	const data = res.json as SwReaderResponse;
	const reader = data.data;
	if (data.ok !== true || reader === undefined) {
		throw new Error(`storyweaver: reader payload for ${uid} not found`);
	}
	return reader;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		language: new ExtensionSetting<string>(
			"language",
			LANGUAGE_OPTIONS[0].value,
			"Extension",
		)
			.setLabel("Language filter")
			.setUI(
				new Dropdown(
					LANGUAGE_OPTIONS.map(({ value, label }) => ({ value, label })),
				),
			),
		sort: new ExtensionSetting<string>(
			"sort",
			SORT_OPTIONS[0].value,
			"Extension",
		)
			.setLabel("Browse order")
			.setUI(
				new Dropdown(
					SORT_OPTIONS.map(({ value, label }) => ({ value, label })),
				),
			),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const result = await fetchBooksPage({
			page: Math.max(0, page) + 1,
			sort: String(await this.settings.sort.get()),
			language: String(await this.settings.language.get()).trim(),
		});
		return { content: result.books, hasnext: result.hasNext };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const result = await fetchBooksPage({
			page: Math.max(0, page) + 1,
			query,
			sort: "Relevance",
			language: String(await this.settings.language.get()).trim(),
		});
		return { content: result.books, hasnext: result.hasNext };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid.trim();
		if (uid.length === 0) {
			throw new Error(`storyweaver: invalid entry id "${entryid.uid}"`);
		}
		const story = await fetchStoryDetail(uid);
		const detail = storyToDetail(story, uid);
		if (!detail) {
			throw new Error(`storyweaver: story ${uid} has no usable title`);
		}
		const entry: EntryDetailed = { ...detail, ui: detailUI(story, uid) };
		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const uid = epid.uid.trim();
		if (uid.length === 0) {
			throw new Error(`storyweaver: invalid episode id "${epid.uid}"`);
		}
		const reader = await fetchStoryPages(uid);
		const links = orderReaderPages(reader.pages ?? [])
			.map((page) => bestImageUrl(page.coverImage))
			.filter((url): url is string => url !== undefined);
		if (links.length === 0) {
			throw new Error(`storyweaver: story ${uid} has no readable pages`);
		}
		return {
			settings,
			source: {
				type: "Imagelist",
				links: links.map((url) => ({ url })),
				audio: null,
			},
		};
	}
}

/** Attribution, credits and links shown under the story description. */
function detailUI(story: SwStoryDetail, uid: string): CustomUI {
	const illustrators = personNames(story.illustrators);
	const publisher = cleanText(story.publisher?.name);
	const copyright = cleanText(story.copyrightNotice);
	return Column(
		Text(LICENSE_NOTE),
		illustrators.length > 0
			? Text(`Illustrated by ${illustrators.join(", ")}.`)
			: undefined,
		publisher.length > 0 ? Text(`Published by ${publisher}.`) : undefined,
		copyright.length > 0 ? FoldableText(copyright) : undefined,
		Link(storyPageUrl(cleanText(story.slug) || uid), "Read on StoryWeaver"),
		Link("https://storyweaver.org.in/", "StoryWeaver by Pratham Books"),
	);
}
