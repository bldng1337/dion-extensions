import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
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
	BASE,
	FORMAT_ADVANCED,
	FORMAT_COMPATIBLE,
	FORMAT_SETTING_ID,
	PAGE_SIZE,
	SORTS,
	SORT_SETTING_ID,
	bookUrl,
	coverUrl,
	fallbackEpubUrl,
	formatCount,
	hasNextPage,
	parseBookPage,
	parseEpubCandidates,
	parseListing,
	pickEpubHref,
	withDownloadParam,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: { Accept: "text/html,application/xhtml+xml" },
	});
	if (!res.ok) {
		throw new Error(`Standard Ebooks request failed (${res.status}): ${url}`);
	}
	return res.body;
}

/** Builds a listing/search URL. Dion pages are 0-based, the site's are 1-based. */
function listingUrl(page: number, query: string | null, sort: string): string {
	const params = [
		"view=list",
		`per-page=${PAGE_SIZE}`,
		`page=${Math.max(0, page) + 1}`,
	];
	if (sort && sort !== "default") {
		params.push(`sort=${encodeURIComponent(sort)}`);
	}
	if (query !== null) {
		params.push(`query=${encodeURIComponent(query)}`);
	}
	return `${BASE}/ebooks?${params.join("&")}`;
}

async function fetchEntries(
	page: number,
	query: string | null,
	sort: string,
): Promise<EntryList> {
	const url = listingUrl(page, query, sort);
	const body = await fetchPage(url);
	const content = parseListing(body).map(
		(book): Entry => ({
			id: { uid: book.uid },
			url: bookUrl(book.uid),
			title: book.title,
			media_type: "Book",
			cover: { url: coverUrl(book.uid) },
			author: book.authors.length > 0 ? book.authors : null,
		}),
	);
	return { content, hasnext: hasNextPage(body, page) };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		sort: new ExtensionSetting<string>(SORT_SETTING_ID, "default", "Search")
			.setLabel("Sort by")
			.setUI(new Dropdown(SORTS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const sort = await this.settings.sort.get();
		return fetchEntries(page, null, sort);
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const sort = await this.settings.sort.get();
		return fetchEntries(page, query, sort);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const info = parseBookPage(await fetchPage(bookUrl(uid)));

		const sstore = new SettingStore(settings);
		sstore.getOrDefine<string>({
			id: FORMAT_SETTING_ID,
			defaultval: FORMAT_COMPATIBLE,
			label: "EPUB variant",
			ui: new Dropdown([
				{ value: FORMAT_COMPATIBLE, label: "Compatible (all ereaders)" },
				{ value: FORMAT_ADVANCED, label: "Advanced (latest technology)" },
			]),
		});

		const title = info.title || uid.split("/").pop() || uid;
		const authorLine = info.authors.length > 0 ? info.authors : null;

		const meta: Record<string, string> = {};
		if (info.translators.length > 0) {
			meta.Translators = info.translators.join(", ");
		}
		if (info.wordCount !== null) {
			meta.Words = formatCount(info.wordCount);
		}
		if (info.readingEase) {
			meta["Reading ease"] = info.readingEase;
		}
		if (info.readingTime) {
			meta["Reading time"] = info.readingTime;
		}
		if (info.released) {
			meta.Released = info.released;
		}
		if (info.collections.length > 0) {
			meta.Collections = info.collections.join("; ");
		}

		const links: CustomUI[] = [Link(bookUrl(uid), "Open at Standard Ebooks")];
		if (info.wikipedia) {
			links.push(Link(info.wikipedia, "Wikipedia"));
		}
		if (info.azw3) {
			links.push(
				Link(withDownloadParam(info.azw3), "Download for Kindle (azw3)"),
			);
		}
		if (info.kepub) {
			links.push(
				Link(withDownloadParam(info.kepub), "Download for Kobo (kepub)"),
			);
		}

		const episode: Episode = {
			id: { uid, iddata: JSON.stringify(info.epub) },
			name: title,
			url: bookUrl(uid),
		};

		const entry: EntryDetailed = {
			id: { uid },
			url: bookUrl(uid),
			titles: [title],
			author: authorLine,
			media_type: "Book",
			status: "Complete",
			description: info.description || info.abstract || title,
			language: info.language,
			cover: { url: coverUrl(uid) },
			episodes: [episode],
			genres: info.subjects.length > 0 ? info.subjects : null,
			meta: Object.keys(meta).length > 0 ? meta : null,
			ui: Column(Text("Links"), ...links),
		};

		return { entry, settings: { ...settings, ...sstore.toMap() } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const candidates = parseEpubCandidates(epid.iddata);
		let url: string;
		if (candidates && (candidates.compatible || candidates.advanced)) {
			const format =
				new SettingStore(settings).tryGet<string>(FORMAT_SETTING_ID) ??
				FORMAT_COMPATIBLE;
			const href = pickEpubHref(candidates, format);
			if (!href) {
				throw new Error(
					`Standard Ebooks: no EPUB download available for ${epid.uid}`,
				);
			}
			url = withDownloadParam(href);
		} else {
			// Entry opened without going through detail(): construct the
			// compatible-EPUB URL from the book path.
			url = fallbackEpubUrl(epid.uid);
		}
		return {
			source: { type: "Epub", link: { url } },
			settings: { ...settings },
		};
	}
}
