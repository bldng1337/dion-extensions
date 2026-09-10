import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
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
	Paragraph,
	Setting,
	SourceResult,
	TextStyle,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml, type DionElement } from "parse";
import {
	catalogUrl,
	chapterFileUrl,
	chaptersUrl,
	cleanText,
	coverPageUrl,
	isChapterFileName,
	isNavText,
	makeEpisodeIdData,
	makeEpisodeUid,
	parseCatalog,
	parseCoverMeta,
	parseEpisodeIdData,
	parseEpisodeUid,
	parseLastPgCount,
	parseTocEntries,
	type CatalogBook,
	type EpisodeRef,
	isReadableTocEntry,
	normalizeForSearch,
	PAGE_SIZE,
	tocPageUrl,
	USER_AGENT,
} from "./baen.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** CSSSelector factory; the runtime requires selector objects, not strings. */
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html, application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Baen request failed (${res.status}): ${url}`);
	}
	return res.body;
}

// ---------------------------------------------------------------------------
// Catalog cache (the free library list is small and stable per session)
// ---------------------------------------------------------------------------

let catalogCache: Promise<CatalogBook[]> | null = null;

/** Authors seen in detail() calls; improves client-side author search. */
const authorCache = new Map<string, string>();

function loadCatalog(): Promise<CatalogBook[]> {
	if (!catalogCache) {
		catalogCache = (async () => {
			const body = await fetchText(catalogUrl());
			let data: unknown;
			try {
				data = JSON.parse(body) as unknown;
			} catch {
				throw new Error("Baen: free library catalog returned invalid JSON");
			}
			const books = parseCatalog(data);
			if (books.length === 0) {
				throw new Error("Baen: free library catalog is empty");
			}
			return books;
		})();
		catalogCache.catch(() => {
			// Allow a later retry after a transient failure.
			catalogCache = null;
		});
	}
	return catalogCache;
}

// ---------------------------------------------------------------------------
// Rendered reader HTML -> Paragraph conversion
// ---------------------------------------------------------------------------

/** Tags whose content is never wanted. */
const SKIP_TAGS = new Set([
	"script",
	"style",
	"link",
	"meta",
	"head",
	"img",
	"figure",
	"audio",
	"video",
	"source",
	"track",
	"picture",
	"input",
	"button",
	"select",
	"textarea",
	"canvas",
	"svg",
	"form",
]);

/** Block elements emitted as a single text paragraph. */
const EMIT_TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"dt",
	"dd",
	"td",
	"th",
	"figcaption",
	"pre",
	"center",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Structural wrappers that are recursed into. */
const CONTAINER_TAGS = new Set([
	"div",
	"section",
	"article",
	"main",
	"body",
	"header",
	"footer",
	"blockquote",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"ul",
	"ol",
	"dl",
	"center",
]);

/** Template CSS sometimes leaks into an element's text extraction. */
function isCssJunk(text: string): boolean {
	return (
		text.startsWith("@media") ||
		(text.includes("{") && text.includes("}") && text.includes(";"))
	);
}

/** Style of a paragraph whose entire content is the given child element
 * ("b" -> bold, "i" -> italic). */
function uniformChildStyle(
	el: DionElement,
	text: string,
	selector: string,
): TextStyle | null {
	const child = el.select(q(selector)).first;
	if (!child) {
		return null;
	}
	if (cleanText(child.text) !== text) {
		return null;
	}
	return selector === "b" ? { bold: true } : { italic: true };
}

function pushParagraph(
	out: Paragraph[],
	text: string,
	style: TextStyle | null,
) {
	if (text.length > 0 && !isCssJunk(text)) {
		out.push({ type: "Text", content: text, style });
	}
}

function walk(el: DionElement, out: Paragraph[], depth: number): void {
	if (depth > 24) {
		return;
	}
	const children = el.children;
	for (let i = 0; i < children.length; i++) {
		const child = children.get(i);
		if (!child) {
			continue;
		}
		const name = child.name.toLowerCase();
		if (SKIP_TAGS.has(name)) {
			continue;
		}
		if (EMIT_TAGS.has(name)) {
			const text = cleanText(child.text);
			if (name === "li") {
				pushParagraph(out, `\u2022 ${text}`, null);
				continue;
			}
			if (HEADING_TAGS.has(name)) {
				pushParagraph(out, text, { bold: true });
				continue;
			}
			// Reader navigation ("Back | Next / Contents") and empty
			// spacing paragraphs are noise.
			if (isNavText(text)) {
				continue;
			}
			const cls = (child.attr("class") ?? "").toLowerCase();
			let style: TextStyle | null =
				cls.includes("chapter") || cls.includes("chapternumber")
					? { bold: true }
					: null;
			if (style === null) {
				style = uniformChildStyle(child, text, "b");
			}
			if (style === null) {
				style = uniformChildStyle(child, text, "i");
			}
			pushParagraph(out, text, style);
			continue;
		}
		if (CONTAINER_TAGS.has(name)) {
			walk(child, out, depth + 1);
		}
		// Inline elements (span, a, b, i, …) contribute their text through
		// the emitting block ancestor.
	}
}

/** Converts a Baen reader page into reading paragraphs. */
export function htmlToParagraphs(html: string): Paragraph[] {
	const doc = parseHtml(html);
	const out: Paragraph[] = [];
	walk(doc, out, 0);
	if (out.length === 0) {
		// Last resort: some reader pages (maps, copyright) have no prose.
		out.push({
			type: "Text",
			content: "(This page contains no readable text.)",
			style: { italic: true },
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const READER_NOTE =
	"Free Library ebook from Baen Books (DRM-free, shared with Baen's " +
	"permission). Reading online is open; full downloads require a free " +
	"Baen.com account.";

export default class extends DionExtension implements SourceProvider {
	settings = {};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	private bookToEntry(book: CatalogBook): Entry {
		const cachedAuthor = authorCache.get(book.sku);
		return {
			id: { uid: book.sku },
			url: book.url,
			title: book.name,
			media_type: "Book",
			cover: book.cover ? { url: book.cover } : undefined,
			author: cachedAuthor ? [cachedAuthor] : undefined,
		};
	}

	async browse(page: number): Promise<EntryList> {
		const books = await loadCatalog();
		const start = Math.max(0, page) * PAGE_SIZE;
		const content = books
			.slice(start, start + PAGE_SIZE)
			.map((book) => this.bookToEntry(book));
		return { content, hasnext: books.length > start + PAGE_SIZE };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = normalizeForSearch(filter.trim());
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const books = await loadCatalog();
		const matches = books.filter((book) => {
			if (normalizeForSearch(book.name).includes(term)) {
				return true;
			}
			if (normalizeForSearch(book.sku).includes(term)) {
				return true;
			}
			const author = authorCache.get(book.sku);
			return author ? normalizeForSearch(author).includes(term) : false;
		});
		const start = Math.max(0, page) * PAGE_SIZE;
		const content = matches
			.slice(start, start + PAGE_SIZE)
			.map((book) => this.bookToEntry(book));
		return { content, hasnext: matches.length > start + PAGE_SIZE };
	}

	/** Cover page (title/author/blurb), TOC and frameset; each degrades to
	 * null when the book has no open web reader. */
	private async fetchReaderData(sku: string): Promise<{
		meta: ReturnType<typeof parseCoverMeta> | null;
		tocHtml: string | null;
		lastPgCount: number | null;
	}> {
		const [coverHtml, tocHtml, framesHtml] = await Promise.all([
			fetchText(coverPageUrl(sku)).catch(() => null),
			fetchText(tocPageUrl(sku)).catch(() => null),
			fetchText(chaptersUrl(sku)).catch(() => null),
		]);
		return {
			meta: coverHtml === null ? null : parseCoverMeta(coverHtml),
			tocHtml,
			lastPgCount: framesHtml === null ? null : parseLastPgCount(framesHtml),
		};
	}

	private buildEpisodes(
		sku: string,
		tocHtml: string | null,
		lastPgCount: number | null,
	): Episode[] {
		const episodes: Episode[] = [];
		if (tocHtml !== null) {
			for (const entry of parseTocEntries(tocHtml)) {
				if (!isReadableTocEntry(entry, lastPgCount)) {
					continue;
				}
				episodes.push({
					id: {
						uid: makeEpisodeUid(sku, entry.file ?? ""),
						iddata: makeEpisodeIdData(sku, entry.file ?? ""),
					},
					name: entry.name,
					description: entry.byline,
					url: chapterFileUrl(sku, entry.file ?? ""),
				});
			}
		}
		if (episodes.length === 0) {
			// No open chapters: fall back to the reader cover page, which
			// renders the blurb and copyright as text.
			const file = `${sku}__c_.htm`;
			episodes.push({
				id: {
					uid: makeEpisodeUid(sku, file),
					iddata: makeEpisodeIdData(sku, file),
				},
				name: "Read online",
				description: "Baen web reader",
				url: chaptersUrl(sku),
			});
		}
		return episodes;
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const sku = entryid.uid;
		if (!sku) {
			throw new Error("Baen: missing entry id");
		}
		const books = await loadCatalog().catch(() => [] as CatalogBook[]);
		const book = books.find((candidate) => candidate.sku === sku) ?? {
			sku,
			name: sku,
			url: chaptersUrl(sku),
			cover: null,
		};

		const reader = await this.fetchReaderData(sku);
		const meta = reader.meta;

		const author = meta?.author ?? null;
		if (author) {
			authorCache.set(sku, author);
		}

		const titles = [book.name];
		if (meta?.title && meta.title !== book.name) {
			titles.push(meta.title);
		}

		const descriptionParts: string[] = [];
		if (meta?.blurb) {
			descriptionParts.push(meta.blurb);
		}
		if (meta?.copyright) {
			descriptionParts.push(meta.copyright);
		}
		const description =
			descriptionParts.join("\n\n") ||
			`${book.name} - a free Baen ebook from the Baen Free Library.`;

		const entry: EntryDetailed = {
			id: { uid: sku },
			url: book.url,
			titles,
			author: author ? [author] : null,
			media_type: "Book",
			status: "Complete",
			description,
			language: "en",
			cover: book.cover ? { url: book.cover } : undefined,
			episodes: this.buildEpisodes(sku, reader.tocHtml, reader.lastPgCount),
			ui: Column(
				Text(READER_NOTE, { italic: true }),
				Link(book.url, "Open on Baen.com"),
				Link(chaptersUrl(sku), "Open the Baen web reader"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const ref: EpisodeRef =
			parseEpisodeIdData(epid.iddata) ??
			(epid.uid ? parseEpisodeUid(epid.uid) : null) ??
			(() => {
				throw new Error("Baen: missing episode id");
			})();
		if (!isChapterFileName(ref.file)) {
			throw new Error(`Baen: invalid chapter file "${ref.file}"`);
		}
		const html = await fetchText(chapterFileUrl(ref.sku, ref.file));
		const paragraphs = htmlToParagraphs(html);
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
