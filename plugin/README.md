# cc-trace 🔍

> **Vibe Coding** · Claude Code just got a memory.

Every conversation, every tool call, every decision — automatically saved, searchable, and ready when you are.

```
All projects ▾
▶ 🟢 session-01 (active)
  ├── 2026-06-02
  └── 2026-06-01
▶ session-02
  └── 2026-06-01
```

[中文文档](README.zh.md) | [`http://localhost:13779`](http://localhost:13779)

## What it does

- **Records everything** — every message and tool call, zero config
- **Remembers across sessions** — `/compact` doesn't lose context
- **Lets you search** — keyword (instant) + AI (semantic) when you need it
- **Shows you around** — Web UI at `http://localhost:13779`, light/dark themes
- **Stays out of the way** — Claude Code plugin, no settings.json editing

## Getting started

```bash
# Inside Claude Code:
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

Then **restart Claude Code**. That's it.

## If you need to take it out

```bash
# Inside Claude Code:
/plugin uninstall cc-trace

# In terminal:
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
rm -rf ~/.claude-memory          # say goodbye to all memories
```

## Slash commands

| Command | Does what |
|---------|-----------|
| `/cc-trace:trace` | Opens the Web UI |
| `/cc-trace:trace-search` | Searches past conversations |
| `/cc-trace:trace-status` | Checks if the server is alive |

## Kill the server (if it misbehaves)

**PowerShell:**
```powershell
taskkill /F /PID (Get-Content $env:USERPROFILE\.claude-memory\server.pid)
```

**Git Bash:**
```bash
taskkill //F //PID $(cat ~/.claude-memory/server.pid)
```

It'll come back on its own — first message you send, the hook brings it up.

## How it's built

```
Message or tool call
  ├── hook captures it → saved to disk as JSONL
  ├── AI summarizes on session end → stored as markdown
  ├── next session starts → recent memories injected into prompt
  ├── Setup hook → Web UI server on port 13779
  └── You ask "did we cover this?" → curl /api/search?q=...
```

Storage is just files — no database, no Docker, no fuss:

```
~/.claude-memory/
└── sessions/<project>/<sessionId>/<date>/chunk-NNN.jsonl
```

## License

MIT — go build something cool with it.
