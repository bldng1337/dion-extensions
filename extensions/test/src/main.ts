import { DionExtension } from "@dion-js/runtime-lib";
import { assert } from "@dion-js/runtime-lib/asserts.js";
import { AuthAccount } from "@dion-js/runtime-lib/auth.js";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
	Slider,
} from "@dion-js/runtime-lib/settings.js";
import { toStatus } from "@dion-js/runtime-lib/util.js";
import type { SourceProvider } from "@dion-js/runtime-types/extension";
import type {
	EntryDetailedResult,
	EntryId,
	EntryList,
	EpisodeId,
	EventData,
	EventResult,
	MediaType,
	Setting,
	SourceResult,
} from "@dion-js/runtime-types/runtime";
import { fetch } from "network";
import { parseHtml } from "parse";

export default class extends DionExtension implements SourceProvider {
	settings = {
		setting: new ExtensionSetting("test", "test", "Extension"),
		other: new ExtensionSetting("other", "test", "Search"),
		throwbrowse: new ExtensionSetting("throwbrowse", 0.0, "Extension")
			.setUI(new Slider(0, 100, 1))
			.setLabel("Throw when browsing"),
		throwsearch: new ExtensionSetting("throwsearch", 0.0, "Extension")
			.setUI(new Slider(0, 100, 1))
			.setLabel("Throw when searching"),
		throwdetail: new ExtensionSetting("throwdetail", 0.0, "Extension")
			.setUI(new Slider(0, 100, 1))
			.setLabel("Throw when detail page"),
		throwsource: new ExtensionSetting("throwsource", 0.0, "Extension")
			.setUI(new Slider(0, 100, 1))
			.setLabel("Throw when source page"),
		throwload: new ExtensionSetting("throwload", 0.0, "Extension")
			.setUI(new Slider(0, 100, 1))
			.setLabel("Throw when loading"),
	};
	accounts = {};

	maybeThrow(double: number) {
		assert(Math.random() >= double, "Test throw!");
	}

	async onEvent(_data: EventData): Promise<EventResult | undefined> {
		console.log("asd");
		return undefined; //TODO: Maybe we could make that nicer
	}

	async onload(): Promise<void> {
		this.maybeThrow(await this.settings.throwload.get());
	}

	async browse(_page: number): Promise<EntryList> {
		this.maybeThrow(await this.settings.throwbrowse.get());
		//
		return {
			content: [
				{
					id: {
						uid: `sometest${Math.random()}`,
						iddata: JSON.stringify({ test: "test" }),
					},
					url: "www.example.com",
					title: `Example Title ${await this.settings.setting.get()}`,
					media_type: "Unknown",
				},
				{
					id: {
						uid: `sometest${Math.random()}`,
						iddata: JSON.stringify({ test: "test" }),
					},
					url: "www.example.com",
					title: `Example Title ${await this.settings.other.get()}`,
					media_type: "Unknown",
				},
			],
			hasnext: false,
		};
	}

	async search(_page: number, _filterr: string): Promise<EntryList> {
		this.maybeThrow(await this.settings.throwsearch.get());

		return {
			content: [],
			hasnext: false,
		};
	}

	async detail(
		entryid: EntryId,
		settings: { [key: string]: Setting },
	): Promise<EntryDetailedResult> {
		this.maybeThrow(await this.settings.throwdetail.get());
		const sstore = new SettingStore(settings);

		const testsetting = sstore.getOrDefine({
			id: "test",
			defaultval: "test",
		});
		sstore.getOrDefine({
			id: "media",
			defaultval: "par",
			label: "Source Type",
			ui: new Dropdown([
				{ value: "par", label: "Paragraphlist" },
				{ value: "img", label: "Imagelist" },
				{ value: "pdf", label: "PDF" },
				{ value: "epub", label: "Epub" },
				{ value: "m3u8", label: "M3U8" },
				{ value: "mp3", label: "MP3" },
			]),
		});
		const description = sstore.getOrDefine({
			id: "description",
			defaultval: "",
		});
		const episodes = [];
		for (let i = 0; i < 3000; i++) {
			episodes.push({
				name: `Episode ${i}`,
				id: { uid: `testid${i}` },
				url: `https://www.example.com`,
			});
		}
		return {
			entry: {
				id: entryid,
				url: sstore.getOrDefine({
					id: "url",
					defaultval: "www.example.com",
				}),
				titles: sstore
					.getOrDefine({
						id: "title",
						defaultval: "Example",
					})
					.split(",")
					.map((t) => t.trim()),
				cover: {
					url: sstore.getOrDefine({
						id: "cover",
						defaultval:
							"https://placehold.co/300x600/EEE/31343C.png?text=SomeArtwork",
					}),
				},
				genres: sstore
					.getOrDefine({
						id: "genres",
						defaultval: "Example",
					})
					.split(",")
					.map((g) => g.trim()),
				media_type: sstore.getOrDefine({
					id: "media_type",
					defaultval: "Unknown",
					ui: new Dropdown([
						{ value: "Video", label: "Video" },
						{ value: "Comic", label: "Comic" },
						{ value: "Audio", label: "Audio" },
						{ value: "Book", label: "Book" },
						{ value: "Unknown", label: "Unknown" },
					]),
				}) as MediaType,
				description:
					description === ""
						? `Current value for the test setting is ${testsetting}`
						: description,
				status: toStatus(
					sstore.getOrDefine({
						id: "status",
						defaultval: "Complete",
						ui: new Dropdown([
							{ value: "Complete", label: "Complete" },
							{ value: "Releasing", label: "Releasing" },
							{ value: "Unknown", label: "Unknown" },
						]),
					}),
				),
				language: sstore.getOrDefine({
					id: "lang",
					defaultval: "en",
					ui: new Dropdown([
						{ value: "en", label: "English" },
						{ value: "de", label: "German" },
						{ value: "fr", label: "French" },
						{ value: "it", label: "Italian" },
						{ value: "es", label: "Spanish" },
						{ value: "pt", label: "Portuguese" },
						{ value: "ru", label: "Russian" },
						{ value: "ja", label: "Japanese" },
						{ value: "zh", label: "Chinese" },
						{ value: "ko", label: "Korean" },
					]),
				}),
				author: sstore
					.getOrDefine({ id: "author", defaultval: "Example" })
					.split(",")
					.map((a) => a.trim()),
				rating:
					sstore.getOrDefine({
						id: "rating",
						defaultval: 0,
						ui: new Slider(0, 10, 1),
					}) / 10.0,
				views: sstore.getOrDefine({
					id: "views",
					defaultval: 0,
				}),
				episodes: episodes,
			},
			settings: sstore.toMap(),
		};
	}

	async source(
		epid: EpisodeId,
		settings: { [key: string]: Setting },
	): Promise<SourceResult> {
		const sstore = new SettingStore(settings);
		this.maybeThrow(await this.settings.throwsource.get());
		//https://epubtest.org/test-books
		switch (sstore.tryGet("media")) {
			case "par": {
				const res = await fetch("https://www.example.com/");
				assert(res.ok, "Failed to fetch");
				const doc = parseHtml(res.body);
				return {
					source: {
						type: "Paragraphlist",
						paragraphs: [
							{
								type: "Text",
								content: doc.select(new CSSSelector("h1")).text,
								style: null,
							},
							{ type: "Text", content: epid.uid, style: null },
							{ type: "Text", content: "This is a test", style: null },
							{
								type: "Text",
								content: `setting: ${await this.settings.setting.get()}`,
								style: null,
							},
							{
								type: "Text",
								content: `other: ${await this.settings.other.get()}`,
								style: null,
							},
							{ type: "Text", content: "\n\n", style: null },
							{
								type: "Text",
								content: `Settings: ${JSON.stringify(settings, null, 2)}`,
								style: null,
							},
							{ type: "Text", content: "", style: null },
							// ...doc.paragraphs,//TODO: This is not working
						],
					},
					settings: sstore.toMap(),
				};
			}
			case "img":
				return {
					settings: sstore.toMap(),
					source: {
						type: "Imagelist",
						audio: null, //TODO: Make it undefined||null
						links: [
							{
								url: `https://placehold.co/600x300/EEE/31343C.png?text=${epid}`,
							},
							{
								url: "https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
							},
							{
								url: "https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
							},
							{
								url: "https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
							},
						],
					},
				};
			case "pdf":
				return {
					settings: sstore.toMap(),
					source: {
						type: "Pdf",
						link: {
							url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
						},
					},
				};
			case "epub":
				return {
					settings: sstore.toMap(),
					source: {
						type: "Epub",
						link: {
							url: "https://github.com/daisy/epub-accessibility-tests/releases/download/fundamental-2.0/Fundamental-Accessibility-Tests-Basic-Functionality-v2.0.0.epub",
						},
					},
				};
			case "m3u8":
				return {
					settings: sstore.toMap(),
					source: {
						type: "Video",
						sources: [
							{
								name: "Server 1",
								lang: "en",
								url: {
									url: "https://assets.afcdn.com/video49/20210722/v_645516.m3u8",
								},
							},
						],
						sub: [],
					},
				};
			case "mp3":
				return {
					settings: sstore.toMap(),
					source: {
						type: "Audio",
						sources: [
							{
								name: "Server 1",
								lang: "en",
								url: {
									url: "https://www.learningcontainer.com/wp-content/uploads/2020/02/Kalimba.mp3",
								},
							},
						],
					},
				};
		}
		return {
			settings: sstore.toMap(),
			source: {
				type: "Paragraphlist",
				paragraphs: [
					`This is a test ${epid.uid}`,
					`setting: ${await this.settings.setting.get()}`,
					`other: ${await this.settings.other.get()}`,
					"\n\n",
					`Settings: ${JSON.stringify(settings, null, 2)}`,
				].map((p) => ({ type: "Text", content: p, style: null })),
			},
		};
	}
}
