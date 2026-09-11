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
import type { AuthorRef, CatalogWork, WorkInfo } from "./site.ts";
import {
	AUTHOR_BATCH,
	BROWSE_INDEX_URL,
	authorBrowseUrl,
	episodeUid,
	parseAuthors,
	parseAuthorWorks,
	parseEpisodeUid,
	parseSection,
	parseWorkPage,
	parseWorkUid,
	PAGE_SIZE,
	PUBLIC_DOMAIN_NOTE,
	USER_AGENT,
	workDescription,
	workUrl,
} from "./site.ts";

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/** Fetches a page body; null on 404 (Perseus-only stubs etc.), error otherwise. */
async function fetchPage(url: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
		},
	});
	if (!res.ok) {
		if (res.status === 404) {
			return null;
		}
		throw new Error(
			`The Internet Classics Archive request failed (${res.status}): ${url}`,
		);
	}
	return res.body;
}

// ---------------------------------------------------------------------------
// Catalog feed — the site has no API and its search is a Google CSE, so the
// catalog is rebuilt from the /Browse/ author pages (~60 small files) and
// cached per session. Author pages are fetched in small batches only as far
// as the requested browse/search page requires, to keep the request count
// polite.
// ---------------------------------------------------------------------------

class CatalogFeed {
	private authors: AuthorRef[] = [];
	private authorsLoaded = false;
	private readonly works: CatalogWork[] = [];
	private readonly byUid = new Map<string, CatalogWork>();
	private nextAuthor = 0;
	private exhausted = false;
	private tail: Promise<void> = Promise.resolve();

	/** Snapshot of the works loaded so far. */
	get loaded(): readonly CatalogWork[] {
		return this.works;
	}

	/** Catalog entry for a uid, when that author page has been loaded. */
	entry(uid: string): CatalogWork | undefined {
		return this.byUid.get(uid);
	}

	/** Loads author pages until at least `min` works are cached (or the
	 * catalog is exhausted). Calls are serialized to avoid double fetches. */
	async ensure(min: number): Promise<void> {
		const task = this.tail.then(() => this.ensureSync(min));
		// Keep the chain alive even if one batch fails; the next caller retries.
		this.tail = task.catch(() => {
			// errors propagate via `task` to the original caller
		});
		await task;
	}

	/** Whether more works exist beyond the first `count`. */
	hasMoreAfter(count: number): boolean {
		return !this.exhausted || this.works.length > count;
	}

	private async ensureSync(min: number): Promise<void> {
		while (this.works.length < min && !this.exhausted) {
			if (!this.authorsLoaded) {
				const body = await fetchPage(BROWSE_INDEX_URL);
				this.authors = body ? parseAuthors(body) : [];
				this.authorsLoaded = true;
				if (this.authors.length === 0) {
					this.exhausted = true;
					return;
				}
			}
			const batch = this.authors.slice(
				this.nextAuthor,
				this.nextAuthor + AUTHOR_BATCH,
			);
			if (batch.length === 0) {
				this.exhausted = true;
				return;
			}
			const results = await Promise.all(
				batch.map((author) => this.loadAuthor(author)),
			);
			this.nextAuthor += batch.length;
			for (const works of results) {
				for (const work of works) {
					if (!this.byUid.has(work.uid)) {
						this.byUid.set(work.uid, work);
						this.works.push(work);
					}
				}
			}
			if (this.nextAuthor >= this.authors.length) {
				this.exhausted = true;
			}
		}
	}

	private async loadAuthor(author: AuthorRef): Promise<CatalogWork[]> {
		const body = await fetchPage(authorBrowseUrl(author.slug));
		return body ? parseAuthorWorks(body) : [];
	}
}

/** One catalog feed per extension session. */
const feed = new CatalogFeed();

// ---------------------------------------------------------------------------
// Work and section caches — work pages, section pages and parsed paragraphs
// are fetched/parsed at most once per session.
// ---------------------------------------------------------------------------

const workCache = new Map<string, WorkInfo>();
/** Section text is large; keep a bounded cache of parsed sections. */
const sectionCache = new Map<string, Paragraph[]>();
const SECTION_CACHE_LIMIT = 16;

async function workInfo(uid: string): Promise<WorkInfo> {
	const cached = workCache.get(uid);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(workUrl(uid));
	if (body === null) {
		throw new Error(`The Internet Classics Archive: work "${uid}" not found`);
	}
	const info = parseWorkPage(body, uid);
	workCache.set(uid, info);
	return info;
}

async function sectionParagraphs(
	uid: string,
	n: number,
	url: string,
	fallbackHeading: string | null,
): Promise<Paragraph[]> {
	const key = `${uid}#${n}`;
	const cached = sectionCache.get(key);
	if (cached) {
		return cached;
	}
	const body = await fetchPage(url);
	if (body === null) {
		throw new Error(
			`The Internet Classics Archive: section ${n} of "${uid}" not found`,
		);
	}
	const parsed = parseSection(body, fallbackHeading).map((p) => ({
		type: "Text" as const,
		content: p.content,
		style: p.style === "bold" ? { bold: true } : null,
	}));
	if (sectionCache.size >= SECTION_CACHE_LIMIT) {
		sectionCache.clear();
	}
	sectionCache.set(key, parsed);
	return parsed;
}

/** Resolves the page URL of section `n` of a work, also covering
 * single-page works (whose single "section" is the work page itself). */
async function sectionUrl(uid: string, n: number): Promise<string> {
	const info = await workInfo(uid);
	if (info.sections.length > 0) {
		const section = info.sections.find((s) => s.n === n);
		if (section) {
			return section.url;
		}
		throw new Error(
			`The Internet Classics Archive: work "${uid}" has no section ${n}`,
		);
	}
	if (info.singlePage && n === 1) {
		return workUrl(uid);
	}
	throw new Error(
		`The Internet Classics Archive: work "${uid}" has no section ${n}`,
	);
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
	 * Pages through the flattened catalog of locally readable works (216
	 * works by ~60 authors, built from the /Browse/ author pages and cached
	 * per session). Author pages whose texts are only hosted at the Perseus
	 * Project are skipped.
	 */
	async browse(page: number): Promise<EntryList> {
		const p = Math.max(0, page);
		await feed.ensure((p + 1) * PAGE_SIZE);
		const content = feed.loaded
			.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)
			.map((work) => this.toEntry(work));
		return {
			content,
			hasnext: feed.hasMoreAfter((p + 1) * PAGE_SIZE),
			length: content.length,
		};
	}

	/**
	 * The site's own search is a Google Custom Search form, so search runs
	 * client-side over the cached catalog (title and author substring match).
	 */
	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim().toLowerCase();
		if (query.length === 0 || Math.max(0, page) > 0) {
			return { content: [], hasnext: false };
		}
		await feed.ensure(Number.MAX_SAFE_INTEGER);
		const content = feed.loaded
			.filter(
				(work) =>
					work.title.toLowerCase().includes(query) ||
					work.author.toLowerCase().includes(query) ||
					(work.translator?.toLowerCase().includes(query) ?? false),
			)
			.map((work) => this.toEntry(work));
		return { content, hasnext: false, length: content.length };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		if (!parseWorkUid(uid)) {
			throw new Error(
				`The Internet Classics Archive: invalid work id "${uid}"`,
			);
		}
		const info = await workInfo(uid);
		if (!info.singlePage && info.sections.length === 0) {
			// Perseus-only stub pages list no sections and hold no text.
			throw new Error(
				`The Internet Classics Archive: no readable text for "${uid}" (hosted at the Perseus Project)`,
			);
		}

		const author = info.author ?? feed.entry(uid)?.author ?? null;
		const episodes: Episode[] =
			info.sections.length > 0
				? info.sections.map((section) => ({
						id: {
							uid: episodeUid(uid, section.n),
							iddata: JSON.stringify({
								work: uid,
								url: section.url,
								n: section.n,
							}),
						},
						name: section.name,
						url: section.url,
					}))
				: [
						{
							id: {
								uid: episodeUid(uid, 1),
								iddata: JSON.stringify({
									work: uid,
									url: workUrl(uid),
									n: 1,
								}),
							},
							name: "Full text",
							url: workUrl(uid),
						},
					];

		const description =
			workDescription(info) ||
			`"${info.title}"${author ? ` by ${author}` : ""} — full text on The Internet Classics Archive.`;

		const meta: Record<string, string> = {};
		if (info.written) {
			meta.Written = info.written;
		}
		if (info.translator) {
			meta.Translator = info.translator;
		}

		const entry: EntryDetailed = {
			id: { uid },
			url: workUrl(uid),
			titles: [info.title],
			author: author ? [author] : null,
			media_type: "Book",
			status: "Complete",
			description,
			language: "en",
			episodes,
			meta: Object.keys(meta).length > 0 ? meta : null,
			ui: Column(
				Text(PUBLIC_DOMAIN_NOTE),
				Divider(),
				Link(workUrl(uid), "Open on The Internet Classics Archive"),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let uid = "";
		let n = 0;
		let url: string | null = null;
		try {
			const data = JSON.parse(epid.iddata ?? "") as {
				work?: unknown;
				url?: unknown;
				n?: unknown;
			};
			if (typeof data.work === "string" && typeof data.n === "number") {
				uid = data.work;
				n = data.n;
				if (typeof data.url === "string") {
					url = data.url;
				}
			}
		} catch {
			// no/malformed iddata: fall back to the uid below
		}
		if (!parseWorkUid(uid)) {
			const parsed = parseEpisodeUid(epid.uid);
			if (!parsed) {
				throw new Error(
					`The Internet Classics Archive: invalid section id "${epid.uid}"`,
				);
			}
			uid = parsed.workUid;
			n = parsed.n;
		}
		if (url === null) {
			url = await sectionUrl(uid, n);
		}

		const paragraphs = await sectionParagraphs(uid, n, url, null);
		if (paragraphs.length === 0) {
			throw new Error(
				`The Internet Classics Archive: no readable text in section ${n} of "${uid}"`,
			);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}

	// -- Helpers -------------------------------------------------------------

	private toEntry(work: CatalogWork): Entry {
		return {
			id: { uid: work.uid },
			url: work.url,
			title: work.title,
			media_type: "Book",
			author: work.author ? [work.author] : null,
		};
	}
}
