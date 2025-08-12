#!/usr/bin/env bun
import fs from "node:fs/promises";
/// <reference types="dion-runtime-types" />
/// <reference types="bun" />
import { $, file } from "bun";
import {
	type ExtensionRepo,
	extensionsSchema,
	parseFile,
	repoSchema,
	toExtensionData,
} from "./utils.ts";

async function tryFetchGitUrl(
	repo: Promise<ExtensionRepo>,
): Promise<string | undefined> {
	let command_res: string | undefined;
	let command_error: unknown | undefined;
	try {
		const res = await $`git config --get remote.origin.url`;
		command_res = res.stdout.toString().trim();
	} catch (error) {
		command_error = error;
	}
	const repo_data = await repo;
	if (repo_data.repository?.url !== undefined) {
		return repo_data.repository.url;
	}
	if (command_error !== undefined) {
		console.error(`Failed to get Repo URL from git config: ${command_error}`);
	}
	return command_res;
}

async function build(): Promise<string> {
	const res = await Bun.build({
		entrypoints: ["src/main.ts"],
		loader: {
			".gql": "text",
		},
		minify: true,
		target: "browser",
		tsconfig: "./tsconfig.json",

		external: ["network", "permission", "setting", "parse"],
		format: "esm",
	});
	if (!res.success) throw new AggregateError(res.logs);
	if (res.outputs.length === 0) {
		console.error("No outputs found");
		process.exit(1);
	}
	const code = await res.outputs[0]?.text();
	if (code === undefined) {
		throw new Error("No output found");
	}
	return code;
}

async function remakeDist() {
	await $`rm -rf .dist`;
	await fs.mkdir("./.dist");
}

async function main() {
	const repopromise = parseFile("../../package.json", repoSchema);

	const [repo, pkg, gitUrl, source] = await Promise.all([
		repopromise,
		parseFile("./package.json", extensionsSchema),
		tryFetchGitUrl(repopromise),
		build(),
		remakeDist(),
	]);
	await file(`./.dist/${pkg.name}.dion.js`).write(
		`//${JSON.stringify(toExtensionData(pkg, repo.name, gitUrl))}\n${source}`,
	);
}
main();
