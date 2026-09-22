import { DionExtension } from "@dion-js/runtime-lib";
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
	buildSearchQuery,
	coverUrl,
	detailsUrl,
	encodeQuery,
	episodeUid,
	fileStem,
	fileUrl,
	firstString,
	humanDuration,
	isRestricted,
	normalizeDescription,
	PAGE_SIZE,
	parseEpisodeUid,
	pickEpisodeFiles,
	publicationYear,
	SERIES,
	stringList,
	type IaFileEntry,
	type PickedEpisodeFile,
} from "./otr.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// Everything comes from archive.org's public JSON APIs (no login needed for
// open items):
// - advancedsearch.php lists items; the query is restricted to audio in the
//   `oldtimeradio` meta-collection, which also contains the Old Time Radio
//   Researchers (OTRR) full-series "Single Episodes" sets distributed
//   without restriction.
// - /metadata/<identifier> gives an item's metadata fields and files[] array.
//   Full-series sets hold one playable file per episode (usually "VBR MP3"
//   originals with "128Kbps MP3"/"64Kbps MP3"/"Ogg Vorbis" derivatives).
// - /download/<identifier>/<name> serves the file (it 302s to a dynamic
//   dn*.us.archive.org node at play time, host-side) and /services/img/
//   <identifier> the cover thumbnail.
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
	year?: string | number;
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
): Promise<IaSearchResult> {
	const queryString = encodeQuery([
		["q", query],
		["rows", String(PAGE_SIZE)],
		["page", String(Math.max(1, page + 1))],
		["sort", "downloads desc"],
		["output", "json"],
		...["identifier", "title", "creator", "year"].map(
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
	return {
		docs,
		hasMore: Math.max(1, page + 1) * PAGE_SIZE < numFound,
	};
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

/**
 * Item metadata is static and some OTR sets carry thousands of files (the
 * metadata JSON alone can be several MB), so cache it per identifier for the
 * session; detail() and source() then share one fetch.
 */
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
 * Resolves the playable episode files of an item, refusing lending-restricted
 * items even if they slipped through the search filter and items with no
 * audio at all (the metadata endpoint answers `{}` for unknown identifiers).
 */
async function resolveEpisodes(
	identifier: string,
): Promise<PickedEpisodeFile[]> {
	const { metadata, files } = await fetchItemCached(identifier);
	if (isRestricted(metadata)) {
		throw new Error(
			`Internet Archive: "${identifier}" is lending-restricted and has no open streams`,
		);
	}
	return pickEpisodeFiles(files);
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
		media_type: "Audio",
		cover: { url: coverUrl(identifier) },
		author: doc.creator === undefined ? undefined : [doc.creator].flat(),
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	/**
	 * Browse pages through the curated list of verified public-domain series.
	 * A series is one archive.org item (an OTRR "Single Episodes" set or an
	 * equivalent full-series collection), so no network calls are needed here.
	 */
	async browse(page: number): Promise<EntryList> {
		const start = Math.max(0, page) * PAGE_SIZE;
		const slice = SERIES.slice(start, start + PAGE_SIZE);
		return {
			content: slice.map((seed): Entry => {
				return {
					id: { uid: seed.identifier },
					url: detailsUrl(seed.identifier),
					title: seed.name,
					media_type: "Audio",
					cover: { url: coverUrl(seed.identifier) },
					author: seed.producer === undefined ? undefined : [seed.producer],
				};
			}),
			hasnext: start + PAGE_SIZE < SERIES.length,
		};
	}

	/**
	 * Search finds series-level items by title within the oldtimeradio
	 * collections. Popularity sort puts the full-series sets (highest
	 * downloads) above single-episode uploads.
	 */
	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const { docs, hasMore } = await searchArchive(buildSearchQuery(term), page);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const identifier = entryid.uid;
		const { metadata } = await fetchItemCached(identifier);
		const picked = await resolveEpisodes(identifier);
		if (picked.length === 0) {
			throw new Error(
				`Internet Archive: no playable audio files found for "${identifier}"`,
			);
		}

		const title = firstString(metadata.title) ?? identifier;
		const authors = stringList(metadata.creator);
		const subjects = stringList(metadata.subject).slice(0, 10);

		const meta: Record<string, string> = {};
		const year = publicationYear(metadata);
		if (year !== undefined) {
			meta.Year = year;
		}
		const producer = authors[0];
		if (producer !== undefined) {
			meta.Producer = producer;
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
			media_type: "Audio",
			status: "Complete",
			description: normalizeDescription(metadata.description),
			language: firstString(metadata.language) ?? "en",
			cover: { url: coverUrl(identifier) },
			poster: { url: coverUrl(identifier) },
			episodes: picked.map(
				(file, index): Episode => ({
					// The file name rides in the episode id so source() can rebuild
					// the download URL directly, even for 2000+ episode sets.
					id: { uid: episodeUid(identifier, file.name) },
					name:
						file.title !== undefined && file.title.length > 0
							? file.title
							: fileStem(file.name) || `Episode ${index + 1}`,
					url: fileUrl(identifier, file.name),
					description: episodeRuntime(file.length),
				}),
			),
			genres: subjects.length > 0 ? subjects : undefined,
			meta: Object.keys(meta).length > 0 ? meta : undefined,
			ui,
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const parsed = parseEpisodeUid(epid.uid);
		if (parsed === null) {
			throw new Error(`Internet Archive: invalid episode id ${epid.uid}`);
		}
		const { identifier, fileName } = parsed;
		return {
			settings: { ...settings },
			source: {
				type: "Audio",
				sources: [
					{
						name: fileStem(fileName) || fileName,
						lang: "en",
						url: { url: fileUrl(identifier, fileName) },
					},
				],
				chapters: null,
			},
		};
	}
}

function episodeRuntime(length: string | undefined): string | undefined {
	const runtime = humanDuration(length);
	return runtime === undefined ? undefined : `Runtime: ${runtime}`;
}
