## Dion Media Extensions Monorepo

This repository contains the extension monorepo for [dion](https://github.com/bldng1337/dion). It includes extensions and some libraries for building extensions.

### Contents
- `extensions/test`: A fully working sample extension with build, test, lint, and type-check scripts
- `packages/lib`: Extension base class, settings system, Custom UI helpers, and utilities
- `packages/asserts`: Validation helpers for extension tests (URL/image/M3U8 checks and UI validation)
- `packages/create`: Build utilities used by bundling scripts
- `packages/config`: Shared Biome and TypeScript configuration
- `packages/scripts`: Repo-level scripts and helpers used by tooling

### Prerequisites
- Bun. Install from `https://bun.sh`.

### Quick start
Build and test the sample extension:
```bash
# Clone the repo
git clone https://github.com/dionysos/main_repo.git
cd main_repo/extensions/test

# Install dependencies
bun i

# Build and test
turbo run test
```

### Developing an extension
Use `bun run create` on the root package and follow the prompts to scaffold a new extension.

### Commands
- `turbo run build`: Bundles your extension
- `turbo run test`: Runs extension tests against the bundled extension
- `turbo run check-types`: Type-checks the code
- `turbo run lint`: Static analysis with Biome
- `turbo run format`: Auto-formatting with Biome
- `turbo run pushdev`: Pushes the bundled extension to the app in dev mode
- `turbo run push`: Pushes the bundled extension to the installed app