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
	EpisodeId,
	EventData,
	EventResult,
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	ALL_SERIES,
	articleNumber,
	articleUrl,
	ATTRIBUTION_NOTE,
	composeDescription,
	composeTitle,
	episodeUid,
	extractArticleRegion,
	parseArticleParagraphs,
	parseArticleSlug,
	parseContentWarning,
	parseEpisodeUid,
	parseItemNumber,
	parseLicenseAuthor,
	parseObjectClass,
	parsePageTitle,
	parseRating,
	parseSeriesList,
	parseTags,
	PAGE_SIZE,
	SERIES,
	seriesUrl,
	SERIES_SETTING_ID,
	USER_AGENT,
	type SeriesItem,
	type SourceParagraph,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (deleted/unpublished pages), error otherwise. */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html",
		},
	});
	if (!res.ok) {
		if (res.status === 404) {
			return null;
		}
		throw new Error(`SCP Wiki request failed (${res.status}): ${url}`);
	}
	return res.body;
}

// ---------------------------------------------------------------------------
// Caches — series listings and article pages are fetched at most once per
// session (module-level Maps). Failed fetches evict their promise so a later
// call retries instead of caching the failure forever.
// ---------------------------------------------------------------------------

/** Article title text from a series listing, per slug (when that listing has
 * been loaded). Used to compose "SCP-173 — The Sculpture" titles. */
const seriesTitles = new Map<string, string>();

const seriesCache = new Map<string, Promise<SeriesItem[]>>();

function loadSeries(slug: string): Promise<SeriesItem[]> {
	const cached = seriesCache.get(slug);
	if (cached) {
		return cached;
	}
	const task = (async () => {
		const body = await fetchPage(seriesUrl(slug));
		const items = body ? parseSeriesList(body) : [];
		for (const item of items) {
			if (item.title) {
				seriesTitles.set(item.slug, item.title);
			}
		}
		return items;
	})().catch((err: unknown) => {
		seriesCache.delete(slug);
		throw err;
	});
	seriesCache.set(slug, task);
	return task;
}

/** Parsed article data for one slug, cached per session. */
interface ArticleInfo {
	slug: string;
	pageTitle: string | null;
	itemNumber: string | null;
	objectClass: string | null;
	rating: number | null;
	author: string | null;
	tags: string[];
	warning: string | null;
	paragraphs: SourceParagraph[];
}

const articleCache = new Map<string, Promise<ArticleInfo>>();

function loadArticle(slug: string): Promise<ArticleInfo> {
	const cached = articleCache.get(slug);
	if (cached) {
		return cached;
	}
	const task = (async () => {
		const url = articleUrl(slug);
		const body = await fetchPage(url);
		if (body === null) {
			throw new Error(`SCP Wiki: no article page for "${slug}"`);
		}
		const region = extractArticleRegion(body);
		return {
			slug,
			pageTitle: parsePageTitle(body),
			itemNumber: parseItemNumber(body),
			objectClass: parseObjectClass(body),
			rating: parseRating(body),
			author: parseLicenseAuthor(body),
			tags: parseTags(body),
			warning: parseContentWarning(region),
			paragraphs: parseArticleParagraphs(region),
		} satisfies ArticleInfo;
	})().catch((err: unknown) => {
		articleCache.delete(slug);
		throw err;
	});
	articleCache.set(slug, task);
	return task;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		[SERIES_SETTING_ID]: new ExtensionSetting<string>(
			SERIES_SETTING_ID,
			ALL_SERIES,
			"Search",
		)
			.setLabel("Series")
			.setUI(
				new Dropdown([
					{ value: ALL_SERIES, label: "All series" },
					...SERIES.map((series) => ({
						value: series.slug,
						label: series.label,
					})),
				]),
			),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/**
	 * Pages through the SCP series listings (Series I-X, SCP-001-9999,
	 * cached per session), 24 entries per page. The "Series" search filter
	 * narrows the listing ("All series" concatenates every series in order).
	 */
	async browse(page: number): Promise<EntryList> {
		const series = await this.settings[SERIES_SETTING_ID].get();
		const items = await this.itemsFor(series);
		return paginate(items.map(toEntry), page);
	}

	/**
	 * The site has no unauthenticated search API (the Wikidot API requires
	 * auth keys), so search runs client-side over the cached series
	 * listings, matching against the number and the listing title. Scope:
	 * mainline SCP containment files only — not tales, canons or -J jokes.
	 */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim().toLowerCase();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const items = await this.itemsFor(ALL_SERIES);
		const hits = items.filter((item) =>
			`${item.number} ${item.title ?? ""}`.toLowerCase().includes(query),
		);
		return paginate(hits.map(toEntry), page);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const parsed = parseArticleSlug(entryid.uid);
		if (!parsed) {
			throw new Error(`SCP Wiki: invalid article id "${entryid.uid}"`);
		}
		const { slug } = parsed;
		const info = await loadArticle(slug);
		if (info.paragraphs.length === 0) {
			throw new Error(`SCP Wiki: no readable content in "${slug}"`);
		}

		const number = info.itemNumber ?? articleNumber(slug);
		const seriesTitle = seriesTitles.get(slug) ?? null;
		const url = articleUrl(slug);
		const title = detailTitle(number, info, seriesTitle);

		const meta: Record<string, string> = {};
		meta.Item = number;
		if (info.objectClass) {
			meta["Object Class"] = info.objectClass;
		}
		meta.License = "CC BY-SA 3.0";

		const entry: EntryDetailed = {
			id: { uid: slug },
			url,
			titles: [title],
			author: [info.author ?? "The SCP Wiki community"],
			media_type: "Book",
			status: "Complete",
			description:
				composeDescription(info.paragraphs, info.warning) ||
				`${number} — an SCP Foundation containment file on the SCP Wiki.`,
			language: "en",
			episodes: [
				{
					id: { uid: episodeUid(slug) },
					name: "Read",
					url,
				},
			],
			genres: info.tags.length > 0 ? info.tags : null,
			rating: info.rating,
			meta,
			ui: Column(
				Text(ATTRIBUTION_NOTE),
				Divider(),
				Link(url, "Open on the SCP Wiki"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const parsed = parseEpisodeUid(epid.uid);
		if (!parsed) {
			throw new Error(`SCP Wiki: invalid episode id "${epid.uid}"`);
		}
		const info = await loadArticle(parsed.slug);
		const paragraphs = info.paragraphs.map(toParagraph);
		if (paragraphs.length === 0) {
			throw new Error(`SCP Wiki: no readable content in "${parsed.slug}"`);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}

	// -- Helpers -------------------------------------------------------------

	/** Entries of one series slug, or all series concatenated in order. */
	private async itemsFor(series: string): Promise<SeriesItem[]> {
		if (series === ALL_SERIES) {
			const lists = await Promise.all(
				SERIES.map((ref) =>
					loadSeries(ref.slug).catch((err: unknown) => {
						// One unavailable listing should not kill the rest.
						console.error(
							`SCP Wiki: failed to load series ${ref.slug}: ${String(err)}`,
						);
						return [] as SeriesItem[];
					}),
				),
			);
			return lists.flat();
		}
		const slug = SERIES.find((ref) => ref.slug === series)?.slug;
		if (!slug) {
			throw new Error(`SCP Wiki: unknown series "${series}"`);
		}
		return loadSeries(slug);
	}
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toEntry(item: SeriesItem): Entry {
	return {
		id: { uid: item.slug },
		url: item.url,
		title: composeTitle(item.number, item.title),
		media_type: "Book",
	};
}

/** Best detail title: the article page's own title (minus the "SCP-NNNN"
 * prefix it usually repeats) or the series listing title. */
function detailTitle(
	number: string,
	info: ArticleInfo,
	seriesTitle: string | null,
): string {
	let title = seriesTitle;
	const page = info.pageTitle;
	if (page && page.toLowerCase() !== number.toLowerCase()) {
		const stripped = page
			.replace(new RegExp(`^${number}\\s*[-–—:]?\\s*`, "i"), "")
			.trim();
		title = stripped.length > 0 ? stripped : page;
	}
	return composeTitle(number, title);
}

function toParagraph(paragraph: SourceParagraph): Paragraph {
	if (paragraph.kind === "text") {
		return {
			type: "Text",
			content: paragraph.content,
			style: paragraph.bold ? { bold: true } : null,
		};
	}
	return {
		type: "Mixed",
		content: paragraph.parts.map((part) => ({
			type: "Text" as const,
			content: part.content,
			style: part.bold ? { bold: true } : null,
		})),
	};
}

function paginate<T>(
	items: T[],
	page: number,
): { content: T[]; hasnext: boolean; length: number } {
	const start = Math.max(0, page) * PAGE_SIZE;
	const content = items.slice(start, start + PAGE_SIZE);
	return {
		content,
		hasnext: start + PAGE_SIZE < items.length,
		length: content.length,
	};
}
