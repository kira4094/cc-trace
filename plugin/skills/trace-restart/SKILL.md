---
name: trace-restart
description: Restart cc-trace HTTP server
disable-model-invocation: true
allowed-tools: [Bash]
---

Restart the cc-trace server:

`node "C:\Users\kiray\.claude\plugins\cache\cc-trace\cc-trace\v2.2.9-20260622.2232-\scripts\server-launcher.cjs"`

Then tell the user to run `/reload-plugins` if the server doesn't come back within 5 seconds.
