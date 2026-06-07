#!/usr/bin/env node
/**
 * Semantic versioning from git commits.
 * 解析 commit message 自动判断 major/minor/patch。
 *
 * 规则（只认冒号前的标签）:
 *   优先级: breaking > feat > fix > other
 *   breaking:    → major +1
 *   feat: / add: → minor +1
 *   fix:         → patch +1
 *   docs:/chore:/cleanup:/refactor:/style:/test:/perf:  → 跳过（不 bump）
 *   其他标签/无标签 → patch +1
 *
 * 用法:
 *   node update-version.cjs                   # 当前目录
 *   node update-version.cjs ../path           # 指定项目
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(process.argv[2] || ".");
const VERSION_FILE = path.join(ROOT, "version.json");
const PLUGIN_JSONS = [
  path.join(ROOT, ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugin", ".claude-plugin", "plugin.json"),
];

const SKIP_LABELS = new Set(["docs", "chore", "cleanup", "refactor", "style", "test", "perf"]);

function exec(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 5000 }).trim(); } catch { return ""; }
}

// Read current version
let major = 0, minor = 0, patch = 0, lastSha = "";
try {
  const prev = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
  const m = (prev.version || "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (m) { major = parseInt(m[1]); minor = parseInt(m[2]); patch = parseInt(m[3]); }
  lastSha = prev.sha || "";
} catch {}

// Get commits since last version
let log = "";
if (lastSha) {
  log = exec(`git log ${lastSha}..HEAD --format=%s`);
} else {
  log = exec("git log --format=%s");
}
const currentSha = exec("git rev-parse HEAD");

if (log) {
  const lines = log.split("\n").filter(Boolean);
  let hasBreaking = false, hasFeat = false, hasFix = false;

  for (const msg of lines) {
    // Extract label before colon
    const colonIdx = msg.indexOf(":");
    const label = colonIdx === -1 ? "" : msg.slice(0, colonIdx).toLowerCase().trim();

    // Skip no-bump labels
    if (SKIP_LABELS.has(label)) continue;

    // Priority: breaking > feat > fix > other
    if (label === "breaking") { hasBreaking = true; }
    else if (label === "feat" || label === "add") { hasFeat = true; }
    else if (label === "fix") { hasFix = true; }
    else { hasFix = true; } // other → patch
  }

  if (hasBreaking) { major++; minor = 0; patch = 0; }
  else if (hasFeat) { minor++; patch = 0; }
  else if (hasFix) { patch++; }
}

const build = exec("git log -1 --format=%cd --date=format:%Y%m%d.%H%M") || "00000000.0000";
const ver = `${major}.${minor}.${patch}`;
const full = `v${ver}(${build})`;

const data = { version: ver, build, full, sha: currentSha };
fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + "\n");

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
