#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const STATUSLINE_PATH = path.join(__dirname, "statusline.cjs");
const CMD = `node "${STATUSLINE_PATH}"`;

try {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const current = settings.statusLine?.command || "";
  if (!current.includes("cc-trace") && !current.includes(STATUSLINE_PATH)) {
    settings.statusLine = { type: "command", command: CMD };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  }
} catch {}
