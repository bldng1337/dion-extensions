import type { AuthCreds } from "@dion-js/runtime-types/runtime";

// Novellist stores its Supabase session in chunked cookies ("novellist.0",
// "novellist.1", ...) because the value exceeds the browser per-cookie size
// limit. Chunk 0 carries a "base64-" prefix; the chunks concatenated in order
// form the base64 payload of the session JSON.

export interface SupabaseSession {
	access_token: string;
	refresh_token: string;
	/** Unix seconds; 0 when unknown (treated as expired). */
	expires_at: number;
}

export interface CookiePair {
	name: string;
	value: string;
}

export type ReadingListStatus =
	| "COMPLETED"
	| "DROPPED"
	| "IN_PROGRESS"
	| "PLANNED"
	| "UNKNOWN";

const CHUNK_RE = /^novellist\.(\d+)$/;

/**
 * Flatten the host's Cookies cred map into name/value pairs. The map may key
 * by cookie name (values stored raw) or by domain (values stored as
 * "name=value"), so accept both. Only the novellist.* session chunks matter;
 * their values are base64 that may itself contain "=" padding, so only strip
 * an explicit "novellist.<n>=" prefix.
 */
export function cookiesFromCreds(creds: AuthCreds): CookiePair[] {
	if (creds.type !== "Cookies") {
		return [];
	}
	const out: CookiePair[] = [];
	for (const [key, values] of Object.entries(creds.cookies)) {
		for (const value of values) {
			const name = /^novellist\.\d+=/.exec(value)?.index;
			if (name === 0) {
				const eq = value.indexOf("=");
				out.push({ name: value.slice(0, eq), value: value.slice(eq + 1) });
			} else {
				out.push({ name: key, value });
			}
		}
	}
	return out;
}

/** Collect the novellist.* cookie chunks and decode the session from them. */
export function sessionFromCookies(
	cookies: CookiePair[],
	decodeBase64: (input: string) => string,
): SupabaseSession | null {
	const chunks = cookies
		.flatMap((c) => {
			const m = CHUNK_RE.exec(c.name);
			return m ? [{ index: Number(m[1]), value: c.value }] : [];
		})
		.sort((a, b) => a.index - b.index)
		.map((c) => c.value);
	return decodeSessionFromChunks(chunks, decodeBase64);
}

export function decodeSessionFromChunks(
	chunks: string[],
	decodeBase64: (input: string) => string,
): SupabaseSession | null {
	const joined = chunks
		.filter((c) => c.length > 0)
		.join("")
		.replace(/^base64-/, "");
	if (joined.length === 0) {
		return null;
	}
	let data: unknown;
	try {
		data = JSON.parse(decodeBase64(joined));
	} catch {
		return null;
	}
	if (data === null || typeof data !== "object") {
		return null;
	}
	const s = data as Record<string, unknown>;
	if (typeof s.access_token !== "string" || s.access_token.length === 0) {
		return null;
	}
	return {
		access_token: s.access_token,
		refresh_token: typeof s.refresh_token === "string" ? s.refresh_token : "",
		expires_at: typeof s.expires_at === "number" ? s.expires_at : 0,
	};
}

export function isExpired(
	session: SupabaseSession,
	nowSeconds: number,
): boolean {
	return session.expires_at - nowSeconds < 60;
}

export function prettyReadingStatus(s: ReadingListStatus): string {
	const map: Record<ReadingListStatus, string> = {
		COMPLETED: "Completed",
		DROPPED: "Dropped",
		IN_PROGRESS: "Reading",
		PLANNED: "Planned",
		UNKNOWN: "Unknown",
	};
	return map[s] ?? s;
}
