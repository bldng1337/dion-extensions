// Pure config and parsing helpers for the Escape Artists extension.
// Kept free of runtime-module imports ("network", "parse", ...) so tests can
// exercise them directly against inline fixtures.

// ---------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------

export interface ShowConfig {
	key: string;
	label: string;
	base: string;
	genre: string;
	icon: string;
}

export const SHOWS: Record<string, ShowConfig> = {
	escapepod: {
		key: "escapepod",
		label: "Escape Pod",
		base: "https://escapepod.org",
		genre: "Science Fiction",
		icon: "https://escapepod.org/wp-content/uploads/2018/03/cropped-Escape-Pod-chip-2-192x192.png",
	},
	podcastle: {
		key: "podcastle",
		label: "PodCastle",
		base: "https://podcastle.org",
		genre: "Fantasy",
		icon: "https://podcastle.org/wp-content/uploads/2017/10/cropped-PC-Chip2-192x192.png",
	},
	pseudopod: {
		key: "pseudopod",
		label: "PseudoPod",
		base: "https://pseudopod.org",
		genre: "Horror",
		icon: "https://pseudopod.org/wp-content/uploads/2018/04/cropped-PseudoPod-chip-192x192.png",
	},
};

export const DEFAULT_SHOW = "escapepod";

export const SHOW_DROPDOWN: { value: string; label: string }[] = Object.values(
	SHOWS,
).map((show) => ({ value: show.key, label: `${show.label} (${show.genre})` }));

export function getShow(key: string | undefined | null): ShowConfig {
	return SHOWS[key ?? ""] ?? SHOWS[DEFAULT_SHOW]!;
}

// Entry/episode ids are "<show key>:<WordPress post id>".
export function makeUid(showKey: string, postId: number): string {
	return `${showKey}:${postId}`;
}

export function parseUid(
	uid: string,
): { show: ShowConfig; postId: number } | undefined {
	const separator = uid.indexOf(":");
	if (separator <= 0) {
		return undefined;
	}
	const show = SHOWS[uid.slice(0, separator)];
	const postId = Number(uid.slice(separator + 1));
	if (!show || !Number.isInteger(postId) || postId <= 0) {
		return undefined;
	}
	return { show, postId };
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	copy: "©",
};

/** Decode named, decimal, and hex HTML entities in a single pass. */
export function decodeEntities(text: string): string {
	return text.replace(
		/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
		(match: string, body: string): string => {
			let code: number;
			if (body.startsWith("#x") || body.startsWith("#X")) {
				code = Number.parseInt(body.slice(2), 16);
			} else if (body.startsWith("#")) {
				code = Number.parseInt(body.slice(1), 10);
			} else {
				const named = NAMED_ENTITIES[body.toLowerCase()];
				return named ?? match;
			}
			return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		},
	);
}

function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, " ");
}

/** Strip tags/scripts/comments and decode entities into readable text. */
export function stripHtml(html: string): string {
	const text = html
		.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n\n")
		.replace(/<[^>]+>/g, " ");
	return decodeEntities(text)
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/ {2,}/g, " ")
		.replace(/\n {0,}/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Cap long show notes at a readable length, breaking at a boundary. */
export function clampText(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	const cut = text.slice(0, max);
	const boundary = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". "));
	const trimmed = (
		boundary > max * 0.5 ? cut.slice(0, boundary) : cut
	).trimEnd();
	return `${trimmed}… [show notes truncated]`;
}

const DESCRIPTION_LIMIT = 4000;

/**
 * Show notes for the detail view. PseudoPod stories carry a blanket mature
 * content notice in addition to whatever the site's own warnings say.
 */
export function buildDescription(
	show: ShowConfig,
	contentHtml: string,
): string {
	const notes = clampText(stripHtml(contentHtml), DESCRIPTION_LIMIT);
	if (
		show.key === "pseudopod" &&
		!/content warning|note: contains|mature/i.test(notes.slice(0, 800))
	) {
		return `Content warning: PseudoPod publishes mature horror fiction.\n\n${notes}`;
	}
	return notes;
}

// ---------------------------------------------------------------------------
// Episode page parsing
// ---------------------------------------------------------------------------

export interface Credit {
	role: string;
	name: string;
}

const ROLE_MARKER = /<span class="role_label">\s*([^<]+?)\s*<\/span>/gi;

/**
 * Episode pages render the credits as
 * `<li> <span class="role_label">Narrator</span> : <a href="...">Name</a></li>`.
 * Walk marker to marker so roles with nested markup still resolve.
 */
export function parseCredits(html: string): Credit[] {
	const credits: Credit[] = [];
	const markers = [...html.matchAll(ROLE_MARKER)];
	for (const [index, marker] of markers.entries()) {
		const role = decodeEntities(marker[1] ?? "").trim();
		const start = (marker.index ?? 0) + marker[0].length;
		const next = markers[index + 1];
		const end = next?.index ?? Math.min(html.length, start + 400);
		const segment = html.slice(start, end);
		const itemEnd = segment.search(/<\/li>/i);
		const chunk = itemEnd >= 0 ? segment.slice(0, itemEnd) : segment;
		const name = stripTags(chunk)
			.replace(/[\s:]+/, "")
			.replace(/\s+/g, " ")
			.trim();
		if (role.length > 0 && name.length > 0) {
			credits.push({ role, name });
		}
	}
	return credits;
}

function stripUrlQuery(url: string): string {
	const cut = url.search(/[?#]/);
	return cut >= 0 ? url.slice(0, cut) : url;
}

/**
 * The episode MP3 sits in a WordPress audio shortcode
 * (`<source type="audio/mpeg" src="...">`) plus PowerPress download links.
 */
export function extractMp3(html: string): string | undefined {
	for (const source of html.matchAll(/<source\b[^>]*>/gi)) {
		const tag = source[0] ?? "";
		const type = /type\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
		const src = /src\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
		if (!src) {
			continue;
		}
		if (/audio\/mpeg/i.test(type) || /\.mp3(\?|#|$)/i.test(src)) {
			return stripUrlQuery(src);
		}
	}
	const link = /<a[^>]+href\s*=\s*["']([^"']+\.mp3)(?:\?[^"']*)?["']/i.exec(
		html,
	)?.[1];
	if (link) {
		return link;
	}
	const bare = /(https?:\/\/[^\s"'<>]+?\.mp3)/i.exec(html)?.[1];
	return bare === undefined ? undefined : stripUrlQuery(bare);
}

/** Episode/show artwork from the SEO meta tags. */
export function extractOgImage(html: string): string | undefined {
	const patterns = [
		/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
		/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
	];
	for (const pattern of patterns) {
		const url = pattern.exec(html)?.[1];
		if (url) {
			return decodeEntities(url);
		}
	}
	return undefined;
}

/**
 * Story content opens with `<h3>Story Title</h3>` followed by the author in
 * an `<h4>`, sometimes wrapped in extra tags: `<h4>By <span>C. W. Maurer</span></h4>`.
 */
export function parseStoryAuthor(contentHtml: string): string | undefined {
	const h4 = /<h4\b[^>]*>([\s\S]*?)<\/h4>/i.exec(contentHtml)?.[1];
	if (!h4) {
		return undefined;
	}
	const name = stripTags(h4)
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^by\s*:?\s*/i, "")
		.trim();
	return name.length > 0 ? name : undefined;
}

// ---------------------------------------------------------------------------
// WordPress REST helpers
// ---------------------------------------------------------------------------

/** Case-insensitive header lookup (runtime header casing is unspecified). */
export function headerValue(
	headers: Record<string, string> | undefined,
	name: string,
): string | undefined {
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === name.toLowerCase()) {
			return value;
		}
	}
	return undefined;
}

/**
 * `hasnext` from the X-WP-TotalPages header; when the runtime cannot see
 * headers, fall back to "a full page probably has a successor".
 */
export function computeHasNext(
	totalPages: string | undefined,
	requestPage: number,
	count: number,
	pageSize: number,
): boolean {
	const parsed =
		totalPages === undefined ? Number.NaN : Number.parseInt(totalPages, 10);
	if (Number.isInteger(parsed) && parsed > 0) {
		return requestPage < parsed;
	}
	return count >= pageSize;
}

/** Strip the show prefix ("Escape Pod 1061: ", "Pseudopod 1046: ", ...). */
export function stripShowPrefix(title: string): string {
	return title
		.replace(/^(escape pod|podcastle|pseudopod)\s*#?\d+\s*:\s*/i, "")
		.trim();
}
