## Dion Media Extensions Monorepo
This repository contains the extension monorepo for [dion](https://github.com/bldng1337/dion). Click [here](dion://repo/add?url=https%3A%2F%2Fgithub.com%2Fbldng1337%2Fdion-extensions%2Freleases%2Fdownload%2Fextensions%2Findex.repo.json) to add the extensions to the app, and click [here](https://bldng1337.github.io/dion-extensions/) to browse the extensions in your browser.

### Prerequisites
- Bun. Install from `https://bun.sh`.

### Quick start
Build and test the extensions:
```bash
# Clone the repo
git clone https://github.com/bldng1337/dion-extensions.git
cd dion-extensions

# Install dependencies
bun i

# Build and test
turbo run test
```

### Developing an extension
Use `bun run create` on the root package and follow the prompts to scaffold a new extension.

### Commands
- `turbo run build`: Bundles the extensions
- `turbo run test`: Runs extension tests against the bundled extensions
- `turbo run check-types`: Type-checks the code
- `turbo run lint`: Static analysis with Biome
- `turbo run format`: Auto-formatting with Biome
- `bun run build-index`: Builds the repo index into `.index`
- `bun run build-site`: Builds the browsable extension site into `.site`
- `bun run dev`: Builds everything and serves the index locally
