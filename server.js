#!/usr/bin/env node
/**
 * 在独立端口提供 ui-face 静态资源，与 Moltbot Gateway 共存。
 * 默认端口 18794（18789–18793 多为 gateway 占用），可通过环境变量 FACE_PORT 覆盖。
 *
 * 用法:
 *   node server.js
 *   npm start
 *   FACE_PORT=18800 node server.js
 *
 * 打开: http://127.0.0.1:18794/?token=你的gateway_token
 *
 * 日志: 请求与前端上报的 [ui-face] 日志写入 logs/face.log，便于排查。
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.FACE_PORT || "18794", 10);
const DIR = path.resolve(__dirname);
const LOGS_DIR = path.join(DIR, "logs");
const LOG_FILE = path.join(LOGS_DIR, "face.log");

try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (e) {
  console.error("[ui-face server] mkdir logs failed", e);
}

function appendLog(line) {
  var full = new Date().toISOString() + " " + line;
  console.log("[face.log] " + line);
  try {
    fs.appendFileSync(LOG_FILE, full + "\n", "utf8");
  } catch (e) {
    console.error("[ui-face server] appendLog failed", e);
  }
}

const MIMES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const method = req.method || "GET";

  if (method === "POST" && (url.pathname === "/api/log" || url.pathname === "/api/log/")) {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const msg = typeof data.msg === "string" ? data.msg : String(body);
        appendLog("[client] " + msg);
      } catch (e) {
        appendLog("[client] (invalid body) " + (body || "").slice(0, 200));
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  appendLog("[server] " + method + " " + url.pathname);

  let file = url.pathname === "/" || url.pathname === "" ? "index.html" : url.pathname.replace(/^\//, "");
  if (file.endsWith("/")) file += "index.html";
  const safe = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.resolve(DIR, safe);

  if (!filePath.startsWith(DIR) || filePath === DIR) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIMES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      appendLog("[server] " + (err.code === "ENOENT" ? "404" : "500") + " " + url.pathname);
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not Found" : "Error");
      return;
    }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ui-face: http://127.0.0.1:${PORT}/`);
  console.log(`         http://localhost:${PORT}/`);
  console.log(`Add token: http://127.0.0.1:${PORT}/?token=YOUR_GATEWAY_TOKEN`);
  console.log(`Log file:  ${LOG_FILE}`);
  appendLog("server started (must open page from this port for client logs)");
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use. Try: FACE_PORT=18795 node server.js`);
  }
  throw err;
});
