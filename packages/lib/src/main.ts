/// <reference types="dion-runtime-types" />
import type { ExtensionSetting } from "./settings.js";

export abstract class Extension {
	abstract settings: { [key: string]: ExtensionSetting<Settingvalues> };

	async load() {
		for (const setting of Object.values(this.settings)) {
			await setting.register();
		}
		this.browse = this.browse.bind(this);
		this.search = this.search.bind(this);
		this.detail = this.detail.bind(this);
		this.source = this.source.bind(this);
		this.fromurl = this.fromurl.bind(this);
		this.onload = this.onload.bind(this);
		await this.onload();
	}

	abstract browse(page: number, sort: Sort): Promise<Entry[]>;

	abstract search(page: number, filter: string): Promise<Entry[]>;

	abstract detail(
		Entryid: string,
		settings: { [key: string]: Setting },
	): Promise<EntryDetailed>;

	abstract source(
		epid: string,
		settings: { [key: string]: Setting },
	): Promise<Source>;

	async fromurl(_url: string): Promise<EntryDetailed | undefined> {
		return undefined;
	}

	async onload() {}
}
