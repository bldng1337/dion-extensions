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
    const repositorySlug = assertEnv("GITHUB_REPOSITORY");
    assertEnv("GH_TOKEN");
    const tag = process.argv[2] || "extensions";
    const title = process.argv[3] || tag;

    // Check if release exists
    const view = await $`gh release view ${tag} --repo ${repositorySlug}`.nothrow();
    if (view.exitCode === 0) {
      console.log(`Release ${tag} exists`);
      return;
    }

    // Create release
    const create = await $`gh release create ${tag} --title ${title} --notes ${"Automated index upload"} --repo ${repositorySlug}`.nothrow();
    if (create.exitCode !== 0) {
      throw new Error(`Failed to create release ${tag}`);
    }
    console.log(`Created release ${tag}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
