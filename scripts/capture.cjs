#!/usr/bin/env node
/**
 * cc-trace capture.cjs
 * Hook script: records user prompts and tool uses to session-level JSONL files.
 *
 * Usage (invoked by Claude Code hooks):
 *   node capture.cjs              → auto-detect mode from stdin payload
 *
 * Claude Code hook stdin payload includes:
 *   { transcript_path, tool_name, tool_input, tool_result, ... }
 *
 * Zero npm dependencies. Node.js 18+ required.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const SESSIONS_DIR = path.join(TRACE_DIR, "sessions");
const CONFIG_PATH = path.join(TRACE_DIR, "config.json");
const CHECKPOINT_COUNTER = path.join(TRACE_DIR, "checkpoint.json");
const CHUNK_SIZE = 100;
const DEFAULT_CONFIG = { checkpointN: 10 };

const TRUNCATION_RULES = {
  read_file: 0,
  edit_file: 0,
  write_file: 0,
  search_content: 2000,
  list_directory: 1000,
  web_fetch: 8000,
  web_search: 8000,
  default: 8000,
};

// ── Helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH))
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function safeStringify(v, maxLen) {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return maxLen > 0 ? s.slice(0, maxLen) : "";
  } catch {
    return "";
  }
}

function getTruncationLimit(toolName) {
  return TRUNCATION_RULES[toolName] !== undefined
    ? TRUNCATION_RULES[toolName]
    : TRUNCATION_RULES.default;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function projectName(cwd) {
  if (!cwd) return "default";
  const parts = path.resolve(cwd).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "default";
}

/** Extract session ID from transcript_path: ".../transcripts/abc123.jsonl" → "abc123" */
function sessionIdFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  const base = path.basename(transcriptPath, ".jsonl");
  // Sanitize: only keep safe chars
  return base.replace(/[^\w\-]/g, "_").slice(0, 64) || null;
}

/** Get or create the current chunk path for a session */
const _projectCache = {};
function getProjectForCwd(cwd) {
  if (_projectCache[cwd]) return _projectCache[cwd];
  _projectCache[cwd] = projectName(cwd);
  return _projectCache[cwd];
}

function getChunkPath(sessionId, cwd) {
  const date = todayStr();
  const proj = getProjectForCwd(cwd);
  const sessionDir = path.join(SESSIONS_DIR, proj, sessionId, date);
  ensureDir(sessionDir);

  // Find latest chunk
  let latestIdx = -1;
  let files;
  try {
    files = fs.readdirSync(sessionDir);
  } catch {
    files = [];
  }

  for (const f of files) {
    const m = f.match(/^chunk-(\d+)\.jsonl$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx > latestIdx) latestIdx = idx;
    }
  }

  const chunkPath = path.join(sessionDir, `chunk-${String(latestIdx).padStart(3, "0")}.jsonl`);

  if (latestIdx === -1) {
    // First chunk
    return path.join(sessionDir, "chunk-000.jsonl");
  }

  // Check if current chunk is full
  try {
    if (fs.existsSync(chunkPath)) {
      const lines = fs.readFileSync(chunkPath, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length >= CHUNK_SIZE) {
        const nextIdx = latestIdx + 1;
        return path.join(sessionDir, `chunk-${String(nextIdx).padStart(3, "0")}.jsonl`);
      }
    }
  } catch {}

  return chunkPath;
}

/** Dedup: skip record if it's identical to the last one within 1s */
function dedupLastTwo(sessionDir, newRecord) {
  // Find the latest chunk
  let files;
  try {
    files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return false;
  }
  if (files.length === 0) return false;

  const lastFile = path.join(sessionDir, files[files.length - 1]);
  try {
    const content = fs.readFileSync(lastFile, "utf8").trim();
    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) return false;
    const last = JSON.parse(lines[lines.length - 1]);
    if (last.type === newRecord.type && last.content === newRecord.content) {
      const timeDiff = Math.abs(
        new Date(newRecord.ts).getTime() - new Date(last.ts).getTime()
      );
      if (timeDiff < 1000) return true; // identical within 1s
    }
  } catch {}
  return false;
}

/** Write meta.json for a session */
function writeMeta(sessionId, meta, cwd) {
  const date = todayStr();
  const proj = getProjectForCwd(cwd || process.cwd());
  const sessionDir = path.join(SESSIONS_DIR, proj, sessionId, date);
  ensureDir(sessionDir);
  const metaPath = path.join(sessionDir, "meta.json");
  try {
    let existing = {};
    if (fs.existsSync(metaPath)) {
      existing = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }
    const merged = { ...existing, ...meta, lastActive: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), "utf8");
  } catch {}
}

/** Check and trigger checkpoint summary */
function checkCheckpoint() {
  const cfg = loadConfig();
  const N = cfg.checkpointN || 10;
  ensureDir(TRACE_DIR);

  let counter = {};
  try {
    if (fs.existsSync(CHECKPOINT_COUNTER))
      counter = JSON.parse(fs.readFileSync(CHECKPOINT_COUNTER, "utf8"));
  } catch {}

  const key = "global";
  if (!counter[key]) counter[key] = 0;
  counter[key]++;
  fs.writeFileSync(CHECKPOINT_COUNTER, JSON.stringify(counter), "utf8");

  if (counter[key] % N === 0) {
    // Spawn background summarizer
    const summarizePath = path.join(__dirname, "summarize.cjs");
    if (fs.existsSync(summarizePath)) {
      const { spawn } = require("child_process");
      const child = spawn(process.execPath, [summarizePath, "--checkpoint"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────

function main() {
  // Read stdin payload from Claude Code hook
  let input = "";
  try {
    const buf = fs.readFileSync(0, "utf8");
    input = buf.trim();
  } catch {
    process.exit(0);
  }

  if (!input) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Extract session ID from transcript_path
  const transcriptPath = payload.transcript_path || payload.transcriptPath;
  const sessionId = sessionIdFromTranscript(transcriptPath);
  if (!sessionId) process.exit(0);

  const date = todayStr();
  const cwd = process.cwd();
  const proj = getProjectForCwd(cwd);
  const sessionDir = path.join(SESSIONS_DIR, proj, sessionId, date);
  const ts = new Date().toISOString();

  // Detect event type from payload
  const isToolUse = payload.tool_name || payload.toolName;
  const isUserPrompt = payload.user_message || payload.userMessage || payload.prompt;

  let record;

  if (isToolUse) {
    const toolName = payload.tool_name || payload.toolName || "unknown";
    const limit = getTruncationLimit(toolName);
    record = {
      type: "tool_use",
      ts,
      sessionId,
      toolName,
      toolInput: safeStringify(payload.tool_input || payload.toolInput, limit),
      toolResult: safeStringify(payload.tool_result || payload.toolResult, limit),
    };
  } else if (isUserPrompt) {
    const content = payload.user_message || payload.userMessage || payload.prompt || "";
    record = {
      type: "user_message",
      ts,
      sessionId,
      content: safeStringify(content, 16000),
    };
  } else {
    // Generic record: store whatever we got
    const text = payload.text || payload.content || payload.response || "";
    record = {
      type: "assistant_message",
      ts,
      sessionId,
      content: safeStringify(text, 16000),
    };
  }

  // Dedup
  if (dedupLastTwo(sessionDir, record)) process.exit(0);

  // Get chunk path and append
  const cwd = process.cwd();
  const chunkPath = getChunkPath(sessionId, cwd);
  ensureDir(path.dirname(chunkPath));

  try {
    fs.appendFileSync(chunkPath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    process.exit(0);
  }

  // Write/update meta
  const metaPayload = {
    sessionId,
    cwd: process.cwd(),
    model: payload.model || "",
    firstSeen: ts,
  };
  // Set title from first user message
  if (isUserPrompt && record.content) {
    metaPayload.title = record.content.slice(0, 60).replace(/\n/g, ' ');
  }
  writeMeta(sessionId, metaPayload, cwd);

  // Write current session ID
  try {
    fs.writeFileSync(path.join(TRACE_DIR, "current-session"), sessionId + "\n", "utf8");
  } catch {}

  // Trigger checkpoint if this was a user message
  if (isUserPrompt) {
    checkCheckpoint();
  }
}

main();
