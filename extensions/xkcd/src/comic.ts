import type { Entry, EntryDetailed } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints & constants
//
// xkcd.com offers a small key-less JSON API: `/info.0.json` for the latest
// strip and `/<num>/info.0.json` for a specific one. Images live on a separate
// host (imgs.xkcd.com) and can be .png or .jpg. Numbers in the payload are
// strings, and some strip numbers are intentional gaps (e.g. #404) that answer
// HTTP 404. Content is CC BY-NC 2.5, so attribution is shown in the UI.
// ---------------------------------------------------------------------------

export const LATEST_API_URL = "https://xkcd.com/info.0.json";
export const SITE_URL = "https://xkcd.com/";

export const AUTHOR = "Randall Munroe";
export const LICENSE_NOTE =
	"xkcd by Randall Munroe is licensed under CC BY-NC 2.5.";

export const PAGE_SIZE = 25;

/** Shape of a single xkcd JSON API document (only the fields we consume). */
export interface XkcdComic {
	num?: number | string;
	title?: string;
	safe_title?: string;
	img?: string;
	alt?: string;
	transcript?: string;
	year?: string | number;
	month?: string | number;
	day?: string | number;
	link?: string;
	news?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Coerce a JSON API number (string or number) to a positive integer. */
export function toNum(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const parsed = Number(value.trim());
		return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

/** JSON API endpoint for one comic. */
export function comicApiUrl(num: number): string {
	return `https://xkcd.com/${num}/info.0.json`;
}

/** Canonical site page for one comic. */
export function comicPageUrl(num: number): string {
	return `https://xkcd.com/${num}/`;
}

/** Zero-padded release date ("YYYY-MM-DD") from the string-typed fields. */
export function comicDate(comic: XkcdComic): string | undefined {
	const year = toNum(comic.year);
	const month = toNum(comic.month);
	const day = toNum(comic.day);
	if (!year || !month || !day) {
		return undefined;
	}
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${year}-${pad(month)}-${pad(day)}`;
}

/** Display title; `safe_title` is the entity-free variant of `title`. */
export function comicTitle(comic: XkcdComic, num: number): string {
	const title = (comic.safe_title ?? comic.title ?? "").trim();
	return title.length > 0 ? title : `xkcd #${num}`;
}

/**
 * Transcripts annotate panels with `[[stage directions]]` and repeat the hover
 * text in `{{Title text: ...}}` / `{Alt: ...}` blocks; drop those blocks since
 * the alt text is already part of the description.
 */
export function cleanTranscript(raw: string): string {
	return raw
		.replace(/\{\{[^}]*\}\}/g, "")
		.replace(/\{(?:alt|title text)\s*:[^}]*\}/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Alt text as the description, plus the cleaned transcript when present. */
export function comicDescription(comic: XkcdComic): string {
	const alt = (comic.alt ?? "").trim();
	const transcript = cleanTranscript(comic.transcript ?? "");
	const parts: string[] = [];
	if (alt.length > 0) {
		parts.push(alt);
	}
	if (transcript.length > 0) {
		parts.push(`Transcript:\n${transcript}`);
	}
	return parts.join("\n\n");
}

/** Case-insensitive free-text match over title, alt text and transcript. */
export function matchesComic(comic: XkcdComic, query: string): boolean {
	const term = query.trim().toLowerCase();
	if (term.length === 0) {
		return false;
	}
	const fields = [comic.safe_title, comic.title, comic.alt, comic.transcript];
	return fields.some((field) => (field ?? "").toLowerCase().includes(term));
}

/** Slice one page out of a newest-first list. */
export function paginate<T>(
	items: T[],
	page: number,
	size: number = PAGE_SIZE,
): { content: T[]; hasnext: boolean } {
	const start = Math.max(0, page) * size;
	const content = items.slice(start, start + size);
	return { content, hasnext: start + size < items.length };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** One browse row per strip; null when the document has no usable number. */
export function comicToEntry(comic: XkcdComic): Entry | null {
	const num = toNum(comic.num);
	if (!num) {
		return null;
	}
	return {
		id: { uid: String(num) },
		url: comicPageUrl(num),
		title: comicTitle(comic, num),
		media_type: "Comic",
		cover: comic.img ? { url: comic.img } : undefined,
		author: [AUTHOR],
	};
}

/** Map a batch of comics to entries, skipping unusable documents. */
export function comicsToEntries(comics: XkcdComic[]): Entry[] {
	const entries: Entry[] = [];
	for (const comic of comics) {
		const entry = comicToEntry(comic);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/** Base detail view (without custom UI); null when the document is unusable. */
export function comicToDetail(comic: XkcdComic): EntryDetailed | null {
	const num = toNum(comic.num);
	if (!num) {
		return null;
	}
	const url = comicPageUrl(num);
	const released = comicDate(comic);
	return {
		id: { uid: String(num) },
		url,
		titles: [comicTitle(comic, num)],
		author: [AUTHOR],
		media_type: "Comic",
		status: "Complete",
		description: comicDescription(comic),
		language: "en",
		cover: comic.img ? { url: comic.img } : undefined,
		poster: comic.img ? { url: comic.img } : undefined,
		episodes: [
			{
				id: { uid: String(num) },
				name: "Read",
				url,
			},
		],
		meta: released ? { Released: released } : null,
	};
}
