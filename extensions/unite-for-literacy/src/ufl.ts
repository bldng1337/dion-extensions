import type {
	Entry,
	EntryDetailed,
	ImageListAudio,
} from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints & constants
//
// Unite for Literacy (uniteforliteracy.com) is a jQuery app over static JSON
// hosted on S3-backed "cloud" hosts. There is no official API; these are the
// endpoints the site's own javascripts use (verified against production):
//
//   GET https://reader-cloud.uniteforliteracy.com/lib/r0/libInfoCombo.json
//       -> { <libId>: { Title, WLangAbbv, CoverRoot, Books: [{BKID, Cover,
//           AltText}] } } - the whole catalogue, ~1059 unique books across
//           themed libraries (English, Spanish and Ukrainian collections).
//   GET https://books-cloud.uniteforliteracy.com/book/<BKID>/book1.json
//       -> { Published, Title, PicRoot, AudioRoot, Abbv, AuthorStr, ISBN,
//           NLangs: [{ID, Abbv}], Pages: [{PageType, ImageUrl, PageText,
//           Credits, CreditList, mp3, ogg}] } - pages and native narration.
//   GET https://books-cloud.uniteforliteracy.com/book/<BKID>/aud_<lang>.json
//       -> { AudioRoot, Abbv, Pages: [{mp3, ogg}] } - narration in another
//           language; Pages is index-aligned with book1.json's Pages.
//   GET https://static-cloud.uniteforliteracy.com/localize/production/languages.json
//       -> { languages: { eng: { <abbv>: <name> } } } - language code names.
//
// Page images live under PicRoot (picset/th480 - the largest size published,
// only th240/th480 exist) and narration audio under AudioRoot. Both JSON
// fields point at http://files.uniteforliteracy.com, which does not answer on
// https; the site rewrites it to files-cloud.uniteforliteracy.com (s3Url).
// A page's mp3/ogg value may be the literal string "missing" - no narration.
// ---------------------------------------------------------------------------

export const SITE_URL = "https://www.uniteforliteracy.com/";
export const CATALOG_URL =
	"https://reader-cloud.uniteforliteracy.com/lib/r0/libInfoCombo.json";
export const LANGUAGES_URL =
	"https://static-cloud.uniteforliteracy.com/localize/production/languages.json";
export const BOOKS_URL = "https://books-cloud.uniteforliteracy.com/book/";

/** Books per browse page (the catalogue has ~1059 unique books). */
export const PAGE_SIZE = 24;

/** At most this many narration languages are listed in the detail UI. */
export const LANGUAGE_NOTE_MAX_LANGS = 8;

export const LICENSE_NOTE =
	"Free narrated picture books from Unite for Literacy (uniteforliteracy.com), a digital public good.";

/**
 * Narration-language options for the extension setting. `""` means "use the
 * book's own narration"; the codes are the 3-letter abbreviations the site
 * uses in `aud_<code>.json` (verified to exist for typical books).
 */
export const NARRATION_LANGUAGES = [
	{ value: "", label: "Book language" },
	{ value: "eng", label: "English" },
	{ value: "spa", label: "Spanish / Español" },
	{ value: "fre", label: "French / Français" },
	{ value: "deu", label: "German / Deutsch" },
	{ value: "por", label: "Portuguese / Português" },
	{ value: "hin", label: "Hindi / हिन्दी" },
	{ value: "arb", label: "Arabic / العربية" },
	{ value: "cmn", label: "Mandarin / 中文" },
	{ value: "rus", label: "Russian / Русский" },
	{ value: "kor", label: "Korean / 한국어" },
	{ value: "vie", label: "Vietnamese / Tiếng Việt" },
	{ value: "tur", label: "Turkish / Türkçe" },
	{ value: "pol", label: "Polish / Polski" },
	{ value: "tgl", label: "Tagalog" },
	{ value: "hat", label: "Haitian Creole / Kreyòl" },
	{ value: "som", label: "Somali / Soomaali" },
	{ value: "urd", label: "Urdu / اردو" },
] as const;

/** Fallback names for language codes, used when languages.json is down. */
export const LANGUAGE_NAME_FALLBACK: Record<string, string> =
	Object.fromEntries(
		NARRATION_LANGUAGES.filter((lang) => lang.value !== "").map((lang) => [
			lang.value,
			lang.label.replace(/\s*\/.*$/, ""),
		]),
	);

// ---------------------------------------------------------------------------
// Remote data shapes (only the fields we consume)
// ---------------------------------------------------------------------------

/** One row of a library's `Books` list in libInfoCombo.json. */
export interface UflCatalogBook {
	BKID?: number;
	Cover?: string;
	AltText?: string;
}

/** One library (themed collection) of libInfoCombo.json. */
export interface UflLibrary {
	Title?: string;
	WLangAbbv?: string;
	CoverRoot?: string;
	Books?: UflCatalogBook[];
}

/** libInfoCombo.json: library id -> library. */
export type UflCatalog = Record<string, UflLibrary>;

export interface UflCredit {
	Text?: string;
	Url?: string;
}

/** One page of book1.json. */
export interface UflBookPage {
	PageType?: number;
	ImageUrl?: string;
	PageText?: string;
	Credits?: string;
	CreditList?: UflCredit[];
	mp3?: string;
	ogg?: string;
}

/** One narration language listed in book1.json's `NLangs`. */
export interface UflNarrationLang {
	ID?: number;
	Abbv?: string;
}

/** book1.json: the book with pages and native-language narration. */
export interface UflBook {
	Published?: boolean;
	Title?: string;
	PicRoot?: string;
	AudioRoot?: string;
	Abbv?: string;
	AuthorStr?: string;
	ISBN?: string;
	NLangs?: UflNarrationLang[];
	Pages?: UflBookPage[];
}

/** One page of aud_<lang>.json. */
export interface UflNarrationPage {
	mp3?: string;
	ogg?: string;
}

/** aud_<lang>.json: narration in a specific language. */
export interface UflNarration {
	AudioRoot?: string;
	Abbv?: string;
	Pages?: UflNarrationPage[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Decode the HTML entities the site leaves in text fields. */
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
		.replace(/&copy;/gi, "©")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		);
}

/** Strip HTML tags (page text is authored as HTML), then decode entities. */
export function stripHtml(text: string): string {
	return decodeEntities(text.replace(/<[^>]*>/g, " "));
}

/** HTML-stripped, entity-decoded, whitespace-collapsed text. */
export function cleanText(text: string | undefined): string {
	return stripHtml(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The book/catalogue JSON points media at `http://files.uniteforliteracy.com`,
 * which does not serve https. Rewrite to the https-capable -cloud host the
 * site itself uses (rootS3PathConvert in the site's javascripts).
 */
export function s3Url(url: string | undefined): string {
	return (url ?? "")
		.replace(/^http:\/\//i, "https://")
		.replace(
			"//files.uniteforliteracy.com",
			"//files-cloud.uniteforliteracy.com",
		);
}

/** Join a (rewritten) root URL and a file name with exactly one slash. */
export function joinUrl(root: string, name: string): string {
	if (root.length === 0) {
		return name;
	}
	return root.endsWith("/") ? `${root}${name}` : `${root}/${name}`;
}

/** Canonical site page for one book. */
export function bookPageUrl(bkid: string): string {
	return `https://www.uniteforliteracy.com/book?BookId=${encodeURIComponent(bkid)}`;
}

/** book1.json: pages plus native narration. */
export function bookJsonUrl(bkid: string): string {
	return `${BOOKS_URL}${encodeURIComponent(bkid)}/book1.json`;
}

/** aud_<lang>.json: narration in a specific language. */
export function narrationJsonUrl(bkid: string, lang: string): string {
	return `${BOOKS_URL}${encodeURIComponent(bkid)}/aud_${encodeURIComponent(lang)}.json`;
}

// ---------------------------------------------------------------------------
// Catalogue mapping (browse/search)
// ---------------------------------------------------------------------------

/** A flattened catalogue row ready to become an Entry. */
export interface CatalogBook {
	bkid: string;
	title: string;
	cover?: string;
}

/**
 * Flatten libInfoCombo.json into a deduplicated book list. Libraries are
 * visited in JSON key order and the first occurrence of a BKID wins.
 */
export function catalogBooks(catalog: UflCatalog): CatalogBook[] {
	const seen = new Set<string>();
	const books: CatalogBook[] = [];
	for (const library of Object.values(catalog)) {
		const coverRoot = s3Url(library.CoverRoot);
		for (const book of library.Books ?? []) {
			const bkid = bookUid(book);
			if (!bkid || seen.has(bkid)) {
				continue;
			}
			const title = cleanText(book.AltText);
			if (title.length === 0) {
				continue;
			}
			seen.add(bkid);
			books.push({
				bkid,
				title,
				cover: book.Cover
					? joinUrl(coverRoot.replace("$BKID", bkid), book.Cover)
					: undefined,
			});
		}
	}
	return books;
}

/** Numeric BKID of a catalogue row as a string; null when unusable. */
export function bookUid(book: UflCatalogBook): string | null {
	if (
		typeof book.BKID === "number" &&
		Number.isInteger(book.BKID) &&
		book.BKID > 0
	) {
		return String(book.BKID);
	}
	return null;
}

/** One catalogue row -> Entry; null when the row has no usable id. */
export function catalogBookToEntry(book: CatalogBook): Entry | null {
	if (book.title.length === 0) {
		return null;
	}
	return {
		id: { uid: book.bkid },
		url: bookPageUrl(book.bkid),
		title: book.title,
		media_type: "Comic",
		cover: book.cover ? { url: book.cover } : undefined,
	};
}

/** Case-insensitive title match: every query token must appear. */
export function matchesTitle(title: string, query: string): boolean {
	const tokens = query
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	if (tokens.length === 0) {
		return false;
	}
	const haystack = title.toLowerCase();
	return tokens.every((token) => haystack.includes(token));
}

/** Slice `items` into pages of `pageSize`; empty tail pages have no content. */
export function paginate<T>(
	items: T[],
	page: number,
	pageSize: number = PAGE_SIZE,
): { content: T[]; hasnext: boolean } {
	const index = Math.max(0, page) * pageSize;
	const content = items.slice(index, index + pageSize);
	return { content, hasnext: index + pageSize < items.length };
}

// ---------------------------------------------------------------------------
// Book mapping (detail/source)
// ---------------------------------------------------------------------------

/** Language codes the book narrations are available in (lowercase, unique). */
export function narrationLangs(book: UflBook): string[] {
	const langs: string[] = [];
	for (const lang of book.NLangs ?? []) {
		const abbv = cleanText(lang.Abbv).toLowerCase();
		if (abbv.length > 0 && !langs.includes(abbv)) {
			langs.push(abbv);
		}
	}
	return langs;
}

/** Written language of the book ("eng", "spa", ...); defaults to "eng". */
export function bookLang(book: UflBook): string {
	const abbv = cleanText(book.Abbv).toLowerCase();
	return abbv.length > 0 ? abbv : "eng";
}

/**
 * Page image URLs in page order, plus `linkIndex`: for every original page
 * position it records the index of that page's image in the URL list, or -1
 * when the page has no image (e.g. the text-only title page). Used to map
 * per-page narration audio onto imagelist positions.
 */
export function pageImages(book: UflBook): {
	urls: string[];
	linkIndex: number[];
} {
	const picRoot = s3Url(book.PicRoot);
	const urls: string[] = [];
	const linkIndex: number[] = [];
	for (const page of book.Pages ?? []) {
		const image = cleanText(page.ImageUrl);
		if (image.length === 0) {
			linkIndex.push(-1);
			continue;
		}
		linkIndex.push(urls.length);
		urls.push(joinUrl(picRoot, image));
	}
	return { urls, linkIndex };
}

/**
 * Narration audio for the imagelist: one `ImageListAudio` per page that has
 * both an image and an audio file, with `from`/`to` set to that page's index
 * in the imagelist. `narration` (aud_<lang>.json) overrides the native audio
 * page-by-page when present; the literal value "missing" means no audio.
 */
export function buildAudio(
	book: UflBook,
	narration: UflNarration | null,
	linkIndex: number[],
): ImageListAudio[] {
	const nativeRoot = s3Url(book.AudioRoot);
	const narrationRoot = narration ? s3Url(narration.AudioRoot) : nativeRoot;
	const audio: ImageListAudio[] = [];
	for (const [position, page] of (book.Pages ?? []).entries()) {
		const index = linkIndex[position];
		if (index === undefined || index < 0) {
			continue;
		}
		// A narration entry overrides the native track for its page; when the
		// narration file has no entry here, fall back to the native audio and
		// root so the filename never lands on the wrong language directory.
		const narrated = narration?.Pages?.[position]?.mp3;
		const file = cleanText(narrated ?? page.mp3).toLowerCase();
		if (file.length === 0 || file === "missing") {
			continue;
		}
		audio.push({
			link: {
				url: joinUrl(narrated !== undefined ? narrationRoot : nativeRoot, file),
			},
			from: index,
			to: index,
		});
	}
	return audio;
}

/** Author credit: AuthorStr if present, else the unique page credits. */
export function bookAuthor(book: UflBook): string[] {
	const author = cleanText(book.AuthorStr);
	if (author.length > 0) {
		return [author];
	}
	return personCredits(book);
}

/** Unique photographer/illustrator credits across all pages. */
export function personCredits(book: UflBook): string[] {
	const names = new Set<string>();
	for (const page of book.Pages ?? []) {
		for (const credit of page.CreditList ?? []) {
			const name = cleanText(credit.Text);
			if (name.length > 0) {
				names.add(name);
			}
		}
	}
	return [...names];
}

/**
 * Book description: the story-page texts joined together (the catalogue has
 * no blurb field). Falls back to any page text there is; capped at 600 chars.
 */
export function bookDescription(book: UflBook): string {
	const storyTexts: string[] = [];
	const anyTexts: string[] = [];
	for (const page of book.Pages ?? []) {
		const text = cleanText(page.PageText);
		if (text.length === 0) {
			continue;
		}
		anyTexts.push(text);
		if (page.PageType === 3) {
			storyTexts.push(text);
		}
	}
	const full = (storyTexts.length > 0 ? storyTexts : anyTexts).join(" ");
	return full.length > 600 ? `${full.slice(0, 597).trimEnd()}...` : full;
}

/** Base detail view (without custom UI); null when the book is unusable. */
export function bookToDetail(
	book: UflBook,
	bkid: string,
): EntryDetailed | null {
	const title = cleanText(book.Title);
	if (title.length === 0 || !/^\d+$/.test(bkid)) {
		return null;
	}
	const images = pageImages(book).urls;
	const url = bookPageUrl(bkid);
	const author = bookAuthor(book);
	const meta: Record<string, string> = {};
	const narrations = narrationLangs(book);
	if (narrations.length > 0) {
		meta.Narrations = `${narrations.length} language${narrations.length === 1 ? "" : "s"}`;
	}
	const isbn = cleanText(book.ISBN);
	if (isbn.length > 0) {
		meta.ISBN = isbn;
	}
	return {
		id: { uid: bkid },
		url,
		titles: [title],
		author: author.length > 0 ? author : undefined,
		media_type: "Comic",
		status: "Complete",
		description: bookDescription(book),
		language: bookLang(book),
		cover: images[0] !== undefined ? { url: images[0] } : undefined,
		poster: images[0] !== undefined ? { url: images[0] } : undefined,
		episodes: [{ id: { uid: bkid }, name: "Read", url }],
		meta: Object.keys(meta).length > 0 ? meta : null,
	};
}

/** Display name for a narration code, from languages.json when available. */
export function languageName(
	code: string,
	names: Record<string, string>,
): string {
	const key = code.trim().toLowerCase();
	return names[key] ?? LANGUAGE_NAME_FALLBACK[key] ?? key;
}
