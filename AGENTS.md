### What you build
- **Extension class**: Your `src/main.ts` exports a default class that extends `Extension` and implements the lifecycle methods the app calls.
- **Sandboxed code**: No Node.js or browser APIs. Use only the provided modules: `network`, `parse`, and `setting`, plus helpers from `dion-runtime-lib`.

```startLine:endLine:packages/lib/src/main.ts
4:19:packages/lib/src/main.ts
export abstract class Extension {
	abstract settings: { [key: string]: ExtensionSetting<Settingvalues> };
	// ...
	abstract browse(page: number, sort: Sort): Promise<Entry[]>;
	abstract search(page: number, filter: string): Promise<Entry[]>;
	abstract detail(Entryid: string, settings: { [key: string]: Setting }): Promise<EntryDetailed>;
	abstract source(epid: string, settings: { [key: string]: Setting }): Promise<Source>;
}
```

### Prerequisites
- Bun installed (used by package scripts) and TypeScript tooling
- Turbo installed for task orchestration (use `turbo run <task>`)
- Familiarity with TypeScript and async/await

### Project layout
- `package.json`: extension metadata and scripts
- `tsconfig.json`: extends Dion runtime TS config
- `biome.json`: formatting and linting rules
- `src/main.ts`: your extension implementation
- `.dist/`: build output produced by `turbo run build`

Minimal `package.json` (see `extensions/test/package.json` for a full example):
```json
{
  "name": "your-extension-name",
  "extensionid": "<uuid>",
  "version": "1.0.0",
  "description": "What this extension does",
  "id": "<uuid>",
  "icon": "https://.../icon.png",
  "keywords": ["keyword"],
  "min_api_version": "1.0.0",
  "lang": ["en"],
  "nsfw": false,
  "url": "https://example.com/",           
  "media_type": ["Book"],                   
  "author": "You",
  "license": "MIT",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bunx dion-bundle",
    "test": "bun test",
    "lint": "bunx biome check",
    "format": "bunx biome format --write",
    "check-types": "bunx tsc --noEmit",
    "pushdev": "bunx dion-push -d",
    "push": "bunx dion-push"
  },
  "dependencies": {
    "dion-runtime-lib": "catalog:"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "@biomejs/biome": "catalog:",
    "dion-node-runtime": "catalog:",
    "dion-repo-scripts": "catalog:",
    "dion-runtime-configs": "catalog:",
    "dion-runtime-types": "catalog:",
    "dion-test-asserts": "catalog:",
    "typescript": "catalog:"
  }
}
```
Note: Invoke these scripts via the repo's Turbo pipeline, for example `turbo run build`, `turbo run test`, `turbo run lint`, and `turbo run format`.

`tsconfig.json`:
```json
{ "extends": "dion-runtime-configs/typescript.json", "include": ["src/**/*"] }
```

`biome.json`:
```json
{ "$schema": "https://biomejs.dev/schemas/2.1.1/schema.json", "extends": ["dion-runtime-configs/biome.json"] }
```

### Implementing the extension
Add this reference at the top of `src/main.ts` to get ambient runtime types like `Entry`:
```ts
/// <reference types="dion-runtime-types" />
```

Skeleton:
```ts
import { Extension } from "dion-runtime-lib";
import { assert, assertDefined } from "dion-runtime-lib/asserts.js";
import { ExtensionSetting, SettingStore, Dropdown, Slider } from "dion-runtime-lib/settings.js";
import { fetch } from "network";
import { parse_html } from "parse";
import { makeurl, toStatus, log, logwarn, logerr } from "dion-runtime-lib/util.js";

export default class extends Extension {
  settings = {
    exampleString: new ExtensionSetting("exampleString", "default", "Extension"),
    sortOrder: new ExtensionSetting("sortOrder", "Popular", "Search").setUI(
      new Dropdown([
        { value: "Popular", label: "Popular" },
        { value: "Latest", label: "Latest" }
      ], "Sort")
    ),
    throttleMs: new ExtensionSetting("throttleMs", 0, "Extension").setUI(
      new Slider(0, 2000, 50, "Optional throttle in ms")
    )
  };

  async onload(): Promise<void> {
    // Optional startup work (e.g., warm caches)
  }

  async browse(page: number, sort: Sort): Promise<Entry[]> {
    const url = makeurl("https://example.com/list", { page, sort });
    const res = await fetch(url);
    assert(res.ok, "Browse failed");
    const root = parse_html(await res.body);
    const items = root.select(".card");
    return items.map((el) => ({
      id: el.attr("data-id"),
      url: el.select("a").first.attr("href"),
      title: el.select(".title").text,
      media_type: "Book",
      cover: el.select("img").first.attr("src")
    }));
  }

  async search(page: number, filter: string): Promise<Entry[]> {
    // Similar to browse, but with a query parameter
    return this.browse(page, "Popular");
  }

  async detail(entryId: string, settings: { [k: string]: Setting }): Promise<EntryDetailed> {
    const sstore = new SettingStore(settings);
    const quality = sstore.getOrDefine("quality", "1080p", new Dropdown([
      { value: "480p", label: "480p" },
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" }
    ], "Quality"));

    const res = await fetch(`https://example.com/item/${entryId}`);
    assert(res.ok, "Detail failed");
    const root = parse_html(await res.body);
    const titleEl = root.select("h1.title").first;
    assertDefined(titleEl, "Missing title");

    const episodes = root.select(".episode").map((ep) => ({
      id: ep.attr("data-id"),
      url: ep.select("a").first.attr("href"),
      name: ep.text
    }));

    return {
      id: entryId,
      url: `https://example.com/item/${entryId}`,
      title: titleEl.text,
      description: root.select(".description").text,
      status: toStatus(root.select(".status").text),
      language: "en",
      media_type: "Book",
      episodes,
      settings: sstore.toMap()
    };
  }

  async source(episodeId: string, settings: { [k: string]: Setting }): Promise<Source> {
    const sstore = new SettingStore(settings);
    const kind = sstore.getOrDefine("media", "m3u8", new Dropdown([
      { value: "m3u8", label: "M3U8" },
      { value: "img", label: "Imagelist" },
      { value: "pdf", label: "PDF" },
      { value: "epub", label: "Epub" },
      { value: "mp3", label: "MP3" }
    ], "Source Type"));

    if (kind === "img") {
      return { sourcetype: "Directlink", sourcedata: { type: "Imagelist", links: ["https://.../1.png"] } };
    }
    return { sourcetype: "Directlink", sourcedata: { type: "M3u8", link: "https://.../stream.m3u8", headers: {}, sub: [] } };
  }
}
```

### Working with settings
- **Global settings**: Define on the class via `ExtensionSetting`. They are registered automatically during `load()`.
- **Per-entry settings**: Use `SettingStore` inside `detail()`/`source()`.
  - `getOrDefine(id, default, ui?)` will create/update values and UI safely.
  - Always return the updated map via `sstore.toMap()` in `EntryDetailed.settings`.

```startLine:endLine:extensions/test/src/main.ts
71:99:extensions/test/src/main.ts
const sstore = new SettingStore(settings);
const testsetting = sstore.getOrDefine("test", "test");
return {
  // ...
  settings: sstore.toMap(),
  episodes: [ /* ... */ ]
};
```

Common UI controls from `dion-runtime-lib/settings.js`:
- `Slider(min, max, step, label)` for numbers
- `Checkbox(label)` for booleans
- `Textbox(label)` for strings
- `Dropdown(options, label)` for enums
- `PathSelection(label, picktype)` for filesystem-like inputs (exposed via runtime UI)

### Data fetching and parsing
- Use `fetch` from `network` (not Node fetch) and `parse_html`/`parse_html_fragment` from `parse`.
- Response fields:
  - `ok`: boolean
  - `json`: parsed JSON (if any)
  - `body`: raw text
- Always `assert(res.ok, "message")` before reading.

### Custom UI (optional)
Use `dion-runtime-lib/ui.js` helpers to enrich `EntryDetailed.ui`:
- `Column(...children)`, `Row(...children)`
- `Text(str)`, `Image(url, headers?)`, `Link(url, label?)`, `EntryCard(entry)`, `Timestamp(...)`, `If(condition, ui)`

### Error handling and robustness
- This is critical: throw on invalid states to keep the app stable.
- Use `assert(condition, message)` and `assertDefined(value, message)` from `dion-runtime-lib/asserts.js`.
- Validate DOM selections before accessing properties.
- Normalize and construct URLs safely (use `makeurl`, `encodeURL`).

### Utilities you can use
From `dion-runtime-lib/util.js`:
- `makeurl(base, query, sep?)`: build query strings
- `parseNumberwithSuffix("1.2k")`: parse human counts
- `toStatus(str)`: map status strings to `ReleaseStatus`
- `deduplicate(list)`, `log`, `logwarn`, `logerr`

### Coding standards
- TypeScript, ES modules, `"type": "module"` in `package.json`
- Prefer explicit, safe data handling and early returns
- No Node/browser APIs in extension code
- Keep selectors resilient; guard all external assumptions with assertions
- Follow repository Biome rules: run `turbo run lint` and `turbo run format`

### Build & local test loop
1. Build the extension to `.dist`:
   - `turbo run build`
2. Run tests:
   - `turbo run test`

The example test (`extensions/test/src/main.test.ts`) uses the Node runtime to load your bundled extension and assertions from `dion-test-asserts` to validate URLs, images, M3U8 streams, and Custom UI shapes.

```startLine:endLine:extensions/test/src/main.test.ts
16:41:extensions/test/src/main.test.ts
beforeAll(async () => {
  const ext = (await new ExtensionManager("./.dist").getExtensions())[0];
  if (ext === undefined)
    throw new Error("Extension not found in dist! Maybe build failed?");
  extension = ext;
});
```

Tips for reliable tests
- Choose stable URLs; the assertion helpers perform live HTTP checks with light rate limiting.
- Keep episode lists and sources consistent; ensure required fields (`id`, `url`, `title`, etc.).
- Use `dion-test-asserts` to validate a sample rather than every item (it already samples internally).

### Distribution
- `turbo run pushdev` to push to a dev environment
- `turbo run push` for production
- Ensure your metadata (`extensionid`, `id`, `version`, `icon`, `url`, `media_type`, `lang`, `min_api_version`) is accurate

### Best-practices checklist
- [ ] File header has `/// <reference types="dion-runtime-types" />`
- [ ] `settings` defined using `ExtensionSetting` with stable IDs
- [ ] `browse()`/`search()` return `Entry[]` with valid absolute URLs and titles
- [ ] `detail()` returns full `EntryDetailed` with `episodes` and `settings: sstore.toMap()`
- [ ] `source()` returns a valid `Source` variant (`Data` or `Directlink`)
- [ ] Use `assert`/`assertDefined` on every external dependency (network/DOM)
- [ ] Network calls use `network.fetch`; HTML via `parse_html`
- [ ] Lint, format, and type-check pass
- [ ] Tests pass using the bundled `.dist` build

### Troubleshooting
- Build produced no `.dist` contents: run `turbo run build` and ensure the bundler (`dion-bundle` via dev deps) is available; confirm your entry is `src/main.ts`.
- Runtime errors about missing APIs: remove Node/browser APIs; use `network`/`parse` modules.
- Settings not appearing or persisting: ensure `ExtensionSetting.register()` runs (it happens in `Extension.load()` automatically) and return `sstore.toMap()` from `detail()`.
- Source fails validation: verify correct `Source` shape and that URLs are reachable.

For a working example, explore `extensions/test` and the APIs in `packages/lib/src/*.ts`.