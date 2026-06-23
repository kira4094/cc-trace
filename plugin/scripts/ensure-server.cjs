#!/usr/bin/env node
/**
 * ensure-server.cjs
 * Setup hook: ensures cc-trace HTTP server is running.
 * Runs once per Claude Code launch (not per MCP session).
 * Zero npm dependencies. Silent exit 0.
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

http.get("http://localhost:13779/api/status", () => {
  // Server already running — nothing to do
}).on("error", () => {
  // No server — spawn one (detached, survives MCP process)
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  child.unref();
});
