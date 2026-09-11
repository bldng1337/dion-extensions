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
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	apiUrl,
	ATTRIBUTION,
	BilaraSutta,
	bilaraToParagraphs,
	BASE_URL,
	episodeName,
	FulltextHit,
	LANGUAGES,
	LANGUAGE_SETTING_ID,
	MAX_EPISODES,
	PAGE_SIZE,
	pickTranslation,
	siteUrl,
	SuttaplexItem,
	USER_AGENT,
	VOLUMES,
} from "./sc.ts";

// ---------------------------------------------------------------------------
// JSON API client
// ---------------------------------------------------------------------------

async function apiGet(path: string, pairs: [string, string][] = []) {
	const res = await fetch(apiUrl(path, pairs), {
		headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`SuttaCentral request failed (${res.status}) on /${path}`);
	}
	return res.json;
}

/** Listing responses sometimes come back as a single all-null object
 * (e.g. unknown uid) — normalise those to an empty list. */
function asSuttaplexList(data: unknown): SuttaplexItem[] {
	if (!Array.isArray(data)) {
		return [];
	}
	return (data as SuttaplexItem[]).filter((item) => !!item?.uid);
}

/** Suttaplex listings are reused between detail() and source(); keep them
 * per session (the runtime VM lives as long as the extension does). */
const suttaplexCache = new Map<string, SuttaplexItem[]>();

async function fetchSuttaplex(
	uid: string,
	lang: string,
): Promise<SuttaplexItem[]> {
	const key = `${lang}|${uid}`;
	const cached = suttaplexCache.get(key);
	if (cached) {
		return cached;
	}
	const list = asSuttaplexList(
		await apiGet(`suttaplex/${encodeURIComponent(uid)}`, [["language", lang]]),
	);
	suttaplexCache.set(key, list);
	return list;
}

async function fetchBilaraSutta(
	uid: string,
	translation: { lang: string; author_uid: string } | undefined,
): Promise<BilaraSutta> {
	const lang = translation?.lang ?? "en";
	const path = translation
		? `bilarasuttas/${encodeURIComponent(uid)}/${encodeURIComponent(translation.author_uid)}`
		: `bilarasuttas/${encodeURIComponent(uid)}`;
	const data = (await apiGet(path, [["lang", lang]])) as BilaraSutta;
	return data ?? {};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/** Read the current value of a string setting out of the settings record the
 * host threads through detail()/source(). */
function settingString(
	settings: Record<string, Setting>,
	id: string,
): string | undefined {
	const setting = settings[id];
	if (setting?.value?.type === "String") {
		return setting.value.data;
	}
	return undefined;
}

export default class SuttaCentralExtension
	extends DionExtension
	implements SourceProvider
{
	settings = {
		language: new ExtensionSetting<string>(
			LANGUAGE_SETTING_ID,
			"en",
			"Extension",
		)
			.setLabel("Translation language")
			.setUI(new Dropdown(LANGUAGES)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	/** The translation language: per-entry setting if the host supplies one,
	 * otherwise the registered extension setting. */
	private async currentLanguage(
		settings: Record<string, Setting>,
	): Promise<string> {
		const fromRecord = settingString(settings, LANGUAGE_SETTING_ID);
		if (fromRecord) {
			return fromRecord;
		}
		return await this.settings.language.get();
	}

	private volumeToEntry(seed: { uid: string; title: string }): Entry {
		return {
			id: { uid: seed.uid },
			url: siteUrl(seed.uid),
			title: seed.title,
			media_type: "Book",
			author: [ATTRIBUTION],
		};
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const start = Math.max(0, page) * PAGE_SIZE;
		const slice = VOLUMES.slice(start, start + PAGE_SIZE);
		return {
			content: slice.map((seed) => this.volumeToEntry(seed)),
			hasnext: VOLUMES.length > start + PAGE_SIZE,
			length: slice.length,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0 || page > 0) {
			return { content: [], hasnext: false, length: 0 };
		}
		// The full-text endpoint has no pagination (max 15 hits) and covers
		// root + translated segments; keep translation hits, dedupe by uid.
		const data = (await apiGet(
			`fulltextsearch/${encodeURIComponent(term)}`,
		)) as FulltextHit[];
		const hits = Array.isArray(data) ? data : [];
		const seen = new Set<string>();
		const content: Entry[] = [];
		for (const hit of hits) {
			if (!hit.uid || hit.is_root === true || seen.has(hit.uid)) {
				continue;
			}
			seen.add(hit.uid);
			const title = episodeName(hit.acronym, hit.name, hit.uid);
			content.push({
				id: { uid: hit.uid },
				url: siteUrl(hit.uid, hit.lang, hit.author_uid),
				title,
				media_type: "Book",
				author: hit.author ? [hit.author] : [ATTRIBUTION],
			});
		}
		return { content, hasnext: false, length: content.length };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const lang = await this.currentLanguage(settings);
		const list = await fetchSuttaplex(uid, lang);
		const node = list[0];
		if (!node) {
			throw new Error(`SuttaCentral: unknown text or collection "${uid}"`);
		}

		const title =
			(node.translated_title ?? "").trim() ||
			(node.original_title ?? "").trim() ||
			uid;

		let episodes: Episode[];
		if (node.type === "leaf") {
			// A single sutta (e.g. a search result): itself is the only episode.
			episodes = [this.leafToEpisode(node, lang)];
		} else {
			// The flat suttaplex list is ordered depth-first, so leaves appear
			// after their grouping branches; only leaves are readable texts.
			episodes = list
				.filter((item) => item.type === "leaf")
				.slice(0, MAX_EPISODES)
				.map((item) => this.leafToEpisode(item, lang));
		}
		if (episodes.length === 0) {
			throw new Error(`SuttaCentral: no readable suttas found under "${uid}"`);
		}

		const blurb = (node.blurb ?? "").trim();
		const description =
			blurb.length > 0
				? `${blurb}\n\nEarly Buddhist texts translated on SuttaCentral.net and shared under Creative Commons CC0.`
				: `Texts from SuttaCentral.net, shared under Creative Commons CC0.`;

		const translation = pickTranslation(node.translations, lang);
		const entry: EntryDetailed = {
			id: { uid },
			url: siteUrl(uid),
			titles: [title],
			author: [translation?.author ?? ATTRIBUTION],
			media_type: "Book",
			status: "Complete",
			description,
			language: translation?.lang ?? lang,
			episodes,
			genres: node.root_lang_name ? [node.root_lang_name] : undefined,
			ui: Column(
				Text(`Translation: ${translation?.author ?? ATTRIBUTION}`),
				Link(siteUrl(uid), "Open on SuttaCentral"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	private leafToEpisode(leaf: SuttaplexItem, lang: string): Episode {
		const uid = leaf.uid!;
		const translation = pickTranslation(leaf.translations, lang);
		return {
			id: { uid },
			name: episodeName(
				leaf.acronym,
				leaf.translated_title ?? leaf.original_title,
				uid,
			),
			description: undefined,
			url: siteUrl(uid, translation?.lang, translation?.author_uid),
		};
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const uid = epid.uid;
		const lang = await this.currentLanguage(settings);
		const list = await fetchSuttaplex(uid, lang);
		const node = list[0];
		if (!node) {
			throw new Error(`SuttaCentral: unknown sutta "${uid}"`);
		}

		const translation = pickTranslation(node.translations, lang);
		const data = await fetchBilaraSutta(uid, translation);
		const paragraphs: Paragraph[] = bilaraToParagraphs(data);
		if (paragraphs.length === 0) {
			throw new Error(
				`SuttaCentral: no text found for "${uid}"${
					translation ? ` (${translation.lang})` : ""
				}`,
			);
		}
		paragraphs.push({
			type: "Text",
			content: `Source: ${BASE_URL} — ${ATTRIBUTION}`,
			style: { italic: true },
		});

		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
