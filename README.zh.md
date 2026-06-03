# cc-trace 🔍

[English](README.md)

**Claude Code 的持久记忆。** 聊过的每句话、调过的每个工具、做过的每个决定——自动存好，随时能翻出来。

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## 它能干嘛

cc-trace 让 Claude Code 有了跨会话的记忆能力，`/compact` 清不掉，重启也不丢。

- **自动记录** — 消息和工具调用全部保留，无需配置
- **跨会话** — 记忆在会话之间持续存在
- **搜索** — 关键词秒出结果，关键词不够 AI 来凑
- **Web UI** — 浏览会话、项目、记忆，访问 `http://localhost:13779`

## statusLine

配合 [cc-statusline](https://github.com/kira4094/cc-statusline) 使用，在状态栏中显示实时会话统计：

- `[trace[ON]]` — 服务器运行中（绿色）或不可达（红色）
- `6proj` — 跟踪的项目数
- `14ses` — 记录的会话数
- `http://localhost:13779` — 打开 Web UI

## 安装

```bash
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

重启 Claude Code，完成。

## 卸载

```bash
/plugin uninstall cc-trace
/reload-plugins
```

删除所有存储数据：

```bash
rm -rf ~/.claude-memory
```

## 原理

```
消息或工具调用
  ├── hook 捕获 → JSONL 文件
  ├── 会话结束 → AI 总结 → markdown 记忆
  ├── 新会话开始 → 最近记忆注入提示词
  └── Web UI 运行在端口 13779
```

## 协议

MIT。
