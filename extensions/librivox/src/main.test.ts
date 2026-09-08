/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	Adapter,
	ExtensionClient,
	type Extension,
	ManagerClient,
} from "@dion-js/runtime";
import type {
	Entry,
	EntryDetailedResult,
	ExtensionData,
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";

// Same shape as @dion-js/extension-test-utils' MockManagerClient, but passes
// the setEntrySetting/storeSet callbacks the current ExtensionClient requires.
function makeManager(basepath: string): ManagerClient {
	return new ManagerClient(
		(_err: Error | null, extdata: ExtensionData) =>
			new ExtensionClient(
				() => "",
				() => {},
				() => {},
				// Grant network permission prompts, as a user would on install.
				() => true,
				() => `${basepath}/${extdata.name}`,
				() => {},
				() => {},
			),
		() => basepath,
	);
}

let extension: Extension;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const adapter = await Adapter.init(
		makeManager(join(import.meta.path, "../../.dist")),
	);
	const ext = (await adapter.getExtensions())[0];
	if (ext === undefined) {
		throw new Error("Extension couldnt be loaded! Maybe build failed?");
	}
	extension = ext;
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Audio");
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"librivox.org",
					"archive.org",
					"www.archive.org",
				]),
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
			expect(entry.media_type).toBe("Audio");
			expect(entry.cover?.url).toStartWith("https://archive.org/");
		}
		browseResult = result.content;
	}, 60_000);
	it("should be able to search by title and author", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "sherlock holmes");
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
		}
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
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBeGreaterThan(0);
		expect(result.entry.description.length).toBeGreaterThan(0);
		detailResult = result;
	}, 120_000);
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBeGreaterThan(0);
			expect(result.source.sources[0]!.url.url).toMatch(/\.mp3$/);
		}
		expect(result.settings).toEqual(detailResult.settings);
	}, 60_000);
	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	}, 30_000);
});
