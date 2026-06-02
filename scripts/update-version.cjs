#!/usr/bin/env node
/**
 * Semantic versioning from git commits.
 * 解析 commit message 自动判断 major/minor/patch。
 *
 * 规则:
 *   BREAKING / restructure / rewrite  → major +1
 *   feat / add / new / redesign        → minor +1
 *   fix                                 → patch +1
 *   其他                                 → patch +1
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VERSION_FILE = path.join(ROOT, "version.json");
const PLUGIN_JSONS = [
  path.join(ROOT, ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugin", ".claude-plugin", "plugin.json"),
];

function exec(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 5000 }).trim(); } catch { return ""; }
}

// Read current version from version.json (if exists)
let major = 0, minor = 0, patch = 0, lastSha = "";
try {
  const prev = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
  const m = (prev.version || "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (m) { major = parseInt(m[1]); minor = parseInt(m[2]); patch = parseInt(m[3]); }
  lastSha = prev.sha || "";
} catch {}

// Get commits since last version change
let log = "";
if (lastSha) {
  log = exec(`git log ${lastSha}..HEAD --format=%s`);
} else {
  log = exec("git log --format=%s");
}
const currentSha = exec("git rev-parse HEAD");

if (log) {
  const lines = log.split("\n").filter(Boolean);
  let hasBreaking = false, hasFeat = false, meaningfulCount = 0;

  for (const msg of lines) {
    const lower = msg.toLowerCase();

    // Skip docs-only / chore / cleanup — no version bump for these
    if (lower.startsWith("docs:") || lower.startsWith("chore:") || lower.startsWith("cleanup:")) continue;

    meaningfulCount++;

    if (lower.includes("breaking") || lower.includes("restructure") || lower.includes("rewrite")) {
      hasBreaking = true;
    }
    if (lower.startsWith("feat") || lower.startsWith("add ") || lower.startsWith("redesign")) {
      hasFeat = true;
    }
  }

  if (hasBreaking) { major++; minor = 0; patch = 0; }
  else if (hasFeat) { minor++; patch = 0; }
  else { patch += meaningfulCount; }
}

const build = exec("git log -1 --format=%cd --date=format:%Y%m%d.%H%M") || "00000000.0000";
const ver = `${major}.${minor}.${patch}`;
const full = `v${ver}(${build})`;

const data = { version: ver, build, full, sha: currentSha };
fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + "\n");

// Sync version into plugin.json files so marketplace displays correct version
for (const f of PLUGIN_JSONS) {
  try {
    const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
    if (pkg.version !== full) {
      pkg.version = full;
      fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
    }
  } catch {}
}

console.log(`[version] ${full}`);
