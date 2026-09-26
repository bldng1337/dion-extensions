// Builders for the small but genuinely valid containers the e2e test writes
// into its temp library. Test-only: nothing in `main.ts` imports this.

/** A real 1x1 PNG, used as the embedded cover of the fixture containers. */
export const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
	0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
	0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
	0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
	0x60, 0x82,
]);

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of data) {
		c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with every entry stored uncompressed. */
export function makeZip(
	entries: { name: string; data: Uint8Array }[],
): Uint8Array {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + name.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, size, true);
		localView.setUint32(22, size, true);
		localView.setUint16(26, name.length, true);
		local.set(name, 30);
		locals.push(local, entry.data);

		const central = new Uint8Array(46 + name.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, size, true);
		centralView.setUint32(24, size, true);
		centralView.setUint16(28, name.length, true);
		centralView.setUint32(42, offset, true);
		central.set(name, 46);
		centrals.push(central);

		offset += local.length + size;
	}

	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);

	const parts = [...locals, ...centrals, end];
	const archive = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let at = 0;
	for (const part of parts) {
		archive.set(part, at);
		at += part.length;
	}
	return archive;
}

export type EpubFixture = {
	title: string;
	authors: string[];
	publisher?: string;
	language?: string;
	subjects?: string[];
	description?: string;
	/** Table-of-contents entries, one chapter file each. */
	chapters?: string[];
	cover?: Uint8Array;
};

/** A minimal but valid EPUB 2 container with an OPF manifest. */
export function makeEpub(fixture: EpubFixture): Uint8Array {
	const chapters = fixture.chapters ?? [];
	const files: { name: string; data: Uint8Array }[] = [
		{ name: "mimetype", data: encoder.encode("application/epub+zip") },
		{
			name: "META-INF/container.xml",
			data: encoder.encode(
				'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
			),
		},
	];
	const spine: string[] = [];
	const manifest: string[] = [];
	if (fixture.cover !== undefined) {
		manifest.push(
			'<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>',
		);
		files.push({ name: "OEBPS/images/cover.png", data: fixture.cover });
	}
	chapters.forEach((title, index) => {
		const id = `chapter-${index + 1}`;
		manifest.push(
			`<item id="${id}" href="text/${id}.xhtml" media-type="application/xhtml+xml"/>`,
		);
		spine.push(`<itemref idref="${id}"/>`);
		files.push({
			name: `OEBPS/text/${id}.xhtml`,
			data: encoder.encode(
				`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
			),
		});
	});

	const creators = fixture.authors
		.map(
			(author) =>
				`<dc:creator opf:role="aut" opf:file-as="${author}">${author}</dc:creator>`,
		)
		.join("");
	const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" version="2.0" unique-identifier="book-id">
<metadata xmlns:opf="http://www.idpf.org/2007/opf/">
<dc:identifier id="book-id">urn:uuid:local-sources-fixture</dc:identifier>
<dc:title>${fixture.title}</dc:title>
${creators}${fixture.language === undefined ? "" : `<dc:language>${fixture.language}</dc:language>`}
${fixture.publisher === undefined ? "" : `<dc:publisher>${fixture.publisher}</dc:publisher>`}
${(fixture.subjects ?? []).map((subject) => `<dc:subject>${subject}</dc:subject>`).join("")}
${fixture.description === undefined ? "" : `<dc:description>${fixture.description}</dc:description>`}
<dc:date>2021-04-05</dc:date>
${fixture.cover === undefined ? "" : '<meta name="cover" content="cover-image"/>'}
</metadata>
<manifest>${manifest.join("")}</manifest>
<spine>${spine.join("")}</spine>
</package>`;
	files.push({ name: "OEBPS/content.opf", data: encoder.encode(opf) });

	// EPUB 2 navigation: an NCX with one navPoint per chapter.
	const navPoints = chapters
		.map(
			(title, index) =>
				`<navPoint id="nav-${index + 1}" playOrder="${index + 1}"><navLabel><text>${title}</text></navLabel><content src="text/chapter-${index + 1}.xhtml"/></navPoint>`,
		)
		.join("");
	files.push({
		name: "OEBPS/toc.ncx",
		data: encoder.encode(
			`<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:local-sources-fixture"/></head><docTitle><text>${fixture.title}</text></docTitle><navMap>${navPoints}</navMap></ncx>`,
		),
	});

	return makeZip(files);
}

export type Mp3Fixture = {
	title: string;
	artist: string;
	album?: string;
	track?: number;
	genre?: string;
	year?: string;
	cover?: Uint8Array;
};

/** ID3 sizes are syncsafe integers: seven bits per byte, high bit always 0. */
function syncsafe(size: number): number {
	return (
		(((size >> 21) & 0x7f) << 24) |
		(((size >> 14) & 0x7f) << 16) |
		(((size >> 7) & 0x7f) << 8) |
		(size & 0x7f)
	);
}

/** A 44 byte MPEG-1 layer III frame: 128 kbps, 44.1 kHz, no padding. */
function audioFrame(): Uint8Array {
	const frame = new Uint8Array(417);
	frame[0] = 0xff;
	frame[1] = 0xfb;
	frame[2] = 0x90;
	frame[3] = 0x00;
	return frame;
}

function textFrame(id: string, value: string): Uint8Array {
	const body = new Uint8Array(1 + value.length);
	body[0] = 0x03; // UTF-8
	body.set(encoder.encode(value), 1);
	const frame = new Uint8Array(10 + body.length);
	frame.set(encoder.encode(id), 0);
	new DataView(frame.buffer).setUint32(4, body.length, false);
	frame.set(body, 10);
	return frame;
}

function pictureFrame(picture: Uint8Array): Uint8Array {
	const mime = encoder.encode("image/png");
	const description = new Uint8Array([0x00]);
	// encoding, mime, terminator, picture type, description, terminator, image
	const body = new Uint8Array(
		4 + mime.length + description.length + picture.length,
	);
	body[0] = 0x03;
	body.set(mime, 1);
	body[1 + mime.length] = 0x00;
	body[2 + mime.length] = 0x03;
	body.set(description, 3 + mime.length);
	body.set(picture, 4 + mime.length + description.length);
	const frame = new Uint8Array(10 + body.length);
	frame.set(encoder.encode("APIC"), 0);
	new DataView(frame.buffer).setUint32(4, body.length, false);
	frame.set(body, 10);
	return frame;
}

/** An ID3v2.3 tagged MP3: enough silent frames for a duration to be derived. */
export function makeMp3(fixture: Mp3Fixture, frames = 40): Uint8Array {
	const tags: Uint8Array[] = [
		textFrame("TIT2", fixture.title),
		textFrame("TPE1", fixture.artist),
	];
	if (fixture.album !== undefined) tags.push(textFrame("TALB", fixture.album));
	if (fixture.track !== undefined)
		tags.push(textFrame("TRCK", `${fixture.track}/12`));
	if (fixture.genre !== undefined) tags.push(textFrame("TCON", fixture.genre));
	if (fixture.year !== undefined) tags.push(textFrame("TYER", fixture.year));
	if (fixture.cover !== undefined) tags.push(pictureFrame(fixture.cover));

	const body = tags.reduce((sum, tag) => sum + tag.length, 0);
	const tag = new Uint8Array(10 + body);
	tag.set(encoder.encode("ID3"), 0);
	tag[3] = 3; // version 2.3
	tag[4] = 0;
	new DataView(tag.buffer).setUint32(6, syncsafe(body), false);
	let at = 10;
	for (const part of tags) {
		tag.set(part, at);
		at += part.length;
	}

	const audio = new Uint8Array(frames * 417);
	for (let i = 0; i < frames; i++) {
		audio.set(audioFrame(), i * 417);
	}
	const file = new Uint8Array(tag.length + audio.length);
	file.set(tag, 0);
	file.set(audio, tag.length);
	return file;
}
