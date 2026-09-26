/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	getTestExtension,
	MockManagerClient,
} from "@dion-js/extension-test-utils";
import type { Extension } from "@dion-js/runtime";
import { join } from "node:path";
import {
	carriesMetadata,
	filterByTitle,
	filesFromListing,
	humanSize,
	kindForFilename,
	mediaTypeForFiles,
	naturalCompare,
	orderEpisodes,
	paginate,
	pathToFileUrl,
	scanLibrary,
	textToParagraphs,
	titleFromFilename,
	type Listing,
	type ReadDirFn,
	type TrackTag,
} from "./library.ts";

// ---------------------------------------------------------------------------
// Library helpers (pure)
// ---------------------------------------------------------------------------

const file = (name: string) => ({ name, isDir: false });
const folder = (name: string) => ({ name, isDir: true });

/** In-memory readDir over a map of directory path → listing. */
function fakeFs(listings: Record<string, Listing>) {
	const visited: string[] = [];
	const readDir: ReadDirFn = async (path) => {
		visited.push(path);
		const listing = listings[path];
		if (listing === undefined) throw new Error(`ENOENT: ${path}`);
		return listing;
	};
	return { readDir, visited };
}

const ROOT_LISTING: Record<string, Listing> = {
	"/lib": [
		file("cover.jpg"),
		file(".hidden.epub"),
		folder(".git"),
		folder("empty-dir"),
		file("Notes.txt"),
		file("Standalone Novel.epub"),
		folder("Series A"),
		folder("Album"),
		folder("Deep"),
	],
	"/lib/Series A": [
		file("Chapter 10.epub"),
		file("Chapter 2.epub"),
		file("Chapter 1.epub"),
		file("cover.jpg"),
		folder("Extras"),
	],
	"/lib/Album": [
		file("track 02.mp3"),
		file("track 01.mp3"),
		file("trailer.mp4"),
	],
	"/lib/Series A/Extras": [file("bonus.pdf")],
	"/lib/Deep": [folder("OnlyDirs")],
	"/lib/Deep/OnlyDirs": [file("Book Two.pdf")],
	"/lib/empty-dir": [],
};

describe("naming helpers", () => {
	it("should detect supported file kinds", () => {
		expect(kindForFilename("Book.EPUB")).toBe("epub");
		expect(kindForFilename("scan.PDF")).toBe("pdf");
		expect(kindForFilename("notes.txt")).toBe("txt");
		expect(kindForFilename("song.MP3")).toBe("mp3");
		expect(kindForFilename("movie.mp4")).toBe("mp4");
		expect(kindForFilename("cover.jpg")).toBeNull();
		expect(kindForFilename("cover")).toBeNull();
		expect(kindForFilename("archive.zip")).toBeNull();
	});

	it("should know which kinds can carry tags", () => {
		expect(carriesMetadata("epub")).toBe(true);
		expect(carriesMetadata("mp3")).toBe(true);
		expect(carriesMetadata("mp4")).toBe(true);
		// Nothing to read inside a PDF or a text file.
		expect(carriesMetadata("pdf")).toBe(false);
		expect(carriesMetadata("txt")).toBe(false);
	});

	it("should derive titles from filenames", () => {
		expect(titleFromFilename("Pride and Prejudice.epub")).toBe(
			"Pride and Prejudice",
		);
		expect(titleFromFilename("Vol. 2.pdf")).toBe("Vol. 2");
		expect(titleFromFilename("No Extension")).toBe("No Extension");
		expect(titleFromFilename(".hidden.epub")).toBe(".hidden");
	});

	it("should build file:// urls in Dion's local-file wire format", () => {
		expect(pathToFileUrl("/home/user/my book.epub")).toBe(
			"file:///home/user/my book.epub",
		);
		expect(pathToFileUrl("C:\\Users\\user\\book.pdf")).toBe(
			"file://C:\\Users\\user\\book.pdf",
		);
	});

	it("should sort naturally so numbers read in order", () => {
		const names = ["Chapter 10", "chapter 2", "Chapter 1", "Appendix"];
		expect([...names].sort(naturalCompare)).toEqual([
			"Appendix",
			"Chapter 1",
			"chapter 2",
			"Chapter 10",
		]);
		// Numerically equal runs tie; length breaks the tie deterministically.
		expect(naturalCompare("ch 2", "ch 02")).toBeLessThan(0);
		expect(naturalCompare("ch 02", "ch 2")).toBeGreaterThan(0);
		expect(naturalCompare("abc", "abd")).toBeLessThan(0);
		expect(naturalCompare("ABC", "abd")).toBeLessThan(0);
	});
});

describe("scanLibrary", () => {
	it("should group loose files and folders into entries", async () => {
		const { readDir } = fakeFs(ROOT_LISTING);
		const entries = await scanLibrary("/lib", readDir);
		expect(entries.map((entry) => entry.title)).toEqual([
			"Album",
			"Extras",
			"Notes",
			"OnlyDirs",
			"Series A",
			"Standalone Novel",
		]);
		expect(entries.map((entry) => entry.uid)).toEqual([
			"Album/",
			"Series A/Extras/",
			"Notes.txt",
			"Deep/OnlyDirs/",
			"Series A/",
			"Standalone Novel.epub",
		]);

		const series = entries.find((entry) => entry.title === "Series A");
		expect(series?.isFolder).toBe(true);
		expect(series?.files.map((f) => f.title)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 10",
		]);
		expect(series?.files.map((f) => f.rel)).toEqual([
			"Series A/Chapter 1.epub",
			"Series A/Chapter 2.epub",
			"Series A/Chapter 10.epub",
		]);

		const notes = entries.find((entry) => entry.title === "Notes");
		expect(notes?.isFolder).toBe(false);
		expect(notes?.files).toEqual([
			{ rel: "Notes.txt", title: "Notes", kind: "txt" },
		]);

		const extras = entries.find((entry) => entry.title === "Extras");
		expect(extras?.uid).toBe("Series A/Extras/");
		expect(extras?.files[0]?.kind).toBe("pdf");

		const album = entries.find((entry) => entry.title === "Album");
		expect(album?.files.map((f) => f.rel)).toEqual([
			"Album/track 01.mp3",
			"Album/track 02.mp3",
			"Album/trailer.mp4",
		]);
	});

	it("should ignore hidden, empty and unsupported content", async () => {
		const { readDir, visited } = fakeFs(ROOT_LISTING);
		const entries = await scanLibrary("/lib", readDir);
		expect(entries.some((entry) => entry.title.includes("cover"))).toBe(false);
		expect(entries.some((entry) => entry.title.includes("hidden"))).toBe(false);
		expect(entries.some((entry) => entry.title === "empty-dir")).toBe(false);
		expect(entries.some((entry) => entry.title === "Deep")).toBe(false);
		expect(visited).not.toContain("/lib/.git");
	});

	it("should propagate read errors", async () => {
		const { readDir } = fakeFs({});
		await expect(scanLibrary("/missing", readDir)).rejects.toThrow("ENOENT");
	});
});

describe("filesFromListing", () => {
	it("should keep only supported files, naturally sorted", () => {
		const listing: Listing = [
			folder("subdir"),
			file("b.txt"),
			file(".dotfile"),
			file("a 10.epub"),
			file("a 2.epub"),
			file("image.png"),
		];
		const files = filesFromListing("dir", listing);
		expect(files.map((f) => f.rel)).toEqual([
			"dir/a 2.epub",
			"dir/a 10.epub",
			"dir/b.txt",
		]);
	});
});

describe("orderEpisodes", () => {
	const track = (rel: string) => ({ rel, title: rel, kind: "mp3" }) as const;
	const files = [track("a.mp3"), track("b.mp3"), track("c.mp3")];

	it("should order by disc then track when every file is tagged", () => {
		const tagged: Record<string, TrackTag> = {
			"a.mp3": { disc: 2, track: 1 },
			"b.mp3": { disc: 1, track: 2 },
			"c.mp3": { disc: 1, track: 1 },
		};
		expect(
			orderEpisodes([...files], (file) => tagged[file.rel]).map((f) => f.rel),
		).toEqual(["c.mp3", "b.mp3", "a.mp3"]);
	});

	it("should break track ties by name, so the order is stable", () => {
		const same: Record<string, TrackTag> = {
			"a.mp3": { track: 1 },
			"b.mp3": { track: 1 },
			"c.mp3": { track: 1 },
		};
		expect(
			orderEpisodes([...files], (file) => same[file.rel]).map((f) => f.rel),
		).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
	});

	it("should keep the scan's order when a file has no track number", () => {
		const partial: Record<string, TrackTag> = {
			"a.mp3": { track: 2 },
			"c.mp3": { track: 1 },
		};
		const ordered = orderEpisodes(files, (file) => partial[file.rel]);
		expect(ordered.map((f) => f.rel)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
		// Nothing was reordered, so the scan's own array is handed back.
		expect(ordered).toBe(files);
	});

	it("should leave an untagged library alone", () => {
		expect(orderEpisodes([...files], () => undefined)).toEqual(files);
		expect(orderEpisodes([], () => undefined)).toEqual([]);
	});
});

describe("media types", () => {
	const of = (kind: "epub" | "pdf" | "txt" | "mp3" | "mp4") => ({
		rel: `f.${kind}`,
		title: "f",
		kind,
	});

	it("should pick the entry media type from the contained files", () => {
		expect(mediaTypeForFiles([])).toBe("Book");
		expect(mediaTypeForFiles([of("epub"), of("txt")])).toBe("Book");
		expect(mediaTypeForFiles([of("epub"), of("mp3")])).toBe("Audio");
		expect(mediaTypeForFiles([of("mp3"), of("mp4")])).toBe("Video");
		expect(mediaTypeForFiles([of("mp4"), of("mp3"), of("epub")])).toBe("Video");
	});
});

describe("paging and searching", () => {
	it("should paginate", () => {
		const items = Array.from({ length: 75 }, (_, i) => i);
		expect(paginate(items, 0)).toEqual({
			content: items.slice(0, 30),
			hasnext: true,
		});
		expect(paginate(items, 1).content[0]).toBe(30);
		expect(paginate(items, 2)).toEqual({
			content: items.slice(60, 75),
			hasnext: false,
		});
		expect(paginate(items, 3)).toEqual({ content: [], hasnext: false });
		expect(paginate(items, -1).content.length).toBe(30);
	});

	it("should filter titles case-insensitively", () => {
		const items = [
			{ title: "Pride" },
			{ title: "prejudice" },
			{ title: "Emma" },
		];
		expect(filterByTitle(items, "de")).toEqual([{ title: "Pride" }]);
		expect(filterByTitle(items, "  pr  ")).toEqual([
			{ title: "Pride" },
			{ title: "prejudice" },
		]);
		expect(filterByTitle(items, "")).toEqual([]);
		expect(filterByTitle(items, "zzz")).toEqual([]);
	});
});

describe("presentation helpers", () => {
	it("should format sizes", () => {
		expect(humanSize(512)).toBe("512 B");
		expect(humanSize(1536)).toBe("1.5 KB");
		expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
		expect(humanSize(10 * 1024 * 1024)).toBe("10 MB");
	});

	it("should split text into reflowable paragraphs", () => {
		const text =
			"Para one\r\nwrapped line.\r\n\r\nPara two.\n\n\n   \nPara three.";
		expect(textToParagraphs(text)).toEqual([
			{ type: "Text", content: "Para one wrapped line.", style: null },
			{ type: "Text", content: "Para two.", style: null },
			{ type: "Text", content: "Para three.", style: null },
		]);
		expect(textToParagraphs("   \n\n  ")).toEqual([]);
		expect(textToParagraphs("single")).toEqual([
			{ type: "Text", content: "single", style: null },
		]);
	});
});

// ---------------------------------------------------------------------------
// Extension (through the native test runtime)
// ---------------------------------------------------------------------------

let extension: Extension;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		// ExtensionData.media_type comes back in non-deterministic order.
		expect([...data.media_type].sort()).toEqual(["Audio", "Book", "Video"]);
		const provider = data.extension_type.find(
			(variant) => variant.type === "EntryProvider",
		);
		expect(provider).toEqual({ type: "EntryProvider", has_search: true });
	});

	it("should not declare network permissions", async () => {
		const data = await extension!.getData();
		expect(data.permissions?.length ?? 0).toBe(0);
	});

	it("should browse to an empty list while no folder is configured", async () => {
		const result = await extension!.browse(0);
		expect(result.content).toEqual([]);
		expect(result.hasnext).toBe(false);
	});

	it("should search to an empty list while no folder is configured", async () => {
		expect((await extension!.search(0, "anything")).content).toEqual([]);
		expect((await extension!.search(0, "   ")).content).toEqual([]);
	});

	it("should reject detail while no folder is configured", async () => {
		await expect(
			extension!.detail({ uid: "Some Series/" }, {}),
		).rejects.toThrow("No library folder configured");
	});

	it("should reject source while no folder is configured", async () => {
		await expect(extension!.source({ uid: "file.epub" }, {})).rejects.toThrow(
			"No library folder configured",
		);
	});
});
