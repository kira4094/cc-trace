#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");
const PORT = 13779;
const LOGFILE = path.join(os.homedir(), ".claude-memory", "server-error.log");

function getListeningPID() {
  try {
    const out = require("child_process").execSync(
      `netstat -ano | findstr ":${PORT} " | findstr LISTENING`,
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    const lines = out.split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) return pid;
    }
  } catch {}
  return null;
}

function main() {
  // If port already listening, server is running — update PID and exit
  const existing = getListeningPID();
  if (existing) {
    try { fs.writeFileSync(PIDFILE, existing); } catch {}
    return;
  }

  // Use cmd /c start /B on Windows to break out of job object
  // This is the only reliable way to create an independent process on Windows
  const cmd = `start /B "" "${process.execPath}" "${path.join(__dirname, "server.js")}" >> "${LOGFILE}" 2>&1`;
  exec(cmd, { shell: "cmd.exe", windowsHide: true }, () => {
    // After spawn, wait a moment and update PID
    setTimeout(() => {
      const pid = getListeningPID();
      if (pid) {
        try { fs.writeFileSync(PIDFILE, pid); } catch {}
      }
    }, 2000);
  });
}

main();
