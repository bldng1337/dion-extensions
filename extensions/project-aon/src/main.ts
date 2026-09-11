import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Divider, Link, Text } from "@dion-js/runtime-lib/ui.js";
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
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import type { BookMeta, EpisodeRef } from "./site.ts";
import {
	BASE,
	BOOK_BATCH,
	buildEpisodes,
	capText,
	episodeUid,
	IMAGE_ONLY_NOTE,
	parseBookDirs,
	parseBookUid,
	parseEpisodeUid,
	parseNumberedSections,
	parsePageParagraphs,
	parseSeriesDirs,
	parseTitlePage,
	parseTocPages,
	PAGE_SIZE,
	PROJECT_AON_NOTE,
	sectionNumberOf,
	SERIES_NAMES,
	USER_AGENT,
	XHTML_INDEX_URL,
	bookFileUrl,
	bookUrl,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (missing appendix pages etc.). */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
		},
	});
	if (!res.ok) {
		if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
			return null;
		}
		throw new Error(`Project Aon request failed (${res.status}): ${url}`);
	}
	return res.body;
}

// ---------------------------------------------------------------------------
// Catalog feed — the site has no API or search endpoint, so the catalog is
// rebuilt from the /en/xhtml/ autoindexes (series -> books) plus one title
// page per book, cached per session. Title pages are fetched in small
// batches only as far as the requested browse/search page requires, to keep
// the request count polite.
// ---------------------------------------------------------------------------

interface CatalogBook {
	/** "<series>/<dir>", e.g. "lw/01fftd". */
	uid: string;
	/** Series directory, e.g. "lw". */
	series: string;
	/** Human series name, e.g. "Lone Wolf". */
	seriesName: string;
	/** 1-based book number within the series (from the directory prefix). */
	number: number;
	url: string;
	title: string;
	authors: string[];
}

/** Lowercased haystack used for search matching. */
function searchHaystack(book: CatalogBook): string {
	return [book.title, book.seriesName, ...book.authors].join(" ").toLowerCase();
}

class CatalogFeed {
	private readonly books: CatalogBook[] = [];
	private readonly byUid = new Map<string, CatalogBook>();
	private refs: { uid: string; series: string; dir: string }[] = [];
	private refsLoaded = false;
	private nextRef = 0;
	private exhausted = false;
	private tail: Promise<void> = Promise.resolve();

	/** Snapshot of the books loaded so far. */
	get loaded(): readonly CatalogBook[] {
		return this.books;
	}

	/** Loads title pages until at least `min` books are cached (or the
	 * catalog is exhausted). Calls are serialized to avoid double fetches. */
	async ensure(min: number): Promise<void> {
		const task = this.tail.then(() => this.ensureSync(min));
		// Keep the chain alive even if one batch fails; the next caller
		// retries.
		this.tail = task.catch(() => {
			// errors propagate via `task` to the original caller
		});
		await task;
	}

	/** Whether more books exist beyond the first `count`. */
	hasMoreAfter(count: number): boolean {
		return !this.exhausted || this.books.length > count;
	}

	private async ensureSync(min: number): Promise<void> {
		if (!this.refsLoaded) {
			await this.loadRefs();
			this.refsLoaded = true;
			if (this.refs.length === 0) {
				this.exhausted = true;
				return;
			}
		}
		while (this.books.length < min && !this.exhausted) {
			const batch = this.refs.slice(this.nextRef, this.nextRef + BOOK_BATCH);
			if (batch.length === 0) {
				this.exhausted = true;
				return;
			}
			const results = await Promise.all(batch.map((ref) => this.loadBook(ref)));
			this.nextRef += batch.length;
			for (const book of results) {
				if (book && !this.byUid.has(book.uid)) {
					this.byUid.set(book.uid, book);
					this.books.push(book);
				}
			}
			if (this.nextRef >= this.refs.length) {
				this.exhausted = true;
			}
		}
	}

	/** Series autoindex -> ordered book directories. */
	private async loadRefs(): Promise<void> {
		const body = await fetchPage(XHTML_INDEX_URL);
		const series = body ? parseSeriesDirs(body) : [];
		const refs: { uid: string; series: string; dir: string }[] = [];
		const loadedSeries = await Promise.all(
			series.map(async (s) => {
				const index = await fetchPage(`${BASE}/en/xhtml/${s}/`);
				return { series: s, dirs: index ? parseBookDirs(index) : [] };
			}),
		);
		for (const { series: s, dirs } of loadedSeries) {
			for (const dir of dirs) {
				refs.push({ uid: `${s}/${dir}`, series: s, dir });
			}
		}
		this.refs = refs;
	}

	/** Loads one title page; books without a parsable title page (redirect
	 * stubs, non-gamebook material) are skipped. */
	private async loadBook(ref: {
		uid: string;
		series: string;
		dir: string;
	}): Promise<CatalogBook | null> {
		const meta = await bookMeta(ref.uid);
		if (!meta) {
			return null;
		}
		return {
			uid: ref.uid,
			series: ref.series,
			seriesName: SERIES_NAMES[ref.series] ?? ref.series,
			number: Number.parseInt(ref.dir, 10),
			url: bookUrl(ref.uid),
			title: meta.title,
			authors: meta.authors,
		};
	}
}

/** One catalog feed per extension session. */
const feed = new CatalogFeed();

// ---------------------------------------------------------------------------
// Book and page caches — title pages, TOC/numbered listings and parsed page
// paragraphs are fetched/parsed at most once per session.
// ---------------------------------------------------------------------------

/** Title pages, keyed by book uid (null marks "no parsable title page"). */
const metaCache = new Map<string, BookMeta | null>();
/** Episode lists, keyed by book uid. */
const episodesCache = new Map<string, EpisodeRef[]>();
/** Page text is large; keep a bounded cache of parsed pages. */
const pageCache = new Map<string, Paragraph[]>();
const PAGE_CACHE_LIMIT = 16;

/** Book uid for a raw uid string, throwing a friendly error. */
function requireBookUid(uid: string): string {
	if (!parseBookUid(uid)) {
		throw new Error(`Project Aon: invalid book id "${uid}"`);
	}
	return uid;
}

/** Parses (and caches) a book title page. */
async function bookMeta(uid: string): Promise<BookMeta | null> {
	const cached = metaCache.get(uid);
	if (cached !== undefined) {
		return cached;
	}
	const body = await fetchPage(bookUrl(uid));
	let meta: BookMeta | null = null;
	if (body !== null) {
		meta = parseTitlePage(body, uid);
	}
	metaCache.set(uid, meta);
	return meta;
}

/** Parses (and caches) a book's episode list from toc.htm + numbered.htm. */
async function bookEpisodes(uid: string): Promise<EpisodeRef[]> {
	const cached = episodesCache.get(uid);
	if (cached) {
		return cached;
	}
	const [tocBody, numberedBody] = await Promise.all([
		fetchPage(bookFileUrl(uid, "toc.htm")),
		fetchPage(bookFileUrl(uid, "numbered.htm")),
	]);
	if (tocBody === null) {
		throw new Error(`Project Aon: no table of contents for "${uid}"`);
	}
	const tocPages = parseTocPages(tocBody);
	const sections = numberedBody ? parseNumberedSections(numberedBody) : [];
	const episodes = buildEpisodes(uid, tocPages, sections);
	if (episodes.length === 0) {
		throw new Error(`Project Aon: no sections listed for "${uid}"`);
	}
	episodesCache.set(uid, episodes);
	return episodes;
}

/** Parses (and caches) the paragraphs of one episode page. */
async function episodeParagraphs(
	bookUid: string,
	file: string,
	url: string,
	name: string,
): Promise<Paragraph[]> {
	const key = `${bookUid}#${file}`;
	const cached = pageCache.get(key);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(url);
	if (body === null) {
		throw new Error(`Project Aon: page "${file}" of "${bookUid}" not found`);
	}
	const sectionNumber = sectionNumberOf(file);
	const fallbackHeading =
		sectionNumber !== null ? `Section ${sectionNumber}` : name;
	const parsed = parsePageParagraphs(body, fallbackHeading).map((p) => ({
		type: "Text" as const,
		content: p.content,
		style: p.style === "bold" ? { bold: true } : null,
	}));
	// Pages that carry only headings plus illustrations/tables (action
	// charts, combat tables) cannot render as text — explain that instead of
	// showing a bare title or failing.
	let paragraphs: Paragraph[] = parsed;
	if (parsed.length === 0) {
		paragraphs = [{ type: "Text", content: IMAGE_ONLY_NOTE, style: null }];
	} else if (parsed.every((p) => p.style?.bold === true)) {
		paragraphs = [
			...parsed,
			{ type: "Text", content: IMAGE_ONLY_NOTE, style: null },
		];
	}
	if (pageCache.size >= PAGE_CACHE_LIMIT) {
		pageCache.clear();
	}
	pageCache.set(key, paragraphs);
	return paragraphs;
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

	/**
	 * Pages through the catalog of officially licensed English gamebooks
	 * (Lone Wolf 1-29, The World of Lone Wolf 1-4, Freeway Warrior 1-4 —
	 * whatever the /en/xhtml/ tree currently lists), built from the site's
	 * directory indexes plus one title page per book and cached per session.
	 */
	async browse(page: number): Promise<EntryList> {
		const p = Math.max(0, page);
		await feed.ensure((p + 1) * PAGE_SIZE);
		const content = feed.loaded
			.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)
			.map((book) => this.toEntry(book));
		return {
			content,
			hasnext: feed.hasMoreAfter((p + 1) * PAGE_SIZE),
			length: content.length,
		};
	}

	/**
	 * The site has no addressable search, so search runs client-side over
	 * the cached catalog (title, series and author substring match).
	 */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim().toLowerCase();
		if (query.length === 0 || Math.max(0, page) > 0) {
			return { content: [], hasnext: false };
		}
		await feed.ensure(Number.MAX_SAFE_INTEGER);
		const content = feed.loaded
			.filter((book) => searchHaystack(book).includes(query))
			.map((book) => this.toEntry(book));
		return { content, hasnext: false, length: content.length };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = requireBookUid(entryid.uid);
		const [meta, episodes] = await Promise.all([
			bookMeta(uid),
			bookEpisodes(uid),
		]);
		if (!meta) {
			throw new Error(`Project Aon: book "${uid}" not found`);
		}
		const seriesName =
			SERIES_NAMES[parseBookUid(uid)?.series ?? ""] ??
			parseBookUid(uid)?.series ??
			"Lone Wolf";
		const bookNumber = Number.parseInt(parseBookUid(uid)?.dir ?? "", 10);

		const episodeList: Episode[] = episodes.map((episode) => ({
			id: {
				uid: episodeUid(uid, episode.file),
				iddata: JSON.stringify({
					book: uid,
					url: episode.url,
					file: episode.file,
					name: episode.name,
				}),
			},
			name: episode.name,
			url: episode.url,
		}));

		const description =
			meta.blurb ??
			capText(
				`${meta.title} — a ${seriesName} interactive gamebook by ${meta.authors.join(" and ") || "Joe Dever"}, digitized by Project Aon.`,
				300,
			);

		const entry: EntryDetailed = {
			id: { uid },
			url: bookUrl(uid),
			titles: [meta.title],
			author: meta.authors.length > 0 ? meta.authors : ["Joe Dever"],
			media_type: "Book",
			status: "Complete",
			description,
			language: "en",
			episodes: episodeList,
			genres: ["Gamebook", seriesName],
			meta: {
				Series: seriesName,
				...(Number.isFinite(bookNumber) ? { Book: String(bookNumber) } : {}),
			},
			length: episodeList.length,
			ui: Column(
				Text(PROJECT_AON_NOTE),
				Divider(),
				Link(bookUrl(uid), "Open on Project Aon"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let bookUid = "";
		let file = "";
		let url: string | null = null;
		let name = "";
		try {
			const data = JSON.parse(epid.iddata ?? "") as {
				book?: unknown;
				url?: unknown;
				file?: unknown;
				name?: unknown;
			};
			if (typeof data.book === "string" && typeof data.file === "string") {
				bookUid = data.book;
				file = data.file;
				if (typeof data.url === "string") {
					url = data.url;
				}
				if (typeof data.name === "string") {
					name = data.name;
				}
			}
		} catch {
			// no/malformed iddata: fall back to the uid below
		}
		if (!parseBookUid(bookUid) || !parseEpisodeUid(`${bookUid}#${file}`)) {
			const parsed = parseEpisodeUid(epid.uid);
			if (!parsed) {
				throw new Error(`Project Aon: invalid section id "${epid.uid}"`);
			}
			bookUid = parsed.bookUid;
			file = parsed.file;
		}
		if (url === null) {
			url = bookFileUrl(bookUid, file);
		}

		const paragraphs = await episodeParagraphs(bookUid, file, url, name);
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}

	// -- Helpers -------------------------------------------------------------

	private toEntry(book: CatalogBook): Entry {
		return {
			id: { uid: book.uid },
			url: book.url,
			title: book.title,
			media_type: "Book",
			author: book.authors.length > 0 ? book.authors : null,
		};
	}
}
