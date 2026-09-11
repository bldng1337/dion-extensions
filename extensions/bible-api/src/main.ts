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
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	API_BASE,
	BOOKS,
	bookDescription,
	chapterQuery,
	findBook,
	formatVerseText,
	makeEpisodeUid,
	PAGE_SIZE,
	parseEpisodeUid,
	passageUrl,
	searchBooks,
	TRANSLATION_LANGUAGES,
	TRANSLATION_NAMES,
	TRANSLATION_SETTING_ID,
	TRANSLATIONS,
	type BookInfo,
} from "./bible-api.ts";

// ---------------------------------------------------------------------------
// Remote data shapes (https://bible-api.com)
// ---------------------------------------------------------------------------

interface ApiVerse {
	book_id?: string;
	book_name?: string;
	chapter?: number;
	verse?: number;
	text?: string;
}

interface ApiPassage {
	reference?: string;
	verses?: ApiVerse[];
	text?: string;
	translation_id?: string;
	translation_name?: string;
	translation_note?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// API client (rate limited to 15 req / 30 s per IP — always serve from cache
// when possible)
// ---------------------------------------------------------------------------

/** Session cache of fetched passages, keyed by "<translation>|<query>". */
const chapterCache = new Map<string, ApiPassage>();

async function fetchPassage(
	query: string,
	translation: string,
): Promise<ApiPassage> {
	const key = `${translation}|${query}`;
	const cached = chapterCache.get(key);
	if (cached) {
		return cached;
	}
	const res = await fetch(passageUrl(query, translation));
	const data = (
		typeof res.json === "object" && res.json !== null ? res.json : {}
	) as ApiPassage;
	if (data.error !== undefined) {
		throw new Error(`bible-api.com: ${data.error} (${query})`);
	}
	if (!res.ok) {
		throw new Error(
			`bible-api.com request failed (HTTP ${res.status}) for ${query}`,
		);
	}
	if ((data.verses ?? []).length === 0) {
		throw new Error(`bible-api.com: no verses returned for ${query}`);
	}
	chapterCache.set(key, data);
	return data;
}

interface TranslationInfo {
	name: string;
	note?: string;
}

const translationCache = new Map<string, TranslationInfo>();

/**
 * Copyright/description metadata for a translation. Probed once per session;
 * `JHN 3:16` is used because it exists in every offered translation (the Open
 * English Bible editions cover the New Testament only). Falls back to static
 * data when the probe fails so detail() still works.
 */
async function translationInfo(translation: string): Promise<TranslationInfo> {
	const cached = translationCache.get(translation);
	if (cached) {
		return cached;
	}
	const fallback: TranslationInfo = {
		name: TRANSLATION_NAMES[translation] ?? translation,
		note: "Public Domain",
	};
	let info = fallback;
	try {
		const passage = await fetchPassage("JHN+3:16", translation);
		info = {
			name: passage.translation_name ?? fallback.name,
			note: passage.translation_note ?? fallback.note,
		};
	} catch {
		info = fallback;
	}
	translationCache.set(translation, info);
	return info;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function bookToEntry(book: BookInfo): Entry {
	return {
		id: { uid: book.id },
		url: passageUrl(chapterQuery(book, 1)),
		title: book.name,
		media_type: "Book",
		author: ["Various"],
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		translation: new ExtensionSetting<string>(
			TRANSLATION_SETTING_ID,
			"web",
			"Extension",
		)
			.setLabel("Translation")
			.setUI(new Dropdown(TRANSLATIONS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/**
	 * The host threads the per-entry settings record into detail()/source();
	 * once the translation has been resolved there it rides along in it,
	 * otherwise fall back to the registered extension setting.
	 */
	private async resolveTranslation(
		settings: Record<string, Setting>,
	): Promise<string> {
		return (
			new SettingStore(settings).tryGet<string>(TRANSLATION_SETTING_ID) ??
			this.settings.translation.get()
		);
	}

	async browse(page: number): Promise<EntryList> {
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: BOOKS.slice(start, start + PAGE_SIZE).map(bookToEntry),
			hasnext: start + PAGE_SIZE < BOOKS.length,
			length: BOOKS.length,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const results = searchBooks(filter);
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			content: results.slice(start, start + PAGE_SIZE).map(bookToEntry),
			hasnext: start + PAGE_SIZE < results.length,
			length: results.length,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const book = findBook(entryid.uid);
		if (book === undefined) {
			throw new Error(`bible-api: unknown Bible book "${entryid.uid}"`);
		}
		const translation = await this.resolveTranslation(settings);
		const info = await translationInfo(translation);

		const episodes: Episode[] = [];
		for (let chapter = 1; chapter <= book.chapters; chapter++) {
			episodes.push({
				id: { uid: makeEpisodeUid(book, chapter) },
				name: `Chapter ${chapter}`,
				url: passageUrl(chapterQuery(book, chapter)),
			});
		}

		const meta: Record<string, string> = { Translation: info.name };
		if (info.note !== undefined) {
			meta.Copyright = info.note;
		}

		const ui: CustomUI = Column(
			Text(`Translation: ${info.name}`),
			info.note !== undefined ? Text(info.note) : undefined,
			Link(`${API_BASE}/`, "Powered by bible-api.com"),
		);

		const entry: EntryDetailed = {
			id: { uid: book.id },
			url: passageUrl(chapterQuery(book, 1)),
			titles: [book.name],
			author: ["Various"],
			media_type: "Book",
			status: "Complete",
			description: bookDescription(book),
			language: TRANSLATION_LANGUAGES[translation] ?? "en",
			episodes,
			meta,
			ui,
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const { book, chapter } = parseEpisodeUid(epid.uid);
		const translation = await this.resolveTranslation(settings);
		const passage = await fetchPassage(
			chapterQuery(book, chapter),
			translation,
		);

		// One bold heading from the API's localized reference (e.g. "Ioannes 3"),
		// then one paragraph per verse with a plain verse-number prefix. Psalm
		// superscriptions need no special handling — the API numbers them as
		// verse 1 of the chapter.
		const paragraphs: Paragraph[] = [
			{
				type: "Text",
				content: passage.reference ?? `${book.name} ${chapter}`,
				style: { bold: true },
			},
		];
		for (const verse of passage.verses ?? []) {
			const text = formatVerseText(verse.text ?? "");
			if (verse.verse === undefined || text.length === 0) {
				continue;
			}
			paragraphs.push({
				type: "Text",
				content: `${verse.verse} ${text}`,
				style: null,
			});
		}

		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
