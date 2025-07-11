/// <reference types="node" />
/// <reference types="dion-runtime-types" />
import type { CustomUI } from "dion-runtime-types/src/generated/RuntimeTypes.js";
import { Parser } from "m3u8-parser";
import fetch from "node-fetch";

export async function wait(ms: number): Promise<void> {
	return new Promise((resolve, _reject) => {
		setTimeout(resolve, ms);
	});
}

var lock: Promise<void> | undefined;
export async function ratelimit(ms: number) {
	if (lock !== undefined) await lock;
	lock = wait(ms);
}

const time = 50;

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export async function assertValidM3U8(
	url: string,
	options?: {
		assertmsg?: string;
		headers?: Record<string, string>;
	},
) {
	if (!url.startsWith("http") || !url.startsWith("https")) {
		url = `https://${url}`;
	}
	await ratelimit(time);
	const response = await fetch(url, { headers: options?.headers });
	assert(
		response.ok,
		`${options?.assertmsg} ${url} is not a valid url or not reachable`,
	);
	const parser = new Parser({
		uri: url,
	});
	parser.push(await response.text());
	parser.end();
	assert(
		parser.manifest.segments.length > 0,
		`${options} ${url} is not a valid m3u8 url`,
	);
}

export async function assertValidImageURL(
	url: string,
	options?: {
		headers?: Record<string, string>;
		assertmsg?: string;
	},
) {
	if (!url.startsWith("http") || !url.startsWith("https")) {
		url = `https://${url}`;
	}
	await ratelimit(time);
	const response = await fetch(url, { headers: options?.headers });
	assert(
		response.ok,
		`${options?.assertmsg} ${url} is not a valid url or not reachable`,
	);
	assert(
		response.headers
			.get("content-type")
			?.toLocaleLowerCase()
			.includes("image") ?? false,
		`${options?.assertmsg}  ${url} is not an image url`,
	);
}

export async function assertValidURL(
	url: string,
	options?: {
		headers?: Record<string, string>;
		assertmsg?: string;
	},
) {
	if (!url.startsWith("http") || !url.startsWith("https")) {
		url = `https://${url}`;
	}
	await ratelimit(time);
	const response = await fetch(url, { headers: options?.headers });
	assert(
		response.ok,
		`${options?.assertmsg} ${url} is not a valid url or not reachable`,
	);
}

function sample<T>(arr: T[] | undefined | null, n: number): T[] {
	if (arr === undefined || arr === null) return [];
	if (arr.length <= n) return arr;
	const result = new Array(n);
	for (let i = 0; i < n; i++) {
		result[i] = arr[Math.floor(Math.random() * arr.length)];
	}
	return result;
}

export async function assertValidEntry(entry: Entry | EntryDetailed) {
	await assertValidURL(entry.url, {
		assertmsg: `Entry ${entry.title} (${entry.id}) has no valid entry.url`,
	});
	await assertValidURL(entry.url, {
		assertmsg: `Entry ${entry.title} (${entry.id}) has no valid entry.url`,
	});
	if (entry.cover !== undefined && entry.cover !== null) {
		await assertValidImageURL(entry.cover, {
			assertmsg: `Entry ${entry.title} (${entry.id}) has no valid entry.cover`,
			headers: filterMap(
				entry.cover_header ?? {},
				(v) => v !== undefined,
			) as Record<string, string>,
		});
	}
	if ("episodes" in entry) {
		for (const episode of sample(entry.episodes, 5)) {
			await assertValidURL(episode.url, {
				assertmsg: `Entry ${entry.title} (${entry.id}) has an invalid episode url ${episode.url} for episode ${episode.name}`,
			});
		}
	}
	if ("ui" in entry && entry.ui !== undefined && entry.ui !== null) {
		assertValidUI(entry.ui);
	}
}

function assertValidUI(ui: CustomUI) {
	if ("children" in ui && ui.children !== undefined && ui.children !== null) {
		for (const child of ui.children) {
			assertValidUI(child);
		}
	}
	switch (ui.type) {
		case "EntryCard":
			assertValidEntry(ui.entry);
			break;
		case "Image":
			assertValidImageURL(ui.image, {
				headers: filterMap(ui.header ?? {}, (v) => v !== undefined) as Record<
					string,
					string
				>,
				assertmsg: `CustomUI has an invalid image url ${ui.image}`,
			});
			break;
		case "Link":
			assertValidURL(ui.link, {
				assertmsg: `CustomUI has an invalid link ${ui.link}`,
			});
			break; //TODO Assert Timestamps
	}
}

export async function assertValidEntries(entries: (Entry | EntryDetailed)[]) {
	for (const entry of sample(entries, 5)) {
		await assertValidEntry(entry);
	}
}

export async function assertValidSource(source: Source) {
	switch (source.sourcetype) {
		case "Data":
			break;
		case "Directlink": {
			const data = source.sourcedata;
			switch (data.type) {
				case "Epub":
				case "Pdf":
					await assertValidURL(data.link, {
						assertmsg: `Source ${source.sourcetype} has no valid link`,
					});
					break;
				case "Mp3":
					for (const chapter of sample(data.chapters, 5)) {
						await assertValidURL(chapter.url, {
							assertmsg: `Source ${source.sourcetype} has an invalid chapter url ${chapter.url}`,
						});
					}
					break;
				case "Imagelist":
					for (const image of sample(data.links, 5)) {
						await assertValidImageURL(image, {
							headers: filterMap(
								data.header ?? {},
								(v) => v !== undefined,
							) as Record<string, string>,
							assertmsg: `Source ${source.sourcetype} has an invalid image url ${image}`,
						});
					}
					for (const audio of sample(data.audio, 5)) {
						await assertValidURL(audio.link, {
							headers: filterMap(
								data.header ?? {},
								(v) => v !== undefined,
							) as Record<string, string>,
							assertmsg: `Source ${source.sourcetype} has an invalid url ${audio.link}`,
						});
					}
					break;
				case "M3u8":
					await assertValidM3U8(data.link, {
						assertmsg: `Source ${source.sourcetype} has no valid link`,
						headers:
							data.headers !== null && data.headers !== undefined
								? (Object.fromEntries(
										// biome-ignore lint/style/noNonNullAssertion: It is checked above
										Object.entries(data.headers!).filter(
											([_, v]) => v !== undefined,
										),
									) as Record<string, string>)
								: undefined,
					});
					for (const subtitle of sample(data.sub, 5)) {
						await assertValidURL(subtitle.url, {
							assertmsg: `Source ${source.sourcetype} has an invalid ${subtitle.title} subtitle link ${subtitle.url}`,
						});
					}
					break;
			}
			break;
		}
	}
}

export async function isValidEntry(entry: Entry | EntryDetailed) {
	try {
		await assertValidEntry(entry);
		return true;
	} catch (e) {
		if (e instanceof Error) {
			console.error(e.message);
		} else {
			console.error(e);
		}
		return false;
	}
}

export async function isValidEntries(entries: (Entry | EntryDetailed)[]) {
	try {
		await assertValidEntries(entries);
		return true;
	} catch (e) {
		if (e instanceof Error) {
			console.error(e.message);
		} else {
			console.error(e);
		}
		return false;
	}
}

export async function isValidSource(source: Source) {
	try {
		await assertValidSource(source);
		return true;
	} catch (e) {
		if (e instanceof Error) {
			console.error(e.message);
		} else {
			console.error(e);
		}
		return false;
	}
}

function filterMap<T>(map: Record<string, T>, filter: (value: T) => boolean) {
	return Object.fromEntries(
		Object.entries(map).filter(([_, value]) => filter(value)),
	);
}
