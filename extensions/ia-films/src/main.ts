import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
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
	clockRuntime,
	COLLECTIONS,
	COLLECTION_SETTING_ID,
	DEFAULT_COLLECTION,
	coverUrl,
	detailsUrl,
	encodeQuery,
	episodeUid,
	fileStem,
	fileUrl,
	firstString,
	humanRuntime,
	isRestricted,
	metadataRuntime,
	normalizeDescription,
	PAGE_SIZE,
	parseEpisodeUid,
	pickVideos,
	publicationYear,
	selectVideos,
	splitGenres,
	stemToTitle,
	stringList,
	type IaVideoFile,
	type PickedVideo,
} from "./films.ts";

// ---------------------------------------------------------------------------
// Endpoints
//
// Everything comes from archive.org's public JSON APIs (no login needed for
// open items):
// - advancedsearch.php lists items; the query is restricted to
//   `mediatype:movies` without the `access-restricted-item` flag, scoped to
//   the selected collection (feature_films / prelinger / moviesandfilms /
//   Film_Noir — the names verified to exist; `film_noir` and `serials` do
//   not).
// - /metadata/<identifier> gives an item's metadata fields and files[] array.
//   Movie items ship uploader originals (MPEG2, .avi) alongside IA
//   derivatives ("h.264 IA", "h.264", "HiRes MPEG4", "512Kb MPEG4",
//   "Ogg Video"); we pick the best streamable derivative per video.
// - /download/<identifier>/<name> serves the file (it 302s to a dynamic
//   dn*.us.archive.org node at play time, host-side) and /services/img/
//   <identifier> the cover thumbnail.
//
// Serials: archive.org stores classic chapter serials (Flash Gordon Conquers
// the Universe etc.) as one item per chapter (flash_gordon1 ... flash_gordon12)
// with no machine-readable "parent serial" link, so each chapter surfaces as
// its own entry with a single "Watch" episode. The reverse layout — one item
// carrying all chapters as separate files — is handled too: when an item's
// videos have comparable runtimes they become one episode per video.
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
	date?: string;
	downloads?: number;
}

interface IaSearchResponse {
	response?: {
		numFound?: number;
		docs?: IaSearchDoc[];
	};
}

interface IaMetadataResponse {
	metadata?: Record<string, unknown>;
	files?: IaVideoFile[];
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
		...["identifier", "title", "creator", "date", "downloads"].map(
			(field): [string, string] => ["fl[]", field],
		),
	]);
	// archive.org occasionally answers a burst of requests with an empty
	// body; retry once before giving up.
	for (let attempt = 0; attempt < 2; attempt++) {
		const res = await fetch(`${IA_SEARCH_URL}?${queryString}`);
		if (!res.ok) {
			throw new Error(`archive.org search request failed (${res.status})`);
		}
		const data = res.json as IaSearchResponse | undefined;
		if (data?.response === undefined) {
			continue;
		}
		const numFound = data.response.numFound ?? 0;
		const docs = data.response.docs ?? [];
		return {
			docs,
			hasMore: Math.max(1, page + 1) * PAGE_SIZE < numFound,
		};
	}
	return { docs: [], hasMore: false };
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
 * Item metadata rarely changes; cache it per identifier for the session so
 * detail() and source() share one fetch.
 */
const itemCache = new Map<
	string,
	{ metadata: Record<string, unknown>; files: IaVideoFile[] }
>();

async function fetchItemCached(identifier: string): Promise<{
	metadata: Record<string, unknown>;
	files: IaVideoFile[];
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
 * Resolves the playable videos of an item, refusing lending-restricted items
 * even if they slipped through the search filter and items with no video at
 * all (the metadata endpoint answers `{}` for unknown identifiers).
 */
async function resolveVideos(identifier: string): Promise<PickedVideo[]> {
	const { metadata, files } = await fetchItemCached(identifier);
	if (isRestricted(metadata)) {
		throw new Error(
			`Internet Archive: "${identifier}" is lending-restricted and has no open streams`,
		);
	}
	return pickVideos(files);
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
		media_type: "Video",
		cover: { url: coverUrl(identifier) },
		author: doc.creator === undefined ? undefined : [doc.creator].flat(),
		views: typeof doc.downloads === "number" ? doc.downloads : undefined,
	};
}

function episodeName(video: PickedVideo, index: number): string {
	const title = video.title ?? stemToTitle(fileStem(video.name));
	return title.length > 0 ? title : `Part ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		collection: new ExtensionSetting<string>(
			COLLECTION_SETTING_ID,
			DEFAULT_COLLECTION,
			"Search",
		)
			.setLabel("Collection")
			.setUI(new Dropdown(COLLECTIONS)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- SourceProvider ------------------------------------------------------

	private async list(page: number, term?: string): Promise<EntryList> {
		const collection = await this.settings.collection.get();
		const { docs, hasMore } = await searchArchive(
			buildQuery({ collection, term }),
			page,
		);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	/** Pages through the most-downloaded open movies of the chosen collection. */
	async browse(page: number): Promise<EntryList> {
		return this.list(page);
	}

	/** Title search within the chosen collection's open movies. */
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
		const picked = await resolveVideos(identifier);
		if (picked.length === 0) {
			throw new Error(
				`Internet Archive: no playable video files found for "${identifier}"`,
			);
		}
		const selection = selectVideos(picked);

		const episodes: Episode[] =
			selection.mode === "single"
				? [
						{
							id: { uid: episodeUid(identifier, selection.video.name) },
							name: "Watch",
							url: fileUrl(identifier, selection.video.name),
							description:
								selection.video.duration === undefined
									? undefined
									: `Runtime: ${clockRuntime(selection.video.duration)}`,
						},
					]
				: selection.mode === "multi"
					? selection.videos.map((video, index): Episode => {
							const duration = video.duration;
							return {
								id: { uid: episodeUid(identifier, video.name) },
								name: episodeName(video, index),
								url: fileUrl(identifier, video.name),
								description:
									duration === undefined
										? undefined
										: `Runtime: ${clockRuntime(duration)}`,
							};
						})
					: [];

		const title = firstString(metadata.title) ?? identifier;
		const authors = stringList(metadata.creator);
		const genres = splitGenres(metadata.subject);

		const meta: Record<string, string> = {};
		const year = publicationYear(metadata);
		if (year !== undefined) {
			meta.Year = year;
		}
		const director = authors[0];
		if (director !== undefined) {
			meta.Director = director;
		}
		const runtime =
			metadataRuntime(metadata) ??
			(selection.mode === "single"
				? selection.video.duration
				: selection.mode === "multi"
					? selection.videos.reduce((sum, v) => sum + (v.duration ?? 0), 0)
					: undefined);
		if (runtime !== undefined) {
			meta.Runtime = `${humanRuntime(runtime)} (${clockRuntime(runtime)})`;
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
			media_type: "Video",
			status: "Complete",
			description: normalizeDescription(metadata.description),
			language: firstString(metadata.language) ?? "en",
			cover: { url: coverUrl(identifier) },
			poster: { url: coverUrl(identifier) },
			episodes,
			genres: genres.length > 0 ? genres : undefined,
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
				type: "Video",
				sources: [
					{
						name: fileStem(fileName) || fileName,
						lang: "en",
						url: { url: fileUrl(identifier, fileName) },
					},
				],
				sub: [],
				chapters: null,
			},
		};
	}
}
