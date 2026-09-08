/// <reference types="@types/bun" />
import { describe, expect, it } from "bun:test";
import {
	cookiesFromCreds,
	decodeSessionFromChunks,
	isExpired,
	prettyReadingStatus,
	sessionFromCookies,
} from "./session.js";

// Bun-native base64 decoder standing in for the host's `convert` module.
const decodeBase64 = (input: string): string =>
	Buffer.from(input, "base64").toString("utf8");

function makeChunks(session: object, chunkCount = 2): string[] {
	const b64 = Buffer.from(JSON.stringify(session), "utf8").toString("base64");
	const size = Math.ceil(b64.length / chunkCount);
	const chunks: string[] = [];
	for (let i = 0; i < b64.length; i += size) {
		chunks.push(b64.slice(i, i + size));
	}
	// Chunk 0 carries the "base64-" prefix, like @supabase/ssr chunking.
	return [`base64-${chunks[0]}`, ...chunks.slice(1)];
}

const sampleSession = {
	access_token: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
	refresh_token: "djo4q6girrxk",
	expires_at: 1789447191,
	user: { id: "140d903e", email: "test@example.com" },
};

describe("decodeSessionFromChunks", () => {
	it("decodes chunked base64- prefixed session cookies", () => {
		const session = decodeSessionFromChunks(
			makeChunks(sampleSession),
			decodeBase64,
		);
		expect(session).not.toBeNull();
		expect(session?.access_token).toBe(sampleSession.access_token);
		expect(session?.refresh_token).toBe(sampleSession.refresh_token);
		expect(session?.expires_at).toBe(sampleSession.expires_at);
	});
	it("decodes a single unprefixed chunk", () => {
		const [chunk] = makeChunks(sampleSession, 1);
		const session = decodeSessionFromChunks(
			[chunk!.replace(/^base64-/, "")],
			decodeBase64,
		);
		expect(session?.access_token).toBe(sampleSession.access_token);
	});
	it("returns null for empty input", () => {
		expect(decodeSessionFromChunks([], decodeBase64)).toBeNull();
		expect(decodeSessionFromChunks([""], decodeBase64)).toBeNull();
	});
	it("returns null for undecodable payloads", () => {
		expect(
			decodeSessionFromChunks(["!!!not-base64!!!"], decodeBase64),
		).toBeNull();
		expect(decodeSessionFromChunks(["aGVsbG8="], decodeBase64)).toBeNull();
	});
	it("returns null when access_token is missing", () => {
		const { access_token: _drop, ...rest } = sampleSession;
		const session = decodeSessionFromChunks(makeChunks(rest), decodeBase64);
		expect(session).toBeNull();
	});
});

describe("cookiesFromCreds", () => {
	it("accepts name-keyed raw values", () => {
		const pairs = cookiesFromCreds({
			type: "Cookies",
			cookies: { "novellist.0": ["base64-abc"], "novellist.1": ["def="] },
		});
		expect(pairs).toEqual([
			{ name: "novellist.0", value: "base64-abc" },
			{ name: "novellist.1", value: "def=" },
		]);
	});
	it("accepts domain-keyed name=value entries", () => {
		const pairs = cookiesFromCreds({
			type: "Cookies",
			cookies: {
				"www.novellist.co": [
					"novellist.0=base64-abc",
					"novellist.1=def=",
					"other=x",
				],
			},
		});
		expect(pairs).toEqual([
			{ name: "novellist.0", value: "base64-abc" },
			{ name: "novellist.1", value: "def=" },
			// Only novellist.* values are unwrapped; unrelated cookies pass through.
			{ name: "www.novellist.co", value: "other=x" },
		]);
	});
	it("returns empty for non-cookie creds", () => {
		expect(cookiesFromCreds({ type: "ApiKey", key: "k" })).toEqual([]);
	});
});

describe("sessionFromCookies", () => {
	it("orders chunks by suffix index and ignores other cookies", () => {
		const [c0, c1] = makeChunks(sampleSession);
		const session = sessionFromCookies(
			[
				{ name: "novellist.1", value: c1! },
				{ name: "unrelated", value: "x" },
				{ name: "novellist.0", value: c0! },
			],
			decodeBase64,
		);
		expect(session?.access_token).toBe(sampleSession.access_token);
	});
	it("returns null when no novellist cookies exist", () => {
		expect(
			sessionFromCookies([{ name: "other", value: "x" }], decodeBase64),
		).toBeNull();
	});
});

describe("isExpired", () => {
	it("treats unknown expiry as expired", () => {
		expect(
			isExpired({ access_token: "a", refresh_token: "", expires_at: 0 }, 1000),
		).toBe(true);
	});
	it("treats far-future expiry as valid", () => {
		expect(
			isExpired(
				{ access_token: "a", refresh_token: "", expires_at: 2000 },
				1000,
			),
		).toBe(false);
	});
});

describe("prettyReadingStatus", () => {
	it("maps every status", () => {
		expect(prettyReadingStatus("IN_PROGRESS")).toBe("Reading");
		expect(prettyReadingStatus("PLANNED")).toBe("Planned");
		expect(prettyReadingStatus("COMPLETED")).toBe("Completed");
		expect(prettyReadingStatus("DROPPED")).toBe("Dropped");
		expect(prettyReadingStatus("UNKNOWN")).toBe("Unknown");
	});
});

// Optional live-API checks: populate .env via `bun run sync-cookies` first.
const token = process.env.NOVELLIST_ACCESS_TOKEN;
describe.skipIf(!token)("Novellist live API", () => {
	const headers = { Authorization: `Bearer ${token}` };
	const api = "https://novellist-be-960019704910.asia-east1.run.app/api";

	it("resolves the current user", async () => {
		const res = await fetch(`${api}/users/current`, { headers });
		expect(res.ok).toBe(true);
		const user = (await res.json()) as { username?: string };
		expect(user.username?.length ?? 0).toBeGreaterThan(0);
	});

	it("finds novels by title", async () => {
		const res = await fetch(`${api}/novels/filter`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				title_search_query: "shadow slave",
				page_number: 1,
				page_size: 5,
			}),
		});
		expect(res.ok).toBe(true);
		const novels = (await res.json()) as Array<{ slug?: string }>;
		expect(novels.some((n) => n.slug === "shadow-slave")).toBe(true);
	});
});
