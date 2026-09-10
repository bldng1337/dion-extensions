// Pure helpers for the Internet Archive Old Time Radio extension. Kept free
// of the built-in `network`/`parse` modules so they can be unit-tested
// directly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

/** The archive.org meta-collection holding the OTR series and episode items. */
export const COLLECTION = "oldtimeradio";

/** A curated, hand-verified radio series for the browse screen. */
export interface SeriesSeed {
	/** Display title, e.g. "X Minus One". */
	name: string;
	/** Identifier of the canonical archive.org item (a full-series set). */
	identifier: string;
	/** Producing network/organisation, when known. */
	producer?: string;
}

/**
 * Curated list of popular public-domain radio series for browse. Each
 * identifier was verified to be an open archive.org audio item with direct
 * MP3 downloads; most are Old Time Radio Researchers (OTRR) "Single Episodes"
 * sets, which OTRR distributes without restriction. The full series lives in
 * one item, so one item maps to one entry and its MP3s to the episodes.
 */
export const SERIES: SeriesSeed[] = [
	{
		name: "Suspense",
		identifier: "OTRR_Suspense_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "X Minus One",
		identifier: "OTRR_X_Minus_One_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Gunsmoke",
		identifier: "OTRR_Gunsmoke_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Dragnet",
		identifier: "OTRR_Dragnet_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Lux Radio Theater",
		identifier: "OTRR_Lux_Radio_Theater_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{ name: "The Jack Benny Program", identifier: "TheJackBennyProgram" },
	{ name: "Our Miss Brooks", identifier: "Our_Miss_Brooks_190_Episodes" },
	{ name: "Fibber McGee and Molly", identifier: "fibber-mc-gee-and-molly" },
	{
		name: "The Lone Ranger",
		identifier: "OTRR_LoneRanger_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "The Shadow",
		identifier: "the-shadow-1938-10-09-141-death-stalks-the-shadow",
	},
	{
		name: "Yours Truly, Johnny Dollar",
		identifier: "OTRR_YoursTrulyJohnnyDollar_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "The Whistler",
		identifier: "OTRR_Whistler_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "The Adventures of Philip Marlowe",
		identifier: "OTRR_Philip_Marlowe_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Richard Diamond, Private Detective",
		identifier: "OTRR_Richard_Diamond_Private_Detective_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Inner Sanctum Mysteries",
		identifier: "OTRR_Inner_Sanctum_Mysteries_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Dimension X",
		identifier: "OTRR_Dimension_X_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Theater Five",
		identifier: "OTRR_Theater_Five_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{
		name: "Boston Blackie",
		identifier: "OTRR_Boston_Blackie_Singles",
		producer: "Old Time Radio Researchers Group",
	},
	{ name: "The Green Hornet", identifier: "TheGreenHornet" },
	{
		name: "Burns and Allen",
		identifier: "the-burns-and-allen-show-1934-09-26-2-leaving-for-america",
	},
	{ name: "Tales of the Texas Rangers", identifier: "TalesOfTheTexasRangers" },
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
 * Builds the advancedsearch `q` string for a series title search: audio items
 * in the oldtimeradio meta-collection (which contains the OTRR sets) matching
 * the title, excluding lending/print-disabled items.
 */
export function buildSearchQuery(term: string): string {
	return [
		`collection:${COLLECTION}`,
		"mediatype:audio",
		"-access-restricted-item:true",
		`title:(${sanitizeQueryTerm(term)})`,
	].join(" AND ");
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
 * source() can rebuild the download URL without refetching the (potentially
 * very large) item metadata.
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
 * First non-empty string of a metadata field. archive.org returns most fields
 * as a string, but occasionally as an array (or a number), and the raw
 * metadata is typed as a bag of unknowns.
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

/** Publication year: prefer the indexed `year`, fall back to `date`'s year. */
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

/** Compact human runtime like "1h 12m" from a seconds figure. */
export function humanRuntime(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.round((totalSeconds % 3600) / 60);
	if (h <= 0) {
		return `${m}m`;
	}
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Human runtime from an IA file `length` field, which is either seconds
 * ("1678.48") or h:mm:ss / m:ss ("22:04", "1:02:03").
 */
export function humanDuration(raw: string | undefined): string | undefined {
	const value = raw?.trim();
	if (value === undefined || value.length === 0) {
		return undefined;
	}
	if (/^\d+(\.\d+)?$/.test(value)) {
		return humanRuntime(Math.round(Number(value)));
	}
	const parts = value.split(":").map((p) => Number(p));
	if (
		(parts.length !== 2 && parts.length !== 3) ||
		parts.some((p) => Number.isNaN(p))
	) {
		return undefined;
	}
	const pad = (n: number) => n.toString().padStart(2, "0");
	if (parts.length === 3) {
		const [h, m, s] = parts as [number, number, number];
		return `${h}:${pad(m)}:${pad(s)}`;
	}
	const [m, s] = parts as [number, number];
	return `${m}:${pad(s)}`;
}

// ---------------------------------------------------------------------------
// Audio file picking
// ---------------------------------------------------------------------------

/** Subset of archive.org metadata `files[]` entries we care about. */
export interface IaFileEntry {
	name?: string;
	format?: string;
	title?: string;
	length?: string;
	track?: string;
}

/** A picked, playable episode file of an item. */
export interface PickedEpisodeFile {
	/** File name within the item, for the download URL. */
	name: string;
	/** Human episode title from the file's metadata, when present. */
	title?: string;
	/** Raw runtime (`length`) value of the file. */
	length?: string;
}

/**
 * Quality rank for a playable file format. Every MP3 derivative of an episode
 * gets a rank so duplicates collapse to the best one; "Ogg Vorbis" is kept as
 * a last-resort fallback for items without MP3s. Returns undefined for
 * non-playable formats (spectrograms, bit torrents, XML metadata, ...).
 */
export function audioFormatRank(format: string): number | undefined {
	const f = format.trim().toUpperCase();
	if (f === "VBR MP3") {
		return 3;
	}
	const bitrate = /^(\d{2,3})KBPS MP3$/.exec(f);
	if (bitrate) {
		const kbps = Number(bitrate[1]);
		if (kbps >= 128) {
			return 4;
		}
		return kbps >= 64 ? 2 : 1;
	}
	if (f === "OGG VORBIS" || f === "OGG") {
		return 0;
	}
	return undefined;
}

/**
 * Strips the extension and derivative suffixes (`_64kb`, `_128kb`, `_vbr`,
 * `_edit`) so the MP3/OGG derivatives of one episode share a stem and can be
 * deduplicated.
 */
export function fileStem(name: string): string {
	return name
		.replace(/\.(mp3|ogg|oga|flac|m4a|wav)$/i, "")
		.replace(/_(?:vbr|edit|32kb|48kb|56kb|64kb|96kb|128kb)$/i, "")
		.trim();
}

/**
 * Picks one playable file per episode from an item's files[] array: groups by
 * stem, keeps the highest-ranked format per group (128Kbps MP3 over VBR MP3
 * over 64Kbps MP3, Ogg Vorbis as fallback), and skips nameless/non-audio
 * entries. Order follows the item's own file order.
 */
export function pickEpisodeFiles(
	files: IaFileEntry[] | undefined | null,
): PickedEpisodeFile[] {
	const best = new Map<string, { rank: number; file: IaFileEntry }>();
	for (const file of files ?? []) {
		const name = typeof file?.name === "string" ? file.name : "";
		if (name.length === 0) {
			continue;
		}
		const rank = audioFormatRank(file?.format ?? "");
		if (rank === undefined) {
			continue;
		}
		const stem = fileStem(name);
		if (stem.length === 0) {
			continue;
		}
		const prev = best.get(stem);
		if (prev === undefined || rank > prev.rank) {
			best.set(stem, { rank, file });
		}
	}
	const picked: PickedEpisodeFile[] = [];
	for (const { file } of best.values()) {
		const name = file.name ?? "";
		const title = typeof file.title === "string" ? file.title.trim() : "";
		picked.push({
			name,
			title: title.length > 0 ? title : undefined,
			length: typeof file.length === "string" ? file.length : undefined,
		});
	}
	return picked;
}
