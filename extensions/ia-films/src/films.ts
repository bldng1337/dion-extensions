// Pure helpers for the Internet Archive Films & Serials extension. Kept free
// of the built-in `network`/`parse` modules so they can be unit-tested
// directly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

export const COLLECTION_SETTING_ID = "ia_films_collection";

/** Default browse/search collection. */
export const DEFAULT_COLLECTION = "feature_films";

/**
 * Curated movie collections inside archive.org's movies section. Every
 * identifier was verified against advancedsearch.php (mediatype:movies):
 * `film_noir` and `serials` do NOT exist as collections — the film-noir
 * set is `Film_Noir`, and movie serials (Flash Gordon etc.) are uploaded
 * as individual chapter items inside `short_films`/`moviesandfilms`
 * rather than living in a collection of their own.
 */
export const COLLECTIONS: { value: string; label: string }[] = [
	{ value: DEFAULT_COLLECTION, label: "Feature Films" },
	{ value: "prelinger", label: "Prelinger Archives" },
	{ value: "moviesandfilms", label: "Movies and Films" },
	{ value: "Film_Noir", label: "Film Noir" },
];

// ---------------------------------------------------------------------------
// Query / URL helpers
// ---------------------------------------------------------------------------

/**
 * archive.org advancedsearch expects a field query like `title:(foo bar)`;
 * strip characters that have query-syntax meaning so user input can't break
 * out of the group.
 */
export function sanitizeQueryTerm(filter: string): string {
	return filter
		.replace(/["()[\]{}:]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Restricts searches to items that actually ship a streamable video file.
 * Some highly-downloaded "movies" items are metadata-only stubs (no media
 * files at all), and advancedsearch has no "has files" field — but it can
 * query the indexed `format` field, which lists every file format present.
 */
export const VIDEO_FORMAT_CLAUSE =
	'format:("h.264" OR "h.264 IA" OR "MPEG4" OR "512Kb MPEG4" OR "HiRes MPEG4" OR "Ogg Video")';

/**
 * Builds the advancedsearch `q` string. Always restricted to openly
 * downloadable movies: `mediatype:movies`, no `access-restricted-item`
 * flag (which marks lending/print-disabled items) and at least one
 * streamable video format, scoped to the selected collection and, for
 * searches, the title.
 */
export function buildQuery(options: {
	collection?: string;
	term?: string;
}): string {
	const clauses = [
		"mediatype:movies",
		"-access-restricted-item:true",
		VIDEO_FORMAT_CLAUSE,
		`collection:${options.collection ?? DEFAULT_COLLECTION}`,
	];
	const term = sanitizeQueryTerm(options.term ?? "");
	if (term.length > 0) {
		clauses.push(`title:(${term})`);
	}
	return clauses.join(" AND ");
}

/** The runtime VM ships no URL globals, so encode query strings by hand. */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

export function detailsUrl(identifier: string): string {
	return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

export function coverUrl(identifier: string): string {
	return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

export function fileUrl(identifier: string, name: string): string {
	return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`;
}

/**
 * Episodes are identified as `<identifier>#<encodeURIComponent(fileName)>` so
 * source() can rebuild the download URL without refetching the item metadata.
 */
export function episodeUid(identifier: string, fileName: string): string {
	return `${identifier}#${encodeURIComponent(fileName)}`;
}

export function parseEpisodeUid(
	uid: string,
): { identifier: string; fileName: string } | null {
	const idx = uid.indexOf("#");
	if (idx <= 0 || idx === uid.length - 1) {
		return null;
	}
	const identifier = uid.slice(0, idx);
	let fileName: string;
	try {
		fileName = decodeURIComponent(uid.slice(idx + 1));
	} catch {
		return null;
	}
	if (identifier.length === 0 || fileName.length === 0) {
		return null;
	}
	return { identifier, fileName };
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

/**
 * First non-empty string of a metadata field. archive.org returns most
 * fields as a string, but occasionally as an array (or a number), and the
 * raw metadata is typed as a bag of unknowns.
 */
export function firstString(value: unknown): string | undefined {
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string") {
		return value.length > 0 ? value : undefined;
	}
	if (Array.isArray(value)) {
		const first = value.find((v) => typeof v === "string" && v.length > 0);
		return first as string | undefined;
	}
	return undefined;
}

/** All non-empty strings of a metadata field, whatever shape it arrives in. */
export function stringList(value: unknown): string[] {
	return [value]
		.flat()
		.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Lending/print-disabled items carry `access-restricted-item` metadata. */
export function isRestricted(
	metadata: Record<string, unknown> | undefined | null,
): boolean {
	const flag = metadata?.["access-restricted-item"];
	return flag === true || flag === "true";
}

/** Release year: prefer the indexed `year`, fall back to `date`'s year. */
export function publicationYear(
	metadata: Record<string, unknown> | undefined | null,
): string | undefined {
	const year = metadata?.year;
	if (typeof year === "number") {
		return String(year);
	}
	if (typeof year === "string" && year.length > 0) {
		return year;
	}
	const date = metadata?.date;
	if (typeof date === "string") {
		const match = /^\d{4}/.exec(date.trim());
		if (match) {
			return match[0];
		}
	}
	return undefined;
}

/**
 * Genres from the `subject` field. IA movies use `;` separators within a
 * single string ("Action;Adventure;Serial") or an array of strings; commas
 * are left alone so "Drama, silent" style subjects survive intact.
 */
export function splitGenres(subject: unknown, max = 10): string[] {
	const genres: string[] = [];
	for (const raw of stringList(subject)) {
		for (const part of raw.split(";")) {
			const genre = part.trim();
			if (genre.length > 0 && !genres.includes(genre)) {
				genres.push(genre);
				if (genres.length >= max) {
					return genres;
				}
			}
		}
	}
	return genres;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** Compact human runtime like "1h 12m" from a seconds figure. */
export function humanRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.round((totalSeconds % 3600) / 60);
	if (h <= 0) {
		return `${m}m`;
	}
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Clock-style runtime like "9:15" or "1:17:26" from a seconds figure. */
export function clockRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = Math.round(totalSeconds % 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Parses an IA file `length` value, which is either seconds ("554.99") or a
 * clock string ("9:15", "1:17:26"), into whole seconds.
 */
export function parseLength(raw: string | undefined): number | undefined {
	const value = raw?.trim();
	if (value === undefined || value.length === 0) {
		return undefined;
	}
	if (/^\d+(\.\d+)?$/.test(value)) {
		return Math.round(Number(value));
	}
	const parts = value.split(":").map((p) => Number(p));
	if (
		(parts.length !== 2 && parts.length !== 3) ||
		parts.some((p) => Number.isNaN(p))
	) {
		return undefined;
	}
	// "9:15" -> 555, "1:17:26" -> 4646 (rounding away decimal seconds).
	const seconds = parts
		.reverse()
		.reduce((acc, part, i) => acc + part * 60 ** i, 0);
	return Math.round(seconds);
}

/** Item-level `runtime` metadata uses clock strings ("9:15", "1:17:26"). */
export function metadataRuntime(
	metadata: Record<string, unknown> | undefined | null,
): number | undefined {
	return parseLength(firstString(metadata?.runtime));
}

// ---------------------------------------------------------------------------
// HTML descriptions
// ---------------------------------------------------------------------------

/** Decode the HTML entities archive.org descriptions use. */
export function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&hellip;/gi, "…")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		);
}

/** Strip HTML tags and decode the entities archive.org descriptions use. */
export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n\n")
		.replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Normalizes an archive.org description: the field can be missing, a plain
 * string, an array of paragraphs or a blob of HTML. Very long descriptions
 * are trimmed at a sentence or paragraph boundary.
 */
export function normalizeDescription(
	description: unknown,
	maxLength = 1200,
): string {
	let raw: string;
	if (typeof description === "string") {
		raw = description;
	} else if (Array.isArray(description)) {
		raw = description
			.map((part) => (typeof part === "string" ? part : ""))
			.join("\n\n");
	} else {
		raw = "";
	}
	const text = stripHtml(decodeEntities(raw));
	if (text.length <= maxLength) {
		return text;
	}
	const cut = text.slice(0, maxLength);
	const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
	const keep = lastBreak > maxLength * 0.5 ? lastBreak : maxLength;
	return `${cut.slice(0, keep).trim()} […]`;
}

// ---------------------------------------------------------------------------
// Video file picking
// ---------------------------------------------------------------------------

/** Subset of archive.org metadata `files[]` entries we care about. */
export interface IaVideoFile {
	name?: string;
	format?: string;
	title?: string;
	length?: string;
	size?: string;
	height?: string | number;
	width?: string | number;
}

/** A deduplicated, playable video of an item (best format of its group). */
export interface PickedVideo {
	/** File name within the item, for the download URL. */
	name: string;
	/** Raw file title from the item page, when present. */
	title?: string;
	/** Runtime in seconds, when the file metadata provides it. */
	duration?: number;
	/** File size in bytes, when the file metadata provides it. */
	size?: number;
}

/**
 * Quality rank for a video format. IA movie items mix uploader originals
 * (MPEG2 DVD dumps, .avi/.mov files) with IA derivatives ("h.264",
 * "h.264 IA", "HiRes MPEG4", "512Kb MPEG4", "Ogg Video"). Streaming-wise the
 * h.264 derivatives are the sweet spot, Ogg is the fallback for older items,
 * and raw MPEG2 originals are a last resort (hundreds of MB). Returns
 * undefined for non-playable formats (thumbnails, torrents, XML metadata...).
 */
export function videoFormatRank(file: IaVideoFile): number | undefined {
	const f = (file.format ?? "").trim().toLowerCase().replace(/\s+/g, " ");
	switch (f) {
		case "h.264 ia":
			return 9;
		case "h.264":
			return 8;
		case "hires mpeg4":
			return 7;
		case "mpeg4":
			return 6;
		case "512kb mpeg4":
			return 5;
		case "ogg video":
		case "ogg theora":
			return 4;
		case "matroska":
			return 3;
		case "quicktime":
			return 2;
		case "mpeg2":
			return 1;
		default:
			break;
	}
	// Sloppily tagged community uploads sometimes leave the format empty or
	// unknown while the file itself is a plain video; trust the extension.
	if (f.length === 0 || f === "unknown") {
		return /\.(mp4|m4v|mkv|webm|mov)$/i.test(file.name ?? "") ? 2 : undefined;
	}
	return undefined;
}

/**
 * Strips the extension and derivative suffixes (`.ia`, `_512kb`, `_hires`,
 * `_edit`, `_ia`) so the MP4/OGG/MPEG2 derivatives of one video share a stem
 * and can be deduplicated.
 */
export function fileStem(name: string): string {
	return name
		.replace(/\.(mp4|m4v|ogv|ogg|mpeg|mpg|avi|mov|mkv|webm|flv|wmv)$/i, "")
		.replace(/(?:\.|_)ia$/i, "")
		.replace(/_(?:512kb|hires|edit|sample)$/i, "")
		.trim();
}

/** Humanizes a file stem into an episode name ("VTS_01_2" -> "VTS 01 2"). */
export function stemToTitle(stem: string): string {
	return stem
		.replace(/[_\-.]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function fileSize(file: IaVideoFile): number {
	const size = Number(file.size);
	return Number.isFinite(size) && size > 0 ? size : 0;
}

function fileDuration(file: IaVideoFile): number | undefined {
	return parseLength(file.length);
}

/**
 * Picks the playable videos of an item from its files[] array: groups
 * derivative files by stem, keeps the highest-ranked format per group
 * ("h.264 IA" over "h.264" over "512Kb MPEG4" over "Ogg Video" over raw
 * MPEG2), and skips nameless/non-video entries. Order follows the item's own
 * file order.
 */
export function pickVideos(
	files: IaVideoFile[] | undefined | null,
): PickedVideo[] {
	const best = new Map<string, { rank: number; file: IaVideoFile }>();
	for (const file of files ?? []) {
		const name = typeof file?.name === "string" ? file.name : "";
		if (name.length === 0) {
			continue;
		}
		const rank = videoFormatRank(file);
		if (rank === undefined) {
			continue;
		}
		const stem = fileStem(name);
		if (stem.length === 0) {
			continue;
		}
		const prev = best.get(stem);
		if (
			prev === undefined ||
			rank > prev.rank ||
			(rank === prev.rank && fileSize(file) > fileSize(prev.file))
		) {
			best.set(stem, { rank, file });
		}
	}
	const picked: PickedVideo[] = [];
	for (const { file } of best.values()) {
		const title = typeof file.title === "string" ? file.title.trim() : "";
		const size = fileSize(file);
		picked.push({
			name: file.name ?? "",
			title: title.length > 0 ? title : undefined,
			duration: fileDuration(file),
			size: size > 0 ? size : undefined,
		});
	}
	return picked;
}

export type VideoSelection =
	| { mode: "single"; video: PickedVideo }
	| { mode: "multi"; videos: PickedVideo[] }
	| { mode: "none" };

/**
 * Decides how an item's picked videos map to episodes:
 * - 0 videos -> none; 1 video -> single.
 * - When the longest video clearly dominates (>= 2x the second longest), the
 *   item is a feature plus extras/previews/derived DVD dumps -> single.
 *   (e.g. "Night of the Living Dead" DVD items ship the full feature plus
 *   split VTS parts and a 10s VIDEO_TS lead-in.)
 * - Otherwise the videos are comparable parts of one work (split DVD rips or
 *   single-item serial uploads where chapters are separate files) -> multi.
 */
export function selectVideos(videos: PickedVideo[]): VideoSelection {
	if (videos.length === 0) {
		return { mode: "none" };
	}
	const first = videos[0];
	if (videos.length === 1 && first !== undefined) {
		return { mode: "single", video: first };
	}
	const withDurations = videos.filter((v) => (v.duration ?? 0) > 0);
	if (withDurations.length === 0) {
		// No duration metadata at all: expose the largest file as the feature.
		const largest = videos.reduce((a, b) =>
			(b.size ?? 0) > (a.size ?? 0) ? b : a,
		);
		return { mode: "single", video: largest };
	}
	const sorted = [...withDurations].sort(
		(a, b) => (b.duration ?? 0) - (a.duration ?? 0),
	);
	const longest = sorted[0];
	const second = sorted[1];
	if (
		longest !== undefined &&
		second !== undefined &&
		(longest.duration ?? 0) >= 2 * (second.duration ?? 0)
	) {
		return { mode: "single", video: longest };
	}
	// Multi-part: drop files that are clearly junk relative to the longest
	// part (< 5% of its runtime, e.g. 10s DVD lead-ins), keep item order.
	const cutoff = (longest?.duration ?? 0) * 0.05;
	const parts = videos.filter(
		(v) => (v.duration ?? Number.POSITIVE_INFINITY) > cutoff,
	);
	return parts.length > 0
		? { mode: "multi", videos: parts }
		: { mode: "multi", videos };
}
