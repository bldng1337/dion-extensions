import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
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
import { fetch } from "network";
import type { BookCard, AuthorLink } from "./site.ts";
import {
	BASE,
	CATEGORIES,
	CATEGORY_SETTING_ID,
	FORMAT_EPUB,
	FORMAT_PDF,
	FORMAT_SETTING_ID,
	MAX_AUTHOR_FETCHES,
	PAGE_SIZE,
	RECENT_VALUE,
	absoluteUrl,
	bookUidFromHref,
	bookUrl,
	isAuthorPageHref,
	matchesQuery,
	parseAuthorList,
	parseBookCards,
	parseBookPage,
	parseDownloadCandidates,
	parseSitemap,
	pickDownload,
	slugTitle,
	tokenizeQuery,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (a past-the-end listing page), an error
 * on other failures. */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: { Accept: "text/html,application/xhtml+xml,application/xml" },
	});
	if (!res.ok) {
		if (res.status === 404) {
			return null;
		}
		throw new Error(`Global Grey request failed (${res.status}): ${url}`);
	}
	return res.body;
}

/** A book card as a browse/search Entry. */
function cardToEntry(card: BookCard): Entry {
	return {
		id: { uid: card.uid },
		url: bookUrl(card.uid),
		title: card.title,
		media_type: "Book",
		cover: card.cover ? { url: card.cover } : null,
		author: card.author ? [card.author] : null,
	};
}

// ---------------------------------------------------------------------------
// Session caches — the catalog is small, so every catalog page is fetched at
// most once per session.
// ---------------------------------------------------------------------------

let catalogCache: string[] | null = null;
let authorListCache: AuthorLink[] | null = null;
const authorPageCache = new Map<string, BookCard[]>();

/** Every book page uid, from sitemap.xml. */
async function catalog(): Promise<string[]> {
	if (catalogCache === null) {
		const body = await fetchPage(`${BASE}/sitemap.xml`);
		catalogCache = body ? parseSitemap(body) : [];
	}
	return catalogCache;
}

/** The authors index (name -> author page or single ebook page). */
async function authorList(): Promise<AuthorLink[]> {
	if (authorListCache === null) {
		const body = await fetchPage(`${BASE}/authors.html`);
		authorListCache = body ? parseAuthorList(body) : [];
	}
	return authorListCache;
}

/** The book cards of one author page. */
async function authorBooks(href: string): Promise<BookCard[]> {
	let cards = authorPageCache.get(href);
	if (!cards) {
		const body = await fetchPage(absoluteUrl(href));
		cards = body ? parseBookCards(body) : [];
		authorPageCache.set(href, cards);
	}
	return cards;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		category: new ExtensionSetting<string>(
			CATEGORY_SETTING_ID,
			"fiction-general",
			"Search",
		)
			.setLabel("Browse category")
			.setUI(new Dropdown(CATEGORIES)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const category = await this.settings.category.get();
		if (category === RECENT_VALUE) {
			if (page > 0) {
				return { content: [], hasnext: false };
			}
			const body = await fetchPage(`${BASE}/recently-added.html`);
			const content = (body ? parseBookCards(body) : []).map(cardToEntry);
			return { content, hasnext: false };
		}
		// Dion pages are 0-based, the site's category pages are 1-based.
		const url = `${BASE}/category/ebooks/${category}-page-${Math.max(0, page) + 1}.html`;
		const body = await fetchPage(url);
		if (body === null) {
			return { content: [], hasnext: false };
		}
		const content = parseBookCards(body).map(cardToEntry);
		return {
			content,
			hasnext: content.length > 0 && body.includes(`-page-${page + 2}.html`),
		};
	}

	/** The site has no server-side search (only a Google form), so search
	 * filters client-side over a session-cached catalog: the sitemap (titles)
	 * plus the authors index, expanding matching author pages into their
	 * books so author queries like "grimm" work. */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const tokens = tokenizeQuery(query);

		const entries: Entry[] = [];
		const seen = new Set<string>();
		const push = (entry: Entry) => {
			if (!seen.has(entry.id.uid)) {
				seen.add(entry.id.uid);
				entries.push(entry);
			}
		};

		// 1) Books by matching authors (rich cards with author + cover).
		const matched = (await authorList()).filter((author) =>
			matchesQuery(author.name.toLowerCase(), tokens),
		);
		for (const author of matched.slice(0, MAX_AUTHOR_FETCHES)) {
			if (isAuthorPageHref(author.href)) {
				for (const card of await authorBooks(author.href)) {
					push(cardToEntry(card));
				}
			} else {
				const uid = bookUidFromHref(author.href);
				if (uid) {
					push({
						id: { uid },
						url: bookUrl(uid),
						title: slugTitle(uid),
						media_type: "Book",
						author: [author.name],
					});
				}
			}
		}

		// 2) Title matches from the sitemap-derived catalog.
		for (const uid of await catalog()) {
			if (matchesQuery(uid, tokens)) {
				push({
					id: { uid },
					url: bookUrl(uid),
					title: slugTitle(uid),
					media_type: "Book",
				});
			}
		}

		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: entries.slice(start, start + PAGE_SIZE),
			hasnext: start + PAGE_SIZE < entries.length,
			length: entries.length,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const body = await fetchPage(bookUrl(uid));
		if (body === null) {
			throw new Error(`Global Grey: book ${uid} not found`);
		}
		const info = parseBookPage(body);

		const sstore = new SettingStore(settings);
		sstore.getOrDefine<string>({
			id: FORMAT_SETTING_ID,
			defaultval: FORMAT_EPUB,
			label: "Format",
			ui: new Dropdown([
				{ value: FORMAT_EPUB, label: "EPUB" },
				{ value: FORMAT_PDF, label: "PDF" },
			]),
		});

		const title = info.title || slugTitle(uid);
		const meta: Record<string, string> = {};
		if (info.year) {
			meta["First published"] = info.year;
		}
		if (info.series) {
			meta.Series = info.series;
		}
		if (info.translator) {
			meta.Translator = info.translator;
		}
		if (info.pages !== null) {
			meta.Pages = `${info.pages}`;
		}

		const entry: EntryDetailed = {
			id: { uid },
			url: bookUrl(uid),
			titles: [title],
			author: info.author ? [info.author] : null,
			media_type: "Book",
			status: "Complete",
			description: info.description || title,
			language: info.language,
			cover: info.cover ? { url: info.cover } : null,
			episodes: [
				{
					id: {
						uid,
						iddata: JSON.stringify({
							epub: info.downloads.epub,
							pdf: info.downloads.pdf,
						}),
					},
					name: "Read",
					url: bookUrl(uid),
				},
			],
			genres: info.genres.length > 0 ? info.genres : null,
			meta: Object.keys(meta).length > 0 ? meta : null,
			ui: Column(
				Text("Links"),
				Link(bookUrl(uid), "Open at Global Grey Ebooks"),
				info.downloads.azw3
					? Link(info.downloads.azw3, "Download for Kindle (azw3)")
					: undefined,
				info.wikipedia ? Link(info.wikipedia, "Wikipedia") : undefined,
			),
		};

		return { entry, settings: { ...settings, ...sstore.toMap() } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let candidates = parseDownloadCandidates(epid.iddata);
		if (!candidates || (!candidates.epub && !candidates.pdf)) {
			// Entry opened without going through detail(): re-read the book
			// page for its download links.
			const body = await fetchPage(bookUrl(epid.uid));
			if (body === null) {
				throw new Error(`Global Grey: book ${epid.uid} not found`);
			}
			const downloads = parseBookPage(body).downloads;
			candidates = { epub: downloads.epub, pdf: downloads.pdf };
		}
		const format =
			new SettingStore(settings).tryGet<string>(FORMAT_SETTING_ID) ??
			FORMAT_EPUB;
		const pick = pickDownload(candidates, format);
		if (!pick) {
			throw new Error(
				`Global Grey: no EPUB or PDF download available for ${epid.uid}`,
			);
		}
		return {
			source: { type: pick.type, link: { url: pick.url } },
			settings: { ...settings },
		};
	}
}
