---
name: trace-search
description: Search past cc-trace memory
disable-model-invocation: true
allowed-tools: [Bash]
---

Ask the user for search keywords, then run:

curl -s -G "http://localhost:13779/api/search" --data-urlencode "q=<keywords>"

Show the user the matching records.