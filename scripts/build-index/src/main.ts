import { existsSync } from "node:fs";
import { copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { $, file } from "bun";
import {
	extensionsSchema,
	parseFile,
	repoSchema,
	toExtensionData,
} from "dion-repo-utils";

async function main() {
	const index_folder = ".index";
	const [extensions] = await Promise.all([
		readdir("./extensions"),
		$`rm -rf ${index_folder} && mkdir ${index_folder}`,
	]);

	await Promise.all(
		extensions
			.map((extension) => ({
				src: join("extensions", extension, ".dist", `${extension}.dion.js`),
				dest: join(index_folder, `${extension}.dion.js`),
			}))
			.filter(({ src }) => existsSync(src))
			.map(async ({ src, dest }) => {
				console.log(`Copying ${src} to ${dest}`);
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
	console.error("Failed to build index");
	console.error(e.message);
	console.error(e.stack);
	console.error(e);
	process.exit(1);
});
