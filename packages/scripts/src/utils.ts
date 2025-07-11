/// <reference types="dion-runtime-types" />
/// <reference types="bun" />
import { file } from "bun";
import type { MediaType } from "dion-runtime-types/src/generated/RuntimeTypes.js";
import type { BaseIssue, BaseSchema, InferOutput } from "valibot";
import * as v from "valibot";

export async function parseFile<
	const TSchema extends
		| BaseSchema<unknown, unknown, BaseIssue<unknown>>
		| undefined,
>(
	filename: string,
	schema?: TSchema,
): Promise<
	TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>
		? InferOutput<TSchema>
		: unknown
> {
	const text = await file(filename).text();
	if (schema === undefined) return JSON.parse(text);
	// biome-ignore lint/suspicious/noExplicitAny: Its safe but i dont want to do typescript hoop jumping to get around this
	return v.parse(schema, JSON.parse(text)) as any;
}

export const repoSchema = v.object({
	name: v.string(),
	repository: v.optional(
		v.object({
			url: v.optional(v.string()),
		}),
	),
});
export type ExtensionRepo = InferOutput<typeof repoSchema>;

export const mediatypes: MediaType[] = [
	"Video",
	"Comic",
	"Audio",
	"Book",
	"Unknown",
] as const;

export const extensionsSchema = v.object({
	name: v.string(),
	id: v.string(),
	version: v.string(),
	description: v.string(),
	icon: v.string(),
	keywords: v.array(v.string()),
	min_api_version: v.string(),
	lang: v.array(v.string()),
	nsfw: v.boolean(),
	url: v.string(),
	media_type: v.array(v.picklist(mediatypes)),
	author: v.string(),
	license: v.string(),
});
