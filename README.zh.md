# cc-trace 🔍

[English](README.md)

**Claude Code 的持久记忆。** 每轮对话、每次工具调用、每个决定——自动记下来，随时翻出来。`/compact` 清不掉，重启也不丢。

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## 功能

- **自动记录** — 消息和工具调用全部保存，装好就用
- **跨会话** — 上个会话聊了什么，下个会话还能查到
- **两种搜索** — 关键词秒出结果，关键词不够的话 AI 语义搜索顶上
- **Web UI** — 在浏览器里翻会话、项目、记忆，地址 `http://localhost:13779`
- **statusLine** — 配合 [cc-statusline](https://github.com/kira4094/cc-statusline) 在状态栏看到实时统计

### 状态栏说明

| 显示 | 含义 |
|------|------|
| `[trace[ON]]` | 服务器运行中（绿色）或连不上（红色） |
| `6proj` | 跟踪了多少个项目 |
| `14ses` | 记录了多少个会话 |
| `http://localhost:13779` | 点它打开 Web UI |

## 安装

cc-trace 是 Claude Code 插件，不是 npm 包。直接在 Claude Code 里装：

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

重启 Claude Code，搞定。

> **之前从 npm 装过旧版本？** 那个 `@kira4094/cc-trace` 包已经弃用了，功能一样，但插件方式更省心。跑一遍上面的命令切换过来就行。

### 验证是否装好了

重启后状态栏应该出现 `[trace[ON]]`，浏览器打开 `http://localhost:13779` 能看到 Web UI。

如果状态栏没显示，试试 `/reload-skills`，或者确认 cc-statusline 也在插件列表里。

## 卸载

```
/plugin uninstall cc-trace
/reload-plugins
```

删掉所有数据：

```
rm -rf ~/.claude-memory
```

## 原理

```
消息或工具调用
  ├── hook 捕获 → 写入 JSONL 文件
  ├── 会话结束 → AI 总结 → 写为 markdown 记忆
  ├── 新会话开始 → 最近的记忆注入到提示词
  └── Web UI 在端口 13779 提供浏览
```

## 协议

MIT。
