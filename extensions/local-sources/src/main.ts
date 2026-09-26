import { DionExtension } from "@dion-js/runtime-lib";
import {
	DirectoryPicker,
	ExtensionSetting,
} from "@dion-js/runtime-lib/settings.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	Episode,
	EpisodeId,
	EventData,
	EventResult,
	Permission,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { exists, joinPaths, readDir, readTextFile, stat } from "filesystem";
import { hasPermission, requestPermission } from "permission";
import {
	filterByTitle,
	filesFromListing,
	humanSize,
	kindForFilename,
	mediaTypeForFiles,
	paginate,
	pathToFileUrl,
	scanLibrary,
	textToParagraphs,
	titleFromFilename,
	type ScannedEntry,
	type ScannedFile,
} from "./library.ts";

const DIRECTORY_SETTING_ID = "local_sources_directory";

export default class extends DionExtension implements SourceProvider {
	settings = {
		directory: new ExtensionSetting<string>(
			DIRECTORY_SETTING_ID,
			"",
			"Extension",
		)
			.setLabel("Library folder")
			.setUI(new DirectoryPicker()),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	/** The picked library folder, or null while no folder is configured. */
	async #root(): Promise<string | null> {
		const root = (await this.settings.directory.get()).trim();
		if (root.length === 0) return null;
		await this.#ensureAccess(root);
		return root;
	}

	/** One read grant for the root covers the whole tree below it. */
	async #ensureAccess(root: string): Promise<void> {
		const permission: Permission = {
			type: "Storage",
			path: root,
			write: false,
		};
		if (await hasPermission(permission)) return;
		const granted = await requestPermission(
			permission,
			`to read your library folder ${root}`,
		);
		if (!granted) {
			throw new Error(`Read access to ${root} was denied`);
		}
	}

	async #browseList(page: number, query: string | null): Promise<EntryList> {
		const root = await this.#root();
		if (root === null) return { content: [], hasnext: false };
		let scanned = await scanLibrary(root, (dir) => readDir(dir));
		if (query !== null) {
			scanned = filterByTitle(scanned, query);
		}
		const { content, hasnext } = paginate(scanned, page);
		return {
			content: content.map((entry) => this.#toEntry(root, entry)),
			hasnext,
		};
	}

	#toEntry(root: string, scanned: ScannedEntry): Entry {
		const target = scanned.isFolder ? scanned.uid.slice(0, -1) : scanned.uid;
		return {
			id: { uid: scanned.uid },
			url: pathToFileUrl(joinPaths([root, target])),
			title: scanned.title,
			media_type: mediaTypeForFiles(scanned.files),
		};
	}

	#episode(root: string, file: ScannedFile): Episode {
		return {
			id: { uid: file.rel },
			name: file.title,
			url: pathToFileUrl(joinPaths([root, file.rel])),
		};
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		return this.#browseList(page, null);
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const query = filter.trim();
		if (query.length === 0) return { content: [], hasnext: false };
		return this.#browseList(page, query);
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const root = await this.#root();
		if (root === null) {
			throw new Error("No library folder configured");
		}
		const uid = entryid.uid;
		const isFolder = uid.endsWith("/");
		const name = isFolder ? uid.slice(0, -1) : uid;
		const title = titleFromFilename(name.split("/").pop() ?? name);

		let files: ScannedFile[];
		let description: string;
		if (isFolder) {
			// Re-list the folder instead of replaying a scan so detail stays
			// correct for libraries changed since the last browse.
			const listing = await readDir(joinPaths([root, name]));
			files = filesFromListing(name, listing);
			if (files.length === 0) {
				throw new Error(`No supported files in ${title}`);
			}
			description = `${files.length} episode${files.length === 1 ? "" : "s"}`;
		} else {
			const kind = kindForFilename(name);
			if (kind === null) {
				throw new Error(`Unsupported file: ${name}`);
			}
			const fileAbs = joinPaths([root, name]);
			if (!(await exists(fileAbs))) {
				throw new Error(`File not found: ${name}`);
			}
			files = [{ rel: name, title, kind }];
			const info = await stat(fileAbs);
			description = `${kind.toUpperCase()} file • ${humanSize(info.size)}`;
		}

		const entry: EntryDetailed = {
			id: { uid },
			url: pathToFileUrl(joinPaths([root, name])),
			titles: [title],
			media_type: mediaTypeForFiles(files),
			status: "Complete",
			description,
			language: "",
			episodes: files.map((file) => this.#episode(root, file)),
		};
		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const root = await this.#root();
		if (root === null) {
			throw new Error("No library folder configured");
		}
		const rel = epid.uid;
		const kind = kindForFilename(rel);
		if (kind === null) {
			throw new Error(`Unsupported file: ${rel}`);
		}
		const fileAbs = joinPaths([root, rel]);
		const url = { url: pathToFileUrl(fileAbs) };
		switch (kind) {
			case "epub":
				return {
					source: { type: "Epub", link: { url: pathToFileUrl(fileAbs) } },
					settings: { ...settings },
				};
			case "pdf":
				return {
					source: { type: "Pdf", link: { url: pathToFileUrl(fileAbs) } },
					settings: { ...settings },
				};
			case "txt":
				return {
					source: {
						type: "Paragraphlist",
						paragraphs: textToParagraphs(await readTextFile(fileAbs)),
					},
					settings: { ...settings },
				};
			case "mp3":
				return {
					source: {
						type: "Audio",
						sources: [{ name: "Local", lang: "", url }],
						chapters: null,
					},
					settings: { ...settings },
				};
			case "mp4":
				return {
					source: {
						type: "Video",
						sources: [{ name: "Local", lang: "", url }],
						sub: [],
						chapters: null,
					},
					settings: { ...settings },
				};
		}
	}
}
