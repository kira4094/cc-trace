#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");

// Always try to spawn. If port is in use, server.js silently exits (EADDRINUSE).
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  detached: true, stdio: "ignore", windowsHide: true,
});
server.unref();

// Write PID for shutdown hook (overwrites stale PID)
try {
  const d = path.dirname(PIDFILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(PIDFILE, String(server.pid));
} catch {}
