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
	bookUid,
	EPUB_NO_IMAGES,
	EPUB_WITH_IMAGES,
	epubCandidatesFromFeed,
	FORMAT_SETTING_ID,
	parseEpubCandidates,
	pickEpubUrl,
} from "./opds.ts";

let extension: Extension;
let detailResult: EntryDetailedResult;

function formatSettings(value: string): Record<string, Setting> {
	return {
		[FORMAT_SETTING_ID]: {
			label: "Preferred EPUB",
			value: { type: "String", data: value } as SettingValue,
			default: { type: "String", data: EPUB_WITH_IMAGES } as SettingValue,
			visible: true,
			ui: null,
		},
	};
}

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
});

describe("opds helpers", () => {
	it("should extract book ids from listing feed ids", () => {
		expect(bookUid("https://www.gutenberg.org/ebooks/11.opds")).toBe("11");
		expect(bookUid("https://www.gutenberg.org/ebooks/1342.opds")).toBe("1342");
	});

	it("should reject non-book subsection entries", () => {
		expect(
			bookUid(
				"https://www.gutenberg.org/ebooks/subjects/search.opds/?query=alice+in+wonderland",
			),
		).toBeNull();
		expect(bookUid("https://www.gutenberg.org/ebooks.opds/")).toBeNull();
	});

	it("should parse epub candidates from iddata", () => {
		expect(parseEpubCandidates(undefined)).toBeNull();
		expect(parseEpubCandidates("")).toBeNull();
		expect(parseEpubCandidates("not json")).toBeNull();
		expect(
			parseEpubCandidates(
				JSON.stringify({ img: "https://a/11.epub3.images", noimg: "" }),
			),
		).toEqual({ img: "https://a/11.epub3.images", noimg: null });
	});

	it("should pick the epub url matching the preferred format", () => {
		const candidates = {
			img: "https://www.gutenberg.org/ebooks/11.epub3.images",
			noimg: "https://www.gutenberg.org/ebooks/11.epub.noimages",
		};
		expect(pickEpubUrl(candidates, EPUB_WITH_IMAGES)).toBe(candidates.img);
		expect(pickEpubUrl(candidates, EPUB_NO_IMAGES)).toBe(candidates.noimg);
		expect(
			pickEpubUrl({ img: null, noimg: candidates.noimg }, EPUB_WITH_IMAGES),
		).toBe(candidates.noimg);
		expect(
			pickEpubUrl({ img: candidates.img, noimg: null }, EPUB_NO_IMAGES),
		).toBe(candidates.img);
		expect(pickEpubUrl({ img: null, noimg: null }, EPUB_WITH_IMAGES)).toBe(
			null,
		);
	});

	it("should detect epub candidates in a detail feed body", () => {
		const body = `<feed>
			<entry><title>Pride and Prejudice</title>
			<link type="application/epub+zip" rel="http://opds-spec.org/acquisition" href="https://www.gutenberg.org/ebooks/1342.epub.noimages"/>
			<link type="application/epub+zip" rel="http://opds-spec.org/acquisition" href="https://www.gutenberg.org/ebooks/1342.epub3.images"/>
			</entry></feed>`;
		expect(epubCandidatesFromFeed(body, "1342")).toEqual({
			img: "https://www.gutenberg.org/ebooks/1342.epub3.images",
			noimg: "https://www.gutenberg.org/ebooks/1342.epub.noimages",
		});
	});

	it("should report no epub candidates for audio-only entries", () => {
		const body = `<feed><entry>
			<link type="audio/mpeg" rel="http://opds-spec.org/acquisition" href="https://www.gutenberg.org/uploads/original/202209/20942/20942-00.mp3"/>
			</entry></feed>`;
		expect(epubCandidatesFromFeed(body, "20942")).toEqual({
			img: null,
			noimg: null,
		});
	});
});

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
				expect.arrayContaining(["gutenberg.org", "www.gutenberg.org"]),
			);
		}
	});

	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.author?.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
	});

	it("should paginate browse results", async () => {
		const page0 = await extension!.browse(0);
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = page0.content.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
	});

	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "alice in wonderland");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		const titles = result.content.map((e) => e.title);
		expect(titles.some((t) => t.toLowerCase().includes("alice"))).toBe(true);
	});

	it("should return no results for an empty search", async () => {
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});

	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "1342" }, {});
		expect(result).toBeDefined();
		const entry = result.entry;
		expect(entry.titles[0]).toBe("Pride and Prejudice");
		expect(entry.author?.[0]).toContain("Austen");
		expect(entry.media_type).toBe("Book");
		expect(entry.status).toBe("Complete");
		expect(entry.language).toBe("en");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.genres?.length).toBeGreaterThan(0);
		expect(entry.views).toBeGreaterThan(0);
		expect(entry.episodes.length).toBe(1);
		expect(entry.episodes[0]!.name).toBe("Read");
		// The per-entry format setting is defined on first detail.
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		// The epub download candidates ride along in the episode iddata.
		const candidates = parseEpubCandidates(entry.episodes[0]!.id.iddata);
		expect(candidates?.img).toContain(".epub3.images");
		expect(candidates?.noimg).toContain(".epub.noimages");
		detailResult = result;
		await assertValidEntry(entry);
	});

	it("should be able to source with the default format", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toContain("/ebooks/1342.epub3.images");
		expect(Object.keys(result.settings)).toContain(FORMAT_SETTING_ID);
		await assertValidSource(result.source);
	});

	it("should honor the no-images format setting", async () => {
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(
			episode.id,
			formatSettings(EPUB_NO_IMAGES),
		);
		expect(result.source.type).toBe("Epub");
		if (result.source.type !== "Epub") throw new Error("Not an epub source");
		expect(result.source.link.url).toContain(".epub.noimages");
		expect(result.settings[FORMAT_SETTING_ID]).toBeDefined();
	});
});
