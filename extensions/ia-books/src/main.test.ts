/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
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
	buildQuery,
	fileUrl,
	FORMAT_EPUB,
	FORMAT_PDF,
	FORMAT_SETTING_ID,
	isRestricted,
	normalizeDescription,
	parseFiles,
	pickFiles,
	pickSource,
	publicationYear,
	sanitizeQueryTerm,
	serializeFiles,
} from "./ia.ts";

let extension: Extension;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

function formatSettings(value: string): Record<string, Setting> {
	return {
		[FORMAT_SETTING_ID]: {
			label: "Preferred format",
			value: { type: "String", data: value } as SettingValue,
			default: { type: "String", data: FORMAT_EPUB } as SettingValue,
			visible: true,
			ui: null,
		},
	};
}

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("ia helpers", () => {
	it("should sanitize user text out of query syntax", () => {
		expect(sanitizeQueryTerm('a"b:c')).toBe("a b c");
		expect(sanitizeQueryTerm("title:foo")).toBe("title foo");
		expect(sanitizeQueryTerm("x(y)")).toBe("x y");
		expect(sanitizeQueryTerm("   ")).toBe("");
	});

	it("should build open-downloads-only queries", () => {
		const base =
			'mediatype:texts AND format:("Text PDF" OR EPUB) AND -access-restricted-item:true';
		expect(buildQuery({})).toBe(base);
		expect(buildQuery({ collection: "all", language: "all" })).toBe(base);
		expect(buildQuery({ collection: "americana" })).toBe(
			`${base} AND collection:americana`,
		);
		expect(buildQuery({ language: "eng" })).toBe(`${base} AND language:eng`);
		expect(buildQuery({ collection: "gutenberg", language: "ger" })).toBe(
			`${base} AND collection:gutenberg AND language:ger`,
		);
		expect(buildQuery({ term: "sherlock holmes" })).toBe(
			`${base} AND (title:(sherlock holmes) OR creator:(sherlock holmes))`,
		);
		expect(buildQuery({ term: "alice:wonderland()" })).toBe(
			`${base} AND (title:(alice wonderland) OR creator:(alice wonderland))`,
		);
	});

	it("should detect lending-restricted items", () => {
		expect(isRestricted({ "access-restricted-item": "true" })).toBe(true);
		expect(isRestricted({ "access-restricted-item": true })).toBe(true);
		expect(isRestricted({ identifier: "x" })).toBe(false);
		expect(isRestricted(undefined)).toBe(false);
	});

	it("should extract a publication year from year or date", () => {
		expect(publicationYear({ year: 1888 })).toBe("1888");
		expect(publicationYear({ year: "1892" })).toBe("1892");
		expect(publicationYear({ date: "1892-" })).toBe("1892");
		expect(publicationYear({ date: "1904" })).toBe("1904");
		expect(publicationYear({})).toBeUndefined();
	});

	it("should normalize missing, array and HTML descriptions", () => {
		expect(normalizeDescription(undefined)).toBe("");
		expect(normalizeDescription(null)).toBe("");
		expect(normalizeDescription(["307 pages", "Illustrated"])).toBe(
			"307 pages\n\nIllustrated",
		);
		expect(
			normalizeDescription("<p>Hello <b>world</b> &amp; friends</p>"),
		).toBe("Hello world & friends");
	});

	it("should trim very long descriptions at a boundary", () => {
		const long = `${"A".repeat(60)}. ${"B".repeat(2000)}`;
		const out = normalizeDescription(long, 100);
		expect(out).toBe(`${"A".repeat(60)} […]`);
	});

	it("should pick only openly downloadable files", () => {
		expect(
			pickFiles([
				{ name: "book.epub", format: "EPUB" },
				{ name: "book.pdf", format: "Text PDF" },
				{ name: "book.lcpdf", format: "LCP Encrypted PDF" },
				{ name: "book_djvu.txt", format: "DjVuTXT" },
			]),
		).toEqual({ epub: "book.epub", pdf: "book.pdf" });
		expect(pickFiles([{ format: "EPUB" }, { name: "a.pdf" }])).toEqual({
			epub: null,
			pdf: null,
		});
		expect(pickFiles(undefined)).toEqual({ epub: null, pdf: null });
		expect(pickFiles([{ name: "A.EPUB", format: "epub" }])).toEqual({
			epub: "A.EPUB",
			pdf: null,
		});
	});

	it("should roundtrip download candidates through iddata", () => {
		const candidates = { epub: "book.epub", pdf: null };
		expect(parseFiles(serializeFiles(candidates))).toEqual(candidates);
		expect(parseFiles(undefined)).toBeNull();
		expect(parseFiles("")).toBeNull();
		expect(parseFiles("not json")).toBeNull();
		expect(parseFiles('{"epub":42,"pdf":"x.pdf"}')).toEqual({
			epub: null,
			pdf: "x.pdf",
		});
	});

	it("should pick the preferred format with fallback", () => {
		const both = { epub: "b.epub", pdf: "b.pdf" };
		expect(pickSource(both, FORMAT_EPUB)).toEqual({
			type: "Epub",
			name: "b.epub",
		});
		expect(pickSource(both, FORMAT_PDF)).toEqual({
			type: "Pdf",
			name: "b.pdf",
		});
		expect(pickSource({ epub: null, pdf: "b.pdf" }, FORMAT_EPUB)).toEqual({
			type: "Pdf",
			name: "b.pdf",
		});
		expect(pickSource({ epub: "b.epub", pdf: null }, FORMAT_PDF)).toEqual({
			type: "Epub",
			name: "b.epub",
		});
		expect(pickSource({ epub: null, pdf: null }, FORMAT_EPUB)).toBeNull();
	});

	it("should encode download urls", () => {
		expect(fileUrl("an-item", "Book File.epub")).toBe(
			"https://archive.org/download/an-item/Book%20File.epub",
		);
	});
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Book");
	});

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining(["archive.org", "www.archive.org"]),
			);
		}
	});

	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Book");
			expect(entry.cover?.url).toStartWith("https://archive.org/services/img/");
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 60_000);

	it("should be able to search by title and author", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "sherlock holmes");
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Book");
		}
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(
			titles.some((t) => t.includes("sherlock") || t.includes("doyle")),
		).toBe(true);
	}, 60_000);

	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.titles[0]!.length).toBeGreaterThan(0);
		expect(entry.description.length).toBeLessThanOrEqual(1300);
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Read");
		// The per-entry format setting is defined on first detail.
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		// The download candidates ride along in the episode iddata.
		const candidates = parseFiles(entry.episodes[0]!.id.iddata);
		expect(candidates).not.toBeNull();
		expect(candidates?.epub !== null || candidates?.pdf !== null).toBe(true);
		detailResult = result;
		await assertValidEntry(entry);
	}, 120_000);

	it("should be able to source with the default format", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			detailResult.settings as Record<string, Setting>,
		);
		expect(result.source.type === "Epub" || result.source.type === "Pdf").toBe(
			true,
		);
		if (result.source.type === "Epub" || result.source.type === "Pdf") {
			expect(result.source.link.url).toStartWith(
				"https://archive.org/download/",
			);
		}
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		await assertValidSource(result.source);
	}, 60_000);

	it("should honor the pdf format setting when available", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const candidates = parseFiles(episode.id.iddata);
		if (candidates === null) throw new Error("No candidates");
		const result = await extension!.source(
			episode.id,
			formatSettings(FORMAT_PDF),
		);
		if (result.source.type !== "Epub" && result.source.type !== "Pdf")
			throw new Error("Not a book source");
		const expected = pickSource(candidates, FORMAT_PDF)!;
		expect(result.source.type).toBe(expected.type);
		expect(result.source.link.url).toBe(
			fileUrl(detailResult.entry.id.uid, expected.name),
		);
		expect(result.settings[FORMAT_SETTING_ID]).toBeDefined();
	}, 60_000);

	it("should fall back to refetching metadata without iddata", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const result = await extension!.source(
			{ uid: detailResult.entry.id.uid },
			{},
		);
		if (result.source.type !== "Epub" && result.source.type !== "Pdf")
			throw new Error("Not a book source");
		expect(result.source.link.url).toStartWith("https://archive.org/download/");
	}, 60_000);

	it("should refuse lending-restricted items", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// A print-disabled/lending item (collection: inlibrary).
		await expect(
			extension!.detail({ uid: "manforhumanityon0000coll" }, {}),
		).rejects.toThrow();
	}, 60_000);
});
