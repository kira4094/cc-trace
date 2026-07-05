#!/usr/bin/env node
/**
 * cc-trace analyze.cjs
 * Cross-session pattern analyzer with three-tier evidence → promotion pipeline.
 *
 * Modes:
 *   node analyze.cjs                # Incremental: only new sessions
 *   node analyze.cjs --bootstrap    # Full analysis of all sessions → evidence.json
 *
 * Architecture:
 *   Stop hook → extract evidence → merge into evidence.json → check promotion
 *   → promote qualified patterns to SKILL.md (skill-creator format)
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
const EVIDENCE_DIR = path.join(TRACE_DIR, "evidence");
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, "evidence.json");
const SKILLS_DIR = path.join(TRACE_DIR, "skills");
const SKILLS_INDEX = path.join(SKILLS_DIR, "SKILLS.md");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");

const MAX_TOKENS = 4000;
const TEMPERATURE = 0.3;
const MAX_SESSIONS_FOR_ANALYSIS = 20;
const PROMOTE_MIN_HITS = 3;
const PROMOTE_MIN_CONFIDENCE = 0.65;

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

/** Extract meaningful keywords for dedup comparison */
function skillKeywords(text) {
  const cleaned = text.toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, ' ')
    .replace(/\b(claude|git|use|do|not|the|and|or|for|to|in|of|is|are|be|will|can|when|should|if|with|this|that|code|project|user|make|change|work)\b/g, ' ')
    .replace(/使用|进行|可以|代码|修改|操作|需要|允许|如果|或者|不要|自动|明确|优先|应该|用户|基于|相关|项目|工作|方式|时候|场景/g, ' ');
  return cleaned.split(/\s+/).filter(w => w.length >= 2);
}

/** Check if two descriptions are semantically the same rule */
function isSameRule(desc1, desc2) {
  const d1 = desc1.toLowerCase().replace(/[^a-z一-鿿0-9]/g, '');
  const d2 = desc2.toLowerCase().replace(/[^a-z一-鿿0-9]/g, '');
  if (d1.includes(d2) || d2.includes(d1)) return true;
  const k1 = skillKeywords(desc1);
  const k2 = skillKeywords(desc2);
  if (k1.length === 0 || k2.length === 0) return false;
  const common = k1.filter(w => k2.includes(w));
  const minLen = Math.min(k1.length, k2.length);
  return common.length >= minLen * 0.2;
}

/** Scan sessions using proj/sid/date/chunk structure */
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

/** Call configured LLM API */
function callAI(systemPrompt, userPrompt) {
  return new Promise((resolve) => {
    const cfg = getApiConfig();
    if (!cfg.apiKey) { resolve(null); return; }

    const body = JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt.slice(0, 400000) },
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
        timeout: 120000,
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
        output += `[USER] ${r.content || ""}\n`;
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

// ── Evidence Storage ─────────────────────────────────────────────

/** Load evidence.json, returns { patterns: [] } if missing */
function loadEvidence() {
  try {
    if (fs.existsSync(EVIDENCE_PATH)) {
      return JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"));
    }
  } catch {}
  return { patterns: [] };
}

/** Atomically write evidence.json */
function writeEvidence(data) {
  ensureDir(EVIDENCE_DIR);
  const tmp = EVIDENCE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, EVIDENCE_PATH);
}

/**
 * Merge AI-extracted patterns into existing evidence.
 * Matches by domain + rule similarity, updates hits/confidence/evidence.
 */
function mergeEvidence(existing, newPatterns) {
  for (const np of newPatterns) {
    const rule = (np.rule || "").toLowerCase();
    const domain = (np.domain || "").toLowerCase();
    const conf = np.confidence || "LOW";
    const confValue = { HIGH: 0.9, MEDIUM: 0.7, LOW: 0.4 }[conf] || 0.4;

    // Try to find existing match
    let matched = false;
    for (const ep of existing.patterns) {
      if (isSameRule(rule, ep.rule)) {
        // Update hit count
        ep.hits = (ep.hits || 0) + 1;
        ep.lastSeen = todayStr();
        if (!ep.firstSeen) ep.firstSeen = todayStr();

        // Update confidence (weighted average)
        const total = (ep.hits || 0);
        ep.avgConfidence = ((ep.avgConfidence || 0) * (total - 1) + confValue) / total;

        // Append new evidence entry
        if (np.quote) {
          const alreadyQuoted = ep.evidence.some(e => e.quote === np.quote);
          if (!alreadyQuoted) {
            ep.evidence.push({
              sessionId: np.sessionId || "",
              date: todayStr(),
              quote: np.quote.slice(0, 200),
              confidence: conf,
            });
          }
        }
        // Update description if new one is better
        if (np.rule && np.rule.length > (ep.rule || "").length) {
          ep.rule = np.rule;
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Create new evidence entry
      existing.patterns.push({
        id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        domain,
        rule: np.rule || "",
        avgConfidence: confValue,
        hits: 1,
        firstSeen: todayStr(),
        lastSeen: todayStr(),
        status: "raw",
        evidence: np.quote ? [{
          sessionId: np.sessionId || "",
          date: todayStr(),
          quote: np.quote.slice(0, 200),
          confidence: conf,
        }] : [],
      });
    }
  }
  return existing;
}

/**
 * Check which evidence patterns qualify for promotion.
 * Returns patterns where hits >= PROMOTE_MIN_HITS and avgConfidence >= PROMOTE_MIN_CONFIDENCE.
 */
function checkPromotion(evidence) {
  const promotable = [];
  for (const p of evidence.patterns) {
    if (p.status === "promoted") continue;
    if ((p.hits || 0) >= PROMOTE_MIN_HITS && (p.avgConfidence || 0) >= PROMOTE_MIN_CONFIDENCE) {
      promotable.push(p);
    }
  }
  return promotable;
}

/** Get existing promoted skill names for dedup */
function loadPromotedNames() {
  const names = new Set();
  try {
    if (fs.existsSync(SKILLS_INDEX)) {
      const content = fs.readFileSync(SKILLS_INDEX, "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^\s*-\s+\[([^\]]+)\]/);
        if (m) names.add(m[1].trim());
      }
    }
  } catch {}
  return names;
}

/** Generate SKILL.md from a promoted evidence pattern (skill-creator format) */
function promoteToSkill(pattern, existingNames) {
  const name = pattern.domain.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `skill-${Date.now()}`;
  if (name.length < 3 || existingNames.has(name)) return null;

  ensureDir(SKILLS_DIR);
  const skillPath = path.join(SKILLS_DIR, `${name}.md`);

  // Build trigger phrases from evidence quotes
  const triggers = pattern.evidence.map(e => e.quote).filter(Boolean).slice(0, 5);

  // Build evidence section
  const evidenceMd = pattern.evidence.map(e => {
    const confLabel = e.confidence === "HIGH" ? "（明确）" : e.confidence === "MEDIUM" ? "（多次）" : "（提及）";
    const dateStr = e.date && e.date.length >= 10 ? e.date.slice(0, 10) : "";
    return `- Session ${(e.sessionId || "").slice(0, 8)}${dateStr ? " (" + dateStr + ")" : ""}${confLabel}: ${e.quote}`;
  }).join("\n");

  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${pattern.rule.slice(0, 120)}。涉及${pattern.domain}相关操作时使用。`,
    `trigger: ${pattern.domain}`,
    "type: cc-trace-skill",
    `created: ${pattern.firstSeen || todayStr()}`,
    `updated: ${pattern.lastSeen || todayStr()}`,
    `evidence_hits: ${pattern.hits}`,
    `evidence_confidence: ${(pattern.avgConfidence * 100).toFixed(0)}%`,
    "---",
    "",
  ].join("\n");

  const body = [
    `# ${pattern.rule}`,
    "",
    "## 规则",
    "",
    `1. ${pattern.rule}`,
    "",
    "## 触发场景",
    "",
    ...(triggers.length > 0 ? triggers.map(t => `- ${t}`) : [`- 用户提到"${pattern.domain}"相关内容时`]),
    "",
    "## 证据来源",
    "",
    evidenceMd,
    "",
  ].join("\n");

  fs.writeFileSync(skillPath, frontmatter + body, "utf8");

  // Update SKILLS.md index
  let indexLines = [];
  try {
    if (fs.existsSync(SKILLS_INDEX)) {
      indexLines = fs.readFileSync(SKILLS_INDEX, "utf8").split("\n");
    }
  } catch {}
  const hasHeader = indexLines.some(l => l.startsWith("# Skill Index"));
  if (!hasHeader) indexLines.unshift("# Skill Index\n");
  const entry = `- [${name}] ${pattern.rule.slice(0, 80)}`;
  indexLines.push(entry);
  fs.writeFileSync(SKILLS_INDEX, indexLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", "utf8");

  return skillPath;
}

// ── AI Prompt ───────────────────────────────────────────────────

const EXTRACT_PROMPT =
  "你是一个 Claude Code 使用模式分析器。请用中文输出。\n" +
  "分析以下会话记录，提取用户的行为模式、偏好和规则。\n\n" +
  "只提取满足以下条件的模式：\n" +
  "- 用户明确纠正或要求（如'不要用X，用Y'）\n" +
  "- 用户反复做同一操作（跨 2+ session）\n" +
  "- 用户说了'记住'、'以后都用'、'always'、'never'等记忆类语言\n\n" +
  "忽略：\n" +
  "- 一次性话题（只问过一次的）\n" +
  "- 通用闲聊\n" +
  "- 与行为模式无关的对话\n\n" +
  "输出为 JSON 数组，每项包含：\n" +
  "- domain: 领域分类（如 version-management、workflow、mcp、ui-design），英文 kebab-case\n" +
  "- rule: 用户规则的一句话描述（中文）\n" +
  "- confidence: 置信度，HIGH（明确纠正/要求）、MEDIUM（反复出现）、LOW（提及过）\n" +
  "- quote: 用户原话或关键操作（中文，引用实际对话）\n" +
  "- sessionId: 该证据来自哪个 session（使用传人的 sessionId 字段）\n\n" +
  "用 ```json 和 ``` 包裹 JSON 输出。没有合格模式就输出空数组 []。";

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isBootstrap = args.includes("--bootstrap");

  try {
    const LAST_ANALYZE = path.join(TRACE_DIR, "last-analyze.txt");
    const now = new Date().toISOString();

    // ── Bootstrap mode: full analysis → evidence.json ──────────
    if (isBootstrap) {
      console.error("[cc-trace] Bootstrap: analyzing all sessions for evidence...");
      const allSessions = scanAllSessions();
      if (allSessions.length === 0) { console.error("[cc-trace] No sessions found"); return; }

      // Process in batches
      for (let i = 0; i < allSessions.length; i += MAX_SESSIONS_FOR_ANALYSIS) {
        const batch = allSessions.slice(i, i + MAX_SESSIONS_FOR_ANALYSIS);
        const sessionSummary = buildSessionSummary(batch);

        // Build user prompt with session IDs for each session
        let analysis = null;
        for (let retry = 0; retry < 3; retry++) {
          if (retry > 0) await new Promise(r => setTimeout(r, 2000));
          analysis = await callAI(EXTRACT_PROMPT, sessionSummary);
          if (analysis && analysis.trim()) break;
        }
        if (!analysis || analysis.trim() === "") continue;

        // Parse AI output
        let patterns = parseAIResult(analysis);
        if (!patterns || patterns.length === 0) continue;

        // Attach sessionIds
        patterns.forEach(p => {
          if (!p.sessionId && batch.length > 0) p.sessionId = batch[0].sessionId;
        });

        // Merge into evidence
        let evidence = loadEvidence();
        evidence = mergeEvidence(evidence, patterns);
        writeEvidence(evidence);
        console.error(`[cc-trace] Bootstrap batch ${i + 1}-${Math.min(i + MAX_SESSIONS_FOR_ANALYSIS, allSessions.length)}: ${patterns.length} patterns extracted`);
      }

      const total = loadEvidence().patterns.length;
      console.error(`[cc-trace] Bootstrap complete: ${total} patterns in evidence.json`);
      try { fs.writeFileSync(LAST_ANALYZE, now, "utf8"); } catch {}
      return;
    }

    // ── Incremental mode ──────────────────────────────────────

    // Skip if last run was < 5 min ago
    try {
      if (fs.existsSync(LAST_ANALYZE)) {
        const elapsed = Date.now() - new Date(fs.readFileSync(LAST_ANALYZE, "utf8").trim()).getTime();
        if (elapsed < 300000) return;
      }
    } catch {}

    // Scan sessions
    const allSessions = scanAllSessions();
    if (allSessions.length === 0) return;

    // Check for new activity
    try {
      if (fs.existsSync(LAST_ANALYZE)) {
        const lastRun = fs.readFileSync(LAST_ANALYZE, "utf8").trim();
        const hasNew = allSessions.some(s => {
          const last = s.records[s.records.length - 1];
          return last && last.ts && last.ts > lastRun;
        });
        if (!hasNew) return;
      }
    } catch {}

    // Only analyze sessions with new activity
    let newSessions = allSessions;
    try {
      if (fs.existsSync(LAST_ANALYZE)) {
        const lastRun = fs.readFileSync(LAST_ANALYZE, "utf8").trim();
        newSessions = allSessions.filter(s => {
          const last = s.records[s.records.length - 1];
          return last && last.ts && last.ts > lastRun;
        }).slice(0, 3);
      }
    } catch {}
    if (newSessions.length === 0) return;

    const sessionSummary = buildSessionSummary(newSessions);

    // Call AI to extract evidence
    let analysis = null;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) await new Promise(r => setTimeout(r, 2000));
      analysis = await callAI(EXTRACT_PROMPT, sessionSummary);
      if (analysis && analysis.trim()) break;
    }
    if (!analysis || analysis.trim() === "") return;

    // Parse AI output
    const patterns = parseAIResult(analysis);
    if (!patterns || patterns.length === 0) return;

    // Attach sessionIds from the sessions we analyzed
    const sessionMap = {};
    newSessions.forEach(s => { sessionMap[s.date + s.sessionId] = s.sessionId; });
    patterns.forEach(p => {
      if (!p.sessionId && newSessions.length > 0) p.sessionId = newSessions[0].sessionId;
    });

    // Merge into evidence
    let evidence = loadEvidence();
    const beforeCount = evidence.patterns.length;
    evidence = mergeEvidence(evidence, patterns);
    const newCount = evidence.patterns.length;
    writeEvidence(evidence);

    console.error(`[cc-trace] Evidence: ${newCount} patterns (${newCount - beforeCount} new)`);

    // Check promotion
    const promotable = checkPromotion(evidence);
    const existingNames = loadPromotedNames();
    let promotedCount = 0;

    for (const p of promotable) {
      // Group by domain for better naming
      const result = promoteToSkill(p, existingNames);
      if (result) {
        p.status = "promoted";
        existingNames.add(p.domain.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""));
        promotedCount++;
        console.error(`[cc-trace] Skill promoted: ${p.domain} — ${p.rule.slice(0, 60)}`);
      }
    }

    // Save updated status
    if (promotedCount > 0) {
      writeEvidence(evidence);
    }

    console.error(`[cc-trace] Done: ${patterns.length} patterns, ${promotedCount} promoted`);
    try { fs.writeFileSync(LAST_ANALYZE, now, "utf8"); } catch {}
  } catch (e) {
    // Silent failure — always exit 0
  }
}

/** Parse AI JSON output */
function parseAIResult(analysis) {
  try {
    let clean = analysis.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
    let parsed = null;

    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { parsed = JSON.parse(arrayMatch[0]); } catch {}
    }
    if (!parsed) {
      const objMatch = clean.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { parsed = [JSON.parse(objMatch[0])]; } catch {}
      }
    }

    if (!Array.isArray(parsed)) return null;
    // Filter out entries without required fields
    return parsed.filter(p => p.rule && p.rule.trim().length > 3);
  } catch {
    return null;
  }
}

main().catch(() => process.exit(0));
