# cc-trace 🔍

[中文](README.zh.md)

**Persistent memory for Claude Code.** Every conversation, every tool call, every decision — automatically recorded, searchable, and ready when you are. Survives `/compact`, new sessions, and restarts.

[![GitHub stars](https://img.shields.io/github/stars/kira4094/cc-trace?style=social)](https://github.com/kira4094/cc-trace) <sub>⭐ Star us on GitHub!</sub>

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## Features

- **Auto-recording** — all messages and tool calls saved, zero config
- **Cross-session** — pick up where you left off, even after restart
- **Smart search** — instant keyword match + AI semantic search when keywords aren't enough
- **Self-improving** — analyzes cross-session patterns, automatically generates reusable Skills that Claude follows in future sessions
- **Web UI** — browse sessions, projects, and memories at `http://localhost:13779`
- **statusLine** — real-time stats in your status bar when paired with [cc-statusline](https://github.com/kira4094/cc-statusline)
- **MCP tools** — `trace_status` and `trace_search` available as MCP tools, auto lifecycle via stdio
- **Bring your own LLM** — automatically uses your Claude Code model config (Anthropic, DeepSeek, GLM, etc.), zero extra setup

### Status bar reference

| Display | Meaning |
|---------|---------|
| `[trace[ON]]` | server running (green) or unreachable (red) |
| `6proj` | projects tracked |
| `14ses` | sessions recorded |
| `http://localhost:13779` | click to open the Web UI |

## Install

Two ways to install. Pick one:

### Option 1: Plugin install (recommended)

Inside Claude Code:

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

Restart Claude Code. That's it.

### Option 2: npm install

For terminal users. After installing, run `cc-trace install` to register the plugin:

```bash
npm install -g @kira4094/cc-trace
cc-trace install
```

**Important: Restart Claude Code after installation for the plugin to activate.**

### Verify it's working

After restart, you should see `[trace[ON]]` in the status bar. Open `http://localhost:13779` in your browser to access the Web UI.

If the status bar doesn't show up, try `/reload-skills` or make sure cc-statusline is also installed.

## Uninstall

### Plugin uninstall
```
/plugin uninstall cc-trace
/reload-plugins
```

### npm uninstall
```bash
cc-trace uninstall --purge   # unregister plugin + delete data
npm uninstall -g @kira4094/cc-trace
```

Restart Claude Code.

> Use `--purge` to remove all data under `~/.claude-memory/`. Omit it if you want to keep the data for future use.

## How it works

```
Message or tool call
  ├── hook captures it → JSONL file
  ├── AI summarizes on session end → markdown memory
  ├── AI analyzes cross-session patterns → generates Skills
  │   (repeated corrections, user preferences, common workflows)
  ├── next session starts → memories + Skills injected into prompt
  ├── Web UI serves on port 13779
  └── MCP server auto lifecycle (stdio)
      ├── Claude Code starts → spawns MCP + HTTP server
      ├── trace_status / trace_search tools available
      └── Claude Code exits → clean shutdown, no orphans
```

## License

MIT.
