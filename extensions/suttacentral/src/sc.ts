// Pure helpers + remote data shapes for the SuttaCentral extension.
// No built-in module imports here so unit tests can load this file directly.

import type { Paragraph } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints (all verified against https://suttacentral.net)
//
// - /api/suttaplex/<uid>?language=<lang>  flat depth-first list describing a
//   collection node and all of its descendants; `type` distinguishes
//   "branch" (grouping node) from "leaf" (readable text, carries translations).
// - /api/bilarasuttas/<uid>/<author_uid>?lang=<lang>  segment-level text of a
//   single (possibly ranged) leaf: parallel markup/root/translation maps plus
//   `keys_order` giving the reading order.
// - /api/fulltextsearch/<query>  full-text hits across root + translated
//   segments (max 15 results, no pagination).
// ---------------------------------------------------------------------------

export const BASE_URL = "https://suttacentral.net";
export const API_BASE = `${BASE_URL}/api`;
export const USER_AGENT = "dion-extensions suttacentral/1.0 (personal reader)";

export const PAGE_SIZE = 20;

/** Hard ceiling on episodes built from one suttaplex listing; the largest
 * curated volume (SN Mahāvagga) has ~620 leaves. */
export const MAX_EPISODES = 700;

export const ATTRIBUTION = "SuttaCentral (CC0)";

/** Curated top-level entries. Big nikāyas are added at vagga/nipāta
 * ("subsection") granularity so no single detail() call explodes. */
export interface VolumeSeed {
	uid: string;
	title: string;
}

export const VOLUMES: VolumeSeed[] = [
	{ uid: "dhp", title: "Dhammapada" },
	{ uid: "dn", title: "Long Discourses (Dīgha Nikāya)" },
	{ uid: "mn", title: "Middle Discourses (Majjhima Nikāya)" },
	{
		uid: "sn-sagathavaggasamyutta",
		title: "Linked Discourses I — With Verses (Saṃyutta Nikāya)",
	},
	{
		uid: "sn-nidanavaggasamyutta",
		title: "Linked Discourses II — Causation (Saṃyutta Nikāya)",
	},
	{
		uid: "sn-khandhavaggasamyutta",
		title: "Linked Discourses III — The Aggregates (Saṃyutta Nikāya)",
	},
	{
		uid: "sn-salayatanavaggasamyutta",
		title: "Linked Discourses IV — The Six Sense Fields (Saṃyutta Nikāya)",
	},
	{
		uid: "sn-mahavaggasamyutta",
		title: "Linked Discourses V — The Great Chapter (Saṃyutta Nikāya)",
	},
	{ uid: "an1", title: "Numbered Discourses — The Book of Ones" },
	{ uid: "an2", title: "Numbered Discourses — The Book of Twos" },
	{ uid: "an3", title: "Numbered Discourses — The Book of Threes" },
	{ uid: "an4", title: "Numbered Discourses — The Book of Fours" },
	{ uid: "an5", title: "Numbered Discourses — The Book of Fives" },
	{ uid: "an6", title: "Numbered Discourses — The Book of Sixes" },
	{ uid: "an7", title: "Numbered Discourses — The Book of Sevens" },
	{ uid: "an8", title: "Numbered Discourses — The Book of Eights" },
	{ uid: "an9", title: "Numbered Discourses — The Book of Nines" },
	{ uid: "an10", title: "Numbered Discourses — The Book of Tens" },
	{ uid: "an11", title: "Numbered Discourses — The Book of Elevens" },
	{ uid: "kp", title: "Basic Passages (Khuddakapāṭha)" },
	{ uid: "iti", title: "So It Was Said (Itivuttaka)" },
	{ uid: "ud", title: "Heartfelt Sayings (Udāna)" },
	{ uid: "snp", title: "Anthology of Discourses (Sutta Nipāta)" },
	{ uid: "thag", title: "Verses of the Senior Monks (Theragāthā)" },
	{ uid: "thig", title: "Verses of the Senior Nuns (Therīgāthā)" },
	{ uid: "vv", title: "Stories of Heavenly Mansions (Vimānavatthu)" },
	{ uid: "pv", title: "Stories of Hungry Ghosts (Petavatthu)" },
];

/** Languages known to ship segmented (Bilara) translations for large parts of
 * the canon. Per-sutta availability still varies; source() falls back. */
export const LANGUAGES: { value: string; label: string }[] = [
	{ value: "en", label: "English" },
	{ value: "de", label: "Deutsch (German)" },
	{ value: "ru", label: "Русский (Russian)" },
	{ value: "sr", label: "Српски (Serbian)" },
	{ value: "it", label: "Italiano (Italian)" },
	{ value: "pl", label: "Polski (Polish)" },
	{ value: "pt", label: "Português (Portuguese)" },
	{ value: "vi", label: "Tiếng Việt (Vietnamese)" },
];

export const LANGUAGE_SETTING_ID = "language";

// ---------------------------------------------------------------------------
// Remote data shapes
// ---------------------------------------------------------------------------

export interface SuttaTranslation {
	lang?: string;
	author_uid?: string;
	author?: string;
	segmented?: boolean;
	is_root?: boolean;
	id?: string;
	title?: string | null;
}

export interface SuttaplexItem {
	uid?: string | null;
	acronym?: string | null;
	blurb?: string | null;
	type?: "branch" | "leaf" | null;
	original_title?: string | null;
	translated_title?: string | null;
	root_lang_name?: string | null;
	translations?: SuttaTranslation[];
	parallel_count?: number;
	priority_author_uid?: string | null;
}

export interface FulltextHit {
	uid?: string;
	acronym?: string;
	name?: string;
	lang?: string;
	author?: string;
	author_uid?: string;
	is_root?: boolean;
	root_uid?: string;
	segmented_text?: string;
}

/** Response of /api/bilarasuttas/<uid>/<author>?lang=<lang>. */
export interface BilaraSutta {
	html_text?: Record<string, string>;
	root_text?: Record<string, string>;
	translation_text?: Record<string, string>;
	variant_text?: Record<string, string>;
	reference_text?: Record<string, string>;
	comment_text?: Record<string, string>;
	keys_order?: string[];
}

export interface ChosenTranslation {
	lang: string;
	author_uid: string;
	author?: string;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** The runtime VM ships no URL globals, so encode query strings by hand. */
export function encodeQuery(pairs: [string, string][]): string {
	return pairs
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

export function apiUrl(path: string, pairs: [string, string][] = []): string {
	const query = encodeQuery(pairs);
	return `${API_BASE}/${path}${query.length > 0 ? `?${query}` : ""}`;
}

export function siteUrl(
	uid: string,
	lang?: string,
	authorUid?: string,
): string {
	const suffix = lang ? `/${lang}${authorUid ? `/${authorUid}` : ""}` : "";
	return `${BASE_URL}/${uid}${suffix}`;
}

// ---------------------------------------------------------------------------
// Translation selection
// ---------------------------------------------------------------------------

/**
 * Pick the best segmented (Bilara) translation for `lang`.
 * Falls back: exact lang -> English -> any segmented translation.
 * Legacy (non-segmented) translations cannot be served by the
 * /api/bilarasuttas endpoint and are never chosen.
 */
export function pickTranslation(
	translations: SuttaTranslation[] | undefined | null,
	lang: string,
): ChosenTranslation | undefined {
	const candidates = (translations ?? []).filter(
		(t) =>
			t.segmented === true &&
			t.is_root !== true &&
			typeof t.author_uid === "string" &&
			t.author_uid.length > 0 &&
			typeof t.lang === "string" &&
			t.lang.length > 0,
	);
	if (candidates.length === 0) {
		return undefined;
	}
	const exact = candidates.find((t) => t.lang === lang);
	if (exact) {
		return {
			lang: exact.lang!,
			author_uid: exact.author_uid!,
			author: exact.author,
		};
	}
	if (lang !== "en") {
		return pickTranslation(candidates, "en");
	}
	const first = candidates[0]!;
	return {
		lang: first.lang!,
		author_uid: first.author_uid!,
		author: first.author,
	};
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** "MN 1 — The Root of All Things"; empty parts are dropped. */
export function episodeName(
	acronym: string | null | undefined,
	title: string | null | undefined,
	uid: string,
): string {
	const parts: string[] = [];
	const acro = (acronym ?? "").trim();
	const name = (title ?? "").trim();
	if (acro.length > 0 && !name.startsWith(acro)) {
		parts.push(acro);
	}
	if (name.length > 0) {
		parts.push(name);
	}
	if (parts.length === 0) {
		parts.push(uid);
	}
	return parts.join(" — ");
}

// ---------------------------------------------------------------------------
// Bilara segments -> reading paragraphs
// ---------------------------------------------------------------------------

/** Remove simple inline markup and decode the few entities Bilara uses. */
export function cleanSegmentText(raw: string): string {
	return raw
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;/gi, "'")
		.replace(/&ldquo;|&rdquo;/gi, '"')
		.replace(/&lsquo;|&rsquo;/gi, "'")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&hellip;/gi, "…")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(/\s+/g, " ")
		.trim();
}

function isHeadingMarkup(markup: string): boolean {
	return (
		markup.includes("range-title") ||
		markup.includes("sutta-title") ||
		markup.includes("<h1") ||
		markup.includes("<h2") ||
		markup.includes("<h3")
	);
}

function isVerseMarkup(markup: string): boolean {
	return markup.includes("verse-line") || markup.includes("gatha");
}

/**
 * Merge the ordered Bilara segment maps into reading paragraphs.
 * Heading segments become bold, untranslated segments fall back to the Pali
 * root text in italics, empty segments are skipped.
 */
export function bilaraToParagraphs(data: BilaraSutta): Paragraph[] {
	const out: Paragraph[] = [];
	const keys = data.keys_order ?? Object.keys(data.translation_text ?? {});
	const html = data.html_text ?? {};
	const translation = data.translation_text ?? {};
	const root = data.root_text ?? {};
	for (const key of keys) {
		const markup = html[key] ?? "";
		let text = cleanSegmentText(translation[key] ?? "");
		let fallbackToRoot = false;
		if (text.length === 0) {
			text = cleanSegmentText(root[key] ?? "");
			fallbackToRoot = text.length > 0;
		}
		if (text.length === 0) {
			continue;
		}
		if (isHeadingMarkup(markup)) {
			out.push({ type: "Text", content: text, style: { bold: true } });
		} else if (fallbackToRoot) {
			out.push({ type: "Text", content: text, style: { italic: true } });
		} else if (isVerseMarkup(markup)) {
			out.push({ type: "Text", content: text, style: null });
		} else {
			out.push({ type: "Text", content: text, style: null });
		}
	}
	return out;
}
