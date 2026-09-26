import { DionExtension } from "@dion-js/runtime-lib";
import {
	Checkbox,
	DirectoryPicker,
	Dropdown,
	ExtensionSetting,
	Slider,
} from "@dion-js/runtime-lib/settings.js";
import type {
	ProxyRequest,
	ProxyResponse,
	SourceProvider,
} from "@dion-js/runtime-types/extension";
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
	Link,
	Permission,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { type Cache, openLruCache } from "cache";
import {
	exists,
	joinPaths,
	readDir,
	readFile,
	readTextFile,
	stat,
} from "filesystem";
import {
	commonAlbum,
	collectAuthors,
	collectGenres,
	describeMetadata,
	episodeName,
	episodeTrackLabel,
	isCachedMeta,
	isSafeRelPath,
	normalizeMetadata,
	parseCoverPath,
	sniffImageType,
	sourceChapters,
	type CachedMeta,
	type FileMeta,
} from "./metadata.ts";
import { inspect, openArchive } from "metadata";
import { getProxyAddress } from "network";
import { hasPermission, requestPermission } from "permission";
import {
	carriesMetadata,
	filterByTitle,
	filesFromListing,
	humanSize,
	kindForFilename,
	mediaTypeForFiles,
	orderEpisodes,
	paginate,
	pathToFileUrl,
	scanLibrary,
	textToParagraphs,
	titleFromFilename,
	type ScannedEntry,
	type ScannedFile,
} from "./library.ts";

const DIRECTORY_SETTING_ID = "local_sources_directory";
const METADATA_SETTING_ID = "local_sources_metadata";
const METADATA_FILES_SETTING_ID = "local_sources_metadata_files";
const METADATA_SIZE_SETTING_ID = "local_sources_metadata_size";

/** How many files the in-memory "already seen" map keeps for browse. */
const SEEN_LIMIT = 500;

const MB = 1024 * 1024;

const notFound = (): ProxyResponse => ({
	type: "response",
	status: 404,
	headers: {},
});

/** What the metadata settings allow this session. */
type Limits = {
	enabled: boolean;
	/** Files read per entry; Infinity reads every one. */
	files: number;
	/** Largest file worth reading whole, in bytes. */
	maxBytes: number;
};

export default class extends DionExtension implements SourceProvider {
	settings = {
		directory: new ExtensionSetting<string>(
			DIRECTORY_SETTING_ID,
			"",
			"Extension",
		)
			.setLabel("Library folder")
			.setUI(new DirectoryPicker()),
		metadata: new ExtensionSetting<boolean>(
			METADATA_SETTING_ID,
			true,
			"Extension",
		)
			.setLabel("Read embedded metadata")
			.setUI(new Checkbox()),
		metadataFiles: new ExtensionSetting<string>(
			METADATA_FILES_SETTING_ID,
			"25",
			"Extension",
		)
			.setLabel("Files read per folder")
			.setUI(
				new Dropdown([
					{ value: "1", label: "First file only" },
					{ value: "5", label: "Up to 5" },
					{ value: "25", label: "Up to 25" },
					{ value: "100", label: "Up to 100" },
					{ value: "0", label: "All of them" },
				]),
			),
		metadataSize: new ExtensionSetting<number>(
			METADATA_SIZE_SETTING_ID,
			32,
			"Extension",
		)
			.setLabel("Largest file read (MB)")
			.setUI(new Slider(1, 512, 1)),
	};
	accounts = {};
	entrySettings = {};

	/** Tags already extracted this session, keyed by library-relative path. */
	#seen = new Map<string, FileMeta>();
	#metaCache: Cache | null = null;
	#cacheBroken = false;
	#proxy: string | null | undefined;

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- Configuration -------------------------------------------------------

	/** The picked library folder, or null while no folder is configured. */
	async #root(): Promise<string | null> {
		const root = (await this.settings.directory.get()).trim();
		if (root.length === 0) return null;
		await this.#ensureAccess(root);
		return root;
	}

	async #limits(): Promise<Limits> {
		const perFolder = Number.parseInt(
			await this.settings.metadataFiles.get(),
			10,
		);
		const mb = await this.settings.metadataSize.get();
		return {
			enabled: await this.settings.metadata.get(),
			files: Number.isNaN(perFolder) || perFolder <= 0 ? Infinity : perFolder,
			maxBytes: Math.max(1, mb) * MB,
		};
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

	// -- Metadata ------------------------------------------------------------

	/**
	 * The persistent metadata cache, opened lazily and at most once: a host
	 * without the module should degrade to "no caching", not to a broken
	 * extension.
	 */
	#cache(): Cache | null {
		if (this.#metaCache !== null) return this.#metaCache;
		if (this.#cacheBroken) return null;
		try {
			this.#metaCache = openLruCache("metadata", { maxEntries: 2000 });
		} catch (error) {
			console.warn(`local-sources: metadata cache unavailable: ${error}`);
			this.#cacheBroken = true;
		}
		return this.#metaCache;
	}

	#remember(rel: string, meta: FileMeta): void {
		this.#seen.delete(rel);
		this.#seen.set(rel, meta);
		while (this.#seen.size > SEEN_LIMIT) {
			const oldest = this.#seen.keys().next();
			if (oldest.done) break;
			this.#seen.delete(oldest.value);
		}
	}

	/**
	 * Reads one file's tags, keyed on size and mtime so re-opening an entry
	 * never re-reads the library. Files that yield nothing are cached as
	 * having nothing.
	 */
	async #metaFor(
		root: string,
		file: ScannedFile,
		limits: Limits,
	): Promise<FileMeta | undefined> {
		const abs = joinPaths([root, file.rel]);
		const info = await stat(abs);
		if (info.size > limits.maxBytes) return undefined;

		const key = `${info.size}:${info.modifiedMs ?? 0}:${file.rel}`;
		const cache = this.#cache();
		const cached = await cache?.get(key);
		if (isCachedMeta(cached)) {
			// A cache hit is the only thing this session knows about some
			// files, so it repopulates what browse lists entries from.
			if (cached.meta !== null) this.#remember(file.rel, cached.meta);
			return cached.meta ?? undefined;
		}

		let meta: FileMeta | undefined;
		try {
			meta =
				normalizeMetadata(await inspect(await readFile(abs), abs)) ?? undefined;
		} catch (error) {
			console.warn(`local-sources: no metadata in ${file.rel}: ${error}`);
		}
		const envelope: CachedMeta = { meta: meta ?? null };
		await cache?.set(key, envelope);
		if (meta !== undefined) this.#remember(file.rel, meta);
		return meta;
	}

	/**
	 * Tags for an entry's files, in scan order. Reading a file whole is the
	 * expensive part, so only the first `limits.files` files that could carry
	 * tags at all are read and the rest keep their filename-derived names.
	 */
	async #metas(
		root: string,
		files: ScannedFile[],
		limits: Limits,
	): Promise<Map<string, FileMeta | undefined>> {
		const metas = new Map<string, FileMeta | undefined>();
		if (!limits.enabled) return metas;
		let budget = limits.files;
		for (const file of files) {
			if (!carriesMetadata(file.kind)) continue;
			if (budget <= 0) break;
			budget--;
			try {
				metas.set(file.rel, await this.#metaFor(root, file, limits));
			} catch (error) {
				console.warn(`local-sources: cannot read ${file.rel}: ${error}`);
				metas.set(file.rel, undefined);
			}
		}
		return metas;
	}

	// -- Covers --------------------------------------------------------------

	async #proxyAddress(): Promise<string | null> {
		if (this.#proxy === undefined) {
			try {
				this.#proxy = (await getProxyAddress()) ?? null;
			} catch (error) {
				console.warn(`local-sources: no proxy address: ${error}`);
				this.#proxy = null;
			}
		}
		return this.#proxy;
	}

	/** A client-fetchable url for a file's embedded artwork. */
	async #coverLink(rel: string): Promise<Link | null> {
		const proxy = await this.#proxyAddress();
		if (proxy === null) return null;
		return { url: `${proxy}/cover?path=${encodeURIComponent(rel)}` };
	}

	/** The first of the entry's files that has artwork, as a cover link. */
	async #cover(
		files: ScannedFile[],
		metas: Map<string, FileMeta | undefined>,
	): Promise<Link | null> {
		for (const file of files) {
			if (metas.get(file.rel)?.hasCover !== true) continue;
			return this.#coverLink(file.rel);
		}
		return null;
	}

	/**
	 * Serves the cover bytes of `/cover?path=<library-relative path>`. The
	 * container is re-read per request rather than held in memory, so a cover
	 * url stored with an entry keeps working after a restart.
	 */
	async handleProxy(request: ProxyRequest): Promise<ProxyResponse> {
		if (request.method !== "GET" && request.method !== "HEAD")
			return notFound();
		const rel = parseCoverPath(request.uri);
		if (rel === null || !isSafeRelPath(rel)) return notFound();
		const kind = kindForFilename(rel);
		if (kind === null || !carriesMetadata(kind)) return notFound();

		try {
			const root = await this.#root();
			if (root === null) return notFound();
			const limits = await this.#limits();
			if (!limits.enabled) return notFound();
			const abs = joinPaths([root, rel]);
			if ((await stat(abs)).size > limits.maxBytes) return notFound();
			const data = await readFile(abs);
			const art =
				kind === "epub"
					? await epubCover(data, abs)
					: await tagArtwork(data, abs);
			if (art === undefined) return notFound();
			return {
				type: "response",
				status: 200,
				headers: {
					"Content-Type": [sniffImageType(art)],
					"Content-Length": [`${art.length}`],
					"Cache-Control": ["public, max-age=86400"],
				},
				body: art,
			};
		} catch (error) {
			console.warn(`local-sources: cover request for ${rel} failed: ${error}`);
			return notFound();
		}
	}

	// -- Listing -------------------------------------------------------------

	async #browseList(page: number, query: string | null): Promise<EntryList> {
		const root = await this.#root();
		if (root === null) return { content: [], hasnext: false };
		const scanned = await scanLibrary(root, (dir) => readDir(dir));
		// Resolve titles before filtering, so a search finds an entry by the
		// name its tags give it and not only by the folder it sits in.
		const titled = scanned.map((entry) => ({
			scanned: entry,
			title: this.#displayTitle(entry),
		}));
		const matches = query === null ? titled : filterByTitle(titled, query);
		const { content, hasnext } = paginate(matches, page);
		const entries: Entry[] = [];
		for (const match of content) {
			entries.push(await this.#toEntry(root, match.scanned, match.title));
		}
		return { content: entries, hasnext };
	}

	/**
	 * The name an entry should be listed under, using only the tags a previous
	 * detail call already extracted — browse itself never reads a file.
	 */
	#displayTitle(scanned: ScannedEntry): string {
		const seen = scanned.files.map((file) => this.#seen.get(file.rel));
		if (!scanned.isFolder) return seen[0]?.title ?? scanned.title;
		return commonAlbum(seen) ?? scanned.title;
	}

	/**
	 * Browse stays read-free: it borrows only the tags a previous detail call
	 * already extracted, so the library grid fills in with real titles and
	 * covers as it is browsed without browse itself reading a single file.
	 */
	async #toEntry(
		root: string,
		scanned: ScannedEntry,
		title: string,
	): Promise<Entry> {
		const target = scanned.isFolder ? scanned.uid.slice(0, -1) : scanned.uid;
		let cover: Link | null = null;
		for (const file of scanned.files) {
			if (this.#seen.get(file.rel)?.hasCover !== true) continue;
			cover = await this.#coverLink(file.rel);
			break;
		}
		const first = scanned.files[0];
		return {
			id: { uid: scanned.uid },
			url: pathToFileUrl(joinPaths([root, target])),
			title,
			media_type: mediaTypeForFiles(scanned.files),
			cover,
			author:
				first === undefined
					? null
					: (this.#seen.get(first.rel)?.authors ?? null),
		};
	}

	#episode(
		root: string,
		file: ScannedFile,
		meta: FileMeta | undefined,
	): Episode {
		return {
			id: { uid: file.rel },
			name: episodeName(meta, file.title),
			url: pathToFileUrl(joinPaths([root, file.rel])),
			description: episodeTrackLabel(meta),
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
		let fact: string;
		if (isFolder) {
			// Re-list the folder instead of replaying a scan so detail stays
			// correct for libraries changed since the last browse.
			const listing = await readDir(joinPaths([root, name]));
			files = filesFromListing(name, listing);
			if (files.length === 0) {
				throw new Error(`No supported files in ${title}`);
			}
			fact = `${files.length} episode${files.length === 1 ? "" : "s"}`;
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
			fact = `${kind.toUpperCase()} file • ${humanSize((await stat(fileAbs)).size)}`;
		}

		const metas = await this.#metas(root, files, await this.#limits());
		const known = files.map((file) => metas.get(file.rel));
		// A folder is named after its album, or after its own name; a single
		// file after its own title.
		const primary = known.find((meta) => meta !== undefined);
		const entryTitle = isFolder
			? (commonAlbum(known) ?? title)
			: (primary?.title ?? title);

		const lines = [fact];
		const described = describeMetadata(primary, !isFolder);
		if (described.length > 0) lines.push(described);
		if (primary?.description !== undefined) lines.push(primary.description);

		const ordered = orderEpisodes(files, (file) => {
			const meta = metas.get(file.rel);
			return meta?.track === undefined
				? undefined
				: { disc: meta.disc, track: meta.track };
		});
		const mediaType = mediaTypeForFiles(files);
		const cover = await this.#cover(files, metas);
		const entry: EntryDetailed = {
			id: { uid },
			url: pathToFileUrl(joinPaths([root, name])),
			titles: [entryTitle],
			author: collectAuthors(known),
			media_type: mediaType,
			status: "Complete",
			description: lines.join(" • "),
			language: primary?.language ?? "",
			cover,
			// Embedded artwork of a video is a still frame rather than a
			// poster, so only books and audio fill both slots.
			poster: mediaType === "Video" ? null : cover,
			genres: collectGenres(known),
			episodes: ordered.map((file) =>
				this.#episode(root, file, metas.get(file.rel)),
			),
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
			case "mp4": {
				// Chapters live in the container's tags, so the file has to be
				// read to know about them. Books and texts above never touch it.
				const metas = await this.#metas(
					root,
					[{ rel, title: titleFromFilename(rel), kind }],
					await this.#limits(),
				);
				const chapters = sourceChapters(metas.get(rel));
				const source = { name: "Local", lang: "", url };
				return {
					source:
						kind === "mp3"
							? { type: "Audio", sources: [source], chapters }
							: { type: "Video", sources: [source], sub: [], chapters },
					settings: { ...settings },
				};
			}
		}
	}
}

/** The cover image of an EPUB container, if it declares one. */
async function epubCover(
	data: Uint8Array,
	hint: string,
): Promise<Uint8Array | undefined> {
	const archive = await openArchive(data, hint);
	const meta = await archive.metadata;
	if (meta.type !== "epub" || meta.coverPath === undefined) return undefined;
	return await archive.read(meta.coverPath);
}

/** The picture embedded in an MP3/MP4 tag, if it has one. */
async function tagArtwork(
	data: Uint8Array,
	hint: string,
): Promise<Uint8Array | undefined> {
	const meta = await inspect(data, hint);
	if (meta.type !== "mp4" && meta.type !== "audio") return undefined;
	return meta.artwork;
}
