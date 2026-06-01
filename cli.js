#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACE_DIR = path.join(os.homedir(), '.claude-memory');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CLAUDE_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const SCRIPTS_DEST = path.join(TRACE_DIR, 'scripts');
const SCRIPTS_SRC = path.join(__dirname, 'scripts');
const SERVER_PORT = 13779;
const PIDFILE = path.join(TRACE_DIR, 'server.pid');
const SERVER_URL_PATH = path.join(TRACE_DIR, 'server.url');
const CONFIG_PATH = path.join(TRACE_DIR, 'config.json');

const HOOK_SECTION_TITLE = '## Memory (cc-trace)';

// ---------------------------------------------------------------------------
// Hook definition (the same structure written into settings.json)
// ---------------------------------------------------------------------------

const HOOKS = {
  Setup: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `node ${path.join(SCRIPTS_DEST, 'server-launcher.cjs')}`,
          async: true,
          timeout: 10,
        },
      ],
    },
  ],
  SessionStart: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `node ${path.join(SCRIPTS_DEST, 'inject.cjs')}`,
          async: true,
          timeout: 10,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      hooks: [
        {
          type: 'command',
          command: `node ${path.join(SCRIPTS_DEST, 'capture.cjs')}`,
          async: true,
          timeout: 10,
        },
      ],
    },
  ],
  Stop: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `node ${path.join(SCRIPTS_DEST, 'summarize.cjs')}`,
          timeout: 120000,
        },
      ],
    },
  ],
};


const CLAUDE_MD_SECTION = `

${HOOK_SECTION_TITLE}

You have a persistent memory system at \`~/.claude-memory/\`.

Available tools:
- The Web UI is at http://localhost:13779 — open it to browse sessions.
- Search via: curl -s "http://localhost:13779/api/search?q=<keywords>"

Memory rules:
1. When the user asks about past conversations: search immediately
2. If search returns nothing useful, say you\'re not sure
3. Recent context is injected below by the SessionStart hook

`;

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log('[cc-trace]', msg);
}

function warn(msg) {
  console.error('[cc-trace]', msg);
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex that matches a markdown heading and everything under it until
 * the next heading of the same level or end-of-string.
 */
function sectionRegex(title) {
  return new RegExp(
    `\n*${escapeRegex(title)}[\\s\\S]*?(?=\n## |\n*$)`,
    's'
  );
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Try to find `name` in the local scripts directory first (development mode),
 * then fall back to the installed scripts directory.
 */
function findScript(name) {
  const local = path.join(SCRIPTS_SRC, name);
  if (fs.existsSync(local)) return local;

  const installed = path.join(SCRIPTS_DEST, name);
  if (fs.existsSync(installed)) return installed;

  return null;
}

/**
 * Read and parse a JSON file.  Returns `null` on any failure.
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a JSON file with nice formatting.
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Command: install
// ---------------------------------------------------------------------------

function cmdInstall() {
  // 1. Ensure directories exist
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });

  // 2. Register marketplace source in settings.json
  let settings = readJson(SETTINGS_PATH);
  if (!settings) {
    settings = {};
    log('Creating new settings.json');
  }
  if (!settings.extraKnownMarketplaces) {
    settings.extraKnownMarketplaces = {};
  }
  settings.extraKnownMarketplaces["cc-trace"] = {
    source: { source: "github", repo: "kira4094/cc-trace" }
  };
  writeJson(SETTINGS_PATH, settings);
  log('Marketplace source registered');

  // 3. Inject section into CLAUDE.md
  injectClaudeMdSection();

  // 4. Write default config
  writeJson(CONFIG_PATH, {
    port: SERVER_PORT,
    traceDir: TRACE_DIR,
    version: 2,
  });
  log(`Config written to ${CONFIG_PATH}`);

  log('');
  log('Installation complete! Now install the plugin in Claude Code:');
  log('  /plugin marketplace add cc-trace');
  log('  /plugin install cc-trace');
  log('Then restart Claude Code.');
}

function injectClaudeMdSection() {
  let content = fs.existsSync(CLAUDE_MD)
    ? fs.readFileSync(CLAUDE_MD, 'utf-8')
    : '';

  // Remove any existing cc-trace section so we can replace it cleanly
  content = content.replace(sectionRegex(HOOK_SECTION_TITLE), '').trim();

  // Append the section at the very end
  content += CLAUDE_MD_SECTION;

  fs.mkdirSync(path.dirname(CLAUDE_MD), { recursive: true });
  fs.writeFileSync(CLAUDE_MD, content);
  log(`"${HOOK_SECTION_TITLE}" appended to ${CLAUDE_MD}`);
}

function copyScriptFiles() {
  if (!fs.existsSync(SCRIPTS_SRC)) {
    warn(`Scripts directory not found at ${SCRIPTS_SRC} -- skipping copy`);
    return;
  }

  fs.mkdirSync(SCRIPTS_DEST, { recursive: true });

  const entries = fs.readdirSync(SCRIPTS_SRC, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = path.join(SCRIPTS_SRC, entry.name);
    const dst = path.join(SCRIPTS_DEST, entry.name);
    fs.copyFileSync(src, dst);
    count++;
  }

  log(`Copied ${count} script file(s) to ${SCRIPTS_DEST}`);
}

// ---------------------------------------------------------------------------
// Command: uninstall
// ---------------------------------------------------------------------------

function cmdUninstall(purge) {
  // 1. Remove cc-trace marketplace source from settings.json
  if (fs.existsSync(SETTINGS_PATH)) {
    const settings = readJson(SETTINGS_PATH);
    if (settings && settings.extraKnownMarketplaces) {
      delete settings.extraKnownMarketplaces["cc-trace"];
      if (Object.keys(settings.extraKnownMarketplaces).length === 0) {
        delete settings.extraKnownMarketplaces;
      }
      writeJson(SETTINGS_PATH, settings);
      log('Marketplace source removed');
    }
  }

  // 2. Remove section from CLAUDE.md
  if (fs.existsSync(CLAUDE_MD)) {
    let content = fs.readFileSync(CLAUDE_MD, 'utf-8');
    content = content.replace(sectionRegex(HOOK_SECTION_TITLE), '').trim();
    content += '\n';
    fs.writeFileSync(CLAUDE_MD, content);
    log(`Section removed from ${CLAUDE_MD}`);
  }

  // 3. Optionally remove data directory
  if (purge) {
    if (fs.existsSync(TRACE_DIR)) {
      fs.rmSync(TRACE_DIR, { recursive: true, force: true });
      log(`Removed ${TRACE_DIR}`);
    }
  } else {
    log(`Data directory preserved at ${TRACE_DIR}`);
    log('Use --purge to also delete all stored data.');
  }

  log('Uninstallation complete.');
}

// ---------------------------------------------------------------------------
// Command: open
// ---------------------------------------------------------------------------

function cmdOpen() {
  let url = `http://localhost:${SERVER_PORT}`;

  try {
    if (fs.existsSync(SERVER_URL_PATH)) {
      url = fs.readFileSync(SERVER_URL_PATH, 'utf-8').trim();
    }
  } catch {
    // fall through to default
  }

  const platform = process.platform;

  try {
    if (platform === 'win32') {
      spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      spawnSync('open', [url], { stdio: 'ignore' });
    } else {
      spawnSync('xdg-open', [url], { stdio: 'ignore' });
    }
    log(`Opened browser to ${url}`);
  } catch (err) {
    warn(`Could not open browser: ${err.message}`);
    log(`Open ${url} manually.`);
  }
}

// ---------------------------------------------------------------------------
// Command: search
// ---------------------------------------------------------------------------

function cmdSearch(queryArgs) {
  if (queryArgs.length === 0) {
    warn('Usage: cc-trace search <query>');
    process.exit(1);
  }

  const script = findScript('search.cjs');
  if (!script) {
    warn('search.cjs not found. Run "cc-trace install" first.');
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [script, ...queryArgs], {
    stdio: 'inherit',
    timeout: 30_000,
  });

  if (result.error) {
    warn(`Search failed: ${result.error.message}`);
    process.exit(result.status || 1);
  }
}

// ---------------------------------------------------------------------------
// Command: serve
// ---------------------------------------------------------------------------

function cmdServe(port) {
  const script = findScript('server.js');
  if (!script) {
    warn('server.js not found. Run "cc-trace install" first.');
    process.exit(1);
  }

  const env = { ...process.env };
  if (port) {
    env.PORT = String(port);
    env.TRACE_PORT = String(port);
  }

  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code);
    }
  });

  // Forward termination signals to the child
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------

function cmdStatus() {
  if (!fs.existsSync(PIDFILE)) {
    log('Server is not running (no PID file).');
    return;
  }

  let pid;
  try {
    pid = parseInt(fs.readFileSync(PIDFILE, 'utf-8').trim(), 10);
  } catch (err) {
    warn(`Could not read PID file: ${err.message}`);
    return;
  }

  const running = checkProcess(pid);
  if (running) {
    log(`Server is running (PID: ${pid}).`);
  } else {
    log(`PID file exists but process ${pid} is not running. Stale PID file.`);
  }
}

function checkProcess(pid) {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/NH'],
        { encoding: 'utf-8', timeout: 5000 }
      );
      return result.status === 0 && result.stdout.includes(String(pid));
    }
    // Unix: kill -0 probes the process without sending a signal
    const result = spawnSync('kill', ['-0', String(pid)], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
Usage: cc-trace <command> [options]

Commands:
  install               Install hooks, copy scripts, set up config
  uninstall [--purge]   Remove hooks and (with --purge) delete all data
  open                  Open the web UI in your default browser
  search <query>        Search past conversations
  serve [--port N]      Start the web UI server (foreground)
  status                Check whether the server process is running
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'install':
      cmdInstall();
      break;

    case 'uninstall': {
      const purge = args.includes('--purge');
      cmdUninstall(purge);
      break;
    }

    case 'open':
      cmdOpen();
      break;

    case 'search':
      cmdSearch(args.slice(1));
      break;

    case 'serve': {
      const idx = args.indexOf('--port');
      const port = idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
      if (port !== null && (Number.isNaN(port) || port < 1 || port > 65535)) {
        warn('Invalid port specified. Must be 1-65535.');
        process.exit(1);
      }
      cmdServe(port);
      break;
    }

    case 'status':
      cmdStatus();
      break;

    default:
      warn(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
