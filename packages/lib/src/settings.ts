/// <reference types="dion-runtime-types" />
import { getSetting, registerSetting } from "setting";
import { assertDefined } from "./asserts.js";
import { logerr } from "./util.js";

type ExcludeLiteral<T> = T extends string
	? string
	: T extends number
		? number
		: T extends boolean
			? boolean
			: T;

function toSettingValue(val: Settingvalues): Settingvalue {
	if (typeof val === "string") {
		return {
			type: "String",
			val: val,
			default_val: val,
		};
	}
	if (typeof val === "number") {
		return {
			type: "Number",
			val: val,
			default_val: val,
		};
	}
	if (typeof val === "boolean") {
		return {
			type: "Boolean",
			val: val,
			default_val: val,
		};
	}
	throw new Error("Invalid setting type");
}

export class SettingStore {
	settings: Record<string, Setting>;
	touched: string[]; //Check if settings is touched to prevent zombie settings
	constructor(settings: Record<string, Setting>) {
		this.settings = settings;
		this.touched = [];
	}
	getOrDefine<T extends Settingvalues>(
		id: string,
		defaultval: T,
		ui?: UI<ExcludeLiteral<T>>,
	): ExcludeLiteral<T> {
		if (!this.touched.includes(id)) {
			this.touched.push(id);
		}
		const settingval = this.settings[id]?.val;
		const val = settingval?.val;
		if (val === undefined) {
			console.log("Setting not found, creating");
			this.settings[id] = {
				val: toSettingValue(defaultval),
				ui: ui?.getDefinition() ?? null,
			};
			return defaultval as ExcludeLiteral<T>;
		}
		if (typeof val !== typeof defaultval) {
			console.log("Setting type changed, overwriting");
			console.log(`${typeof val} !== ${typeof defaultval}`);
			this.settings[id] = {
				val: toSettingValue(defaultval),
				ui: ui?.getDefinition() ?? null,
			};
			return defaultval as ExcludeLiteral<T>;
		}
		if (
			JSON.stringify(this.settings[id]?.ui) !==
				JSON.stringify(ui?.getDefinition()) &&
			!(
				(this.settings[id]?.ui === null ||
					this.settings[id]?.ui === undefined) &&
				(ui === null || ui === undefined)
			)
		) {
			console.log("Setting UI changed, overwriting");
			console.log(JSON.stringify(this.settings[id]?.ui));
			console.log(JSON.stringify(ui?.getDefinition()));
			assertDefined(
				settingval,
				`[SettingStore.getOrDefine] Invalid State settingval`,
			);
			this.settings[id] = {
				val: settingval,
				ui: ui?.getDefinition() ?? null,
			};
			return val as ExcludeLiteral<T>;
		}
		return val as ExcludeLiteral<T>;
	}

	get<T extends Settingvalues>(id: string): ExcludeLiteral<T> {
		assertDefined(
			this.settings[id],
			`[SettingStore.get] Setting not found: ${id}`,
		);
		return this.settings[id].val.val as ExcludeLiteral<T>;
	}

	tryGet<T extends Settingvalues>(id: string): ExcludeLiteral<T> | undefined {
		return this.settings[id]?.val.val as ExcludeLiteral<T>;
	}

	toMap(): Record<string, Setting> {
		const map: Record<string, Setting> = {};
		for (const key of this.touched) {
			assertDefined(
				this.settings[key],
				`[SettingStore.toMap] Setting not found: ${key}`,
			);
			map[key] = this.settings[key];
		}
		return this.settings;
	}
}

export class ExtensionSetting<T extends Settingvalues> {
	id: string;
	type: Settingtype;
	defaultvalue: ExcludeLiteral<T>;
	ui?: UI<ExcludeLiteral<T>>;

	constructor(id: string, defaultvalue: ExcludeLiteral<T>, type: Settingtype) {
		this.id = id;
		this.defaultvalue = defaultvalue;
		this.type = type;
	}

	setUI(ui: UI<ExcludeLiteral<T>>) {
		this.ui = ui;
		return this;
	}

	async register() {
		await registerSetting(this.id, {
			setting: {
				val: toSettingValue(this.defaultvalue),
				ui: this.ui?.getDefinition() ?? null,
			},
			settingtype: this.type,
		});
	}

	async get(): Promise<ExcludeLiteral<T>> {
		try {
			const setting = await getSetting(this.id);
			return setting.setting.val.val as ExcludeLiteral<T>;
		} catch (e) {
			logerr(`Error: Failed to get setting: ${this.id} - ${e}`);
			return this.defaultvalue;
		}
	}
}

export abstract class UI<T extends Settingvalues> {
	abstract getDefinition(): SettingUI;
	__(t: T) {
		//Type hack needed so TS keeps T
		return t;
	}
}

export class PathSelection extends UI<string> {
	picktype: "folder" | "file";
	label: string;
	constructor(label: string, picktype: "folder" | "file" = "folder") {
		super();
		this.label = label;
		this.picktype = picktype;
	}
	getDefinition(): SettingUI {
		return {
			label: this.label,
			type: "PathSelection",
			pickfolder: this.picktype === "folder",
		};
	}
}

export class Slider extends UI<number> {
	min: number;
	max: number;
	step: number;
	label: string;

	constructor(min: number, max: number, step: number, label: string) {
		super();
		this.min = min;
		this.max = max;
		this.step = step;
		this.label = label;
	}
	getDefinition(): SettingUI {
		return {
			type: "Slider",
			min: this.min,
			max: this.max,
			step: this.step,
			label: this.label,
		};
	}
}
export class Checkbox extends UI<boolean> {
	label: string;
	constructor(label: string) {
		super();
		this.label = label;
	}
	getDefinition(): SettingUI {
		return {
			type: "Checkbox",
			label: this.label,
		};
	}
}
export class Textbox extends UI<string> {
	label: string;
	constructor(label: string) {
		super();
		this.label = label;
	}
	getDefinition(): SettingUI {
		return {
			type: "Textbox",
			label: this.label,
		};
	}
}
export class Dropdown extends UI<string> {
	options: { value: string; label: string }[];
	label: string;
	constructor(options: { value: string; label: string }[], label: string) {
		super();
		this.label = label;
		this.options = options;
	}
	getDefinition(): SettingUI {
		return {
			type: "Dropdown",
			options: this.options,
			label: this.label,
		};
	}
}
