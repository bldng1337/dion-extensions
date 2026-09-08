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

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];

/** Finds the first browse/search result whose uid has the given prefix. */
function pick(entries: Entry[], prefix: string): Entry {
	const hit = entries.find((e) => e.id.uid.startsWith(prefix));
	if (!hit) {
		throw new Error(`No entry with prefix ${prefix} found`);
	}
	return hit;
}

async function searchFirst(prefix: string, query: string): Promise<Entry> {
	const result = await extension!.search(0, query);
	await assertValidEntries(result.content);
	return pick(result.content, prefix);
}

beforeAll(async () => {
	client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("Extension", () => {
	it("should start and declare its media types", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toEqual(
			expect.arrayContaining(["Book", "Comic", "Video"]),
		);
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"universe-meeps.leagueoflegends.com",
					"universe-comics.leagueoflegends.com",
					"cmsassets.rgpub.io",
				]),
			);
		}
	});
	it("should be able to browse the newest content", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(["Book", "Comic", "Video"]).toContain(entry.media_type);
			expect(entry.cover?.url).toStartWith("https://");
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);
	it("should paginate browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		expect(page1.content[0]!.id.uid).not.toBe(browseResult[0]!.id.uid);
		await assertValidEntries(page1.content);
	}, 120_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});
	it("should find a story, comic and video by search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const story = await searchFirst("story/", "troll boy");
		expect(story.media_type).toBe("Book");
		const comic = await searchFirst("comic/", "the burning lands");
		expect(comic.media_type).toBe("Comic");
		const video = await searchFirst("video/", "login theme");
		expect(video.media_type).toBe("Video");
	}, 120_000);
	it("should detail and source a story as paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const story = await searchFirst("story/", "troll boy");
		const result = await extension!.detail(story.id, {});
		await assertValidEntry(result.entry);
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.description.length).toBeGreaterThan(0);
		const source = await extension!.source(
			result.entry.episodes[0]!.id,
			(result.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(source.source);
		expect(source.source.type).toBe("Paragraphlist");
		if (source.source.type === "Paragraphlist") {
			expect(source.source.paragraphs.length).toBeGreaterThan(5);
			const texts = source.source.paragraphs.filter(
				(p) => p.type === "Text" && p.content.length > 0,
			);
			expect(texts.length).toBeGreaterThan(5);
		}
		expect(source.settings).toEqual(result.settings);
	}, 120_000);
	it("should detail and source a comic as an imagelist", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const comic = await searchFirst("comic/", "the burning lands");
		const result = await extension!.detail(comic.id, {});
		await assertValidEntry(result.entry);
		expect(result.entry.media_type).toBe("Comic");
		expect(result.entry.episodes.length).toBe(1);
		// detail() defines the per-entry image quality setting.
		expect(result.settings.comic_image_quality).toBeDefined();
		const source = await extension!.source(
			result.entry.episodes[0]!.id,
			(result.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(source.source);
		expect(source.source.type).toBe("Imagelist");
		if (source.source.type === "Imagelist") {
			expect(source.source.links.length).toBeGreaterThan(10);
			expect(source.source.links[0]!.url).toStartWith(
				"https://universe-comics.leagueoflegends.com/",
			);
		}
		expect(source.settings).toEqual(result.settings);
	}, 120_000);
	it("should detail a video with an external link and no episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const video = await searchFirst("video/", "login theme");
		const result = await extension!.detail(video.id, {});
		await assertValidEntry(result.entry);
		expect(result.entry.media_type).toBe("Video");
		expect(result.entry.episodes.length).toBe(0);
		expect(result.entry.ui).not.toBeNull();
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.cover?.url).toStartWith("https://");
	}, 120_000);
	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.source({ uid: "definitely-not-an-id" }, {}),
		).rejects.toThrow();
	});
});
