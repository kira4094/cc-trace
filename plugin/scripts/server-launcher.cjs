#!/usr/bin/env node
/**
 * Launches server.js independent of Windows job objects.
 * Uses cmd /c start /B to truly detach from parent process tree.
 * Also writes PID file for clean shutdown via Stop hook.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");
const LOGFILE = path.join(os.homedir(), ".claude-memory", "server-error.log");

// If port already listening, update PID and exit
try {
  const out = execSync(
    `netstat -ano | findstr ":13779 " | findstr LISTENING`,
    { encoding: "utf8", timeout: 3000 }
  ).trim();
  for (const line of out.split("\n").filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      fs.writeFileSync(PIDFILE, pid);
      return;
    }
  }
} catch {}

// Escape Windows job object via cmd /c start /B
const cmd = `start /B "" "${process.execPath}" "${path.join(__dirname, "server.js")}" >> "${LOGFILE}" 2>&1`;
execSync(cmd, { shell: "cmd.exe", windowsHide: true, timeout: 5000 });

// Wait briefly then capture PID
setTimeout(() => {
  try {
    const out = execSync(
      `netstat -ano | findstr ":13779 " | findstr LISTENING`,
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    for (const line of out.split("\n").filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        fs.writeFileSync(PIDFILE, pid);
        return;
      }
    }
  } catch {}
}, 2000);
