#!/usr/bin/env node
/**
 * cc-trace server.js
 * Zero-dependency HTTP server for the cc-trace Web UI and REST API.
 *
 * Usage:
 *   node server.js                    # Port 13779 (default)
 *   node server.js --port 8080
 *   node server.js --port=8080
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

// ── Paths ───────────────────────────────────────────────────────────────

const TRACE_DIR = path.join(os.homedir(), ".claude-memory");
const SESSIONS_DIR = path.join(TRACE_DIR, "sessions");
const MEMORY_DIR = path.join(TRACE_DIR, "memory");
const MEMORY_INDEX = path.join(MEMORY_DIR, "MEMORY.md");
const UI_DIR = path.resolve(__dirname, "..", "ui");
const SCRIPTS_DIR = __dirname;
const SEARCH_CJS = path.join(SCRIPTS_DIR, "search.cjs");

// ── MIME Types ──────────────────────────────────────────────────────────

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SERVER_START = Date.now();
const VERSION = "0.1.0";

// ── Helpers ─────────────────────────────────────────────────────────────

function sendJSON(res, data, statusCode) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode || 200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, message, statusCode) {
  sendJSON(res, { error: message }, statusCode || 500);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendNotFound(res) {
  sendError(res, "Not found", 404);
}

function setCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeReadDir(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function safeReadFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function isDirectory(p) {
  const s = safeStat(p);
  return s !== null && s.isDirectory();
}

/**
 * Scan sessions directory and return summary grouped by project.
 * Structure: SESSIONS_DIR/<project>/<sessionId>/<date>/chunk-NNN.jsonl
 */
function getSessionGroups() {
  const groups = [];
  const projects = safeReadDir(SESSIONS_DIR).sort();

  for (const proj of projects) {
    const projDir = path.join(SESSIONS_DIR, proj);
    if (!isDirectory(projDir)) continue;

    const sessions = [];
    const sessionIds = safeReadDir(projDir).sort();
    for (const sid of sessionIds) {
      const sidDir = path.join(projDir, sid);
      if (!isDirectory(sidDir)) continue;

      // Scan dates within this session
      const dates = safeReadDir(sidDir).sort();
      let workspace = null;
      let title = sid.slice(0, 20);

      for (const date of dates) {
        const dateDir = path.join(sidDir, date);
        if (!isDirectory(dateDir)) continue;

        let recordCount = 0;
        const chunkFiles = safeReadDir(dateDir)
          .filter((f) => f.startsWith("chunk-") && f.endsWith(".jsonl"))
          .sort();

        for (const chunk of chunkFiles) {
          const content = safeReadFile(path.join(dateDir, chunk));
          recordCount += content.trim().split("\n").filter(Boolean).length;
        }

        // Read meta from first date dir
        if (!workspace) {
          try {
            const metaRaw = safeReadFile(path.join(dateDir, 'meta.json'));
            if (metaRaw) {
              const m = JSON.parse(metaRaw);
              if (m.title) title = m.title;
              if (m.cwd) workspace = m.cwd;
            }
          } catch {}
        }

        if (recordCount > 0) {
          sessions.push({ sessionId: sid, title, recordCount, date, workspace });
        }
      }
    }

    if (sessions.length > 0) {
      groups.push({ project: proj, sessions });
    }
  }

  return groups;
}

/**
 * Read all records for a specific session across ALL projects.
 * Path: SESSIONS_DIR/<project>/<sessionId>/<date>/chunk-NNN.jsonl
 */
function getSessionRecords(project, sessionId, filterDate) {
  const records = [];
  let foundProject = project || '';
  const projects = safeReadDir(SESSIONS_DIR);

  for (const proj of projects) {
    const sidDir = path.join(SESSIONS_DIR, proj, sessionId);
    if (!isDirectory(sidDir)) continue;
    if (!foundProject) foundProject = proj;

    const dates = safeReadDir(sidDir).sort();
    for (const date of dates) {
      if (filterDate && date !== filterDate) continue;
      const dateDir = path.join(sidDir, date);
      if (!isDirectory(dateDir)) continue;

      const chunkFiles = safeReadDir(dateDir)
        .filter((f) => f.startsWith("chunk-") && f.endsWith(".jsonl"))
        .sort();

      for (const chunk of chunkFiles) {
        const content = safeReadFile(path.join(dateDir, chunk));
        for (const line of content.trim().split("\n").filter(Boolean)) {
          try { records.push(JSON.parse(line)); } catch {}
        }
      }
    }
  }

  if (records.length === 0) return null;

  records.sort((a, b) => {
    const ta = a.ts || a.timestamp || "";
    const tb = b.ts || b.timestamp || "";
    return tb.localeCompare(ta);
  });

  return {
    sessionId,
    project: foundProject,
    total: records.length,
    records,
  };
}

/**
 * Parse MEMORY.md and return list entries.
 */
function getMemoryIndex() {
  const content = safeReadFile(MEMORY_INDEX);
  if (!content) return [];

  const entries = [];
  const lines = content.split("\n");
  for (const line of lines) {
    // Match markdown list items: - text or * text
    const match = line.match(/^\s*[-*]\s+(.+)/);
    if (match) {
      entries.push({ text: match[1].trim() });
    }
  }
  return entries;
}

/**
 * Compute server status.
 */
function getStatus() {
  const sessionGroups = getSessionGroups();
  let sessionCount = 0;
  for (const g of sessionGroups) {
    sessionCount += g.sessions.length;
  }
  const memoryEntries = getMemoryIndex();

  return {
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    sessionCount,
    memoryCount: memoryEntries.length,
    version: VERSION,
    startedAt: new Date(SERVER_START).toISOString(),
  };
}

/**
 * Run search.cjs with the given query and return parsed JSON result.
 */
function runSearch(query) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [SEARCH_CJS, query],
      {
        cwd: SCRIPTS_DIR,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ error: err.message, stderr: stderr || "" });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          // search.cjs can output both the array wrapper or top-level object
          // If it has a 'keyword' key it's the dual output, otherwise might be raw array
          resolve(parsed);
        } catch {
          // If not valid JSON, return raw text
          resolve({ raw: stdout.trim() });
        }
      }
    );
  });
}

// ── Static file serving ─────────────────────────────────────────────────

function serveStaticFile(res, urlPath) {
  // Prevent directory traversal
  const normalized = path.normalize(urlPath).replace(/^[/\\]+/, "");
  const filePath = path.resolve(UI_DIR, normalized);

  if (!filePath.startsWith(UI_DIR)) {
    sendError(res, "Forbidden", 403);
    return;
  }

  // If path maps to a directory, serve index.html
  let targetPath = filePath;
  if (isDirectory(targetPath)) {
    targetPath = path.join(targetPath, "index.html");
  }

  const stat = safeStat(targetPath);
  if (!stat || !stat.isFile()) {
    sendNotFound(res);
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  const stream = fs.createReadStream(targetPath);
  stream.on("error", () => {
    sendError(res, "Internal server error", 500);
  });
  stream.on("open", () => {
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": stat.size,
    });
    stream.pipe(res);
  });
}

// ── Route dispatcher ────────────────────────────────────────────────────

async function handleRequest(req, res) {
  try {
    setCORSHeaders(res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Accept GET or POST with form data
    if (req.method !== "GET" && req.method !== "POST") {
      sendError(res, "Method not allowed", 405);
      return;
    }

    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      sendError(res, "Invalid URL", 400);
      return;
    }

    const pathname = url.pathname;
    const queryParams = url.searchParams;

    // ── API Routes ────────────────────────────────────────────────────

    // GET /api/sessions
    if (pathname === "/api/sessions") {
      try {
        const groups = getSessionGroups();
        sendJSON(res, groups);
        return;
      } catch (err) {
        sendError(res, "Failed to list sessions: " + err.message);
        return;
      }
    }

    // GET /api/sessions/:project/:sessionId
    const sessionDetailMatch = pathname.match(
      /^\/api\/sessions\/([^/]+)\/([^/]+)$/
    );
    if (sessionDetailMatch) {
      try {
        const [, project, sessionId] = sessionDetailMatch;
        const filterDate = queryParams.get("date") || "";
        const result = getSessionRecords(project, sessionId, filterDate);
        if (!result) {
          sendError(res, "Session not found", 404);
          return;
        }
        sendJSON(res, result);
        return;
      } catch (err) {
        sendError(res, "Failed to get session: " + err.message);
        return;
      }
    }

    // GET /api/memory
    if (pathname === "/api/memory") {
      try {
        const entries = getMemoryIndex();
        sendJSON(res, entries);
        return;
      } catch (err) {
        sendError(res, "Failed to read memory index: " + err.message);
        return;
      }
    }

    // GET /api/search?q=xxx
    if (pathname === "/api/search") {
      const query = (queryParams.get("q") || "").trim();
      if (!query) {
        sendError(res, "Query parameter 'q' is required", 400);
        return;
      }
      try {
        const results = await runSearch(query);
        sendJSON(res, results);
        return;
      } catch (err) {
        sendError(res, "Search failed: " + err.message);
        return;
      }
    }

    // GET /api/current-session
    if (pathname === "/api/current-session") {
      try {
        const cs = safeReadFile(path.join(TRACE_DIR, 'current-session')).trim();
        sendJSON(res, cs ? { sessionId: cs } : { sessionId: null });
        return;
      } catch {
        sendJSON(res, { sessionId: null });
        return;
      }
    }

    // GET /api/status
    if (pathname === "/api/status") {
      try {
        const status = getStatus();
        sendJSON(res, status);
        return;
      } catch (err) {
        sendError(res, "Failed to get status: " + err.message);
        return;
      }
    }

    // ── Special Routes ────────────────────────────────────────────────

    // GET /mem — redirect to SPA hash route
    if (pathname === "/mem") {
      sendRedirect(res, "/#/mem");
      return;
    }

    // GET / — serve the Web UI
    if (pathname === "/") {
      try {
        serveStaticFile(res, "/");
        return;
      } catch (err) {
        sendError(res, "Failed to serve index: " + err.message);
        return;
      }
    }

    // ── Static files ──────────────────────────────────────────────────
    try {
      serveStaticFile(res, pathname);
    } catch (err) {
      sendError(res, "Failed to serve file: " + err.message);
    }
  } catch (err) {
    // Global catch-all — never crash
    try {
      sendError(res, "Internal server error", 500);
    } catch {
      // If even sending the error fails, just close the connection
      res.destroy();
    }
  }
}

// ── Server startup ──────────────────────────────────────────────────────

function start(port) {
  const server = http.createServer(handleRequest);

  server.on("error", (err) => {
    console.error("[cc-trace] Server error:", err.message);
  });

  server.listen(port, () => {
    console.log(`[cc-trace] Web UI running at http://localhost:${port}`);
  });

  return server;
}

// ── Self-start ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  let port = 13779;

  const portArgIndex = args.indexOf("--port");
  if (portArgIndex !== -1 && portArgIndex + 1 < args.length) {
    port = parseInt(args[portArgIndex + 1], 10);
  }

  const portEq = args.find((a) => a.startsWith("--port="));
  if (portEq) {
    port = parseInt(portEq.split("=")[1], 10);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    port = 13779;
  }

  // Global error handler — never crash
  process.on("uncaughtException", (err) => {
    console.error("[cc-trace] Uncaught exception:", err.message);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[cc-trace] Unhandled rejection:", reason);
  });

  start(port);
}

module.exports = { start };
