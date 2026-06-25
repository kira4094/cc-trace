# cc-trace 🔍

[English](README.md)

**Claude Code 的持久记忆。** 每轮对话、每次工具调用、每个决定——自动记下来，随时翻出来。`/compact` 清不掉，重启也不丢。

[![GitHub stars](https://img.shields.io/github/stars/kira4094/cc-trace?style=social)](https://github.com/kira4094/cc-trace) <sub>⭐ 去 GitHub 点个 Star 吧！</sub>

```
[trace[ON]] | 6proj | 14ses | http://localhost:13779
```

## 功能

- **自动记录** — 消息和工具调用全部保存，装好就用
- **跨会话** — 上个会话聊了什么，下个会话还能查到
- **智能搜索** — 关键词秒出结果，不够的话 AI 语义搜索顶上
- **自我进化** — 跨会话分析重复模式，自动生成 Skill，Claude 下次自动遵守
- **Web UI** — 在浏览器里翻会话、项目、记忆，地址 `http://localhost:13779`
- **statusLine** — 配合 [cc-statusline](https://github.com/kira4094/cc-statusline) 在状态栏看到实时统计
- **自带大模型** — 自动继承 Claude Code 的模型配置（Anthropic/DeepSeek/GLM 等），零额外配置

### 状态栏说明

| 显示 | 含义 |
|------|------|
| `[trace[ON]]` | 服务器运行中（绿色）或连不上（红色） |
| `6proj` | 跟踪了多少个项目 |
| `14ses` | 记录了多少个会话 |
| `http://localhost:13779` | 点它打开 Web UI |

## 安装

有两种方式，选一种就行：

### 方式一：插件安装（推荐）

在 Claude Code 里直接装：

```
/plugin marketplace add kira4094/cc-trace
/plugin install cc-trace
/reload-plugins
```

重启 Claude Code，搞定。

### 方式二：npm 安装

适合习惯终端的用户。装完后要跑 `cc-trace install` 注册插件：

```bash
npm install -g @kira4094/cc-trace
cc-trace install
```

**重要：装完后必须重启 Claude Code，插件才会生效。**

### 验证是否装好了

重启后状态栏应该出现 `[trace[ON]]`，浏览器打开 `http://localhost:13779` 能看到 Web UI。

如果状态栏没显示，试试 `/reload-skills`，或者确认 cc-statusline 也在插件列表里。

## 卸载

### 插件方式卸载
```
/plugin uninstall cc-trace
/reload-plugins
```

### npm 方式卸载
```bash
cc-trace uninstall --purge   # 卸载插件 + 删除数据
npm uninstall -g @kira4094/cc-trace
```

重启 Claude Code。

> `--purge` 会删除 `~/.claude-memory/` 目录下所有数据。如果只是想停用、保留数据以后再用，去掉 `--purge` 就行。

## 原理

```
消息或工具调用
  ├── hook 捕获 → 写入 JSONL 文件
  ├── 会话结束 → AI 总结 → 写为 markdown 记忆
  ├── AI 跨会话分析重复模式 → 自动生成 Skill
  │   (重复修正、用户偏好、常用工作流)
  ├── 新会话开始 → 记忆 + Skill 注入到提示词
  ├── Web UI 在端口 13779 提供浏览
  └── 通过 Setup hook 启动 HTTP 服务器（主进程）
      ├── Claude Code 启动 → Setup hook 创建独立孤儿进程
      ├── 服务器运行在 MCP Job Object 之外 → 空闲超时也不被杀
      ├── 新 session → hook 检查端口 → 复用已有服务器
      └── 跨 session 持续存活，仅在更新时重启
```

## 协议

MIT。
