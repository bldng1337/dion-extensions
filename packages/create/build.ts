import * as Bun from "bun";
import { $ } from "bun";

await $`rm -rf .dist && mkdir .dist`;
const bundle = await Bun.build({
	entrypoints: ["src/index.ts"],
	outdir: ".dist",
	target: "bun",
	minify: true,
	// bytecode: true,
	// format: "cjs",
});
if (!bundle.success) throw new AggregateError(bundle.logs);
