/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it, type Mock, mock } from "bun:test";
import type { Extension } from "@dion-js/runtime";
import { Adapter, ExtensionClient, ManagerClient } from "@dion-js/runtime";
import {
	assertValidEntries,
	assertValidEntry,
	assertValidSource,
} from "@dion-js/extension-test-utils";
import type {
	Action,
	Permission,
	ExtensionData,
	Entry,
	EntryDetailedResult,
	Setting,
} from "@dion-js/runtime-types/runtime";

export class MockExtensionClient {
	name: string;
	client: ExtensionClient;
	loadData: Mock<(err: Error | null, key: string) => string>;
	storeData: Mock<(err: Error | null, key: string, value: string) => void>;
	doAction: Mock<(err: Error | null, action: Action) => void>;
	requestPermission: Mock<
		(
			err: Error | null,
			permission: Permission,
			msg?: string | undefined | null,
		) => boolean
	>;
	getPath: Mock<(err: Error | null) => string>;
	constructor(extdata: ExtensionData, basepath: string) {
		this.name = extdata.name;
		this.loadData = mock((_err, _arg) => "");
		this.storeData = mock((_err, _key, _arg) => {});
		this.doAction = mock((_err, _action) => {});
		this.requestPermission = mock((_err, _asd) => {
			return false;
		});
		this.getPath = mock(() => {
			return `${basepath}/${extdata.name}`;
		});
		this.client = new ExtensionClient(
			this.loadData,
			this.storeData,
			this.doAction,
			this.requestPermission,
			this.getPath,
		);
	}
}

export class MockManagerClient {
	client: ManagerClient;
	extensions: MockExtensionClient[];
	managerpath: string;
	getClient: Mock<(err: Error | null, arg: ExtensionData) => ExtensionClient>;
	getPath: Mock<(err: Error | null) => string>;

	constructor(managerpath: string = ".") {
		this.managerpath = managerpath;
		this.extensions = [];
		this.getClient = mock((_err, extdata) => {
			const ext = new MockExtensionClient(extdata, managerpath);
			this.extensions.push(ext);
			return ext.client;
		});
		this.getPath = mock((_err) => {
			return managerpath;
		});
		this.client = new ManagerClient(this.getClient, this.getPath);
	}
}

let extension: Extension;
let client: MockManagerClient;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	client = new MockManagerClient("./.dist");
	const adapter = await Adapter.init(client.client);
	const ext = (await adapter.getExtensions())[0];
	if (ext === undefined)
		throw new Error("Extension couldnt be loaded! Maybe build failed?");
	extension = ext;
	browseResult = [];
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
	});
	it(
		"should be able to browse",
		async () => {
			if (extension.enabled === false) throw new Error("Extension not enabled");
			const result = await extension!.browse(0);
			expect(result).toBeDefined();
			expect(result.content.length).toBeGreaterThan(0);
			// await assertValidEntries(result.content);
			browseResult = result.content;
		},
		{
			timeout: 10000,
		},
	);
	it(
		"should be able to search",
		async () => {
			if (extension.enabled === false) throw new Error("Extension not enabled");
			const result = await extension!.search(0, "second");
			// await assertValidEntries(result.content);
			expect(result).toBeDefined();
		},
		{
			timeout: 10000,
		},
	);
	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		// await assertValidEntry(result.entry);
		detailResult = result;
	});
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		// await assertValidSource(result.source);
		expect(result).toBeDefined();
	});
});
