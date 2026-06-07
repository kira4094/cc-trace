# cc-trace 🔍

[中文](README.zh.md)

**Persistent memory for Claude Code.** Every conversation, every tool call, every decision — automatically recorded, searchable, and ready when you are. Survives `/compact`, new sessions, and restarts.

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## Features

- **Auto-recording** — all messages and tool calls saved, zero config
- **Cross-session** — pick up where you left off, even after restart
- **Two search modes** — instant keyword match + AI semantic search when keywords aren't enough
- **Web UI** — browse sessions, projects, and memories at `http://localhost:13779`
- **statusLine** — real-time stats in your status bar when paired with [cc-statusline](https://github.com/kira4094/cc-statusline)

### Status bar reference

| Display | Meaning |
|---------|---------|
| `[trace[ON]]` | server running (green) or unreachable (red) |
| `6proj` | projects tracked |
| `14ses` | sessions recorded |
| `http://localhost:13779` | click to open the Web UI |

## Install

cc-trace is a Claude Code plugin, not an npm package. Install it directly inside Claude Code:

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

Restart Claude Code. That's it.

> **Upgrading from the old npm version?** The `@kira4094/cc-trace` package is deprecated. Run the commands above to switch to the plugin — same functionality, simpler setup.

### Verify it's working

After restart, you should see `[trace[ON]]` in the status bar. Open `http://localhost:13779` in your browser to access the Web UI.

If the status bar doesn't show up, try `/reload-skills` or make sure cc-statusline is also installed.

## Uninstall

```
/plugin uninstall cc-trace
/reload-plugins
```

Remove all stored data:

```
rm -rf ~/.claude-memory
```

## How it works

```
Message or tool call
  ├── hook captures it → JSONL file
  ├── AI summarizes on session end → markdown memory
  ├── next session starts → recent memories injected into prompt
  └── Web UI serves on port 13779
```

## License

MIT.
