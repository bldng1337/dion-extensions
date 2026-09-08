#!/usr/bin/env bun
/**
 * Convert a browser cookie export of the novellist.co session into a .env
 * file for local dev/testing, so the base64 session never has to be copied
 * or typed by hand.
 *
 * Novellist stores its Supabase session in chunked cookies ("novellist.0",
 * "novellist.1", ...) whose values concatenate (after the "base64-" prefix on
 * chunk 0) to the base64 payload of the session JSON. This script joins and
 * decodes them, verifies the session against the Novellist API (refreshing it
 * through Supabase when expired), and writes .env next to the extension.
 *
 * Usage:
 *   bun run sync-cookies                       # reads <repo>/cookies
 *   bun scripts/sync-cookies.ts my-export.json # explicit cookie export path
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = "https://yionrsulvvpfmzmbmami.supabase.co";
const SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlpb25yc3VsdnZwZm16bWJtYW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk5ODg0MTMsImV4cCI6MjAzNTU2NDQxM30.EW3C9NhuFu6TvZuYJ8B29HqeW35hH3BujR0sGRa9Ej0";
const API_BASE = "https://novellist-be-960019704910.asia-east1.run.app/api";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cookieFile =
	process.argv[2] ?? join(scriptDir, "..", "..", "..", "cookies");
const envFile = join(scriptDir, "..", ".env");

interface CookieExport {
	name: string;
	value: string;
}

interface Session {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	user?: { id?: string; email?: string };
}

function fail(message: string): never {
	console.error(`sync-cookies: ${message}`);
	process.exit(1);
}

function decodeSession(raw: unknown): Session {
	if (!Array.isArray(raw)) {
		fail(`${cookieFile} is not a JSON array cookie export`);
	}
	const chunks = (raw as CookieExport[])
		.filter((c) => /^novellist\.\d+$/.test(c.name))
		.sort((a, b) => {
			const na = Number(a.name.split(".")[1]);
			const nb = Number(b.name.split(".")[1]);
			return na - nb;
		})
		.map((c) => c.value);
	if (chunks.length === 0) {
		fail(
			`no novellist.* cookies found in ${cookieFile}. Log in at www.novellist.co and export the cookies again.`,
		);
	}
	const joined = chunks.join("").replace(/^base64-/, "");
	let session: Session;
	try {
		session = JSON.parse(Buffer.from(joined, "base64").toString("utf8"));
	} catch (e) {
		fail(`cookie payload is not valid base64 JSON: ${e}`);
	}
	if (!session.access_token) {
		fail("decoded session has no access_token");
	}
	return session;
}

async function verify(token: string): Promise<Response> {
	return fetch(`${API_BASE}/users/current`, {
		headers: { Authorization: `Bearer ${token}` },
	});
}

async function refresh(refreshToken: string): Promise<Session | null> {
	const res = await fetch(
		`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				apikey: SUPABASE_ANON_KEY,
			},
			body: JSON.stringify({ refresh_token: refreshToken }),
		},
	);
	if (!res.ok) {
		return null;
	}
	return res.json();
}

const file = Bun.file(cookieFile);
if (!(await file.exists())) {
	fail(`${cookieFile} does not exist`);
}
let session = decodeSession(await file.json());

const res = await verify(session.access_token);
if (res.ok) {
	console.log("access token is valid");
} else if (session.refresh_token) {
	console.warn(
		`access token rejected (${res.status}), refreshing via Supabase...\n` +
			"note: refresh tokens rotate, so the browser session may be logged out",
	);
	const refreshed = await refresh(session.refresh_token);
	if (!refreshed?.access_token) {
		fail("refresh failed, cookies are too old - log in again and re-export");
	}
	session = refreshed;
	if (!(await verify(session.access_token)).ok) {
		fail("refreshed token still rejected, log in again and re-export");
	}
} else {
	fail(`access token rejected (${res.status}) and no refresh token available`);
}

const profile = (await (await verify(session.access_token)).json()) as {
	username?: string;
};
const expiry = session.expires_at
	? new Date(session.expires_at * 1000).toISOString()
	: "unknown";

const lines = [
	`NOVELLIST_ACCESS_TOKEN=${session.access_token}`,
	`NOVELLIST_REFRESH_TOKEN=${session.refresh_token}`,
	`NOVELLIST_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}`,
	`NOVELLIST_USER_ID=${session.user?.id ?? ""}`,
	`NOVELLIST_EMAIL=${session.user?.email ?? ""}`,
	"",
];
await Bun.write(envFile, lines.join("\n"));

console.log(`logged in as: ${profile.username ?? session.user?.email ?? "?"}`);
console.log(`access token expires: ${expiry}`);
console.log(`wrote ${envFile}`);
