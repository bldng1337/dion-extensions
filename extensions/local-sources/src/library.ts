// Pure helpers for indexing a local library directory. Kept free of the
// built-in `filesystem` module: the directory walk takes a `readDir`
// callback so the grouping logic can be unit-tested without the runtime.

import type { MediaType, Paragraph } from "@dion-js/runtime-types/runtime";

/** Entries per browse/search page. */
export const PAGE_SIZE = 30;

export type FileKind = "epub" | "pdf" | "txt" | "mp3" | "mp4";

/**
 * A supported file addressed relative to the library root with forward
 * slashes ("Series/chapter-2.epub"). Folder entry uids are the rel directory
 * path with a trailing "/" — file paths never end in "/", so the two remain
 * distinguishable.
 */
export type ScannedFile = {
	rel: string;
	title: string;
	kind: FileKind;
};

/** An entry candidate produced by scanning: a loose file or a folder of files. */
export type ScannedEntry = {
	uid: string;
	title: string;
	isFolder: boolean;
	files: ScannedFile[];
};

/** Subset of the filesystem module's DirEntry that the scan needs. */
export type Listing = { name: string; isDir: boolean }[];

export type ReadDirFn = (path: string) => Promise<Listing>;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function kindForFilename(name: string): FileKind | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".epub")) return "epub";
	if (lower.endsWith(".pdf")) return "pdf";
	if (lower.endsWith(".txt")) return "txt";
	if (lower.endsWith(".mp3")) return "mp3";
	if (lower.endsWith(".mp4")) return "mp4";
	return null;
}

/**
 * The runtime MediaType a set of files presents as: any video file makes an
 * entry video, otherwise any audio file makes it audio, otherwise it reads
 * as a book.
 */
export function mediaTypeForFiles(files: ScannedFile[]): MediaType {
	if (files.some((file) => file.kind === "mp4")) return "Video";
	if (files.some((file) => file.kind === "mp3")) return "Audio";
	return "Book";
}

/** The entry/episode name derived from a filename: extension stripped. */
export function titleFromFilename(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

export function joinRel(base: string, name: string): string {
	return base.length === 0 ? name : `${base}/${name}`;
}

/**
 * Local files are addressed as `file://` + plain native path — Dion's wire
 * format for local files (see the app's `fileFromUrl`): no percent-encoding
 * and no RFC 8089 authority. Paths from the `filesystem` module already use
 * native separators, so the URL round-trips on every platform.
 */
export function pathToFileUrl(path: string): string {
	return `file://${path}`;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function isDigitAt(s: string, index: number): boolean {
	const c = s[index];
	return c !== undefined && c >= "0" && c <= "9";
}

/**
 * Natural comparison: digit runs compare numerically, everything else
 * case-insensitively by code unit, so "Chapter 2" sorts before "Chapter 10".
 */
export function naturalCompare(a: string, b: string): number {
	const al = a.toLowerCase();
	const bl = b.toLowerCase();
	let i = 0;
	let j = 0;
	while (i < al.length && j < bl.length) {
		const ca = al[i] ?? "";
		const cb = bl[j] ?? "";
		if (isDigitAt(al, i) && isDigitAt(bl, j)) {
			let i2 = i;
			let j2 = j;
			while (isDigitAt(al, i2)) i2++;
			while (isDigitAt(bl, j2)) j2++;
			const na = Number.parseInt(al.slice(i, i2), 10);
			const nb = Number.parseInt(bl.slice(j, j2), 10);
			if (na !== nb) return na - nb;
			i = i2;
			j = j2;
		} else if (ca !== cb) {
			return ca < cb ? -1 : 1;
		} else {
			i++;
			j++;
		}
	}
	return al.length - bl.length;
}

function byFileTitle(a: ScannedFile, b: ScannedFile): number {
	return naturalCompare(a.title, b.title) || naturalCompare(a.rel, b.rel);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Supported files of a directory listing, naturally sorted. */
export function filesFromListing(
	relDir: string,
	listing: Listing,
): ScannedFile[] {
	const files: ScannedFile[] = [];
	for (const item of listing) {
		if (item.isDir || item.name.startsWith(".")) continue;
		const kind = kindForFilename(item.name);
		if (kind === null) continue;
		files.push({
			rel: joinRel(relDir, item.name),
			title: titleFromFilename(item.name),
			kind,
		});
	}
	return files.sort(byFileTitle);
}

/**
 * Walks the library tree and groups supported files into entries: files
 * directly in the root each become a one-episode entry named after the
 * file, and every subdirectory that directly contains supported files
 * becomes one entry named after the folder with the files as episodes.
 * Directories containing only further subdirectories are traversed through.
 * Hidden entries (leading ".") are ignored; read errors propagate.
 */
export async function scanLibrary(
	root: string,
	readDir: ReadDirFn,
): Promise<ScannedEntry[]> {
	const nodes: { rel: string; files: ScannedFile[] }[] = [];
	const pending: { abs: string; rel: string }[] = [{ abs: root, rel: "" }];
	while (pending.length > 0) {
		const dir = pending.pop()!;
		const listing = await readDir(dir.abs);
		const files: ScannedFile[] = [];
		for (const item of listing) {
			if (item.name.startsWith(".")) continue;
			if (item.isDir) {
				pending.push({
					abs: joinRel(dir.abs, item.name),
					rel: joinRel(dir.rel, item.name),
				});
				continue;
			}
			const kind = kindForFilename(item.name);
			if (kind !== null) {
				files.push({
					rel: joinRel(dir.rel, item.name),
					title: titleFromFilename(item.name),
					kind,
				});
			}
		}
		nodes.push({ rel: dir.rel, files });
	}

	const entries: ScannedEntry[] = [];
	for (const node of nodes) {
		if (node.files.length === 0) continue;
		if (node.rel === "") {
			for (const file of node.files) {
				entries.push({
					uid: file.rel,
					title: file.title,
					isFolder: false,
					files: [file],
				});
			}
			continue;
		}
		entries.push({
			uid: `${node.rel}/`,
			title: node.rel.split("/").pop() ?? node.rel,
			isFolder: true,
			files: [...node.files].sort(byFileTitle),
		});
	}
	return entries.sort(
		(a, b) => naturalCompare(a.title, b.title) || naturalCompare(a.uid, b.uid),
	);
}

// ---------------------------------------------------------------------------
// Paging & searching
// ---------------------------------------------------------------------------

export function paginate<T>(
	items: T[],
	page: number,
): { content: T[]; hasnext: boolean } {
	const start = Math.max(0, page) * PAGE_SIZE;
	return {
		content: items.slice(start, start + PAGE_SIZE),
		hasnext: start + PAGE_SIZE < items.length,
	};
}

/** Case-insensitive substring match on entry titles. */
export function filterByTitle<T extends { title: string }>(
	items: T[],
	query: string,
): T[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [];
	return items.filter((item) => item.title.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	let value = bytes;
	let unit = "B";
	for (const next of ["KB", "MB", "GB"] as const) {
		if (value < 1024) break;
		value /= 1024;
		unit = next;
	}
	const rounded = value < 10 ? value.toFixed(1) : `${Math.round(value)}`;
	return `${rounded} ${unit}`;
}

/**
 * Splits plain text into paragraphs on blank lines and unwraps hard
 * line-wraps inside a paragraph so readers can reflow it.
 */
export function textToParagraphs(text: string): Paragraph[] {
	return text
		.split(/\r?\n[ \t]*\r?\n+/)
		.map((block) => block.replace(/[\r\n]+[ \t]*/g, " ").trim())
		.filter((block) => block.length > 0)
		.map(
			(content): Paragraph => ({
				type: "Text",
				content,
				style: null,
			}),
		);
}
