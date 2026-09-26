// Normalisation of the host `metadata` module's snapshots into the flat,
// JSON-serialisable shape this extension caches and renders. Only *types* are
// imported from the built-in module, so every helper here stays unit-testable
// outside the runtime.

import type { Chapter } from "@dion-js/runtime-types/runtime";
import type {
	ArchiveMetadata,
	AudioMetadata,
	EpubMetadata,
	Mp4Metadata,
} from "metadata";

/** Everything `metadata.inspect` can hand back. */
export type InspectedMetadata =
	| EpubMetadata
	| ArchiveMetadata
	| Mp4Metadata
	| AudioMetadata;

export type ContainerKind = "epub" | "mp4" | "audio";

/** A playback chapter, still in milliseconds. */
export type MetaChapter = {
	title: string;
	startMs: number;
	durationMs?: number;
};

/**
 * One file's metadata, flattened and stripped of the raw artwork bytes (only
 * `hasCover` is kept, so the shape survives the JSON-only cache).
 */
export type FileMeta = {
	kind: ContainerKind;
	title?: string;
	authors: string[];
	/** Album / disc grouping label — what a folder entry is named after. */
	album?: string;
	publisher?: string;
	description?: string;
	language?: string;
	genres: string[];
	year?: string;
	track?: number;
	trackTotal?: number;
	disc?: number;
	discTotal?: number;
	durationMs?: number;
	hasCover: boolean;
	/** Table-of-contents entries, for books. */
	contentsCount: number;
	chapters: MetaChapter[];
};

/** The cache envelope, so "inspected and empty" is distinguishable from a miss. */
export type CachedMeta = { meta: FileMeta | null };

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Trims a tag, mapping anything empty to undefined. */
function text(value: string | null | undefined): string | undefined {
	if (value === null || value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

function texts(values: readonly (string | null | undefined)[]): string[] {
	const out: string[] = [];
	for (const value of values) {
		const cleaned = text(value);
		if (cleaned !== undefined && !out.includes(cleaned)) out.push(cleaned);
	}
	return out;
}

function num(value: number | null | undefined): number | undefined {
	return value === null || value === undefined || value <= 0
		? undefined
		: value;
}

/** Pulls a four-digit year out of a publication date, if there is one. */
function year(published: string | null | undefined): string | undefined {
	const match = /\d{4}/.exec(published ?? "");
	return match ? match[0] : undefined;
}

function chapters(chapters: Mp4Metadata["chapters"]): MetaChapter[] {
	return chapters.map((chapter) => ({
		title: text(chapter.title) ?? "",
		startMs: chapter.startMs,
		durationMs: chapter.durationMs,
	}));
}

function fromEpub(raw: EpubMetadata): FileMeta {
	return {
		kind: "epub",
		title: text(raw.title),
		authors: texts(raw.creators.map((creator) => creator.name)),
		publisher: text(raw.publishers[0]),
		description: text(raw.description),
		language: text(raw.languages[0]),
		genres: texts(raw.subjects),
		year: year(raw.published),
		hasCover: raw.coverPath !== undefined,
		contentsCount: raw.toc.length,
		chapters: [],
	};
}

function fromMp4(raw: Mp4Metadata): FileMeta {
	return {
		kind: "mp4",
		title: text(raw.title),
		// The album artist is the more meaningful "author" of a video file;
		// the track artist is kept only when there is no album artist.
		authors: texts([raw.albumArtist, raw.artist]),
		album: text(raw.album),
		description: text(raw.description),
		genres: texts([raw.genre]),
		year: text(raw.year),
		track: num(raw.track),
		trackTotal: num(raw.trackTotal),
		disc: num(raw.disc),
		discTotal: num(raw.discTotal),
		durationMs: num(raw.durationMs),
		hasCover: raw.artwork !== undefined,
		contentsCount: 0,
		chapters: chapters(raw.chapters),
	};
}

function fromAudio(raw: AudioMetadata): FileMeta {
	return {
		kind: "audio",
		title: text(raw.title),
		authors: texts([raw.artist]),
		album: text(raw.album),
		genres: texts([raw.genre]),
		year: raw.year === undefined ? undefined : `${raw.year}`,
		track: num(raw.track),
		durationMs: num(raw.durationMs),
		hasCover: raw.artwork !== undefined,
		contentsCount: 0,
		chapters: [],
	};
}

/**
 * Flattens an inspected container. A plain ZIP/CBZ carries no descriptive
 * metadata, so it normalises to null and the file falls back to its name.
 */
export function normalizeMetadata(raw: InspectedMetadata): FileMeta | null {
	switch (raw.type) {
		case "epub":
			return fromEpub(raw);
		case "mp4":
			return fromMp4(raw);
		case "audio":
			return fromAudio(raw);
		default:
			return null;
	}
}

/** Narrows an untrusted cache read back to a cache envelope. */
export function isCachedMeta(value: unknown): value is CachedMeta {
	if (value === null || typeof value !== "object") return false;
	return "meta" in value;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function pad(value: number): string {
	return value < 10 ? `0${value}` : `${value}`;
}

/** "4:05" or "1:02:03". */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(seconds)}`
		: `${minutes}:${pad(seconds)}`;
}

/**
 * The "Jane Austen • Penguin • 2019 • 3:24" fact line under a title. `perFile`
 * is false for a folder entry, where one episode's running time and chapter
 * count would say nothing about the entry as a whole.
 */
export function describeMetadata(
	meta: FileMeta | undefined,
	perFile: boolean,
): string {
	if (meta === undefined) return "";
	const parts: string[] = [];
	if (meta.authors.length > 0) parts.push(meta.authors.join(", "));
	if (meta.album !== undefined) parts.push(meta.album);
	if (meta.publisher !== undefined) parts.push(meta.publisher);
	if (meta.year !== undefined) parts.push(meta.year);
	if (meta.genres.length > 0) parts.push(meta.genres.join(", "));
	if (!perFile) return parts.join(" • ");
	const count =
		meta.contentsCount > 0 ? meta.contentsCount : meta.chapters.length;
	if (count > 0) parts.push(`${count} chapters`);
	if (meta.durationMs !== undefined)
		parts.push(formatDuration(meta.durationMs));
	return parts.join(" • ");
}

/** An episode prefers its own tag over its filename. */
export function episodeName(
	meta: FileMeta | undefined,
	fallback: string,
): string {
	return meta?.title ?? fallback;
}

/** "Track 3", or "Disc 2, Track 3" on a multi-disc release. */
export function episodeTrackLabel(meta: FileMeta | undefined): string | null {
	if (meta === undefined || meta.track === undefined) return null;
	return meta.disc !== undefined && meta.disc > 1
		? `Disc ${meta.disc}, Track ${meta.track}`
		: `Track ${meta.track}`;
}

/**
 * The album every inspected file agrees on, or undefined. A folder entry uses
 * it as its title so an album of tagged tracks is named after the album rather
 * than the folder it happens to sit in.
 */
export function commonAlbum(
	metas: (FileMeta | undefined)[],
): string | undefined {
	const known = metas.filter((meta) => meta?.album !== undefined);
	if (known.length === 0) return undefined;
	const [first] = known;
	const album = first?.album;
	if (album === undefined) return undefined;
	return known.every((meta) => meta?.album === album) ? album : undefined;
}

/** Every genre across the inspected files, in order of first appearance. */
export function collectGenres(metas: (FileMeta | undefined)[]): string[] {
	return texts(
		metas.flatMap((meta) => (meta === undefined ? [] : meta.genres)),
	);
}

/** The first authors found, which is the entry's author line. */
export function collectAuthors(
	metas: (FileMeta | undefined)[],
): string[] | null {
	for (const meta of metas) {
		if (meta !== undefined && meta.authors.length > 0) return meta.authors;
	}
	return null;
}

/**
 * Playback chapters for a Video/Audio source, or null when the file has none.
 * The runtime counts chapter positions in seconds, and a chapter with no
 * duration runs until the next one starts, so the last one ends open.
 */
export function sourceChapters(meta: FileMeta | undefined): Chapter[] | null {
	if (meta === undefined || meta.chapters.length === 0) return null;
	const seconds = (ms: number) => ms / 1000;
	return meta.chapters.map((chapter) => ({
		title: chapter.title,
		start: seconds(chapter.startMs),
		end:
			chapter.durationMs === undefined
				? null
				: seconds(chapter.startMs + chapter.durationMs),
		kind: null,
	}));
}

// ---------------------------------------------------------------------------
// Cover proxy plumbing
// ---------------------------------------------------------------------------

/** Reads the `path` parameter out of a cover request uri. */
export function parseCoverPath(uri: string): string | null {
	const query = uri.indexOf("?");
	if (query < 0) return null;
	for (const part of uri.slice(query + 1).split("&")) {
		const eq = part.indexOf("=");
		if (eq < 0 || part.slice(0, eq) !== "path") continue;
		try {
			const value = decodeURIComponent(part.slice(eq + 1));
			return value.length === 0 ? null : value;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Whether a cover request may read the named file: a relative path inside the
 * library root, with no traversal and no native separators.
 */
export function isSafeRelPath(rel: string): boolean {
	if (rel.length === 0) return false;
	if (rel.includes("\\") || rel.startsWith("/")) return false;
	return !rel
		.split("/")
		.some((part) => part === "" || part === "." || part === "..");
}

/** The content type of embedded artwork, sniffed from its magic bytes. */
export function sniffImageType(bytes: Uint8Array): string {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) {
		return "image/png";
	}
	if (
		bytes.length >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46
	) {
		return "image/gif";
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	return "application/octet-stream";
}
