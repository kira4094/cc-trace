#!/usr/bin/env node
const http = require("http");
const G = "\x1b[32m";
const R = "\x1b[31m";
const W = "\x1b[38;2;255;255;255m";
const N = "\x1b[0m";

function link(url, text) {
  return "\x1b]8;;" + url + "\x1b\\" + text + "\x1b]8;;\x1b\\";
}

function httpGet(host, port, path) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: host, port, path, timeout: 2000 }, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  try {
    const raw = await httpGet("localhost", 13779, "/api/sessions");
    if (!raw) throw new Error("no response");
    const projects = JSON.parse(raw);
    let totalSessions = 0;
    for (const p of projects) totalSessions += p.sessions.length;
    const tag = G + "ON" + N;
    const parts = [
      "[" + W + "trace" + N + "[" + tag + "]]",
      projects.length + "proj",
      totalSessions + "ses",
      link("http://localhost:13779", "http://localhost:13779"),
    ];
    process.stdout.write(parts.join(" | "));
  } catch {
    process.stdout.write("[" + W + "trace" + N + "[" + R + "OFF" + N + "]]");
  }
}
main();
