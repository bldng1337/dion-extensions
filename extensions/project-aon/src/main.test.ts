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
	bookFileUrl,
	bookUrl,
	buildEpisodes,
	capText,
	decodeEntities,
	episodeUid,
	extractContentRegion,
	htmlToText,
	parseAuthorLine,
	parseBookDirs,
	parseBookUid,
	parseEpisodeUid,
	parseNumberedSections,
	parsePageParagraphs,
	parseSeriesDirs,
	parseTitlePage,
	parseTocPages,
	PAGE_SIZE,
	XHTML_INDEX_URL,
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

// Trimmed excerpt of the real /en/xhtml/ autoindex (verified live).
const XHTML_INDEX_FIXTURE = `
<h1>Index of /en/xhtml</h1>
<pre>      <a href="/en/xhtml/">Parent Directory</a>                             -
      <a href="fw/">fw/</a>                     2015-10-12 19:24    -
      <a href="gs/">gs/</a>                     2012-09-17 10:20    -
      <a href="lw/">lw/</a>                     2024-12-28 18:43    -
      <a href="misc/">misc/</a>                   2012-09-17 10:20    -
<hr></pre>`;

// Trimmed excerpt of the real /en/xhtml/lw/ autoindex (verified live).
const SERIES_INDEX_FIXTURE = `
<h1>Index of /en/xhtml/lw</h1>
<pre>      <a href="/en/xhtml/lw/">Parent Directory</a>                             -
      <a href="01fftd/">01fftd/</a>                 2024-12-28 18:43    -
      <a href="02fotw/">02fotw/</a>                 2024-12-28 18:43    -
      <a href="10tdot/">10tdot/</a>                 2024-12-28 18:43    -
      <a href="29tsoc/">29tsoc/</a>                 2024-12-28 18:43    -
      <a href="dotd/">dotd/</a>                   2018-02-13 21:39    -
<hr></pre>`;

// Trimmed excerpt of the real /en/xhtml/lw/01fftd/title.htm (new layout,
// verified live).
const TITLE_PAGE_NEW_FIXTURE = `
<html>
 <head><title>Flight from the Dark: Title Page</title></head>
 <body>
  <div class="container">
   <header id="main-header">
    <div id="logos">
     <img alt="" src="lonewolf.png" id="logo"/>
     <img alt="" src="palogo.png" id="project-aon-logo"/>
    </div>
    <h1>Flight from the Dark</h1>
    <h2>Joe Dever and Gary Chalk</h2>
   </header>
   <article>
    <div class="frontmatter">
     <div class="maintext table-responsive">
  <p>You are Lone Wolf. In a devastating attack the Darklords have destroyed the monastery where you were learning the skills of the Kai Lords. You are the sole survivor.</p>
  <p>In <strong>
        <cite>Flight from the Dark</cite>
       </strong>, you swear revenge. But first you must reach Holmgard to warn the King of the gathering evil.</p>
   <p>
       <strong>Joe Dever</strong>, the creator of the bestselling Lone Wolf adventure books, has achieved world-wide recognition.</p>
     </div>
     <p id="page-navigation"/>
    </div>
   </article>
   <footer><div id="license"><p>Distribution of this Internet Edition is restricted.</p></div></footer>
  </div>
 </body>
</html>`;

// Trimmed excerpt of the real /en/xhtml/gs/01gstw/title.htm (old layout,
// verified live): no <article>/<h1>, title only in <head><title>, content in
// <div class="maintext">.
const TITLE_PAGE_OLD_FIXTURE = `
<html>
<head><title>Grey Star the Wizard: Title Page</title></head>
<body text="#330066" bgcolor="#ffffe6">
<div id="title"><img usemap="#imagemap" src="title.png" alt="Grey Star the Wizard" /></div>
<div id="body">
<div class="frontmatter">
<div class="maintext">

   <p><strong>In the World of Lone Wolf a new hero has arisen&mdash;Grey Star the Wizard</strong></p>

   <p>You are Grey Star. From the core of a raging storm you appeared&mdash;a human child, ship-wrecked and orphaned, a gift of hope to the exiled Shianti sorcerers.</p>

   <p><strong>Ian Page</strong> was born in London in 1960.</p>

</div>
<div class="navigation"><img alt="" src="left.png" /><a href="toc.htm"><img alt="Table of Contents" src="toc.png" /></a></div>
</div>

<p class="copyright">
   Text copyright &copy; 1985 Ian Page.<br />
  </p>

</div>
</body>
</html>`;

// Trimmed excerpt of the real /en/xhtml/lw/01fftd/toc.htm (verified live).
const TOC_FIXTURE = `
<html>
<head><title>Flight from the Dark: </title></head>
<body>
  <div class="container">
   <article>
    <div class="frontmatter">
     <div class="maintext table-responsive">
      <h2>Table of Contents</h2>
      <ul>
       <li>
        <a href="title.htm">Title Page</a>
       </li>
       <li>
        <a href="dedicate.htm">Dedication</a>
       </li>
       <li>
        <a href="acknwldg.htm">Acknowledgements</a>
       </li>
       <li>
        <a href="tssf.htm">The Story So Far&thinsp;&hellip;&thinsp;</a>
       </li>
       <li>
        <a href="gamerulz.htm">The Game Rules</a>
        <ul>
         <li>
          <a href="discplnz.htm">Kai Disciplines</a>
         </li>
         <li>
          <a href="equipmnt.htm">Equipment</a>
         </li>
        </ul>
       </li>
       <li>
        <a href="kaiwisdm.htm">Kai Wisdom</a>
       </li>
       <li>
        <a href="numbered.htm">Numbered Sections</a>
       </li>
       <li>
        <a href="map.htm">Map of the Lastlands</a>
       </li>
       <li>
        <a href="crtable.htm">Combat Results Table</a>
       </li>
       <li>
        <a href="errata.htm">Errata</a>
       </li>
       <li>
        <a href="footnotz.htm">Footnotes</a>
       </li>
       <li>
        <a href="illstrat.htm">Table of Illustrations</a>
       </li>
       <li>
        <a href="license.htm">Project Aon License</a>
       </li>
      </ul>
     </div>
     <p id="page-navigation"/>
    </div>
   </article>
   <footer>
    <nav class="navbar navbar-dever" id="page-actions">
     <ul class="nav navbar-nav">
       <li>
        <a title="Table of Contents" href="toc.htm">Table of Contents</a>
       </li>
       <li>
        <a title="Map" href="map.htm">Map</a>
       </li>
      </ul>
    </nav>
   </footer>
  </div>
 </body>
</html>`;

// Trimmed excerpt of the real /en/xhtml/lw/01fftd/numbered.htm (verified
// live; ranges of ten sectN.htm links).
const NUMBERED_FIXTURE = `
   <article>
    <div class="numbered">
     <div class="maintext table-responsive">
      <h2>Numbered Sections</h2>
      <p>
       <b>
        <a id="1">1-10</a>: </b>
       <a href="sect1.htm">1</a> <a href="sect2.htm">2</a> <a href="sect10.htm">10</a>
       <br/>
       <b>
        <a id="11">11-20</a>: </b>
       <a href="sect11.htm">11</a> <a href="sect12.htm">12</a> <a href="sect100.htm">100</a>
       <br/>
      </p>
     </div>
     <p id="page-navigation"/>
    </div>
   </article>`;

// Trimmed excerpt of the real /en/xhtml/lw/01fftd/sect1.htm (new layout,
// verified live): <h3> section number, prose <p>s, illustration <figure>
// and "turn to N" choice links.
const SECTION_PAGE_NEW_FIXTURE = `
<html>
<head><title>Flight from the Dark: Section 1</title></head>
<body>
  <div class="container">
   <article>
    <div class="numbered">
     <div class="maintext table-responsive">
      <h3>1</h3>
      <p>You must make haste for you sense it is not safe to linger by the smoking remains of the ruined monastery. You must set out for the Sommlending capital of Holmgard.</p>
      <figure>
       <a href="small1.png">
        <img alt="illustration" class="img-responsive" src="small1.png"/>
       </a>
      </figure>
      <p>At the foot of the hill, the path splits into two directions, both leading into a large wood.</p>
      <p class="choice">If you wish to use your Kai Discipline of Sixth Sense, <a href="sect141.htm">turn to 141</a>.</p>
      <p class="choice">If you wish to take the right path into the wood, <a href="sect85.htm">turn to 85</a>.</p>
     </div>
     <p id="page-navigation"/>
    </div>
   </article>
   <footer>
    <div id="license">
   <p>Text &copy; 1984 Joe Dever.</p>
   <p>Distribution of this Internet Edition is restricted under the terms of the <a href="license.htm">Project Aon License</a>.</p>
  </div>
   </footer>
  </div>
 </body>
</html>`;

// Old-layout reading page (as on /en/xhtml/gs/01gstw/…, verified live):
// content in <div class="maintext">, cut at the navigation block.
const SECTION_PAGE_OLD_FIXTURE = `
<html>
<head><title>Grey Star the Wizard: 1</title></head>
<body>
<div id="body">
<div class="frontmatter">
<div class="maintext">

  <h2>1</h2>

   <p>Beyond the gates of the Shadakine city you see the towers of the Wizard&rsquo;s building. You hurry towards it, gripping your staff.</p>

   <p class="choice">If you wish to enter, <a href="sect2.htm">turn to 2</a>.</p>

</div>
<div class="navigation"><img alt="" src="left.png" /><a href="toc.htm"><img alt="Table of Contents" src="toc.png" /></a></div>
</div>

<p class="copyright">Text copyright &copy; 1985 Ian Page.</p>
</div>
</body>
</html>`;

describe("text helpers", () => {
	it("should decode named and numeric entities", () => {
		expect(
			decodeEntities(
				"Joe Dever&#39;s &eacute;lite &mdash; &lsquo;Kai&rsquo; &copy; &#x27; &#8212; &thinsp;&hellip;",
			),
		).toBe("Joe Dever's élite — ‘Kai’ © ' — \u2009…");
		// Unknown named entities stay as-is instead of mangling the text.
		expect(decodeEntities("&nosuchthing;")).toBe("&nosuchthing;");
	});

	it("should flatten html snippets to single-line text", () => {
		expect(
			htmlToText(
				"<style>x</style><!-- c -->Joe&nbsp;Dever<br>1984<script>nope()</script>",
			),
		).toBe("Joe Dever 1984");
	});

	it("should split author lines into names", () => {
		expect(parseAuthorLine("Joe Dever and Gary Chalk")).toEqual([
			"Joe Dever",
			"Gary Chalk",
		]);
		expect(parseAuthorLine("Ian Page")).toEqual(["Ian Page"]);
	});

	it("should cap long text on a word boundary", () => {
		const long = "word ".repeat(400);
		const capped = capText(long, 100);
		expect(capped.length).toBeLessThanOrEqual(101);
		expect(capped.endsWith("…")).toBe(true);
		expect(capText("short", 100)).toBe("short");
	});
});

describe("id helpers", () => {
	it("should round-trip book uids and urls", () => {
		expect(parseBookUid("lw/01fftd")).toEqual({
			series: "lw",
			dir: "01fftd",
		});
		expect(parseBookUid("no-number/gs")).toBeNull();
		expect(parseBookUid("01fftd")).toBeNull();
		expect(bookUrl("lw/01fftd")).toBe(
			"https://www.projectaon.org/en/xhtml/lw/01fftd/title.htm",
		);
		expect(bookFileUrl("lw/01fftd", "sect7.htm")).toBe(
			"https://www.projectaon.org/en/xhtml/lw/01fftd/sect7.htm",
		);
		expect(XHTML_INDEX_URL).toBe("https://www.projectaon.org/en/xhtml/");
		expect(PAGE_SIZE).toBe(24);
	});

	it("should round-trip episode uids", () => {
		expect(parseEpisodeUid(episodeUid("lw/01fftd", "sect350.htm"))).toEqual({
			bookUid: "lw/01fftd",
			file: "sect350.htm",
		});
		expect(parseEpisodeUid("lw/01fftd#tssf.htm")).toEqual({
			bookUid: "lw/01fftd",
			file: "tssf.htm",
		});
		expect(parseEpisodeUid("lw/01fftd")).toBeNull();
		expect(parseEpisodeUid("lw/01fftd#bad id!")).toBeNull();
		expect(parseEpisodeUid("nodir#sect1.htm")).toBeNull();
	});
});

describe("autoindexes", () => {
	it("should list series with the flagship series first", () => {
		expect(parseSeriesDirs(XHTML_INDEX_FIXTURE)).toEqual([
			"lw",
			"gs",
			"fw",
			"misc",
		]);
	});

	it("should list book dirs in numeric order, skipping non-book dirs", () => {
		expect(parseBookDirs(SERIES_INDEX_FIXTURE)).toEqual([
			"01fftd",
			"02fotw",
			"10tdot",
			"29tsoc",
		]);
	});
});

describe("title pages", () => {
	it("should parse the new layout title, authors and blurb", () => {
		const meta = parseTitlePage(TITLE_PAGE_NEW_FIXTURE, "lw/01fftd");
		expect(meta).not.toBeNull();
		expect(meta!.title).toBe("Flight from the Dark");
		expect(meta!.authors).toEqual(["Joe Dever", "Gary Chalk"]);
		expect(meta!.blurb).toContain("You are Lone Wolf");
		expect(meta!.blurb).toContain("reach Holmgard");
		// The author biography must not leak into the blurb.
		expect(meta!.blurb).not.toContain("world-wide recognition");
	});

	it("should parse the old layout title from <head><title>", () => {
		const meta = parseTitlePage(TITLE_PAGE_OLD_FIXTURE, "gs/01gstw");
		expect(meta).not.toBeNull();
		expect(meta!.title).toBe("Grey Star the Wizard");
		// No author heading: the series fallback applies.
		expect(meta!.authors).toEqual(["Ian Page"]);
		expect(meta!.blurb).toContain("You are Grey Star");
	});

	it("should reject pages that are not book title pages", () => {
		expect(
			parseTitlePage(
				"<html><head><title>Index of /</title></head></html>",
				"misc/rh",
			),
		).toBeNull();
	});
});

describe("toc and numbered sections", () => {
	it("should parse the toc in document order with nested lists", () => {
		const pages = parseTocPages(TOC_FIXTURE);
		expect(pages.map((p) => p.file)).toEqual([
			"title.htm",
			"dedicate.htm",
			"acknwldg.htm",
			"tssf.htm",
			"gamerulz.htm",
			"discplnz.htm",
			"equipmnt.htm",
			"kaiwisdm.htm",
			"numbered.htm",
			"map.htm",
			"crtable.htm",
			"errata.htm",
			"footnotz.htm",
			"illstrat.htm",
			"license.htm",
		]);
		expect(pages[3]!.name).toBe("The Story So Far …");
		// Footer nav links (toc.htm, map.htm) must not create duplicates.
		expect(pages.filter((p) => p.file === "map.htm").length).toBe(1);
	});

	it("should parse numbered sections deduplicated and sorted by number", () => {
		expect(parseNumberedSections(NUMBERED_FIXTURE)).toEqual([
			{ n: 1, file: "sect1.htm" },
			{ n: 2, file: "sect2.htm" },
			{ n: 10, file: "sect10.htm" },
			{ n: 11, file: "sect11.htm" },
			{ n: 12, file: "sect12.htm" },
			{ n: 100, file: "sect100.htm" },
		]);
	});

	it("should build episodes: front matter, sections in place, back matter", () => {
		const episodes = buildEpisodes(
			"lw/01fftd",
			parseTocPages(TOC_FIXTURE),
			parseNumberedSections(NUMBERED_FIXTURE),
		);
		const names = episodes.map((e) => e.name);
		// Utility pages are excluded; readable front matter leads.
		expect(names[0]).toBe("The Story So Far …");
		expect(names).toContain("The Game Rules");
		expect(names).toContain("Kai Disciplines");
		// The numbered.htm marker expands into its sections in place.
		expect(names).toContain("Section 1");
		expect(names).toContain("Section 100");
		expect(names.indexOf("Section 1")).toBeGreaterThan(
			names.indexOf("The Game Rules"),
		);
		expect(names.indexOf("Section 1")).toBeLessThan(
			names.indexOf("Map of the Lastlands"),
		);
		// Back matter trails.
		expect(names).toContain("Combat Results Table");
		for (const excluded of [
			"title.htm",
			"dedicate.htm",
			"acknwldg.htm",
			"errata.htm",
			"footnotz.htm",
			"illstrat.htm",
			"license.htm",
		]) {
			expect(episodes.some((e) => e.file === excluded)).toBe(false);
		}
		// Episode urls point at the real page files.
		const section1 = episodes.find((e) => e.file === "sect1.htm");
		expect(section1!.url).toBe(
			"https://www.projectaon.org/en/xhtml/lw/01fftd/sect1.htm",
		);
	});
});

describe("page parsing", () => {
	it("should cut the readable region of both layouts", () => {
		const region = extractContentRegion(SECTION_PAGE_NEW_FIXTURE);
		expect(region).toContain("Sommlending capital of Holmgard");
		expect(region).not.toContain("Project Aon License");

		const oldRegion = extractContentRegion(SECTION_PAGE_OLD_FIXTURE);
		expect(oldRegion).toContain("Shadakine city");
		expect(oldRegion).not.toContain("copyright");
		expect(oldRegion).not.toContain("Table of Contents");
	});

	it("should turn a numbered section into clean paragraphs", () => {
		const paragraphs = parsePageParagraphs(
			SECTION_PAGE_NEW_FIXTURE,
			"Section 1",
		);
		expect(paragraphs).toEqual([
			// The <h3> section number leads as a bold heading.
			{ content: "1", style: "bold" },
			{
				content:
					"You must make haste for you sense it is not safe to linger by the smoking remains of the ruined monastery. You must set out for the Sommlending capital of Holmgard.",
				style: null,
			},
			// The illustration <figure> is skipped entirely.
			{
				content:
					"At the foot of the hill, the path splits into two directions, both leading into a large wood.",
				style: null,
			},
			// "Turn to N" choices keep their visible text.
			{
				content:
					"If you wish to use your Kai Discipline of Sixth Sense, turn to 141.",
				style: null,
			},
			{
				content:
					"If you wish to take the right path into the wood, turn to 85.",
				style: null,
			},
		]);
	});

	it("should parse old-layout pages with a bold lead heading", () => {
		const paragraphs = parsePageParagraphs(
			SECTION_PAGE_OLD_FIXTURE,
			"Section 1",
		);
		expect(paragraphs[0]).toEqual({ content: "1", style: "bold" });
		expect(
			paragraphs.some((p) =>
				p.content.includes("towers of the Wizard’s building"),
			),
		).toBe(true);
		expect(paragraphs.some((p) => p.content.endsWith("turn to 2."))).toBe(true);
	});

	it("should mark bold-only paragraphs and flatten inline bold", () => {
		const body = `
		<article><div class="maintext table-responsive">
		<h2>The Game Rules</h2>
		<p><strong>Joe Dever</strong>, the creator of Lone Wolf, wrote these rules.</p>
		<p><strong>Only bold in this paragraph.</strong></p>
		<p>Plain closing line.</p>
		</div></article>`;
		expect(parsePageParagraphs(body, null)).toEqual([
			{ content: "The Game Rules", style: "bold" },
			{
				content: "Joe Dever, the creator of Lone Wolf, wrote these rules.",
				style: null,
			},
			{ content: "Only bold in this paragraph.", style: "bold" },
			{ content: "Plain closing line.", style: null },
		]);
	});

	it("should reduce illustration-only pages to their heading", () => {
		const body = `
		<article><div class="maintext table-responsive">
		<h2>Combat Results Table</h2>
		<figure><a href="crtneg.png"><img alt="illustration" src="crtneg.png"/></a></figure>
		<figure><a href="crtpos.png"><img alt="illustration" src="crtpos.png"/></a></figure>
		</div></article>`;
		// Only the heading survives; the source() layer appends an
		// explanatory note when a page has no body text at all.
		expect(parsePageParagraphs(body, "Combat Results Table")).toEqual([
			{ content: "Combat Results Table", style: "bold" },
		]);
	});

	it("should fall back to the supplied heading when a page has none", () => {
		const body = `<article><div class="maintext"><p>Plain text only.</p></div></article>`;
		expect(parsePageParagraphs(body, "Full text")).toEqual([
			{ content: "Full text", style: "bold" },
			{ content: "Plain text only.", style: null },
		]);
	});

	it("should keep table rows readable as plain text", () => {
		const body = `
		<article><div class="maintext table-responsive">
		<h2>Random Number Table</h2>
		<table><tr><td>0</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td><td>5</td></tr></table>
		</div></article>`;
		const paragraphs = parsePageParagraphs(body, null);
		expect(paragraphs[0]).toEqual({
			content: "Random Number Table",
			style: "bold",
		});
		expect(paragraphs[1]!.content).toBe("0 | 1 | 2");
		expect(paragraphs[2]!.content).toBe("3 | 4 | 5");
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

	it("should declare its network permission", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toContain("www.projectaon.org");
		}
	});

	it("should browse the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content.length).toBe(PAGE_SIZE);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.id.uid).toMatch(/^[a-z0-9_-]+\/\d+[a-z0-9_-]*$/);
		// Lone Wolf leads the catalog.
		expect(result.content[0]!.id.uid).toBe("lw/01fftd");
		expect(result.content[0]!.title.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 180_000);

	it("should paginate the catalog without duplicates", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		expect(ids0.filter((id) => ids1.includes(id))).toEqual([]);
		await assertValidEntries(page1.content);
	}, 180_000);

	it("should search the catalog for a title term", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "flight");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(false);
		expect(result.content.map((e) => e.id.uid)).toContain("lw/01fftd");
		const flight = result.content.find((e) => e.id.uid === "lw/01fftd");
		expect(flight?.title).toBe("Flight from the Dark");
		expect(flight?.author).toContain("Joe Dever");
		await assertValidEntries(result.content);
	}, 180_000);

	it("should also match searches against the series and author", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const bySeries = await extension!.search(0, "lone wolf");
		expect(bySeries.content.length).toBeGreaterThan(10);
		const byAuthor = await extension!.search(0, "joe dever");
		expect(byAuthor.content.length).toBeGreaterThan(10);
	});

	it("should return nothing for empty searches or past-the-end pages", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const empty = await extension!.search(0, "   ");
		expect(empty.content.length).toBe(0);
		const page1 = await extension!.search(1, "flight");
		expect(page1.content.length).toBe(0);
		const nohit = await extension!.search(0, "no such gamebook xyz");
		expect(nohit.content.length).toBe(0);
		expect(nohit.hasnext).toBe(false);
	});

	it("should detail the first book with its sections and echo settings", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail({ uid: "lw/01fftd" }, { probe });
		const entry = result.entry;
		expect(entry.media_type).toBe("Book");
		expect(entry.language).toBe("en");
		expect(entry.titles[0]).toBe("Flight from the Dark");
		expect(entry.author).toContain("Joe Dever");
		expect(entry.status).toBe("Complete");
		expect(entry.url).toBe(
			"https://www.projectaon.org/en/xhtml/lw/01fftd/title.htm",
		);
		expect(entry.description).toContain("Lone Wolf");
		// 350 gamebook sections plus front/back matter pages.
		expect(entry.episodes.length).toBeGreaterThan(350);
		expect(entry.episodes[0]!.name).toBe("The Story So Far …");
		const section1 = entry.episodes.find(
			(e) => e.id.uid === "lw/01fftd#sect1.htm",
		);
		expect(section1).toBeDefined();
		expect(section1!.name).toBe("Section 1");
		expect(section1!.url).toBe(
			"https://www.projectaon.org/en/xhtml/lw/01fftd/sect1.htm",
		);
		expect(entry.meta?.Series).toBe("Lone Wolf");
		// The detail UI carries the no-redistribution license note.
		expect(JSON.stringify(entry.ui)).toContain("redistribution");
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(entry);
		detailResult = result;
	}, 180_000);

	it("should source section 1 as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes.find(
			(e) => e.id.uid === "lw/01fftd#sect1.htm",
		);
		if (episode === undefined) throw new Error("No section 1 episode");
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(3);
		const heading = result.source.paragraphs[0];
		expect(heading?.type).toBe("Text");
		if (heading?.type === "Text") {
			expect(heading.content).toBe("1");
			expect(heading.style?.bold).toBe(true);
		}
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		expect(
			texts.some((t) => t.includes("Sommlending capital of Holmgard")),
		).toBe(true);
		// "Turn to N" choices survive as plain text; no site chrome leaks in.
		expect(texts.some((t) => t.includes("turn to 141"))).toBe(true);
		expect(texts.some((t) => t.includes("Project Aon License"))).toBe(false);
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 180_000);

	it("should source a front matter episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes.find(
			(e) => e.id.uid === "lw/01fftd#tssf.htm",
		);
		if (episode === undefined) throw new Error("No story-so-far episode");
		const result = await extension!.source(episode.id, detailResult.settings);
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(3);
		const heading = result.source.paragraphs[0];
		if (heading?.type === "Text") {
			expect(heading.content).toBe("The Story So Far …");
			expect(heading.style?.bold).toBe(true);
		}
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		expect(texts.some((t) => t.includes("northern land of Sommerlund"))).toBe(
			true,
		);
		await assertValidSource(result.source);
	}, 180_000);

	it("should resolve pages from the episode uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: episodeUid("lw/01fftd", "sect2.htm") },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(3);
	}, 180_000);

	it("should handle illustration-only pages gracefully", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: episodeUid("lw/01fftd", "crtable.htm") },
			{},
		);
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		// The bold page title plus an explanatory note instead of an error.
		expect(result.source.paragraphs.length).toBe(2);
		const heading = result.source.paragraphs[0];
		expect(heading?.type).toBe("Text");
		if (heading?.type === "Text") {
			expect(heading.content).toBe("Combat Results Table");
			expect(heading.style?.bold).toBe(true);
		}
		const note = result.source.paragraphs[1];
		expect(note?.type).toBe("Text");
		if (note?.type === "Text") {
			expect(note.content).toContain("only illustrations or tables");
		}
		await assertValidSource(result.source);
	}, 180_000);

	it("should reject unknown book and page ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "not-a-book" }, {})).rejects.toThrow(
			/invalid book id/,
		);
		await expect(
			extension!.source({ uid: "bogus#sect1.htm" }, {}),
		).rejects.toThrow(/invalid section id/);
	});
});
