/** biome-ignore-all lint/style/noNonNullAssertion: These are tests so if they fail it is fine */
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
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { join } from "node:path";
import {
	blobUrl,
	cleanTeiText,
	decodeEntities,
	extractHeader,
	extractParts,
	extractParagraphs,
	rawUrl,
	treeUrl,
	WORKS,
} from "./tei.ts";

let extension: Extension;

let browseResult: Entry[];
let iliadDetail: EntryDetailedResult;

// ---------------------------------------------------------------------------
// Inline TEI fixtures in the exact shape of the PerseusDL CTS files
// ---------------------------------------------------------------------------

const TEI_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
    <teiHeader>
        <fileDesc>
            <titleStmt>
                <title xml:lang="grc">Μῆδεια</title>
                <author>Euripides</author>
            </titleStmt>
        </fileDesc>
    </teiHeader>
    <text xml:lang="grc">
        <body xml:base="urn:cts:greekLit:tlg0006.tlg003.perseus-grc2">`;

const TEI_SUFFIX = `
        </body>
    </text>
</TEI>`;

/** Verse work whose edition div holds book textparts, each holding lines
 * (one self-closing dummy, one with an editorial note inside). */
const BOOKS_XML = `${TEI_PREFIX}
            <div type="edition" xml:lang="grc">
                <div type="textpart" subtype="Book" n="1">
                    <milestone ed="P" unit="para"/>
                    <l n="1">μῆνιν ἄειδε θεὰ &amp; Πηληϊάδεω Ἀχιλῆος</l>
                    <l style="hidden" n="0"/>
                    <l n="2">οὐλομένην, ἣ μυρί᾽ <note resp="editor">app crit</note>Ἀχαιοῖς ἄλγε᾽ ἔθηκε</l>
                </div>
                <div type="textpart" subtype="Book" n="2">
                    <l n="1">δεύτερον ἆσμ᾽ ἀείδειν</l>
                </div>
            </div>${TEI_SUFFIX}`;

/** Drama: mixed episode/choral textparts (not split into episodes) with a
 * dramatis-personae note containing <p> elements that must be dropped. */
const DRAMA_XML = `${TEI_PREFIX}
            <div type="edition" xml:lang="grc">
                <note place="inline">
                    <p>τὰ τοῦ δράματος πρόσωπα</p>
                    <p>Τροφός</p>
                </note>
                <div type="textpart" subtype="episode">
                    <sp>
                        <speaker>Τροφός</speaker>
                        <l>τέκνον, ὦ δέσποινα, Μήδεια</l>
                    </sp>
                </div>
                <div type="textpart" subtype="choral">
                    <div type="textpart" subtype="strophe" n="1">
                        <l>ἔσθλὸν γὰρ ἀνδράσιν</l>
                    </div>
                </div>
            </div>${TEI_SUFFIX}`;

/** Prose work with section textparts holding <p> paragraphs and inline <num>. */
const PROSE_XML = `${TEI_PREFIX}
            <div type="edition" xml:lang="la">
                <div type="textpart" subtype="section" xml:base="urn:cts:latinLit:phi0474.phi013:1" n="1">
                    <p>Quo usque tandem abutere, <num>1</num> Catilina, patientia nostra?</p>
                </div>
                <div type="textpart" subtype="section" xml:base="urn:cts:latinLit:phi0474.phi013:2" n="2">
                    <p>Nihilne te nocturnum praesidium Palati?</p>
                </div>
            </div>${TEI_SUFFIX}`;

/** Nested books > chapters, to prove div depth is counted correctly. */
const NESTED_XML = `${TEI_PREFIX}
            <div type="edition" xml:lang="grc">
                <div type="textpart" subtype="book" n="1">
                    <div type="textpart" subtype="chapter" n="1">
                        <p>πρῶτον</p>
                    </div>
                    <div type="textpart" subtype="chapter" n="2">
                        <p>δεύτερον</p>
                    </div>
                </div>
                <div type="textpart" subtype="book" n="2">
                    <div type="textpart" subtype="chapter" n="1">
                        <p>τρίτον</p>
                    </div>
                </div>
            </div>${TEI_SUFFIX}`;

const textContents = (paragraphs: Paragraph[]): string[] =>
	paragraphs.map((p) => (p.type === "Text" ? p.content : ""));

const textStyle = (paragraph: Paragraph | undefined) =>
	paragraph && paragraph.type === "Text" ? paragraph.style : null;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

describe("catalog", () => {
	it("should have unique uids and verified-shaped paths", () => {
		const uids = WORKS.map((work) => work.uid);
		expect(new Set(uids).size).toBe(uids.length);
		for (const work of WORKS) {
			expect(work.path).toMatch(/^data\/(tlg|phi)\d+\/(tlg|phi)\d+\//);
			expect(work.repo).toMatch(/^canonical-(greek|latin)Lit$/);
			expect(["grc", "la"]).toContain(work.lang);
		}
	});

	it("should build github urls", () => {
		expect(rawUrl("canonical-greekLit", "data/x/y.xml")).toBe(
			"https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/x/y.xml",
		);
		expect(blobUrl("canonical-latinLit", "data/x/y.xml")).toBe(
			"https://github.com/PerseusDL/canonical-latinLit/blob/master/data/x/y.xml",
		);
		// The bulk-tree endpoint used to verify the curated paths (one call
		// returns every path in a repo; 60 unauthenticated calls/hour is the
		// API limit, which is why it is not used at runtime).
		expect(treeUrl("canonical-greekLit")).toBe(
			"https://api.github.com/repos/PerseusDL/canonical-greekLit/git/trees/HEAD?recursive=1",
		);
	});
});

describe("tei helpers", () => {
	it("should decode numeric and named entities", () => {
		expect(decodeEntities("&#957;άς &amp; &#x3C0;ε&#960;όv")).toBe(
			"νάς & πεπόv",
		);
		expect(decodeEntities("&lt;x&gt; &quot;q&quot; &mdash; &unknown;")).toBe(
			'<x> "q" — &unknown;',
		);
	});

	it("should strip tags and editorial notes from TEI text", () => {
		expect(
			cleanTeiText(
				'οὐλομένην, ἣ μυρί᾽ <note resp="editor">app crit</note>Ἀχαιοῖς\n  ἄλγε᾽ <num>7</num> ἔθηκε',
			),
		).toBe("οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ 7 ἔθηκε");
	});

	it("should read the header of a TEI file", () => {
		const header = extractHeader(BOOKS_XML);
		expect(header.title).toBe("Μῆδεια");
		expect(header.author).toBe("Euripides");
		expect(header.lang).toBe("grc");
	});

	it("should list book textparts as episodes", () => {
		const parts = extractParts(BOOKS_XML);
		expect(parts.map((p) => `${p.uid} ${p.name}`)).toEqual([
			"1 Book 1",
			"2 Book 2",
		]);
	});

	it("should keep a drama work as a single full-text episode", () => {
		const parts = extractParts(DRAMA_XML);
		expect(parts).toHaveLength(1);
		expect(parts[0]!.uid).toBe("full");
	});

	it("should list section textparts as episodes", () => {
		const parts = extractParts(PROSE_XML);
		expect(parts.map((p) => p.name)).toEqual(["Section 1", "Section 2"]);
	});

	it("should only treat top-level textparts as episodes", () => {
		const parts = extractParts(NESTED_XML);
		expect(parts.map((p) => p.uid)).toEqual(["1", "2"]);
		// Book 1 must end before book 2 starts: no leakage of nested content.
		const book1 = extractParagraphs(
			NESTED_XML,
			parts[0]!.contentStart,
			parts[0]!.contentEnd,
		);
		expect(textContents(book1)).toEqual(["πρῶτον", "δεύτερον"]);
		const book2 = extractParagraphs(
			NESTED_XML,
			parts[1]!.contentStart,
			parts[1]!.contentEnd,
		);
		expect(textContents(book2)).toEqual(["τρίτον"]);
	});

	it("should turn verse lines, speakers and paragraphs into reading text", () => {
		const book1 = extractParagraphs(BOOKS_XML, 0, BOOKS_XML.length);
		// extractParagraphs scans the whole fixture here; the edition div is
		// the only text, so this checks the element-to-paragraph mapping.
		expect(textContents(book1)).toEqual([
			"μῆνιν ἄειδε θεὰ & Πηληϊάδεω Ἀχιλῆος",
			"οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε",
			"δεύτερον ἆσμ᾽ ἀείδειν",
		]);
	});

	it("should mark speakers bold and drop dramatis-personae notes", () => {
		const paragraphs = extractParagraphs(DRAMA_XML, 0, DRAMA_XML.length);
		expect(textContents(paragraphs)).toEqual([
			"Τροφός",
			"τέκνον, ὦ δέσποινα, Μήδεια",
			"ἔσθλὸν γὰρ ἀνδράσιν",
		]);
		expect(textStyle(paragraphs[0])?.bold).toBe(true);
		expect(textStyle(paragraphs[1])?.bold ?? false).toBe(false);
	});

	it("should strip inline markup in prose paragraphs", () => {
		const section1 = extractParts(PROSE_XML)[0]!;
		const paragraphs = extractParagraphs(
			PROSE_XML,
			section1.contentStart,
			section1.contentEnd,
		);
		expect(textContents(paragraphs)).toEqual([
			"Quo usque tandem abutere, 1 Catilina, patientia nostra?",
		]);
	});
});

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Book");
	}, 120_000);

	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual([
				"api.github.com",
				"raw.githubusercontent.com",
			]);
		}
	}, 120_000);

	it("should browse the curated catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result.content.length).toBe(10);
		expect(result.hasnext).toBe(true);
		expect(result.content[0]!.id.uid).toBe("iliad");
		expect(result.content[0]!.title).toBe("Iliad");
		expect(result.content[0]!.author).toContain("Homer");
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate the catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(1);
		expect(result.content.length).toBe(WORKS.length - 10);
		expect(result.hasnext).toBe(false);
		expect(result.content.map((e) => e.id.uid)).not.toContain("iliad");
		expect(result.content.map((e) => e.id.uid)).toContain("meditations");
		await assertValidEntries(result.content);
	}, 120_000);

	it("should search the catalog by title and author", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const iliad = await extension!.search(0, "iliad");
		expect(iliad.content.map((e) => e.id.uid)).toEqual(["iliad"]);
		const vergil = await extension!.search(0, "vergil");
		expect(vergil.content.map((e) => e.id.uid)).toEqual(["aeneid", "georgics"]);
		const none = await extension!.search(0, "zzz-no-such-work");
		expect(none.content).toHaveLength(0);
		const empty = await extension!.search(0, "   ");
		expect(empty.content).toHaveLength(0);
	}, 120_000);

	it("should detail the Iliad with its 24 books as episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult.length === 0) throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result.entry.id.uid).toBe("iliad");
		expect(result.entry.media_type).toBe("Book");
		expect(result.entry.episodes.length).toBe(24);
		expect(result.entry.episodes[0]!.id.uid).toBe("iliad#1");
		expect(result.entry.episodes[0]!.name).toBe("Book 1");
		expect(result.entry.description).toContain("CC BY-SA");
		expect(result.entry.titles).toContain("Iliad");
		expect(result.settings).toEqual({});
		await assertValidEntry(result.entry);
		iliadDetail = result;
	}, 120_000);

	it("should source Iliad book 1 as Greek verse lines", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (iliadDetail === undefined) throw new Error("No Iliad detail");
		const episode = iliadDetail.entry.episodes[0]!;
		const result: SourceResult = await extension!.source(
			episode.id,
			iliadDetail.settings as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Paragraphlist");
		if (result.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		const paragraphs = result.source.paragraphs;
		// Book 1 of the Iliad has 611 lines; each line becomes one paragraph.
		expect(paragraphs.length).toBeGreaterThan(500);
		// First verse of book 1 (opening <milestone> and the multi-line <l>
		// element are handled).
		const contents = textContents(paragraphs);
		expect(contents[0]).toBe("μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος");
		// Attribution footer.
		const last = paragraphs[paragraphs.length - 1]!;
		if (last.type !== "Text") throw new Error("Last paragraph not text");
		expect(last.content).toContain("CC BY-SA");
		expect(result.settings).toEqual({});
		await assertValidSource(result.source);
	}, 120_000);

	it("should detail and source a drama work as one full-text episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.detail({ uid: "medea" }, {});
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.episodes[0]!.id.uid).toBe("medea#full");
		expect(result.entry.author).toContain("Euripides");
		await assertValidEntry(result.entry);
		const source = await extension!.source(
			result.entry.episodes[0]!.id,
			result.settings as { [key: string]: Setting },
		);
		expect(source.source.type).toBe("Paragraphlist");
		if (source.source.type !== "Paragraphlist") {
			throw new Error("Not a paragraphlist");
		}
		const paragraphs = source.source.paragraphs;
		// A whole play: prologue lines, speaker names, choral odes.
		expect(paragraphs.length).toBeGreaterThan(1000);
		const contents = textContents(paragraphs);
		expect(contents.some((c) => c.includes("Ἀργοῦς"))).toBe(true);
		// Speaker names are bold paragraphs.
		expect(paragraphs.some((p) => p.type === "Text" && p.style?.bold)).toBe(
			true,
		);
		expect(contents.some((c) => c === "Τροφός" || c === "Παιδαγωγός")).toBe(
			true,
		);
		await assertValidSource(source.source);
	}, 120_000);

	it("should throw for an unknown work or episode", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		expect(extension!.detail({ uid: "does-not-exist" }, {})).rejects.toThrow();
		expect(extension!.source({ uid: "iliad#99" }, {})).rejects.toThrow();
	}, 120_000);
});
