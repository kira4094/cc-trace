#!/usr/bin/env node
/**
 * cc-trace server-launcher.cjs
 * Setup hook: ensures the Web UI HTTP server is running on port 13779.
 *
 * Checks PID file; if dead, spawns server.js as a detached background process,
 * waits up to 2s for the port to be reachable, then writes PID + URL files.
 *
 * Zero npm dependencies. Node.js 18+ required. Never crashes, always exits 0.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const net = require("net");

// ── Paths ───────────────────────────────────────────────────────────

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, ".claude-memory");
const SERVER_JS = path.join(__dirname, "server.js");
const PIDFILE = path.join(TRACE_DIR, "server.pid");
const URLFILE = path.join(TRACE_DIR, "server.url");
const PORT = 13779;
const URL = `http://localhost:${PORT}`;
const WAIT_MS = 2000;
const VERSION_DST = path.join(TRACE_DIR, "version.json");

// ── Helpers ─────────────────────────────────────────────────────────

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid) {
  try {
    if (process.platform === "win32") {
      // On Windows, use `tasklist /FI "PID eq <pid>"` and check output
      const cp = require("child_process");
      const result = cp.execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // tasklist returns info line if the PID exists
      return result.includes(String(pid));
    }
    // Unix: kill -0 sends no signal but checks process existence
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

/** Check if a TCP port is reachable (returns true/false). */
function checkPort(port, host) {
  return new Promise((resolve) => {
    const client = net.createConnection({ port, host: host || "127.0.0.1", timeout: 1000 }, () => {
      client.end();
      resolve(true);
    });
    client.on("error", () => resolve(false));
    client.on("timeout", () => {
      client.destroy();
      resolve(false);
    });
  });
}

/** Ensure directory exists (no-op if exists). */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * Sync latest server.js + version.json from the plugin cache
 * to TRACE_DIR scripts. This ensures /plugin update takes effect.
 */
function syncFiles() {
  const SCRIPTS_DST = path.join(TRACE_DIR, "scripts");
  const VERSION_SRC = path.join(__dirname, "..", "version.json");

  try {
    ensureDir(SCRIPTS_DST);
    if (!__dirname.startsWith(TRACE_DIR)) {
      if (fs.existsSync(SERVER_JS)) {
        fs.copyFileSync(SERVER_JS, path.join(SCRIPTS_DST, "server.js"));
      }
      const selfSrc = __filename;
      const selfDst = path.join(SCRIPTS_DST, "server-launcher.cjs");
      if (fs.existsSync(selfSrc)) {
        fs.copyFileSync(selfSrc, selfDst);
      }
      if (fs.existsSync(VERSION_SRC)) {
        fs.copyFileSync(VERSION_SRC, VERSION_DST);
      }
    }
  } catch {}
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  // 0. Sync latest files from plugin cache (makes /plugin update effective)
  syncFiles();

  // 1. Check PID file and version match
  if (fs.existsSync(PIDFILE)) {
    try {
      const pidStr = fs.readFileSync(PIDFILE, "utf8").trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && isProcessAlive(pid)) {
        // Check if running version matches installed version
        let versionMatch = false;
        try {
          const installedVer = JSON.parse(fs.readFileSync(VERSION_DST, "utf8")).full || "";
          const status = await new Promise((resolve) => {
            const http = require("http");
            http.get(URL + "/api/status", (r) => {
              let d = "";
              r.on("data", (c) => d += c);
              r.on("end", () => { try { resolve(JSON.parse(d).version); } catch { resolve(""); } });
            }).on("error", () => resolve(""));
          });
          versionMatch = status === installedVer;
        } catch {}

        if (versionMatch) {
          // Already running with matching version — write URL file and exit
          ensureDir(TRACE_DIR);
          try { fs.writeFileSync(URLFILE, URL, "utf8"); } catch {}
          process.exit(0);
        }

        // Version mismatch: kill old server
        try {
          if (process.platform === "win32") {
            require("child_process").execSync(`taskkill /F /PID ${pid}`, {
              stdio: "ignore", timeout: 3000,
            });
          } else {
            process.kill(pid, "SIGTERM");
          }
        } catch {}
        // Fall through to spawn new server
      }
    } catch {
      // Stale PID file, continue to launch
    }
  }

  // 2. Verify server.js exists
  if (!fs.existsSync(SERVER_JS)) {
    process.exit(0);
  }

  // 3. Spawn server.js as a detached background process
  ensureDir(TRACE_DIR);

  const serverProcess = spawn(process.execPath, [SERVER_JS, "--port", String(PORT)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  serverProcess.unref();

  // 4. Wait up to WAIT_MS for the port to become reachable
  const pollInterval = 200;
  const maxTries = Math.ceil(WAIT_MS / pollInterval);
  let ready = false;

  for (let i = 0; i < maxTries; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    ready = await checkPort(PORT);
    if (ready) break;
  }

  // 5. Write PID and URL files (even if port check failed — PID is still useful for diagnostics)
  try {
    fs.writeFileSync(PIDFILE, String(serverProcess.pid), "utf8");
  } catch {
    // best effort
  }

  try {
    fs.writeFileSync(URLFILE, URL, "utf8");
  } catch {
    // best effort
  }
}

main().catch(() => {
  process.exit(0);
});
