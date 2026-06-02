---
name: trace-status
description: Show cc-trace server status
---

Check if the cc-trace server is running and show session/memory counts.

```
curl -s "http://localhost:13779/api/status"
```

Returns JSON with uptime, sessionCount, and memoryCount.
