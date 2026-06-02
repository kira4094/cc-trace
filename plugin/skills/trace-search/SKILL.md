---
name: trace-search
description: Search past cc-trace memory
---

Search across all recorded sessions using keyword matching with AI fallback.

```
curl -s -G "http://localhost:13779/api/search" --data-urlencode "q=<query>"
```

Pass the search query as the query parameter. Returns matching records with context.
