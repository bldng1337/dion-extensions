#!/usr/bin/env bun
import { $ } from "bun";

function assertEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Required env var ${name} is missing`);
  }
  return value;
}

async function main() {
  try {
    assertEnv("GH_TOKEN");
    const repositorySlug = assertEnv("GITHUB_REPOSITORY");
    const tag = process.argv[2] || "extensions";

    let assets = [];
    try {
      const view = await $`gh release view ${tag} --json assets --repo ${repositorySlug}`.quiet().nothrow();
      if (view.exitCode !== 0) {
        throw new Error("view failed");
      }
      const parsed = JSON.parse(view.stdout.toString() || "{}");
      assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    } catch (err) {
      console.log(`No release or assets found for tag ${tag}. Nothing to clear.`);
      return;
    }

    if (assets.length === 0) {
      console.log("No assets to delete");
      return;
    }

    for (const asset of assets) {
      if (!asset?.id) continue;
      console.log(`Deleting asset ${asset.id}`);
      const del = await $`gh api --method DELETE repos/${repositorySlug}/releases/assets/${asset.id}`.nothrow();
      if (del.exitCode !== 0) {
        throw new Error(`Failed to delete asset ${asset.id}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
