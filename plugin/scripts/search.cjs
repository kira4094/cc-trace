#!/usr/bin/env node
/**
 * cc-trace search.cjs
 * Dual-channel search: keyword (fast, free) → AI semantic (deep, ~¥0.001).
 *
 * Usage:
 *   node search.cjs "quantum entanglement"
 *   node search.cjs --ai "remember something about cache"
 *   node search.cjs --last                  # Show most recent N records
 *   node search.cjs --sessions              # List all sessions
 *
 * Output: JSON array of matching records with context
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const SESSIONS_DIR = path.join(TRACE_DIR, "sessions");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");

const MAX_RESULTS = 10;
const CONTEXT_WINDOW = 2; // records before/after match
const AI_FALLBACK_THRESHOLD = 3; // if keyword returns < this, try AI

// ── Helpers ──────────────────────────────────────────────────────

function getApiKey() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return s?.env?.ANTHROPIC_AUTH_TOKEN || "";
  } catch {
    return "";
  }
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

/** Recursively scan session dirs (new structure: proj/sid/date/chunk) */
function scanAllSessions() {
  const results = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip old date-format directories (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const projDir = path.join(SESSIONS_DIR, entry.name);

    const sessionDirs = fs.readdirSync(projDir, { withFileTypes: true });
    for (const sd of sessionDirs) {
      if (!sd.isDirectory()) continue;
      const sidDir = path.join(projDir, sd.name);

      // Read all date dirs within the session
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
        results.push({
          sessionDir: sidDir,
          sessionId: sd.name,
          date: latestDate,
          records,
        });
      }
    }
  }
  return results;
}

/** Keyword search across all records */
function keywordSearch(query, sessions) {
  const q = query.toLowerCase();
  const results = [];

  for (const session of sessions) {
    for (let i = 0; i < session.records.length; i++) {
      const rec = session.records[i];
      const searchText = JSON.stringify(rec).toLowerCase();
      if (searchText.includes(q)) {
        // Build context window
        const start = Math.max(0, i - CONTEXT_WINDOW);
        const end = Math.min(session.records.length - 1, i + CONTEXT_WINDOW);
        const context = session.records.slice(start, end + 1);

        results.push({
          sessionId: session.sessionId,
          date: session.date,
          matchIndex: i,
          record: rec,
          context: context.map((r) => ({
            type: r.type,
            ts: r.ts,
            preview: (r.content || r.toolName || "").slice(0, 200),
          })),
        });

        if (results.length >= MAX_RESULTS) break;
      }
    }
    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

/** AI semantic search via DeepSeek */
function aiSearch(query, sessions) {
  return new Promise((resolve) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      resolve({ error: "No API key found for AI search" });
      return;
    }

    // Build a compact summary of recent sessions for the AI
    let history = "";
    for (const session of sessions.slice(0, 5)) {
      // Only take last 20 records per session for AI context
      const recent = session.records.slice(-20);
      history += `\n--- Session ${session.date}/${session.sessionId} ---\n`;
      for (const r of recent) {
        const preview = (r.content || r.toolName || r.type || "").slice(0, 150);
        history += `[${r.type}] ${preview}\n`;
      }
    }

    const body = JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content:
            "You are a memory search assistant. Given a user's query and conversation history, find the most relevant records. Return a JSON array of objects with: sessionId, date, relevance (0-1), and a quote of the matching content. ONLY return the JSON array, no other text.",
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nConversation history:\n${history.slice(0, 30000)}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const req = https.request(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || "";
            const aiResults = JSON.parse(content);
            if (Array.isArray(aiResults)) resolve(aiResults.slice(0, MAX_RESULTS));
            else resolve([]);
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on("error", () => resolve([]));
    req.write(body);
    req.end();
  });
}

/** Show last N records across all sessions */
function showLast(count) {
  const sessions = scanAllSessions();
  const allRecords = [];
  for (const session of sessions) {
    for (const rec of session.records) {
      allRecords.push({
        ...rec,
        _sessionId: session.sessionId,
        _date: session.date,
      });
    }
  }
  // Sort by timestamp descending
  allRecords.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return allRecords.slice(0, count);
}

/** List all sessions with summary */
function listSessions() {
  const sessions = scanAllSessions();
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    date: s.date,
    recordCount: s.records.length,
    types: [...new Set(s.records.map((r) => r.type))],
    timeRange: {
      from: s.records[0]?.ts || "",
      to: s.records[s.records.length - 1]?.ts || "",
    },
  }));
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--sessions")) {
    const sessions = listSessions();
    process.stdout.write(JSON.stringify(sessions, null, 2));
    return;
  }

  if (args.includes("--last")) {
    const count = parseInt(args[args.indexOf("--last") + 1], 10) || 10;
    const records = showLast(count);
    process.stdout.write(JSON.stringify(records, null, 2));
    return;
  }

  const useAI = args.includes("--ai");
  const query = args.filter((a) => !a.startsWith("--")).join(" ");

  if (!query) {
    process.stdout.write(JSON.stringify({ error: "No query provided" }, null, 2));
    process.exit(1);
  }

  const sessions = scanAllSessions();

  if (useAI) {
    const results = await aiSearch(query, sessions);
    process.stdout.write(JSON.stringify(results, null, 2));
    return;
  }

  // Keyword search
  const results = keywordSearch(query, sessions);

  // If too few results, try AI fallback
  if (results.length < AI_FALLBACK_THRESHOLD) {
    const aiResults = await aiSearch(query, sessions);
    const output = {
      keyword: results,
      ai_fallback: aiResults,
      note:
        results.length < AI_FALLBACK_THRESHOLD
          ? "Keyword results were sparse; AI fallback results are above"
          : undefined,
    };
    process.stdout.write(JSON.stringify(output, null, 2));
    return;
  }

  process.stdout.write(
    JSON.stringify(
      {
        keyword: results,
        totalSessions: sessions.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: e.message }, null, 2));
  process.exit(0);
});
