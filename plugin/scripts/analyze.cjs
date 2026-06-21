#!/usr/bin/env node
/**
 * cc-trace analyze.cjs
 * Cross-session pattern analyzer: finds repeated corrections, common workflows,
 * and user preferences across all sessions, then generates Skill files.
 *
 * Usage:
 *   node analyze.cjs                       # Full analysis of all sessions
 *   node analyze.cjs --checkpoint          # Incremental: only new sessions
 *   node analyze.cjs --force               # Re-analyze everything
 *
 * Zero npm dependencies. Node.js 18+ required.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// ── Paths ──────────────────────────────────────────────────────────

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const SESSIONS_DIR = path.join(TRACE_DIR, "sessions");
const SKILLS_DIR = path.join(TRACE_DIR, "skills");
const SKILLS_INDEX = path.join(SKILLS_DIR, "SKILLS.md");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");
const CONFIG_PATH = path.join(TRACE_DIR, "config.json");

const API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.3;
const MAX_SESSIONS_FOR_ANALYSIS = 20; // cap sessions to avoid token blowup

// ── Helpers ────────────────────────────────────────────────────────

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

/** Scan sessions using new directory structure: proj/sid/date/chunk */
function scanAllSessions() {
  const results = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const projects = fs.readdirSync(SESSIONS_DIR).sort().reverse();
  for (const proj of projects) {
    const projDir = path.join(SESSIONS_DIR, proj);
    try { if (!fs.statSync(projDir).isDirectory()) continue; } catch { continue; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(proj)) continue;

    const sessionIds = fs.readdirSync(projDir).sort().reverse();
    for (const sid of sessionIds) {
      const sidDir = path.join(projDir, sid);
      try { if (!fs.statSync(sidDir).isDirectory()) continue; } catch { continue; }

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
        results.push({ sessionId: sid, date: latestDate, project: proj, records });
      }
    }
  }
  return results;
}

/** Load existing SKILLS.md and return existing skill names */
function loadSkillIndex() {
  const entries = [];
  try {
    if (fs.existsSync(SKILLS_INDEX)) {
      const content = fs.readFileSync(SKILLS_INDEX, "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^\s*-\s+\[([^\]]+)\]\s*(.*)?$/);
        if (m) entries.push({ name: m[1].trim(), desc: (m[2] || "").trim() });
      }
    }
  } catch {}
  return entries;
}

/** Call DeepSeek API for analysis */
function callAI(systemPrompt, userPrompt) {
  return new Promise((resolve) => {
    const apiKey = getApiKey();
    if (!apiKey) { resolve(null); return; }

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
        timeout: 60000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || "";
            resolve(content.trim());
          } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/** Build a compact summary of sessions for the AI */
function buildSessionSummary(sessions) {
  let output = "";
  for (const s of sessions) {
    output += `\n=== Session ${s.date}/${s.sessionId} (${s.project}) ===\n`;
    let userCount = 0, toolCount = 0;
    const tools = new Set();
    for (const r of s.records) {
      if (r.type === "user_message") {
        userCount++;
        if (userCount <= 3) output += `[USER] ${(r.content || "").slice(0, 150)}\n`;
      }
      if (r.type === "tool_use") {
        toolCount++;
        tools.add(r.toolName);
      }
    }
    output += `[STATS] ${userCount} user msgs, ${toolCount} tool uses, tools: ${[...tools].join(", ")}\n`;
  }
  return output;
}

/** Write a Skill file with frontmatter */
function writeSkillFile(name, description, trigger, content, evidence) {
  ensureDir(SKILLS_DIR);
  const skillPath = path.join(SKILLS_DIR, `${name}.md`);

  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `trigger: ${trigger}`,
    "type: cc-trace-skill",
    `created: ${todayStr()}`,
    "---",
    "",
  ].join("\n");

  const body = `# ${description}\n\n## Instructions\n\n${content}\n\n## Triggers\n\n${trigger}\n\n## Evidence\n\n${evidence}`;
  fs.writeFileSync(skillPath, frontmatter + body, "utf8");
  return skillPath;
}

/** Update SKILLS.md index */
function updateSkillIndex(name, description) {
  ensureDir(SKILLS_DIR);
  let lines = [];
  try {
    if (fs.existsSync(SKILLS_INDEX)) {
      lines = fs.readFileSync(SKILLS_INDEX, "utf8").split("\n");
    }
  } catch {}

  const hasHeader = lines.some((l) => l.startsWith("# Skill Index"));
  if (!hasHeader) lines.unshift("# Skill Index\n");

  const entry = `- [${name}] ${description.slice(0, 80)}`;
  const duplicate = lines.some((l) => l.includes(`[${name}]`));
  if (!duplicate) lines.push(entry);

  fs.writeFileSync(SKILLS_INDEX, lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", "utf8");
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isCheckpoint = args.includes("--checkpoint");

  try {
    // 1. Scan all sessions
    const allSessions = scanAllSessions();
    if (allSessions.length === 0) return;

    // 2. For checkpoint mode, only analyze sessions not yet processed
    let sessions = allSessions;
    if (isCheckpoint) {
      const existing = loadSkillIndex();
      const existingNames = new Set(existing.map((e) => e.name));
      // Only analyze sessions that may have new patterns
      // (simplified: take last 3 sessions)
      sessions = allSessions.slice(0, 3);
    }

    // 3. Build session summary for AI
    const sessionSummary = buildSessionSummary(sessions.slice(0, MAX_SESSIONS_FOR_ANALYSIS));

    // 4. Call AI to find patterns
    const systemPrompt =
      "You are a pattern analyzer for a developer's Claude Code usage. " +
      "Analyze the conversation history and find REPEATED patterns:\n" +
      "1. User preferences (tools, workflows, styles the user consistently chooses)\n" +
      "2. Corrections (times when Claude did something wrong and user fixed it)\n" +
      "3. Common workflows (tasks the user does repeatedly with the same steps)\n\n" +
      "For each pattern found, output as a JSON array of objects with:\n" +
      "- name: short kebab-case id (e.g. 'prefer-pnpm')\n" +
      "- description: one-line summary\n" +
      "- trigger: when does this rule apply?\n" +
      "- instructions: what should Claude do (2-3 sentences)\n" +
      "- evidence: which sessions show this pattern\n\n" +
      "ONLY output the JSON array, no other text. If no clear patterns found, output []";

    const userPrompt = `Analyze the following session history for repeatable patterns:\n\n${sessionSummary}`;

    // Retry up to 3 times for API reliability
    let analysis = null;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) await new Promise((r) => setTimeout(r, 2000));
      analysis = await callAI(systemPrompt, userPrompt);
      if (analysis && analysis.trim()) break;
    }
    if (!analysis || analysis.trim() === "") return;

    // 5. Parse AI output
    let patterns;
    try {
      // Strip markdown code blocks
      let clean = analysis.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
      // Find outermost JSON array or single object
      let parsed = null;

      // Try array first
      const arrayMatch = clean.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try { parsed = JSON.parse(arrayMatch[0]); } catch {}
      }

      // If not an array, try single object
      if (!parsed) {
        const objMatch = clean.match(/\{[\s\S]*\}/);
        if (objMatch) {
          try { parsed = [JSON.parse(objMatch[0])]; } catch {}
        }
      }

      // If still nothing and response is a flat array of strings, convert to skill format
      if (!parsed) {
        try {
          const flat = JSON.parse(clean);
          if (Array.isArray(flat)) {
            parsed = flat.filter(s => typeof s === 'string').map((s, i) => ({
              name: 'pattern-' + (i + 1),
              description: s.slice(0, 80),
              trigger: 'When the conversation relates to: ' + s,
              instructions: 'Be aware of: ' + s,
              evidence: 'Auto-detected across sessions'
            }));
          }
        } catch {}
      }

      patterns = parsed;
    } catch {}

    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return;

    // 6. Write skill files
    for (const p of patterns) {
      const name = (p.name || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `skill-${Date.now()}`;
      const desc = p.description || "Auto-detected pattern";
      const trigger = p.trigger || "Unknown";
      const instructions = p.instructions || "Follow user preferences from conversation history.";
      const evidence = p.evidence || "Detected by cc-trace analyze";

      writeSkillFile(name, desc, trigger, instructions, evidence);
      updateSkillIndex(name, desc);
      console.error(`[cc-trace] Skill generated: ${name} — ${desc}`);
    }
  } catch (e) {
    // Silent failure — always exit 0
  }
}

main().catch(() => process.exit(0));
