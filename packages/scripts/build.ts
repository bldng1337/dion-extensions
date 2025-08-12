import { $ } from "bun";

await $`rm -rf .dist && mkdir .dist`;
const bundle = await Bun.build({
	entrypoints: ["src/bundle_bun.ts", "src/push.ts", "src/action_build.ts"],
	outdir: ".dist",
	target: "bun",
	// minify: true,
	// bytecode: true,
	// format: "cjs",
});
if (!bundle.success) throw new AggregateError(bundle.logs);
