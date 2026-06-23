#!/usr/bin/env node
const { spawn, execSync } = require("child_process");
const path = require("path");

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

if (listeningPID()) process.exit(0); // Already running

// Use start without /B to escape Windows Job Object
spawn("cmd.exe", ["/c", "start", "/MIN", "", "node", path.join(__dirname, "server.js")], {
  detached: true, stdio: "ignore",
}).unref();
