# cc-trace 🔍

[中文](README.zh.md)

**Persistent memory for Claude Code.** Every conversation, every tool call, every decision — automatically recorded, searchable, and ready when you are.

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## What it does

cc-trace gives Claude Code a memory that survives `/compact`, new sessions, and even restarts.

- **Records everything** — every message and tool call, zero config
- **Remembers across sessions** — `/compact` doesn't lose context
- **Lets you search** — keyword (instant) + AI (semantic) when you need it
- **Web UI** — browse sessions, projects, and memories at `http://localhost:13779`

## statusLine

When paired with [cc-statusline](https://github.com/kira4094/cc-statusline), shows live session stats in your status bar:

- `[trace[ON]]` — server is running (green) or unreachable (red)
- `6proj` — projects tracked
- `14ses` — sessions recorded
- `http://localhost:13779` — click to open the Web UI

## Install

```bash
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

Restart Claude Code. That's it.

## Uninstall

```bash
/plugin uninstall cc-trace
/reload-plugins
```

To remove all stored data:

```bash
rm -rf ~/.claude-memory
```

## How it works

```
Message or tool call
  ├── hook captures it → JSONL file
  ├── AI summarizes on session end → markdown memory
  ├── next session starts → recent memories injected
  └── Web UI serves on port 13779
```

## License

MIT.
