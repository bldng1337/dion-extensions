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
import { pathToFileUrl } from "./library.ts";

// End-to-end through the native runtime: configure the directory setting the
// same way the host's DirectoryPicker tile does (setSetting + storage grant)
// and check browse picks the library up.
describe("Extension with a configured library folder", () => {
	let extension: Extension;
	let libroot: string;

	beforeAll(async () => {
		libroot = mkdtempSync(join(tmpdir(), "dion-local-sources-"));
		writeFileSync(join(libroot, "Standalone.epub"), "x");
		writeFileSync(join(libroot, "notes.txt"), "hello");
		writeFileSync(join(libroot, "Song.mp3"), "x");
		writeFileSync(join(libroot, "Clip.mp4"), "x");
		writeFileSync(join(libroot, "Book.m4b"), "x");
		writeFileSync(join(libroot, "cover.jpg"), "x"); // unsupported, ignored
		const series = mkdirSync(join(libroot, "Series"), { recursive: true });
		writeFileSync(join(series!, "Chapter 1.epub"), "x");

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

	it("should browse the configured folder", async () => {
		const result = (await extension.browse(0, {})).entries;
		expect(result.content.map((entry) => entry.title).sort()).toEqual([
			"Book",
			"Clip",
			"Series",
			"Song",
			"Standalone",
			"notes",
		]);
		const byTitle = new Map(
			result.content.map((entry) => [entry.title, entry.media_type]),
		);
		expect(byTitle.get("Song")).toBe("Audio");
		expect(byTitle.get("Clip")).toBe("Video");
		expect(byTitle.get("Standalone")).toBe("Book");
		// An m4b is an audiobook, so it presents as audio rather than video.
		expect(byTitle.get("Book")).toBe("Audio");
	});

	it("should accept forward-slash paths too", async () => {
		await extension.setSetting("local_sources_directory", "Extension", {
			type: "String",
			data: libroot.replaceAll("\\", "/"),
		});
		const result = (await extension.browse(0, {})).entries;
		expect(result.content.length).toBe(6);
	});

	it("should serve mp3 and mp4 files as audio and video sources", async () => {
		// Restore the native path so the file:// url is deterministic.
		await extension.setSetting("local_sources_directory", "Extension", {
			type: "String",
			data: libroot,
		});
		const audio = await extension.source({ uid: "Song.mp3" }, {});
		// The runtime materializes Link.header as an explicit null on the wire.
		expect(audio.source).toEqual({
			type: "Audio",
			sources: [
				{
					name: "Local",
					lang: "",
					url: {
						url: pathToFileUrl(join(libroot, "Song.mp3")),
						header: null,
					},
				},
			],
			chapters: null,
		});

		const video = await extension.source({ uid: "Clip.mp4" }, {});
		expect(video.source).toEqual({
			type: "Video",
			sources: [
				{
					name: "Local",
					lang: "",
					url: {
						url: pathToFileUrl(join(libroot, "Clip.mp4")),
						header: null,
					},
				},
			],
			sub: [],
			chapters: null,
		});

		// An m4b rides the audio path like an mp3: a stream source with its
		// container's chapters, of which an untagged stub has none.
		const audiobook = await extension.source({ uid: "Book.m4b" }, {});
		expect(audiobook.source).toEqual({
			type: "Audio",
			sources: [
				{
					name: "Local",
					lang: "",
					url: {
						url: pathToFileUrl(join(libroot, "Book.m4b")),
						header: null,
					},
				},
			],
			chapters: null,
		});

		const song = await extension.detail({ uid: "Song.mp3" }, {});
		expect(song.entry.media_type).toBe("Audio");
		const clip = await extension.detail({ uid: "Clip.mp4" }, {});
		expect(clip.entry.media_type).toBe("Video");
		const book = await extension.detail({ uid: "Book.m4b" }, {});
		expect(book.entry.media_type).toBe("Audio");
		expect(book.entry.description).toContain("M4B file");
	});
});
