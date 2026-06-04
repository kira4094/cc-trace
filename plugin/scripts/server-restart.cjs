#!/usr/bin/env node
/**
 * cc-trace server-restart.cjs
 * Kills the current HTTP server and immediately starts a new one.
 * Uses the same server.js from the plugin cache directory.
 *
 * Usage: node server-restart.cjs
 * Zero npm dependencies. Never crashes, always exits 0.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");
const SERVER_JS = path.join(__dirname, "server.js");

function isPortInUse(port) {
  try {
    const out = execSync(`netstat -ano|findstr :${port}|findstr LISTENING`, {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "ignore"],
      shell: "cmd.exe"
    });
    return out.trim().length > 0;
  } catch { return false; }
}

// Kill existing
try {
  if (fs.existsSync(PIDFILE)) {
    const pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", timeout: 3000, shell: "cmd.exe" }); } catch {}
    }
    try { fs.unlinkSync(PIDFILE); } catch {}
  }
} catch {}

// Wait for port to be free
for (let i = 0; i < 10; i++) {
  if (!isPortInUse(13779)) break;
  require("timers").setTimeout(() => {}, 200);
}

// Start new server
try {
  if (fs.existsSync(SERVER_JS)) {
    const p = spawn(process.execPath, [SERVER_JS, "--port", "13779"], {
      detached: true, stdio: "ignore", windowsHide: true,
    });
    p.unref();
    try { fs.writeFileSync(PIDFILE, String(p.pid), "utf8"); } catch {}
    console.log("[cc-trace] Server restarted");
  }
} catch {}
