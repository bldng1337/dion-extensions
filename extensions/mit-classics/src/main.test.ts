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
	authorBrowseUrl,
	BROWSE_INDEX_URL,
	decodeEntities,
	episodeUid,
	extractContentRegion,
	htmlToText,
	parseAuthors,
	parseAuthorWorks,
	parseEpisodeUid,
	parseSection,
	parseWorkPage,
	parseWorkUid,
	workDescription,
	workUrl,
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

// Trimmed excerpt of the real /Browse/index.html (verified live).
const BROWSE_INDEX_FIXTURE = `
<TD><A HREF="browse-Aeschylus.html"
onMouseOver="window.status='List works by Aeschylus'; return true;" TARGET="browse">Aeschylus</A>
<BR><FONT SIZE="-1">Wrote in Greek
<BR>525-456 B.C.E.
<BR></FONT><BR>
<A HREF="browse-Homer.html"
onMouseOver="window.status='List works by Homer'; return true;" TARGET="browse">Homer</A>
<BR><FONT SIZE="-1">Wrote in Greek
<BR>9th century B.C.E.
<BR></FONT><BR>
<A HREF="browse-Virgil.html"
onMouseOver="window.status='List works by Virgil'; return true;" TARGET="browse">Virgil</A>
</TD>`;

// Trimmed excerpt of the real /Browse/browse-Homer.html (verified live).
const AUTHOR_PAGE_FIXTURE = `
<DIV ALIGN="CENTER"><FONT SIZE="+2"><B>Works by Homer</B></FONT></DIV>
<A HREF="/Homer/hh.1.html"
onMouseOver="window.status='Read Homeric Hymns by Homer'; return true;" TARGET="_parent"><U>Homeric Hymns</U></A>
<FONT SIZE="-1"><BR>&nbsp;&nbsp;&nbsp;From the Perseus Project
<BR></FONT>
<BR>
<A HREF="/Homer/iliad.html"
onMouseOver="window.status='Read The Iliad by Homer'; return true;" TARGET="_parent"><U>The Iliad</U></A>
<FONT SIZE="-1"><BR>&nbsp;&nbsp;&nbsp;Written 800 B.C.E
<BR>&nbsp;&nbsp;&nbsp;Translated by Samuel Butler
<BR></FONT>
<BR>
<A HREF="/Homer/odyssey.html"
onMouseOver="window.status='Read The Odyssey by Homer'; return true;" TARGET="_parent"><U>The Odyssey</U></A>
<FONT SIZE="-1"><BR>&nbsp;&nbsp;&nbsp;Written 800 B.C.E
<BR>&nbsp;&nbsp;&nbsp;Translated by Samuel Butler
<BR></FONT>
<BR>
<TD ALIGN="CENTER" VALIGN="BOTTOM" NOWRAP><A HREF="/Help/general.html"
onMouseOver="window.status='Get help'; return true;" TARGET="_top"><IMG SRC="/Images/help-icon.gif" ALT="Get help"></A>
<FONT SIZE="-1"><BR><A HREF="/Help/general.html"
onMouseOver="window.status='Get help'; return true;" TARGET="_top">Help</A><BR>&nbsp;</FONT></TD>`;

// Trimmed excerpt of the real /Homer/iliad.html work page (verified live).
const WORK_TOC_FIXTURE = `
<DIV ALIGN="CENTER"><FONT SIZE="+2"><B>The Iliad</B></FONT>
<FONT SIZE="+1"><BR><BR>By Homer
<BR><BR>Written 800 B.C.E
<BR><BR>Translated by Samuel Butler</FONT></DIV>

<BLOCKQUOTE><U>The Iliad</U> has been divided into
the following sections:
<BR>
<A NAME="start"></A>
<DIV ALIGN="CENTER"><TABLE BORDER="0" CELLSPACING="5" CELLPADDING="3">
<TR VALIGN="TOP">
<TD ALIGN="LEFT"><A HREF="iliad.1.i.html" onMouseOver="window.status='Read Book I'; return true;">Book I</A> &nbsp;<FONT SIZE="-1">[47k]</FONT>
<BR><A HREF="iliad.2.ii.html" onMouseOver="window.status='Read Book II'; return true;">Book II</A> &nbsp;<FONT SIZE="-1">[63k]</FONT>
<BR><A HREF="iliad.3.iii.html" onMouseOver="window.status='Read Book III'; return true;">Book III</A> &nbsp;<FONT SIZE="-1">[36k]</FONT>
<BR></TD>
</TR>
</TABLE></DIV>

<HR SIZE="1" COLOR="990033" NOSHADE><BR>

<BR><BR><B>Download:</B> A 789k
text-only version is <A HREF="iliad.mb.txt"
onMouseOver="window.status='Download text-only version'; return true;">available for download</A>.

<A NAME="end"></A>
</BLOCKQUOTE>`;

// Trimmed excerpt of the real /Homer/iliad.1.i.html section page (verified
// live): PART_TITLE comment, NAME anchors at line starts, <BR><BR> paragraph
// breaks, a bold heading block, and speaker-free plain prose.
const SECTION_PAGE_FIXTURE = `
<HTML>
<HEAD>
<!--PART_TITLE: Book I-->
<TITLE>The Internet Classics Archive | The Iliad by Homer</TITLE>
</HEAD>
<BODY BGCOLOR="FFFFCC">
<DIV ALIGN="CENTER"><TABLE BORDER="0" CELLSPACING="15">
<TR ALIGN="CENTER" VALIGN="CENTER">
<TD><A HREF="/index.html" TARGET="_top"><IMG SRC="/Images/home-icon.gif" ALT="Go to home page"></A>
<FONT SIZE="-1"><BR><A HREF="/index.html" TARGET="_top">Home</A><BR>&nbsp;</FONT></TD>
</TR>
</TABLE></DIV>
<A NAME="1"></A><DIV ALIGN="CENTER"><FONT SIZE="+1"><B>The Iliad</B></FONT>
<A NAME="2"></A><BR><BR>By Homer</DIV>
<BR><DIV ALIGN="CENTER"><TABLE WIDTH="60%" BORDER="0">
<TR VALIGN="TOP">
<TD ALIGN="CENTER" NOWRAP><A HREF="iliad.html">Table of Contents</A>
<BR><BR><FONT SIZE="+1"><B>Book I</B></FONT></TD>
</TR>
</TABLE></DIV>
<BR>
<A NAME="start"></A>

<A NAME="10"></A>Sing, O goddess, the anger of Achilles son of Peleus, that brought countless
<A NAME="11"></A>ills upon the Achaeans. Many a brave soul did it send hurrying down to
<A NAME="12"></A>Hades, and many a hero did it yield a prey to dogs and vultures.
<A NAME="13"></A><BR><BR>And which of the gods was it that set them on to quarrel? It was
<A NAME="14"></A>the son of Jove and Leto; for he was angry with the king and sent a pestilence.
<A NAME="15"></A><BR><BR>"Sons of Atreus," he cried, "and all other Achaeans, may the gods
<A NAME="16"></A>grant you to sack the city of Priam.
<A NAME="end"></A>
<BR><HR SIZE="1" COLOR="990033" NOSHADE><BR>
<DIV ALIGN="CENTER"><TABLE BORDER="0" CELLSPACING="15">
<TR><TD><A HREF="/index.html">Home</A></TD></TR>
</TABLE></DIV>
</BODY>
</HTML>`;

describe("text helpers", () => {
	it("should decode named and numeric entities", () => {
		expect(
			decodeEntities("Homer&#39;s Aeneis &amp; the &#x39C;&sigma;&nbsp;end"),
		).toBe("Homer's Aeneis & the Μσ end");
		// Unknown named entities stay as-is instead of mangling the text.
		expect(decodeEntities("&nosuchthing;")).toBe("&nosuchthing;");
	});

	it("should flatten html snippets to single-line text", () => {
		expect(
			htmlToText(
				"<style>x</style><!-- c -->By&nbsp;Homer<br>Written 800 B.C.E<script>nope()</script>",
			),
		).toBe("By Homer Written 800 B.C.E");
	});
});

describe("id helpers", () => {
	it("should round-trip work uids and urls", () => {
		expect(parseWorkUid("Homer/iliad")).toEqual({
			dir: "Homer",
			file: "iliad",
		});
		expect(parseWorkUid("/Homer/iliad")).toEqual({
			dir: "Homer",
			file: "iliad",
		});
		expect(parseWorkUid("Homer/iliad.1.i")).toBeNull();
		expect(parseWorkUid("iliad")).toBeNull();
		expect(parseWorkUid("Homer/")).toBeNull();
		expect(workUrl("Homer/iliad")).toBe(
			"https://classics.mit.edu/Homer/iliad.html",
		);
		expect(authorBrowseUrl("Homer")).toBe(
			"https://classics.mit.edu/Browse/browse-Homer.html",
		);
		expect(BROWSE_INDEX_URL).toBe("https://classics.mit.edu/Browse/index.html");
	});

	it("should round-trip episode uids", () => {
		expect(parseEpisodeUid(episodeUid("Homer/iliad", 24))).toEqual({
			workUid: "Homer/iliad",
			n: 24,
		});
		expect(parseEpisodeUid("Homer/iliad")).toBeNull();
		expect(parseEpisodeUid("Homer/iliad#0")).toBeNull();
		expect(parseEpisodeUid("Homer/iliad#x")).toBeNull();
		expect(parseEpisodeUid("iliad#3")).toBeNull();
	});
});

describe("browse index and author pages", () => {
	it("should parse the author list with display names", () => {
		const authors = parseAuthors(BROWSE_INDEX_FIXTURE);
		expect(authors).toEqual([
			{ slug: "Aeschylus", name: "Aeschylus" },
			{ slug: "Homer", name: "Homer" },
			{ slug: "Virgil", name: "Virgil" },
		]);
	});

	it("should parse works, skipping Perseus-only pointers and nav links", () => {
		const works = parseAuthorWorks(AUTHOR_PAGE_FIXTURE);
		expect(works.map((w) => w.uid)).toEqual(["Homer/iliad", "Homer/odyssey"]);
		const iliad = works[0]!;
		expect(iliad.title).toBe("The Iliad");
		expect(iliad.author).toBe("Homer");
		expect(iliad.written).toBe("800 B.C.E");
		expect(iliad.translator).toBe("Samuel Butler");
		expect(iliad.url).toBe("https://classics.mit.edu/Homer/iliad.html");
	});

	it("should tolerate works without written/translator lines", () => {
		const body = AUTHOR_PAGE_FIXTURE.replaceAll(
			/\s*Written 800 B\.C\.E\s*<BR>&nbsp;&nbsp;&nbsp;Translated by Samuel Butler/g,
			"",
		);
		const works = parseAuthorWorks(body);
		expect(works.map((w) => w.uid)).toEqual(["Homer/iliad", "Homer/odyssey"]);
		for (const work of works) {
			expect(work.written).toBeNull();
			expect(work.translator).toBeNull();
		}
	});
});

describe("work pages", () => {
	it("should parse byline and sectioned table of contents", () => {
		const info = parseWorkPage(WORK_TOC_FIXTURE, "Homer/iliad");
		expect(info.title).toBe("The Iliad");
		expect(info.author).toBe("Homer");
		expect(info.written).toBe("800 B.C.E");
		expect(info.translator).toBe("Samuel Butler");
		expect(info.singlePage).toBe(false);
		expect(info.sections.map((s) => s.n)).toEqual([1, 2, 3]);
		expect(info.sections[0]).toEqual({
			n: 1,
			name: "Book I",
			url: "https://classics.mit.edu/Homer/iliad.1.i.html",
		});
		// The .txt download link must not leak into the sections.
		expect(info.sections.every((s) => s.url.endsWith(".html"))).toBe(true);
		expect(workDescription(info)).toBe(
			"By Homer. Written 800 B.C.E. Translated by Samuel Butler. Divided into 3 sections",
		);
	});

	it("should detect single-page works without a table of contents", () => {
		const body = `
		<DIV ALIGN="CENTER"><FONT SIZE="+2"><B>Agamemnon</B></FONT>
		<FONT SIZE="+1"><BR><BR>By Aeschylus
		<BR><BR>Written 458 B.C.E
		<BR><BR>Translated by E. D. A. Morshead</FONT></DIV>
		<BR><A NAME="start"></A>
		<A NAME="10"></A><FONT SIZE="+1"><B>Dramatis Personae</B></FONT>
		<A NAME="11"></A><BR><BR>A WATCHMAN<BR>
		<A NAME="end"></A>`;
		const info = parseWorkPage(body, "Aeschylus/agamemnon");
		expect(info.singlePage).toBe(true);
		expect(info.sections).toEqual([]);
		expect(info.title).toBe("Agamemnon");
		expect(info.author).toBe("Aeschylus");
		expect(workDescription(info)).toBe(
			"By Aeschylus. Written 458 B.C.E. Translated by E. D. A. Morshead",
		);
	});
});

describe("section pages", () => {
	it("should cut the readable region between the start and end anchors", () => {
		const region = extractContentRegion(SECTION_PAGE_FIXTURE);
		expect(region).toContain("Sing, O goddess");
		expect(region).not.toContain("Go to home page");
		expect(region).not.toContain("Table of Contents");

		// Without an end anchor the footer nav table cuts the region.
		const truncated = `
		<A NAME="start"></A>Some text<BR><BR>More text
		<DIV ALIGN="CENTER"><TABLE BORDER="0" CELLSPACING="15">
		<TR><TD><A HREF="/index.html">Home</A></TD></TR>
		</TABLE></DIV>`;
		expect(extractContentRegion(truncated)).toContain("More text");
		expect(extractContentRegion(truncated)).not.toContain("Home");
	});

	it("should turn the iliad book 1 section into clean paragraphs", () => {
		const paragraphs = parseSection(SECTION_PAGE_FIXTURE, null);
		expect(paragraphs).toEqual([
			// The PART_TITLE comment leads as a bold heading.
			{ content: "Book I", style: "bold" },
			{
				content:
					"Sing, O goddess, the anger of Achilles son of Peleus, that brought countless ills upon the Achaeans. Many a brave soul did it send hurrying down to Hades, and many a hero did it yield a prey to dogs and vultures.",
				style: null,
			},
			{
				content:
					"And which of the gods was it that set them on to quarrel? It was the son of Jove and Leto; for he was angry with the king and sent a pestilence.",
				style: null,
			},
			{
				content:
					'"Sons of Atreus," he cried, "and all other Achaeans, may the gods grant you to sack the city of Priam.',
				style: null,
			},
		]);
	});

	it("should keep verse line breaks and bold speakers/headings", () => {
		const body = `
		<!--PART_TITLE: Agamemnon-->
		<A NAME="start"></A>
		<A NAME="10"></A><FONT SIZE="+1"><B>Dramatis Personae</B></FONT>
		<A NAME="11"></A><BR><BR>A WATCHMAN<BR>
		<A NAME="12"></A>CHORUS OF ARGIVE ELDERS<BR><BR><BR>
		<A NAME="20"></A><B>WATCHMAN</B>
		<A NAME="21"></A><BLOCKQUOTE>I pray the gods to quit me of my toils,
		<A NAME="22"></A><BR>To close the watch I keep, this livelong year;
		<A NAME="23"></A><BR><BR>And now, as ever, am I set to mark<BR><BR>
		<A NAME="30"></A><B>CHORUS</B><BLOCKQUOTE>Thus marks the year.</BLOCKQUOTE>
		<A NAME="end"></A>`;
		expect(parseSection(body, null)).toEqual([
			{ content: "Agamemnon", style: "bold" },
			{ content: "Dramatis Personae", style: "bold" },
			{ content: "A WATCHMAN\nCHORUS OF ARGIVE ELDERS", style: null },
			{ content: "WATCHMAN", style: "bold" },
			{
				content:
					"I pray the gods to quit me of my toils,\nTo close the watch I keep, this livelong year;",
				style: null,
			},
			{ content: "And now, as ever, am I set to mark", style: null },
			{ content: "CHORUS", style: "bold" },
			{ content: "Thus marks the year.", style: null },
		]);
	});

	it("should fall back to the supplied heading when no PART_TITLE exists", () => {
		const body = `<A NAME="start"></A>Plain text only.<A NAME="end"></A>`;
		expect(parseSection(body, "Full text")).toEqual([
			{ content: "Full text", style: "bold" },
			{ content: "Plain text only.", style: null },
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

	it("should declare its network permission", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(["classics.mit.edu"]);
		}
	});

	it("should browse the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.media_type).toBe("Book");
		expect(result.content[0]!.id.uid).toContain("/");
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((e) => e.id.uid);
		const ids1 = page1.content.map((e) => e.id.uid);
		expect(ids1).not.toEqual(ids0);
		// No duplicates across pages.
		expect(ids0.filter((id) => ids1.includes(id))).toEqual([]);
		await assertValidEntries(page1.content);
	}, 120_000);

	it("should search the catalog for the Iliad", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "iliad");
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(false);
		expect(result.content.map((e) => e.id.uid)).toContain("Homer/iliad");
		const iliad = result.content.find((e) => e.id.uid === "Homer/iliad");
		expect(iliad?.title).toBe("The Iliad");
		expect(iliad?.author).toEqual(["Homer"]);
		await assertValidEntries(result.content);
	}, 120_000);

	it("should also match searches against the author name", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "samuel butler");
		expect(result.content.length).toBeGreaterThan(0);
		expect(
			result.content.every((e) => e.author?.includes("Homer") ?? false),
		).toBe(true);
	});

	it("should return nothing for empty searches or past-the-end pages", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const empty = await extension!.search(0, "   ");
		expect(empty.content.length).toBe(0);
		const page1 = await extension!.search(1, "iliad");
		expect(page1.content.length).toBe(0);
		const nohit = await extension!.search(0, "no such classics text xyz");
		expect(nohit.content.length).toBe(0);
		expect(nohit.hasnext).toBe(false);
	});

	it("should detail the Iliad with 24 book episodes and echo settings", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const probe: Setting = {
			label: "probe",
			value: { type: "String", data: "x" },
			default: { type: "String", data: "x" },
			visible: true,
		};
		const result = await extension!.detail({ uid: "Homer/iliad" }, { probe });
		const entry = result.entry;
		expect(entry.media_type).toBe("Book");
		expect(entry.language).toBe("en");
		expect(entry.titles[0]).toBe("The Iliad");
		expect(entry.author).toEqual(["Homer"]);
		expect(entry.status).toBe("Complete");
		expect(entry.url).toBe("https://classics.mit.edu/Homer/iliad.html");
		expect(entry.description).toContain("Samuel Butler");
		expect(entry.episodes.length).toBe(24);
		expect(entry.episodes[0]!.name).toBe("Book I");
		expect(entry.episodes[0]!.id.uid).toBe("Homer/iliad#1");
		expect(entry.episodes[0]!.url).toBe(
			"https://classics.mit.edu/Homer/iliad.1.i.html",
		);
		expect(entry.meta?.Translator).toBe("Samuel Butler");
		// The detail UI carries the public-domain note.
		expect(JSON.stringify(entry.ui)).toContain("Public-domain");
		// The host normalises echoed settings (adds "ui": null).
		expect(result.settings).toEqual({ probe: { ...probe, ui: null } });
		await assertValidEntry(entry);
		detailResult = result;
	}, 120_000);

	it("should source Iliad book 1 as reading paragraphs", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined) throw new Error("No detail result");
		const episode = detailResult.entry.episodes[0]!;
		const result = await extension!.source(episode.id, detailResult.settings);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(10);
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		// The PART_TITLE heading leads bold; real prose follows, entities decoded.
		const heading = result.source.paragraphs[0];
		expect(heading?.type).toBe("Text");
		if (heading?.type === "Text") {
			expect(heading.content).toBe("Book I");
			expect(heading.style?.bold).toBe(true);
		}
		expect(texts.some((t) => t.includes("anger of Achilles"))).toBe(true);
		expect(texts.some((t) => t.includes('"'))).toBe(true);
		// No site chrome leaks into the text.
		expect(texts.some((t) => t.includes("Home") && t.includes("Buy"))).toBe(
			false,
		);
		expect(result.settings).toEqual(detailResult.settings);
		await assertValidSource(result.source);
	}, 120_000);

	it("should resolve sections from the uid alone", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.source(
			{ uid: episodeUid("Homer/iliad", 2) },
			{},
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		expect(result.source.paragraphs.length).toBeGreaterThan(10);
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		expect(texts[0]).toBe("Book II");
	}, 120_000);

	it("should handle single-page works with one Full text episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const detail = await extension!.detail({ uid: "Aeschylus/agamemnon" }, {});
		expect(detail.entry.titles[0]).toBe("Agamemnon");
		expect(detail.entry.author).toEqual(["Aeschylus"]);
		expect(detail.entry.episodes.length).toBe(1);
		expect(detail.entry.episodes[0]!.name).toBe("Full text");
		await assertValidEntry(detail.entry);

		const result = await extension!.source(
			detail.entry.episodes[0]!.id,
			detail.settings,
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		const texts = result.source.paragraphs.map((p) =>
			p.type === "Text" ? p.content : "",
		);
		// Bold cast headings and speaker names survive as their own paragraphs.
		expect(texts).toContain("Dramatis Personae");
		expect(texts).toContain("WATCHMAN");
		expect(
			texts.some((t) => t.includes("I pray the gods to quit me of my toils")),
		).toBe(true);
		await assertValidSource(result.source);
	}, 120_000);

	it("should reject unknown work and section ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "not-a-work" }, {})).rejects.toThrow(
			/invalid work id/,
		);
		await expect(extension!.source({ uid: "bogus#1" }, {})).rejects.toThrow(
			/invalid section id/,
		);
		await expect(
			extension!.source({ uid: "Homer/iliad#999" }, {}),
		).rejects.toThrow(/no section 999/);
	});
});
