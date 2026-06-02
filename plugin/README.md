# cc-trace 🔍

> **Vibe Coding** · Persistent memory for Claude Code

![version](https://img.shields.io/badge/version-v1.0.1(20260602.1350)-FF5701)

Session-level capture, keyword + AI search, Web UI. Zero dependencies.

```
All projects ▾
▶ 🟢 设计讨论 (当前)
  ├── 2026-06-02
  └── 2026-06-01
▶ 重构计划
  └── 2026-06-01
```

[中文文档](README.zh.md)

## Features

- **Auto-record** — every message and tool call logged automatically
- **Dual-channel search** — keyword (free, instant) + AI semantic fallback
- **Cross-session memory** — compact doesn't lose context
- **Web UI** — browse, search, filter by project at `http://localhost:13779`
- **Theme toggle** — ☀ light (Claude) / ☽ dark
- **Claude Code plugin** — no settings.json modification needed
- **Auto versioning** — semantic version from git commits

## Install

Requires **proxy** for GitHub clone.

```bash
# Clean old (if reinstalling)
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
```

Then inside Claude Code:

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

**Restart Claude Code** — hooks auto-start the Web UI.

## Uninstall

```bash
# Inside Claude Code:
/plugin uninstall cc-trace

# Then in terminal:
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
rm -rf ~/.claude-memory          # Optional: delete all data
```

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/cc-trace:trace` | Open Web UI in browser |
| `/cc-trace:trace-search` | Search past conversations |
| `/cc-trace:trace-status` | Show server status |

## Kill Server

If the Web UI is stuck and you need to restart:

**PowerShell:**
```powershell
taskkill /F /PID (Get-Content $env:USERPROFILE\.claude-memory\server.pid)
```

**Git Bash:**
```bash
taskkill //F //PID $(cat ~/.claude-memory/server.pid)
```

The server will auto-restart on next Claude Code launch or first message.

## Storage

```
~/.claude-memory/
├── sessions/
│   ├── claude-trace/          ← grouped by project (from cwd)
│   │   └── <sessionId>/
│   │       ├── 2026-06-01/
│   │       │   ├── chunk-000.jsonl
│   │       │   └── meta.json
│   │       └── 2026-06-02/
│   └── kiray/
└── memory/
    ├── MEMORY.md
    └── *.md                   ← AI summaries
```

## Architecture

```
Message / Tool call
  ├── PostToolUse hook → capture.cjs → sessions/<project>/<sid>/<date>/
  ├── Stop hook → summarize.cjs → DeepSeek AI → memory/
  ├── SessionStart → inject.cjs → recent memory → CLAUDE.md
  ├── Setup hook → server-launcher.cjs → Web UI (port 13779)
  └── User asks about past → curl /api/search → results
```

## Versioning

`v<major>.<minor>.<patch>(<YYYYMMDD.HHmm>)` — auto-generated from git commit messages by pre-commit hook.

| Commit contains | Version bump |
|----------------|:------------:|
| `BREAKING` / `restructure` / `rewrite` | major +1 |
| `feat:` / `add` / `new` / `redesign` | minor +1 |
| `fix:` / other | patch +1 |

## Development

```bash
git clone https://github.com/kira4094/cc-trace.git
cd cc-trace
# Install pre-commit hook:
node scripts/update-version.cjs
```

## License

MIT
