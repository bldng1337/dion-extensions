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
	absolute,
	bookUrl,
	curatedUrl,
	decodeEntities,
	downloadUrl,
	durationToSeconds,
	humanRuntime,
	isValidSlug,
	listingUrl,
	normalizeDuration,
	parseBookPage,
	parseListing,
	parseResultCount,
	parseTotalPages,
	searchUrl,
	slugToTitle,
	stripHtml,
} from "./site.ts";

let extension: Extension;

let browseResult: Entry[];

beforeAll(async () => {
	const client = new MockManagerClient(join(import.meta.path, "../../.dist"));
	extension = await getTestExtension(client.client);
	browseResult = [];
});

// ---------------------------------------------------------------------------
// Unit tests for the site parsing helpers (fixtures from the real markup)
// ---------------------------------------------------------------------------

// Two cards as served by /hoerbuecher/l, /neue-hoerbuecher, /halloween and
// the /suche result page — including a raw-UTF8 title, an entity author and
// a "Detail:" title attribute with umlauts.
const LISTING_FIXTURE = `<html><body>
<div id="audiobooks-list-87">
<article class="audiobook" data-id="3" ><div class="audiobook-inner"><header class="audiobook__header"><div aria-level="3" class="title" role="heading"><a href="/hoerbuch/chanson-vom-grossen-publikum" target="_top" title="Detail: Chanson vom gro&szlig;en Publikum"><span>Chanson vom gro&szlig;en Publikum</span></a></div><p class="author"> Joachim Ringelnatz </p></header><div class="audiobook-cover"><img alt="Cover" class="" data-sizes="(max-width:786px) 100vw, 50vw" data-src="files/user/user_upload/451816.1409662156.jpg" data-srcset="files/user/user_upload/451816.1409662156.jpg 576w , files/user/user_upload/451816.1409662156.jpg 768w" height="1000" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" title="Das Dschungelbuch" width="1000" /></div><footer class="audiobook__footer"><span aria-label="Spieldauer"><span aria-hidden="true" class="icon fa-regular fa-hourglass " data-icon ></span> 01m</span></footer></div></article>
<article class="audiobook" data-id="719" ><div class="audiobook-inner"><header class="audiobook__header"><div aria-level="3" class="title" role="heading"><a href="/hoerbuch/angst" target="_top" title="Detail: Angst"><span>Angst</span></a></div><p class="author"><a data-trigger-modal-iframe="person-detail" aria-haspopup="true" title="Detail: Stefan Zweig" href="/autoren/detail/stefan-zweig/ab/angst">Stefan Zweig</a></p></header><div class="audiobook-cover"><img alt="" class="" data-sizes="(max-width:786px) 100vw, 50vw" data-src="/fileadmin/_processed_/files_user/5/0/csm_zweig_angst__Cover_1200__6dbb29d086.jpg" height="1200" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" title="" width="1200" /></div><footer class="audiobook__footer"><span aria-label="Spieldauer"><span aria-hidden="true" class="icon fa-regular fa-hourglass " data-icon ></span> 14m:44s</span></footer></div></article>
</div>
<a aria-label="gehe zu Seite 2" class="pagination-item" data-target="audiobooks-list-87" href="/hoerbuecher/l/2#audiobooks-list-87">2</a>
<a aria-label="gehe zu Seite 74" class="pagination-item" data-target="audiobooks-list-87" href="/hoerbuecher/l/74#audiobooks-list-87">74</a>
</body></html>`;

// Book detail page ("/hoerbuch/angst") with Sprecher, runtime, categories,
// description paragraphs, lazy cover and the download link.
const BOOK_PAGE_FIXTURE = `<html><head><title>Angst</title></head><body>
<article class="audiobook-detail" data-audiobook-detail="719" data-xhr-browse="/hoerbuch/pagination.json?pop=1&amp;uid=719&amp;cHash=x"><section class="section section-hero" id="section-hero"><div class="section-body"><div class="section-body__inner"><header class="audiobook-detail__header"><div class="audiobook-info"><h1 class="title"><span>Angst</span></h1><p class="author"><a data-trigger-modal-iframe="person-detail" aria-haspopup="true" title="Detail: Stefan Zweig" href="/autoren/detail/stefan-zweig/ab/angst">Stefan Zweig</a></p><dl class="data"><dt class="speaker"><span aria-hidden="true" class="icon fa-regular fa-user " data-icon ></span> Sprecher*innen</dt><dd class="speaker"><a data-trigger-modal-iframe="person-detail" title="Detail: Frederic B&ouml;hle" href="/sprecher/detail/frederic-boehle/ab/angst">Frederic B&ouml;hle</a></dd><dt><span aria-hidden="true" class="icon fa-regular fa-hourglass " data-icon ></span> Spieldauer</dt><dd>02h:42m</dd><dt><span aria-hidden="true" class="icon fa-regular fa-headphones " data-icon ></span> Format</dt><dd>mp3</dd><dt><span aria-hidden="true" class="icon fa-regular fa-tags " data-icon ></span> Kategorien</dt><dd> Romane &amp; Erz&auml;hlungen, Liebe &amp; Leidenschaft </dd></dl><div class="controls"><button aria-label="zum Bereich springen" class="button -default -outline" data-scroll-to data-target="#section-streaming" ><span class="button__label">Download/Stream</span></button></div></div><div class="audiobook-cover"><img alt="" class="" data-src="fileadmin/_processed_/files_user/5/0/csm_zweig_angst__Cover_1200__6dbb29d086.jpg" height="1200" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" title="" width="1200" /></div></header></div></div></section><section class="section"><div class="section-body"><div class="section-body__inner"><div class="audiobook-detail__container -description"><h2 class="title">Beschreibung</h2><p>Irene Wagner f&uuml;hrt ein beh&uuml;tetes Dasein. Aus der inneren Leere beginnt sie eine Aff&auml;re.</p><p>Fortan bestimmt die Furcht vor der Entdeckung ihren Alltag &mdash; bis sie die Kontrolle verliert.</p></div><div class="content-box audiobook-filters"><div class="content-box__text">Filter</div></div></div></div></section><section class="section section-streaming" id="section-streaming"><div class="audiobook-download"><p class="audiobook-download__info">Hörbuch kostenlos downloaden (verschiedene Optionen)</p><div class="modal-body audiobook-download-options"><div class="button-group" role="group"><a aria-label="Download ca. 149 MB" class="button -primary" href="/hoerbuch/download/angst"><span class="button__label">MP3</span></a></div></div></div></section></article>
</body></html>`;

// Stream-only stub ("/hoerbuch/der-prozess"): detail data but no download link.
const BOOK_PAGE_NO_DOWNLOAD_FIXTURE = `<html><body>
<article class="audiobook-detail" data-audiobook-detail="42"><section class="section section-hero" id="section-hero"><header class="audiobook-detail__header"><div class="audiobook-info"><h1 class="title"><span>Der Prozess</span></h1><p class="author"><a title="Detail: Franz Kafka" href="/autoren/detail/franz-kafka/ab/der-prozess">Franz Kafka</a></p><dl class="data"><dt><span aria-hidden="true" class="icon fa-regular fa-tags " data-icon ></span> Kategorien</dt><dd> Romane &amp; Erz&auml;hlungen </dd></dl></div><div class="audiobook-cover"><img alt="" data-src="files/user/audiobook/image/der-prozess.jpg" /></div></header></section><section class="section"><div class="audiobook-detail__container -description"><h2 class="title">Beschreibung</h2><p>Der Prozess ist ein Fragment von Franz Kafka.</p></div></section></article>
</body></html>`;

// Search results page ("/suche?tx_kesearch_pi1[sword]=grimm").
const SEARCH_FIXTURE = `<html><body>
<section class="section section-hero" id="section-hero"><h1 class="section-hero__title"><span>Hier sind deine Ergebnisse! </span></h1><p class="section-hero__subtitle">Wir haben <span class="text-color-secondary">53</span> Treffer f&uuml;r dich.</p></section>
<article class="audiobook" data-id="399" data-rendering="searched"><div class="audiobook-inner"><header class="audiobook__header"><div aria-level="3" class="title" role="heading"><a href="/hoerbuch/allerleirauh" target="_top" title="Detail: Allerleirauh"><span>Allerleirauh</span></a></div><p class="author"> Br&uuml;der Grimm </p></header><div class="audiobook-cover"><img alt="" data-src="files/user/audiobook/image/allerleirauh.jpg" /></div><footer class="audiobook__footer"><span aria-label="Spieldauer"><span aria-hidden="true" class="icon fa-regular fa-hourglass " data-icon ></span> 13m:45s</span></footer></div></article>
</body></html>`;

const SEARCH_EMPTY_FIXTURE = `<html><body>
<section class="section section-hero" id="section-hero"><h1 class="section-hero__title"><span>Das war leider nichts! </span></h1><p class="section-hero__subtitle">Eine Suche ohne Suchbegriff macht keinen Sinn</p></section>
</body></html>`;

describe("site helpers", () => {
	it("should decode html entities including german umlauts in one pass", () => {
		expect(
			decodeEntities("B&uuml;cher &amp; M&auml;rchen von Gro&szlig;vater"),
		).toBe("Bücher & Märchen von Großvater");
		expect(decodeEntities("B&#246;se &Uuml;berraschung &#x263A;")).toBe(
			"Böse Überraschung ☺",
		);
		expect(decodeEntities("plain & unknown &nbsp;text")).toBe(
			"plain & unknown  text",
		);
	});

	it("should strip html into readable text", () => {
		expect(stripHtml("<p>Erster Absatz.</p>\n  <p>Zweiter.</p><br>Ende")).toBe(
			"Erster Absatz.\n\nZweiter.\n\nEnde",
		);
		expect(stripHtml("A <i>italic</i> &amp; bold <b>word</b>")).toBe(
			"A italic & bold word",
		);
	});

	it("should build the verified urls", () => {
		expect(listingUrl(0)).toBe("https://www.vorleser.net/hoerbuecher/l");
		expect(listingUrl(1)).toBe("https://www.vorleser.net/hoerbuecher/l/2");
		expect(listingUrl(-3)).toBe("https://www.vorleser.net/hoerbuecher/l");
		expect(curatedUrl("neu")).toBe("https://www.vorleser.net/neue-hoerbuecher");
		expect(curatedUrl("halloween")).toBe("https://www.vorleser.net/halloween");
		expect(curatedUrl("weihnachten")).toBe(
			"https://www.vorleser.net/weihnachten",
		);
		expect(curatedUrl("nonsense")).toBeNull();
		expect(bookUrl("angst")).toBe("https://www.vorleser.net/hoerbuch/angst");
		expect(downloadUrl("angst")).toBe(
			"https://www.vorleser.net/hoerbuch/download/angst",
		);
		expect(searchUrl("grimm & söhne", 0)).toBe(
			"https://www.vorleser.net/suche?tx_kesearch_pi1%5Bsword%5D=grimm%20%26%20s%C3%B6hne&tx_kesearch_pi1%5Bpage%5D=1&tx_kesearch_pi1%5BresetFilters%5D=0",
		);
		expect(searchUrl("grimm", 2)).toContain("tx_kesearch_pi1%5Bpage%5D=3");
		expect(absolute("files/user/audiobook/image/angst.jpg")).toBe(
			"https://www.vorleser.net/files/user/audiobook/image/angst.jpg",
		);
		expect(absolute("/fileadmin/x.jpg")).toBe(
			"https://www.vorleser.net/fileadmin/x.jpg",
		);
		expect(absolute("https://cdn.example.com/x.jpg")).toBe(
			"https://cdn.example.com/x.jpg",
		);
	});

	it("should validate slugs and derive fallback titles", () => {
		expect(isValidSlug("chanson-vom-grossen-publikum")).toBe(true);
		expect(isValidSlug("angst")).toBe(true);
		expect(isValidSlug("")).toBe(false);
		expect(isValidSlug("../etc-passwd")).toBe(false);
		expect(isValidSlug("a b")).toBe(false);
		expect(isValidSlug("slug#0")).toBe(false);
		expect(slugToTitle("das-dschungelbuch")).toBe("Das Dschungelbuch");
	});

	it("should parse listing cards", () => {
		const entries = parseListing(LISTING_FIXTURE);
		expect(entries.length).toBe(2);
		expect(entries[0]!.slug).toBe("chanson-vom-grossen-publikum");
		expect(entries[0]!.title).toBe("Chanson vom großen Publikum");
		expect(entries[0]!.author).toBe("Joachim Ringelnatz");
		expect(entries[0]!.cover).toBe(
			"https://www.vorleser.net/files/user/user_upload/451816.1409662156.jpg",
		);
		expect(entries[0]!.duration).toBe("01m");
		expect(entries[1]!.slug).toBe("angst");
		expect(entries[1]!.author).toBe("Stefan Zweig");
		expect(entries[1]!.cover).toBe(
			"https://www.vorleser.net/fileadmin/_processed_/files_user/5/0/csm_zweig_angst__Cover_1200__6dbb29d086.jpg",
		);
		expect(entries[1]!.duration).toBe("14m:44s");
		expect(parseListing(SEARCH_EMPTY_FIXTURE).length).toBe(0);
	});

	it("should parse the a-z pager and the search hit count", () => {
		expect(parseTotalPages(LISTING_FIXTURE)).toBe(74);
		expect(parseTotalPages("<html>no pager</html>")).toBe(1);
		expect(parseResultCount(SEARCH_FIXTURE)).toBe(53);
		expect(parseResultCount(SEARCH_EMPTY_FIXTURE)).toBe(0);
	});

	it("should parse book pages with speaker, categories and download", () => {
		const book = parseBookPage(BOOK_PAGE_FIXTURE, "angst");
		expect(book.title).toBe("Angst");
		expect(book.authors).toEqual(["Stefan Zweig"]);
		expect(book.speakers).toEqual(["Frederic Böhle"]);
		expect(book.categories).toEqual([
			"Romane & Erzählungen",
			"Liebe & Leidenschaft",
		]);
		expect(book.duration).toBe("02h:42m");
		expect(book.cover).toBe(
			"https://www.vorleser.net/fileadmin/_processed_/files_user/5/0/csm_zweig_angst__Cover_1200__6dbb29d086.jpg",
		);
		expect(book.downloadHref).toBe("/hoerbuch/download/angst");
		expect(book.description).toContain(
			"Irene Wagner führt ein behütetes Dasein.",
		);
		expect(book.description).toContain("bis sie die Kontrolle verliert");
		expect(book.description).not.toContain("<p>");
	});

	it("should parse stream-only books without a download", () => {
		const book = parseBookPage(BOOK_PAGE_NO_DOWNLOAD_FIXTURE, "der-prozess");
		expect(book.title).toBe("Der Prozess");
		expect(book.authors).toEqual(["Franz Kafka"]);
		expect(book.speakers).toEqual([]);
		expect(book.downloadHref).toBe("");
		expect(book.description).toBe(
			"Der Prozess ist ein Fragment von Franz Kafka.",
		);
	});

	it("should parse site runtime labels", () => {
		expect(durationToSeconds("02h:42m")).toBe(9720);
		expect(durationToSeconds("14m:44s")).toBe(884);
		expect(durationToSeconds("01m")).toBe(60);
		expect(durationToSeconds("")).toBe(0);
		expect(normalizeDuration("02h:42m")).toBe("2:42:00");
		expect(normalizeDuration("14m:44s")).toBe("14:44");
		expect(normalizeDuration("keine angabe")).toBe("");
		expect(humanRuntime(durationToSeconds("10h:18m"))).toBe("10h 18m");
		expect(humanRuntime(884)).toBe("15m");
	});
});

// ---------------------------------------------------------------------------
// Live flow against the real site through the native runtime
// ---------------------------------------------------------------------------

describe("Extension", () => {
	it("should start", async () => {
		await extension!.setEnabled(true);
		const data = await extension!.getData();
		expect(data.compatible).toBe(true);
		expect(extension.enabled).toBe(true);
		expect(data.media_type).toContain("Audio");
	});

	it("should declare german and its network permission", async () => {
		const data = await extension!.getData();
		expect(data.lang).toContain("de");
		const network = data.permissions?.find((p) => p.type === "Network");
		expect(network).toBeDefined();
		if (network?.type === "Network") {
			expect(network.domains).toEqual(["www.vorleser.net"]);
		}
	});

	it("should be able to browse the a-z catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.browse(0);
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.hasnext).toBe(true);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
			expect(entry.url).toStartWith("https://www.vorleser.net/hoerbuch/");
		}
		await assertValidEntries(result.content);
		browseResult = result.content;
	}, 120_000);

	it("should paginate the a-z catalog", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const page1 = await extension!.browse(1);
		expect(page1.content.length).toBeGreaterThan(0);
		const ids0 = browseResult.map((entry) => entry.id.uid);
		const ids1 = page1.content.map((entry) => entry.id.uid);
		expect(ids1).not.toEqual(ids0);
	}, 120_000);

	it("should be able to search", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "grimm");
		expect(result).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		for (const entry of result.content) {
			expect(entry.media_type).toBe("Audio");
		}
		await assertValidEntries(result.content);
	}, 120_000);

	it("should paginate search results", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// "grimm" has more than one page of hits (53 at research time).
		const page1 = await extension!.search(1, "grimm");
		expect(page1.content.length).toBeGreaterThan(0);
	}, 120_000);

	it("should return no results for an empty filter", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		const result = await extension!.search(0, "   ");
		expect(result.content.length).toBe(0);
		expect(result.hasnext).toBe(false);
	}, 30_000);

	it("should be able to detail and source a playable book", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		if (browseResult.length <= 0) throw new Error("No browse result");
		// The A-Z list contains a few stream-only stubs; detail entries until a
		// playable one shows up (single page, so at most a dozen requests).
		let found: EntryDetailedResult | undefined;
		for (const entry of browseResult) {
			const result = await extension!.detail(entry.id, {});
			expect(result.entry.id.uid).toBe(entry.id.uid);
			expect(result.entry.titles[0]!.length).toBeGreaterThan(0);
			if (result.entry.episodes.length > 0) {
				found = result;
				break;
			}
		}
		if (found === undefined) throw new Error("No playable book on page 1");

		const detailed = found.entry;
		expect(detailed.media_type).toBe("Audio");
		expect(detailed.language).toBe("de");
		expect(detailed.description.length).toBeGreaterThan(0);
		// detail must echo the settings it received
		expect(found.settings).toEqual({});
		await assertValidEntry(detailed);

		const result = await extension!.source(
			detailed.episodes[0]!.id,
			(found.settings ?? {}) as { [key: string]: Setting },
		);
		expect(result.source.type).toBe("Audio");
		if (result.source.type === "Audio") {
			expect(result.source.sources.length).toBe(1);
			expect(result.source.sources[0]!.lang).toBe("de");
			expect(result.source.sources[0]!.url.url).toBe(
				`https://www.vorleser.net/hoerbuch/download/${detailed.id.uid}`,
			);
		}
		expect(result.settings).toEqual(found.settings);
		await assertValidSource(result.source);
	}, 180_000);

	it("should mark stream-only books with zero episodes", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		// "alice-im-wunderland" is a verified stream-only stub (full detail data,
		// but no /hoerbuch/download/ link).
		const result = await extension!.detail({ uid: "alice-im-wunderland" }, {});
		expect(result.entry.titles[0]).toBe("Alice im Wunderland");
		expect(result.entry.episodes.length).toBe(0);
	}, 60_000);

	it("should reject invalid entry ids", async () => {
		if (extension.enabled === false) throw new Error("Extension not enabled");
		await expect(extension!.detail({ uid: "no/slash" }, {})).rejects.toThrow();
		await expect(
			extension!.source({ uid: "not a slug" }, {}),
		).rejects.toThrow();
	}, 30_000);
});
