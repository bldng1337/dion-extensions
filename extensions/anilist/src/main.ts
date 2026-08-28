import { DionExtension } from "@dion-js/runtime-lib";
import { AuthAccount } from "@dion-js/runtime-lib/auth.js";
import { Component } from "@dion-js/runtime-lib/component.js";
import { FeedComponent } from "@dion-js/runtime-lib/feed.js";
import {
	Checkbox,
	EntrySettingHandle,
	ExtensionSetting,
	SettingCustomUI,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Signal } from "@dion-js/runtime-lib/signal.js";
import { Trigger } from "@dion-js/runtime-lib/trigger.ts";
import {
	Badge,
	Button,
	Card,
	Column,
	Container,
	Image,
	Link,
	ListTile,
	Nav,
	OpenBrowser,
	Padding,
	PaddingSymmetric,
	PopView,
	Row,
	ShowToast,
	StarDisplay,
	Text,
	TextInput,
} from "@dion-js/runtime-lib/ui.js";
import type { EntryExtension } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
	EntryActivity,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EventData,
	EventResult,
	MediaType,
	Setting,
} from "@dion-js/runtime-types/runtime";
import { doAction } from "action";
import { fetch } from "network";

// ---------------------------------------------------------------------------
// AniList OAuth + API constants
// ---------------------------------------------------------------------------

const CLIENT_ID = "34497";
const CLIENT_SECRET = "TetlChvzk1zk1f4lza7n14w9hID46qx0e0KzKGf3";
const REDIRECT_URI = "dion://anilist.co/oauth";
const GRAPHQL_URL = "https://graphql.anilist.co";
const AUTH_URL = `https://anilist.co/api/v2/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
const TOKEN_URL = "https://anilist.co/api/v2/oauth/token";

const PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// AniList response shapes
// ---------------------------------------------------------------------------

type AnilistType = "ANIME" | "MANGA";
type MediaListStatus =
	| "CURRENT"
	| "PLANNING"
	| "COMPLETED"
	| "DROPPED"
	| "PAUSED"
	| "REPEATING";

interface AniListTitle {
	userPreferred?: string | null;
	romaji?: string | null;
	english?: string | null;
	native?: string | null;
}

interface AniListMediaNode {
	id: number;
	type?: AnilistType | null;
	title?: AniListTitle | null;
	coverImage?: { large?: string | null; extraLarge?: string | null } | null;
	bannerImage?: string | null;
	format?: string | null;
	status?: string | null;
	episodes?: number | null;
	chapters?: number | null;
	volumes?: number | null;
	averageScore?: number | null;
	siteUrl?: string | null;
	description?: string | null;
	genres?: string[] | null;
}

interface AniListPageResponse {
	data?: {
		Page?: {
			pageInfo?: { hasNextPage?: boolean | null } | null;
			media?: AniListMediaNode[] | null;
		} | null;
	} | null;
	errors?: unknown[] | null;
}

interface AniListViewerResponse {
	data?: {
		Viewer?: {
			id: number;
			name?: string;
			avatar?: { large?: string | null } | null;
		} | null;
	} | null;
	errors?: unknown[] | null;
}

interface AniListMutationResponse {
	errors?: unknown[] | null;
}

interface AniListFollowingUser {
	id: number;
	name?: string | null;
	avatar?: { large?: string | null } | null;
	siteUrl?: string | null;
}

interface AniListMediaListEntry {
	status?: MediaListStatus | null;
	score?: number | null;
	progress?: number | null;
	repeat?: number | null;
	user?: AniListFollowingUser | null;
}

interface AniListViewerIdResponse {
	data?: { Viewer?: { id: number } | null } | null;
	errors?: unknown[] | null;
}

interface AniListFollowingResponse {
	data?: {
		Page?: { following?: AniListFollowingUser[] | null } | null;
	} | null;
	errors?: unknown[] | null;
}

interface AniListFriendsWatchingResponse {
	data?: {
		Page?: { mediaList?: AniListMediaListEntry[] | null } | null;
	} | null;
	errors?: unknown[] | null;
}

/** The bound media data we persist in the per-entry `anilist_media` setting. */
interface BoundMedia {
	id: number;
	type: AnilistType;
	title: string;
	cover: string | null;
	banner: string | null;
	format: string | null;
	status: string | null;
	total: number | null;
	score: number | null;
	siteUrl: string | null;
	description: string | null;
	genres: string[] | null;
}

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

const SEARCH_QUERY = `query ($search: String!, $page: Int, $perPage: Int, $type: MediaType) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, sort: [SEARCH_MATCH]) {
      id
      type
      title { userPreferred romaji english native }
      coverImage { large extraLarge }
      bannerImage
      format
      status
      episodes
      chapters
      volumes
      averageScore
      siteUrl
      description
      genres
    }
  }
}`;

const VIEWER_QUERY = `query { Viewer { id name avatar { large } } }`;

const UPDATE_PROGRESS_MUTATION = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
    id
    progress
    status
  }
}`;

const VIEWER_ID_QUERY = `query { Viewer { id } }`;

const FOLLOWING_QUERY = `query ($userId: Int!) {
  Page(page: 1, perPage: 50) {
    following(userId: $userId) {
      id
      name
      avatar { large }
      siteUrl
    }
  }
}`;

const FRIENDS_WATCHING_QUERY = `query ($userIds: [Int], $mediaId: Int) {
  Page {
    mediaList(userId_in: $userIds, mediaId: $mediaId, sort: [UPDATED_TIME_DESC]) {
      status
      score
      progress
      repeat
      user {
        id
        name
        avatar { large }
        siteUrl
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// AniList API helpers
// ---------------------------------------------------------------------------

async function anilistRequest(
	query: string,
	variables: Record<string, unknown>,
	token?: string,
): Promise<unknown> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers,
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) {
		throw new Error(`AniList request failed (${res.status}): ${res.body}`);
	}
	return res.json;
}

async function searchAnilist(
	search: string,
	page: number,
	type: AnilistType | null,
): Promise<{ items: AniListMediaNode[]; hasNext: boolean }> {
	const res = (await anilistRequest(SEARCH_QUERY, {
		search,
		page,
		perPage: PAGE_SIZE,
		type,
	})) as AniListPageResponse;
	if (res.errors) {
		throw new Error(`AniList search errors: ${JSON.stringify(res.errors)}`);
	}
	return {
		items: res.data?.Page?.media ?? [],
		hasNext: res.data?.Page?.pageInfo?.hasNextPage ?? false,
	};
}

async function anilistViewer(
	token: string,
): Promise<{ userName?: string; profilePic?: string }> {
	const res = (await anilistRequest(
		VIEWER_QUERY,
		{},
		token,
	)) as AniListViewerResponse;
	if (res.errors || !res.data?.Viewer) {
		return {};
	}
	const viewer = res.data.Viewer;
	return {
		userName: viewer.name ?? undefined,
		profilePic: viewer.avatar?.large ?? undefined,
	};
}

// Per-session cache so we don't refetch the viewer id / following list on every
// detail-page render. Resetting the process is enough invalidation for now.
let cachedViewerId: number | null | undefined = undefined;
let cachedFollowing: AniListFollowingUser[] | null = null;

async function getViewerId(token: string): Promise<number | null> {
	if (cachedViewerId !== undefined) {
		return cachedViewerId;
	}
	const res = (await anilistRequest(
		VIEWER_ID_QUERY,
		{},
		token,
	)) as AniListViewerIdResponse;
	cachedViewerId = res.errors ? null : (res.data?.Viewer?.id ?? null);
	return cachedViewerId;
}

async function getFollowing(
	token: string,
	userId: number,
): Promise<AniListFollowingUser[]> {
	if (cachedFollowing !== null) {
		return cachedFollowing;
	}
	const res = (await anilistRequest(
		FOLLOWING_QUERY,
		{ userId },
		token,
	)) as AniListFollowingResponse;
	cachedFollowing = res.errors ? [] : (res.data?.Page?.following ?? []);
	return cachedFollowing;
}

async function getFriendsWatching(
	token: string,
	userIds: number[],
	mediaId: number,
): Promise<AniListMediaListEntry[]> {
	if (userIds.length === 0) {
		return [];
	}
	const res = (await anilistRequest(
		FRIENDS_WATCHING_QUERY,
		{ userIds, mediaId },
		token,
	)) as AniListFriendsWatchingResponse;
	if (res.errors) {
		return [];
	}
	return res.data?.Page?.mediaList ?? [];
}

// ---------------------------------------------------------------------------
// Mappers / formatting
// ---------------------------------------------------------------------------

function mediaTypeToAnilist(mt: MediaType): AnilistType | null {
	switch (mt) {
		case "Video":
			return "ANIME";
		case "Comic":
		case "Book":
			return "MANGA";
		default:
			return null;
	}
}

function toBoundMedia(m: AniListMediaNode): BoundMedia {
	const type: AnilistType = m.type ?? "ANIME";
	return {
		id: m.id,
		type,
		title:
			m.title?.userPreferred ||
			m.title?.romaji ||
			m.title?.english ||
			m.title?.native ||
			`#${m.id}`,
		cover: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
		banner: m.bannerImage ?? null,
		format: m.format ?? null,
		status: m.status ?? null,
		total:
			type === "MANGA"
				? (m.chapters ?? m.volumes ?? null)
				: (m.episodes ?? null),
		score: m.averageScore ?? null,
		siteUrl: m.siteUrl ?? null,
		description: m.description ?? null,
		genres: m.genres ?? null,
	};
}

function parseBound(raw: string): BoundMedia | null {
	if (!raw || raw.length === 0) {
		return null;
	}
	if (typeof raw !== "string") {
		throw new Error(`Expected bound media to be a string, got ${typeof raw}`);
	}
	try {
		return JSON.parse(raw) as BoundMedia;
	} catch (e) {
		console.warn("AniList: failed to parse bound media json", e);
		return null;
	}
}

function prettyStatus(s: string): string {
	const map: Record<string, string> = {
		FINISHED: "Finished",
		RELEASING: "Releasing",
		CANCELLED: "Cancelled",
		HIATUS: "On Hiatus",
		NOT_YET_RELEASED: "Upcoming",
	};
	return map[s] ?? s;
}

function prettyListStatus(s: MediaListStatus): string {
	const map: Record<MediaListStatus, string> = {
		CURRENT: "Watching",
		PLANNING: "Planning",
		COMPLETED: "Completed",
		DROPPED: "Dropped",
		PAUSED: "Paused",
		REPEATING: "Rewatching",
	};
	return map[s] ?? s;
}

function mediaMeta(m: BoundMedia): CustomUI[] {
	const parts: string[] = [];
	if (m.format) {
		parts.push(m.format);
	}
	if (m.status) {
		parts.push(prettyStatus(m.status));
	}
	if (m.total != null) {
		parts.push(`${m.total} ${m.type === "MANGA" ? "ch" : "ep"}`);
	}
	if (m.score != null) {
		parts.push(`★ ${(m.score / 10).toFixed(1)}`);
	}
	return parts.map((m) =>
		PaddingSymmetric(
			5,
			0,
			Container(Text(m), {
				color: "SurfaceContainer",
				padding: {
					bottom: 2,
					left: 4,
					right: 4,
					top: 2,
				},
			}),
		),
	);
}

function primaryTitle(entry: EntryDetailed): string {
	return entry.titles.find((t) => t.length > 0) ?? "";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements EntryExtension {
	entrySettings = {
		bound_media: new EntrySettingHandle<string>("anilist_media"),
	};
	settings = {
		show_friends: new ExtensionSetting<boolean>(
			"anilist_show_friends",
			true,
			"Extension",
		)
			.setLabel("Show friends watching this entry")
			.setUI(new Checkbox()),
		overwrite_metadata: new ExtensionSetting<boolean>(
			"anilist_overwrite_metadata",
			false,
			"Extension",
		)
			.setLabel("Overwrite entry metadata with AniList data")
			.setUI(new Checkbox()),
	};
	signals = {
		query: new Signal<string>("query"),
	};
	accounts = {
		anilist: new AuthAccount(
			"anilist.co",
			{
				type: "OAuth",
				authorization_url: AUTH_URL,
				token_url: TOKEN_URL,
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				scope: null,
			},
			async (account) => {
				const creds = await account.getAuthSecret();
				if (!creds || creds.type !== "OAuth" || !creds.access_token) {
					return {};
				}
				return anilistViewer(creds.access_token);
			},
		),
	};
	feeds = {
		anilist_feed: new FeedComponent<{
			query: string;
			entryId: EntryId;
			mediaType: MediaType;
		}>("anilist_feed", async ({ query, entryId, mediaType }, page) => {
			if (!query || query.length === 0) {
				return {
					items: [Text("Type to search for an AniList entry.")],
					hasMore: false,
				};
			}
			const type = mediaTypeToAnilist(mediaType);
			let result: { items: AniListMediaNode[]; hasNext: boolean };
			try {
				result = await searchAnilist(query, page, type);
			} catch (e) {
				console.error("AniList: search failed", e);
				return { items: [Text("Search failed. Try again.")], hasMore: false };
			}

			return {
				items: result.items.map((m) => this.mediaCard(m, entryId)),
				hasMore: result.hasNext,
			};
		}),
	};
	components = {
		anilist_state: new Component<{
			bound_media: string;
			entryId: EntryId;
			title: string;
			mediaType: MediaType;
		}>("anilist_state", async ({ bound_media, entryId, title, mediaType }) => {
			if (bound_media) {
				const media = parseBound(bound_media);
				if (media && media != null) {
					return ListTile({
						leading: media.cover
							? Image({ url: media.cover }, 50, 50)
							: undefined,
						title: Text(media.title),
						subtitle: Row(...mediaMeta(media)),
						trailing: Button(
							"Unbind",
							this.triggers.unbind.invoke({ entryId }),
						),
						onClick: media.siteUrl
							? this.triggers.open_browser.invoke({ url: media.siteUrl })
							: undefined,
					});
				}
			}
			return ListTile({
				leading: Text("AniList"),
				title: Text("Not bound"),
				subtitle: Text(
					"Bind this entry to an AniList entry to sync progress and see friends watching it.",
				),
				trailing: Button(
					"Bind",
					this.triggers.navSearch.invoke({
						entryId: entryId,
						mediaType: mediaType,
						query: title,
					}),
				),
			});
		}),
		anilist_search: new Component<{
			entryId: EntryId;
			mediaType: MediaType;
			initial_query: string;
			query: string;
		}>(
			"anilist_search",
			async ({ entryId, mediaType, initial_query, query }) => {
				if (!query) {
					await this.signals.query.write(initial_query);
				}
				return Column(
					TextInput({
						initial: initial_query,
						debounceMs: 300,
						onChange: this.signals.query,
					}),
					this.feeds.anilist_feed.build({
						entryId: entryId,
						mediaType: mediaType,
						query: query,
					}),
				);
			},
		),
		anilist_friends: new Component<{ bound_media: string }>(
			"anilist_friends",
			async ({ bound_media }) => {
				const media = parseBound(bound_media);
				if (!media) {
					return Text("Bind this entry to AniList to see friends watching it.");
				}
				const token = await this.getAccessToken();
				if (!token) {
					return Text("Log in to AniList to see friends watching this.");
				}
				const viewerId = await getViewerId(token);
				if (viewerId == null) {
					return Text("Could not load your AniList profile.");
				}
				const following = await getFollowing(token, viewerId);
				if (following.length === 0) {
					return Text("You are not following anyone on AniList.");
				}
				const entries = await getFriendsWatching(
					token,
					following.map((f) => f.id),
					media.id,
				);
				if (entries.length === 0) {
					return Text("None of your friends are tracking this.");
				}
				return Container(
					Column(
						Text(`Friends watching (${entries.length})`),
						...entries.map((e) => this.friendRow(e, media)),
					),
					{
						containerType: "Ghost",
					},
				);
			},
		),
	};

	triggers = {
		bind: new Trigger<{ entryId: EntryId; media: BoundMedia }>(
			"bind",
			async ({ entryId, media }) => {
				await this.entrySettings.bound_media.setSetting(
					entryId,
					JSON.stringify(media),
				);
				await doAction(PopView());
				await doAction(ShowToast(`Bound entry to ${media.title}`));
			},
		),
		unbind: new Trigger<{ entryId: EntryId }>("unbind", async ({ entryId }) => {
			await this.entrySettings.bound_media.setSetting(entryId, "");
		}),
		navSearch: new Trigger<{
			entryId: EntryId;
			mediaType: string;
			query: string;
		}>("navSearch", async ({ entryId, mediaType, query }) => {
			await this.signals.query.write(query);
			await doAction(
				Nav(
					"Bind to AniList",
					this.components.anilist_search.build({
						query: this.signals.query.at(),
						entryId: entryId,
						mediaType: mediaType as MediaType,
						initial_query: query,
					}),
				),
			);
		}),
		open_browser: new Trigger<{ url: string }>(
			"open_browser",
			async ({ url }) => {
				await doAction(OpenBrowser(url));
			},
		),
	};

	async onload(): Promise<void> {
		type onEventType = (data: EventData) => Promise<EventResult | undefined>;
		this.onEvent = (
			this.onEvent as { bind: (ext: DionExtension) => unknown }
		).bind(this) as onEventType;
	}

	// -- EntryExtension ------------------------------------------------------

	async mapEntry(
		entry: EntryDetailed,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const sstore = new SettingStore(settings);
		const boundSetting = this.entrySettings.bound_media
			.toSetting(sstore, "")
			.define()
			.setUI(
				new SettingCustomUI(
					this.components.anilist_state.build({
						bound_media: this.entrySettings.bound_media.asSubRef(entry.id),
						entryId: entry.id,
						title: primaryTitle(entry),
						mediaType: entry.media_type,
					}),
				),
			)
			.define();

		const showFriends = await this.settings.show_friends.get();
		const overwriteMeta = await this.settings.overwrite_metadata.get();
		const media = parseBound(boundSetting.get());

		if (showFriends) {
			entry.ui = this.components.anilist_friends.build({
				bound_media: this.entrySettings.bound_media.asSubRef(entry.id),
			});
		} else {
			entry.ui = null;
		}

		if (overwriteMeta && media) {
			entry.titles = [media.title, ...(entry.titles ?? [])].filter(
				(t, i, arr) => t.length > 0 && arr.indexOf(t) === i,
			);
			if (media.cover) {
				entry.cover = { url: media.cover };
			}
			if (media.banner) {
				entry.poster = { url: media.banner };
			} else if (media.cover && !entry.poster) {
				entry.poster = { url: media.cover };
			}
			if (media.score != null) {
				entry.rating = media.score / 10;
			}
			if (media.siteUrl) {
				entry.meta = { ...(entry.meta ?? {}), AniList: media.siteUrl };
			}
			if (media.description) {
				entry.description = media.description;
			}
			if (media.genres && media.genres.length > 0) {
				entry.genres = media.genres;
			}
			if (media.status) {
				entry.status =
					media.status === "FINISHED"
						? "Complete"
						: media.status === "RELEASING"
							? "Releasing"
							: entry.status;
			}
		}

		return { entry, settings: sstore.toMap() };
	}

	async onEntryActivity(
		activity: EntryActivity,
		_entry: EntryDetailed,
		settings: Record<string, Setting>,
	): Promise<void> {
		if (activity.type !== "EpisodeActivity") {
			return;
		}
		const store = new SettingStore(settings);
		const media = parseBound(
			this.entrySettings.bound_media.toSetting(store, "").define().get(),
		);
		if (!media) {
			console.warn("AniList: no media bound, skipping progress update");
			return;
		}
		const token = await this.getAccessToken();
		if (!token) {
			console.warn("AniList: not logged in, skipping progress update");
			return;
		}

		const progress = activity.progress;
		const status: MediaListStatus =
			media.total != null && progress >= media.total ? "COMPLETED" : "CURRENT";

		try {
			const res = (await anilistRequest(
				UPDATE_PROGRESS_MUTATION,
				{ mediaId: media.id, progress, status },
				token,
			)) as AniListMutationResponse;
			if (res.errors) {
				console.error(
					"AniList: progress update returned errors",
					JSON.stringify(res.errors),
				);
			}
		} catch (e) {
			console.error("AniList: progress update failed", e);
		}
	}

	// -- Auth helper ---------------------------------------------------------

	private async getAccessToken(): Promise<string | undefined> {
		try {
			const creds = await this.accounts.anilist.getAuthSecret();
			if (creds && creds.type === "OAuth" && creds.access_token) {
				return creds.access_token;
			}
		} catch (e) {
			console.warn("AniList: failed to get auth secret", e);
		}
		return undefined;
	}

	private mediaCard(m: AniListMediaNode, entryId: EntryId): CustomUI {
		const b = toBoundMedia(m);
		const cover =
			b.cover ?? "https://placehold.co/200x300/2E51A2/FFFFFF.png?text=No+Cover";
		return Card(
			{ url: cover },
			Row(...mediaMeta(b)),
			Text(b.title),
			this.triggers.bind.invoke({ entryId, media: b }),
		);
	}

	private friendRow(e: AniListMediaListEntry, media: BoundMedia): CustomUI {
		const name = e.user?.name ?? "AniList user";
		const avatar =
			e.user?.avatar?.large ??
			"https://placehold.co/100x100/2E51A2/FFFFFF.png?text=AL";
		const status = e.status ? prettyListStatus(e.status) : "Tracking";
		const parts: string[] = [];
		if (e.progress != null && e.progress > 0) {
			const total = media.total != null ? `/${media.total}` : "";
			parts.push(`${e.progress}${total}`);
		}
		if (e.repeat != null && e.repeat > 0) {
			parts.push(`${e.repeat} rewatches`);
		}
		if (e.score != null && e.score > 0) {
			parts.push(`★ ${e.score}`);
		}
		return ListTile({
			leading: Image({ url: avatar }, 50, 50),
			title: Text(name),
			subtitle: Text([status, ...parts].join(" • ")),
			trailing: Text(status),
			onClick: e.user?.siteUrl
				? this.triggers.open_browser.invoke({ url: e.user.siteUrl })
				: undefined,
		});
	}
}
