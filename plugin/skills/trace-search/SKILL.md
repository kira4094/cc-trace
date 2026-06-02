---
name: trace-search
description: Search past cc-trace memory
---

Search across all recorded sessions.

! curl -s -G "http://localhost:13779/api/search" --data-urlencode "q=<your search query>"

Use keyword matching with AI fallback when results are sparse.
