#!/usr/bin/env node
// Builds the Firefox auto-update manifest by listing every published GitHub
// Release whose tag matches vX.Y.Z. Writes JSON to stdout.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  console.error("GITHUB_REPOSITORY env var is required");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const extensionId = manifest.browser_specific_settings?.gecko?.id;
if (!extensionId) {
  console.error("manifest.json is missing browser_specific_settings.gecko.id");
  process.exit(1);
}

const raw = execSync("gh release list --limit 100 --json tagName", {
  encoding: "utf8"
});
const releases = JSON.parse(raw);

const versionPattern = /^v(\d+\.\d+\.\d+)$/;
const updates = releases
  .map((release) => versionPattern.exec(release.tagName))
  .filter(Boolean)
  .map((match) => {
    const tag = match[0];
    const version = match[1];
    return {
      version,
      update_link: `https://github.com/${repo}/releases/download/${tag}/karakeep-quick-archive-firefox-${version}.xpi`
    };
  })
  .sort((a, b) => {
    const av = a.version.split(".").map(Number);
    const bv = b.version.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (av[i] !== bv[i]) return av[i] - bv[i];
    }
    return 0;
  });

const output = {
  addons: {
    [extensionId]: { updates }
  }
};

process.stdout.write(JSON.stringify(output, null, 2) + "\n");
