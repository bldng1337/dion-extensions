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
	Button,
	Card,
	Column,
	Container,
	Image,
	ListTile,
	Nav,
	OpenBrowser,
	PaddingAll,
	PaddingSymmetric,
	PopView,
	Row,
	ShowToast,
	Text,
	TextInput,
	Wrap,
} from "@dion-js/runtime-lib/ui.js";
import type { EntryExtension } from "@dion-js/runtime-types/extension";
import type {
	AuthCreds,
	CustomUI,
	EntryActivity,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EventData,
	EventResult,
	Setting,
} from "@dion-js/runtime-types/runtime";
import { doAction } from "action";
import { decodeBase64 } from "convert";
import { fetch } from "network";
import {
	cookiesFromCreds,
	isExpired,
	prettyReadingStatus,
	sessionFromCookies,
	type ReadingListStatus,
	type SupabaseSession,
} from "./session.js";

// ---------------------------------------------------------------------------
// Novellist constants
// ---------------------------------------------------------------------------

const SITE_BASE = "https://www.novellist.co";
const COOKIE_DOMAIN = "www.novellist.co";
// The site's login redirects back to the home page once authenticated.
const LOGIN_URL = `${SITE_BASE}/auth/login`;
const LOGON_URL = `${SITE_BASE}/`;

// Novellist's own backend (the website fetches it with the Supabase access
// token as a Bearer credential).
const API_BASE = "https://novellist-be-960019704910.asia-east1.run.app/api";
const SUPABASE_URL = "https://yionrsulvvpfmzmbmami.supabase.co";
// Public anon key shipped in Novellist's own web bundle; only used for the
// token refresh endpoint, exactly like the site's unauthenticated calls.
const SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlpb25yc3VsdnZwZm16bWJtYW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk5ODg0MTMsImV4cCI6MjAzNTU2NDQxM30.EW3C9NhuFu6TvZuYJ8B29HqeW35hH3BujR0sGRa9Ej0";

const PAGE_SIZE = 20;
const PLACEHOLDER_COVER =
	"https://placehold.co/200x300/6D28D9/FFFFFF.png?text=Novellist";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface NovelAuthor {
	name?: string | null;
	slug?: string | null;
}

interface NovellistNovel {
	id: string;
	slug: string;
	raw_title?: string | null;
	english_title?: string | null;
	author?: NovelAuthor | null;
	description?: string | null;
	language?: string | null;
	cover_image_link?: string | null;
	chapter_count?: number | string | null;
	rating_average?: number | string | null;
}

interface ReadingListEntry {
	status: ReadingListStatus;
	rating?: number | null;
	chapter_count: number;
	note?: string | null;
	created_at?: string;
}

interface UserProfile {
	user_id: string;
	username: string;
	profile_pic_url?: string;
}

/** The bound novel data we persist in the per-entry `novellist_novel` setting. */
interface BoundNovel {
	id: string;
	slug: string;
	title: string;
	cover: string | null;
	totalChapters: number | null;
	author: string | null;
	rating: number | null;
	description: string | null;
}

const STATUS_ACTIONS: Array<{ label: string; status: ReadingListStatus }> = [
	{ label: "Planned", status: "PLANNED" },
	{ label: "Reading", status: "IN_PROGRESS" },
	{ label: "Completed", status: "COMPLETED" },
	{ label: "Dropped", status: "DROPPED" },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface ApiResult {
	status: number;
	data: unknown;
}

async function apiRequest(
	token: string | null,
	path: string,
	init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: string } = {},
): Promise<ApiResult> {
	const headers: Record<string, string> = {};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	if (init.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	const res = await fetch(`${API_BASE}${path}`, {
		method: init.method ?? "GET",
		headers,
		body: init.body,
	});
	let data: unknown = null;
	if (res.body && res.body.length > 0) {
		try {
			data = JSON.parse(res.body);
		} catch {
			data = null;
		}
	}
	return { status: res.status, data };
}

async function searchNovels(
	query: string,
	page: number,
): Promise<{ items: NovellistNovel[]; hasNext: boolean }> {
	const { status, data } = await apiRequest(null, "/novels/filter", {
		method: "POST",
		body: JSON.stringify({
			title_search_query: query,
			// The host's feeds are 0-based, Novellist's pages are 1-based.
			page_number: Math.max(1, page + 1),
			page_size: PAGE_SIZE,
		}),
	});
	if (status < 200 || status >= 300 || !Array.isArray(data)) {
		throw new Error(`Novellist novel search failed (${status})`);
	}
	const items = data as NovellistNovel[];
	return { items, hasNext: items.length >= PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// Mappers / formatting
// ---------------------------------------------------------------------------

function toBoundNovel(n: NovellistNovel): BoundNovel {
	const total = n.chapter_count == null ? Number.NaN : Number(n.chapter_count);
	const rating =
		n.rating_average == null || n.rating_average === ""
			? Number.NaN
			: Number(n.rating_average);
	return {
		id: n.id,
		slug: n.slug,
		title: n.english_title || n.raw_title || n.slug,
		cover: n.cover_image_link ?? null,
		totalChapters: Number.isFinite(total) && total > 0 ? total : null,
		author: n.author?.name ?? null,
		rating: Number.isFinite(rating) ? rating : null,
		description: n.description ?? null,
	};
}

function parseBound(raw: string): BoundNovel | null {
	if (!raw || raw.length === 0) {
		return null;
	}
	if (typeof raw !== "string") {
		throw new Error(`Expected bound novel to be a string, got ${typeof raw}`);
	}
	try {
		return JSON.parse(raw) as BoundNovel;
	} catch (e) {
		console.warn("Novellist: failed to parse bound novel json", e);
		return null;
	}
}

function novelSiteUrl(novel: BoundNovel): string {
	return `${SITE_BASE}/novels/${novel.slug}`;
}

function chip(text: string): CustomUI {
	return PaddingSymmetric(
		5,
		0,
		Container(Text(text), {
			color: "SurfaceContainer",
			padding: { bottom: 2, left: 4, right: 4, top: 2 },
		}),
	);
}

function readingChips(
	entry: ReadingListEntry,
	total: number | null,
): CustomUI[] {
	const parts: string[] = [prettyReadingStatus(entry.status)];
	if (entry.chapter_count > 0) {
		const totalPart = total != null ? `/${total}` : "";
		parts.push(`${entry.chapter_count}${totalPart} ch`);
	}
	if (entry.rating != null && entry.rating > 0) {
		parts.push(`★ ${entry.rating}`);
	}
	return parts.map(chip);
}

function primaryTitle(entry: EntryDetailed): string {
	return entry.titles.find((t) => t.length > 0) ?? "";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements EntryExtension {
	entrySettings = {
		bound_novel: new EntrySettingHandle<string>("novellist_novel"),
	};
	settings = {
		overwrite_metadata: new ExtensionSetting<boolean>(
			"novellist_overwrite_metadata",
			false,
			"Extension",
		)
			.setLabel("Overwrite entry metadata with Novellist data")
			.setUI(new Checkbox()),
	};
	signals = {
		query: new Signal<string>("query"),
	};
	accounts = {
		novellist: new AuthAccount(
			COOKIE_DOMAIN,
			{ type: "Cookie", loginpage: LOGIN_URL, logonpage: LOGON_URL },
			async (account) => {
				const token = await this.resolveAccessToken();
				if (!token) {
					return {};
				}
				const { status, data } = await apiRequest(token, "/users/current");
				if (status !== 200 || data === null || typeof data !== "object") {
					return {};
				}
				const user = data as UserProfile;
				return {
					userName: user.username,
					profilePic: user.profile_pic_url || undefined,
				};
			},
		),
	};
	feeds = {
		novellist_feed: new FeedComponent<{
			query: string;
			entryId: EntryId;
		}>("novellist_feed", async ({ query, entryId }, page) => {
			if (!query || query.length === 0) {
				return {
					items: [Text("Type to search for a Novellist novel.")],
					hasMore: false,
				};
			}
			let result: { items: NovellistNovel[]; hasNext: boolean };
			try {
				result = await searchNovels(query, page);
			} catch (e) {
				console.error("Novellist: search failed", e);
				return { items: [Text("Search failed. Try again.")], hasMore: false };
			}
			return {
				items: result.items.map((n) => this.novelCard(n, entryId)),
				hasMore: result.hasNext,
			};
		}),
	};
	components = {
		novellist_state: new Component<{
			bound_novel: string;
			entryId: EntryId;
			title: string;
		}>("novellist_state", async ({ bound_novel, entryId, title }) => {
			if (!bound_novel) {
				return ListTile({
					leading: Text("Novellist"),
					title: Text("Not bound"),
					subtitle: Text(
						"Bind this entry to a Novellist novel to sync your reading progress.",
					),
					trailing: Button(
						"Bind",
						this.triggers.navSearch.invoke({ entryId, query: title }),
					),
				});
			}
			const novel = parseBound(bound_novel);
			if (!novel) {
				return Text(
					"Novellist: bound novel is invalid, unbind and bind again.",
				);
			}
			const tile = (subtitle: CustomUI) =>
				ListTile({
					leading: Image({ url: novel.cover ?? PLACEHOLDER_COVER }, 50, 50),
					title: Text(novel.title),
					subtitle,
					onClick: this.triggers.open_browser.invoke({
						url: novelSiteUrl(novel),
					}),
					trailing: Button("Unbind", this.triggers.unbind.invoke({ entryId })),
				});

			const token = await this.resolveAccessToken();
			if (!token) {
				return tile(Text("Log in to Novellist to sync progress."));
			}
			const { status, data } = await apiRequest(
				token,
				`/users/current/reading-list/${novel.id}`,
			);
			if (status === 401) {
				return tile(
					Text("Novellist session expired, log in again to re-sync."),
				);
			}
			if (status !== 200 || data === null || typeof data !== "object") {
				return Column(
					tile(Text("Not on your Novellist reading list yet.")),
					Text("It is added automatically when you read a chapter."),
				);
			}
			const entry = data as ReadingListEntry;
			return Column(
				tile(Row(...readingChips(entry, novel.totalChapters))),
				entry.note ? PaddingAll(6, Text(`Note: ${entry.note}`)) : undefined,
				Wrap(
					...STATUS_ACTIONS.map((a) =>
						Button(
							a.label,
							this.triggers.set_status.invoke({
								entryId,
								novelId: novel.id,
								status: a.status,
							}),
						),
					),
				),
			);
		}),
		novellist_search: new Component<{
			entryId: EntryId;
			initial_query: string;
			query: string;
		}>("novellist_search", async ({ entryId, initial_query, query }) => {
			if (!query) {
				await this.signals.query.write(initial_query);
			}
			return Column(
				TextInput({
					initial: initial_query,
					debounceMs: 300,
					onChange: this.signals.query,
				}),
				this.feeds.novellist_feed.build({ entryId, query }),
			);
		}),
	};

	triggers = {
		bind: new Trigger<{ entryId: EntryId; novel: BoundNovel }>(
			"bind",
			async ({ entryId, novel }) => {
				await this.entrySettings.bound_novel.setSetting(
					entryId,
					JSON.stringify(novel),
				);
				await doAction(PopView());
				await doAction(ShowToast(`Bound entry to ${novel.title}`));
			},
		),
		unbind: new Trigger<{ entryId: EntryId }>("unbind", async ({ entryId }) => {
			await this.entrySettings.bound_novel.setSetting(entryId, "");
		}),
		navSearch: new Trigger<{ entryId: EntryId; query: string }>(
			"navSearch",
			async ({ entryId, query }) => {
				await this.signals.query.write(query);
				await doAction(
					Nav(
						"Bind to Novellist",
						this.components.novellist_search.build({
							query: this.signals.query.at(),
							entryId,
							initial_query: query,
						}),
					),
				);
			},
		),
		set_status: new Trigger<{
			entryId: EntryId;
			novelId: string;
			status: ReadingListStatus;
		}>("set_status", async ({ novelId, status }) => {
			const token = await this.resolveAccessToken();
			if (!token) {
				await doAction(ShowToast("Log in to Novellist first"));
				return;
			}
			const res = await apiRequest(
				token,
				`/users/current/reading-list/${novelId}`,
				{ method: "PUT", body: JSON.stringify({ status }) },
			);
			if (res.status === 200 || res.status === 204) {
				await doAction(ShowToast(`Marked as ${prettyReadingStatus(status)}`));
			} else {
				await doAction(ShowToast(`Novellist update failed (${res.status})`));
			}
		}),
		open_browser: new Trigger<{ url: string }>(
			"open_browser",
			async ({ url }) => {
				await doAction(OpenBrowser(url));
			},
		),
	};

	private cachedSession: SupabaseSession | null | undefined = undefined;

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
		const boundSetting = this.entrySettings.bound_novel
			.toSetting(sstore, "")
			.define()
			.setUI(
				new SettingCustomUI(
					this.components.novellist_state.build({
						bound_novel: this.entrySettings.bound_novel.asSubRef(entry.id),
						entryId: entry.id,
						title: primaryTitle(entry),
					}),
				),
			)
			.define();

		const overwriteMeta = await this.settings.overwrite_metadata.get();
		const novel = parseBound(boundSetting.get());

		if (overwriteMeta && novel) {
			entry.titles = [novel.title, ...(entry.titles ?? [])].filter(
				(t, i, arr) => t.length > 0 && arr.indexOf(t) === i,
			);
			if (novel.cover) {
				entry.cover = { url: novel.cover };
			}
			if (novel.author) {
				entry.author = [novel.author];
			}
			if (novel.description) {
				entry.description = novel.description;
			}
			if (novel.rating != null) {
				entry.rating = novel.rating;
			}
			if (novel.totalChapters != null) {
				entry.length = novel.totalChapters;
			}
			entry.meta = { ...(entry.meta ?? {}), Novellist: novelSiteUrl(novel) };
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
		const novel = parseBound(
			this.entrySettings.bound_novel.toSetting(store, "").define().get(),
		);
		if (!novel) {
			console.warn("Novellist: no novel bound, skipping progress update");
			return;
		}
		const token = await this.resolveAccessToken();
		if (!token) {
			console.warn("Novellist: not logged in, skipping progress update");
			return;
		}

		const progress = activity.progress;
		const status: ReadingListStatus =
			novel.totalChapters != null && progress >= novel.totalChapters
				? "COMPLETED"
				: "IN_PROGRESS";

		try {
			const res = await apiRequest(
				token,
				`/users/current/reading-list/${novel.id}`,
				{
					method: "PUT",
					body: JSON.stringify({ chapter_count: progress, status }),
				},
			);
			if (res.status !== 200 && res.status !== 204) {
				console.error(
					`Novellist: progress update failed (${res.status}): ${JSON.stringify(res.data)}`,
				);
			}
		} catch (e) {
			console.error("Novellist: progress update failed", e);
		}
	}

	// -- Auth helpers --------------------------------------------------------

	/**
	 * Resolve a valid Supabase access token from the account cookies Novellist
	 * set during login, refreshing it through Supabase when it is stale.
	 */
	private async resolveAccessToken(): Promise<string | null> {
		if (this.cachedSession === undefined) {
			this.cachedSession = await this.loadSessionFromCookies();
		}
		let session = this.cachedSession;
		if (!session) {
			return null;
		}
		if (session.refresh_token && isExpired(session, Date.now() / 1000)) {
			const refreshed = await this.refreshSession(session.refresh_token);
			if (refreshed) {
				session = refreshed;
			}
		}
		return session.access_token.length > 0 ? session.access_token : null;
	}

	private async loadSessionFromCookies(): Promise<SupabaseSession | null> {
		try {
			const creds: AuthCreds | undefined =
				await this.accounts.novellist.getAuthSecret();
			if (!creds || creds.type !== "Cookies") {
				return null;
			}
			return sessionFromCookies(cookiesFromCreds(creds), decodeBase64);
		} catch (e) {
			console.warn("Novellist: failed to read auth secret", e);
			return null;
		}
	}

	private async refreshSession(
		refreshToken: string,
	): Promise<SupabaseSession | null> {
		try {
			const res = await fetch(
				`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						apikey: SUPABASE_ANON_KEY,
					},
					body: JSON.stringify({ refresh_token: refreshToken }),
				},
			);
			if (!res.ok || !res.body || res.body.length === 0) {
				return null;
			}
			const data = JSON.parse(res.body) as Record<string, unknown>;
			if (typeof data.access_token !== "string") {
				return null;
			}
			const session: SupabaseSession = {
				access_token: data.access_token,
				refresh_token:
					typeof data.refresh_token === "string"
						? data.refresh_token
						: refreshToken,
				expires_at: typeof data.expires_at === "number" ? data.expires_at : 0,
			};
			this.cachedSession = session;
			return session;
		} catch (e) {
			console.warn("Novellist: session refresh failed", e);
			return null;
		}
	}

	private novelCard(n: NovellistNovel, entryId: EntryId): CustomUI {
		const b = toBoundNovel(n);
		const parts: string[] = [];
		if (b.author) {
			parts.push(b.author);
		}
		if (b.totalChapters != null) {
			parts.push(`${b.totalChapters} ch`);
		}
		if (b.rating != null) {
			parts.push(`★ ${b.rating.toFixed(1)}`);
		}
		return Card(
			{ url: b.cover ?? PLACEHOLDER_COVER },
			Row(...(parts.length > 0 ? parts.map(chip) : [chip("Novellist")])),
			Text(b.title),
			this.triggers.bind.invoke({ entryId, novel: b }),
		);
	}
}
