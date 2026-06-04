#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");

// Check if already running
try {
  if (fs.existsSync(PIDFILE)) {
    const pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        if (process.platform === "win32") {
          const r = require("child_process").execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
          if (r.includes(String(pid))) process.exit(0); // already running
        } else { process.kill(pid, 0); process.exit(0); }
      } catch {}
    }
  }
} catch {}

// Spawn detached server
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  detached: true, stdio: "ignore", windowsHide: true,
});
server.unref();

// Write PID for shutdown
try {
  const d = path.dirname(PIDFILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(PIDFILE, String(server.pid));
} catch {}
