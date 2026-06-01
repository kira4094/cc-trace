#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, '.claude-memory');
const SCRIPTS_DST = path.join(TRACE_DIR, 'scripts');
const UI_DST = path.join(TRACE_DIR, 'ui');
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const CLAUDE_MD = path.join(HOME, '.claude', 'CLAUDE.md');
const SCRIPTS_SRC = path.join(__dirname, 'scripts');
const UI_SRC = path.join(__dirname, 'ui');

function log(m) { console.log('[cc-trace]', m); }
function warn(m) { console.error('[cc-trace]', m); }

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isFile()) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

function hookEntry(script, async, timeout) {
  const e = { type: 'command', command: `node ${path.join(SCRIPTS_DST, script)}` };
  if (async) e.async = true;
  if (timeout) e.timeout = timeout;
  return e;
}

function cmdInstall() {
  fs.mkdirSync(TRACE_DIR, { recursive: true });

  // 1. Copy scripts + UI
  const n = copyDir(SCRIPTS_SRC, SCRIPTS_DST) + copyDir(UI_SRC, UI_DST);
  log(`Copied ${n} files`);

  // 2. Write hooks to settings.json
  let s = readJSON(SETTINGS) || {};
  if (!s.hooks) s.hooks = {};
  const B = path.join(HOME, '.claude-memory', 'scripts').replace(/\\/g, '/');
  s.hooks = {
    Setup: [{ matcher: '', hooks: [{ type: 'command', command: `node ${B}/server-launcher.cjs`, async: true, timeout: 10 }] }],
    SessionStart: [{ matcher: '', hooks: [
      { type: 'command', command: `node ${B}/server-launcher.cjs`, async: true, timeout: 10 },
      { type: 'command', command: `node ${B}/inject.cjs`, async: true, timeout: 10 }
    ] }],
    UserPromptSubmit: [{ hooks: [
      { type: 'command', command: `node ${B}/server-launcher.cjs`, timeout: 10 },
      { type: 'command', command: `node ${B}/capture.cjs`, timeout: 10 }
    ] }],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${B}/capture.cjs`, timeout: 10 }] }],
    Stop: [{ hooks: [{ type: 'command', command: `node ${B}/summarize.cjs`, timeout: 120000 }] }]
  };
  writeJSON(SETTINGS, s);
  log('Hooks written');

  // 3. Write CLAUDE.md section
  let cm = '';
  try { cm = fs.readFileSync(CLAUDE_MD, 'utf8'); } catch {}
  cm = cm.replace(/\n*## Memory \(cc-trace\)[\s\S]*?(?=\n## |$)/, '');
  cm += `

## Memory (cc-trace)

You have a persistent memory system at \`~/.claude-memory/\`.

The Web UI is at http://localhost:13779 — open it to browse sessions.

Search past conversations:
- \`curl -s "http://localhost:13779/api/search?q=<keywords>"\`

When the user asks about past work: search immediately.

`;
  fs.writeFileSync(CLAUDE_MD, cm);
  log('CLAUDE.md updated');

  log('');
  log('Done! Restart Claude Code to activate hooks.');
}

function cmdUninstall(purge) {
  let s = readJSON(SETTINGS);
  if (s && s.hooks) {
    delete s.hooks.Setup; delete s.hooks.SessionStart;
    delete s.hooks.UserPromptSubmit; delete s.hooks.PostToolUse; delete s.hooks.Stop;
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
    writeJSON(SETTINGS, s);
    log('Hooks removed');
  }
  let cm = '';
  try { cm = fs.readFileSync(CLAUDE_MD, 'utf8'); } catch {}
  cm = cm.replace(/\n*## Memory \(cc-trace\)[\s\S]*?(?=\n## |$)/, '');
  fs.writeFileSync(CLAUDE_MD, cm);
  log('CLAUDE.md cleaned');
  if (purge) {
    try { fs.rmSync(TRACE_DIR, { recursive: true, force: true }); log('Data deleted'); } catch {}
  }
  log('Uninstall complete');
}

function cmdOpen() {
  const u = 'http://localhost:13779';
  try {
    const url = fs.readFileSync(path.join(TRACE_DIR, 'server.url'), 'utf8').trim();
    const p = process.platform;
    if (p === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (p === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
    else spawnSync('xdg-open', [url], { stdio: 'ignore' });
    log(`Opened ${url}`);
  } catch { log(`Open ${u} in browser`); }
}

function cmdStatus() {
  try {
    const pid = parseInt(fs.readFileSync(path.join(TRACE_DIR, 'server.pid'), 'utf8').trim(), 10);
    const alive = process.platform === 'win32'
      ? spawnSync('cmd', ['/c', `tasklist /FI "PID eq ${pid}" /NH`], { encoding: 'utf8', timeout: 3000 }).stdout.includes(String(pid))
      : (() => { try { return process.kill(pid, 0); } catch { return false; } })();
    log(alive ? `Server running (PID: ${pid})` : `PID ${pid} exists but not running`);
  } catch { log('Server not running'); }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`Usage: cc-trace <command>

Commands:
  install               Install hooks, copy scripts, set up config
  uninstall [--purge]   Remove hooks and (with --purge) delete all data
  open                  Open Web UI in browser
  status                Check server status
`);
    return;
  }
  switch (args[0]) {
    case 'install': cmdInstall(); break;
    case 'uninstall': cmdUninstall(args.includes('--purge')); break;
    case 'open': cmdOpen(); break;
    case 'status': cmdStatus(); break;
    default: warn('Unknown command: ' + args[0]);
  }
}
main();
