#!/usr/bin/env node
/**
 * cc-trace server-shutdown.cjs
 * Stop hook: kills the background HTTP server if it's running.
 * Reads PID from ~/.claude-memory/server.pid, sends kill, cleans up.
 * Zero npm dependencies. Never crashes, always exits 0.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");

try {
  if (fs.existsSync(PIDFILE)) {
    const pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        if (process.platform === "win32") {
          execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
            stdio: "ignore", timeout: 2000,
          });
          execSync(`taskkill /F /PID ${pid}`, {
            stdio: "ignore", timeout: 3000,
          });
        } else {
          process.kill(pid, "SIGTERM");
        }
      } catch {}
    }
    // Clean up PID file regardless
    try { fs.unlinkSync(PIDFILE); } catch {}
  }
} catch {}
