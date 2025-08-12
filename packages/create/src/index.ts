#!/usr/bin/env bun
import fs from "node:fs/promises";
import path from "node:path";
/// <reference types="bun" />
import { argv } from "bun";
import Handlebars from "handlebars";
import { v4 } from "uuid";
import { loadTemplate } from "./loader.ts" with { type: "macro" };

function prompt(question: string, def?: string): Promise<string> {
	return new Promise((resolve) => {
		process.stdout.write(`${question}${def ? ` (${def})` : ""}: `);
		const chunks: Buffer[] = [];
		process.stdin.resume();
		process.stdin.once("data", (data) => {
			chunks.push(data as Buffer);
			process.stdin.pause();
			const ans = Buffer.concat(chunks).toString().trim();
			resolve(ans.length ? ans : (def ?? ""));
		});
	});
}

function toSlug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9-_]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "extension"
	);
}

function toKeywords(input: string): string[] {
	return input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function uuid(): string {
	return v4();
}

async function ensureDir(dir: string) {
	await fs.mkdir(dir, { recursive: true });
}

async function writeFile(p: string, content: string) {
	await ensureDir(path.dirname(p));
	await fs.writeFile(p, content);
}

async function render(tpl: string, vars: Record<string, unknown>) {
	const template = Handlebars.compile(tpl, { noEscape: true });
	return template(vars);
}

type CliOptions = {
	yes: boolean;
	name?: string;
	description?: string;
	url?: string;
	author?: string;
	icon?: string;
	keywords?: string;
	media?: string;
};

function parseArgs(args: string[]): CliOptions {
	const out: CliOptions = { yes: false };
	const it = args[Symbol.iterator]();
	let current = it.next();
	while (!current.done) {
		const token = current.value as string;
		if (token === "-y" || token === "--yes") {
			out.yes = true;
		} else if (token === "--description") {
			const n = it.next();
			if (!n.done) out.description = n.value as string;
		} else if (token.startsWith("--description=")) {
			out.description = token.split("=", 2)[1] ?? "";
		} else if (token === "--url") {
			const n = it.next();
			if (!n.done) out.url = n.value as string;
		} else if (token.startsWith("--url=")) {
			out.url = token.split("=", 2)[1] ?? "";
		} else if (token === "--author") {
			const n = it.next();
			if (!n.done) out.author = n.value as string;
		} else if (token.startsWith("--author=")) {
			out.author = token.split("=", 2)[1] ?? "";
		} else if (token === "--icon") {
			const n = it.next();
			if (!n.done) out.icon = n.value as string;
		} else if (token.startsWith("--icon=")) {
			out.icon = token.split("=", 2)[1] ?? "";
		} else if (token === "--keywords") {
			const n = it.next();
			if (!n.done) out.keywords = n.value as string;
		} else if (token.startsWith("--keywords=")) {
			out.keywords = token.split("=", 2)[1] ?? "";
		} else if (token === "--media") {
			const n = it.next();
			if (!n.done) out.media = n.value as string;
		} else if (token.startsWith("--media=")) {
			out.media = token.split("=", 2)[1] ?? "";
		} else if (!token.startsWith("-")) {
			if (!out.name) out.name = token;
		}
		current = it.next();
	}
	return out;
}

async function askOr(
	option: string | undefined,
	question: string,
	def: string,
	nonInteractive: boolean,
): Promise<string> {
	if (option !== undefined) return option;
	if (nonInteractive) return def;
	return await prompt(question, def);
}

async function main() {
	const opts = parseArgs(argv.slice(2));
	const nameInput = await askOr(
		opts.name,
		"Extension name",
		"my-extension",
		opts.yes,
	);
	const slug = toSlug(nameInput);
	const title = nameInput;
	const description = await askOr(
		opts.description,
		"Description",
		"A Dion extension",
		opts.yes,
	);
	const url = await askOr(
		opts.url,
		"Website URL",
		"https://example.com/",
		opts.yes,
	);
	const author = await askOr(opts.author, "Author", "Author", opts.yes);
	const icon = await askOr(
		opts.icon,
		"Icon URL",
		"https://placehold.co/256x256/EEE/31343C.png?text=Icon",
		opts.yes,
	);
	const keywords = toKeywords(
		await askOr(
			opts.keywords,
			"Keywords (comma separated)",
			"example, dion",
			opts.yes,
		),
	);
	const media = await askOr(
		opts.media,
		"Media types (comma sep: Video,Comic,Audio,Book,Unknown)",
		"Book",
		opts.yes,
	);
	const mediaTypes = media
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const outDir = path.resolve("extensions", slug);
	if (await fs.exists(outDir)) {
		console.error(`Directory already exists: ${outDir}`);
		process.exit(1);
	}

	const pkgTpl = await loadTemplate("package.json");
	const tsTpl = await loadTemplate("tsconfig.json");
	const biomeTpl = await loadTemplate("biome.json");
	const mainTpl = await loadTemplate("src_main.ts");
	const testTpl = await loadTemplate("src_main.test.ts");

	const vars = {
		name: slug,
		id: uuid(),
		description,
		icon,
		url,
		author,
		keywords: JSON.stringify(keywords),
		media_type: JSON.stringify(mediaTypes),
		title,
	} as Record<string, string>;

	await ensureDir(outDir);
	await writeFile(
		path.join(outDir, "package.json"),
		await render(pkgTpl, vars),
	);
	await writeFile(path.join(outDir, "tsconfig.json"), tsTpl);
	await writeFile(path.join(outDir, "biome.json"), biomeTpl);
	await writeFile(path.join(outDir, "src", "main.ts"), mainTpl);
	await writeFile(path.join(outDir, "src", "main.test.ts"), testTpl);

	console.log(`\nCreated extension at ${outDir}`);
	console.log("Next steps:");
	console.log(`- cd ${path.relative(process.cwd(), outDir)}`);
	console.log("- bun install");
	console.log("- bun run build");
	console.log("- bun test");
	console.log("- bun run pushdev");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
