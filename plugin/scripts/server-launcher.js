#!/usr/bin/env node
// cc-trace MCP server
process.stdin.setEncoding("utf8");
let buf = "";

function httpGet(url) {
  return new Promise((resolve) => {
    require("http").get(url, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", () => resolve(null));
  });
}

async function httpGetRetry(url, retries, delay) {
  retries = retries || 5;
  delay = delay || 400;
  for (let i = 0; i < retries; i++) {
    const result = await httpGet(url);
    if (result !== null) return result;
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

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
        httpGetRetry("http://localhost:13779/api/status").then((body) => {
          process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:body || "Server not ready"}]}}) + "\n");
        });
      } else if (n === "trace_search" && a && a.query) {
        httpGetRetry("http://localhost:13779/api/search?q=" + encodeURIComponent(a.query)).then((body) => {
          if (body) process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:body}]}}) + "\n");
          else process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32603,message:"Search failed"}}) + "\n");
        });
      } else {
        process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Not found"}}) + "\n");
      }
    }
  }
});
process.stdin.on("end", () => { process.exit(0); });
console.error("[cc-trace] MCP ready");
