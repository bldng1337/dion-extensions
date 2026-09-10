/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	assertValidEntries,
	assertValidEntry,
	assertValidSource,
	getTestExtension,
	MockManagerClient,
} from "@dion-js/extension-test-utils";
import type { Extension } from "@dion-js/runtime";
import type {
	Entry,
	EntryDetailedResult,
	Setting,
	SettingValue,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	attributionText,
	bookSlug,
	bookUrl,
	catalogToEntry,
	decodeEntities,
	downloadsFromBook,
	formatOptions,
	FORMAT_EPUB,
	FORMAT_PDF,
	FORMAT_PDF_HIRES,
	FORMAT_SETTING_ID,
	licenseLabel,
	matchesFilter,
	pageSlice,
	parseDownloads,
	pickDownload,
	sortBooks,
	stripHtml,
} from "./openstax.ts";

// ---------------------------------------------------------------------------
// Fixtures (shape of the real CMS records)
// ---------------------------------------------------------------------------

const FIXTURE_BOOK = {
	slug: "books/college-physics-2e",
	book_state: "live",
	title: "College Physics 2e",
	subjects: ["Science"],
	cover_url: "https://assets.openstax.org/cover.svg",
	pdf_url: "https://assets.openstax.org/book_web.pdf",
	high_resolution_pdf_url: "https://assets.openstax.org/book_print.pdf",
	description: "<p>An algebra-based physics course.</p><p>Second edition.</p>",
	authors: [
		{ type: "author", value: { name: "Jane Doe", university: "MIT" } },
		{ type: "author", value: { name: "John Roe" } },
		{ type: "author", value: {} },
	],
	book_subjects: [{ subject_name: "Science" }, { subject_name: "" }],
	license_name: "Creative Commons Attribution-NonCommercial-ShareAlike License",
	license_version: "4.0",
	license_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
	publish_date: "2022-07-13",
	epub_url: "https://assets.openstax.org/book.epub",
};

function formatSettings(value: string): Record<string, Setting> {
	return {
		[FORMAT_SETTING_ID]: {
			label: "Format",
			value: { type: "String", data: value } as SettingValue,
			default: { type: "String", data: FORMAT_PDF } as SettingValue,
			visible: true,
			ui: null,
		},
	};
}

let extension: Extension;
let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("openstax helpers", () => {
	it("should strip the books/ prefix from catalog slugs", () => {
		expect(bookSlug("books/college-physics-2e")).toBe("college-physics-2e");
		expect(bookSlug("college-physics-2e")).toBe("college-physics-2e");
		expect(bookSlug(undefined)).toBeNull();
		expect(bookSlug("")).toBeNull();
		expect(bookSlug("books/")).toBeNull();
		expect(bookSlug("a/b/c")).toBeNull();
	});

	it("should decode html entities in CMS text", () => {
		expect(decodeEntities("Physics &amp; Chemistry")).toBe(
			"Physics & Chemistry",
		);
		// nbsp is normalized to a plain space.
		expect(decodeEntities("&lt;i&gt;&nbsp;&mdash;&hellip;")).toBe(
			"<i> \u2014\u2026",
		);
		expect(decodeEntities("&#39;&#x27;")).toBe("''");
		// Unknown entities pass through untouched.
		expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
	});

	it("should strip rich-text html to plain text", () => {
		expect(stripHtml("<p>Hello <i>world</i></p>")).toBe("Hello world");
		expect(stripHtml("line one<br/>line two")).toBe("line one\nline two");
		expect(stripHtml("<p>A.</p>\n<p>B.</p>")).toBe("A.\n\nB.");
		expect(stripHtml(FIXTURE_BOOK.description)).toBe(
			"An algebra-based physics course.\n\nSecond edition.",
		);
	});

	it("should sort books case-insensitively by title", () => {
		const sorted = sortBooks([
			{ title: "algebra 1" },
			{ title: "Biology" },
			{ title: "Chemistry" },
		]);
		expect(sorted.map((b) => b.title)).toEqual([
			"algebra 1",
			"Biology",
			"Chemistry",
		]);
	});

	it("should map live catalog books to entries and skip unusable ones", () => {
		const entry = catalogToEntry(FIXTURE_BOOK);
		expect(entry).not.toBeNull();
		expect(entry?.id.uid).toBe("college-physics-2e");
		expect(entry?.title).toBe("College Physics 2e");
		expect(entry?.url).toBe(bookUrl("college-physics-2e"));
		expect(entry?.media_type).toBe("Book");
		expect(entry?.cover?.url).toBe(FIXTURE_BOOK.cover_url);
		expect(catalogToEntry({ ...FIXTURE_BOOK, book_state: "retired" })).toBe(
			null,
		);
		expect(catalogToEntry({ book_state: "live" })).toBe(null);
	});

	it("should filter books by title or subject across all terms", () => {
		expect(matchesFilter(FIXTURE_BOOK, "physics")).toBe(true);
		expect(matchesFilter(FIXTURE_BOOK, "COLLEGE Physics 2e")).toBe(true);
		expect(matchesFilter(FIXTURE_BOOK, "science")).toBe(true);
		expect(matchesFilter(FIXTURE_BOOK, "physics science")).toBe(true);
		expect(matchesFilter(FIXTURE_BOOK, "biology")).toBe(false);
		expect(matchesFilter(FIXTURE_BOOK, "college biology")).toBe(false);
		expect(matchesFilter(FIXTURE_BOOK, "   ")).toBe(false);
	});

	it("should slice pages with a has-next flag", () => {
		const items = [1, 2, 3, 4, 5];
		expect(pageSlice(items, 0, 2)).toEqual({
			content: [1, 2],
			hasnext: true,
		});
		expect(pageSlice(items, 2, 2)).toEqual({
			content: [5],
			hasnext: false,
		});
		expect(pageSlice(items, 9, 2)).toEqual({ content: [], hasnext: false });
		expect(pageSlice(items, -1, 2).content).toEqual([1, 2]);
	});

	it("should collect the download urls of a book", () => {
		const downloads = downloadsFromBook(FIXTURE_BOOK);
		expect(downloads.pdf).toBe("https://assets.openstax.org/book_web.pdf");
		expect(downloads.hires).toBe("https://assets.openstax.org/book_print.pdf");
		expect(downloads.epub).toBe("https://assets.openstax.org/book.epub");
		// Missing fields collapse to null instead of undefined.
		expect(downloadsFromBook({})).toEqual({
			pdf: null,
			hires: null,
			epub: null,
		});
		expect(downloadsFromBook({ high_resolution_pdf_url: "h.pdf" }).pdf).toBe(
			"h.pdf",
		);
	});

	it("should parse the downloads JSON carried in episode iddata", () => {
		expect(parseDownloads(undefined)).toBeNull();
		expect(parseDownloads("")).toBeNull();
		expect(parseDownloads("not json")).toBeNull();
		expect(
			parseDownloads(
				JSON.stringify({
					pdf: "https://a/book.pdf",
					hires: "",
					epub: "https://a/book.epub",
				}),
			),
		).toEqual({
			pdf: "https://a/book.pdf",
			hires: null,
			epub: "https://a/book.epub",
		});
	});

	it("should list dropdown options for the formats a book offers", () => {
		// The fixture has distinct web/print PDFs plus an EPUB.
		expect(
			formatOptions(downloadsFromBook(FIXTURE_BOOK)).map((o) => o.value),
		).toEqual([FORMAT_PDF, FORMAT_PDF_HIRES, FORMAT_EPUB]);
		// Real books currently only ship one PDF (web == high resolution).
		expect(formatOptions(downloadsFromBook({ pdf_url: "a.pdf" }))).toEqual([
			{ value: FORMAT_PDF, label: "PDF" },
		]);
		expect(formatOptions(downloadsFromBook({}))).toEqual([]);
	});

	it("should resolve the requested format with sensible fallbacks", () => {
		const downloads = downloadsFromBook(FIXTURE_BOOK);
		expect(pickDownload(downloads, FORMAT_PDF)?.url).toBe(
			"https://assets.openstax.org/book_web.pdf",
		);
		expect(pickDownload(downloads, FORMAT_PDF)?.kind).toBe("pdf");
		expect(pickDownload(downloads, FORMAT_PDF_HIRES)?.url).toBe(
			"https://assets.openstax.org/book_print.pdf",
		);
		expect(pickDownload(downloads, FORMAT_EPUB)).toEqual({
			kind: "epub",
			url: "https://assets.openstax.org/book.epub",
		});
		// No EPUB? fall back to the PDF. No PDF? fall back to the EPUB.
		expect(pickDownload({ ...downloads, epub: null }, FORMAT_EPUB)?.kind).toBe(
			"pdf",
		);
		expect(
			pickDownload({ pdf: null, hires: null, epub: "e.epub" }, "pdf"),
		).toEqual({ kind: "epub", url: "e.epub" });
		expect(
			pickDownload({ pdf: null, hires: null, epub: null }, FORMAT_PDF),
		).toBe(null);
	});

	it("should build the license label and attribution line", () => {
		expect(licenseLabel("CC BY", "4.0")).toBe("CC BY 4.0");
		expect(licenseLabel("CC BY", undefined)).toBe("CC BY");
		expect(licenseLabel(undefined, "4.0")).toBe("CC BY-NC-SA 4.0");
		expect(
			attributionText(FIXTURE_BOOK.license_name, FIXTURE_BOOK.license_version),
		).toBe(
			`Content © OpenStax, ${licenseLabel(FIXTURE_BOOK.license_name, FIXTURE_BOOK.license_version)}. Attribution required, non-commercial use.`,
		);
	});
});

// ---------------------------------------------------------------------------
// Live extension flow (build first: bun run build)
// ---------------------------------------------------------------------------

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
	});

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining(["openstax.org", "assets.openstax.org"]),
			);
		}
	});

	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 30_000);

	it("should paginate browse results", async () => {
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		expect(page1.hasnext).toBe(true);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		// Entry ids are unique across the whole catalog.
		expect(ids0.filter((id) => ids1.includes(id))).toEqual([]);
	}, 30_000);

	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "physics");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("physics"))).toBe(true);
	}, 30_000);

	it("should return no results for empty or unmatched searches", async () => {
		const empty = await extension!.search(0, "   ");
		expect(empty.content.length).toBe(0);
		expect(empty.hasnext).toBe(false);
		const unmatched = await extension!.search(0, "zzqxj");
		expect(unmatched.content.length).toBe(0);
	});

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || browseResult.length <= 0) {
			throw new Error("No browse result");
		}
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.titles[0]).toBe(browseResult[0]!.title);
		expect(entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.language).toBe("en");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.author?.length).toBeGreaterThan(0);
		expect(entry.genres?.length).toBeGreaterThan(0);
		expect(entry.meta?.License).toContain("Creative Commons");
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Read");
		// The per-entry format setting is defined on first detail.
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		// The download candidates ride along in the episode iddata.
		const downloads = parseDownloads(entry.episodes[0]!.id.iddata);
		expect(downloads?.pdf).toContain("https://assets.openstax.org/");
		// The attribution line is rendered in the entry UI.
		expect(JSON.stringify(entry.ui)).toContain("Attribution required");
		detailResult = result;
		await assertValidEntry(entry);
	}, 30_000);

	it("should be able to source with the default format", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Pdf");
		if (result.source.type !== "Pdf") throw new Error("Not a pdf source");
		expect(result.source.link.url).toMatch(
			/^https:\/\/assets\.openstax\.org\//,
		);
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		await assertValidSource(result.source);
	}, 30_000);

	it("should fall back to pdf when the requested format is unavailable", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		// OpenStax discontinued EPUB downloads; the picker falls back to PDF.
		const result = await extension!.source(
			episode.id,
			formatSettings(FORMAT_EPUB),
		);
		expect(result.source.type).toBe("Pdf");
		if (result.source.type !== "Pdf") throw new Error("Not a pdf source");
		expect(result.source.link.url).toMatch(
			/^https:\/\/assets\.openstax\.org\//,
		);
		expect(result.settings[FORMAT_SETTING_ID]).toBeDefined();
	}, 30_000);
});
