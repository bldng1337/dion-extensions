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
	Setting,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	BASE,
	chapterParagraphs,
	chapterSlugFromHref,
	chapterUid,
	decodeEntities,
	extractProse,
	htmlToText,
	inlineText,
	overviewPageUrl,
	parseBookCards,
	parseBooksSitemap,
	parseChapterData,
	parseChapterUid,
	parseOverview,
	paragraphText,
	titleFromUid,
	toShellUrl,
	tokenizeQuery,
	matchesQuery,
	uidFromHref,
} from "./site.ts";

let extension: Extension;

let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

// -- Pure helpers -----------------------------------------------------------

describe("text helpers", () => {
	it("should decode named and numeric entities", () => {
		expect(
			decodeEntities(
				"Songs of Kab&icirc;r &mdash; Kab&icirc;r &#8212; &amp; co",
			),
		).toBe("Songs of Kabîr — Kabîr — & co");
		expect(decodeEntities("&#228;&#x00E7;&#x27;")).toBe("äç'");
		// Unknown named entities stay as-is instead of mangling the text.
		expect(decodeEntities("&faustraub;")).toBe("&faustraub;");
	});

	it("should flatten html to text, keeping paragraph breaks", () => {
		expect(
			htmlToText(
				"<style>.x{color:red}</style><p>First para.</p> <p>Second &amp; last.</p><script>nope()</script>",
			),
		).toBe("First para.\n\nSecond & last.");
	});

	it("should flatten html to single-line inline text", () => {
		expect(inlineText("<span>The Poetic Edda</span>\n<i>Bellows</i>")).toBe(
			"The Poetic Edda Bellows",
		);
	});
});

describe("id and url helpers", () => {
	it("should extract book uids from card and sitemap hrefs", () => {
		expect(uidFromHref("../book/songs-of-kabir")).toBe("book/songs-of-kabir");
		expect(uidFromHref("/book/the-poetic-edda")).toBe("book/the-poetic-edda");
		expect(uidFromHref("https://sacred-texts.com/book/the-prose-edda")).toBe(
			"book/the-prose-edda",
		);
		expect(
			uidFromHref("https://www.sacred-texts.com/neu/ice/njal/index.htm"),
		).toBe("neu/ice/njal/index.htm");
		expect(uidFromHref("/hin/sok/index.htm")).toBe("hin/sok/index.htm");
		// Topic links, single-file texts and nav links are not books.
		expect(uidFromHref("../categories/yoga")).toBeNull();
		expect(uidFromHref("/ane/enuma.htm")).toBeNull();
		expect(uidFromHref("/")).toBeNull();
	});

	it("should build absolute book urls", () => {
		expect(overviewPageUrl("book/the-poetic-edda", 1)).toBe(
			`${BASE}/book/the-poetic-edda`,
		);
		expect(overviewPageUrl("neu/poe/index.htm", 2)).toBe(
			`${BASE}/neu/poe/index.htm?chaptersPage=2`,
		);
	});

	it("should derive display titles from uids", () => {
		expect(titleFromUid("book/the-poetic-edda")).toBe("The Poetic Edda");
		expect(titleFromUid("book/22-commandments-for-the-new-age")).toBe(
			"22 Commandments For The New Age",
		);
		// Legacy tree uids fall back to their directory name.
		expect(titleFromUid("neu/ice/njal/index.htm")).toBe("Njal");
	});

	it("should round-trip chapter uids and reject malformed ones", () => {
		expect(
			parseChapterUid(chapterUid("book/the-poetic-edda", "voluspo")),
		).toEqual({ bookUid: "book/the-poetic-edda", slug: "voluspo" });
		expect(parseChapterUid("book/the-poetic-edda")).toBeNull();
		expect(parseChapterUid("book/x#")).toBeNull();
	});

	it("should extract chapter slugs and build shell reader urls", () => {
		expect(chapterSlugFromHref("/book/the-poetic-edda/read/voluspo")).toBe(
			"voluspo",
		);
		expect(toShellUrl("/book/the-poetic-edda/read/voluspo")).toBe(
			`${BASE}/book/the-poetic-edda/shell/voluspo`,
		);
		expect(toShellUrl("https://sacred-texts.com/book/x/read/section-i")).toBe(
			`${BASE}/book/x/shell/section-i`,
		);
	});

	it("should tokenize queries and match every token", () => {
		expect(tokenizeQuery("  Poetic Edda! ")).toEqual(["poetic", "edda"]);
		expect(matchesQuery("the poetic edda", ["poetic", "edda"])).toBe(true);
		expect(matchesQuery("the poetic edda", ["poetic", "prose"])).toBe(false);
	});
});

describe("topic listing pages", () => {
	// Trimmed excerpt of a real /categories/ page (verified live). Cards are
	// rendered three times by the hydration template; dupes must be dropped.
	const LIST_FIXTURE = `
	<ul>
	<li class="book book--category svelte-juehwe"><a href="../categories/yoga">Yoga</a></li>
	<li class="book book--book svelte-juehwe"><span class="book-cover svelte-juehwe"><img src="/img?src=kabir.jpg" /></span><div class="book-body svelte-juehwe"><a class="book-title svelte-juehwe" href="../book/songs-of-kabir">Songs of Kabîr</a> <span class="book-author svelte-juehwe">Kabîr</span> <div class="book-note svelte-juehwe">Kabir's mystical and devotional poetry.</div></div> <div class="book-meta svelte-juehwe"><span class="book-year svelte-juehwe">1915</span></div></li>
	<li class="book book--book svelte-juehwe"><div class="book-body svelte-juehwe"><a class="book-title svelte-juehwe" href="../book/the-bhagavadgita">The Bhagavad Gîtâ</a></div> <div class="book-meta svelte-juehwe"><span class="book-year svelte-juehwe">1908</span></div></li>
	<li class="book book--book svelte-juehwe"><div class="book-body svelte-juehwe"><a class="book-title svelte-juehwe" href="../book/songs-of-kabir">Songs of Kabîr</a></div></li>
	<li class="book-subitem svelte-juehwe"><a href="/hin/upan/index.htm">Upanishads</a></li>
	</ul>`;

	it("should parse book cards, skipping dupes and non-book rows", () => {
		const cards = parseBookCards(LIST_FIXTURE);
		expect(cards.length).toBe(2);
		expect(cards[0]).toEqual({
			uid: "book/songs-of-kabir",
			title: "Songs of Kabîr",
			author: "Kabîr",
			note: "Kabir's mystical and devotional poetry.",
			year: "1915",
		});
		// Optional fields degrade to null.
		expect(cards[1]).toEqual({
			uid: "book/the-bhagavadgita",
			title: "The Bhagavad Gîtâ",
			author: null,
			note: null,
			year: "1908",
		});
	});

	it("should fall back to slug-derived titles for bare cards", () => {
		const cards = parseBookCards(
			'<li class="book book--book"><div class="book-body"><a class="book-title" href="/book/untitled-book"></a></div></li>',
		);
		expect(cards[0]?.title).toBe("Untitled Book");
	});
});

describe("book overview pages", () => {
	// Trimmed excerpt of a real book overview (verified live on
	// /book/the-poetic-edda -> /neu/poe/index.htm).
	const OVERVIEW_FIXTURE = `
	<title>The Poetic Edda: Bellows Translation | Internet Sacred Text Archive</title>
	<meta property="og:image" content="https://sacred-texts.com/neu/poe/img/voluspo.jpg"/>
	<h1 id="book-title">The Poetic Edda</h1>
	<div class="bo-author-name">Unknown author</div>
	<div class="bo-description"><p>The Poetic Eddas are the oral literature of Iceland, written down from 1000 to 1300 C.E.</p> <p>This translation by Henry Adams Bellows is highly readable.</p></div>
	<span class="bo-page-num current" aria-current="page" aria-label="Chapter page 1 of 2">1</span>
	<a class="bo-toc-row" href="/book/the-poetic-edda/read/start-reading"><span class="bo-toc-num">01</span> <span class="bo-toc-title">Start Reading</span> <svg>...</svg></a>
	<a class="bo-toc-row" href="/book/the-poetic-edda/read/voluspo"><span class="bo-toc-num">05</span> <span class="bo-toc-title">Voluspo</span></a>
	<a class="bo-toc-row" href="/book/the-poetic-edda/read/voluspo"><span class="bo-toc-num">05</span> <span class="bo-toc-title">Voluspo</span></a>
	<a class="bo-toc-row" href="/book/the-poetic-edda/read/hovamol"><span class="bo-toc-num">06</span> <span class="bo-toc-title">H&aacute;vam&aacute;l</span></a>`;

	it("should parse title, author, description and cover", () => {
		const overview = parseOverview(OVERVIEW_FIXTURE, "book/the-poetic-edda");
		expect(overview.title).toBe("The Poetic Edda");
		// "Unknown author" placeholders are dropped.
		expect(overview.author).toBeNull();
		expect(overview.description).toBe(
			"The Poetic Eddas are the oral literature of Iceland, written down from 1000 to 1300 C.E.\n\nThis translation by Henry Adams Bellows is highly readable.",
		);
		expect(overview.cover).toBe(
			"https://sacred-texts.com/neu/poe/img/voluspo.jpg",
		);
		expect(overview.chapterPages).toBe(2);
	});

	it("should collect deduplicated toc rows in document order", () => {
		const overview = parseOverview(OVERVIEW_FIXTURE, "book/the-poetic-edda");
		expect(overview.chapters.map((c) => c.slug)).toEqual([
			"start-reading",
			"voluspo",
			"hovamol",
		]);
		expect(overview.chapters[1]).toEqual({
			slug: "voluspo",
			name: "Voluspo",
			url: `${BASE}/book/the-poetic-edda/shell/voluspo`,
		});
		// Entities in chapter names are decoded.
		expect(overview.chapters[2]?.name).toBe("Hávamál");
	});

	it("should degrade gracefully when the overview has no description", () => {
		const overview = parseOverview(
			'<h1 id="book-title">Test Book</h1>',
			"book/test-book",
		);
		expect(overview.description).toBe("");
		expect(overview.chapterPages).toBe(1);
		expect(overview.chapters).toEqual([]);
	});
});

describe("chapter reader pages", () => {
	it("should extract the balanced reader-prose block", () => {
		const html = `
		<div>sidebar <div>nav</div></div>
		<div data-slot="reader-prose" class="svelte-1p4s8cb"><h1>HOVAMOL</h1> <p>The text.</p></div>
		<div data-slot="reader-subscription-ad"><a href="/subscribe">Subscribe</a> <div>nested</div></div>`;
		expect(extractProse(html)).toBe("<h1>HOVAMOL</h1> <p>The text.</p>");
		expect(extractProse("<p>no prose here</p>")).toBe("");
	});

	it("should keep verse line breaks and clean entities", () => {
		expect(
			paragraphText("Verse line one,<br /> and line two&nbsp;: <i>Jaya</i>."),
		).toBe("Verse line one,\nand line two : Jaya.");
		expect(paragraphText("<p></p>")).toBe("");
	});

	it("should classify headings bold and drop site markers", () => {
		// Structure verified live on /book/the-poetic-edda/shell/hovamol.
		const prose =
			"<h1>HOVAMOL</h1> <h3>The Ballad of the High One</h3> " +
			"<p>This poem follows the <i>Voluspo</i> in the <i>Codex Regius</i>.</p> " +
			"<p>Stanza line,<br /> second line.</p> " +
			"<p><a>p. 29</a></p> " +
			"<p>[paragraph continues] </p> " +
			"<p><i>Wholly italic aside.</i></p> " +
			"<p> </p>";
		expect(chapterParagraphs(prose)).toEqual([
			{ content: "HOVAMOL", style: "bold" },
			{ content: "The Ballad of the High One", style: "bold" },
			{
				content: "This poem follows the Voluspo in the Codex Regius.",
				style: null,
			},
			{ content: "Stanza line,\nsecond line.", style: null },
			{ content: "Wholly italic aside.", style: "italic" },
		]);
	});

	it("should read chapters from the __data.json payload", () => {
		// The reader's data endpoint is devalue-encoded: nodes[0].data is a
		// flat array, "contentHtml" entries reference the html string by
		// index, and the html carries \u003C-style escapes on the wire.
		const payload = JSON.stringify({
			type: "data",
			nodes: [
				{
					type: "data",
					data: [
						{ user: 1, chapter: 3 },
						"unrelated",
						{ id: 2, contentHtml: 4, contentText: 5 },
						305_767,
						"\\u003Ch1>VOLUSPO\\u003C/h1> \\u003Cp>The \\u003Ci>Voluspo\\u003C/i> stands first.\\u003C/p> \\u003Cp><a>p. 3</a></p>\\u003Cp> </p>",
						"plain text version",
					],
				},
			],
		});
		const paragraphs = parseChapterData(payload);
		expect(paragraphs).toEqual([
			{ content: "VOLUSPO", style: "bold" },
			{ content: "The Voluspo stands first.", style: null },
		]);
		// Payloads without content degrade to no paragraphs.
		expect(parseChapterData('{"type":"redirect","location":"/x"}')).toEqual([]);
		expect(parseChapterData("not json at all")).toEqual([]);
	});
});

describe("books sitemap", () => {
	it("should extract deduplicated book refs", () => {
		const xml = `<urlset>
		<url><loc>https://sacred-texts.com/book/the-childish-edda</loc></url>
		<url><loc>https://sacred-texts.com/neu/ice/njal/index.htm</loc></url>
		<url><loc>https://sacred-texts.com/book/the-childish-edda</loc></url>
		<url><loc>https://sacred-texts.com/categories/icelandic</loc></url>
		</urlset>`;
		expect(parseBooksSitemap(xml)).toEqual([
			{ uid: "book/the-childish-edda", title: "The Childish Edda" },
			{ uid: "neu/ice/njal/index.htm", title: "Njal" },
		]);
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
	}, 120_000);

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining(["sacred-texts.com", "www.sacred-texts.com"]),
			);
		}
	});

	it("should browse the selected topic, 24 entries per page", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(24);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.id.uid.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate the topic listing", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should search for edda over listings and sitemap", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "edda");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content.length).toBeLessThanOrEqual(24);
		const titles = result.content.map((e) => e.title.toLowerCase());
		expect(titles.some((t) => t.includes("edda"))).toBe(true);
		await assertValidEntries(result.content);
	}, 120_000);

	it("should return no results for an empty search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const empty = await extension!.search(0, "   ");
		expect(empty.content.length).toBe(0);
		expect(empty.hasnext).toBe(false);
	});

	it("should detail the Poetic Edda with a chapter table and attribution", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail(
			{ uid: "book/the-poetic-edda" },
			{ probe },
		);
		const entry = result.entry;
		expect(entry.media_type).toBe("Book");
		expect(entry.language).toBe("en");
		expect(entry.titles[0]).toBe("The Poetic Edda");
		expect(entry.description.length).toBeGreaterThan(0);
		expect(entry.episodes.length).toBeGreaterThanOrEqual(5);
		expect(entry.episodes[0]!.id.uid).toBe(
			"book/the-poetic-edda#start-reading",
		);
		// The attribution/backlink UI required by the site is present.
		expect(JSON.stringify(entry.ui)).toContain("sacred-texts.com");
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(entry);
		detailResult = result;
	}, 120_000);

	it("should source a chapter as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes.find(
			(e) => e.name.toLowerCase() === "voluspo",
		);
		if (!episode) throw new Error("Voluspo episode not found");
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(10);
		// The chapter heading leads as a bold paragraph (the host expands
		// TextStyle with null keys, so assert field-wise).
		const heading = result.source.paragraphs[0];
		expect(heading?.type).toBe("Text");
		if (heading?.type === "Text") {
			expect(heading.style?.bold).toBe(true);
		}
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 120_000);

	it("should resolve chapters from the episode uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: chapterUid("book/the-poetic-edda", "hovamol") },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist")
			throw new Error("Not a paragraphlist");
		expect(result.source.paragraphs.length).toBeGreaterThan(10);
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		// Verse line breaks from <br> survive as newlines.
		expect(texts.some((t) => t.includes("\n"))).toBe(true);
		await assertValidSource(result.source);
	}, 120_000);
});
