#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");

// If port 13779 is already listening, update PID and exit
try {
  const out = require("child_process").execSync(
    `netstat -ano | findstr ":13779 " | findstr LISTENING`,
    { encoding: "utf8", timeout: 3000 }
  ).trim();
  for (const line of out.split("\n").filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      try { fs.writeFileSync(PIDFILE, pid); } catch {}
      return;
    }
  }
} catch {}

// Spawn server with stdout/err discarded
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  detached: true, stdio: "ignore", windowsHide: true,
});
server.unref();

// Write PID immediately
try {
  const d = path.dirname(PIDFILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(PIDFILE, String(server.pid));
} catch {}
