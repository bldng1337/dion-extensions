/// <reference types="@types/bun" />
import { describe, expect, it } from "bun:test";
import type { EpubMetadata, Mp4Metadata } from "metadata";
import {
	commonAlbum,
	collectAuthors,
	collectGenres,
	describeMetadata,
	episodeName,
	episodeTrackLabel,
	formatDuration,
	isCachedMeta,
	isSafeRelPath,
	normalizeMetadata,
	parseCoverPath,
	sniffImageType,
	sourceChapters,
	type FileMeta,
} from "./metadata.ts";

/** An MP4 snapshot with every tag filled in. */
const MP4: Mp4Metadata = {
	type: "mp4",
	title: "A Video",
	artist: "Track Artist",
	album: "A Series",
	albumArtist: "The Studio",
	year: "2020",
	genre: "Documentary",
	track: 3,
	trackTotal: 12,
	disc: 2,
	discTotal: 2,
	durationMs: 3_723_000,
	description: "A film.",
	chapters: [
		{ title: "Intro", startMs: 0, durationMs: 60_000 },
		{ title: "Middle", startMs: 60_000, durationMs: 3_663_000 },
		{ startMs: 3_723_000 },
	],
	artwork: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
};

const EMPTY: FileMeta = {
	kind: "audio",
	authors: [],
	genres: [],
	hasCover: false,
	contentsCount: 0,
	chapters: [],
};

describe("normalizeMetadata", () => {
	it("should flatten an mp4 snapshot", () => {
		expect(normalizeMetadata(MP4)).toEqual({
			kind: "mp4",
			title: "A Video",
			// The album artist speaks for the whole series, so it leads.
			authors: ["The Studio", "Track Artist"],
			album: "A Series",
			publisher: undefined,
			description: "A film.",
			language: undefined,
			genres: ["Documentary"],
			year: "2020",
			track: 3,
			trackTotal: 12,
			disc: 2,
			discTotal: 2,
			durationMs: 3_723_000,
			hasCover: true,
			contentsCount: 0,
			chapters: [
				{ title: "Intro", startMs: 0, durationMs: 60_000 },
				{ title: "Middle", startMs: 60_000, durationMs: 3_663_000 },
				{ title: "", startMs: 3_723_000, durationMs: undefined },
			],
		});
	});

	it("should keep every creator of a book and count its contents", () => {
		const epub: EpubMetadata = {
			type: "epub",
			title: "  A Book  ",
			creators: [
				{ name: "Jane Austen", roles: [] },
				{ name: "Jane Austen", roles: ["edt"] },
				{ name: "  ", roles: [] },
			],
			publishers: ["Penguin", "Penguin Classics"],
			languages: ["en", "fr"],
			published: "2021-04-05",
			description: "A classic.",
			identifiers: [],
			subjects: ["Romance", "Romance", " "],
			coverPath: "/OEBPS/cover.png",
			resources: [],
			toc: [{ title: "One", path: "/OEBPS/1" }, { path: "/OEBPS/2" }],
			spine: [],
		};
		const meta = normalizeMetadata(epub);
		expect(meta).toEqual({
			kind: "epub",
			title: "A Book",
			authors: ["Jane Austen"],
			album: undefined,
			publisher: "Penguin",
			description: "A classic.",
			language: "en",
			genres: ["Romance"],
			year: "2021",
			track: undefined,
			trackTotal: undefined,
			disc: undefined,
			discTotal: undefined,
			durationMs: undefined,
			hasCover: true,
			contentsCount: 2,
			chapters: [],
		});
	});

	it("should report no metadata for a book without a cover", () => {
		const epub: EpubMetadata = {
			type: "epub",
			creators: [],
			publishers: [],
			languages: [],
			identifiers: [],
			subjects: [],
			resources: [],
			toc: [],
			spine: [],
		};
		expect(normalizeMetadata(epub)).toMatchObject({
			title: undefined,
			authors: [],
			hasCover: false,
			contentsCount: 0,
		});
	});

	it("should drop a plain archive", () => {
		expect(
			normalizeMetadata({
				type: "archive",
				entries: [{ path: "a.png", size: 3, isDir: false }],
			}),
		).toBeNull();
	});
});

describe("presentation", () => {
	it("should format durations", () => {
		expect(formatDuration(0)).toBe("0:00");
		expect(formatDuration(1_049)).toBe("0:01");
		expect(formatDuration(65_000)).toBe("1:05");
		expect(formatDuration(3_600_000)).toBe("1:00:00");
		expect(formatDuration(3_723_000)).toBe("1:02:03");
	});

	it("should describe what a file says about itself", () => {
		const meta = normalizeMetadata(MP4) ?? undefined;
		expect(describeMetadata(meta, true)).toBe(
			"The Studio, Track Artist • A Series • 2020 • Documentary • 3 chapters • 1:02:03",
		);
		// A folder is described by what its files agree on, not by the length
		// of whichever episode happened to be read first.
		expect(describeMetadata(meta, false)).toBe(
			"The Studio, Track Artist • A Series • 2020 • Documentary",
		);
		expect(describeMetadata(undefined, true)).toBe("");
		expect(describeMetadata(EMPTY, true)).toBe("");
	});

	it("should name episodes after their tags", () => {
		const meta = normalizeMetadata(MP4) ?? undefined;
		expect(episodeName(meta, "a.mp4")).toBe("A Video");
		expect(episodeName(undefined, "a.mp4")).toBe("a.mp4");
		expect(episodeName(meta, "fallback")).not.toBe("fallback");
	});

	it("should label tracks, and discs when there is more than one", () => {
		expect(episodeTrackLabel({ ...EMPTY, track: 3 })).toBe("Track 3");
		expect(episodeTrackLabel({ ...EMPTY, track: 3, disc: 1 })).toBe("Track 3");
		expect(episodeTrackLabel({ ...EMPTY, track: 3, disc: 2 })).toBe(
			"Disc 2, Track 3",
		);
		expect(episodeTrackLabel(EMPTY)).toBeNull();
		expect(episodeTrackLabel(undefined)).toBeNull();
	});

	it("should only call an album shared when every file agrees", () => {
		const one = { ...EMPTY, album: "Greatest Hits" };
		const other = { ...EMPTY, album: "Another Record" };
		expect(commonAlbum([one, one])).toBe("Greatest Hits");
		expect(commonAlbum([one, other])).toBeUndefined();
		expect(commonAlbum([one, undefined])).toBe("Greatest Hits");
		expect(commonAlbum([EMPTY, undefined])).toBeUndefined();
		expect(commonAlbum([])).toBeUndefined();
	});

	it("should gather the first authors and every genre", () => {
		const first = { ...EMPTY, authors: ["The Band"], genres: ["Rock"] };
		const second = {
			...EMPTY,
			authors: ["Someone Else"],
			genres: ["Rock", "Pop"],
		};
		expect(collectAuthors([undefined, first, second])).toEqual(["The Band"]);
		expect(collectAuthors([undefined, EMPTY])).toBeNull();
		expect(collectGenres([first, second, undefined])).toEqual(["Rock", "Pop"]);
		expect(collectGenres([])).toEqual([]);
	});
});

describe("chapters", () => {
	it("should convert container chapters to seconds", () => {
		const meta = normalizeMetadata(MP4) ?? undefined;
		expect(sourceChapters(meta)).toEqual([
			{ title: "Intro", start: 0, end: 60, kind: null },
			{ title: "Middle", start: 60, end: 3723, kind: null },
			{ title: "", start: 3723, end: null, kind: null },
		]);
	});

	it("should keep chapter positions that fall between seconds", () => {
		const meta: FileMeta = {
			...EMPTY,
			chapters: [
				{ title: "a", startMs: 1_500, durationMs: 400 },
				{ title: "b", startMs: 1_900, durationMs: 1_100 },
			],
		};
		// Rounding to whole seconds would collapse these two onto the same point.
		expect(sourceChapters(meta)).toEqual([
			{ title: "a", start: 1.5, end: 1.9, kind: null },
			{ title: "b", start: 1.9, end: 3, kind: null },
		]);
	});

	it("should report no chapters rather than an empty list", () => {
		expect(sourceChapters(undefined)).toBeNull();
		expect(sourceChapters(EMPTY)).toBeNull();
	});
});

describe("cover proxy plumbing", () => {
	it("should read the path out of a cover request", () => {
		expect(parseCoverPath("/cover?path=Album%2Fa.mp3")).toBe("Album/a.mp3");
		expect(parseCoverPath("/extproxy/1-2-3/cover?a=1&path=book.epub")).toBe(
			"book.epub",
		);
		expect(parseCoverPath("/cover?path=")).toBeNull();
		expect(parseCoverPath("/cover")).toBeNull();
		expect(parseCoverPath("/cover?other=1")).toBeNull();
		expect(parseCoverPath("/cover?path=%E0%A4%A")).toBeNull();
	});

	it("should refuse anything that could climb out of the library", () => {
		expect(isSafeRelPath("Album/a.mp3")).toBe(true);
		expect(isSafeRelPath("a b.mp3")).toBe(true);
		expect(isSafeRelPath("")).toBe(false);
		expect(isSafeRelPath("../secrets.epub")).toBe(false);
		expect(isSafeRelPath("Album/../../secrets.epub")).toBe(false);
		expect(isSafeRelPath("Album//a.mp3")).toBe(false);
		expect(isSafeRelPath("./a.mp3")).toBe(false);
		expect(isSafeRelPath("/etc/passwd")).toBe(false);
		expect(isSafeRelPath("..\\secrets.epub")).toBe(false);
		expect(isSafeRelPath("C:\\secrets.epub")).toBe(false);
	});

	it("should sniff the type of embedded artwork", () => {
		expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
			"image/jpeg",
		);
		expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
			"image/png",
		);
		expect(
			sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
		).toBe("image/gif");
		expect(
			sniffImageType(
				new Uint8Array([
					0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
				]),
			),
		).toBe("image/webp");
		expect(sniffImageType(new Uint8Array([0x00, 0x01, 0x02]))).toBe(
			"application/octet-stream",
		);
		expect(sniffImageType(new Uint8Array([0x89]))).toBe(
			"application/octet-stream",
		);
	});

	it("should recognise a cache envelope and nothing else", () => {
		expect(isCachedMeta({ meta: null })).toBe(true);
		expect(isCachedMeta({ meta: EMPTY })).toBe(true);
		expect(isCachedMeta(null)).toBe(false);
		expect(isCachedMeta(undefined)).toBe(false);
		expect(isCachedMeta(EMPTY)).toBe(false);
		expect(isCachedMeta("meta")).toBe(false);
	});
});
