# ui-face

全屏脸 + 聊天 + 语音 — 连接 [Moltbot](https://github.com/moltbot/moltbot) Gateway 的独立前端界面。

基于 Moltbot/Clawdbot 的 Control UI 对话协议，在独立端口提供**全屏脸**界面：极简线条表情 + 聊天框 + 语音输入/朗读。

## 前置要求

- 已运行 [Moltbot](https://github.com/moltbot/moltbot) Gateway（默认端口 18789）
- Node.js 18+

## 使用

### 1. 安装

```bash
git clone https://github.com/YOUR_USERNAME/ui-face.git
cd ui-face
npm install   # 可选，仅 E2E 测试需要 ws
```

### 2. 启动 ui-face 静态服务

```bash
npm start
# 或
node server.js
```

默认监听 `http://127.0.0.1:18794`。若端口被占用，可设置环境变量：

```bash
FACE_PORT=18795 node server.js
```

### 3. 浏览器打开（必须带 token）

```
http://127.0.0.1:18794/?token=你的gateway_token
```

Token 可从 Moltbot Control UI 的「带 token 的链接」复制，或查看 `~/.clawdbot/clawdbot.json` 中的 `gateway.auth.token`。

### 4. 可选参数

- `?session=xxx` — 指定会话（默认 `main`）
- `?ws=host:port` 或 `?ws=wss://host:port` — 指定 Gateway WebSocket 地址（默认 `ws://127.0.0.1:18789`）

### 5. 全屏

按 F11 或浏览器全屏，即可只显示一张脸；发消息、助手回复时，脸会进入「说话」状态并显示回复。

## 状态说明

- **idle** — 已连接，无进行中的回复
- **thinking** — 等待 AI 回复
- **speaking** — 正在流式输出，底部气泡显示当前片段
- **listening** — 语音输入中

## 技术说明

- ui-face 通过 WebSocket 连接 Moltbot Gateway，使用 Soul 协议（connect、chat.send、chat 事件）
- 会话默认 `main`；与 Control UI 共用同一 token 和 session
- 语音输入使用浏览器 Web Speech API；朗读使用 Speech Synthesis

## 致谢

本项目基于 [Moltbot](https://github.com/moltbot/moltbot) 的 Gateway 协议开发，兼容 Moltbot/Clawdbot 生态。

## License

MIT
