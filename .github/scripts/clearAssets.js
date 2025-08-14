#!/usr/bin/env bun
import { $ } from "bun";

export function assertEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Required env var ${name} is missing`);
  }
  return value;
}

async function main() {
  try {
    const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!ghToken) {
      throw new Error("Required env var GH_TOKEN or GITHUB_TOKEN is missing");
    }
    // Normalize for gh CLI which prefers GH_TOKEN
    process.env.GH_TOKEN = ghToken;
    const repositorySlug = assertEnv("GITHUB_REPOSITORY");
    const ghCheck = await $`gh --version`.nothrow();
    if (ghCheck.exitCode !== 0) {
      throw new Error("GitHub CLI 'gh' is not installed or not in PATH");
    }
    const tag = process.argv[2] || "extensions";

    let assets = [];
    try {
      const parsed =
        await $`gh release view ${tag} --json assets --repo ${repositorySlug}`.json();
      assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    } catch (_err) {
      console.log(
        `No release or assets found for tag ${tag}. Nothing to clear.`
      );
      return;
    }

    if (assets.length === 0) {
      console.log("No assets to delete");
      return;
    }

    for (const asset of assets) {
      if (!asset?.id) continue;
      console.log(`Deleting asset ${JSON.stringify(asset)}`);
      const assetid = asset.apiUrl.split("/").pop();
      const del =
        await $`gh api --method DELETE repos/${repositorySlug}/releases/assets/${assetid}`.nothrow();
      if (del.exitCode !== 0) {
        throw new Error(`Failed to delete asset ${assetid}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
