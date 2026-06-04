#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");
const LOGFILE = path.join(os.homedir(), ".claude-memory", "server-error.log");

function getListeningPid() {
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

// If port already listening, update PID and exit
const existingPid = getListeningPid();
if (existingPid) {
  fs.writeFileSync(PIDFILE, existingPid);
  process.exit(0);
}

// Use WMI to create process completely independent of job object
// Win32_Process.Create spawns under WMI host, not as child of this process
const nodeExe = process.execPath.replace(/\\/g, "\\\\");
const serverJs = path.join(__dirname, "server.js").replace(/\\/g, "\\\\");
const logFile = LOGFILE.replace(/\\/g, "\\\\");
const cmdLine = `"${process.execPath}" "${path.join(__dirname, "server.js")}"`;

try {
  execSync(
    `powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${cmdLine}'}" 2>$null`,
    { timeout: 10000, stdio: "ignore" }
  );
} catch {
  // Fallback: try WMI legacy method
  try {
    execSync(
      `powershell -NoProfile -Command "Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList '${cmdLine}'" 2>$null`,
      { timeout: 10000, stdio: "ignore" }
    );
  } catch {}
}

// Poll for PID
const start = Date.now();
while (Date.now() - start < 5000) {
  const pid = getListeningPid();
  if (pid) {
    fs.writeFileSync(PIDFILE, pid);
    process.exit(0);
  }
  execSync("ping -n 2 127.0.0.1 >nul", { stdio: "ignore" });
}
