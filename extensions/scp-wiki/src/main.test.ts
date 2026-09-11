/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: These are tests */
/// <reference types="@types/bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import {
	assertValidEntries,
	assertValidEntry,
	assertValidSource,
	getTestExtension,
	MockManagerClient,
} from "@dion-js/extension-test-utils";
import type { Extension } from "@dion-js/runtime";
import type {
	Entry,
	EntryDetailedResult,
	Paragraph,
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	ALL_SERIES,
	articleNumber,
	articleUrl,
	composeDescription,
	composeTitle,
	decodeEntities,
	episodeUid,
	extractArticleRegion,
	htmlToText,
	parseArticleParagraphs,
	parseArticleSlug,
	parseContentWarning,
	parseEpisodeUid,
	parseItemNumber,
	parseLicenseAuthor,
	parseObjectClass,
	parsePageTitle,
	parseRating,
	parseSeriesList,
	parseTags,
	paragraphText,
	seriesUrl,
	SERIES,
} from "./site.ts";

let extension: Extension;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

/** Plain text of a source paragraph, mixing Text and Mixed runs. */
function textOf(paragraph: Paragraph): string {
	if (paragraph.type === "Text") {
		return paragraph.content;
	}
	if (paragraph.type === "Mixed") {
		return paragraph.content
			.map((part) => (part.type === "Text" ? part.content : ""))
			.join(" ");
	}
	return "";
}

// -- Fixtures (trimmed excerpts of real pages, verified live) ---------------

// From https://scp-wiki.wikidot.com/scp-series
const SERIES_FIXTURE = `
<div class="page-tags"></div>
<div id="page-content">
<p>SCP-001 through SCP-999.</p>
<ul>
<li><a href="/scp-001">SCP-001</a> - Awaiting De-classification [Blocked]</li>
<li><a href="/scp-002">SCP-002</a> - The &quot;Living&quot; Room</li>
<li><a href="/scp-005">SCP-005</a> - <span style="white-space: pre-wrap;">Black Key</span></li>
<li><a href="/scp-173">SCP-173</a> - The Sculpture - <strong>The Original</strong></li>
<li><a href="/scp-173">SCP-173</a> - The Sculpture - <strong>The Original</strong></li>
</ul>
</div>`;

// From https://scp-wiki.wikidot.com/scp-173 (classic format).
const ARTICLE_CLASSIC_FIXTURE = `
<html><head><title>SCP-173 - SCP Foundation</title></head>
<body>
<div id="page-content">
<div style="text-align: right;"><div class="page-rate-widget-box"><span class="rate-points">rating:&nbsp;<span class="number prw54353">+11045</span></span><span class="rateup"><a>+</a></span><span class="ratedown"><a>&#8211;</a></span></div></div>
<p><strong>Item #:</strong> SCP-173</p>
<p><strong>Object Class:</strong> Euclid</p>
<p><strong>Special Containment Procedures:</strong> Item SCP-173 is to be kept in a locked container at all times.</p>
<blockquote><p>Footnote: personnel are instructed to alert one another before blinking.</p></blockquote>
<p><strong>Description:</strong> Moved to Site-19&#160;1993. Origin is as of yet unknown.</p>
<p>Personnel report sounds of scraping stone originating from within the container.</p>
<table>
<tr><th>Site</th><th>Status</th></tr>
<tr><td>Site-19</td><td>Active</td></tr>
</table>
<div class="footer-wikiwalk-nav"><p>&#171; <a href="/scp-172">SCP-172</a> | SCP-173 | <a href="/scp-174">SCP-174</a> &#187;</p></div>
<div class="licensebox"><p>Cite this page as:</p><blockquote><p>&quot;<a href="/scp-173">SCP-173</a>&quot; by Moto42, from the <a href="https://scpwiki.com">SCP Wiki</a>. Source: <a href="https://scpwiki.com/scp-173">https://scpwiki.com/scp-173</a>. Licensed under <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA</a>.</p></blockquote></div>
<div class="page-tags"><a href="/system:page-tags/tag/_licensebox#pages">_licensebox</a><a href="/system:page-tags/tag/euclid#pages">euclid</a><a href="/system:page-tags/tag/horror#pages">horror</a></div>
<div id="page-info">page revision: 57</div>
</body></html>`;

// A component-heavy (experimental-format) article: content warning banner,
// component divs, a tabview and headings instead of classic paragraphs.
const ARTICLE_COMPONENT_FIXTURE = `
<html><head><title>SCP-5999 - SCP Foundation</title></head>
<body>
<div id="page-content">
<div class="content-warning"><div class="warning-inner"><p>This file mentions violence and body horror.</p></div></div>
<div class="anom-bar"><div class="main-class"><p>Item #: SCP-5999</p></div></div>
<h2>Overview</h2>
<div class="tabview"><div class="tab-content"><p>SCP-5999 is a meme complex maintained by the Database.</p><br><br><p>It attacks through the documentation itself.</p></div></div>
<div class="collapsible-block-folded"><a href="javascript:;">Show credits</a></div>
</div>
<div class="page-tags"><a href="/system:page-tags/tag/5999#pages">5999</a><a href="/system:page-tags/tag/meme#pages">meme</a></div>
</body></html>`;

// -- Pure helpers -----------------------------------------------------------

describe("text helpers", () => {
	it("should decode named and numeric entities", () => {
		expect(
			decodeEntities(
				"SCP&#39;s &#8220;Euclid&#8221; &amp; the &#x39C;useum&nbsp;end",
			),
		).toBe("SCP's “Euclid” & the Μuseum end");
		// Unknown named entities stay as-is instead of mangling the text.
		expect(decodeEntities("&nosuchthing;")).toBe("&nosuchthing;");
	});

	it("should flatten html snippets to single-line text", () => {
		expect(
			htmlToText(
				"<style>x</style><!-- c -->SCP&nbsp;173<br>The Statue<script>nope()</script>",
			),
		).toBe("SCP 173 The Statue");
	});
});

describe("id helpers", () => {
	it("should round-trip article uids and urls", () => {
		expect(parseArticleSlug("scp-173")).toEqual({ slug: "scp-173" });
		expect(parseArticleSlug("  SCP-173 ")).toEqual({ slug: "scp-173" });
		expect(parseArticleSlug("scp-173-j")).toBeNull();
		expect(parseArticleSlug("tales-by-date-hub")).toBeNull();
		expect(articleUrl("scp-173")).toBe("https://scp-wiki.wikidot.com/scp-173");
		expect(seriesUrl("scp-series")).toBe(
			"https://scp-wiki.wikidot.com/scp-series",
		);
		expect(articleNumber("scp-173")).toBe("SCP-173");
	});

	it("should round-trip episode uids", () => {
		expect(parseEpisodeUid(episodeUid("scp-173"))).toEqual({
			slug: "scp-173",
		});
		expect(parseEpisodeUid("scp-173")).toEqual({ slug: "scp-173" });
		expect(parseEpisodeUid("scp-173#write")).toEqual({ slug: "scp-173" });
		expect(parseEpisodeUid("tales#read")).toBeNull();
		expect(parseEpisodeUid("#read")).toBeNull();
	});

	it("should compose titles like the site listings", () => {
		expect(composeTitle("SCP-173", "The Sculpture")).toBe(
			"SCP-173 — The Sculpture",
		);
		expect(composeTitle("SCP-055", null)).toBe("SCP-055");
	});
});

describe("series listing pages", () => {
	it("should parse entries with numbers and titles", () => {
		const items = parseSeriesList(SERIES_FIXTURE);
		expect(items).toHaveLength(4); // duplicate scp-173 is dropped
		expect(items.map((item) => item.slug)).toEqual([
			"scp-001",
			"scp-002",
			"scp-005",
			"scp-173",
		]);
		const sculpture = items[3]!;
		expect(sculpture.title).toBe("The Sculpture"); // strong annotation dropped
		expect(sculpture.number).toBe("SCP-173");
		expect(sculpture.url).toBe("https://scp-wiki.wikidot.com/scp-173");
		expect(items[1]?.title).toBe('The "Living" Room'); // entities decoded
		expect(items[2]?.title).toBe("Black Key"); // span markup stripped
	});

	it("should tolerate titles without annotations", () => {
		const body = SERIES_FIXTURE.replaceAll(
			/\s*-\s*The Sculpture\s*-\s*<strong>The Original<\/strong>/g,
			"",
		);
		const items = parseSeriesList(body);
		expect(items[3]?.title).toBeNull();
	});

	it("should declare the ten mainline series", () => {
		expect(SERIES).toHaveLength(10);
		expect(SERIES[0]?.slug).toBe("scp-series");
		expect(SERIES[9]?.label).toContain("SCP-9000");
	});
});

describe("article pages", () => {
	it("should cut the readable region before the site chrome", () => {
		const region = extractArticleRegion(ARTICLE_CLASSIC_FIXTURE);
		expect(region).toContain("Special Containment Procedures");
		expect(region).not.toContain("wikiwalk");
		expect(region).not.toContain("Cite this page as");
		expect(region).not.toContain("page revision");
		expect(extractArticleRegion("<html>no content</html>")).toBe("");
	});

	it("should parse the classic article into clean paragraphs", () => {
		const region = extractArticleRegion(ARTICLE_CLASSIC_FIXTURE);
		const paragraphs = parseArticleParagraphs(region);
		// "Item #:" bold label + value; the rating widget is gone.
		expect(paragraphs[0]).toEqual({
			kind: "mixed",
			parts: [
				{ content: "Item #:", bold: true },
				{ content: "SCP-173", bold: false },
			],
		});
		const texts = paragraphs.map(paragraphText);
		expect(texts.some((t) => t.includes("rating:"))).toBe(false);
		expect(texts.some((t) => t.includes("alert one another"))).toBe(true);
		expect(texts.some((t) => t.includes("Moved to Site-19 1993"))).toBe(true);
		// Table rows become simple text lines with cell separators.
		expect(texts).toContain("Site | Status");
		expect(texts).toContain("Site-19 | Active");
		// No chrome leaks into the article text.
		expect(texts.some((t) => t.includes("SCP-174"))).toBe(false);
	});

	it("should degrade gracefully on component-heavy pages", () => {
		const region = extractArticleRegion(ARTICLE_COMPONENT_FIXTURE);
		const paragraphs = parseArticleParagraphs(region);
		const texts = paragraphs.map(paragraphText);
		expect(texts.length).toBeGreaterThanOrEqual(4);
		expect(texts.join("\n")).toContain("meme complex");
		// No raw markup survives.
		for (const text of texts) {
			expect(text).not.toMatch(/<[^>]+>/);
		}
	});

	it("should extract metadata from the page", () => {
		const body = ARTICLE_CLASSIC_FIXTURE;
		expect(parsePageTitle(body)).toBe("SCP-173");
		expect(parseObjectClass(body)).toBe("Euclid");
		expect(parseItemNumber(body)).toBe("SCP-173");
		expect(parseRating(body)).toBe(11045);
		expect(parseLicenseAuthor(body)).toBe("Moto42");
		expect(parseTags(body)).toEqual(["euclid", "horror"]);
		expect(parseRating("no widget")).toBeNull();
		expect(parseLicenseAuthor("no licensebox")).toBeNull();
		expect(parseTags("no tags")).toEqual([]);
	});

	it("should extract content warnings from componentized pages", () => {
		const region = extractArticleRegion(ARTICLE_COMPONENT_FIXTURE);
		expect(parseContentWarning(region)).toBe(
			"This file mentions violence and body horror.",
		);
		expect(
			parseContentWarning(extractArticleRegion(ARTICLE_CLASSIC_FIXTURE)),
		).toBeNull();
	});

	it("should compose descriptions from the Description section", () => {
		const region = extractArticleRegion(ARTICLE_CLASSIC_FIXTURE);
		const paragraphs = parseArticleParagraphs(region);
		const description = composeDescription(paragraphs, null);
		expect(description).toBe(
			"Moved to Site-19 1993. Origin is as of yet unknown. Personnel report sounds of scraping stone originating from within the container.",
		);
		const warned = composeDescription(
			parseArticleParagraphs(extractArticleRegion(ARTICLE_COMPONENT_FIXTURE)),
			"This file mentions violence.",
		);
		expect(
			warned.startsWith("Content warning: This file mentions violence."),
		).toBe(true);
	});
});

// -- Live flow through the built extension ----------------------------------

describe("Extension", () => {
	it("should start as an English book source", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Book");
		expect(data.lang).toContain("en");
		expect(data.nsfw).toBe(false);
	}, 120_000);

	it("should declare its network permission", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(["scp-wiki.wikidot.com"]);
		}
	});

	it("should browse the series listings", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content).toHaveLength(24);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.id.uid).toBe("scp-001");
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.title).toContain("SCP-001");
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate browse without duplicates", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content).toHaveLength(24);
		const ids0 = browseResult.map((entry) => entry.id.uid);
		const ids1 = page1.content.map((entry) => entry.id.uid);
		expect(ids1).not.toEqual(ids0);
		expect(ids0.filter((id) => ids1.includes(id))).toEqual([]);
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should find SCP-173 by its listing title", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "sculpture");
		expect(result.hasnext).toBe(false);
		const entry = result.content.find((item) => item.id.uid === "scp-173");
		expect(entry).toBeDefined();
		expect(entry?.title).toBe("SCP-173 — The Sculpture");
		await assertValidEntries(result.content);
	}, 120_000);

	it("should also match searches against the article number", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "scp-173");
		expect(result.content.map((entry) => entry.id.uid)).toContain("scp-173");
	}, 120_000);

	it("should return nothing for empty or unmatched searches", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const empty = await extension!.search(0, "   ");
		expect(empty.content).toHaveLength(0);
		const nohit = await extension!.search(0, "no such containment file xyz");
		expect(nohit.content).toHaveLength(0);
		expect(nohit.hasnext).toBe(false);
	});

	it("should detail SCP-173 with object class, rating and CC note", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail({ uid: "scp-173" }, { probe });
		const entry = result.entry;
		expect(entry.id.uid).toBe("scp-173");
		expect(entry.media_type).toBe("Book");
		expect(entry.language).toBe("en");
		expect(entry.status).toBe("Complete");
		expect(entry.titles[0]).toBe("SCP-173 — The Sculpture");
		expect(entry.url).toBe("https://scp-wiki.wikidot.com/scp-173");
		expect(entry.author).toEqual(["Moto42"]);
		expect(entry.meta?.["Object Class"]).toBe("Euclid");
		expect(entry.rating).toBeGreaterThan(1000);
		expect(entry.description).toContain("Site-19");
		expect(entry.genres).toContain("euclid");
		expect(entry.episodes).toHaveLength(1);
		expect(entry.episodes[0]!.name).toBe("Read");
		expect(entry.episodes[0]!.id.uid).toBe("scp-173#read");
		// Attribution and share-alike note in the detail UI.
		expect(JSON.stringify(entry.ui)).toContain("CC BY-SA 3.0");
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(entry);
		detailResult = result;
	}, 120_000);

	it("should source SCP-173 as bold-labelled reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(3);
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);

		// The "Item #:" label leads as a bold Mixed run, real prose follows.
		const first = result.source.paragraphs[0];
		expect(first?.type).toBe("Mixed");
		if (first?.type === "Mixed") {
			const label = first.content[0];
			if (label?.type === "Text") {
				expect(label.style?.bold).toBe(true);
				expect(label.content).toBe("Item #:");
			} else {
				throw new Error("First mixed part is not text");
			}
		}
		const texts = result.source.paragraphs.map(textOf);
		expect(texts.some((t) => t.startsWith("Object Class:"))).toBe(true);
		expect(texts.some((t) => t.includes("Euclid"))).toBe(true);
		expect(
			texts.some((t) => t.startsWith("Special Containment Procedures:")),
		).toBe(true);
		expect(texts.some((t) => t.includes("line of sight"))).toBe(true);
		// No site chrome or citation box leaks into the source.
		expect(texts.some((t) => t.includes("Cite this page"))).toBe(false);
		expect(texts.some((t) => t.includes("SCP-174"))).toBe(false);
	}, 120_000);

	it("should source a modern-format article from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source({ uid: "scp-5000#read" }, {});
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(20);
		const texts = result.source.paragraphs.map(textOf);
		expect(texts.some((t) => t.includes("SCP-5000"))).toBe(true);
	}, 120_000);

	it("should reject unknown article and episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(
			extension!.detail({ uid: "tales-by-date-hub" }, {}),
		).rejects.toThrow(/invalid article id/);
		await expect(extension!.source({ uid: "bogus#read" }, {})).rejects.toThrow(
			/invalid episode id/,
		);
	}, 120_000);

	it(`should reject article ids outside the mainline listings (default: ${ALL_SERIES})`, async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "scp-99999" }, {})).rejects.toThrow();
	}, 120_000);
});
