import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
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
	DEFAULT_SHOW,
	SHOW_DROPDOWN,
	type ShowConfig,
	buildDescription,
	computeHasNext,
	decodeEntities,
	extractMp3,
	extractOgImage,
	getShow,
	headerValue,
	makeUid,
	parseCredits,
	parseStoryAuthor,
	parseUid,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// Every show runs its own WordPress site (escapepod.org, podcastle.org,
// pseudopod.org) with the REST API enabled:
// - Listings/search: /wp-json/wp/v2/posts with per_page/page/search params and
//   X-WP-TotalPages pagination.
// - Episode detail: /wp-json/wp/v2/posts/<id> for the clean show-notes HTML.
// - Audio: the WP API never exposes the podcast enclosure (PowerPress keeps it
//   in post meta), but every episode page embeds the MP3 in an audio shortcode,
//   so detail/source parse the episode page for the stream URL plus the
//   credits (author/narrator/host) and og:image artwork.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const SHOW_SETTING_ID = "show";

interface WpPost {
	id: number;
	date?: string;
	link?: string;
	title?: { rendered?: string };
	content?: { rendered?: string };
	excerpt?: { rendered?: string };
}

interface EpisodePageInfo {
	mp3?: string;
	cover?: string;
	credits: { role: string; name: string }[];
}

interface Listing {
	posts: WpPost[];
	hasnext: boolean;
}

// ---------------------------------------------------------------------------
// WordPress REST client (cached per session)
// ---------------------------------------------------------------------------

async function fetchJson<T>(
	url: string,
	what: string,
): Promise<{ data: T; headers: Record<string, string> }> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Escape Artists: ${what} request failed (${res.status})`);
	}
	return { data: res.json as T, headers: res.headers };
}

// Feeds and episode pages change at most a few times a week, and every
// browse/search/detail/source call would otherwise re-download them, so keep
// parsed results in module-level Maps for the session.
const listingCache = new Map<string, Listing>();
const postCache = new Map<string, WpPost>();
const pageCache = new Map<string, EpisodePageInfo>();

async function fetchListing(
	show: ShowConfig,
	page: number,
	search: string | undefined,
): Promise<Listing> {
	const kind = search === undefined ? "browse" : "search";
	const cacheKey = `${show.key}|${kind}|${search ?? ""}|${page}`;
	const cached = listingCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const params: [string, string][] = [
		["per_page", String(PAGE_SIZE)],
		["page", String(page)],
		["_fields", "id,title,link,date,excerpt"],
	];
	if (search !== undefined) {
		params.push(["search", search]);
	}
	const query = params
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
	const { data, headers } = await fetchJson<WpPost[]>(
		`${show.base}/wp-json/wp/v2/posts?${query}`,
		kind,
	);
	const posts = Array.isArray(data) ? data : [];
	const listing: Listing = {
		posts,
		hasnext: computeHasNext(
			headerValue(headers, "x-wp-totalpages"),
			page,
			posts.length,
			PAGE_SIZE,
		),
	};
	listingCache.set(cacheKey, listing);
	return listing;
}

async function fetchPost(show: ShowConfig, postId: number): Promise<WpPost> {
	const uid = makeUid(show.key, postId);
	const cached = postCache.get(uid);
	if (cached) {
		return cached;
	}
	const { data } = await fetchJson<WpPost>(
		`${show.base}/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,date,content,excerpt`,
		"episode",
	);
	if (typeof data.id !== "number") {
		throw new Error(
			`Escape Artists: episode ${postId} not found on ${show.label}`,
		);
	}
	postCache.set(uid, data);
	return data;
}

async function fetchEpisodeInfo(
	show: ShowConfig,
	postId: number,
	permalink: string,
): Promise<EpisodePageInfo> {
	const uid = makeUid(show.key, postId);
	const cached = pageCache.get(uid);
	if (cached) {
		return cached;
	}
	const res = await fetch(permalink);
	if (!res.ok) {
		throw new Error(
			`Escape Artists: episode page request failed (${res.status})`,
		);
	}
	const html = res.body;
	const info: EpisodePageInfo = {
		mp3: extractMp3(html),
		cover: extractOgImage(html),
		credits: parseCredits(html),
	};
	pageCache.set(uid, info);
	return info;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function postTitle(post: WpPost): string {
	return decodeEntities(post.title?.rendered ?? `Episode ${post.id}`);
}

function postToEntry(show: ShowConfig, post: WpPost): Entry {
	return {
		id: { uid: makeUid(show.key, post.id), iddata: post.link },
		url: post.link ?? show.base,
		title: postTitle(post),
		media_type: "Audio",
		cover: { url: show.icon },
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		show: new ExtensionSetting<string>(
			SHOW_SETTING_ID,
			DEFAULT_SHOW,
			"Extension",
		)
			.setLabel("Show")
			.setUI(new Dropdown(SHOW_DROPDOWN)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const show = getShow(await this.settings.show.get());
		const wpPage = Math.max(1, page + 1);
		const { posts, hasnext } = await fetchListing(show, wpPage, undefined);
		return { content: posts.map((post) => postToEntry(show, post)), hasnext };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const show = getShow(await this.settings.show.get());
		const wpPage = Math.max(1, page + 1);
		const { posts, hasnext } = await fetchListing(show, wpPage, term);
		return { content: posts.map((post) => postToEntry(show, post)), hasnext };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const parsed = parseUid(entryid.uid);
		if (!parsed) {
			throw new Error(`Escape Artists: invalid entry id ${entryid.uid}`);
		}
		const { show, postId } = parsed;
		const post = await fetchPost(show, postId);
		const permalink = post.link ?? entryid.iddata ?? show.base;
		const info = await fetchEpisodeInfo(show, postId, permalink);

		const credit = (role: string): string | undefined =>
			info.credits.find(
				(entry) => entry.role.toLowerCase() === role.toLowerCase(),
			)?.name;
		const author =
			credit("author") ?? parseStoryAuthor(post.content?.rendered ?? "");
		const narrator = credit("narrator");
		const host = credit("host");
		const producer = credit("audio producer");

		const meta: Record<string, string> = {};
		if (post.date) {
			meta.Published = post.date.slice(0, 10);
		}
		if (author) {
			meta.Author = author;
		}
		if (narrator) {
			meta.Narrator = narrator;
		}
		if (host) {
			meta.Host = host;
		}
		if (producer) {
			meta["Audio Producer"] = producer;
		}
		// Keep any other roles (e.g. "Publisher", "Guest Host") too.
		for (const entry of info.credits) {
			if (entry.role in meta) {
				continue;
			}
			const known = ["author", "narrator", "host", "audio producer"];
			if (!known.includes(entry.role.toLowerCase())) {
				meta[entry.role] = entry.name;
			}
		}

		let description = buildDescription(show, post.content?.rendered ?? "");
		if (description.length === 0) {
			description = buildDescription(show, post.excerpt?.rendered ?? "");
		}

		const title = postTitle(post);
		const artwork = info.cover ? { url: info.cover } : undefined;
		const entry: EntryDetailed = {
			id: { uid: makeUid(show.key, postId) },
			url: permalink,
			titles: [title],
			author: author ? [author] : undefined,
			media_type: "Audio",
			status: "Complete",
			description,
			language: "en",
			cover: artwork,
			poster: artwork,
			episodes: [
				{
					id: { uid: makeUid(show.key, postId), iddata: permalink },
					name: title,
					url: info.mp3 ?? permalink,
					description: narrator ? `Narrated by ${narrator}` : undefined,
					timestamp: post.date,
				},
			],
			genres: [show.genre],
			meta,
			ui: Column(Text("Links"), Link(permalink, `${show.label} episode page`)),
		};

		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const parsed = parseUid(epid.uid);
		if (!parsed) {
			throw new Error(`Escape Artists: invalid episode id ${epid.uid}`);
		}
		const { show, postId } = parsed;
		const uid = makeUid(show.key, postId);
		let mp3 = pageCache.get(uid)?.mp3;
		if (!mp3) {
			const permalink =
				epid.iddata || (await fetchPost(show, postId)).link || show.base;
			mp3 = (await fetchEpisodeInfo(show, postId, permalink)).mp3;
		}
		if (!mp3) {
			throw new Error(`Escape Artists: no audio found for episode ${uid}`);
		}
		return {
			settings,
			source: {
				type: "Audio",
				sources: [{ name: show.label, lang: "en", url: { url: mp3 } }],
			},
		};
	}
}
