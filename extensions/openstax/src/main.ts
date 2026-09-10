import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, SettingStore } from "@dion-js/runtime-lib/settings.js";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	attributionText,
	authorNames,
	bookSlug,
	bookUrl,
	catalogToEntry,
	CATALOG_URL,
	datePart,
	detailUrl,
	downloadsFromBook,
	formatOptions,
	FORMAT_SETTING_ID,
	licenseLabel,
	matchesFilter,
	PAGE_SIZE,
	pageSlice,
	parseDownloads,
	pickDownload,
	sortBooks,
	stripHtml,
	subjectNames,
} from "./openstax.ts";
import type { CatalogBook, DetailBook, Downloads } from "./openstax.ts";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`OpenStax request failed (${res.status}): ${url}`);
	}
	return res.json;
}

interface CatalogResponse {
	books?: CatalogBook[];
}

interface PagesResponse<T> {
	items?: T[];
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class extends DionExtension implements SourceProvider {
	settings = {};
	accounts = {};
	entrySettings = {};

	// The whole catalog is one JSON document (~110 titles); cache it per
	// session so browse/search paging does not refetch it every time.
	private catalog: CatalogBook[] | null = null;

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	/** Live books of the catalog, title-sorted. */
	private async liveCatalog(): Promise<CatalogBook[]> {
		if (this.catalog === null) {
			const data = (await fetchJson(CATALOG_URL)) as CatalogResponse;
			this.catalog = Array.isArray(data.books) ? data.books : [];
		}
		return sortBooks(this.catalog.filter((b) => b.book_state === "live"));
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const books = await this.liveCatalog();
		const entries = books
			.map(catalogToEntry)
			.filter((e): e is Entry => e !== null);
		const { content, hasnext } = pageSlice(entries, page, PAGE_SIZE);
		return { content, hasnext, length: entries.length };
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) {
			return { content: [], hasnext: false, length: 0 };
		}
		const books = (await this.liveCatalog()).filter((b) =>
			matchesFilter(b, query),
		);
		const entries = books
			.map(catalogToEntry)
			.filter((e): e is Entry => e !== null);
		const { content, hasnext } = pageSlice(entries, page, PAGE_SIZE);
		return { content, hasnext, length: entries.length };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const slug = bookSlug(entryid.uid);
		if (!slug) {
			throw new Error(`OpenStax: invalid book id ${entryid.uid}`);
		}
		const data = (await fetchJson(
			detailUrl(slug),
		)) as PagesResponse<DetailBook>;
		const book = data.items?.[0];
		if (!book) {
			throw new Error(`OpenStax: book ${slug} not found`);
		}

		// Per-entry format setting over the download formats this book offers
		// (currently always PDF — OpenStax discontinued EPUB downloads — but
		// the picker follows the API if that ever changes).
		const downloads = downloadsFromBook(book);
		const options = formatOptions(downloads);
		const sstore = new SettingStore(settings);
		sstore.getOrDefine<string>({
			id: FORMAT_SETTING_ID,
			defaultval: options[0]?.value ?? "pdf",
			label: "Format",
			ui: options.length > 0 ? new Dropdown(options) : undefined,
		});

		const title = (book.title ?? "").trim() || slug;
		const authors = authorNames(book);
		const genres = subjectNames(book);
		const description = stripHtml(book.description ?? "");
		const published = datePart(book.publish_date);
		const updated = datePart(book.updated);

		const meta: Record<string, string> = {};
		if (book.license_name || book.license_version) {
			meta.License = licenseLabel(book.license_name, book.license_version);
		}
		if (published) {
			meta.Published = published;
		}
		if (updated) {
			meta.Updated = updated;
		}
		if (book.digital_isbn_13) {
			meta["Digital ISBN"] = book.digital_isbn_13;
		}
		if (book.print_isbn_13) {
			meta["Print ISBN"] = book.print_isbn_13;
		}

		// Required attribution for the CC BY-NC-SA licensed content.
		const ui = Column(
			Text(attributionText(book.license_name, book.license_version), {
				italic: true,
			}),
			book.license_url
				? Link(book.license_url, "License terms (Creative Commons)")
				: undefined,
			book.webview_rex_link
				? Link(book.webview_rex_link, "Read online (web book)")
				: undefined,
		);

		const entry: EntryDetailed = {
			id: { uid: slug },
			url: bookUrl(slug),
			titles: [title],
			author: authors.length > 0 ? authors : null,
			media_type: "Book",
			status: "Complete",
			description:
				description.length > 0 ? description : `OpenStax textbook: ${title}.`,
			language: "en",
			cover: book.cover_url ? { url: book.cover_url } : undefined,
			episodes: [
				{
					// The download candidates ride along in the episode iddata
					// so source() does not need to refetch the book.
					id: { uid: slug, iddata: JSON.stringify(downloads) },
					name: "Read",
					url: bookUrl(slug),
				},
			],
			genres: genres.length > 0 ? genres : null,
			meta: Object.keys(meta).length > 0 ? meta : null,
			ui,
		};

		return { entry, settings: { ...settings, ...sstore.toMap() } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		let downloads: Downloads | null = parseDownloads(epid.iddata);
		if (downloads === null) {
			// Entry opened without going through detail(): resolve the book
			// from the catalog API by its slug.
			const slug = bookSlug(epid.uid);
			if (!slug) {
				throw new Error(`OpenStax: invalid episode id ${epid.uid}`);
			}
			const data = (await fetchJson(
				detailUrl(slug),
			)) as PagesResponse<DetailBook>;
			const book = data.items?.[0];
			if (!book) {
				throw new Error(`OpenStax: book ${slug} not found`);
			}
			downloads = downloadsFromBook(book);
		}

		const format =
			new SettingStore(settings).tryGet<string>(FORMAT_SETTING_ID) ?? "pdf";
		const pick = pickDownload(downloads, format);
		if (!pick) {
			throw new Error(`OpenStax: no download available for ${epid.uid}`);
		}
		return {
			source:
				pick.kind === "epub"
					? { type: "Epub", link: { url: pick.url } }
					: { type: "Pdf", link: { url: pick.url } },
			settings: { ...settings },
		};
	}
}
