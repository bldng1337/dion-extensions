/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import type { Extension } from "dion-node-runtime";
import { ExtensionManager } from "dion-node-runtime";
import {
	assertValidEntries,
	assertValidEntry,
	assertValidSource,
} from "dion-test-asserts";

let extension: Extension;
let browseResult: Entry[];
let detailResult: EntryDetailed;

beforeAll(async () => {
	const ext = (await new ExtensionManager("./.dist").getExtensions())[0];
	if (ext === undefined)
		throw new Error("Extension not found in dist! Maybe build failed?");
	extension = ext;
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		expect(await extension!.isEnabled()).toBe(true);
	});
	it(
		"should be able to browse",
		async () => {
			if ((await extension.isEnabled()) === false)
				throw new Error("Extension not enabled");
			const result = await extension!.browse(0, "Popular");
			expect(result).toBeDefined();
			expect(result.length).toBeGreaterThan(0);
			await assertValidEntries(result);
			browseResult = result;
		},
		{
			timeout: 10000,
		},
	);
	it(
		"should be able to search",
		async () => {
			if ((await extension.isEnabled()) === false)
				throw new Error("Extension not enabled");
			const result = await extension!.search(0, "second");
			await assertValidEntries(result);
			expect(result).toBeDefined();
		},
		{
			timeout: 10000,
		},
	);
	it("should be able to detail", async () => {
		if ((await extension.isEnabled()) === false)
			throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		await assertValidEntry(result);
		detailResult = result;
	});
	it("should be able to source", async () => {
		if ((await extension.isEnabled()) === false)
			throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(result);
		expect(result).toBeDefined();
	});
});
