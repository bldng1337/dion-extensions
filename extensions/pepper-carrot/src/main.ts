import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml, type DionElement } from "parse";
import {
	DEFAULT_LANGUAGE,
	type EpisodeMeta,
	LANGUAGES,
	LICENSE_NOTE,
	LANGUAGE_SETTING_ID,
	cleanText,
	episodePageUrl,
	episodeToDetail,
	episodeToEntry,
	fallbackTitle,
	isEpisodeSlug,
	listingUrl,
	matchesEpisode,
	normalizeLang,
	pageImagesFromSrcs,
	paginate,
	publishedDateFromCaption,
	SITE_URL,
	slugFromUrl,
} from "./peppercarrot.ts";

// ---------------------------------------------------------------------------
// Site client
//
// All content sits on one host. The per-language listing page doubles as the
// browse/search index (newest first, with thumbnails and dates); episode pages
// carry the page images in reading order. Everything is cached per session
// because episodes are essentially immutable.
// ---------------------------------------------------------------------------

/** Session cache of parsed listing pages, keyed by language. */
const listingCache = new Map<string, Promise<EpisodeMeta[]>>();

/** The runtime requires CSSSelector objects, not selector strings. */
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

/** Parse one figure of the listing grid into episode metadata. */
function figureToEpisode(figure: DionElement): EpisodeMeta | null {
	const href = figure.select(q("a")).attr("href")[0];
	const slug = href ? slugFromUrl(href) : null;
	if (!slug || !isEpisodeSlug(slug)) {
		return null;
	}
	const thumb = figure.select(q("img")).attr("src")[0];
	const title =
		cleanText(figure.select(q("figcaption a")).text) || fallbackTitle(slug);
	const caption = cleanText(figure.select(q("figcaption span")).text);
	const published = publishedDateFromCaption(caption) ?? undefined;
	return {
		slug,
		title,
		url: cleanText(href ?? ""),
		thumb: thumb ? cleanText(thumb) : undefined,
		published,
	};
}

/** Parse the listing HTML into episode metadata, newest first. */
function parseListing(html: string): EpisodeMeta[] {
	const doc = parseHtml(html);
	const figures = doc.select(q("figure.thumbnail"));
	const episodes: EpisodeMeta[] = [];
	for (let i = 0; i < figures.length; i++) {
		const figure = figures.get(i);
		if (!figure) {
			continue;
		}
		const episode = figureToEpisode(figure);
		if (episode) {
			episodes.push(episode);
		}
	}
	return episodes;
}

/** Fetch and cache the listing page of one language. */
function listing(lang: string): Promise<EpisodeMeta[]> {
	const code = normalizeLang(lang);
	const cached = listingCache.get(code);
	if (cached) {
		return cached;
	}
	const promise = (async () => {
		const res = await fetch(listingUrl(code));
		if (!res.ok) {
			throw new Error(
				`pepper-carrot: listing request failed (${res.status}) for lang "${code}"`,
			);
		}
		const episodes = parseListing(res.body);
		if (episodes.length === 0) {
			throw new Error(
				`pepper-carrot: no episodes found on the "${code}" listing page`,
			);
		}
		return episodes;
	})().catch((err: unknown) => {
		// Retry the next time instead of caching the failure forever.
		listingCache.delete(code);
		throw err;
	});
	listingCache.set(code, promise);
	return promise;
}

/** Listing metadata for one language, falling back to the English listing. */
async function listingWithFallback(lang: string): Promise<EpisodeMeta[]> {
	const code = normalizeLang(lang);
	if (code === DEFAULT_LANGUAGE) {
		return listing(code);
	}
	try {
		const episodes = await listing(code);
		if (episodes.length > 0) {
			return episodes;
		}
	} catch {
		// Fall through to the English listing below.
	}
	return listing(DEFAULT_LANGUAGE);
}

/** Find an episode in a listing, tolerating missing entries. */
function findEpisode(
	episodes: EpisodeMeta[],
	slug: string,
): EpisodeMeta | undefined {
	return episodes.find((episode) => episode.slug === slug);
}

/** The page image URLs of one episode page (reading order). */
function parseEpisodeImages(html: string): string[] {
	const doc = parseHtml(html);
	const srcs = doc.select(q("div.webcomic-page img")).attr("src");
	return pageImagesFromSrcs(srcs);
}

/** Fetched episode page: absolute page image URLs in reading order. */
interface EpisodePage {
	images: string[];
}

async function fetchEpisodePage(
	lang: string,
	slug: string,
): Promise<EpisodePage> {
	const code = normalizeLang(lang);
	const load = async (langCode: string): Promise<string[]> => {
		const res = await fetch(episodePageUrl(langCode, slug));
		// Untranslated episodes fall back to English on the server side, so a
		// 200 with zero images means the page shape changed, not a translation
		// gap.
		if (!res.ok) {
			throw new Error(
				`pepper-carrot: episode request failed (${res.status}) on ${langCode}/${slug}`,
			);
		}
		return parseEpisodeImages(res.body);
	};
	// A language edition with a partial/missing translation still serves a
	// usable page (the site falls back per page); only a broken request makes
	// us retry in English.
	if (code !== DEFAULT_LANGUAGE) {
		try {
			const images = await load(code);
			if (images.length > 0) {
				return { images };
			}
		} catch {
			// Fall through to the English page below.
		}
	}
	const images = await load(DEFAULT_LANGUAGE);
	if (images.length === 0) {
		throw new Error(`pepper-carrot: episode ${slug} has no page images`);
	}
	return { images };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const PAGE_SIZE = 40;

export default class extends DionExtension implements SourceProvider {
	settings = {
		language: new ExtensionSetting<string>(
			LANGUAGE_SETTING_ID,
			DEFAULT_LANGUAGE,
			"Extension",
		)
			.setLabel("Language (translation of the comics)")
			.setUI(new Dropdown(LANGUAGES)),
	};
	accounts = {};
	entrySettings = {};

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const lang = normalizeLang(await this.settings.language.get());
		const episodes = await listingWithFallback(lang);
		const entries = episodes
			.map(episodeToEntry)
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
		const result = paginate(entries, page, PAGE_SIZE);
		return { content: result.content, hasnext: result.hasnext };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const lang = normalizeLang(await this.settings.language.get());
		const episodes = await listingWithFallback(lang);
		const hits = episodes
			.filter((episode) => matchesEpisode(episode, query))
			.map(episodeToEntry)
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
		const result = paginate(hits, page, PAGE_SIZE);
		return { content: result.content, hasnext: result.hasnext };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const slug = entryid.uid;
		if (!isEpisodeSlug(slug)) {
			throw new Error(`pepper-carrot: invalid entry id "${slug}"`);
		}
		const lang = normalizeLang(await this.settings.language.get());
		const [episodes, page] = await Promise.all([
			listingWithFallback(lang),
			fetchEpisodePage(lang, slug),
		]);
		const meta =
			findEpisode(episodes, slug) ??
			({
				slug,
				title: fallbackTitle(slug),
				url: episodePageUrl(lang, slug),
			} satisfies EpisodeMeta);
		const entry = episodeToDetail(
			meta,
			lang,
			page.images.length,
			page.images[0],
		);
		return {
			entry: { ...entry, ui: detailUI(meta, page.images.length) },
			settings,
		};
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const slug = epid.uid;
		if (!isEpisodeSlug(slug)) {
			throw new Error(`pepper-carrot: invalid episode id "${slug}"`);
		}
		const lang = normalizeLang(await this.settings.language.get());
		const page = await fetchEpisodePage(lang, slug);
		return {
			settings,
			source: {
				type: "Imagelist",
				links: page.images.map((url) => ({ url })),
				audio: null,
			},
		};
	}
}

/** License attribution + a link to the canonical episode page. */
function detailUI(meta: EpisodeMeta, pageCount: number): CustomUI {
	const episodeUrl = meta.url || SITE_URL;
	return Column(
		Text(LICENSE_NOTE),
		meta.published
			? Text(`Published on ${meta.published} — ${pageCount} pages.`)
			: Text(`${pageCount} pages.`),
		Link(episodeUrl, "Read on peppercarrot.com"),
	);
}
