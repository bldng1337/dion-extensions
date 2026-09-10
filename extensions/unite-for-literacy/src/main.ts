import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, FoldableText, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	CustomUI,
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
import {
	type CatalogBook,
	CATALOG_URL,
	LANGUAGES_URL,
	LICENSE_NOTE,
	LANGUAGE_NOTE_MAX_LANGS,
	NARRATION_LANGUAGES,
	type UflBook,
	type UflCatalog,
	type UflNarration,
	SITE_URL,
	bookJsonUrl,
	bookLang,
	bookPageUrl,
	bookToDetail,
	buildAudio,
	catalogBookToEntry,
	catalogBooks,
	languageName,
	matchesTitle,
	narrationJsonUrl,
	narrationLangs,
	pageImages,
	paginate,
	personCredits,
} from "./ufl.ts";

// ---------------------------------------------------------------------------
// API client
//
// Everything is static JSON on the site's S3 hosts, so no sessions or cookies
// are needed. The catalogue (libInfoCombo.json, ~230 KB) is fetched once per
// extension session and cached; book JSONs are cached per BKID; narration in
// the configured language is fetched per book in `source` (and only when it
// differs from the book's own written language).
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(
			`unite-for-literacy: request failed (${res.status}) for ${url}`,
		);
	}
	return res.json as T;
}

/**
 * GET a book1.json; null when the book does not exist (403/404 - unpublished
 * or unknown BKID), so callers can raise a precise error.
 */
async function fetchBook(bkid: string): Promise<UflBook | null> {
	const res = await fetch(bookJsonUrl(bkid));
	if (res.status === 403 || res.status === 404) {
		return null;
	}
	if (!res.ok) {
		throw new Error(
			`unite-for-literacy: book request failed (${res.status}) for ${bkid}`,
		);
	}
	return res.json as UflBook;
}

/** GET an aud_<lang>.json; null when the book has no narration in `lang`. */
async function fetchNarration(
	bkid: string,
	lang: string,
): Promise<UflNarration | null> {
	const res = await fetch(narrationJsonUrl(bkid, lang));
	if (res.status === 403 || res.status === 404) {
		return null;
	}
	if (!res.ok) {
		throw new Error(
			`unite-for-literacy: narration request failed (${res.status}) for ${bkid}/${lang}`,
		);
	}
	return res.json as UflNarration;
}

let catalogPromise: Promise<UflCatalog> | null = null;

/** Whole catalogue, fetched once per session (retried after a failure). */
function catalog(): Promise<UflCatalog> {
	catalogPromise ??= fetchJson<UflCatalog>(CATALOG_URL).catch(
		(err: unknown) => {
			catalogPromise = null;
			throw err;
		},
	);
	return catalogPromise;
}

let languageNamesPromise: Promise<Record<string, string>> | null = null;

/** Language code -> name map; empty map if languages.json is unavailable. */
function languageNames(): Promise<Record<string, string>> {
	languageNamesPromise ??= fetchJson<{
		languages?: { eng?: Record<string, string> };
	}>(LANGUAGES_URL)
		.then((data) => data.languages?.eng ?? {})
		.catch(() => ({}));
	return languageNamesPromise;
}

/** Session cache of fetched books, keyed by BKID. */
const bookCache = new Map<string, Promise<UflBook | null>>();

function book(bkid: string): Promise<UflBook | null> {
	let cached = bookCache.get(bkid);
	if (!cached) {
		cached = fetchBook(bkid).catch((err: unknown) => {
			bookCache.delete(bkid);
			throw err;
		});
		bookCache.set(bkid, cached);
	}
	return cached;
}

/** The deduplicated catalogue as browsable rows. */
async function allBooks(): Promise<CatalogBook[]> {
	return catalogBooks(await catalog());
}

/** Map catalogue rows to entries, skipping unusable rows. */
function rowsToEntries(rows: CatalogBook[]): Entry[] {
	const entries: Entry[] = [];
	for (const row of rows) {
		const entry = catalogBookToEntry(row);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		narration: new ExtensionSetting<string>("narration", "", "Extension")
			.setLabel("Narration language")
			.setUI(
				new Dropdown(
					NARRATION_LANGUAGES.map(({ value, label }) => ({ value, label })),
				),
			),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const { content, hasnext } = paginate(await allBooks(), page);
		return { content: rowsToEntries(content), hasnext };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const hits = (await allBooks()).filter((row) =>
			matchesTitle(row.title, query),
		);
		const { content, hasnext } = paginate(hits, page);
		return { content: rowsToEntries(content), hasnext };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const bkid = entryid.uid.trim();
		if (!/^\d+$/.test(bkid)) {
			throw new Error(`unite-for-literacy: invalid entry id "${entryid.uid}"`);
		}
		const fetched = await book(bkid);
		if (!fetched) {
			throw new Error(`unite-for-literacy: book ${bkid} not found`);
		}
		const detail = bookToDetail(fetched, bkid);
		if (!detail) {
			throw new Error(`unite-for-literacy: book ${bkid} has no usable title`);
		}
		const entry: EntryDetailed = {
			...detail,
			ui: await detailUI(fetched, bkid),
		};
		return { entry, settings };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const bkid = epid.uid.trim();
		if (!/^\d+$/.test(bkid)) {
			throw new Error(`unite-for-literacy: invalid episode id "${epid.uid}"`);
		}
		const fetched = await book(bkid);
		if (!fetched) {
			throw new Error(`unite-for-literacy: book ${bkid} not found`);
		}
		const { urls, linkIndex } = pageImages(fetched);
		if (urls.length === 0) {
			throw new Error(`unite-for-literacy: book ${bkid} has no readable pages`);
		}

		// Narration language: "" (or the book's own language) uses the native
		// audio from book1.json; otherwise fetch aud_<lang>.json. If the chosen
		// language yields nothing usable, fall back to the native narration.
		const lang = String(await this.settings.narration.get())
			.trim()
			.toLowerCase();
		let narration: UflNarration | null = null;
		if (lang.length > 0 && lang !== bookLang(fetched)) {
			narration = await fetchNarration(bkid, lang);
		}
		let audio = buildAudio(fetched, narration, linkIndex);
		if (audio.length === 0 && narration !== null) {
			audio = buildAudio(fetched, null, linkIndex);
		}

		return {
			settings,
			source: {
				type: "Imagelist",
				links: urls.map((url) => ({ url })),
				audio: audio.length > 0 ? audio : null,
			},
		};
	}
}

/** Attribution, narration languages and links shown under the description. */
async function detailUI(fetched: UflBook, bkid: string): Promise<CustomUI> {
	const names = await languageNames();
	const langs = narrationLangs(fetched);
	const credits = personCredits(fetched);
	const shown = langs
		.slice(0, LANGUAGE_NOTE_MAX_LANGS)
		.map((code) => languageName(code, names));
	const extra = langs.length - shown.length;
	return Column(
		Text(LICENSE_NOTE),
		langs.length > 0
			? Text(
					`Narrated in ${langs.length} language${langs.length === 1 ? "" : "s"}: ${shown.join(", ")}${extra > 0 ? `, and ${extra} more` : ""}.`,
				)
			: undefined,
		credits.length > 0
			? FoldableText(`Credits: ${credits.join(", ")}.`)
			: undefined,
		Link(bookPageUrl(bkid), "Read on Unite for Literacy"),
		Link(SITE_URL, "Unite for Literacy"),
	);
}
