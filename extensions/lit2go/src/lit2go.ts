// ---------------------------------------------------------------------------
// Pure helpers for the Lit2Go extension.
//
// Everything here is plain string/JSON work with no dependency on the host
// built-in modules (`network`, `parse`, ...), so it can be unit-tested with
// plain bun and inlined fixtures. The HTML walking itself lives in main.ts
// and uses the host's parseHtml.
// ---------------------------------------------------------------------------

export const BASE_URL = "https://etc.usf.edu/lit2go";
export const BOOKS_URL = `${BASE_URL}/books/`;
export const SEARCH_URL = `${BASE_URL}/search/`;
export const SITE_LANG = "en";

/** Lit2Go stores one square PNG cover per book id under /static/thumbnails. */
export function thumbnailUrl(bookId: string): string {
	return `${BASE_URL}/static/thumbnails/books/${bookId}.png`;
}

/**
 * Extract the numeric book id from any Lit2Go URL.
 * Book pages:  /lit2go/{book}/{slug}/
 * Passages:    /lit2go/{book}/{slug}/{passage}/{slug}/
 */
export function bookIdFromUrl(url: string): string | undefined {
	return /\/lit2go\/(\d+)\//.exec(url)?.[1];
}

/** A passage page has four path segments after /lit2go/. */
export function isPassageUrl(url: string): boolean {
	return /\/lit2go\/\d+\/[^/]+\/\d+\/[^/]+\/?$/.test(url);
}

/** Named + numeric HTML entities seen in Lit2Go text. `&amp;` last on
 * purpose so double-escaped input is not decoded twice. */
export function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&nbsp;|&#0?160;/gi, " ")
		.replace(/&rsquo;|&lsquo;|&#0?8216;|&#0?8217;/gi, "'")
		.replace(/&ldquo;|&rdquo;|&#0?8220;|&#0?8221;/gi, '"')
		.replace(/&mdash;|&#0?8212;/gi, "—")
		.replace(/&ndash;|&#0?8211;/gi, "–")
		.replace(/&hellip;|&#0?8230;/gi, "…")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;|&#0?39;/gi, "'")
		.replace(/&amp;/gi, "&");
}

/** Collapse whitespace and strip stray tags/entities from extracted text. */
export function cleanText(input: string | undefined): string {
	return decodeEntities((input ?? "").replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Page slices for client-side pagination of fully cached listings. */
export function slicePage<T>(
	items: T[],
	page: number,
	size: number,
): { items: T[]; hasnext: boolean } {
	const start = Math.max(0, Math.trunc(page)) * size;
	return {
		items: items.slice(start, start + size),
		hasnext: items.length > start + size,
	};
}

/** "Displaying 1–25 of 100" -> 100 (undefined when absent). */
export function parseDisplayTotal(
	header: string | undefined,
): number | undefined {
	const match = /\bof\s+([\d,]+)\b/i.exec(cleanText(header));
	if (!match?.[1]) {
		return undefined;
	}
	const total = Number.parseInt(match[1].replace(/,/g, ""), 10);
	return Number.isNaN(total) ? undefined : total;
}

/** Split a `<li>` blob like "Year Published: 1865" into key/value. */
export function metaValue(
	text: string,
): { key: string; value: string } | undefined {
	const colon = text.indexOf(":");
	if (colon <= 0) {
		return undefined;
	}
	const key = text.slice(0, colon).trim();
	const value = text.slice(colon + 1).trim();
	if (key.length === 0 || value.length === 0) {
		return undefined;
	}
	return { key, value };
}

/** Lit2Go is an English-only resource; map the site's label to a BCP-47 tag. */
export function normalizeLanguage(label: string | undefined): string {
	return (label ?? "").trim().toLowerCase() === "english" ? "en" : SITE_LANG;
}
