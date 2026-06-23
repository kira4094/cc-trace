---
name: trace-restart
description: Restart cc-trace HTTP server
disable-model-invocation: true
allowed-tools: [Bash]
---

! node "${CLAUDE_PLUGIN_ROOT}/scripts/server-launcher.cjs" && curl -s "http://localhost:13779/api/status"
