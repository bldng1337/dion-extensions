import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Column, Image, Link } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	Episode,
	EpisodeId,
	Link as DionLink,
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtmlFragment } from "parse";

// ---------------------------------------------------------------------------
// Endpoints & constants
// ---------------------------------------------------------------------------

// The universe site is a JS shell; all content comes from the meeps CMS and
// the comics CDN. Verified against the traffic the site itself makes.
const EXPLORE_INDEX_URL =
	"https://universe-meeps.leagueoflegends.com/v1/en_us/explore2/index.json";
const storyApiUrl = (storySlug: string) =>
	`https://universe-meeps.leagueoflegends.com/v1/en_us/story/${storySlug}/index.json`;
const comicApiUrl = (comicPath: string) =>
	`https://universe-comics.leagueoflegends.com/comics/en_us/${comicPath}/index.json`;

const storySiteUrl = (storySlug: string) =>
	`https://universe.leagueoflegends.com/en_US/story/${storySlug}/`;
const comicSiteUrl = (comicPath: string) =>
	`https://universe.leagueoflegends.com/en_US/comic/${comicPath}/`;

const PAGE_SIZE = 24;

const STORY_PREFIX = "story/";
const COMIC_PREFIX = "comic/";
const VIDEO_PREFIX = "video/";

const RIOT_AUTHOR = "Riot Games";

const QUALITY_SETTING_ID = "comic_image_quality";
const QUALITY_HIGH = "high";
const QUALITY_STANDARD = "standard";

// ---------------------------------------------------------------------------
// Explore index JSON shapes (subset of fields we consume)
// ---------------------------------------------------------------------------

interface ImageFrag {
	uri?: string;
}

interface ChampionFrag {
	name?: string;
}

interface ExploreModule {
	type: string;
	slug?: string;
	title?: string;
	subtitle?: string | null;
	description?: string | null;
	uri?: string;
	"video-type"?: string;
	"story-slug"?: string;
	"link-out-type"?: string;
	"minutes-to-read"?: number;
	url?: string;
	"release-date"?: string;
	"featured-image"?: ImageFrag | null;
	background?: ImageFrag | null;
	"featured-champions"?: ChampionFrag[] | null;
}

interface StorySection {
	title?: string | null;
	"background-image"?: ImageFrag | null;
	"story-subsections"?: { content?: string | null }[] | null;
}

interface StoryDoc {
	story?: {
		title?: string | null;
		"story-sections"?: StorySection[] | null;
	} | null;
}

interface ComicPage {
	uri?: string;
	"2x"?: string;
}

interface ComicDoc {
	"desktop-pages"?: ComicPage[][] | null;
}

/** One browseable item derived from an explore index module. */
interface IndexedItem {
	uid: string;
	kind: "story" | "comic" | "video";
	module: ExploreModule;
	released: number;
	title: string;
	description: string;
	champions: string[];
	genre: string | null;
}

const VIDEO_TYPE_LABELS: Record<string, string> = {
	cinematic: "Cinematic",
	animation: "Animation",
	"champ-login-music": "Champion Login Theme",
	"music-video": "Music Video",
	"art-spotlight": "Art Spotlight",
	"behind-the-scenes": "Behind the Scenes",
	"dev-diary": "Dev Diary",
	"song-visualization": "Song Visualization",
	video: "Video",
};

// ---------------------------------------------------------------------------
// Index access
// ---------------------------------------------------------------------------

let indexPromise: Promise<IndexedItem[]> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`League Universe request failed (${res.status}): ${url}`);
	}
	return res.json as T;
}

/** Parses a single explore module, or returns null for kinds we don't expose. */
function toIndexedItem(m: ExploreModule): IndexedItem | null {
	const champions = unique(
		(m["featured-champions"] ?? [])
			.map((c) => (c.name ?? "").trim())
			.filter((n) => n.length > 0),
	);
	const description = stripHtml(m.description ?? "");
	const released = Date.parse(m["release-date"] ?? "") || 0;

	switch (m.type) {
		case "story-preview": {
			const slug = m["story-slug"];
			if (!slug) {
				return null;
			}
			return {
				uid: `${STORY_PREFIX}${slug}`,
				kind: "story",
				module: m,
				released,
				title: (m.title ?? slug).trim(),
				description,
				champions,
				genre: "Story",
			};
		}
		case "link-out": {
			if (m["link-out-type"] !== "comic" || !m.url) {
				return null;
			}
			const match = /\/en_us\/comic\/(.+?)\/?$/.exec(m.url);
			const comicPath = match?.[1];
			if (!comicPath) {
				return null;
			}
			return {
				uid: `${COMIC_PREFIX}${comicPath}`,
				kind: "comic",
				module: m,
				released,
				title: (m.title ?? comicPath).trim(),
				description,
				champions,
				genre: "Comic",
			};
		}
		case "featured-video": {
			if (!m.slug) {
				return null;
			}
			return {
				uid: `${VIDEO_PREFIX}${m.slug}`,
				kind: "video",
				module: m,
				released,
				title: (m.title ?? m.slug).trim(),
				description,
				champions,
				genre:
					VIDEO_TYPE_LABELS[m["video-type"] ?? ""] ??
					prettifyLabel(m["video-type"]),
			};
		}
		default:
			return null;
	}
}

async function fetchIndex(): Promise<IndexedItem[]> {
	try {
		const doc = await fetchJson<{ modules?: ExploreModule[] }>(
			EXPLORE_INDEX_URL,
		);
		const items = (doc.modules ?? [])
			.map(toIndexedItem)
			.filter((x): x is IndexedItem => x !== null);
		// The site sorts client-side; keep a stable newest-first order.
		items.sort((a, b) => b.released - a.released);
		return items;
	} catch (err) {
		// Allow a later retry instead of caching a failed fetch forever.
		indexPromise = null;
		throw err;
	}
}

function getIndex(): Promise<IndexedItem[]> {
	indexPromise ??= fetchIndex();
	return indexPromise;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

/** Entity-decoded plain text of an HTML fragment. */
function stripHtml(html: string): string {
	return parseHtmlFragment(html).text.replace(/\s+/g, " ").trim();
}

function prettifyLabel(value?: string): string | null {
	if (!value) {
		return null;
	}
	return value
		.split("-")
		.map((part) =>
			part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
		)
		.join(" ");
}

function formatDate(iso?: string): string | null {
	if (!iso) {
		return null;
	}
	const parsed = Date.parse(iso);
	if (!Number.isFinite(parsed)) {
		return null;
	}
	return new Date(parsed).toISOString().slice(0, 10);
}

function coverOf(m: ExploreModule): DionLink | undefined {
	const uri = m["featured-image"]?.uri ?? m.background?.uri;
	return uri ? { url: uri } : undefined;
}

function genresOf(item: IndexedItem): string[] | null {
	const genres = unique(
		[item.genre ?? "", ...item.champions].filter((g) => g.length > 0),
	);
	return genres.length > 0 ? genres : null;
}

function metaOf(item: IndexedItem): Record<string, string> | null {
	const meta: Record<string, string> = {};
	const released = formatDate(item.module["release-date"]);
	if (released) {
		meta.Released = released;
	}
	const minutes = item.module["minutes-to-read"];
	if (item.kind === "story" && minutes) {
		meta["Read Time"] = `${minutes} min`;
	}
	return Object.keys(meta).length > 0 ? meta : null;
}

function siteUrlOf(item: IndexedItem): string {
	switch (item.kind) {
		case "story":
			return storySiteUrl(item.uid.slice(STORY_PREFIX.length));
		case "comic":
			return comicSiteUrl(item.uid.slice(COMIC_PREFIX.length));
		default:
			// Videos have no dedicated page on the site; point at the explore view.
			return "https://universe.leagueoflegends.com/en_US/explore/everything/newest/";
	}
}

function toItemEntry(item: IndexedItem): Entry {
	return {
		id: { uid: item.uid },
		url: siteUrlOf(item),
		title: item.title,
		media_type:
			item.kind === "comic"
				? "Comic"
				: item.kind === "story"
					? "Book"
					: "Video",
		cover: coverOf(item.module),
		author: [RIOT_AUTHOR],
	};
}

function paginate<T>(
	items: T[],
	page: number,
): { content: T[]; hasnext: boolean } {
	const start = Math.max(0, page) * PAGE_SIZE;
	const content = items.slice(start, start + PAGE_SIZE);
	return { content, hasnext: start + PAGE_SIZE < items.length };
}

/** Free-text match over title, description and champion names. */
function matchesQuery(item: IndexedItem, query: string): boolean {
	if (query.length === 0) {
		return true;
	}
	const haystack = [item.title, item.description, ...item.champions]
		.join("\n")
		.toLowerCase();
	return haystack.includes(query);
}

/** Converts one story HTML block into entity-decoded plain-text paragraphs. */
function htmlToParagraphTexts(html: string): string[] {
	const frag = parseHtmlFragment(html);
	const paras = frag.select(new CSSSelector("p"));
	if (paras.length > 0) {
		const texts: string[] = [];
		for (let i = 0; i < paras.length; i++) {
			const text = (paras.get(i)?.text ?? "").replace(/\s+/g, " ").trim();
			if (text.length > 0) {
				texts.push(text);
			}
		}
		if (texts.length > 0) {
			return texts;
		}
	}
	const text = frag.text.replace(/\s+/g, " ").trim();
	return text.length > 0 ? [text] : [];
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		contentType: new ExtensionSetting<string>("content_type", "all", "Search")
			.setLabel("Content type")
			.setUI(
				new Dropdown([
					{ value: "all", label: "Everything" },
					{ value: "story", label: "Stories" },
					{ value: "comic", label: "Comics" },
					{ value: "video", label: "Videos" },
				]),
			),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(): Promise<undefined> {
		return undefined;
	}

	private async filteredItems(): Promise<IndexedItem[]> {
		const kind = await this.settings.contentType.get();
		const items = await getIndex();
		if (!kind || kind === "all") {
			return items;
		}
		return items.filter((item) => item.kind === kind);
	}

	async browse(page: number): Promise<EntryList> {
		const items = await this.filteredItems();
		return paginate(items.map(toItemEntry), page);
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim().toLowerCase();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const items = (await this.filteredItems()).filter((item) =>
			matchesQuery(item, query),
		);
		return paginate(items.map(toItemEntry), page);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const item = (await getIndex()).find((x) => x.uid === entryid.uid);
		if (!item) {
			throw new Error(`League Universe: unknown entry ${entryid.uid}`);
		}

		let outSettings = { ...settings };

		if (item.kind === "video") {
			// Videos are YouTube-hosted; the runtime player cannot stream them,
			// so the entry carries an external link instead of episodes.
			const uri = item.module.uri ?? "";
			const cover = coverOf(item.module);
			const entry: EntryDetailed = {
				id: { uid: item.uid },
				url: siteUrlOf(item),
				titles: [item.title],
				author: [RIOT_AUTHOR],
				media_type: "Video",
				status: "Complete",
				description: item.description || item.title,
				language: "en",
				cover,
				episodes: [],
				genres: genresOf(item),
				meta: metaOf(item),
				ui: Column(
					cover ? Image(cover) : undefined,
					uri ? Link(uri, "Watch on YouTube") : undefined,
				),
			};
			return { entry, settings: outSettings };
		}

		const episode: Episode = {
			id: { uid: item.uid },
			name: item.kind === "story" ? "Read" : "Read comic",
			url: siteUrlOf(item),
		};

		if (item.kind === "comic") {
			const store = new SettingStore(settings);
			store.getOrDefine<string>({
				id: QUALITY_SETTING_ID,
				defaultval: QUALITY_HIGH,
				label: "Comic image quality",
				ui: new Dropdown([
					{ value: QUALITY_HIGH, label: "High (2x)" },
					{ value: QUALITY_STANDARD, label: "Standard" },
				]),
			});
			outSettings = { ...settings, ...store.toMap() };
		}

		const entry: EntryDetailed = {
			id: { uid: item.uid },
			url: siteUrlOf(item),
			titles: [item.title],
			author: [RIOT_AUTHOR],
			media_type: item.kind === "comic" ? "Comic" : "Book",
			status: "Complete",
			description: item.description || item.title,
			language: "en",
			cover: coverOf(item.module),
			episodes: [episode],
			genres: genresOf(item),
			meta: metaOf(item),
		};
		return { entry, settings: outSettings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		if (epid.uid.startsWith(STORY_PREFIX)) {
			return this.storySource(epid, settings);
		}
		if (epid.uid.startsWith(COMIC_PREFIX)) {
			return this.comicSource(epid, settings);
		}
		throw new Error(
			`League Universe: ${epid.uid} is a YouTube video; open it from the entry page`,
		);
	}

	private async storySource(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const slug = epid.uid.slice(STORY_PREFIX.length);
		const doc = await fetchJson<StoryDoc>(storyApiUrl(slug));
		const sections = doc.story?.["story-sections"] ?? [];

		const paragraphs: Paragraph[] = [];
		const title = doc.story?.title?.trim();
		if (title) {
			paragraphs.push({ type: "Text", content: title, style: { bold: true } });
		}
		for (const section of sections) {
			const bg = section["background-image"]?.uri;
			if (bg) {
				paragraphs.push({ type: "CustomUI", ui: Image({ url: bg }) });
			}
			const heading = section.title?.trim();
			if (heading) {
				paragraphs.push({
					type: "Text",
					content: heading,
					style: { bold: true },
				});
			}
			for (const sub of section["story-subsections"] ?? []) {
				for (const text of htmlToParagraphTexts(sub.content ?? "")) {
					paragraphs.push({ type: "Text", content: text, style: null });
				}
			}
		}
		if (paragraphs.length === 0) {
			throw new Error(`League Universe: story ${slug} has no readable content`);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}

	private async comicSource(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const path = epid.uid.slice(COMIC_PREFIX.length);
		const doc = await fetchJson<ComicDoc>(comicApiUrl(path));

		const quality =
			new SettingStore(settings).tryGet<string>(QUALITY_SETTING_ID) ??
			QUALITY_HIGH;
		const links: DionLink[] = [];
		for (const spread of doc["desktop-pages"] ?? []) {
			for (const page of spread) {
				const url =
					quality === QUALITY_HIGH ? (page["2x"] ?? page.uri) : page.uri;
				if (url) {
					links.push({ url });
				}
			}
		}
		if (links.length === 0) {
			throw new Error(`League Universe: comic ${path} has no pages`);
		}
		return {
			source: { type: "Imagelist", links, audio: null },
			settings: { ...settings },
		};
	}
}
