#!/usr/bin/env node
// cc-trace MCP server — identical MCP handling to mcp-test.js
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line.trim()); } catch { continue; }
    if (!m || !m.method) continue;
    if (m.method === "initialize") {
      let ver = "";
      try { ver = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "version.json"), "utf8")).full || ""; } catch {}
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"cc-trace",version:ver}}}) + "\n");
      // Start HTTP server after MCP init
      try { require("./server.js").start(13779); } catch(e) {}
    } else if (m.method === "tools/list") {
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{tools:[
        {name:"trace_status",description:"Get cc-trace server status",inputSchema:{type:"object",properties:{}}},
        {name:"trace_search",description:"Search cc-trace sessions and memory",inputSchema:{type:"object",properties:{query:{type:"string",description:"Keywords"}},required:["query"]}}
      ]}}) + "\n");
    } else if (m.method === "tools/call" && m.params) {
      const n = m.params.name;
      const a = m.params.arguments;
      if (n === "trace_status") {
        const http = require("http");
        http.get("http://localhost:13779/api/status", (res) => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:d}]}}) + "\n"));
        }).on("error", () => process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"Server not ready"}]}}) + "\n"));
      } else if (n === "trace_search" && a && a.query) {
        const http = require("http");
        http.get("http://localhost:13779/api/search?q=" + encodeURIComponent(a.query), (res) => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:d}]}}) + "\n"));
        }).on("error", () => process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32603,message:"Search failed"}}) + "\n"));
      } else {
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Not found"}}) + "\n");
      }
    }
  }
});
process.stdin.on("end", () => { process.exit(0); });
console.error("[cc-trace] MCP ready");
