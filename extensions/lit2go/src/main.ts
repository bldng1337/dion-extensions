import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
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
import { parseHtml, type DionElement, type DionElementArray } from "parse";
import {
	BOOKS_URL,
	SITE_LANG,
	SEARCH_URL,
	bookIdFromUrl,
	cleanText,
	isPassageUrl,
	metaValue,
	normalizeLanguage,
	parseDisplayTotal,
	slicePage,
	thumbnailUrl,
} from "./lit2go.ts";

/** Books per browse page — the site lists everything at once, so the full
 * alphabetical index is fetched once and sliced client-side. */
const PAGE_SIZE = 24;
/** The server search shows 25 results per page. */
const SEARCH_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Remote data shapes (parsed)
// ---------------------------------------------------------------------------

interface BookCard {
	id: string;
	url: string;
	title: string;
	author?: string;
	cover?: string;
}

interface ChapterLink {
	url: string;
	title: string;
	description: string;
}

interface BookPage {
	id: string;
	url: string;
	title: string;
	authors: string[];
	description: string;
	cover?: string;
	chapters: ChapterLink[];
	genres: string[];
	meta: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The runtime requires CSSSelector objects, not selector strings. */
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

function attrOf(element: DionElement | undefined, name: string): string {
	return element?.attr(name) ?? "";
}

/** DionElementArray is a host object: not iterable inside the VM, so walk
 * it by index (see wikisource's walk()). */
function eachElement(
	list: DionElementArray,
	fn: (element: DionElement) => void,
): void {
	for (let i = 0; i < list.length; i++) {
		const element = list.get(i);
		if (element !== undefined) {
			fn(element);
		}
	}
}

async function fetchHtml(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Lit2Go request failed (${res.status}) on ${url}`);
	}
	return res.body;
}

// ---------------------------------------------------------------------------
// Page parsers
// ---------------------------------------------------------------------------

/** The placeholder shown before lazy-loading must never become a cover. */
function coverFromImg(img: DionElement | undefined): string | undefined {
	for (const candidate of [attrOf(img, "data-src"), attrOf(img, "src")]) {
		const url = cleanText(candidate);
		if (url.length > 0 && !url.includes("book-place-holder")) {
			return url;
		}
	}
	return undefined;
}

function figureToCard(figure: DionElement): BookCard | undefined {
	const titleLink = figure.select(q("figcaption.title a")).first;
	const iconLink = figure.select(q("a.book_icon")).first;
	const url =
		cleanText(attrOf(titleLink, "href")) || cleanText(attrOf(iconLink, "href"));
	const id = bookIdFromUrl(url);
	if (url.length === 0 || id === undefined) {
		return undefined;
	}
	const author = cleanText(figure.select(q("figcaption.author a")).first?.text);
	return {
		id,
		url,
		title:
			cleanText(titleLink?.text) ||
			cleanText(figure.select(q("img")).first?.attr("alt")) ||
			`Book ${id}`,
		author: author.length > 0 ? author : undefined,
		cover: coverFromImg(figure.select(q("img")).first),
	};
}

function parseBooks(html: string): BookCard[] {
	const cards: BookCard[] = [];
	const seen = new Set<string>();
	eachElement(parseHtml(html).select(q("figure")), (figure) => {
		const card = figureToCard(figure);
		if (card && !seen.has(card.id)) {
			seen.add(card.id);
			cards.push(card);
		}
	});
	return cards;
}

interface SearchPage {
	books: BookCard[];
	hasnext: boolean;
}

/** Search results mix book hits and passage hits (both carry the book link
 * in the h3); passages are folded into their book entry. */
function parseSearch(html: string): SearchPage {
	const doc = parseHtml(html);
	const books: BookCard[] = [];
	const seen = new Set<string>();
	eachElement(doc.select(q("#search_results article")), (article) => {
		const bookLink = article.select(q("h3 a")).first;
		const url = cleanText(attrOf(bookLink, "href"));
		const id = bookIdFromUrl(url);
		if (url.length === 0 || id === undefined || seen.has(id)) {
			return;
		}
		seen.add(id);
		const author = cleanText(article.select(q("h5 a")).first?.text);
		books.push({
			id,
			url,
			title: cleanText(bookLink?.text) || `Book ${id}`,
			author: author.length > 0 ? author : undefined,
		});
	});
	const nextCount = doc.select(q(".pagination li.next")).length;
	const total = parseDisplayTotal(
		doc.select(q("#page_content h3")).first?.text,
	);
	return {
		books,
		hasnext: nextCount > 0 || (total !== undefined && total > SEARCH_PAGE_SIZE),
	};
}

/** The description block nests `<p>` tags (and ends with a "Source:" line),
 * so collect paragraph text until that marker — this behaves the same whether
 * the parser keeps the invalid nesting or splits it into siblings. */
function descriptionFrom(column: DionElement | undefined): string {
	if (column === undefined) {
		return "";
	}
	const parts: string[] = [];
	let stopped = false;
	eachElement(column.select(q("p")), (p) => {
		const text = cleanText(p.text);
		if (text.length === 0 || parts.length >= 8) {
			return;
		}
		if (/^Source:/i.test(text)) {
			stopped = true;
		}
		if (!stopped) {
			parts.push(text);
		}
	});
	return parts.join("\n\n");
}

function parseBookPage(html: string, fallbackId: string): BookPage {
	const doc = parseHtml(html);

	const header = doc.select(q("#page_content header")).first;
	const title =
		cleanText(header?.select(q("h2")).first?.text) ||
		cleanText(doc.select(q("h2")).first?.text);

	const authors: string[] = [];
	if (header !== undefined) {
		eachElement(header.select(q("h3 a")), (anchor) => {
			const name = cleanText(anchor.text);
			if (name.length > 0 && !authors.includes(name)) {
				authors.push(name);
			}
		});
	}

	const column = doc.select(q("#column_primary")).first;
	const dl = column?.select(q("dl")).first;
	const chapters: ChapterLink[] = [];
	if (dl !== undefined) {
		const anchors = dl.select(q("dt a"));
		const blurbs = dl.select(q("dd"));
		for (let i = 0; i < anchors.length; i++) {
			const anchor = anchors.get(i);
			const url = cleanText(attrOf(anchor, "href"));
			if (url.length === 0) {
				continue;
			}
			chapters.push({
				url,
				title: cleanText(anchor?.text) || `Part ${chapters.length + 1}`,
				description: cleanText(blurbs.get(i)?.text),
			});
		}
	}
	let usable = chapters.filter((chapter) => isPassageUrl(chapter.url));
	if (usable.length === 0) {
		usable = chapters.filter((chapter) => chapter.url.includes("/lit2go/"));
	}

	const meta: Record<string, string> = {};
	const genres: string[] = [];
	eachElement(doc.select(q("#column_secondary li")), (li) => {
		const parsed = metaValue(cleanText(li.text));
		if (!parsed) {
			return;
		}
		switch (parsed.key) {
			case "Year Published":
			case "Language":
			case "Country of Origin":
			case "Word Count":
				meta[parsed.key] = parsed.value;
				break;
			case "Genre":
				if (!genres.includes(parsed.value)) {
					genres.push(parsed.value);
				}
				break;
			case "Keywords":
				for (const keyword of parsed.value.split(/,\s*/)) {
					if (keyword.length > 0 && !genres.includes(keyword)) {
						genres.push(keyword);
					}
				}
				break;
		}
	});

	const id = bookIdFromUrl(fallbackId) ?? fallbackId;
	const cover =
		coverFromImg(doc.select(q("#page_thumbnail img")).first) ??
		(/^\d+$/.test(id) ? thumbnailUrl(id) : undefined);

	return {
		id,
		url: fallbackId,
		title: title.length > 0 ? title : fallbackId,
		authors,
		description: descriptionFrom(column),
		cover,
		chapters: usable,
		genres: genres.slice(0, 12),
		meta,
	};
}

/** Passage pages expose their files in `ul#downloads`; the embedded
 * `<audio>` element is the fallback. */
function parseAudioUrl(html: string): string | undefined {
	const doc = parseHtml(html);
	let mp3: string | undefined;
	eachElement(doc.select(q("#downloads a")), (anchor) => {
		if (mp3 !== undefined) {
			return;
		}
		const href = cleanText(attrOf(anchor, "href"));
		if (/\.mp3(\?|#|$)/i.test(href)) {
			mp3 = href;
		}
	});
	if (mp3 !== undefined) {
		return mp3;
	}
	eachElement(doc.select(q("audio source")), (source) => {
		if (mp3 !== undefined) {
			return;
		}
		const src = cleanText(attrOf(source, "src"));
		const type = attrOf(source, "type");
		if (/\.mp3(\?|#|$)/i.test(src) || type.includes("mpeg")) {
			mp3 = src;
		}
	});
	return mp3;
}

// ---------------------------------------------------------------------------
// Session caches — be polite to etc.usf.edu
// ---------------------------------------------------------------------------

let booksCache: BookCard[] | undefined;
const bookPageCache = new Map<string, BookPage>();
const audioCache = new Map<string, string>();

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

	// -- Data access ---------------------------------------------------------

	private async fetchBooks(): Promise<BookCard[]> {
		booksCache ??= parseBooks(await fetchHtml(BOOKS_URL));
		return booksCache;
	}

	private async fetchSearchPage(
		term: string,
		page: number,
	): Promise<SearchPage> {
		const url = `${SEARCH_URL}?q=${encodeURIComponent(term)}&page=${Math.max(0, page)}`;
		return parseSearch(await fetchHtml(url));
	}

	/** Entry ids carry the book page URL in `iddata`; fall back to scanning
	 * the alphabetical listing for pre-iddata ids. */
	private async resolveBookUrl(entryid: EntryId): Promise<string> {
		if (entryid.iddata && entryid.iddata.includes("/lit2go/")) {
			return entryid.iddata;
		}
		const books = await this.fetchBooks();
		const match = books.find((book) => book.id === entryid.uid);
		if (match) {
			return match.url;
		}
		throw new Error(`Lit2Go: could not resolve book ${entryid.uid}`);
	}

	private async fetchBookPage(entryid: EntryId): Promise<BookPage> {
		const url = await this.resolveBookUrl(entryid);
		const cached = bookPageCache.get(url);
		if (cached) {
			return cached;
		}
		const page = parseBookPage(await fetchHtml(url), url);
		bookPageCache.set(url, page);
		return page;
	}

	private async fetchAudioUrl(passageUrl: string): Promise<string> {
		const cached = audioCache.get(passageUrl);
		if (cached) {
			return cached;
		}
		const audio = parseAudioUrl(await fetchHtml(passageUrl));
		if (!audio) {
			throw new Error(`Lit2Go: no audio file found for ${passageUrl}`);
		}
		audioCache.set(passageUrl, audio);
		return audio;
	}

	// -- Mappers -------------------------------------------------------------

	private cardToEntry(card: BookCard): Entry {
		return {
			id: { uid: card.id, iddata: card.url },
			url: card.url,
			title: card.title,
			media_type: "Audio",
			cover: { url: card.cover ?? thumbnailUrl(card.id) },
			author: card.author ? [card.author] : undefined,
		};
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const { items, hasnext } = slicePage(
			await this.fetchBooks(),
			page,
			PAGE_SIZE,
		);
		return { content: items.map((card) => this.cardToEntry(card)), hasnext };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const result = await this.fetchSearchPage(term, Math.max(0, page));
		return {
			content: result.books.map((card) => this.cardToEntry(card)),
			hasnext: result.hasnext,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const book = await this.fetchBookPage(entryid);

		const episodes: Episode[] = book.chapters.map((chapter) => ({
			id: { uid: chapter.url, iddata: SITE_LANG },
			name: chapter.title,
			url: chapter.url,
			description:
				chapter.description.length > 0 ? chapter.description : undefined,
		}));
		if (episodes.length === 0) {
			// A book page without a chapter table would be unplayable; fail loudly.
			throw new Error(`Lit2Go: no passages found for ${book.url}`);
		}

		const cover = book.cover ? { url: book.cover } : undefined;

		const entry: EntryDetailed = {
			id: { uid: book.id },
			url: book.url,
			titles: [book.title],
			author: book.authors.length > 0 ? book.authors : undefined,
			media_type: "Audio",
			status: "Complete",
			description: book.description,
			language: normalizeLanguage(book.meta.Language),
			cover,
			poster: cover,
			episodes,
			genres: book.genres.length > 0 ? book.genres : undefined,
			meta: book.meta,
			ui: Column(Text("Links"), Link(book.url, `Open ${book.title} on Lit2Go`)),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const passageUrl = epid.uid;
		if (!isPassageUrl(passageUrl)) {
			throw new Error(`Lit2Go: invalid episode id ${passageUrl}`);
		}
		const audio = await this.fetchAudioUrl(passageUrl);
		return {
			settings: { ...settings },
			source: {
				type: "Audio",
				sources: [
					{
						name: "Lit2Go",
						lang: epid.iddata ?? SITE_LANG,
						url: { url: audio },
					},
				],
				chapters: null,
			},
		};
	}
}
