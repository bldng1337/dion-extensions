import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Divider, Link, Text } from "@dion-js/runtime-lib/ui.js";
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
	Paragraph,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml } from "parse";
import {
	AllpagesResponse,
	apiErrorMessage,
	apiUrl,
	ATTRIBUTION,
	CategorymembersResponse,
	chapterName,
	collectParagraphs,
	FEATURED_CATEGORIES,
	findCoverUrl,
	firstParagraphText,
	type IdData,
	LANGUAGES,
	LANGUAGE_SETTING_ID,
	makeIdData,
	makeUid,
	naturalCompare,
	PAGE_SIZE,
	parseIdData,
	parseNamespaceMap,
	parseUid,
	ParseResponse,
	SearchResponse,
	stripHtml,
	splitTitleNamespace,
	type NamespacesResponse,
	USER_AGENT,
	wikiUrl,
} from "./wikibooks.ts";

// The runtime requires CSSSelector objects, not selector strings.
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

/** Converts the `action=parse` HTML of a book/chapter page into reading
 * paragraphs. */
function htmlToParagraphs(html: string): Paragraph[] {
	const doc = parseHtml(html);
	const root = doc.select(q("div.mw-parser-output")).first ?? doc;
	return collectParagraphs(root);
}

/** Namespace maps per language subdomain, resolved once per process. */
const namespaceCache = new Map<string, Record<string, number>>();

export default class extends DionExtension implements SourceProvider {
	settings = {
		language: new ExtensionSetting<string>(
			LANGUAGE_SETTING_ID,
			"en",
			"Extension",
		)
			.setLabel("Language edition")
			.setUI(new Dropdown(LANGUAGES)),
	};
	accounts = {};
	entrySettings = {};

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		return undefined;
	}

	// -- MediaWiki API client ------------------------------------------------

	private async apiGet(
		lang: string,
		pairs: [string, string][],
	): Promise<unknown> {
		const res = await fetch(apiUrl(lang, pairs), {
			headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
		});
		if (!res.ok) {
			throw new Error(
				`Wikibooks request failed (${res.status}) on ${lang}.wikibooks.org`,
			);
		}
		return res.json;
	}

	/** Rendered HTML of a page, following redirects (chapter subpages that
	 * were merged into other pages resolve transparently). */
	private async fetchParsedHtml(
		lang: string,
		title: string,
	): Promise<{ html: string; parsedTitle: string }> {
		const data = (await this.apiGet(lang, [
			["action", "parse"],
			["page", title],
			["prop", "text"],
			["redirects", "1"],
			["disablelimitreport", "1"],
		])) as ParseResponse;
		const html = data.parse?.text?.["*"];
		if (typeof html !== "string" || html.length === 0) {
			throw new Error(
				apiErrorMessage(
					data,
					`Wikibooks: could not render "${title}" on ${lang}.wikibooks.org`,
				),
			);
		}
		return { html, parsedTitle: data.parse?.title ?? title };
	}

	/** Namespace id map for a language edition (cached per process). */
	private async fetchNamespaces(lang: string): Promise<Record<string, number>> {
		const cached = namespaceCache.get(lang);
		if (cached) {
			return cached;
		}
		const data = (await this.apiGet(lang, [
			["action", "query"],
			["meta", "siteinfo"],
			["siprop", "namespaces"],
		])) as NamespacesResponse;
		const map = parseNamespaceMap(data);
		namespaceCache.set(lang, map);
		return map;
	}

	/** Subpages of a book (`Book Title/…`, or `<Leaf>/…` inside the book's
	 * custom namespace such as Wikijunior:), natural-sorted. Books without
	 * chapters (single-page books) return an empty list. Listing failures are
	 * degraded to an empty list so the book itself stays readable. */
	private async fetchChapters(lang: string, book: string): Promise<string[]> {
		const titles: string[] = [];
		try {
			const namespaces = await this.fetchNamespaces(lang);
			const split = splitTitleNamespace(book, namespaces);
			let from: string | undefined;
			for (let request = 0; request < 4 && titles.length < 1500; request++) {
				const pairs: [string, string][] = [
					["action", "query"],
					["list", "allpages"],
					["apprefix", `${split.leaf}/`],
					["apnamespace", String(split.namespace)],
					["aplimit", "500"],
				];
				if (from) {
					pairs.push(["apfrom", from]);
				}
				const data = (await this.apiGet(lang, pairs)) as AllpagesResponse;
				if (data.error) {
					break;
				}
				for (const page of data.query?.allpages ?? []) {
					if (page.title) {
						titles.push(page.title);
					}
				}
				from = data["continue"]?.apcontinue;
				if (!from) {
					break;
				}
			}
		} catch {
			return titles;
		}
		return titles.sort(naturalCompare);
	}

	/** Members of a category listing (used for the curated English browse).
	 * Fetches `need` members so callers can decide `hasnext` reliably. */
	private async fetchCategoryMembers(
		lang: string,
		category: string,
		need: number,
	): Promise<string[]> {
		const titles: string[] = [];
		let cont: string | undefined;
		for (let request = 0; request < 2 && titles.length < need; request++) {
			const pairs: [string, string][] = [
				["action", "query"],
				["list", "categorymembers"],
				["cmtitle", category],
				["cmnamespace", "0"],
				["cmlimit", String(Math.min(500, Math.max(1, need)))],
			];
			if (cont) {
				pairs.push(["cmcontinue", cont]);
			}
			const data = (await this.apiGet(lang, pairs)) as CategorymembersResponse;
			if (data.error) {
				throw new Error(
					apiErrorMessage(data, "Wikibooks: category listing failed"),
				);
			}
			for (const member of data.query?.categorymembers ?? []) {
				if (member.title && !member.title.includes("/")) {
					titles.push(member.title);
				}
			}
			cont = data["continue"]?.cmcontinue;
			if (!cont) {
				break;
			}
		}
		return titles;
	}

	/** Alphabetical listing of top-level books, used as the browse fallback
	 * for language editions without a curated category. */
	private async fetchWorks(
		lang: string,
		page: number,
	): Promise<{ titles: string[]; hasnext: boolean }> {
		const need = (Math.max(0, page) + 1) * PAGE_SIZE + 1;
		const titles: string[] = [];
		let from: string | undefined;
		for (let request = 0; request < 4 && titles.length < need; request++) {
			const pairs: [string, string][] = [
				["action", "query"],
				["list", "allpages"],
				["apnamespace", "0"],
				["apfilterredir", "nonredirects"],
				["aplimit", "500"],
			];
			if (from) {
				pairs.push(["apfrom", from]);
			}
			const data = (await this.apiGet(lang, pairs)) as AllpagesResponse;
			if (data.error) {
				throw new Error(
					apiErrorMessage(data, "Wikibooks: book listing failed"),
				);
			}
			for (const wikiPage of data.query?.allpages ?? []) {
				if (wikiPage.title && !wikiPage.title.includes("/")) {
					titles.push(wikiPage.title);
				}
			}
			from = data["continue"]?.apcontinue;
			if (!from) {
				break;
			}
		}
		const start = Math.max(0, page) * PAGE_SIZE;
		return {
			titles: titles.slice(start, start + PAGE_SIZE),
			hasnext: titles.length > start + PAGE_SIZE,
		};
	}

	// -- SourceProvider ------------------------------------------------------

	async browse(page: number): Promise<EntryList> {
		const lang = await this.settings.language.get();
		const category = FEATURED_CATEGORIES[lang];
		if (category) {
			// One extra member beyond the page size makes hasnext exact.
			const need = Math.min((Math.max(0, page) + 1) * PAGE_SIZE + 1, 500);
			const members = await this.fetchCategoryMembers(lang, category, need);
			const start = Math.max(0, page) * PAGE_SIZE;
			const slice = members.slice(start, start + PAGE_SIZE);
			if (slice.length > 0 || (page === 0 && members.length === 0)) {
				return {
					content: slice.map((title) => this.bookToEntry(lang, title)),
					hasnext: members.length > start + PAGE_SIZE,
				};
			}
			return { content: [], hasnext: false };
		}
		const works = await this.fetchWorks(lang, page);
		return {
			content: works.titles.map((title) => this.bookToEntry(lang, title)),
			hasnext: works.hasnext,
		};
	}

	private bookToEntry(lang: string, title: string): Entry {
		return {
			id: {
				uid: makeUid(lang, title),
				iddata: makeIdData({ lang, title }),
			},
			url: wikiUrl(lang, title),
			title,
			media_type: "Book",
		};
	}

	async search(page: number, filter: string): Promise<EntryList> {
		const term = filter.trim();
		if (term.length === 0) {
			return { content: [], hasnext: false };
		}
		const lang = await this.settings.language.get();
		const offset = Math.max(0, page) * PAGE_SIZE;
		const data = (await this.apiGet(lang, [
			["action", "query"],
			["list", "search"],
			["srsearch", term],
			["srnamespace", "0"],
			["srlimit", String(PAGE_SIZE)],
			["sroffset", String(offset)],
			["srprop", "snippet"],
		])) as SearchResponse;
		if (data.error) {
			throw new Error(apiErrorMessage(data, "Wikibooks search failed"));
		}
		const content: Entry[] = [];
		for (const hit of data.query?.search ?? []) {
			if (!hit.title) {
				continue;
			}
			content.push({
				id: {
					uid: makeUid(lang, hit.title),
					iddata: makeIdData({
						lang,
						title: hit.title,
						snippet: hit.snippet,
					}),
				},
				url: wikiUrl(lang, hit.title),
				title: hit.title,
				media_type: "Book",
			});
		}
		return {
			content,
			hasnext: data["continue"]?.sroffset !== undefined,
		};
	}

	async detail(
		entryid: EntryId,
		settings: Record<string, Setting>,
	): Promise<EntryDetailedResult> {
		const data: IdData =
			parseIdData(entryid.iddata) ??
			(() => {
				const parsed = parseUid(entryid.uid);
				return { lang: parsed.lang, title: parsed.title };
			})();
		const lang = data.lang;
		const title = data.title;

		const [page, chapters] = await Promise.all([
			this.fetchParsedHtml(lang, title),
			this.fetchChapters(lang, title),
		]);

		const cover = findCoverUrl(page.html);
		const description =
			(data.snippet ? stripHtml(data.snippet) : "") ||
			firstParagraphText(page.html) ||
			`"${title}" on ${lang}.wikibooks.org.`;

		const episodes: Episode[] = chapters.map((chapter) => ({
			id: {
				uid: makeUid(lang, chapter),
				iddata: makeIdData({ lang, title: chapter }),
			},
			name: chapterName(chapter, title),
			url: wikiUrl(lang, chapter),
		}));
		if (episodes.length === 0) {
			// Single-page book: the book page itself is the readable content.
			episodes.push({
				id: { uid: makeUid(lang, title), iddata: makeIdData({ lang, title }) },
				name: "Read",
				url: wikiUrl(lang, title),
			});
		}

		const entry: EntryDetailed = {
			id: { uid: makeUid(lang, title), iddata: makeIdData({ lang, title }) },
			url: wikiUrl(lang, title),
			titles: [title],
			author: null,
			media_type: "Book",
			status: "Unknown",
			description,
			language: lang,
			cover: cover ? { url: cover } : undefined,
			episodes,
			ui: Column(
				Link(wikiUrl(lang, title), `Open "${title}" on Wikibooks`),
				Divider(),
				Text(ATTRIBUTION),
			),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const data = parseIdData(epid.iddata) ?? parseUid(epid.uid);
		const page = await this.fetchParsedHtml(data.lang, data.title);
		const paragraphs = htmlToParagraphs(page.html);
		if (paragraphs.length === 0) {
			throw new Error(`Wikibooks: no readable text found for "${data.title}"`);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
