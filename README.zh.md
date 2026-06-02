# cc-trace 🔍

> **Vibe Coding** · Claude Code 持久化记忆系统

![version](https://img.shields.io/badge/version-v1.0.1(20260602.1350)-FF5701)

会话级记录、关键词 + AI 搜索、Web UI。零依赖。

```
All projects ▾
▶ 🟢 设计讨论 (当前)
  ├── 2026-06-02
  └── 2026-06-01
▶ 重构计划
  └── 2026-06-01
```

[English](README.md)

## 特性

- **自动记录** — 每条消息和工具调用自动保存
- **双通道搜索** — 关键词（免费、毫秒级）+ AI 语义兜底
- **跨会话记忆** — `/compact` 不丢失上下文
- **Web UI** — 可视化浏览、搜索、项目筛选 `http://localhost:13779`
- **主题切换** — ☀ 浅色（Claude 配色）/ ☽ 深色
- **Claude Code 插件** — 不修改 settings.json
- **自动版本号** — 从 git 提交语义化生成

## 安装

需要**代理**才能 clone GitHub。

```bash
# 清旧的（重装时）
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
```

进 Claude Code：

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

**重启 Claude Code** — hooks 会自动拉起 Web UI 服务器。

## 卸载

```bash
# 在 Claude Code 里：
/plugin uninstall cc-trace

# 然后在终端：
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
rm -rf ~/.claude-memory          # 可选：删除所有数据
```

## 斜杠命令

| 命令 | 作用 |
|------|------|
| `/cc-trace:trace` | 在浏览器打开 Web UI |
| `/cc-trace:trace-search` | 搜索历史对话 |
| `/cc-trace:trace-status` | 查看服务器状态 |

## 杀死服务器

如果 Web UI 卡住需要重启：

**PowerShell：**
```powershell
taskkill /F /PID (Get-Content $env:USERPROFILE\.claude-memory\server.pid)
```

**Git Bash：**
```bash
taskkill //F //PID $(cat ~/.claude-memory/server.pid)
```

杀死后发条消息给 Claude Code 就会自动重启。

## 存储结构

```
~/.claude-memory/
├── sessions/
│   ├── claude-trace/          ← 按项目分组（从 cwd 派生）
│   │   └── <sessionId>/
│   │       ├── 2026-06-01/
│   │       │   ├── chunk-000.jsonl
│   │       │   └── meta.json
│   │       └── 2026-06-02/
│   └── kiray/
└── memory/
    ├── MEMORY.md              ← 记忆索引
    └── *.md                   ← AI 摘要
```

## 架构

```
消息 / 工具调用
  ├── PostToolUse hook → capture.cjs → sessions/<项目>/<会话ID>/<日期>/
  ├── Stop hook → summarize.cjs → DeepSeek AI → memory/
  ├── SessionStart → inject.cjs → 近期记忆 → CLAUDE.md
  ├── Setup hook → server-launcher.cjs → Web UI（端口 13779）
  └── 用户问起过去 → curl /api/search → 结果
```

## 版本号

`v<主版本>.<次版本>.<补丁>(<YYYYMMDD.HHmm>)` — git pre-commit hook 自动生成。

| 提交含有关键词 | 版本变化 |
|---------------|:--------:|
| `BREAKING` / `restructure` / `rewrite` | 主版本 +1 |
| `feat:` / `add` / `new` / `redesign` | 次版本 +1 |
| `fix:` / 其他 | 补丁 +1 |

## 开发

```bash
git clone https://github.com/kira4094/cc-trace.git
cd cc-trace
# 安装 pre-commit hook（自动版本号）：
node scripts/update-version.cjs
```

## 协议

MIT
