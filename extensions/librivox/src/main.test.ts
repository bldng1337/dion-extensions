/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { describe, expect, it } from "bun:test";
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

let browseResult: Entry[] = [];
let detailResult: EntryDetailedResult;

// The detail/source tests below need librivox.org to be reachable from the
// runtime. Probe it with a few rapid detail calls (rss/1342 is a stable
// feed) because the site throttles bursts, and skip them (instead of
// failing) while it blocks or rate-limits us; browse/search go through
// archive.org and always run.
let siteUp = true;
{
	const adapter = await Adapter.init(
		makeManager(join(import.meta.path, "../../.dist")),
	);
	const ext = (await adapter.getExtensions())[0];
	if (ext === undefined) {
		throw new Error("Extension couldnt be loaded! Maybe build failed?");
	}
	extension = ext;
	const probe = (async () => {
		await ext.setEnabled(true);
		const browse = (await ext.browse(0, {})).entries;
		let resolved = false;
		for (const entry of browse.content.slice(0, 3)) {
			try {
				const candidate = await ext.detail(entry.id, {});
				if (candidate.entry.episodes.length > 0) {
					resolved = true;
					break;
				}
			} catch {
				// Newest additions may have no feed yet; try the next one.
			}
		}
		if (!resolved) throw new Error("no entry resolved a chaptered feed");
	})();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			probe,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("probe timed out")), 60_000);
			}),
		]);
	} catch (e) {
		siteUp = false;
		console.warn(
			`[librivox] skipping live Extension tests: site unreachable via runtime (${e instanceof Error ? e.message : String(e)})`,
		);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
	probe.catch(() => {});
}

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
		const result = (await extension!.browse(0, {})).entries;
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
		const result = (await extension!.search(0, "sherlock holmes", {})).entries;
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
		}
	}, 60_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = (await extension!.search(0, "   ", {})).entries;
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);
	it.skipIf(!siteUp)(
		"should be able to detail",
		async () => {
			if (extension.enabled === false) throw new Error("Extension not enabled");
			if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
				throw new Error("No browse result");
			// The newest items in the addeddate-desc listing sometimes have feeds
			// LibriVox has not generated yet (the RSS endpoint redirects), so walk
			// the first few entries until one resolves with chapters.
			let detailed: Entry | undefined;
			let result: EntryDetailedResult | undefined;
			for (const entry of browseResult.slice(0, 5)) {
				const candidate = await extension!.detail(entry.id, {});
				if (candidate.entry.episodes.length > 0) {
					detailed = entry;
					result = candidate;
					break;
				}
			}
			expect(result).toBeDefined();
			expect(result!.entry.id.uid).toBe(detailed!.id.uid);
			expect(result!.entry.titles[0]!.length).toBeGreaterThan(0);
			expect(result!.entry.episodes.length).toBeGreaterThan(0);
			expect(result!.entry.description.length).toBeGreaterThan(0);
			detailResult = result!;
		},
		180_000,
	);
	it.skipIf(!siteUp)(
		"should be able to source",
		async () => {
			if (extension.enabled === false) throw new Error("Extension not enabled");
			if (
				detailResult === undefined ||
				detailResult?.entry.episodes.length <= 0
			)
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
		},
		60_000,
	);
	it("should reject malformed episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.source({ uid: "not-an-id" }, {})).rejects.toThrow();
	}, 30_000);
});
