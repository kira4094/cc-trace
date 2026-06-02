---
name: trace-status
description: Show cc-trace server status
disable-model-invocation: true
allowed-tools: [Bash]
---

Run: `curl -s "http://localhost:13779/api/status"`

Show the user the server status (uptime, session count, memory count).