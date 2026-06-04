#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const net = require("net");

const PIDFILE = path.join(os.homedir(), ".claude-memory", "server.pid");
const PORT = 13779;

function portListening(port) {
  return new Promise((resolve) => {
    const c = net.createConnection({ port, host: "127.0.0.1", timeout: 500 }, () => { c.end(); resolve(true); });
    c.on("error", () => resolve(false));
    c.on("timeout", () => { c.destroy(); resolve(false); });
  });
}

async function main() {
  // If port already listening, server is running — update PID and exit
  if (await portListening(PORT)) {
    try {
      const p = require("child_process").execSync(`netstat -ano | findstr ":${PORT} " | findstr LISTENING`, { encoding: "utf8", timeout: 3000 }).trim().split(/\s+/).pop();
      if (p) fs.writeFileSync(PIDFILE, p);
    } catch {}
    return;
  }

  // Spawn server
  const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  server.unref();

  // Wait up to 3s for port
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portListening(PORT)) {
      try { fs.writeFileSync(PIDFILE, String(server.pid)); } catch {}
      return;
    }
  }

  // First attempt failed — try once more
  const server2 = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  server2.unref();
  await new Promise((r) => setTimeout(r, 2000));
  if (await portListening(PORT)) {
    try { fs.writeFileSync(PIDFILE, String(server2.pid)); } catch {}
  }
}

main();
