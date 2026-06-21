#!/usr/bin/env node
/**
 * cc-trace summarize.cjs
 * Generates session summaries via DeepSeek API.
 * Runs when Claude Code fires the Stop hook (session end or /compact).
 *
 * Usage:
 *   node summarize.cjs                          # Full summary of latest session
 *   node summarize.cjs --checkpoint             # Incremental summary mid-session
 *
 * Zero npm dependencies. Node.js 18+ required.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const SESSIONS_DIR = path.join(TRACE_DIR, "sessions");
const MEMORY_DIR = path.join(TRACE_DIR, "memory");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");

const API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_TOKENS = 800;
const TEMPERATURE = 0.3;
const MAX_RECORDS_SUMMARY = 200; // cap records sent to AI to avoid token blowup
const CHECKPOINT_THRESHOLD = 5; // minimum new records to bother summarizing

// ── Helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getApiKey() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return s?.env?.ANTHROPIC_AUTH_TOKEN || "";
  } catch {
    return "";
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Scan session dirs, sorted newest-first */
function scanSessions() {
  const results = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const projects = fs.readdirSync(SESSIONS_DIR).sort().reverse();
  for (const proj of projects) {
    const projDir = path.join(SESSIONS_DIR, proj);
    if (!fs.statSync(projDir).isDirectory()) continue;
    // Skip old date-format directories (pre-v2.0.0 flat structure)
    if (/^\d{4}-\d{2}-\d{2}$/.test(proj)) continue;

    const sessionIds = fs.readdirSync(projDir).sort().reverse();
    for (const sid of sessionIds) {
      const sidDir = path.join(projDir, sid);
      if (!fs.statSync(sidDir).isDirectory()) continue;

      const dateDirs = fs.readdirSync(sidDir, { withFileTypes: true });
      const records = [];
      let latestDate = '';

      for (const dd of dateDirs) {
        if (!dd.isDirectory()) continue;
        if (dd.name > latestDate) latestDate = dd.name;
        const dateDir = path.join(sidDir, dd.name);

        const chunks = fs.readdirSync(dateDir)
          .filter((f) => f.startsWith("chunk-") && f.endsWith(".jsonl"))
          .sort();

        for (const chunk of chunks) {
          try {
            const raw = fs.readFileSync(path.join(dateDir, chunk), "utf8");
            for (const line of raw.trim().split("\n").filter(Boolean)) {
              try { records.push(JSON.parse(line)); } catch {}
            }
          } catch {}
        }
      }

      if (records.length > 0) {
        results.push({ sessionDir: sidDir, sessionId: sid, date: latestDate, records });
      }
    }
  }
  return results;
}

/** Generate a quick title from the first meaningful user message */
function guessTitle(records) {
  for (const r of records) {
    if (r.type === "user_message" && r.content) {
      const text = r.content.slice(0, 80).trim();
      if (text.length > 5) return text.replace(/\n/g, " ").slice(0, 60);
    }
  }
  return "Session Summary";
}

/** Format records into a compact text for the AI prompt */
function formatRecordsForPrompt(records) {
  const lines = [];
  for (const r of records.slice(-MAX_RECORDS_SUMMARY)) {
    switch (r.type) {
      case "user_message":
        lines.push(`[USER] ${(r.content || "").slice(0, 500)}`);
        break;
      case "tool_use":
        lines.push(`[TOOL] ${r.toolName || "unknown"}: ${(r.toolInput || "").slice(0, 200)}`);
        break;
      case "assistant_message":
        lines.push(`[ASSISTANT] ${(r.content || "").slice(0, 300)}`);
        break;
      default:
        lines.push(`[${r.type}] ${JSON.stringify(r).slice(0, 200)}`);
        break;
    }
  }
  return lines.join("\n");
}

/** Call DeepSeek API and return the response text */
function callAI(systemPrompt, userPrompt) {
  return new Promise((resolve) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      resolve(null);
      return;
    }

    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt.slice(0, 60000) },
      ],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    const req = https.request(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "cc-trace/1.0",
        },
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || "";
            resolve(content.trim());
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/** Build a fallback summary when AI is unavailable */
function buildFallbackSummary(records) {
  const userMsgs = records.filter((r) => r.type === "user_message");
  const toolUses = records.filter((r) => r.type === "tool_use");
  const assistantMsgs = records.filter((r) => r.type === "assistant_message");

  const tools = [...new Set(toolUses.map((r) => r.toolName || "unknown"))];
  const duration = records.length > 1
    ? `${new Date(records[0].ts).toLocaleString()} - ${new Date(records[records.length - 1].ts).toLocaleString()}`
    : "N/A";

  const lines = [];
  lines.push(`**Session Stats:**`);
  lines.push(`- Duration: ${duration}`);
  lines.push(`- Total records: ${records.length}`);
  lines.push(`- User messages: ${userMsgs.length}`);
  lines.push(`- Assistant messages: ${assistantMsgs.length}`);
  lines.push(`- Tool uses: ${toolUses.length}`);
  lines.push(`- Tools used: ${tools.join(", ")}`);
  lines.push(``);
  lines.push(`**First prompt:**`);
  if (userMsgs.length > 0) {
    lines.push(`> ${userMsgs[0].content.slice(0, 200)}`);
  }
  lines.push(``);
  lines.push(`*Auto-generated summary (AI unavailable)*`);

  return lines.join("\n");
}

/** Load existing summary file for checkpoint diffing */
function loadExistingSummary(sessionId, date) {
  const summaryPath = path.join(MEMORY_DIR, `${sessionId}-${date}.md`);
  try {
    if (fs.existsSync(summaryPath)) {
      const content = fs.readFileSync(summaryPath, "utf8");
      // Extract the last timestamp mentioned in the summary frontmatter or body
      const tsMatch = content.match(/lastRecorded:\s*(.+)/);
      return { path: summaryPath, content, lastRecorded: tsMatch ? tsMatch[1].trim() : null };
    }
  } catch {}
  return { path: summaryPath, content: null, lastRecorded: null };
}

/** Find the index of the last summarized record based on timestamp */
function findLastSummarizedIndex(records, lastTimestamp) {
  if (!lastTimestamp) return -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].ts <= lastTimestamp) return i;
  }
  return -1;
}

/** Write summary file with frontmatter */
function writeSummaryFile(sessionId, date, title, content, lastRecorded) {
  ensureDir(MEMORY_DIR);

  const summaryPath = path.join(MEMORY_DIR, `${sessionId}-${date}.md`);
  const frontmatter = [
    "---",
    `sessionId: ${sessionId}`,
    `date: ${date}`,
    "type: session-summary",
    lastRecorded ? `lastRecorded: ${lastRecorded}` : "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = `# Summary: ${title}\n\n${content}`;
  const fullContent = frontmatter + body;

  fs.writeFileSync(summaryPath, fullContent, "utf8");
  return summaryPath;
}

/** Update MEMORY.md index */
function updateMemoryIndex(sessionId, date, title) {
  ensureDir(MEMORY_DIR);
  const indexPath = path.join(MEMORY_DIR, "MEMORY.md");

  let lines = [];
  try {
    if (fs.existsSync(indexPath)) {
      lines = fs.readFileSync(indexPath, "utf8").split("\n");
    }
  } catch {}

  // Ensure header exists
  const hasHeader = lines.some((l) => l.startsWith("# Memory Index"));
  if (!hasHeader) {
    lines.unshift("# Memory Index\n");
  }

  // Build new entry
  const preview = title.slice(0, 80);
  const entry = `- [${date}/${sessionId}] ${preview}`;

  // Avoid duplicate entries for same session/date
  const duplicate = lines.some((l) => l.includes(`${date}/${sessionId}]`));
  if (!duplicate) {
    lines.push(entry);
  }

  fs.writeFileSync(indexPath, lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", "utf8");
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isCheckpoint = args.includes("--checkpoint");

  try {
    // 1. Find latest session
    const sessions = scanSessions();
    if (sessions.length === 0) return;

    const latest = sessions[0];
    const { sessionId, date, records } = latest;

    // 2. Determine which records to summarize
    let summaryRecords = records;
    let lastRecordedTs = null;

    if (isCheckpoint) {
      const existing = loadExistingSummary(sessionId, date);
      if (existing.lastRecorded) {
        const idx = findLastSummarizedIndex(records, existing.lastRecorded);
        if (idx >= 0) {
          summaryRecords = records.slice(idx + 1);
        }
      }
    }

    // If checkpoint mode with too few new records, skip silently
    if (isCheckpoint && summaryRecords.length < CHECKPOINT_THRESHOLD) return;

    // 3. Generate title from the subset we're summarizing
    const title = guessTitle(summaryRecords);
    const formattedRecords = formatRecordsForPrompt(summaryRecords);

    // 4. Call DeepSeek API for summarization
    const systemPrompt =
      "You are a concise session summarizer. Summarize the conversation in Chinese. " +
      "Cover: key technical decisions, user preferences, bugs found, what was built or changed. " +
      "Return as markdown. Use bullet points. Be specific and factual.";
    const userPrompt =
      `Summarize the following conversation records from session ${sessionId} on ${date}.\n\n${formattedRecords}`;

    let summaryContent;
    try {
      summaryContent = await callAI(systemPrompt, userPrompt);
    } catch {
      summaryContent = null;
    }

    // 5. Fallback if AI failed
    if (!summaryContent || summaryContent.length < 20) {
      summaryContent = buildFallbackSummary(summaryRecords);
    }

    // 6. Record the timestamp of the last record we've summarized
    const lastSummarizedTs = summaryRecords[summaryRecords.length - 1]?.ts || new Date().toISOString();

    // 7. Write summary file
    writeSummaryFile(sessionId, date, title, summaryContent, lastSummarizedTs);

    // 8. Update MEMORY.md index
    updateMemoryIndex(sessionId, date, title);
  } catch (e) {
    // Silent failure — always exit 0
  }
}

main().catch(() => process.exit(0));
