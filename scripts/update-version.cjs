#!/usr/bin/env node
/**
 * Update version.json from git log.
 * Run before each commit: node scripts/update-version.cjs
 * Git hook: pre-commit
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VERSION_FILE = path.join(ROOT, "version.json");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

let version = PACKAGE.version || "0.0.0";
let build = "00000000.0000";

try {
  // Get last commit timestamp in local time
  const ts = execSync('git log -1 --format=%cd --date=format:%Y%m%d.%H%M', {
    cwd: ROOT, encoding: "utf8", timeout: 5000,
  }).trim();
  if (ts) build = ts;

} catch {}

const data = { version, build, full: `v${version}(${build})` };
fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`[version] ${data.full}`);
