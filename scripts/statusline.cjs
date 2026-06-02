#!/usr/bin/env node
const http = require('http');
const req = http.get('http://localhost:13779/api/status', { timeout: 2000 }, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const s = JSON.parse(d);
      console.log(`cc-trace: http://localhost:13779 (${s.sessionCount}sess · ${s.memoryCount}mem)`);
    } catch { console.log('cc-trace: http://localhost:13779'); }
  });
});
req.on('error', () => process.exit(0));
req.end();
