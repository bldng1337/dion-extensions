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
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	type IaFileEntry,
	buildSearchQuery,
	compareNatural,
	coverUrl,
	decodeEntities,
	detailsUrl,
	encodeQuery,
	fileUrl,
	firstString,
	isPageFile,
	isUnreadable,
	metadataUrl,
	normalizeDescription,
	parseReadableFiles,
	pickPageFiles,
	pickPdfFile,
	pickReadableFiles,
	publicationYear,
	searchUrl,
	serializeReadableFiles,
	stripHtml,
	stringList,
} from "./dcm.ts";

// ---------------------------------------------------------------------------
// Inline fixtures (shapes copied from live archive.org metadata responses)
// ---------------------------------------------------------------------------

/** mediatype:image item: individual page scans, names from a live item. */
const NIGHTMARE_FILES: IaFileEntry[] = [
	{ name: "__ia_thumb.jpg", format: "Item Tile" },
	{ name: "nightmare-11-01.jpg", format: "JPEG" },
	{ name: "nightmare-11-02.jpg", format: "JPEG" },
	{ name: "nightmare-11-03.jpg", format: "JPEG" },
	{ name: "nightmare-11-02_thumb.jpg", format: "JPEG Thumb" },
	{ name: "nightmare-11-10.jpg", format: "JPEG" },
];

/** texts item: CBZ/CBR original plus IA book derivatives. */
const OUT_OF_THIS_WORLD_FILES: IaFileEntry[] = [
	{ name: "OutOfThisWorldAdventuresIssue1.cbr", format: "Comic Book RAR" },
	{ name: "OutOfThisWorldAdventuresIssue1_djvu.txt", format: "DjVu" },
	{ name: "out_of_this_world_1.pdf", format: "Image Container PDF" },
	{ name: "out_of_this_world_1_text.pdf", format: "Additional Text PDF" },
	{
		name: "OutOfThisWorldAdventuresIssue1_jp2.zip",
		format: "Single Page Processed JP2 ZIP",
	},
];

/** Mirror item that only carries a CBZ archive — unreadable for the runtime. */
const CBZ_ONLY_FILES: IaFileEntry[] = [
	{
		name: "All_Top_Comics_6_Norlen_1959_C2C__Atomic_Mouse__Happy_the_Magic_Bunny___js_DCP_.cbz",
		format: "Comic Book ZIP",
	},
	{ name: "DCMGoldenAge_meta.xml", format: "Metadata" },
];

// ---------------------------------------------------------------------------
// Unit tests for the pure helpers
// ---------------------------------------------------------------------------

describe("dcm helpers", () => {
	it("should build the mirror-set query", () => {
		expect(buildSearchQuery()).toBe(
			'("digital comic museum" OR "digital comics museum") AND (mediatype:image OR format:"Text PDF" OR format:"Image Container PDF" OR format:"Additional Text PDF")',
		);
		expect(buildSearchQuery("nightmare")).toEndWith("AND title:(nightmare)");
	});
	it("should strip query-syntax characters from search terms", () => {
		expect(buildSearchQuery('night"mare (1954):')).toEndWith(
			"title:(night mare  1954)",
		);
	});
	it("should encode search urls with a 1-based page", () => {
		const browse = searchUrl(0);
		expect(browse).toStartWith("https://archive.org/advancedsearch.php?");
		expect(browse).toContain("rows=20");
		expect(browse).toContain("page=1");
		expect(browse).toContain(encodeURIComponent("downloads desc"));
		// Search drops the sort so IA ranks by relevance, and uses page+1.
		const search = searchUrl(2, "nightmare");
		expect(search).not.toContain("sort=");
		expect(search).toContain("page=3");
		expect(search).toContain(encodeURIComponent("title:(nightmare)"));
		expect(search).toContain("output=json");
	});
	it("should encode every query pair", () => {
		expect(encodeQuery([["a b", "c&d"]])).toBe("a%20b=c%26d");
	});
	it("should build archive.org urls", () => {
		expect(metadataUrl("nightmare-11-01")).toBe(
			"https://archive.org/metadata/nightmare-11-01",
		);
		expect(detailsUrl("x y")).toBe("https://archive.org/details/x%20y");
		expect(coverUrl("nightmare-11-01")).toBe(
			"https://archive.org/services/img/nightmare-11-01",
		);
		expect(fileUrl("item", "page 1.jpg")).toBe(
			"https://archive.org/download/item/page%201.jpg",
		);
	});
	it("should decode named and numeric entities", () => {
		expect(decodeEntities("Tom &amp; Jerry &#39;Fun&#x27;")).toBe(
			"Tom & Jerry 'Fun'",
		);
		expect(decodeEntities("&#65;&#x42;C")).toBe("ABC");
		// Unknown entities and bare ampersands are left alone.
		expect(decodeEntities("Tom&nbsp;&amp; Jerry&Co &fake;")).toBe(
			"Tom & Jerry&Co &fake;",
		);
	});
	it("should strip description html to plain text", () => {
		expect(
			stripHtml("<div>Scans from <b>DCM</b>.<br />Enjoy!<br /></div>"),
		).toBe("Scans from DCM.\nEnjoy!");
		expect(stripHtml("  a  b \n c \n\n\n d ")).toBe("a b\nc\n\nd");
	});
	it("should normalize missing, array and html descriptions", () => {
		expect(normalizeDescription(undefined)).toBe("");
		expect(normalizeDescription(["<p>One.</p>", "<p>Two.</p>"])).toBe(
			"One.\n\nTwo.",
		);
		const long = normalizeDescription("Sentence. ".repeat(400));
		expect(long.length).toBeLessThanOrEqual(1204);
		expect(long.endsWith("[…]")).toBe(true);
	});
	it("should read the first string of oddly shaped metadata fields", () => {
		expect(firstString("year")).toBe("year");
		expect(firstString(1954)).toBe("1954");
		expect(firstString(["", "Chaos Thrawn"])).toBe("Chaos Thrawn");
		expect(firstString(undefined)).toBeUndefined();
		expect(firstString("")).toBeUndefined();
		expect(stringList(["A", 3, "B"])).toEqual(["A", "B"]);
		expect(stringList("Solo")).toEqual(["Solo"]);
		expect(stringList(undefined)).toEqual([]);
	});
	it("should derive the publication year", () => {
		expect(publicationYear({ year: "1954" })).toBe("1954");
		expect(publicationYear({ year: 1954 })).toBe("1954");
		expect(publicationYear({ date: "1954-06-01" })).toBe("1954");
		// Years buried after words are not extracted.
		expect(publicationYear({ date: "June 1954" })).toBeUndefined();
		expect(publicationYear({})).toBeUndefined();
	});
	it("should only accept exact page-image files", () => {
		expect(isPageFile({ name: "p1.jpg", format: "JPEG" })).toBe(true);
		expect(isPageFile({ name: "p1.png", format: "PNG" })).toBe(true);
		expect(isPageFile({ name: "p1_thumb.jpg", format: "JPEG Thumb" })).toBe(
			false,
		);
		expect(isPageFile({ name: "__ia_thumb.jpg", format: "Item Tile" })).toBe(
			false,
		);
		expect(isPageFile({ name: "book.cbz", format: "Comic Book ZIP" })).toBe(
			false,
		);
		expect(isPageFile({ format: "JPEG" })).toBe(false);
	});
	it("should compare file names naturally", () => {
		const sorted = [
			"page_10.jpg",
			"page_2.jpg",
			"Page 3.jpg",
			"page_03a.jpg",
		].sort(compareNatural);
		expect(sorted).toEqual([
			// Space sorts before underscore; digit runs compare numerically.
			"Page 3.jpg",
			"page_2.jpg",
			"page_03a.jpg",
			"page_10.jpg",
		]);
		expect(compareNatural("a2b", "a2b")).toBe(0);
		expect(compareNatural("cover.jpg", "cover10.jpg")).toBeGreaterThan(0);
	});
	it("should pick page files sorted naturally, ignoring thumbs", () => {
		expect(pickPageFiles(NIGHTMARE_FILES)).toEqual([
			"nightmare-11-01.jpg",
			"nightmare-11-02.jpg",
			"nightmare-11-03.jpg",
			"nightmare-11-10.jpg",
		]);
		expect(pickPageFiles(OUT_OF_THIS_WORLD_FILES)).toEqual([]);
	});
	it("should pick the best PDF derivative", () => {
		expect(pickPdfFile(OUT_OF_THIS_WORLD_FILES)).toBe(
			"out_of_this_world_1.pdf",
		);
		expect(
			pickPdfFile([
				{ name: "x_text.pdf", format: "Additional Text PDF" },
				{ name: "x.pdf", format: "Text PDF" },
			]),
		).toBe("x.pdf");
		expect(pickPdfFile(NIGHTMARE_FILES)).toBeNull();
	});
	it("should prefer pages over pdf and reject archive-only items", () => {
		const both = pickReadableFiles([
			{ name: "p1.jpg", format: "JPEG" },
			{ name: "x.pdf", format: "Text PDF" },
		]);
		expect(both).toEqual({ pages: ["p1.jpg"], pdf: "x.pdf" });
		expect(isUnreadable(both)).toBe(false);
		const cbz = pickReadableFiles(CBZ_ONLY_FILES);
		expect(isUnreadable(cbz)).toBe(true);
	});
	it("should round-trip readable files through episode iddata", () => {
		const readable = pickReadableFiles(NIGHTMARE_FILES);
		const parsed = parseReadableFiles(serializeReadableFiles(readable));
		expect(parsed).toEqual(readable);
		expect(parseReadableFiles(null)).toBeNull();
		expect(parseReadableFiles("not json")).toBeNull();
		expect(parseReadableFiles('{"pages":"x"}')).toEqual({
			pages: [],
			pdf: null,
		});
	});
});

// ---------------------------------------------------------------------------
// Live flow against archive.org through the built extension
// ---------------------------------------------------------------------------

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Comic");
		expect(data.extension_type).toContainEqual({
			type: "EntryProvider",
			has_search: true,
		});
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
	it("should be able to browse the mirror set", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(20);
		// The mirror set holds more than one page of comics.
		expect(result.hasnext).toBe(true);
		const uids = new Set<string>();
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.url).toBe(detailsUrl(entry.id.uid));
			expect(entry.cover?.url).toBe(coverUrl(entry.id.uid));
			expect(uids.has(entry.id.uid)).toBe(false);
			uids.add(entry.id.uid);
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should return nothing past the end of the mirror set", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(100);
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 60_000);
	it("should be able to search mirror titles", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "nightmare");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		// The Nightmare (St. John) issues are DCM-mirrored page-image items.
		expect(result.content.some((e) => e.id.uid === "nightmare-11-01")).toBe(
			true,
		);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Comic");
			expect(entry.title.toLowerCase()).toContain("nightmare");
		}
		await assertValidEntries(result.content);
	}, 120_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);
	it("should be able to detail the top browse result", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.media_type).toBe("Comic");
		expect(result.entry.status).toBe("Complete");
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.name).toBe("Read");
		expect(result.entry.episodes[0]!.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.cover?.url).toStartWith(
			"https://archive.org/services/img/",
		);
		expect(result.entry.meta?.["Scan source"]).toBe("Digital Comic Museum");
		expect(result.entry.ui).toBeDefined();
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		detailResult = result;
	}, 120_000);
	it("should be able to source the detailed comic", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.settings).toEqual(detailResult.settings);
		// The top browse item mirrors IA book derivatives: page images or a
		// PDF; both are valid, the exact kind depends on the live item.
		if (result.source.type === "Imagelist") {
			expect(result.source.links.length).toBeGreaterThan(0);
			expect(result.source.audio).toBeNull();
			for (const link of result.source.links) {
				expect(link.url).toStartWith(
					`https://archive.org/download/${detailResult.entry.id.uid}/`,
				);
			}
		} else if (result.source.type === "Pdf") {
			expect(result.source.link.url).toStartWith(
				`https://archive.org/download/${detailResult.entry.id.uid}/`,
			);
			expect(result.source.link.url).toEndWith(".pdf");
		} else {
			throw new Error(`Unexpected source type ${result.source.type}`);
		}
		await assertValidSource(result.source);
	}, 60_000);
	it("should source a page-image comic as an Imagelist", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const detail = await extension!.detail({ uid: "nightmare-11-01" }, {});
		expect(detail.entry.titles[0]).toContain("Nightmare");
		expect(detail.entry.author?.length ?? 0).toBeGreaterThan(0);
		await assertValidEntry(detail.entry);
		const result = await extension!.source(
			detail.entry.episodes[0]!.id,
			detail.settings,
		);
		expect(result.source.type).toBe("Imagelist");
		if (result.source.type === "Imagelist") {
			// The live item carries 36 scanned pages, all in natural order.
			expect(result.source.links.length).toBeGreaterThanOrEqual(20);
			expect(result.source.audio).toBeNull();
			const names = result.source.links.map((l) => {
				expect(l.url).toStartWith(
					"https://archive.org/download/nightmare-11-01/",
				);
				// Mixed-case extensions occur in the live item.
				expect(l.url.toLowerCase()).toEndWith(".jpg");
				const file = l.url.split("/").pop() ?? "";
				return decodeURIComponent(file);
			});
			const sorted = [...names].sort(compareNatural);
			expect(names).toEqual(sorted);
		}
		expect(result.settings).toEqual(detail.settings);
		await assertValidSource(result.source);
	}, 120_000);
	it("should source without iddata by refetching the item", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source({ uid: "nightmare-11-01" }, {});
		expect(result.source.type).toBe("Imagelist");
		await assertValidSource(result.source);
	}, 60_000);
	it("should reject comics that only offer a CBZ/CBR archive", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// A mirror upload whose only original is a single CBZ file.
		await expect(
			extension!.detail({ uid: "DCMGoldenAge" }, {}),
		).rejects.toThrow(/CBZ|CBR|cannot be read/);
	}, 60_000);
	it("should reject unknown items", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.detail({ uid: "not-a-real-dcm-item-xyz" }, {}),
		).rejects.toThrow();
	}, 60_000);
});
