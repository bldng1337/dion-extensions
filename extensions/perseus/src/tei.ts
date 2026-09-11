// Pure helpers + curated catalog for the Perseus Digital Library extension.
// No built-in module imports here so unit tests can load this file directly.

import type { Paragraph } from "@dion-js/runtime-types/runtime";

// ---------------------------------------------------------------------------
// Endpoints (all verified against https://github.com/PerseusDL)
//
// The extension reads pre-generated TEI XML files straight from
// raw.githubusercontent.com. Every catalog path below was verified in one
// bulk `git/trees/HEAD?recursive=1` call per repo (the GitHub API allows
// only 60 unauthenticated requests/hour, but one tree call returns every
// path at once), so the extension itself never needs the API at runtime.
//
// TEI layout of the curated editions (all modern CTS re-releases):
//   <TEI><teiHeader>...<titleStmt><title/><author/></titleStmt>...
//   <text xml:lang="grc|la"><body>
//     <div type="edition">
//       <div type="textpart" subtype="book|section|poem" n="N">  <- episodes
//         <l n="...">verse</l> / <p>prose</p> (<sp><speaker/></sp> in drama)
// ---------------------------------------------------------------------------

export const GITHUB_ORG = "PerseusDL";
export const GREEK_REPO = "canonical-greekLit";
export const LATIN_REPO = "canonical-latinLit";
export const BRANCH = "master";
export const RAW_BASE = "https://raw.githubusercontent.com";
export const API_BASE = "https://api.github.com/repos";
export const USER_AGENT = "dion-extensions perseus/1.0 (personal reader)";

export const ATTRIBUTION =
	"Perseus Digital Library / Open Greek & Latin (CC BY-SA 4.0)";

/** One git-tree call per repo returns every file path at once. */
export function treeUrl(repo: string): string {
	return `${API_BASE}/${GITHUB_ORG}/${repo}/git/trees/HEAD?recursive=1`;
}

export function rawUrl(repo: string, path: string): string {
	return `${RAW_BASE}/${GITHUB_ORG}/${repo}/${BRANCH}/${path}`;
}

export function blobUrl(repo: string, path: string): string {
	return `https://github.com/${GITHUB_ORG}/${repo}/blob/${BRANCH}/${path}`;
}

// ---------------------------------------------------------------------------
// Curated catalog
// ---------------------------------------------------------------------------

export interface Work {
	uid: string;
	title: string;
	author: string;
	/** ISO 639-3-ish code, mirrors package.json `lang`. */
	lang: "grc" | "la";
	repo: string;
	/** Repo-relative path of the TEI XML file (verified to exist). */
	path: string;
	description: string;
}

/** Flagship works of the Greek and Latin canon. Keep this list small:
 * every detail()/source() call downloads a full TEI file (the Iliad alone
 * is ~8 MB), so depth beats breadth here. */
export const WORKS: Work[] = [
	{
		uid: "iliad",
		title: "Iliad",
		author: "Homer",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0012/tlg001/tlg0012.tlg001.perseus-grc2.xml",
		description:
			"Homer's epic of the wrath of Achilles in the final year of the Trojan War, in 24 books.",
	},
	{
		uid: "odyssey",
		title: "Odyssey",
		author: "Homer",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0012/tlg002/tlg0012.tlg002.perseus-grc2.xml",
		description:
			"Homer's epic of Odysseus' ten-year voyage home to Ithaca, in 24 books.",
	},
	{
		uid: "theogony",
		title: "Theogony",
		author: "Hesiod",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0020/tlg001/tlg0020.tlg001.perseus-grc2.xml",
		description:
			"Hesiod's genealogy of the gods, from the rise of Chaos to the triumph of Zeus.",
	},
	{
		uid: "works-and-days",
		title: "Works and Days",
		author: "Hesiod",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0020/tlg002/tlg0020.tlg002.perseus-grc2.xml",
		description:
			"Hesiod's didactic poem on labour, farming and justice, addressed to his brother Perses.",
	},
	{
		uid: "medea",
		title: "Medea",
		author: "Euripides",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0006/tlg003/tlg0006.tlg003.perseus-grc2.xml",
		description:
			"Euripides' tragedy of Medea's revenge on Jason, edited by Gilbert Murray.",
	},
	{
		uid: "oedipus-tyrannus",
		title: "Oedipus Tyrannus",
		author: "Sophocles",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0011/tlg004/tlg0011.tlg004.perseus-grc2.xml",
		description:
			"Sophocles' tragedy of Oedipus, who unknowingly killed his father and married his mother.",
	},
	{
		uid: "antigone",
		title: "Antigone",
		author: "Sophocles",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0011/tlg002/tlg0011.tlg002.perseus-grc2.xml",
		description:
			"Sophocles' tragedy of Antigone's defiance of Creon's edict and the claims of family burial.",
	},
	{
		uid: "ajax",
		title: "Ajax",
		author: "Sophocles",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0011/tlg003/tlg0011.tlg003.perseus-grc2.xml",
		description:
			"Sophocles' tragedy of Ajax's shame and suicide after the arms of Achilles are awarded to Odysseus.",
	},
	{
		uid: "oedipus-at-colonus",
		title: "Oedipus at Colonus",
		author: "Sophocles",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0011/tlg007/tlg0011.tlg007.perseus-grc2.xml",
		description:
			"Sophocles' tragedy of the blind Oedipus' arrival and mysterious apotheosis at Colonus.",
	},
	{
		uid: "clouds",
		title: "Clouds",
		author: "Aristophanes",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0019/tlg003/tlg0019.tlg003.perseus-grc2.xml",
		description:
			"Aristophanes' comedy lampooning Socrates and the sophists of the Thinkery.",
	},
	{
		uid: "apology",
		title: "Apology",
		author: "Plato",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0059/tlg002/tlg0059.tlg002.perseus-grc2.xml",
		description:
			"Plato's account of the speech Socrates gave at his trial for impiety in 399 BC.",
	},
	{
		uid: "meditations",
		title: "Meditations",
		author: "Marcus Aurelius",
		lang: "grc",
		repo: GREEK_REPO,
		path: "data/tlg0562/tlg001/tlg0562.tlg001.perseus-grc2.xml",
		description:
			"The private Stoic notebook of the emperor Marcus Aurelius, written in Greek in 12 books.",
	},
	{
		uid: "gallic-war",
		title: "Gallic War",
		author: "Caesar",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0448/phi001/phi0448.phi001.perseus-lat2.xml",
		description:
			"Caesar's account of his campaigns in Gaul, 58-50 BC, in 8 books of brisk third-person prose.",
	},
	{
		uid: "in-catilinam",
		title: "In Catilinam I",
		author: "Cicero",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0474/phi013/phi0474.phi013.perseus-lat2.xml",
		description:
			"Cicero's first speech against Catiline, delivered in the senate on 8 November 63 BC.",
	},
	{
		uid: "aeneid",
		title: "Aeneid",
		author: "Vergil",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0690/phi003/phi0690.phi003.perseus-lat2.xml",
		description:
			"Vergil's epic of Aeneas' flight from Troy and the founding of Rome, in 12 books.",
	},
	{
		uid: "georgics",
		title: "Georgics",
		author: "Vergil",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0690/phi002/phi0690.phi002.perseus-lat2.xml",
		description:
			"Vergil's didactic poem on the crafts of the countryside: fields, trees, animals and bees.",
	},
	{
		uid: "metamorphoses",
		title: "Metamorphoses",
		author: "Ovid",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0959/phi006/phi0959.phi006.perseus-lat2.xml",
		description:
			"Ovid's mythological epic of transformations, in 15 books from creation to the deified Caesar.",
	},
	{
		uid: "odes",
		title: "Odes",
		author: "Horace",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0893/phi001/phi0893.phi001.perseus-lat2.xml",
		description:
			"Horace's lyric carmina in four books: love, wine, friendship and the Roman ideal.",
	},
	{
		uid: "civil-war",
		title: "Civil War",
		author: "Lucan",
		lang: "la",
		repo: LATIN_REPO,
		path: "data/phi0917/phi001/phi0917.phi001.perseus-lat2.xml",
		description:
			"Lucan's stormy, unfinished epic on the war between Caesar and Pompey, in 10 books.",
	},
];

export const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
};

/** Decode the (few) entities Perseus TEI files use. Unknown named entities
 * are left as-is rather than eaten. */
export function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&([a-zA-Z]+);/g, (ent, name: string) => {
			const mapped: string | undefined = NAMED_ENTITIES[name];
			return mapped !== undefined ? mapped : ent;
		});
}

/** Strip markup, drop editorial <note>s and milestones, decode entities and
 * collapse whitespace — the last step a TEI text needs to become readable. */
export function cleanTeiText(raw: string): string {
	return decodeEntities(
		raw
			.replace(/<note\b[^>]*>[\s\S]*?<\/note\s*>/gi, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// TEI header
// ---------------------------------------------------------------------------

export interface TeiHeader {
	title: string;
	author: string;
	lang: string;
}

function firstMatch(xml: string, pattern: RegExp): string {
	const m = pattern.exec(xml);
	return m?.[1] ?? "";
}

/** Pull title/author from <titleStmt> and the language from <text xml:lang>. */
export function extractHeader(xml: string): TeiHeader {
	const stmt = firstMatch(xml, /<titleStmt\b[^>]*>([\s\S]*?)<\/titleStmt\s*>/);
	const title = cleanTeiText(
		firstMatch(stmt, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/),
	);
	const author = cleanTeiText(
		firstMatch(stmt, /<author\b[^>]*>([\s\S]*?)<\/author\s*>/),
	);
	const lang =
		firstMatch(xml, /<text\b[^>]*?xml:lang="([^"]+)"/) ||
		firstMatch(xml, /<div\b[^>]*?type="edition"[^>]*?xml:lang="([^"]+)"/);
	return { title, author, lang };
}

// ---------------------------------------------------------------------------
// Div scanning: regex over Perseus's machine-generated (and therefore very
// regular) markup, counting <div>/</div> tokens instead of a real XML parser.
// ---------------------------------------------------------------------------

export interface DivBlock {
	openStart: number;
	contentStart: number;
	/** Index of the matching </div>, or of the tag itself when self-closing. */
	contentEnd: number;
	/** Raw attribute text of the opening tag. */
	attrs: string;
}

function attrOf(block: DivBlock, name: string): string | undefined {
	const m = RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(block.attrs);
	return m?.[1];
}

/** All divs whose depth is 0 relative to [from, to), with their content
 * offsets. Handles nesting and self-closing <div/>; stops scanning at `to`. */
function scanTopDivs(xml: string, from: number, to: number): DivBlock[] {
	const out: DivBlock[] = [];
	const stack: DivBlock[] = [];
	const token = /<div\b[^>]*?>|<\/div\s*>/g;
	token.lastIndex = from;
	for (
		let m = token.exec(xml);
		m !== null && m.index < to;
		m = token.exec(xml)
	) {
		const tok = m[0];
		if (tok.startsWith("</")) {
			const opened = stack.pop();
			if (!opened) {
				continue;
			}
			opened.contentEnd = m.index;
			if (stack.length === 0) {
				out.push(opened);
			}
		} else {
			const selfClosing = tok.endsWith("/>");
			const block: DivBlock = {
				openStart: m.index,
				contentStart: m.index + tok.length,
				contentEnd: m.index + tok.length,
				attrs: tok.slice(4, -1),
			};
			if (selfClosing) {
				// Never enters the stack: it is complete at open time.
				if (stack.length === 0) {
					out.push(block);
				}
			} else {
				stack.push(block);
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Episodes: the readable units of a work
// ---------------------------------------------------------------------------

export interface TeiPart {
	/** Canonical reference (the div's n), or "full" for undivided works. */
	uid: string;
	/** Display name, e.g. "Book 1" or "Section 17". */
	name: string;
	contentStart: number;
	contentEnd: number;
}

/** Subtypes trusted as episode units. Drama files mix subtype="episode",
 * "choral", "strophe"... which we do not split — those plays become one
 * full-text episode instead. */
const EPISODE_SUBTYPES = new Set(["book", "section", "poem"]);

function fullPart(contentStart: number, contentEnd: number): TeiPart {
	return {
		uid: "full",
		name: "Full text",
		contentStart,
		contentEnd,
	};
}

/**
 * Build the episode list of a TEI file: the direct textpart children of the
 * wrapping <div type="edition"> when they are books/sections/poems, otherwise
 * a single "Full text" episode covering the whole edition div.
 */
export function extractParts(xml: string): TeiPart[] {
	const bodyOpen = /<body\b[^>]*>/.exec(xml);
	if (!bodyOpen) {
		return [];
	}
	const from = bodyOpen.index + bodyOpen[0].length;
	const edition = scanTopDivs(xml, from, xml.length)[0];
	if (!edition) {
		return [fullPart(from, xml.length)];
	}
	const children = scanTopDivs(xml, edition.contentStart, edition.contentEnd);
	const parts = children.filter((c) => attrOf(c, "type") === "textpart");
	const readable =
		parts.length > 0 &&
		parts.every((p) =>
			EPISODE_SUBTYPES.has((attrOf(p, "subtype") ?? "").toLowerCase()),
		);
	if (!readable) {
		return [fullPart(edition.contentStart, edition.contentEnd)];
	}
	return parts.map((p, i) => {
		const subtype = attrOf(p, "subtype") ?? "part";
		const n = attrOf(p, "n") ?? String(i + 1);
		const label = subtype.charAt(0).toUpperCase() + subtype.slice(1);
		return {
			uid: n,
			name: `${label} ${n}`,
			contentStart: p.contentStart,
			contentEnd: p.contentEnd,
		};
	});
}

// ---------------------------------------------------------------------------
// Text of one episode -> Paragraphlist
// ---------------------------------------------------------------------------
// One paragraph per <l> verse line; prose <p> elements become one paragraph
// each; <speaker> names become bold paragraphs. Editorial <note>s (apparatus,
// dramatis personae) and milestones are dropped.

/** Remove non-text markup before scanning for lines/paragraphs. */
function stripNonText(scope: string): string {
	return scope
		.replace(/<note\b[^>]*>[\s\S]*?<\/note\s*>/gi, " ")
		.replace(/<(milestone|lb|gap|pb)\b[^>]*?>/gi, " ");
}

/** Extract the readable paragraphs of the XML range [contentStart, contentEnd).
 * A literal regex (rebuilt per call) so its `g` state can never leak between
 * calls or across the runtime's JS boundary. */
export function extractParagraphs(
	xml: string,
	contentStart: number,
	contentEnd: number,
): Paragraph[] {
	const scope = stripNonText(xml.slice(contentStart, contentEnd));
	const out: Paragraph[] = [];
	const pattern =
		/<speaker\b[^>]*>([\s\S]*?)<\/speaker\s*>|<l\b[^>]*\/>|<l\b[^>]*>([\s\S]*?)<\/l\s*>|<p\b[^>]*\/>|<p\b[^>]*>([\s\S]*?)<\/p\s*>/g;
	for (let m = pattern.exec(scope); m !== null; m = pattern.exec(scope)) {
		if (m[1] !== undefined) {
			const speaker = cleanTeiText(m[1]);
			if (speaker.length > 0) {
				out.push({ type: "Text", content: speaker, style: { bold: true } });
			}
			continue;
		}
		const raw = m[2] ?? m[3] ?? "";
		const text = cleanTeiText(raw);
		if (text.length > 0) {
			out.push({ type: "Text", content: text, style: null });
		}
	}
	return out;
}
