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

const MAX_TOKENS = 4000;
const TEMPERATURE = 0.3;
const MAX_SESSIONS_FOR_ANALYSIS = 20; // cap sessions to avoid token blowup

// ── LLM Config ───────────────────────────────────────────────────

function getApiConfig() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    const env = s?.env || {};
    let baseUrl = (env.ANTHROPIC_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    baseUrl = baseUrl.replace(/\/anthropic\/?$/, "");
    const model = (env.ANTHROPIC_MODEL || "deepseek-v4-flash").replace(/\[.*?\]/g, "").trim();
    return {
      apiUrl: baseUrl + "/v1/chat/completions",
      model,
      apiKey: env.ANTHROPIC_AUTH_TOKEN || "",
    };
  } catch {
    return { apiUrl: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-v4-flash", apiKey: "" };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

/** Call configured LLM API for analysis */
function callAI(systemPrompt, userPrompt) {
  return new Promise((resolve) => {
    const cfg = getApiConfig();
    if (!cfg.apiKey) { resolve(null); return; }

    const body = JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt.slice(0, 60000) },
      ],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    const req = https.request(
      cfg.apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
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

    // 4. Call AI to find patterns (strict thresholds)
    const systemPrompt =
      "你是一个 Claude Code 使用模式分析器。请用中文输出。\n" +
      "严格筛选：只有同时满足以下所有条件的模式才输出：\n\n" +
      "接受标准：\n" +
      "- 同一个模式出现在 2+ 个不同会话中（跨 session 证据），或者\n" +
      "- 用户明确说了'记住'、'以后都用'、'always'、'never'、'不要再用'、'禁止'等记忆类语言，或者\n" +
      "- 用户对同一问题纠正 Claude 2 次以上\n\n" +
      "拒绝标准：\n" +
      "- 一次性话题（如只问过一次黄金价格 → 不是模式）\n" +
      "- 通用指令（与 Claude 行为无关的）\n" +
      "- 项目特定的实现细节\n\n" +
      "输出为 JSON 数组，每项包含：\n" +
      "- name: 短 kebab-case ID（英文）\n" +
      "- description: 中文一句话总结\n" +
      "- trigger: 什么情况下触发（中文）\n" +
      "- instructions: Claude 应该怎么做（中文，2-3句）\n" +
      "- evidence: 哪些 session 的什么对话证明这个模式（中文，引用原文）\n" +
      "- confidence: 0-1 数字，这个模式有多可靠\n\n" +
      "只输出 confidence >= 0.7 的模式。用 ```json 和 ``` 包裹 JSON 输出。没有合格模式就输出空数组 []。";

    const userPrompt = `分析以下会话历史，找出可重复使用的模式：\n\n${sessionSummary}`;

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

    // 6. Post-process: filter low-quality patterns
    const sessionIdRe = /[0-9a-f]{8}[0-9a-f-]*/gi;
    patterns = patterns.filter((p) => {
      // Confidence check: default to 0 if missing
      const conf = typeof p.confidence === 'number' ? p.confidence : 0;
      if (conf < 0.7) return false;

      // Evidence check: count unique session IDs mentioned
      const evidence = (p.evidence || '') + ' ' + (p.description || '') + ' ' + (p.trigger || '');
      const sessionMatches = evidence.match(sessionIdRe) || [];
      const uniqueSessions = new Set(sessionMatches);
      // Require 2+ sessions, unless user used memorization keywords
      const hasMemoryKeywords = /记住|以后都用|always|never|不要再用|禁止|全局规则/i.test(evidence);
      if (uniqueSessions.size < 2 && !hasMemoryKeywords) return false;

      // Name must be reasonable length
      const name = (p.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (name.length < 5 || name === 'skill-') return false;

      return true;
    });

    if (patterns.length === 0) return;

    // 7. Dedup within new patterns (merge similar descriptions)
    const merged = [];
    for (const p of patterns) {
      const desc = (p.description || '').toLowerCase();
      const isDuplicate = merged.some((m) => {
        const md = (m.description || '').toLowerCase();
        // Check if one description contains the other
        return desc.includes(md) || md.includes(desc);
      });
      if (!isDuplicate) merged.push(p);
    }
    patterns = merged;
    if (patterns.length === 0) return;

    // 8. Dedup against existing skills, then write new ones
    const existingSkills = loadSkillIndex();
    const existingNames = new Set(existingSkills.map((s) => s.name));
    const existingDesc = existingSkills.map((s) => s.desc.toLowerCase());

    for (const p of patterns) {
      const name = (p.name || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `skill-${Date.now()}`;
      const desc = p.description || "Auto-detected pattern";
      const trigger = p.trigger || "Unknown";
      const instructions = p.instructions || "Follow user preferences from conversation history.";
      const evidence = p.evidence || "Detected by cc-trace analyze";

      // Skip if skill name already exists
      if (existingNames.has(name)) {
        console.error(`[cc-trace] Skill skipped (duplicate): ${name}`);
        continue;
      }
      // Skip if similar description already exists (handles Chinese)
      const descKey = desc.toLowerCase().replace(/[^a-z一-鿿]/g, '').slice(0, 30);
      const similar = existingDesc.some((ed) => {
        const edKey = ed.toLowerCase().replace(/[^a-z一-鿿]/g, '').slice(0, 30);
        // Check if one contains the other (handles Chinese-English duplicate pairs)
        return descKey.includes(edKey) || edKey.includes(descKey);
      });
      if (similar) {
        console.error(`[cc-trace] Skill skipped (similar exists): ${name}`);
        continue;
      }

      writeSkillFile(name, desc, trigger, instructions, evidence);
      updateSkillIndex(name, desc);
      console.error(`[cc-trace] Skill generated: ${name} — ${desc}`);
    }
  } catch (e) {
    // Silent failure — always exit 0
  }
}

main().catch(() => process.exit(0));
