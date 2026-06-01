#!/usr/bin/env node
/**
 * cc-trace inject.cjs
 * SessionStart hook: injects recent memory into ~/.claude/CLAUDE.md
 *
 * Reads ~/.claude-memory/memory/MEMORY.md index, grabs the last 3 entries,
 * and appends a "## Recent Memory Snapshot (cc-trace)" block to CLAUDE.md.
 *
 * Zero npm dependencies. Node.js 18+ required. Never crashes, always exits 0.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Paths ───────────────────────────────────────────────────────────

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const MEMORY_DIR = path.join(TRACE_DIR, "memory");
const MEMORY_INDEX = path.join(MEMORY_DIR, "MEMORY.md");
const CLAUDE_MD = path.join(HOME, ".claude", "CLAUDE.md");
const MAX_ENTRIES = 3;

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse MEMORY.md index file. Returns array of { title, filename, description } in list order. */
function parseMemoryIndex(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const entries = [];

  // Match markdown list items: "- [title](filename.md) — description"
  const lineRe = /^\s*-\s+\[([^\]]+)\]\(([^)]+\.md)\)\s*(?:[—–-]\s*)?(.*)?$/;
  for (const line of content.split("\n")) {
    const m = line.match(lineRe);
    if (m) {
      entries.push({
        title: m[1].trim(),
        filename: m[2].trim(),
        description: (m[3] || "").trim(),
      });
    }
  }

  return entries;
}

/** Read a memory entry .md file and return its content (first 200 chars as summary). */
function readEntryContent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8").trim();
    // Return first meaningful paragraph (skip leading whitespace / headings)
    const lines = content.split("\n").filter((l) => l.trim());
    return lines.length > 0 ? lines[0].trim() : null;
  } catch {
    return null;
  }
}

/** Format a date from a memory entry filename or fall back to current date. */
function formatDate(entryFilename) {
  // Attempt to extract date from filename like "my-topic-2026-06-01.md"
  const dateRe = /(\d{4})-(\d{2})-(\d{2})/;
  const m = entryFilename.match(dateRe);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Fall back to file's mtime
  const entryPath = path.join(MEMORY_DIR, entryFilename);
  try {
    const stat = fs.statSync(entryPath);
    return stat.mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  // 1. Read MEMORY.md index
  if (!fs.existsSync(MEMORY_INDEX)) {
    // No memory entries — nothing to inject
    process.exit(0);
  }

  let entries;
  try {
    entries = parseMemoryIndex(MEMORY_INDEX);
  } catch {
    process.exit(0);
  }

  if (entries.length === 0) process.exit(0);

  // 2. Take the last entries (index is ordered newest-first per claude-mem convention)
  const recent = entries.slice(0, MAX_ENTRIES);

  // 3. Build snapshot block
  const snapshotLines = [];
  snapshotLines.push("");
  snapshotLines.push("## Recent Memory Snapshot (cc-trace)");
  snapshotLines.push("");

  for (const entry of recent) {
    const date = formatDate(entry.filename);
    const entryPath = path.join(MEMORY_DIR, entry.filename);
    let summary = entry.description;

    // If description is empty, read the entry file for a summary
    if (!summary) {
      const fileContent = readEntryContent(entryPath);
      if (fileContent) {
        summary = fileContent.slice(0, 150);
      }
    }

    // Fall back to title if still nothing
    if (!summary) summary = entry.title;

    snapshotLines.push(`- [${date}] ${summary}`);
  }

  snapshotLines.push("");

  const snapshotBlock = snapshotLines.join("\n");

  // 4. Read existing CLAUDE.md and check for duplicates
  let existingContent = "";
  try {
    if (fs.existsSync(CLAUDE_MD)) {
      existingContent = fs.readFileSync(CLAUDE_MD, "utf8");
    }
  } catch {
    process.exit(0);
  }

  // Check if snapshot section already exists
  const snapshotMarker = "## Recent Memory Snapshot (cc-trace)";
  const existingIdx = existingContent.indexOf(snapshotMarker);

  if (existingIdx !== -1) {
    // Snapshot exists — check if content is the same
    // Extract everything from marker to next ## or end of file
    const afterMarker = existingContent.slice(existingIdx + snapshotMarker.length);
    const nextSectionIdx = afterMarker.search(/\n## /);
    const existingBlock = nextSectionIdx !== -1
      ? afterMarker.slice(0, nextSectionIdx)
      : afterMarker;

    // Normalize whitespace for comparison
    const newBlockText = snapshotLines.slice(2).join("\n").trim();
    const existingBlockText = existingBlock.trim();

    if (newBlockText === existingBlockText) {
      // Already up to date — skip
      process.exit(0);
    }

    // Content differs: remove old block and re-append fresh
    const beforeSection = existingContent.slice(0, existingIdx);
    const afterSection = nextSectionIdx !== -1
      ? existingContent.slice(existingIdx + snapshotMarker.length + nextSectionIdx)
      : "";

    existingContent = (beforeSection + afterSection).trimEnd();
  }

  // 5. Append snapshot block
  const newContent = existingContent.endsWith("\n") || existingContent === ""
    ? existingContent + snapshotBlock.trimStart()
    : existingContent + "\n" + snapshotBlock.trimStart();

  try {
    fs.writeFileSync(CLAUDE_MD, newContent, "utf8");
  } catch {
    process.exit(0);
  }
}

main();
