import { DionExtension } from "@dion-js/runtime-lib";
import { Column, Link, Text } from "@dion-js/runtime-lib/ui.js";
import { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	Entry,
	EntryDetailed,
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	EventData,
	EventResult,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import {
	ATTRIBUTION,
	blobUrl,
	extractHeader,
	extractParts,
	extractParagraphs,
	PAGE_SIZE,
	rawUrl,
	USER_AGENT,
	type Work,
	WORKS,
} from "./tei.ts";

// ---------------------------------------------------------------------------
// Remote access: raw TEI XML from GitHub, cached in module scope (the runtime
// VM lives as long as the extension does). Only raw.githubusercontent.com is
// ever fetched — the curated paths in WORKS were verified against one bulk
// git-tree call per repo, so api.github.com is not needed at runtime.
// ---------------------------------------------------------------------------

/** Raw files are big (the Iliad is ~8 MB), so only the most recently used
 * ones stay in memory; metadata is small and cached permanently. */
const TEXT_CACHE_LIMIT = 2;

const textCache = new Map<string, string>();

async function fetchWorkXml(work: Work): Promise<string> {
	const cached = textCache.get(work.path);
	if (cached !== undefined) {
		// Re-insert to keep the cache least-recently-used ordered.
		textCache.delete(work.path);
		textCache.set(work.path, cached);
		return cached;
	}
	const res = await fetch(rawUrl(work.repo, work.path), {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "application/xml,text/xml,*/*",
		},
	});
	if (!res.ok) {
		throw new Error(
			`Perseus: download failed (${res.status}) for ${work.path}`,
		);
	}
	textCache.set(work.path, res.body);
	while (textCache.size > TEXT_CACHE_LIMIT) {
		const oldest = textCache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		textCache.delete(oldest);
	}
	return res.body;
}

interface WorkMeta {
	title: string;
	author: string;
	episodes: { uid: string; name: string }[];
}

const metaCache = new Map<string, WorkMeta>();

async function fetchWorkMeta(work: Work): Promise<WorkMeta> {
	const cached = metaCache.get(work.uid);
	if (cached) {
		return cached;
	}
	const xml = await fetchWorkXml(work);
	const header = extractHeader(xml);
	const episodes = extractParts(xml).map((part) => ({
		uid: part.uid,
		name: part.name,
	}));
	const meta: WorkMeta = {
		title: header.title || work.title,
		author: header.author || work.author,
		episodes,
	};
	metaCache.set(work.uid, meta);
	return meta;
}

/** Episode ids are "<work uid>#<part uid>", e.g. "iliad#1". */
function parseEpisodeId(epid: EpisodeId): { workUid: string; partUid: string } {
	const hash = epid.uid.indexOf("#");
	if (hash === -1) {
		return { workUid: epid.uid, partUid: "full" };
	}
	return {
		workUid: epid.uid.slice(0, hash),
		partUid: epid.uid.slice(hash + 1),
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default class PerseusExtension
	extends DionExtension
	implements SourceProvider
{
	settings = {};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	private workToEntry(work: Work): Entry {
		return {
			id: { uid: work.uid },
			url: blobUrl(work.repo, work.path),
			title: work.title,
			media_type: "Book",
			author: [work.author],
		};
	}

	private findWork(uid: string): Work {
		const work = WORKS.find((w) => w.uid === uid);
		if (!work) {
			throw new Error(`Perseus: unknown work "${uid}"`);
		}
		return work;
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const start = Math.max(0, page) * PAGE_SIZE;
		const slice = WORKS.slice(start, start + PAGE_SIZE);
		return {
			content: slice.map((work) => this.workToEntry(work)),
			hasnext: WORKS.length > start + PAGE_SIZE,
			length: slice.length,
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim().toLowerCase();
		if (term.length === 0 || page > 0) {
			return { content: [], hasnext: false, length: 0 };
		}
		const content = WORKS.filter((work) =>
			`${work.title} ${work.author} ${work.lang}`.toLowerCase().includes(term),
		).map((work) => this.workToEntry(work));
		return { content, hasnext: false, length: content.length };
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const work = this.findWork(entryid.uid);
		const meta = await fetchWorkMeta(work);
		const url = blobUrl(work.repo, work.path);
		const language = work.lang === "grc" ? "Ancient Greek" : "Latin";
		const titles =
			meta.title !== work.title ? [work.title, meta.title] : [work.title];
		const entry: EntryDetailed = {
			id: { uid: work.uid },
			url,
			titles,
			author: [meta.author],
			media_type: "Book",
			status: "Complete",
			description: `${work.description}\n\nOriginal ${language} text. ${ATTRIBUTION}.`,
			language: work.lang,
			episodes: meta.episodes.map((part) => ({
				id: { uid: `${work.uid}#${part.uid}` },
				name: part.name,
				url: rawUrl(work.repo, work.path),
			})),
			genres: [language],
			ui: Column(
				Text(`Source: ${ATTRIBUTION}`),
				Link(url, "View the TEI file on GitHub"),
			),
		};
		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const { workUid, partUid } = parseEpisodeId(epid);
		const work = this.findWork(workUid);
		const xml = await fetchWorkXml(work);
		const part = extractParts(xml).find((p) => p.uid === partUid);
		if (!part) {
			throw new Error(
				`Perseus: no readable text "${partUid}" in "${work.uid}"`,
			);
		}
		const paragraphs = extractParagraphs(
			xml,
			part.contentStart,
			part.contentEnd,
		);
		if (paragraphs.length === 0) {
			throw new Error(`Perseus: no text extracted for "${epid.uid}"`);
		}
		paragraphs.push({
			type: "Text",
			content: `Source: ${ATTRIBUTION}`,
			style: { italic: true },
		});
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
