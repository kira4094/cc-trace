#!/usr/bin/env node
/**
 * cc-trace server-restart.cjs
 * Kills the current HTTP server. The server-launcher will auto-restart
 * on the next UserPromptSubmit or SessionStart hook.
 *
 * Usage: node server-restart.cjs
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
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", timeout: 3000 });
      } else {
        process.kill(pid, "SIGTERM");
      }
    }
    fs.unlinkSync(PIDFILE);
    console.log("[cc-trace] Server killed. Will auto-restart on next hook.");
  } else {
    console.log("[cc-trace] No server PID file found.");
  }
} catch {
  // Best effort
}
