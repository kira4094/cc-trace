# cc-trace

Persistent memory for Claude Code — zero dependencies, session-level isolation, keyword + AI search.

```
!cc-trace search quantum entanglement
→ Matches from past sessions with context
```

## Features

- **Session-level isolation** — multiple Claude Code windows don't interfere
- **Zero dependencies** — only Node.js built-in modules
- **Dual-channel search** — keyword (free) + AI fallback (DeepSeek, ~¥0.001)
- **Auto-inject** — recent memory summaries injected into CLAUDE.md on session start
- **Web UI** — browse sessions and search visually at `http://localhost:13779`
- **Auto-start server** — HTTP server starts with Claude Code via Setup hook

## Install

```bash
npm install -g @kira4094/cc-trace
# Then restart and run:
# /plugin marketplace add cc-trace
# /plugin install cc-trace

Or use:
cc-trace install
cc-trace open
```

Then **restart Claude Code**. The hooks will start recording automatically.

## Usage

```bash
# Install hooks and configure
# Then restart and run:
# /plugin marketplace add cc-trace
# /plugin install cc-trace

Or use:
cc-trace install
cc-trace open

# Remove hooks (keep data)
cc-trace uninstall

# Remove hooks and delete all data
cc-trace uninstall --purge

# Search past conversations (keyword + AI fallback)
cc-trace search "量子纠缠"
cc-trace search --ai "remember about cache"

# Open Web UI in browser
cc-trace open

# Start Web UI server (foreground)
cc-trace serve --port 13779

# Check server status
cc-trace status
```

## How it works

```
Claude Code session
  │
  ├── Setup hook → server-launcher.cjs (starts Web UI server)
  ├── SessionStart → inject.cjs (recent memory → CLAUDE.md)
  ├── PostToolUse → capture.cjs (records every tool call)
  ├── Stop /compact → summarize.cjs (AI summary → memory/)
  │
  └── User asks about past → !cc-trace search <query>
```

### Storage

```
~/.claude-memory/
├── sessions/<date>/<sessionId>/
│   ├── chunk-000.jsonl       ← Raw conversation records
│   ├── chunk-001.jsonl       ← (100 records per chunk)
│   └── meta.json             ← Session metadata
├── memory/
│   ├── MEMORY.md             ← Memory index
│   └── <sessionId>-<date>.md ← AI-generated summaries
├── config.json
├── server.pid
└── server.url
```

### Agent auto-search

After install, your CLAUDE.md gets a section telling the AI:

```
## Memory (cc-trace)

When the user asks about past work: !cc-trace search <keywords>
```

The agent runs the search automatically — no manual commands needed.

## License

MIT
