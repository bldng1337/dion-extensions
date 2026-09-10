import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
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
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	buildQuery,
	COLLECTIONS,
	COLLECTION_SETTING_ID,
	coverUrl,
	detailsUrl,
	encodeQuery,
	FILE_FORMAT_OPTIONS,
	fileUrl,
	firstString,
	FORMAT_EPUB,
	FORMAT_PDF,
	FORMAT_SETTING_ID,
	isRestricted,
	LANGUAGES,
	LANGUAGE_SETTING_ID,
	normalizeDescription,
	PAGE_SIZE,
	parseFiles,
	pickFiles,
	pickSource,
	publicationYear,
	SORTS,
	SORT_SETTING_ID,
	serializeFiles,
	stringList,
	type DownloadableFiles,
	type IaFileEntry,
} from "./ia.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// Everything comes from archive.org's public JSON APIs:
// - advancedsearch.php lists items; the query is restricted to openly
//   downloadable texts (an EPUB or "Text PDF" derivative and no
//   `access-restricted-item` flag), so lending-only books never surface.
// - /metadata/<identifier> gives an item's metadata fields and files[] array;
//   the download file URL is /download/<identifier>/<name> and the cover
//   thumbnail is /services/img/<identifier>.
// ---------------------------------------------------------------------------

const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_URL = "https://archive.org/metadata/";

// ---------------------------------------------------------------------------
// Remote data shapes
// ---------------------------------------------------------------------------

interface IaSearchDoc {
	identifier: string;
	title?: string;
	creator?: string | string[];
	language?: string | string[];
}

interface IaSearchResponse {
	response?: {
		numFound?: number;
		docs?: IaSearchDoc[];
	};
}

interface IaMetadataResponse {
	metadata?: Record<string, unknown>;
	files?: IaFileEntry[];
}

// ---------------------------------------------------------------------------
// archive.org clients
// ---------------------------------------------------------------------------

interface IaSearchResult {
	docs: IaSearchDoc[];
	hasMore: boolean;
}

async function searchArchive(
	query: string,
	page: number,
	sort: string,
): Promise<IaSearchResult> {
	const queryString = encodeQuery([
		["q", query],
		["rows", String(PAGE_SIZE)],
		["page", String(Math.max(1, page))],
		["sort", sort],
		["output", "json"],
		...["identifier", "title", "creator", "language"].map(
			(field): [string, string] => ["fl[]", field],
		),
	]);
	const res = await fetch(`${IA_SEARCH_URL}?${queryString}`);
	if (!res.ok) {
		throw new Error(`archive.org search request failed (${res.status})`);
	}
	const data = res.json as IaSearchResponse;
	const numFound = data.response?.numFound ?? 0;
	const docs = data.response?.docs ?? [];
	return { docs, hasMore: page * PAGE_SIZE < numFound };
}

async function fetchItem(identifier: string): Promise<IaMetadataResponse> {
	const res = await fetch(
		`${IA_METADATA_URL}${encodeURIComponent(identifier)}`,
	);
	if (!res.ok) {
		throw new Error(`archive.org metadata request failed (${res.status})`);
	}
	return res.json as IaMetadataResponse;
}

/** Item metadata rarely changes; cache it per identifier for the session. */
const itemCache = new Map<
	string,
	{ metadata: Record<string, unknown>; files: IaFileEntry[] }
>();

async function fetchItemCached(identifier: string): Promise<{
	metadata: Record<string, unknown>;
	files: IaFileEntry[];
}> {
	const cached = itemCache.get(identifier);
	if (cached) {
		return cached;
	}
	const item = await fetchItem(identifier);
	const result = {
		metadata: item.metadata ?? {},
		files: item.files ?? [],
	};
	itemCache.set(identifier, result);
	return result;
}

/**
 * Resolves the openly downloadable files of an item, refusing
 * lending-restricted items even if they slipped through the search filter.
 */
async function resolveFiles(identifier: string): Promise<DownloadableFiles> {
	const { metadata, files } = await fetchItemCached(identifier);
	if (isRestricted(metadata)) {
		throw new Error(
			`Internet Archive: "${identifier}" is lending-restricted and has no open download`,
		);
	}
	const candidates = pickFiles(files);
	if (candidates.epub === null && candidates.pdf === null) {
		throw new Error(
			`Internet Archive: no openly downloadable EPUB or PDF found for "${identifier}"`,
		);
	}
	return candidates;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function iaDocToEntry(doc: IaSearchDoc): Entry {
	const identifier = doc.identifier;
	return {
		id: { uid: identifier },
		url: detailsUrl(identifier),
		title: doc.title ?? identifier,
		media_type: "Book",
		cover: { url: coverUrl(identifier) },
		author: doc.creator === undefined ? undefined : [doc.creator].flat(),
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		collection: new ExtensionSetting<string>(
			COLLECTION_SETTING_ID,
			"all",
			"Search",
		)
			.setLabel("Collection")
			.setUI(new Dropdown(COLLECTIONS)),
		language: new ExtensionSetting<string>(LANGUAGE_SETTING_ID, "all", "Search")
			.setLabel("Language")
			.setUI(new Dropdown(LANGUAGES)),
		sort: new ExtensionSetting<string>(
			SORT_SETTING_ID,
			"downloads desc",
			"Search",
		)
			.setLabel("Sort by")
			.setUI(new Dropdown(SORTS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	private async list(page: number, term?: string): Promise<EntryList> {
		const [collection, language, sort] = await Promise.all([
			this.settings.collection.get(),
			this.settings.language.get(),
			this.settings.sort.get(),
		]);
		// Text searches keep the popularity sort so exact matches rank first;
		// the user's sort applies while browsing.
		const { docs, hasMore } = await searchArchive(
			buildQuery({ collection, language, term }),
			page,
			term === undefined ? sort : "downloads desc",
		);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	async browse(page: number): Promise<EntryList> {
		return this.list(page);
	}

	async search(page: number, filter: string): Promise<EntryList> {
		if (filter.trim().length === 0) {
			return { content: [], hasnext: false };
		}
		return this.list(page, filter);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const identifier = entryid.uid;
		const { metadata } = await fetchItemCached(identifier);
		const candidates = await resolveFiles(identifier);

		const sstore = new SettingStore(settings);
		sstore.getOrDefine<string>({
			id: FORMAT_SETTING_ID,
			defaultval: candidates.epub !== null ? FORMAT_EPUB : FORMAT_PDF,
			label: "Preferred format",
			ui: new Dropdown(FILE_FORMAT_OPTIONS),
		});

		const title = firstString(metadata.title) ?? identifier;
		const language = firstString(metadata.language) ?? "";
		const authors = stringList(metadata.creator);

		const meta: Record<string, string> = {};
		const year = publicationYear(metadata);
		if (year !== undefined) {
			meta.Year = year;
		}
		const publisher = firstString(metadata.publisher);
		if (publisher !== undefined) {
			meta.Publisher = publisher;
		}
		if (language.length > 0) {
			meta.Language = language;
		}
		const licenseurl = firstString(metadata.licenseurl);
		if (licenseurl !== undefined) {
			meta.License = licenseurl;
		}

		const ui: CustomUI = Column(
			Text("Links"),
			Link(detailsUrl(identifier), "Internet Archive page"),
		);

		const entry: EntryDetailed = {
			id: { uid: identifier },
			url: detailsUrl(identifier),
			titles: [title],
			author: authors.length > 0 ? authors : undefined,
			media_type: "Book",
			status: "Complete",
			description: normalizeDescription(metadata.description),
			language,
			cover: { url: coverUrl(identifier) },
			poster: { url: coverUrl(identifier) },
			episodes: [
				{
					id: { uid: identifier, iddata: serializeFiles(candidates) },
					name: "Read",
					url: detailsUrl(identifier),
				} satisfies Episode,
			],
			meta: Object.keys(meta).length > 0 ? meta : undefined,
			ui,
		};

		return { entry, settings: { ...settings, ...sstore.toMap() } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const identifier = epid.uid;
		// The download candidates ride along in the episode iddata; refetch
		// the item when they are missing (entry opened without detail()).
		let candidates = parseFiles(epid.iddata);
		if (
			candidates === null ||
			(candidates.epub === null && candidates.pdf === null)
		) {
			candidates = await resolveFiles(identifier);
		}
		const format =
			new SettingStore(settings).tryGet<string>(FORMAT_SETTING_ID) ??
			FORMAT_EPUB;
		const pick = pickSource(candidates, format);
		if (pick === null) {
			throw new Error(
				`Internet Archive: no openly downloadable EPUB or PDF found for "${identifier}"`,
			);
		}
		return {
			source: {
				type: pick.type,
				link: { url: fileUrl(identifier, pick.name) },
			},
			settings: { ...settings },
		};
	}
}
