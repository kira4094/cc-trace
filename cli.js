#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const HOME = os.homedir();
const TRACE_DIR = path.join(HOME, '.claude-memory');
const SETTINGS = path.join(HOME, '.claude', 'settings.json');

const PLUGIN_NAME = 'cc-trace@cc-trace';
const MARKETPLACE_KEY = 'cc-trace';

function log(m) { console.log('[cc-trace]', m); }
function warn(m) { console.error('[cc-trace]', m); }

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

function cmdInstall() {
  // 1. Create data directory
  fs.mkdirSync(TRACE_DIR, { recursive: true });

  // 2. Register plugin in settings.json
  let s = readJSON(SETTINGS) || {};
  if (!s.enabledPlugins) s.enabledPlugins = {};
  s.enabledPlugins[PLUGIN_NAME] = true;
  if (!s.extraKnownMarketplaces) s.extraKnownMarketplaces = {};
  s.extraKnownMarketplaces[MARKETPLACE_KEY] = {
    source: { source: 'github', repo: 'kira4094/cc-trace' }
  };
  writeJSON(SETTINGS, s);
  log('Plugin registered in settings.json');

  log('');
  log('Done! Restart Claude Code to activate the plugin.');
  log('');
  log('  IMPORTANT: You MUST restart Claude Code for the plugin to take effect.');
}

function cmdUninstall(purge) {
  let s = readJSON(SETTINGS);
  if (s) {
    if (s.enabledPlugins) delete s.enabledPlugins[PLUGIN_NAME];
    if (s.extraKnownMarketplaces) delete s.extraKnownMarketplaces[MARKETPLACE_KEY];
    writeJSON(SETTINGS, s);
    log('Plugin unregistered from settings.json');
  }
  if (purge) {
    try { fs.rmSync(TRACE_DIR, { recursive: true, force: true }); log('Data deleted'); } catch {}
  }
  log('Uninstall complete. Restart Claude Code to apply changes.');
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
  install               Register cc-trace plugin and create data directory
  uninstall [--purge]   Unregister plugin and (with --purge) delete all data
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
