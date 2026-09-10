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
	DEFAULT_SHOW,
	SHOWS,
	buildDescription,
	clampText,
	computeHasNext,
	decodeEntities,
	extractMp3,
	extractOgImage,
	getShow,
	headerValue,
	makeUid,
	parseCredits,
	parseStoryAuthor,
	parseUid,
	stripHtml,
	stripShowPrefix,
} from "./site.ts";

let extension: Extension;
let browseResult: Entry[];
let detailResult: EntryDetailedResult;

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

// ---------------------------------------------------------------------------
// Unit tests for the parsing helpers (inline fixtures, no network)
// ---------------------------------------------------------------------------

describe("site helpers", () => {
	it("should resolve show configs and uids", () => {
		expect(DEFAULT_SHOW).toBe("escapepod");
		expect(getShow("podcastle").label).toBe("PodCastle");
		expect(getShow("nope").key).toBe(DEFAULT_SHOW);
		expect(getShow(undefined).key).toBe(DEFAULT_SHOW);

		const uid = makeUid("pseudopod", 12905);
		expect(uid).toBe("pseudopod:12905");
		expect(parseUid(uid)).toEqual({
			show: getShow("pseudopod"),
			postId: 12905,
		});
		expect(parseUid("escapepod:notanumber")).toBeUndefined();
		expect(parseUid("nosuchshow:123")).toBeUndefined();
		expect(parseUid("123")).toBeUndefined();
	});

	it("should decode HTML entities", () => {
		expect(
			decodeEntities("Kwong&#039;s Bath &amp; The &#8220;Sea&#8221;"),
		).toBe("Kwong's Bath & The “Sea”");
		expect(decodeEntities("a &lt;b&gt; &#x263A;")).toBe("a <b> ☺");
		// Single pass: amp first must not double-decode.
		expect(decodeEntities("&amp;#8230;")).toBe("&#8230;");
		expect(decodeEntities("plain")).toBe("plain");
	});

	it("should strip HTML into readable show notes", () => {
		const html =
			"<h3>Soft Currency</h3>\n<h4>By Seth Gordon</h4>\n" +
			"<p>Cassie learned that her mother was a criminal.</p>\n" +
			'<p><!--more--> She ate <em>snow</em> cones&#8230;<a href="#">more</a></p>';
		const text = stripHtml(html);
		expect(text).not.toContain("<");
		expect(text).toContain("Soft Currency");
		expect(text).toContain("criminal.");
		expect(text).toContain("snow cones… more");
		expect(stripHtml("<script>evil()</script><p>safe</p>")).toBe("safe");
	});

	it("should extract the story author from the content h4", () => {
		expect(parseStoryAuthor("<h3>T</h3>\n<h4>by Trae Hawkins</h4>")).toBe(
			"Trae Hawkins",
		);
		expect(
			parseStoryAuthor('<h4>By <span data-x="1">C. W. Maurer</span></h4>'),
		).toBe("C. W. Maurer");
		expect(parseStoryAuthor("<p>no author here</p>")).toBeUndefined();
	});

	it("should parse the role_label credits from an episode page", () => {
		const html = `
		<ul>
		<li> <span class="role_label">Author</span> : <a href="https://escapepod.org/people/trae-hawkins/">Trae Hawkins</a></li>
		<li> <span class="role_label">Narrator</span> : <a href="https://escapepod.org/people/pippa-alice-stephens/">Pippa Alice Stephens</a></li>
		<li> <span class="role_label">Host</span> : <a href="https://escapepod.org/people/mur-lafferty/">Mur Lafferty</a></li>
		</ul>`;
		expect(parseCredits(html)).toEqual([
			{ role: "Author", name: "Trae Hawkins" },
			{ role: "Narrator", name: "Pippa Alice Stephens" },
			{ role: "Host", name: "Mur Lafferty" },
		]);
		expect(parseCredits("<p>no credits</p>")).toEqual([]);
	});

	it("should extract the MP3 enclosure from an episode page", () => {
		const mp3 =
			"https://dts.podtrac.com/redirect.mp3/traffic.libsyn.com/escapepod/Escape_Pod_1061-PigeonsandRobotsandPensive_Worlds.mp3";
		const shortcode = `<audio class="wp-audio-shortcode" controls="controls"><source type="audio/mpeg" src="${mp3}?_=2" /><a href="${mp3}">link</a></audio>`;
		expect(extractMp3(shortcode)).toBe(mp3);
		// src attribute before type attribute, and plain links as fallback.
		expect(extractMp3(`<source src="${mp3}?_=1" type="audio/mpeg">`)).toBe(mp3);
		expect(extractMp3(`<a href="${mp3}" download>Download</a>`)).toBe(mp3);
		expect(extractMp3("<p>no audio</p>")).toBeUndefined();
	});

	it("should extract og:image artwork", () => {
		const url =
			"https://escapepod.org/wp-content/uploads/2021/01/EscapePod_banner_1280.jpg";
		expect(
			extractOgImage(`<meta property="og:image" content="${url}" />`),
		).toBe(url);
		expect(
			extractOgImage(`<meta content="${url}" property="og:image" />`),
		).toBe(url);
		expect(extractOgImage('<meta property="og:title">')).toBeUndefined();
	});

	it("should cap descriptions and prepend horror content warnings", () => {
		expect(clampText("short", 100)).toBe("short");
		const long = clampText("a. ".repeat(4000), 500);
		expect(long.length).toBeLessThan(600);
		expect(long).toEndWith("[show notes truncated]");

		const notes = buildDescription(
			getShow("pseudopod"),
			"<p>Once upon a time.</p>",
		);
		expect(notes).toStartWith("Content warning:");
		const warned = buildDescription(
			getShow("pseudopod"),
			"<p>Content warning: body horror. Once upon a time.</p>",
		);
		expect(warned).toStartWith("Content warning: body horror");
		expect(buildDescription(getShow("escapepod"), "<p>Fine story.</p>")).toBe(
			"Fine story.",
		);
	});

	it("should read pagination headers case-insensitively", () => {
		expect(headerValue({ "X-WP-TotalPages": "313" }, "x-wp-totalpages")).toBe(
			"313",
		);
		expect(headerValue({}, "x-wp-totalpages")).toBeUndefined();
		expect(computeHasNext("313", 1, 20, 20)).toBe(true);
		expect(computeHasNext("313", 313, 20, 20)).toBe(false);
		// Header missing: full page implies more.
		expect(computeHasNext(undefined, 5, 20, 20)).toBe(true);
		expect(computeHasNext(undefined, 5, 3, 20)).toBe(false);
	});

	it("should strip show prefixes from episode titles", () => {
		expect(stripShowPrefix("Escape Pod 1061: Pigeons and Robots")).toBe(
			"Pigeons and Robots",
		);
		expect(stripShowPrefix("PodCastle 960: Kwong's Bath")).toBe("Kwong's Bath");
		expect(stripShowPrefix("PseudoPod 1046: Annie's Heart")).toBe(
			"Annie's Heart",
		);
		expect(stripShowPrefix("Just a story")).toBe("Just a story");
	});
});

// ---------------------------------------------------------------------------
// Live flow: browse -> search -> detail -> source against escapepod.org
// ---------------------------------------------------------------------------

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension!.enabled).toBe(true);
		expect(data.media_type).toContain("Audio");
	});
	it("should declare its network permissions", async () => {
		const data = await extension!.getData();
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(
				expect.arrayContaining([
					"escapepod.org",
					"podcastle.org",
					"pseudopod.org",
					"dts.podtrac.com",
					"traffic.libsyn.com",
				]),
			);
		}
	});
	it("should be able to browse", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			expect(entry.id.uid).toMatch(/^(escapepod|podcastle|pseudopod):\d+$/);
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 60_000);
	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "time");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		await assertValidEntries(result.content);
	}, 60_000);
	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	});
	it("should be able to detail", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult === undefined || (browseResult?.length ?? 0) <= 0)
			throw new Error("No browse result");
		const result = await extension!.detail(browseResult[0]!.id, {});
		expect(result).toBeDefined();
		expect(result.entry.id.uid).toBe(browseResult[0]!.id.uid);
		expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
		expect(result.entry.episodes.length).toBe(1);
		expect(result.entry.description.length).toBeGreaterThan(0);
		expect(result.entry.author?.[0]?.length).toBeGreaterThan(0);
		expect(result.entry.genres).toContain("Science Fiction");
		expect(result.entry.meta?.Narrator?.length).toBeGreaterThan(0);
		expect(result.settings).toEqual({});
		detailResult = result;
		await assertValidEntry(result.entry);
	}, 120_000);
	it("should be able to source", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (detailResult === undefined || detailResult?.entry.episodes.length <= 0)
			throw new Error("No detail result");
		const result = await extension!.source(
			detailResult!.entry.episodes[0]!.id,
			(detailResult?.settings ?? {}) as { [key: string]: Setting },
		);
		await assertValidSource(result.source);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBe(1);
			expect(result.source.sources[0]!.lang).toBe("en");
			expect(result.source.sources[0]!.url.url).toMatch(/\.mp3$/);
		}
		expect(result.settings).toEqual(detailResult.settings);
	}, 60_000);
	it("should reject malformed entry and episode ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "garbage" }, {})).rejects.toThrow();
		await expect(extension!.source({ uid: "garbage" }, {})).rejects.toThrow();
	}, 30_000);
});
