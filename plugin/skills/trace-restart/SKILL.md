---
name: trace-restart
description: Restart cc-trace HTTP server
disable-model-invocation: true
allowed-tools: [Bash]
---

Restart the cc-trace server by running the launcher script:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/server-launcher.cjs"`

Then check if the server is back:

`curl -s "http://localhost:13779/api/status"`
