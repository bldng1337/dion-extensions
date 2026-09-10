import { DionExtension } from "@dion-js/runtime-lib";
import { Dropdown, ExtensionSetting } from "@dion-js/runtime-lib/settings.js";
import { Column, Link } from "@dion-js/runtime-lib/ui.js";
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
	TextStyle,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml, type DionElement } from "parse";
import {
	AllpagesResponse,
	apiErrorMessage,
	apiUrl,
	CategorymembersResponse,
	chapterName,
	cleanParagraphText,
	extractAuthor,
	extractVersionsLink,
	FEATURED_CATEGORIES,
	findCoverUrl,
	firstParagraphText,
	hasVersionsList,
	LANGUAGES,
	LANGUAGE_SETTING_ID,
	makeEpubUid,
	makeIdData,
	makeUid,
	naturalCompare,
	PAGE_SIZE,
	parseIdData,
	parseUid,
	ParseResponse,
	SearchResponse,
	stripHtml,
	USER_AGENT,
	wikiUrl,
	wsExportUrl,
} from "./wikisource.ts";

// The runtime requires CSSSelector objects, not selector strings.
function q(selector: string): CSSSelector {
	return new CSSSelector(selector);
}

// ---------------------------------------------------------------------------
// Rendered HTML -> Paragraph conversion
// ---------------------------------------------------------------------------

/** Inline/noise tags whose text is either covered by the parent block or
 * never wanted (images, scripts, styles). */
const SKIP_TAGS = new Set([
	"style",
	"script",
	"link",
	"meta",
	"img",
	"figure",
	"audio",
	"video",
	"source",
	"track",
	"picture",
	"input",
	"button",
	"select",
	"textarea",
	"canvas",
	"svg",
]);

/** Header templates, maintenance boxes, reference lists, page numbers etc. —
 * everything that is not running prose. */
const SKIP_CLASSES = new Set([
	"ws-noexport",
	"noprint",
	"mw-editsection",
	"mw-references-wrap",
	"references",
	"reference",
	"mw-ref",
	"reflink",
	"pagenum",
	"ws-pagenum",
	"headertemplate",
	"wst-header",
	"ws-header",
	"subNote",
	"plainSister",
	"toc",
	"catlinks",
	"printfooter",
	"magnify",
	"licenseContainer",
	"ws-license",
	"licensetpl",
	"navbox",
	"ambox",
	"ombox",
	"tmbox",
	"dmbox",
	"shortcut",
]);

const SKIP_IDS = new Set([
	"ws-data",
	"toc",
	"siteSub",
	"jump-to-nav",
	"catlinks",
	"footer",
]);

/** Block elements emitted as one text paragraph (their whole subtree text). */
const EMIT_TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"dt",
	"dd",
	"td",
	"th",
	"figcaption",
	"pre",
	"center",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Structural wrappers that are recursed into. MediaWiki wraps orphan text
 * in <p> automatically, so recursing loses no visible text. */
const CONTAINER_TAGS = new Set([
	"div",
	"section",
	"article",
	"main",
	"header",
	"footer",
	"blockquote",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"ul",
	"ol",
	"dl",
]);

function isSkippable(cls: string, id: string): boolean {
	if (id.length > 0 && SKIP_IDS.has(id)) {
		return true;
	}
	for (const token of cls.split(/\s+/)) {
		if (token.length > 0 && SKIP_CLASSES.has(token)) {
			return true;
		}
	}
	return false;
}

/** Template CSS sometimes leaks into an element's text extraction. */
function isCssJunk(text: string): boolean {
	return (
		text.includes(".mw-parser-output") ||
		text.startsWith("@media") ||
		(text.includes("{") && text.includes("}"))
	);
}

function pushParagraph(
	out: Paragraph[],
	text: string,
	style: TextStyle | null,
) {
	if (text.length > 0 && !isCssJunk(text)) {
		out.push({ type: "Text", content: text, style });
	}
}

function walk(el: DionElement, out: Paragraph[], depth: number): void {
	if (depth > 24) {
		return;
	}
	const children = el.children;
	for (let i = 0; i < children.length; i++) {
		const child = children.get(i);
		if (!child) {
			continue;
		}
		const name = child.name.toLowerCase();
		if (SKIP_TAGS.has(name)) {
			continue;
		}
		if (isSkippable(child.attr("class") ?? "", child.attr("id") ?? "")) {
			continue;
		}
		if (EMIT_TAGS.has(name)) {
			const text = cleanParagraphText(child.text);
			if (name === "li") {
				pushParagraph(out, `• ${text}`, null);
			} else if (HEADING_TAGS.has(name)) {
				pushParagraph(out, text, { bold: true });
			} else if (name === "figcaption") {
				pushParagraph(out, text, { italic: true });
			} else {
				pushParagraph(out, text, null);
			}
			continue;
		}
		if (CONTAINER_TAGS.has(name)) {
			walk(child, out, depth + 1);
		}
		// Inline elements (span, a, b, i, …) contribute their text through
		// the emitting block ancestor.
	}
}

/** Converts the `action=parse` HTML of a work into reading paragraphs. */
export function htmlToParagraphs(html: string): Paragraph[] {
	const doc = parseHtml(html);
	const root = doc.select(q("div.mw-parser-output")).first ?? doc;
	const out: Paragraph[] = [];
	walk(root, out, 0);
	if (out.length === 0) {
		// Last resort for exotic structures: flatten the whole page.
		const text = cleanParagraphText(root.text);
		pushParagraph(out, text, null);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

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
				`Wikisource request failed (${res.status}) on ${lang}.wikisource.org`,
			);
		}
		return res.json;
	}

	/** Rendered HTML of a page, following redirects (many chapter subpages
	 * redirect to the standalone work). */
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
					`Wikisource: could not render "${title}" on ${lang}.wikisource.org`,
				),
			);
		}
		return { html, parsedTitle: data.parse?.title ?? title };
	}

	/** Subpages of a work (`Book Title/…`), natural-sorted. Works without
	 * chapters (single-page texts) return an empty list. */
	private async fetchChapters(lang: string, book: string): Promise<string[]> {
		const titles: string[] = [];
		let from: string | undefined;
		for (let request = 0; request < 4 && titles.length < 1500; request++) {
			const pairs: [string, string][] = [
				["action", "query"],
				["list", "allpages"],
				["apprefix", `${book}/`],
				["apnamespace", "0"],
				["aplimit", "500"],
			];
			if (from) {
				pairs.push(["apfrom", from]);
			}
			const data = (await this.apiGet(lang, pairs)) as AllpagesResponse;
			if (data.error) {
				throw new Error(
					apiErrorMessage(data, "Wikisource: chapter listing failed"),
				);
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
		return titles.sort(naturalCompare);
	}

	/** Members of a category listing (used for the curated English browse). */
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
					apiErrorMessage(data, "Wikisource: category listing failed"),
				);
			}
			for (const member of data.query?.categorymembers ?? []) {
				if (member.title) {
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

	/** Alphabetical listing of top-level works, used as the browse fallback
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
					apiErrorMessage(data, "Wikisource: work listing failed"),
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
			const need = Math.min((Math.max(0, page) + 1) * PAGE_SIZE, 500);
			const members = await this.fetchCategoryMembers(lang, category, need);
			const start = Math.max(0, page) * PAGE_SIZE;
			const slice = members.slice(start, start + PAGE_SIZE);
			if (slice.length > 0 || (page === 0 && members.length === 0)) {
				return {
					content: slice.map((title) => this.workToEntry(lang, title)),
					hasnext: members.length > start + PAGE_SIZE,
				};
			}
			if (slice.length === 0) {
				return { content: [], hasnext: false };
			}
		}
		const works = await this.fetchWorks(lang, page);
		return {
			content: works.titles.map((title) => this.workToEntry(lang, title)),
			hasnext: works.hasnext,
		};
	}

	private workToEntry(lang: string, title: string): Entry {
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
			throw new Error(apiErrorMessage(data, "Wikisource search failed"));
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
		const data =
			parseIdData(entryid.iddata) ??
			(() => {
				const parsed = parseUid(entryid.uid);
				return { lang: parsed.lang, title: parsed.title, snippet: undefined };
			})();
		const lang = data.lang;
		const title = data.title;

		const [page, chapters] = await Promise.all([
			this.fetchParsedHtml(lang, title),
			this.fetchChapters(lang, title),
		]);

		const author = extractAuthor(page.html);
		const cover = findCoverUrl(page.html);
		const description =
			(data.snippet ? stripHtml(data.snippet) : "") ||
			firstParagraphText(page.html) ||
			(hasVersionsList(page.html)
				? `Multiple versions of "${title}" are hosted on ${lang}.wikisource.org.`
				: `"${title}" on ${lang}.wikisource.org.`);

		const episodes: Episode[] = chapters.map((chapter) => ({
			id: {
				uid: makeUid(lang, chapter),
				iddata: makeIdData({ lang, title: chapter }),
			},
			name: chapterName(chapter, title),
			url: wikiUrl(lang, chapter),
		}));
		if (episodes.length === 0) {
			episodes.push({
				id: { uid: makeUid(lang, title), iddata: makeIdData({ lang, title }) },
				name: "Read",
				url: wikiUrl(lang, title),
			});
		}
		episodes.push({
			id: {
				uid: makeEpubUid(lang, title),
				iddata: makeIdData({ lang, title, epub: true }),
			},
			name: "Full book (EPUB)",
			description: "EPUB generated on the fly by Wikisource WS Export",
			url: wikiUrl(lang, title),
		});

		const entry: EntryDetailed = {
			id: { uid: makeUid(lang, title), iddata: makeIdData({ lang, title }) },
			url: wikiUrl(lang, title),
			titles: [title],
			author: author ? [author] : null,
			media_type: "Book",
			status: "Complete",
			description,
			language: lang,
			cover: cover ? { url: cover } : undefined,
			episodes,
			ui: Column(Link(wikiUrl(lang, title), "Open on Wikisource")),
		};

		return { entry, settings: { ...settings } };
	}

	async source(
		epid: EpisodeId,
		settings: Record<string, Setting>,
	): Promise<SourceResult> {
		const data = parseIdData(epid.iddata) ?? parseUid(epid.uid);
		if (data.epub) {
			return {
				source: {
					type: "Epub",
					link: { url: wsExportUrl(data.lang, data.title) },
				},
				settings: { ...settings },
			};
		}

		let page = await this.fetchParsedHtml(data.lang, data.title);
		if (hasVersionsList(page.html)) {
			// "Versions of X" disambiguation page: follow its first work link
			// (e.g. the original magazine publication) instead of showing the
			// version list itself.
			const follow = extractVersionsLink(page.html);
			if (follow && follow !== page.parsedTitle && follow !== data.title) {
				page = await this.fetchParsedHtml(data.lang, follow);
			}
		}

		const paragraphs = htmlToParagraphs(page.html);
		if (paragraphs.length === 0) {
			throw new Error(`Wikisource: no readable text found for "${data.title}"`);
		}
		return {
			source: { type: "Paragraphlist", paragraphs },
			settings: { ...settings },
		};
	}
}
