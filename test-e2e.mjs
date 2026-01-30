#!/usr/bin/env node
/**
 * E2E: ui-face 连接 Moltbot Gateway，收到 connect.challenge 后发 connect，并验证能收到 chat 事件。
 * 需要：Gateway 在 18789 运行、token 有效。
 *
 * 用法:
 *   npm run test:e2e
 *   node test-e2e.mjs
 *
 * Token 来源（按优先级）:
 *   - 环境变量 FACE_E2E_TOKEN
 *   - ~/.clawdbot/clawdbot.json 的 gateway.auth.token
 *   - 环境变量 CLAWDBOT_CONFIG 指向的 JSON 文件
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let token = process.env.FACE_E2E_TOKEN;
if (!token) {
  const configPath =
    process.env.CLAWDBOT_CONFIG ||
    join(process.env.HOME || "", ".clawdbot", "clawdbot.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      token = cfg?.gateway?.auth?.token;
    } catch (e) {
      console.error("Failed to read config:", configPath, e.message);
    }
  }
}
if (!token) {
  console.error(
    "Need token: set FACE_E2E_TOKEN, or ensure ~/.clawdbot/clawdbot.json has gateway.auth.token"
  );
  process.exit(1);
}

let WebSocket;
try {
  const ws = await import("ws");
  WebSocket = ws.default;
} catch (e) {
  console.error("E2E test requires 'ws' package. Run: npm install ws");
  process.exit(1);
}

const WS_URL = process.env.FACE_E2E_WS || "ws://127.0.0.1:18789";
const SESSION_KEY = "main";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map();

    ws.on("open", () => {});

    ws.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.type === "event" && frame.event === "connect.challenge") {
          sendConnect();
          return;
        }
        if (frame.type === "res") {
          const p = pending.get(frame.id);
          if (p) {
            pending.delete(frame.id);
            if (frame.ok) p.resolve(frame.payload);
            else p.reject(new Error(frame.error?.message || "request failed"));
          }
          return;
        }
      } catch (e) {
        reject(e);
      }
    });

    ws.on("error", reject);

    function sendConnect() {
      const id = uuid();
      pending.set(id, {
        resolve: (payload) => {
          if (payload?.type === "hello-ok") {
            resolve({ ws, pending });
          }
        },
        reject,
      });
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "webchat-ui",
              version: "face-test",
              platform: "node",
              mode: "webchat",
            },
            role: "operator",
            scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
            auth: { token },
            userAgent: "face-e2e",
            locale: "en",
          },
        })
      );
    }
  });
}

async function main() {
  console.log("ui-face E2E: connect and wait for connect.challenge...");

  const face = await connectClient();
  console.log("Face: hello-ok received");

  const sender = await connectClient();
  console.log("Sender: hello-ok received");

  const runId = uuid();
  const id = uuid();
  sender.ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "chat.send",
      params: {
        sessionKey: SESSION_KEY,
        message: "E2E hi",
        deliver: false,
        idempotencyKey: runId,
      },
    })
  );

  const res = await new Promise((resolve, reject) => {
    sender.ws.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.type === "res" && frame.id === id) {
          resolve(frame);
        }
      } catch (_) {}
    });
    setTimeout(() => reject(new Error("chat.send timeout")), 15000);
  });

  if (!res.ok) {
    console.error("chat.send failed:", res.error);
    sender.ws.close();
    face.ws.close();
    process.exit(1);
  }
  console.log("chat.send ok, waiting for face to receive chat event...");

  const chatReceived = await new Promise((resolve, reject) => {
    face.ws.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.type === "event" && frame.event === "chat") {
          const p = frame.payload || {};
          const pk = p.sessionKey;
          const sessionMatch = pk === SESSION_KEY || (typeof pk === "string" && pk.startsWith("agent:" + SESSION_KEY + ":"));
          if (
            sessionMatch &&
            (p.state === "delta" || p.state === "final")
          ) {
            resolve(p);
          }
        }
      } catch (_) {}
    });
    setTimeout(() => reject(new Error("face chat event timeout")), 20000);
  });

  console.log("Face received chat event:", chatReceived.state);
  const text =
    chatReceived.message?.content?.[0]?.text ??
    (typeof chatReceived.message?.content === "string"
      ? chatReceived.message.content
      : "");
  if (text) console.log("Message text (excerpt):", text.slice(0, 80));

  face.ws.close();
  sender.ws.close();
  console.log("ui-face E2E: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
