import type {
	Entry,
	EntryDetailed,
	Link,
} from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints & constants
//
// peppercarrot.com is a static-ish site with one relevant host. Every page is
// served per language under `/<lang>/...`; untranslated content silently falls
// back to English on the server side, which keeps client-side fallbacks simple.
//
// - Episode listing: `/<lang>/webcomics/peppercarrot.html` — one figure per
//   episode, newest first, with a cache thumbnail, localized title and the
//   publication date in the caption.
// - Episode page: `/<lang>/webcomic/<slug>.html` — the page images live in
//   `div.webcomic-page > img` tags, in reading order.
// - Page images: `/0_sources/<slug>/low-res/<lang>_Pepper-and-Carrot_by-
//   David-Revoy_E<ep>P<page>.jpg` on the same host. P00 is the header/cover.
//
// Content is CC BY 4.0, so attribution is shown in the detail UI.
// ---------------------------------------------------------------------------

export const SITE_URL = "https://www.peppercarrot.com/";
export const ICON_URL = "https://www.peppercarrot.com/core/img/favicon.png";

export const AUTHOR = "David Revoy";
export const LICENSE_NOTE =
	"Pepper&Carrot by David Revoy — licensed under CC BY 4.0 (peppercarrot.com).";
export const SERIES_DESCRIPTION =
	"Pepper&Carrot is a free (libre) and open-source fantasy webcomic by David " +
	"Revoy about Pepper, a young witch, and her mischievous cat Carrot. A " +
	"comedic journey for all ages, translated by its community into 30+ languages.";

export const LANGUAGE_SETTING_ID = "language";
export const DEFAULT_LANGUAGE = "en";

/** `/<lang>/webcomics/peppercarrot.html` — thumbnail grid, newest first. */
export function listingUrl(lang: string): string {
	return `${SITE_URL}${encodePathSegment(lang)}/webcomics/peppercarrot.html`;
}

/** `/<lang>/webcomic/<slug>.html` — one episode's page images. */
export function episodePageUrl(lang: string, slug: string): string {
	return `${SITE_URL}${encodePathSegment(lang)}/webcomic/${encodePathSegment(slug)}.html`;
}

/** encodeURIComponent for path pieces, keeping `/` out of the way (it cannot
 * occur in lang codes or episode slugs, but be defensive). */
function encodePathSegment(value: string): string {
	return encodeURIComponent(value).replaceAll("%2F", "/");
}

// ---------------------------------------------------------------------------
// Languages
//
// Codes are the site's own short codes (they appear in URLs and in the
// `_`-prefixed image filenames). A missing translation is not a problem: the
// site serves English images for untranslated episodes automatically.
// ---------------------------------------------------------------------------

export const LANGUAGES: { value: string; label: string }[] = [
	{ value: "en", label: "English" },
	{ value: "fr", label: "Français (French)" },
	{ value: "de", label: "Deutsch (German)" },
	{ value: "es", label: "Español (Spanish)" },
	{ value: "cn", label: "中文 (Chinese, Simplified)" },
	{ value: "ja", label: "日本語 (Japanese)" },
	{ value: "kr", label: "한국어 (Korean)" },
	{ value: "nl", label: "Nederlands (Dutch)" },
	{ value: "nn", label: "Norsk nynorsk (Norwegian Nynorsk)" },
	{ value: "no", label: "Norsk bokmål (Norwegian Bokmål)" },
	{ value: "fi", label: "Suomi (Finnish)" },
	{ value: "sv", label: "Svenska (Swedish)" },
	{ value: "da", label: "Dansk (Danish)" },
	{ value: "cs", label: "Čeština (Czech)" },
	{ value: "sk", label: "Slovenčina (Slovak)" },
	{ value: "sl", label: "Slovenščina (Slovenian)" },
	{ value: "hr", label: "Hrvatski (Croatian)" },
	{ value: "pl", label: "Polski (Polish)" },
	{ value: "hu", label: "Magyar (Hungarian)" },
	{ value: "ro", label: "Română (Romanian)" },
	{ value: "it", label: "Italiano (Italian)" },
	{ value: "pt", label: "Português Brasil (Portuguese, Brazil)" },
	{ value: "mx", label: "Español mexicano (Spanish, Mexico)" },
	{ value: "eo", label: "Esperanto" },
	{ value: "ca", label: "Català (Catalan)" },
	{ value: "oc", label: "Occitan lengadocian" },
	{ value: "gd", label: "Gàidhlig (Scottish Gaelic)" },
	{ value: "br", label: "Brezhoneg (Breton)" },
	{ value: "el", label: "Ελληνικά (Greek)" },
	{ value: "ru", label: "Русский (Russian)" },
	{ value: "uk", label: "Українська (Ukrainian)" },
	{ value: "tr", label: "Türkçe (Turkish)" },
	{ value: "vi", label: "Tiếng Việt (Vietnamese)" },
	{ value: "id", label: "Bahasa Indonesia (Indonesian)" },
	{ value: "ms", label: "Bahasa Melayu (Malay)" },
	{ value: "fa", label: "فارسی (Persian)" },
	{ value: "ar", label: "العربية (Arabic)" },
	{ value: "he", label: "עברית (Hebrew)" },
	{ value: "hi", label: "हिन्दी (Hindi)" },
	{ value: "bn", label: "বাংলা (Bengali)" },
	{ value: "ta", label: "தமிழ் (Tamil)" },
	{ value: "tl", label: "Tagalog (Filipino)" },
	{ value: "lt", label: "Lietuvių (Lithuanian)" },
	{ value: "tp", label: "toki pona" },
	{ value: "kw", label: "Kernewek (Cornish)" },
];

/** Normalize a language setting value; anything unknown resolves to English. */
export function normalizeLang(lang: string | undefined | null): string {
	const value = (lang ?? "").trim().toLowerCase();
	return LANGUAGES.some((l) => l.value === value) ? value : DEFAULT_LANGUAGE;
}

// ---------------------------------------------------------------------------
// Episode slugs
// ---------------------------------------------------------------------------

/** Episode slug, e.g. `ep39_The-Tavern` or `ep05_Special-holiday-episode`. */
export type EpisodeSlug = string;

const EPISODE_NUMBER_RE = /^ep(\d+)/;

/** Validate a slug and return its episode number; null when invalid. */
export function episodeNumber(slug: string): number | null {
	const match = EPISODE_NUMBER_RE.exec(slug.trim());
	if (!match) {
		return null;
	}
	const num = Number(match[1]);
	return Number.isInteger(num) && num > 0 ? num : null;
}

/** True when the uid looks like a valid episode slug. */
export function isEpisodeSlug(slug: string): boolean {
	return episodeNumber(slug) !== null;
}

/** Extract the episode slug from an episode/listing href; null when absent. */
export function slugFromUrl(url: string): string | null {
	const match = /\/webcomic\/(ep[^/?#]+)\.html/i.exec(url);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Page images
// ---------------------------------------------------------------------------

const PAGE_IMAGE_PATTERN = /_E\d+P(\d+)\.(?:jpg|jpeg|png|gif|webp)$/i;

/** Page number (0 = header/cover) from a page-image URL; null when not one. */
export function pageNumber(url: string): number | null {
	const match = PAGE_IMAGE_PATTERN.exec(url);
	if (!match) {
		return null;
	}
	const num = Number(match[1]);
	return Number.isInteger(num) && num >= 0 ? num : null;
}

/** True for episode page images (`/0_sources/<slug>/low-res/...`). */
export function isPageImageUrl(url: string): boolean {
	return url.includes("/0_sources/") && pageNumber(url) !== null;
}

/**
 * Filter raw `<img src>` values down to episode page images and sort them into
 * reading order (P00 header first, then numerically: P2 before P10). Stable
 * for already-ordered input; unknown urls are dropped.
 */
export function pageImagesFromSrcs(srcs: string[]): string[] {
	const pages = srcs
		.map((src, index) => ({ url: src.trim(), index }))
		.filter((page) => isPageImageUrl(page.url));
	pages.sort((a, b) => {
		const diff = (pageNumber(a.url) ?? 0) - (pageNumber(b.url) ?? 0);
		return diff !== 0 ? diff : a.index - b.index;
	});
	return pages.map((page) => page.url);
}

// ---------------------------------------------------------------------------
// HTML text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

/** Decode HTML entities (`&amp;`, `&#39;`, `&#x27;`, ...) in attribute or
 * text values. Idempotent for already-decoded plain text. */
export function decodeHtmlEntities(text: string): string {
	return text.replace(
		/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(entity, body: string) => {
			if (body.startsWith("#x") || body.startsWith("#X")) {
				const code = Number.parseInt(body.slice(2), 16);
				return Number.isNaN(code) ? entity : safeFromCodePoint(code);
			}
			if (body.startsWith("#")) {
				const code = Number.parseInt(body.slice(1), 10);
				return Number.isNaN(code) ? entity : safeFromCodePoint(code);
			}
			return NAMED_ENTITIES[body] ?? entity;
		},
	);
}

function safeFromCodePoint(code: number): string {
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

/** Publication date (`YYYY-MM-DD`) from a listing caption like
 * `Published on 2025-11-12.`; null when the caption has no date. */
export function publishedDateFromCaption(caption: string): string | null {
	const match = /Published on (\d{4}-\d{2}-\d{2})/i.exec(caption);
	return match?.[1] ?? null;
}

/** Collapse whitespace runs and trim decoded text. */
export function cleanText(text: string): string {
	return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Search & pagination
// ---------------------------------------------------------------------------

/** Case-insensitive free-text match over the episode title and slug. */
export function matchesEpisode(episode: EpisodeMeta, query: string): boolean {
	const term = query.trim().toLowerCase();
	if (term.length === 0) {
		return false;
	}
	return (
		episode.title.toLowerCase().includes(term) ||
		episode.slug.toLowerCase().includes(term)
	);
}

/** Slice one page out of a list. */
export function paginate<T>(
	items: T[],
	page: number,
	size: number,
): { content: T[]; hasnext: boolean } {
	const start = Math.max(0, page) * size;
	const content = items.slice(start, start + size);
	return { content, hasnext: start + size < items.length };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Metadata of one episode as parsed from the listing page. */
export interface EpisodeMeta {
	slug: string;
	/** Localized display title, e.g. "Episode 39: The Tavern". */
	title: string;
	/** Episode page URL in the listing's language. */
	url: string;
	/** Thumbnail URL (site cache), when the listing exposes one. */
	thumb?: string;
	/** Publication date `YYYY-MM-DD`, when the caption exposes one. */
	published?: string;
}

/** One browse row per episode; null when the listing row has no usable slug. */
export function episodeToEntry(episode: EpisodeMeta): Entry | null {
	if (!isEpisodeSlug(episode.slug)) {
		return null;
	}
	return {
		id: { uid: episode.slug },
		url: episode.url,
		title: episode.title,
		media_type: "Comic",
		cover: episode.thumb ? { url: episode.thumb } : undefined,
		author: [AUTHOR],
	};
}

/** Human readable fallback title derived from the slug. */
export function fallbackTitle(slug: string): string {
	const num = episodeNumber(slug);
	if (num === null) {
		return slug;
	}
	const words = slug
		.replace(EPISODE_NUMBER_RE, "")
		.replace(/^[-_]+/, "")
		.split(/[-_]/)
		.filter((word) => word.length > 0);
	const name = words.join(" ");
	return name.length > 0 ? `Episode ${num}: ${name}` : `Episode ${num}`;
}

/** Base detail view (without custom UI); `pageCount` comes from the fetched
 * episode page and is appended to the description when known. */
export function episodeToDetail(
	episode: EpisodeMeta,
	lang: string,
	pageCount: number | null,
	pageCover?: string,
): EntryDetailed {
	const url = episode.url;
	const published = episode.published
		? `Published on ${episode.published}.`
		: null;
	const pages =
		pageCount !== null && pageCount > 0 ? `${pageCount} pages.` : null;
	const description = [SERIES_DESCRIPTION, published, pages, LICENSE_NOTE]
		.filter((part): part is string => part !== null)
		.join("\n\n");
	const cover: Link | undefined = episode.thumb
		? { url: episode.thumb }
		: pageCover
			? { url: pageCover }
			: undefined;
	return {
		id: { uid: episode.slug },
		url,
		titles: [episode.title],
		author: [AUTHOR],
		media_type: "Comic",
		status: "Complete",
		description,
		language: lang,
		cover,
		poster: cover,
		episodes: [
			{
				id: { uid: episode.slug },
				name: "Read",
				url,
			},
		],
		genres: ["Fantasy", "Comedy", "All ages"],
		meta: episode.published ? { Published: episode.published } : null,
	};
}
