#!/usr/bin/env node
/**
 * cc-trace statusline.
 * Polls cc-trace Web UI API, outputs status.
 * Chainable via cc-statusline.
 */
const http = require("http");

const G = "\x1b[32m";  // green
const R = "\x1b[31m";  // red
const N = "\x1b[0m";   // reset

// OSC 8 terminal hyperlink
function link(url, text) {
  return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07";
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
    const raw = await httpGet("localhost", 13779, "/api/status");
    if (!raw) throw new Error("no response");

    const s = JSON.parse(raw);

    const tag = "[" + G + "ON" + N + "]";
    const parts = [
      "[trace" + tag + "]",
      "session:" + s.sessionCount,
      "memory:" + s.memoryCount,
      link("http://localhost:13779", "WEB"),
    ];

    process.stdout.write(parts.join(" | "));
  } catch {
    // Server not running
    process.stdout.write("[trace[" + R + "OFF" + N + "]]");
  }
}

main();
