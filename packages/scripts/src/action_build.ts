import { copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { $, file } from "bun";
import {
	extensionsSchema,
	parseFile,
	repoSchema,
	toExtensionData,
} from "./utils.ts";

async function main() {
	const index_folder = ".index";
	const [extensions] = await Promise.all([
		readdir("./extensions"),
		$`bunx turbo run build`,
		$`rm -rf ${index_folder} && mkdir ${index_folder}`,
	]);

	await Promise.all(
		extensions.map(async (extension) => {
			const src = join(
				"extensions",
				extension,
				".dist",
				`${extension}.dion.js`,
			);
			const dest = join(index_folder, `${extension}.dion.js`);
			await copyFile(src, dest);
		}),
	);

	const extensionindex = await Promise.all(
		extensions.map(async (extension) => {
			const packagejson = await parseFile(
				`./extensions/${extension}/package.json`,
				extensionsSchema,
			);
			return toExtensionData(packagejson);
		}),
	);

	const repojson = await parseFile("./package.json", repoSchema);
	await file(`${index_folder}/index.repo.json`).write(
		JSON.stringify({
			repo_index_version: 1,
			name: repojson.name,
			repourl: repojson.repository?.url,
			id: repojson.id,
			description: repojson.description,
			icon: repojson.icon,
			extensions: extensionindex,
		}),
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
