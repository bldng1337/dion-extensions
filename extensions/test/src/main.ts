/// <reference types="dion-runtime-types" />

import { Extension } from "dion-runtime-lib";
import { assert } from "dion-runtime-lib/asserts.js";
import {
	Dropdown,
	ExtensionSetting,
	SettingStore,
	Slider,
} from "dion-runtime-lib/settings.js";
import { fetch } from "network";
import { parse_html } from "parse";

export default class extends Extension {
	settings = {
		setting: new ExtensionSetting("test", "test", "Extension"),
		other: new ExtensionSetting("other", "test", "Search"),
		throwbrowse: new ExtensionSetting("throwbrowse", 0.0, "Extension").setUI(
			new Slider(0, 100, 1, "Throw when browsing"),
		),
		throwsearch: new ExtensionSetting("throwsearch", 0.0, "Extension").setUI(
			new Slider(0, 100, 1, "Throw when searching"),
		),
		throwdetail: new ExtensionSetting("throwdetail", 0.0, "Extension").setUI(
			new Slider(0, 100, 1, "Throw when detail page"),
		),
		throwsource: new ExtensionSetting("throwsource", 0.0, "Extension").setUI(
			new Slider(0, 100, 1, "Throw when source page"),
		),
		throwload: new ExtensionSetting("throwload", 0.0, "Extension").setUI(
			new Slider(0, 100, 1, "Throw when loading"),
		),
	};

	maybeThrow(double: number) {
		assert(Math.random() >= double, "Test throw");
	}

	async onload(): Promise<void> {
		this.maybeThrow(await this.settings.throwload.get());
	}

	async browse(_page: number, _sortt: Sort): Promise<Entry[]> {
		this.maybeThrow(await this.settings.throwbrowse.get());
		return [
			{
				id: "sometest",
				url: "www.example.com",
				title: `Example Title ${await this.settings.setting.get()}`,
				media_type: "Unknown",
			},
			{
				id: "othertest",
				url: "www.example.com",
				title: `Example Title ${await this.settings.other.get()}`,
				media_type: "Unknown",
			},
		];
	}

	async search(_page: number, _filterr: string): Promise<Entry[]> {
		this.maybeThrow(await this.settings.throwsearch.get());
		return [];
	}

	async detail(
		entryid: string,
		settings: { [key: string]: Setting },
	): Promise<EntryDetailed> {
		this.maybeThrow(await this.settings.throwdetail.get());
		const sstore = new SettingStore(settings);

		const testsetting = sstore.getOrDefine("test", "test");
		sstore.getOrDefine(
			"media",
			"par",
			new Dropdown(
				[
					{ value: "par", label: "Paragraphlist" },
					{ value: "img", label: "Imagelist" },
					{ value: "pdf", label: "PDF" },
					{ value: "epub", label: "Epub" },
					{ value: "m3u8", label: "M3U8" },
					{ value: "mp3", label: "MP3" },
				],
				"Source Type",
			),
		);
		return {
			id: entryid,
			url: "www.example.com",
			title: "Example",
			media_type: "Unknown",
			description: `Current value for the test setting is ${testsetting}`,
			status: "Complete",
			language: "en",
			settings: sstore.toMap(),
			episodes: [
				{
					name: "Example",
					id: "testid1",
					url: "www.example.com",
				},
				{
					name: "Example",
					id: "testid2",
					url: "www.example.com",
				},
				{
					name: "Example",
					id: "testid3",
					url: "www.example.com",
				},
				{
					name: "Example",
					id: "testid4",
					url: "www.example.com",
				},
				{
					name: "Example",
					id: "testid5",
					url: "www.example.com",
				},
			],
		};
	}

	async source(
		epid: string,
		settings: { [key: string]: Setting },
	): Promise<Source> {
		const sstore = new SettingStore(settings);
		this.maybeThrow(await this.settings.throwsource.get());
		//https://epubtest.org/test-books
		switch (sstore.tryGet("media")) {
			case "par": {
				const res = await fetch("https://www.example.com/");
				assert(res.ok, "Failed to fetch");
				const text = await res.body;
				const doc = parse_html(text);
				return {
					sourcetype: "Data",
					sourcedata: {
						type: "Paragraphlist",
						paragraphs: [
							doc.select(new CSSSelector("h1")).text,
							"This is a test",
							`setting: ${await this.settings.setting.get()}`,
							`other: ${await this.settings.other.get()}`,
							"\n\n",
							`Settings: ${JSON.stringify(settings, null, 2)}`,
							"",
							...doc.paragraphs,
						],
					},
				};
			}
			case "img":
				return {
					sourcetype: "Directlink",
					sourcedata: {
						type: "Imagelist",
						links: [
							`https://placehold.co/600x300/EEE/31343C.png?text=${epid}`,
							"https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
							"https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
							"https://placehold.co/600x4000/EEE/31343C.png?text=SomeArtwork",
						],
					},
				};
			case "pdf":
				return {
					sourcetype: "Directlink",
					sourcedata: {
						type: "Pdf",
						link: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
					},
				};
			case "epub":
				return {
					sourcetype: "Directlink",
					sourcedata: {
						type: "Epub",
						link: "https://github.com/daisy/epub-accessibility-tests/releases/download/fundamental-2.0/Fundamental-Accessibility-Tests-Basic-Functionality-v2.0.0.epub",
					},
				};
			case "m3u8":
				return {
					sourcetype: "Directlink",
					sourcedata: {
						type: "M3u8",
						link: "https://assets.afcdn.com/video49/20210722/v_645516.m3u8",
						headers: {},
						sub: [],
					},
				};
			case "mp3":
				return {
					sourcetype: "Directlink",
					sourcedata: {
						type: "Mp3",
						chapters: [
							{
								title: "Chapter 1",
								url: "https://www.learningcontainer.com/wp-content/uploads/2020/02/Kalimba.mp3",
							},
						],
					},
				};
		}
		return {
			sourcetype: "Data",
			sourcedata: {
				type: "Paragraphlist",
				paragraphs: [
					"This is a test",
					`setting: ${await this.settings.setting.get()}`,
					`other: ${await this.settings.other.get()}`,
					"\n\n",
					`Settings: ${JSON.stringify(settings, null, 2)}`,
				],
			},
		};
	}
}
