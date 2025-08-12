#!/usr/bin/env bun
import { $ } from "bun";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

function assertEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Required env var ${name} is missing`);
  }
  return value;
}

function collectFilesRecursively(rootDir) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) files.push(full);
    }
  }
  walk(rootDir);
  return files;
}

(async function main() {
  try {
    assertEnv("GH_TOKEN");
    const repositorySlug = assertEnv("GITHUB_REPOSITORY");
    const tag = process.argv[2] || "extensions";
    const dir = process.argv[3] || ".index";

    // Ensure directory exists and contains files
    let stats;
    try {
      stats = statSync(dir);
    } catch {
      throw new Error(`${dir} directory not found. Did the build succeed?`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`${dir} exists but is not a directory`);
    }

    const files = collectFilesRecursively(dir);
    if (files.length === 0) {
      throw new Error(`No files found in ${dir} to upload`);
    }

    // Upload in batches of up to 50
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const fileArgs = batch.map((p) => {
        const rel = relative(dir, p);
        return `${p}#${rel}`;
      });
      const res = await $`gh release upload ${tag} ${fileArgs} --clobber --repo ${repositorySlug}`.nothrow();
      if (res.exitCode !== 0) {
        process.exit(res.exitCode);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
