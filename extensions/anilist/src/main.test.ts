/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	Adapter,
	ExtensionClient,
	ManagerClient,
	type Extension,
} from "@dion-js/runtime";
import type {
	EntryDetailed,
	EntryDetailedResult,
	ExtensionData,
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
				() => false,
				() => `${basepath}/${extdata.name}`,
				() => {},
				() => {},
			),
		() => basepath,
	);
}

let extension: Extension;

let mapResult: EntryDetailedResult;

const sampleEntry: EntryDetailed = {
	id: { uid: "test-entry-1" },
	url: "https://example.com/entry/test-entry-1",
	titles: ["Test Entry"],
	media_type: "Video",
	status: "Releasing",
	description: "A test entry",
	language: "en",
	episodes: [],
};

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
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"anilist.co",
					"graphql.anilist.co",
					"s4.anilist.co",
					"placehold.co",
				]),
			);
		}
	});
	it("should map entries", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.mapEntry(sampleEntry, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(sampleEntry.id.uid);
		// Friends UI is attached by default (show_friends = true)
		expect(result.entry.ui).not.toBeNull();
		mapResult = result;
	});
	it("should echo settings back", async () => {
		if (mapResult === undefined) throw new Error("No mapEntry result");
		expect(mapResult.settings["anilist_media"]).toBeDefined();
	});
});
