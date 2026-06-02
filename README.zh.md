# cc-trace 🔍

> **Vibe Coding** · Claude Code 长记性了。

![version](https://img.shields.io/badge/version-v1.0.1(20260602.1350)-FF5701)

聊过的每句话、调过的每个工具、做过的每个决定——自动存好，随时能翻出来。

```
All projects ▾
▶ 🟢 session-01 (当前)
  ├── 2026-06-02
  └── 2026-06-01
▶ session-02
  └── 2026-06-01
```

[English](README.md) | [`http://localhost:13779`](http://localhost:13779)

## 它能干嘛

- **自动记** — 消息和工具调用全部保留，不用配置
- **跨会话** — `/compact` 清不掉记忆
- **随便搜** — 关键词秒出结果，关键词不够 AI 来凑
- **有界面** — `http://localhost:13779`，浅色深色随便切
- **不添乱** — 插件安装，不动 settings.json

## 装一个

```bash
# 在 Claude Code 里敲：
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

**重启 Claude Code**，完事。

## 卸一个

```bash
# 在 Claude Code 里：
/plugin uninstall cc-trace

# 终端里：
rm -rf ~/.claude/plugins/marketplaces/kira4094
rm -rf ~/.claude/plugins/cache/kira4094
rm -rf ~/.claude-memory          # 想清楚，这步删所有记忆
```

## 斜杠命令

| 命令 | 干啥的 |
|------|--------|
| `/cc-trace:trace` | 打开 Web UI |
| `/cc-trace:trace-search` | 搜历史记录 |
| `/cc-trace:trace-status` | 看服务器活着没 |

## 服务器闹脾气了

**PowerShell：**
```powershell
taskkill /F /PID (Get-Content $env:USERPROFILE\.claude-memory\server.pid)
```

**Git Bash：**
```bash
taskkill //F //PID $(cat ~/.claude-memory/server.pid)
```

杀了就行，下条消息 hook 会自动再拉起来。

## 原理

```
消息或工具调用
  ├── hook 捕获 → 存成 JSONL 文件
  ├── 会话结束 → AI 总结 → 存成 markdown
  ├── 新会话开始 → 最近的记忆注入提示词
  ├── Setup hook → 启动 Web UI（端口 13779）
  └── 你问"我们聊过这个吗？" → curl /api/search?q=...
```

没有数据库，没有 Docker，全靠文件系统：

```
~/.claude-memory/
└── sessions/<项目>/<会话ID>/<日期>/chunk-NNN.jsonl
```

## 版本号

`v0.42(20260602.1334)` — `0.` 后面的数字就是 git 提交总数。时间戳是最后一次提交的时间。不玩虚的。

## 协议

MIT
