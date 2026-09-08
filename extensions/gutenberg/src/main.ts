import { DionExtension } from "@dion-js/runtime-lib";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
} from "@dion-js/runtime-lib/settings.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml, type DionElement } from "parse";
import {
	BASE,
	bookUid,
	bookUrl,
	coverUrl,
	EPUB_NO_IMAGES,
	EPUB_WITH_IMAGES,
	epubCandidatesFromFeed,
	FORMAT_SETTING_ID,
	PAGE_SIZE,
	parseEpubCandidates,
	pickEpubUrl,
	prefixedValue,
	SHELF_SETTING_ID,
	SHELVES,
} from "./opds.ts";

// ---------------------------------------------------------------------------
// Fetch / parse helpers
// ---------------------------------------------------------------------------

/** Selector factory; the runtime requires CSSSelector objects, not strings. */
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

/** Trimmed text of the first element matching `selector`, or "". */
function text(el: DionElement | undefined, selector: string): string {
	return (el?.select(q(selector)).first?.text ?? "").trim();
}

async function fetchOpds(url: string): Promise<string> {
	const res = await fetch(url, { headers: { Accept: "application/atom+xml" } });
	if (!res.ok) {
		throw new Error(`Project Gutenberg request failed (${res.status}): ${url}`);
	}
	return res.body;
}

/** Maps a listing feed document (search/popular/bookshelf) to Entry items. */
function listingToEntries(body: string): Entry[] {
	const doc = parseHtml(body);
	const entries = doc.select(q("entry"));
	const books: Entry[] = [];
	for (let i = 0; i < entries.length; i++) {
		const el = entries.get(i);
		if (!el) {
			continue;
		}
		const uid = bookUid(text(el, "id"));
		if (!uid) {
			continue;
		}
		const author = text(el, "content");
		books.push({
			id: { uid },
			url: bookUrl(uid),
			title: text(el, "title") || `Project Gutenberg #${uid}`,
			media_type: "Book",
			cover: { url: coverUrl(uid) },
			...(author ? { author: [author] } : {}),
		});
	}
	return books;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {
		shelf: new ExtensionSetting<string>(SHELF_SETTING_ID, "popular", "Search")
			.setLabel("Browse collection")
			.setUI(new Dropdown(SHELVES)),
	};
	accounts = {};
	entrySettings = {};

	async browse(page: number): Promise<EntryList> {
		const shelf = await this.settings.shelf.get();
		const start = Math.max(0, page) * PAGE_SIZE;
		const url =
			shelf === "popular"
				? `${BASE}/ebooks/search.opds/?sort_order=downloads&start_index=${start}`
				: `${BASE}/ebooks/bookshelf/${shelf}.opds?start_index=${start}`;
		const content = listingToEntries(await fetchOpds(url));
		return { content, hasnext: content.length >= PAGE_SIZE };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false };
		}
		const start = Math.max(0, page) * PAGE_SIZE;
		const url = `${BASE}/ebooks/search.opds/?query=${encodeURIComponent(query)}&start_index=${start}`;
		const content = listingToEntries(await fetchOpds(url));
		return { content, hasnext: content.length >= PAGE_SIZE };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const uid = entryid.uid;
		const body = await fetchOpds(`${BASE}/ebooks/${uid}.opds`);
		const entryEl = parseHtml(body).select(q("entry")).first;
		if (!entryEl) {
			throw new Error(`Project Gutenberg: book ${uid} not found`);
		}

		const sstore = new SettingStore(settings);
		sstore.getOrDefine<string>({
			id: FORMAT_SETTING_ID,
			defaultval: EPUB_WITH_IMAGES,
			label: "Preferred EPUB",
			ui: new Dropdown([
				{ value: EPUB_WITH_IMAGES, label: "EPUB (with images)" },
				{ value: EPUB_NO_IMAGES, label: "EPUB (no images)" },
			]),
		});

		const title = text(entryEl, "title") || `Project Gutenberg #${uid}`;
		const authorEl = entryEl.select(q("author")).first;
		const author = authorEl ? text(authorEl, "name") : "";

		const genres = entryEl
			.select(q("category"))
			.map((c) =>
				c.attr("scheme").includes("LCSH")
					? (c.attr("label") || c.attr("term")).trim()
					: "",
			)
			.filter((g) => g.length > 0);

		// Which EPUB variants Gutenberg offers for this book, detected on the
		// raw feed body (see epubCandidatesFromFeed for why not via the DOM).
		const epub = epubCandidatesFromFeed(body, uid);

		// The content block carries one "<p>Label:\nvalue</p>" per field.
		const contentEl = entryEl.select(q("content")).first;
		const paragraphs: { el: DionElement; text: string }[] = [];
		if (contentEl) {
			const pEls = contentEl.select(q("p"));
			for (let i = 0; i < pEls.length; i++) {
				const p = pEls.get(i);
				if (p) {
					paragraphs.push({ el: p, text: p.text.trim() });
				}
			}
		}

		const titles: string[] = [title];
		const meta: Record<string, string> = {};
		const locc: string[] = [];
		let description = "";
		let downloads: number | null = null;

		for (const p of paragraphs) {
			if (p.text.startsWith("Summary:")) {
				description = prefixedValue(p.text, "Summary:");
			} else if (p.text.startsWith("Alternate Title:")) {
				titles.push(prefixedValue(p.text, "Alternate Title:"));
			} else if (p.text.startsWith("Downloads:")) {
				const n = Number.parseInt(
					prefixedValue(p.text, "Downloads:").replace(/\D/g, ""),
					10,
				);
				if (Number.isFinite(n)) {
					downloads = n;
				}
			} else if (p.text.startsWith("Subject:")) {
				const subject = prefixedValue(p.text, "Subject:");
				if (subject && !genres.includes(subject)) {
					genres.push(subject);
				}
			} else if (p.text.startsWith("LoCC:")) {
				locc.push(prefixedValue(p.text, "LoCC:"));
			} else if (p.text.startsWith("Published:")) {
				meta.Published = prefixedValue(p.text, "Published:");
			} else if (p.text.startsWith("Rights:")) {
				meta.Rights = prefixedValue(p.text, "Rights:");
			} else if (p.text.startsWith("Credits:")) {
				meta.Credits = prefixedValue(p.text, "Credits:");
			} else if (p.text.startsWith("Note:")) {
				const href = p.el.select(q("a")).first?.attr("href") ?? "";
				if (href.startsWith("//en.wikipedia.org/")) {
					meta.Wikipedia = `https:${href}`;
				}
			}
		}
		if (locc.length > 0) {
			meta.LoCC = locc.join("; ");
		}

		// dcterms:language holds the ISO code; tolerate parser-dependent
		// namespace prefixes by suffix-matching the element name.
		let language = "en";
		const langNode = entryEl.children.filter((c) =>
			c.name.endsWith("language"),
		).first;
		const lang = langNode?.text.trim();
		if (lang && lang.length > 0) {
			language = lang;
		}

		const entry: EntryDetailed = {
			id: { uid },
			url: bookUrl(uid),
			titles: [...new Set(titles.map((t) => t.trim()).filter((t) => t))],
			author: author ? [author] : null,
			media_type: "Book",
			status: "Complete",
			description:
				description || paragraphs.map((p) => p.text).join("\n\n") || title,
			language,
			cover: { url: coverUrl(uid) },
			episodes: [
				{
					id: { uid, iddata: JSON.stringify(epub) },
					name: "Read",
					url: bookUrl(uid),
				},
			],
			genres: genres.length > 0 ? genres : null,
			views: downloads,
			meta: Object.keys(meta).length > 0 ? meta : null,
		};

		return { entry, settings: { ...settings, ...sstore.toMap() } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let url: string;
		const epub = parseEpubCandidates(epid.iddata);
		if (epub === null) {
			// Entry opened without going through detail(): fall back to the
			// standard EPUB3 download URL for the book id.
			url = `${BASE}/ebooks/${epid.uid}.epub3.images`;
		} else {
			const format =
				new SettingStore(settings).tryGet<string>(FORMAT_SETTING_ID) ??
				EPUB_WITH_IMAGES;
			const pick = pickEpubUrl(epub, format);
			if (!pick) {
				throw new Error(
					"Project Gutenberg: no EPUB download available for this book",
				);
			}
			url = pick;
		}
		return {
			source: { type: "Epub", link: { url } },
			settings: { ...settings },
		};
	}
}
