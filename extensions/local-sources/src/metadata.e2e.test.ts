/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/// <reference types="@types/bun" />
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	getTestExtension,
	MockManagerClient,
} from "@dion-js/extension-test-utils";
import type { Extension } from "@dion-js/runtime";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEpub, makeMp3, PNG } from "./fixtures.ts";

/** 400 MPEG frames ≈ 10.4 s of audio, enough for a duration to be derived. */
const TRACK_FRAMES = 400;

/**
 * The same end-to-end path as e2e.test.ts, but over containers that really
 * carry tags: the extension reads them back through the host's `metadata`
 * module, so these assert extracted titles, authors and covers rather than the
 * filename fallbacks.
 */
describe("Extension with tagged files", () => {
	let extension: Extension;
	let libroot: string;

	beforeAll(async () => {
		libroot = mkdtempSync(join(tmpdir(), "dion-local-sources-meta-"));
		writeFileSync(
			join(libroot, "standalone-book.epub"),
			makeEpub({
				title: "Pride and Prejudice",
				authors: ["Jane Austen"],
				publisher: "Penguin",
				language: "en",
				subjects: ["Romance", "England"],
				description: "A classic novel.",
				chapters: ["Chapter One", "Chapter Two"],
				cover: PNG,
			}),
		);
		writeFileSync(join(libroot, "notes.txt"), "no tags here\n");
		const album = mkdirSync(join(libroot, "Album"), { recursive: true });
		// Named so that filename order (a, b) disagrees with the track numbers
		// the tags claim (b = 1, a = 2).
		writeFileSync(
			join(album!, "a.mp3"),
			makeMp3(
				{
					title: "Second Track",
					artist: "The Band",
					album: "Greatest Hits",
					track: 2,
					genre: "Rock",
					year: "1999",
					cover: PNG,
				},
				TRACK_FRAMES,
			),
		);
		writeFileSync(
			join(album!, "b.mp3"),
			makeMp3(
				{
					title: "First Track",
					artist: "The Band",
					album: "Greatest Hits",
					track: 1,
					genre: "Rock",
					year: "1999",
					cover: PNG,
				},
				TRACK_FRAMES,
			),
		);
		// 3000 frames ≈ 1.25 MB, over a 1 MB limit but under the 32 MB default.
		writeFileSync(
			join(libroot, "long-track.mp3"),
			makeMp3({ title: "A Very Long Track", artist: "Solo" }, 3000),
		);
		// Two untaggable files ahead of the one tagged file, to show that the
		// per-folder budget counts reads rather than files.
		const mixed = mkdirSync(join(libroot, "Mixed"), { recursive: true });
		writeFileSync(join(mixed!, "a.pdf"), "%PDF-1.4 not really a pdf");
		writeFileSync(join(mixed!, "b.pdf"), "%PDF-1.4 not really a pdf");
		writeFileSync(
			join(mixed!, "c.mp3"),
			makeMp3({ title: "The Only Tagged One", artist: "Solo" }, TRACK_FRAMES),
		);

		const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
		extension = await getTestExtension(client.client);
		await extension.setEnabled(true);
		await extension.setSetting("local_sources_directory", "Extension", {
			type: "String",
			data: libroot,
		});
		await extension.requestPermission({
			type: "Storage",
			path: libroot,
			write: false,
		});
	});

	afterAll(() => {
		if (libroot !== undefined) {
			rmSync(libroot, { recursive: true, force: true });
		}
	});

	it("should take a book's title, author and tags from its EPUB", async () => {
		const { entry } = await extension.detail(
			{ uid: "standalone-book.epub" },
			{},
		);
		expect(entry.titles).toEqual(["Pride and Prejudice"]);
		expect(entry.author).toEqual(["Jane Austen"]);
		expect(entry.language).toBe("en");
		expect(entry.genres).toEqual(["Romance", "England"]);
		expect(entry.media_type).toBe("Book");
		expect(entry.description).toContain("Jane Austen");
		expect(entry.description).toContain("Penguin");
		expect(entry.description).toContain("A classic novel.");
	});

	it("should link the cover of a file that has one", async () => {
		const { entry } = await extension.detail({ uid: "Album/" }, {});
		expect(entry.cover?.url).toContain("/cover?path=");
		expect(entry.cover?.url.endsWith(encodeURIComponent("Album/a.mp3"))).toBe(
			true,
		);
		// A book's artwork fills both the cover and the poster slot.
		const book = await extension.detail({ uid: "standalone-book.epub" }, {});
		expect(book.entry.poster?.url).toBe(book.entry.cover?.url);
	});

	it("should serve those cover bytes over the proxy", async () => {
		const { entry } = await extension.detail(
			{ uid: "standalone-book.epub" },
			{},
		);
		const response = await fetch(entry.cover!.url!);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(Array.from(bytes)).toEqual(Array.from(PNG));
	});

	it("should name a folder after the album its files agree on", async () => {
		const { entry } = await extension.detail({ uid: "Album/" }, {});
		expect(entry.titles).toEqual(["Greatest Hits"]);
		expect(entry.author).toEqual(["The Band"]);
		expect(entry.media_type).toBe("Audio");
		expect(entry.genres).toEqual(["Rock"]);
	});

	it("should order episodes by their track number", async () => {
		const { entry } = await extension.detail({ uid: "Album/" }, {});
		expect(entry.episodes.map((episode) => episode.id.uid)).toEqual([
			"Album/b.mp3",
			"Album/a.mp3",
		]);
		expect(entry.episodes.map((episode) => episode.name)).toEqual([
			"First Track",
			"Second Track",
		]);
		expect(entry.episodes.map((episode) => episode.description)).toEqual([
			"Track 1",
			"Track 2",
		]);
	});

	it("should use a single file's own tags", async () => {
		const { entry } = await extension.detail({ uid: "Album/b.mp3" }, {});
		expect(entry.titles).toEqual(["First Track"]);
		expect(entry.author).toEqual(["The Band"]);
		expect(entry.description).toContain("0:10");
	});

	it("should keep reading untagged files by name", async () => {
		const { entry } = await extension.detail({ uid: "notes.txt" }, {});
		expect(entry.titles).toEqual(["notes"]);
		expect(entry.author).toBeNull();
		expect(entry.cover).toBeNull();
		expect(entry.genres).toEqual([]);
		expect(entry.description).toContain("TXT file");
	});

	it("should hand tagged audio to the player without chapters", async () => {
		const result = await extension.source({ uid: "Album/b.mp3" }, {});
		expect(result.source.type).toBe("Audio");
		if (result.source.type !== "Audio") throw new Error("expected audio");
		expect(result.source.chapters).toBeNull();
	});

	it("should reuse the tags it already read when browsing", async () => {
		const { content } = await extension.browse(0);
		const byUid = new Map(content.map((entry) => [entry.id.uid, entry]));
		expect(byUid.get("standalone-book.epub")?.title).toBe(
			"Pride and Prejudice",
		);
		expect(byUid.get("standalone-book.epub")?.cover?.url).toContain(
			"/cover?path=",
		);
		expect(byUid.get("notes.txt")?.title).toBe("notes");
		// A folder is listed under the album its files agree on, like detail.
		expect(byUid.get("Album/")?.title).toBe("Greatest Hits");
		expect(byUid.get("Album/")?.author).toEqual(["The Band"]);
		expect(byUid.get("Album/")?.cover?.url).toContain("Album");
	});

	it("should find a file by the name its tags give it", async () => {
		// Works because the browse above already read those tags: search never
		// reads a file itself, it matches what is already known.
		const found = await extension.search(0, "greatest");
		expect(found.content.map((entry) => entry.id.uid)).toEqual(["Album/"]);
		const book = await extension.search(0, "pride");
		expect(book.content.map((entry) => entry.id.uid)).toEqual([
			"standalone-book.epub",
		]);
	});

	it("should skip files larger than the configured limit", async () => {
		await extension.setSetting("local_sources_metadata_size", "Extension", {
			type: "Number",
			data: 1,
		});
		const skipped = await extension.detail({ uid: "long-track.mp3" }, {});
		expect(skipped.entry.titles).toEqual(["long-track"]);

		await extension.setSetting("local_sources_metadata_size", "Extension", {
			type: "Number",
			data: 32,
		});
		const read = await extension.detail({ uid: "long-track.mp3" }, {});
		expect(read.entry.titles).toEqual(["A Very Long Track"]);
	});

	it("should read only as many files per folder as configured", async () => {
		await extension.setSetting("local_sources_metadata_files", "Extension", {
			type: "String",
			data: "1",
		});
		const { entry } = await extension.detail({ uid: "Album/" }, {});
		// Only the first file in scan order is read, so the album is still known
		// but b.mp3 keeps its filename — and with one untagged episode left,
		// there is no track order to fall back on.
		expect(entry.titles).toEqual(["Greatest Hits"]);
		expect(entry.episodes.map((episode) => episode.name)).toEqual([
			"Second Track",
			"b",
		]);

		await extension.setSetting("local_sources_metadata_files", "Extension", {
			type: "String",
			data: "25",
		});
	});

	it("should not spend the per-folder budget on files with no tags", async () => {
		await extension.setSetting("local_sources_metadata_files", "Extension", {
			type: "String",
			data: "1",
		});
		const { entry } = await extension.detail({ uid: "Mixed/" }, {});
		expect(entry.titles).toEqual(["Mixed"]);
		// The two PDFs are skipped without being read, so the one file that
		// could be read within the budget still is.
		expect(entry.episodes.map((episode) => episode.name)).toEqual([
			"a",
			"b",
			"The Only Tagged One",
		]);

		await extension.setSetting("local_sources_metadata_files", "Extension", {
			type: "String",
			data: "25",
		});
	});

	it("should stop reading files when metadata is switched off", async () => {
		await extension.setSetting("local_sources_metadata", "Extension", {
			type: "Boolean",
			data: false,
		});
		const { entry } = await extension.detail(
			{ uid: "standalone-book.epub" },
			{},
		);
		expect(entry.titles).toEqual(["standalone-book"]);
		expect(entry.cover).toBeNull();
		expect(entry.author).toBeNull();
		expect(entry.genres).toEqual([]);

		// Back on, so the toggle does not leak into other tests.
		await extension.setSetting("local_sources_metadata", "Extension", {
			type: "Boolean",
			data: true,
		});
	});
});
