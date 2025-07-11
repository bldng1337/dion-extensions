#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="dion-runtime-types" />
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	args: Bun.argv,
	options: {
		verbose: {
			type: "boolean",
			short: "v",
			default: false,
		},
		dev: {
			type: "boolean",
			short: "d",
			default: false,
		},
		output: {
			type: "string",
			short: "o",
		},
		input: {
			type: "string",
			short: "i",
			default: ".dist",
		},
	},
	strict: true,
	allowPositionals: true,
});

function log(message: string) {
	if (values.verbose ?? false) console.log(message);
}

const env = values.dev ? "diondev" : "dion";

const home = homedir();
const extpath = values.output ?? path.join(home, "Documents", env, "extension");

log(`Pushing to ${extpath}`);

const extensions = fs.readdirSync(values.input);

log(`Found files in .dist: ${extensions}`);

const extension = extensions.filter((name) => name.includes(".dion.js"))[0];

log(`Found extension: ${extension}`);

if (extension === undefined) {
	console.error("No extension found");
	process.exit(1);
}

fs.copyFileSync(path.join(".dist", extension), path.join(extpath, extension));
