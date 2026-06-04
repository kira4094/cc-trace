#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const MEMORY_DIR = path.join(os.homedir(), ".claude-memory");
const PIDFILE = path.join(MEMORY_DIR, "server.pid");
const VERSION_FILE = path.join(MEMORY_DIR, "server.version");
const INSTALLED_VERSION = path.join(__dirname, "..", "version.json");

function listeningPID() {
  try {
    const out = execSync(
      `netstat -ano | findstr ":13779 " | findstr LISTENING`,
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    for (const line of out.split("\n").filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) return pid;
    }
  } catch {}
  return null;
}

// Read installed version
let installedVer = "";
try { installedVer = JSON.parse(fs.readFileSync(INSTALLED_VERSION, "utf8")).full || ""; } catch {}

const runningPid = listeningPID();

if (runningPid) {
  // Read running server's version
  let runningVer = "";
  try { runningVer = fs.readFileSync(VERSION_FILE, "utf8").trim(); } catch {}

  if (runningVer === installedVer) {
    // Version matches — keep existing server
    try { fs.writeFileSync(PIDFILE, runningPid); } catch {}
    process.exit(0);
  }

  // Version mismatch — kill old server
  try {
    execSync(`taskkill /F /PID ${runningPid}`, { stdio: "ignore", timeout: 3000 });
  } catch {}
  // Wait briefly for port to be free
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!listeningPID()) break;
    execSync("ping -n 2 127.0.0.1 >nul", { stdio: "ignore" });
  }
}

// Spawn new server
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  detached: true, stdio: "ignore", windowsHide: true,
});
server.unref();
try {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(PIDFILE, String(server.pid));
} catch {}
