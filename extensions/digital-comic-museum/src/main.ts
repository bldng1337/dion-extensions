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
	type IaFileEntry,
	PAGE_SIZE,
	coverUrl,
	detailsUrl,
	decodeEntities,
	fileUrl,
	firstString,
	metadataUrl,
	normalizeDescription,
	parseReadableFiles,
	pickReadableFiles,
	publicationYear,
	searchUrl,
	serializeReadableFiles,
	stringList,
	type ReadableFiles,
	isUnreadable,
} from "./dcm.ts";

// ---------------------------------------------------------------------------
// Remote data shapes
// ---------------------------------------------------------------------------

interface IaSearchDoc {
	identifier: string;
	title?: string;
	creator?: string | string[];
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
//
// digitalcomicmuseum.com serves every page behind a Cloudflare JS challenge
// and gates downloads behind a free account, so this extension reads the open
// Internet Archive mirrors instead: items that credit the Digital Comic
// Museum and expose page images or a PDF derivative (see dcm.ts).
//
// - advancedsearch.php lists mirror items (paged, filterable by title).
// - /metadata/<identifier> gives metadata fields plus the files[] array that
//   decides how the comic is readable: individual JPEG page scans become an
//   Imagelist, a PDF derivative becomes a Pdf source. Items with only a
//   CBZ/CBR archive are rejected — the runtime cannot unpack archives.
// ---------------------------------------------------------------------------

interface IaSearchResult {
	docs: IaSearchDoc[];
	hasMore: boolean;
}

async function searchArchive(
	page: number,
	term?: string,
): Promise<IaSearchResult> {
	const res = await fetch(searchUrl(page, term));
	if (!res.ok) {
		throw new Error(`archive.org search request failed (${res.status})`);
	}
	const data = res.json as IaSearchResponse;
	const numFound = data.response?.numFound ?? 0;
	const docs = data.response?.docs ?? [];
	return { docs, hasMore: (Math.max(0, page) + 1) * PAGE_SIZE < numFound };
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
	const res = await fetch(metadataUrl(identifier));
	if (!res.ok) {
		throw new Error(`archive.org metadata request failed (${res.status})`);
	}
	const item = res.json as IaMetadataResponse;
	// archive.org answers HTTP 200 with `{}` for unknown identifiers.
	if (!item.metadata && !item.files) {
		throw new Error(`archive.org item "${identifier}" does not exist`);
	}
	const result = {
		metadata: item.metadata ?? {},
		files: item.files ?? [],
	};
	itemCache.set(identifier, result);
	return result;
}

/**
 * Resolves the readable files of an item, rejecting mirror items that only
 * carry a CBZ/CBR archive (the runtime cannot unpack those).
 */
async function resolveReadable(identifier: string): Promise<ReadableFiles> {
	const { files } = await fetchItemCached(identifier);
	const readable = pickReadableFiles(files);
	if (isUnreadable(readable)) {
		throw new Error(
			`Digital Comic Museum: "${identifier}" only offers CBZ/CBR archives, which cannot be read here`,
		);
	}
	return readable;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function iaDocToEntry(doc: IaSearchDoc): Entry {
	const identifier = doc.identifier;
	return {
		id: { uid: identifier },
		url: detailsUrl(identifier),
		title: decodeEntities(doc.title ?? "") || identifier,
		media_type: "Comic",
		cover: { url: coverUrl(identifier) },
		author: doc.creator === undefined ? undefined : stringList(doc.creator),
	};
}

/** License/attribution note shown on every detail page. The museum's own
 * site is not linked because it rejects plain HTTP clients. */
const SOURCE_NOTE =
	"Scans via the Digital Comic Museum (digitalcomicmuseum.com), a public-domain Golden Age comics library, mirrored on the Internet Archive.";

function detailUI(identifier: string): CustomUI {
	return Column(
		Text(SOURCE_NOTE),
		Link(detailsUrl(identifier), "View on archive.org"),
	);
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

	private async list(page: number, term?: string): Promise<EntryList> {
		const { docs, hasMore } = await searchArchive(page, term);
		return {
			content: docs.map(iaDocToEntry),
			hasnext: hasMore,
		};
	}

	/** Paged listing of the open Digital Comic Museum mirrors, most downloaded first. */
	async browse(page: number): Promise<EntryList> {
		return this.list(page);
	}

	/** Server-side title search inside the mirror set (IA relevance order). */
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
		const readable = await resolveReadable(identifier);

		const title =
			decodeEntities(firstString(metadata.title) ?? "") || identifier;
		const authors = stringList(metadata.creator);
		const year = publicationYear(metadata);
		const language = firstString(metadata.language) ?? "en";

		const meta: Record<string, string> = {
			"Scan source": "Digital Comic Museum",
		};
		if (year !== undefined) {
			meta.Year = year;
		}
		const publisher = firstString(metadata.publisher);
		if (publisher !== undefined) {
			meta.Publisher = publisher;
		}

		const entry: EntryDetailed = {
			id: { uid: identifier },
			url: detailsUrl(identifier),
			titles: [title],
			author: authors.length > 0 ? authors : undefined,
			media_type: "Comic",
			status: "Complete",
			description:
				normalizeDescription(metadata.description) ||
				`${title} — Golden Age comic from the Digital Comic Museum.`,
			language,
			cover: { url: coverUrl(identifier) },
			poster: { url: coverUrl(identifier) },
			episodes: [
				{
					id: {
						uid: identifier,
						iddata: serializeReadableFiles(readable),
					},
					name: "Read",
					url: detailsUrl(identifier),
				} satisfies Episode,
			],
			meta,
			ui: detailUI(identifier),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const identifier = epid.uid;
		// The readable files ride along in the episode iddata; refetch the
		// item when they are missing (entry opened without detail()).
		let readable = parseReadableFiles(epid.iddata);
		if (readable === null || isUnreadable(readable)) {
			readable = await resolveReadable(identifier);
		}
		if (readable.pages.length > 0) {
			return {
				source: {
					type: "Imagelist",
					links: readable.pages.map((name) => ({
						url: fileUrl(identifier, name),
					})),
					audio: null,
				},
				settings: { ...settings },
			};
		}
		if (readable.pdf !== null) {
			return {
				source: {
					type: "Pdf",
					link: { url: fileUrl(identifier, readable.pdf) },
				},
				settings: { ...settings },
			};
		}
		throw new Error(
			`Digital Comic Museum: no readable pages found for "${identifier}"`,
		);
	}
}
