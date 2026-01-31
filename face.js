/**
 * ui-face — 全屏脸 + 聊天 + 语音
 * 连接 Moltbot Gateway WebSocket，全屏脸 + 聊天框 + 语音输入/朗读。
 * 使用方式: http://127.0.0.1:18794/?token=你的gateway_token
 */

(function () {
  const DEFAULT_WS_URL = "ws://127.0.0.1:18789";
  const DEFAULT_SESSION_KEY = "main";

  const $ = (id) => document.getElementById(id);
  const face = $("face");
  const bubble = $("bubble");
  const statusEl = $("status");
  const authPrompt = $("auth-prompt");
  const messagesEl = $("messages");
  const chatInput = $("chat-input");
  const btnSend = $("btn-send");
  const btnMic = $("btn-mic");
  const btnMicContinuous = $("btn-mic-continuous");
  const btnStopRead = $("btn-stop-read");
  const thinkingArea = $("thinking-area");
  const thinkingContent = $("thinking-content");

  function parseUrl() {
    const u = new URL(window.location.href);
    const token = u.searchParams.get("token")?.trim();
    const sessionKey = u.searchParams.get("session")?.trim() || DEFAULT_SESSION_KEY;
    const wsHost = u.searchParams.get("ws")?.trim();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = wsHost
      ? (wsHost.startsWith("ws") ? wsHost : `${proto}://${wsHost}`)
      : DEFAULT_WS_URL;
    return { token, wsUrl, sessionKey };
  }

  function setFaceState(state) {
    if (!face) return;
    face.classList.remove("state-idle", "state-thinking", "state-speaking", "state-listening");
    face.classList.add("state-" + (state || "idle"));
  }

  function triggerQuickBlink() {
    if (!face) return;
    face.classList.add("blink-once");
    setTimeout(function () {
      if (face) face.classList.remove("blink-once");
    }, 320);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setBubble(text) {
    if (!bubble) return;
    if (text) {
      bubble.textContent = text;
      bubble.classList.remove("hidden");
    } else {
      bubble.textContent = "";
      bubble.classList.add("hidden");
    }
  }

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Format raw LLM/API error (e.g. "429 {...}") for display, same as TUI formatRawAssistantErrorForUi. */
  function formatErrorForUi(raw) {
    var trimmed = (raw && typeof raw === "string" ? raw : "").trim();
    if (!trimmed) return "请求失败，未知错误";
    var httpMatch = trimmed.match(/^(?:http\s*)?(\d{3})\s+(.+)$/i);
    if (httpMatch) {
      var code = httpMatch[1];
      var rest = httpMatch[2].trim();
      if (!rest.startsWith("{")) return "HTTP " + code + ": " + rest;
      try {
        var payload = JSON.parse(rest);
        var err = payload && payload.error && typeof payload.error === "object" ? payload.error : payload;
        var msg = err && typeof err.message === "string" ? err.message : (typeof payload.message === "string" ? payload.message : null);
        var type = err && typeof err.type === "string" ? err.type : (typeof payload.type === "string" ? payload.type : null);
        var reqId = typeof payload.request_id === "string" ? payload.request_id : (typeof payload.requestId === "string" ? payload.requestId : null);
        if (msg) {
          var prefix = "HTTP " + code;
          var typePart = type ? " " + type : "";
          var idPart = reqId ? " (request_id: " + reqId + ")" : "";
          return prefix + typePart + ": " + msg + idPart;
        }
      } catch (e) { /* ignore */ }
      return "HTTP " + code + ": " + (rest.length > 200 ? rest.slice(0, 200) + "…" : rest);
    }
    return trimmed.length > 300 ? trimmed.slice(0, 300) + "…" : trimmed;
  }

  /** 朗读前去掉 Markdown 与多余空白，避免 TTS 读"星号""连词"等。 */
  function stripMarkdownForTts(text) {
    if (typeof text !== "string") return "";
    var s = text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return s;
  }

  function extractTextFromMessage(message) {
    if (!message || typeof message !== "object") return null;
    const m = message;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts = content
        .map((p) => (p && p.type === "text" && typeof p.text === "string" ? p.text : null))
        .filter(Boolean);
      if (parts.length) return parts.join("\n");
    }
    if (typeof m.text === "string") return m.text;
    if (m.stopReason === "error" && typeof m.errorMessage === "string") return formatErrorForUi(m.errorMessage);
    return null;
  }

  function isQuickReplyMessage(msg) {
    if (!msg || typeof msg !== "string") return false;
    var t = msg.trim();
    if (t.length > 12) return false;
    var lower = t.toLowerCase();
    var greetings = [
      "你好", "您好", "hi", "hello", "hey", "在吗", "在么", "哈喽", "嗨", "早", "晚安",
      "在", "喂", "嗯", "啊", "哈", "嘿", "哦", "嗨嗨", "hello!", "hi!", "hey!"
    ];
    for (var i = 0; i < greetings.length; i++) if (lower === greetings[i] || t === greetings[i]) return true;
    if (/^[\u4e00-\u9fa5a-zA-Z\s]{1,8}$/.test(t)) return true;
    return false;
  }

  function appendMessage(role, text, isStreaming) {
    if (!messagesEl) return;
    const div = document.createElement("div");
    div.className = "msg " + role + (isStreaming ? " streaming" : "");
    div.textContent = text || "";
    div.setAttribute("data-role", role);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateStreamingMessage(el, text) {
    if (el) {
      el.textContent = text;
      el.classList.add("streaming");
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function finishStreamingMessage(el) {
    if (el) el.classList.remove("streaming");
  }

  function setThinkingVisible(visible) {
    if (thinkingArea) {
      if (visible) thinkingArea.classList.remove("hidden");
      else thinkingArea.classList.add("hidden");
    }
  }
  function setThinkingText(text) {
    if (thinkingContent) thinkingContent.textContent = text || "";
  }
  function appendThinkingText(text) {
    if (thinkingContent && text) thinkingContent.appendChild(document.createTextNode(text));
  }

  function runFace(token, wsUrl, sessionKey) {
    let ws = null;
    let pending = new Map();
    let connected = false;
    let chatRunId = null;
    let chatStream = "";
    let streamingMsgEl = null;
    let connectSent = false;
    let ttsEnabled = typeof speechSynthesis !== "undefined" && speechSynthesis.speak;
    let thinkingTimeout = null;
    let finalWaitTimeout = null;
    let emptyFinalDeferTimer = null;
    let hasSpokenThisReply = false;
    let isTTSPlaying = false;
    var lastShownFinalRunId = null;
    var lastAssistantBubbleEl = null;
    var isSecureContext = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    var pendingTTSTimer = null;
    var lastFinalText = "";
    var sentMessageByRunId = {};

    function log(msg, obj) {
      var ts = new Date().toISOString();
      var line = ts + " [ui-face] " + (typeof msg === "string" ? msg : String(msg)) + (obj !== undefined ? " " + JSON.stringify(obj) : "");
      console.log(line);
      fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg: line }) }).catch(function () {});
    }
    log("runFace started sessionKey=" + sessionKey + " wsUrl=" + wsUrl);

    function connect() {
      setStatus("连接中…");
      setFaceState("idle");
      connectSent = false;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws._soulFallbackTimer = setTimeout(function () {
          if (!connectSent) sendConnect();
        }, 500);
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data);
          if (frame.type === "event") {
            if (frame.event === "connect.challenge") {
              if (ws._soulFallbackTimer) {
                clearTimeout(ws._soulFallbackTimer);
                ws._soulFallbackTimer = null;
              }
              sendConnect();
            } else {
              handleEvent(frame);
            }
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
          console.warn("[soul] parse message", e);
        }
      };
      ws.onclose = (ev) => {
        ws = null;
        connected = false;
        setButtonsEnabled(false);
        setFaceState("idle");
        setStatus("已断开 (" + (ev.reason || ev.code) + ")");
        setBubble("");
        for (const [, rej] of pending) rej(new Error("closed"));
        pending.clear();
        if (ev.code !== 1012) setTimeout(connect, 2000);
      };
      ws.onerror = () => {};
    }

    function sendConnect() {
      if (connectSent) return;
      connectSent = true;
      const params = {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "webchat-ui",
          version: "soul",
          platform: navigator.platform || "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
        auth: token ? { token } : undefined,
        userAgent: navigator.userAgent,
        locale: navigator.language,
      };
      request("connect", params)
        .then((hello) => {
          connected = true;
          setStatus("Gateway 已连接");
          setFaceState("idle");
          setButtonsEnabled(true);
        })
        .catch((err) => {
          connectSent = false;
          setStatus("连接失败: " + (err.message || err));
          setFaceState("idle");
        });
    }

    function request(method, params) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("not connected"));
          return;
        }
        const id = uuid();
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ type: "req", id, method, params }));
      });
    }

    function clearThinkingTimeout() {
      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }
    }
    function clearFinalWaitTimeout() {
      if (finalWaitTimeout) {
        clearTimeout(finalWaitTimeout);
        finalWaitTimeout = null;
      }
    }
    function clearEmptyFinalDefer() {
      if (emptyFinalDeferTimer) {
        clearTimeout(emptyFinalDeferTimer);
        emptyFinalDeferTimer = null;
      }
    }

    function sendMessage(text) {
      const msg = (text || "").trim();
      if (!msg || !connected) return;
      log("sendMessage msgLen=" + msg.length + " connected=" + connected);
      log("sendMessage requestText=" + (msg.length > 120 ? msg.slice(0, 120) + "…" : msg));
      appendMessage("user", msg, false);
      if (chatInput) chatInput.value = "";
      setFaceState("thinking");
      clearThinkingTimeout();
      setThinkingVisible(true);
      setThinkingText("等待思考过程…");
      hasSpokenThisReply = false;
      lastShownFinalRunId = null;
      lastAssistantBubbleEl = null;
      clearEmptyFinalDefer();
      const runId = uuid();
      chatRunId = runId;
      chatStream = "";
      sentMessageByRunId[runId] = msg;
      log("sendMessage runId=" + runId.slice(0, 8) + " sessionKey=" + sessionKey);
      streamingMsgEl = appendMessage("assistant", "思考中…", true);
      thinkingTimeout = setTimeout(function () {
        thinkingTimeout = null;
        clearFinalWaitTimeout();
        if (streamingMsgEl && !chatStream) {
          log("thinkingTimeout fired, no chatStream, showing 请求超时");
          streamingMsgEl.textContent = "请求超时，请重试";
          finishStreamingMessage(streamingMsgEl);
          streamingMsgEl = null;
          chatRunId = null;
          setThinkingVisible(false);
          setFaceState("idle");
          setStatus("请求超时");
        }
      }, 30000);
      request("chat.send", {
        sessionKey: sessionKey,
        message: msg,
        deliver: false,
        idempotencyKey: runId,
      }).then(function (ack) {
        log("chat.send ack", ack ? { ok: true, runId: ack.runId, status: ack.status } : { ok: false });
      }).catch((err) => {
        clearThinkingTimeout();
        clearFinalWaitTimeout();
        clearEmptyFinalDefer();
        setThinkingVisible(false);
        setFaceState("idle");
        if (streamingMsgEl) {
          streamingMsgEl.textContent = "发送失败: " + (err.message || err);
          finishStreamingMessage(streamingMsgEl);
        }
        streamingMsgEl = null;
        log("chat.send failed " + (err && err.message ? err.message : ""));
        setStatus("发送失败: " + (err.message || err));
      });
    }

    function handleEvent(frame) {
      if (frame.event === "chat") {
        var cp = frame.payload || {};
        log("event chat state=" + (cp.state || "?") + " runId=" + (cp.runId ? String(cp.runId).slice(0, 8) : "?") + " sessionKey=" + (cp.sessionKey || "?") + " seq=" + (cp.seq != null ? cp.seq : "?"));
      }
      if (frame.event === "agent") {
        var p = frame.payload || {};
        var runId = p.runId;
        if (runId !== chatRunId) return;
        var data = p.data || {};
        var thinking = typeof data.thinking === "string" ? data.thinking.trim() : null;
        if (thinking) {
          setThinkingVisible(true);
          if (thinkingContent) {
            var cur = thinkingContent.textContent || "";
            var isPlaceholder = cur === "等待思考过程…";
            if (isPlaceholder || thinking.length >= cur.length) thinkingContent.textContent = thinking;
          }
        }
        if (p.stream === "assistant" && typeof data.text === "string" && data.text.length > 0) {
          setThinkingVisible(false);
        }
        var phase = typeof data.phase === "string" ? data.phase : "";
        if (p.stream === "lifecycle" && (phase === "end" || phase === "error")) {
          log("agent lifecycle phase=" + phase + " (no chat final from agent path)");
          clearThinkingTimeout();
          setThinkingVisible(false);
          chatRunId = null;
          setFaceState("idle");
          clearFinalWaitTimeout();
          finalWaitTimeout = setTimeout(function () {
            finalWaitTimeout = null;
            if (streamingMsgEl) {
              streamingMsgEl.textContent = "思考中";
              finishStreamingMessage(streamingMsgEl);
              streamingMsgEl = null;
            }
          }, 3000);
        }
        return;
      }
      if (frame.event === "chat") {
        const p = frame.payload || {};
        const pk = p.sessionKey;
        const sessionMatch = pk === sessionKey || (typeof pk === "string" && pk.startsWith("agent:" + sessionKey + ":"));
        if (!sessionMatch) {
          log("event chat ignored sessionKey mismatch payload=" + (pk || "?") + " ours=" + sessionKey);
          return;
        }
        if (p.state === "delta") {
          clearThinkingTimeout();
          const text = extractTextFromMessage(p.message);
          log("chat delta hasMessage=" + (p.message ? "yes" : "no") + " textLen=" + (typeof text === "string" ? text.length : 0) + " chatStreamLenBefore=" + chatStream.length);
          if (typeof text === "string") {
            const current = chatStream;
            if (!current || text.length >= current.length) chatStream = text;
            log("chat delta applied chatStreamLen=" + chatStream.length + " preview=" + (chatStream.slice(0, 40) || "(empty)"));
            if (chatStream.length > 0) {
              setThinkingVisible(false);
              setFaceState("speaking");
            }
          }
        } else if (p.state === "final" || p.state === "aborted" || p.state === "error") {
          var errMsgForCheck = typeof p.errorMessage === "string" ? p.errorMessage.trim() : "";
          var allowErrorRunIdMismatch = p.state === "error" && errMsgForCheck.length > 0;
          if (p.runId && chatRunId && p.runId !== chatRunId) {
            if (!allowErrorRunIdMismatch) {
              log("event chat " + p.state + " ignored runId mismatch payload=" + String(p.runId).slice(0, 8) + " ours=" + String(chatRunId).slice(0, 8));
              return;
            }
            log("event chat error accepted despite runId mismatch (showing errorMessage)");
          }
          clearThinkingTimeout();
          clearFinalWaitTimeout();
          setThinkingVisible(false);
          var textFromPayload = extractTextFromMessage(p.message);
          var finalText = (typeof textFromPayload === "string" ? textFromPayload.trim() : "") || chatStream.trim();
          var errMsg = typeof p.errorMessage === "string" ? p.errorMessage.trim() : "";
          if (!finalText && errMsg) finalText = formatErrorForUi(errMsg);
          if (!finalText) finalText = "思考中";
          var isPlaceholderNoResponse = finalText === "思考中";
          var isRealReply = finalText && !/^（/.test(finalText) && !isPlaceholderNoResponse;
          var requestText = (p.runId && sentMessageByRunId[p.runId]) ? String(sentMessageByRunId[p.runId]) : "(unknown)";
          if (p.runId) delete sentMessageByRunId[p.runId];
          log("chat " + p.state + " requestText=" + (requestText.length > 80 ? requestText.slice(0, 80) + "…" : requestText));
          log("chat " + p.state + " payloadMessage=" + (p.message ? "yes" : "no") + " textFromPayloadLen=" + (typeof textFromPayload === "string" ? textFromPayload.length : 0) + " chatStreamLen=" + chatStream.length + " finalTextLen=" + finalText.length + " isPlaceholder=" + (/^（/.test(finalText)) + " isRealReply=" + isRealReply);
          log("chat " + p.state + " finalTextPreview=" + (finalText ? finalText.slice(0, 60) : "(empty)"));
          if (!isRealReply && streamingMsgEl) {
            log("deferring empty final 5min (wait for next final with content, single-shot HTTP)");
            clearFinalWaitTimeout();
            clearEmptyFinalDefer();
            emptyFinalDeferTimer = setTimeout(function () {
              emptyFinalDeferTimer = null;
              log("empty final 5min timeout, showing placeholder (no second final received)");
              if (streamingMsgEl) {
                streamingMsgEl.textContent = "我脑子坏了\n\n排查 API/model 是否可用";
                finishStreamingMessage(streamingMsgEl);
                streamingMsgEl = null;
              }
              chatStream = "";
              chatRunId = null;
              setFaceState("thinking");
            }, 300000);
            return;
          }
          clearEmptyFinalDefer();
          chatStream = "";
          setBubble("");
          var elToShow = streamingMsgEl;
          if (elToShow) {
            updateStreamingMessage(elToShow, finalText);
            finishStreamingMessage(elToShow);
          } else if (p.runId && lastShownFinalRunId === p.runId && lastAssistantBubbleEl) {
            updateStreamingMessage(lastAssistantBubbleEl, finalText);
            finishStreamingMessage(lastAssistantBubbleEl);
            elToShow = lastAssistantBubbleEl;
          } else {
            elToShow = appendMessage("assistant", finalText, false);
          }
          lastShownFinalRunId = p.runId || null;
          lastAssistantBubbleEl = elToShow;
          streamingMsgEl = null;
          chatRunId = null;
          var isRealReplyForTts = finalText && !/^（/.test(finalText) && !isPlaceholderNoResponse;
          if (isRealReplyForTts) {
            setFaceState("speaking");
          }
          if (isRealReplyForTts && ttsEnabled && !hasSpokenThisReply) {
            hasSpokenThisReply = true;
            lastFinalText = finalText;
            if (pendingTTSTimer) clearTimeout(pendingTTSTimer);
            pendingTTSTimer = setTimeout(function () {
              pendingTTSTimer = null;
              if (!lastFinalText) {
                setFaceState("idle");
                return;
              }
              if (lastFinalText.length < 8) {
                setFaceState("idle");
                return;
              }
              isTTSPlaying = true;
              if (btnStopRead) btnStopRead.classList.remove("hidden");
              var toSpeak = stripMarkdownForTts(lastFinalText).slice(0, 500);
              try {
                var u = new SpeechSynthesisUtterance(toSpeak);
                u.lang = document.documentElement.lang || "zh-CN";
                u.rate = 0.95;
                u.onend = function () {
                  isTTSPlaying = false;
                  if (btnStopRead) btnStopRead.classList.add("hidden");
                  setFaceState("idle");
                };
                u.onerror = function () {
                  isTTSPlaying = false;
                  if (btnStopRead) btnStopRead.classList.add("hidden");
                  setFaceState("idle");
                };
                speechSynthesis.speak(u);
              } catch (_) {
                isTTSPlaying = false;
                if (btnStopRead) btnStopRead.classList.add("hidden");
                setFaceState("idle");
              }
            }, 1800);
          } else if (isRealReplyForTts) {
            setTimeout(function () { setFaceState("idle"); }, 2500);
          } else {
            setFaceState("idle");
          }
        }
        return;
      }
    }

    function setButtonsEnabled(enabled) {
      if (btnSend) btnSend.disabled = !enabled;
      if (btnMic && recognition) btnMic.disabled = !enabled || !isSecureContext;
    }
    setButtonsEnabled(false);

    connect();
    /* 连接成功后在 sendConnect 的 .then() 里会 setButtonsEnabled(true) */

    /* 发送按钮 / 回车 */
    function onSend() {
      var msg = chatInput ? chatInput.value.trim() : "";
      if (!connected) {
        setStatus("请稍候，正在连接…");
        return;
      }
      if (!msg) {
        setStatus("输入点什么再发吧");
        if (chatInput) chatInput.focus();
        return;
      }
      sendMessage(msg);
    }
    if (btnSend) {
      btnSend.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onSend();
      });
    }
    if (chatInput) {
      chatInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      });
    }

    if (btnStopRead) {
      btnStopRead.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!isTTSPlaying) return;
        try {
          speechSynthesis.cancel();
        } catch (_) {}
        isTTSPlaying = false;
        btnStopRead.classList.add("hidden");
        setFaceState("idle");
      });
    }

    /* 语音输入：语音=说完整句发一次；持续监听=小爱同学式，说唤醒词后说完、静默再发，同级别两个按钮 */
    var recognition = null;
    /** 当前会话模式："one-shot" 语音输入 | "continuous" 持续监听 */
    var listenMode = "one-shot";
    var stoppedForSend = false;
    var continuousClearTimer = null;
    var clearOnRestart = false;
    var SILENCE_SEND_MS = 1800;
    var silenceSendTimer = null;
    /** 持续监听：刚发送过的内容及时间，用于避免晚到的 final 导致重复发送 */
    var lastSentFromContinuous = "";
    var lastSentFromContinuousTime = 0;
    var wakeWordInput = $("wake-word-input");
    function getWakeWord() {
      var v = wakeWordInput && wakeWordInput.value ? wakeWordInput.value.trim() : "";
      return v || "花花";
    }
    try {
      if (wakeWordInput) {
        try {
          var saved = localStorage.getItem("ui-face-wake-word");
          if (saved && saved.trim()) wakeWordInput.value = saved.trim();
        } catch (_) {}
        wakeWordInput.addEventListener("change", function () {
          try { localStorage.setItem("ui-face-wake-word", getWakeWord()); } catch (_) {}
        });
        wakeWordInput.addEventListener("blur", function () {
          try { localStorage.setItem("ui-face-wake-word", getWakeWord()); } catch (_) {}
        });
      }
    } catch (_) {}
    try {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) recognition = new SpeechRecognition();
    } catch (_) {}
    if (recognition) {
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = (document.documentElement.lang || "zh-CN").replace("-", "_");
      recognition.maxAlternatives = 1;
      recognition.onstart = function () {
        stoppedForSend = false;
        clearOnRestart = false;
        lastSentFromContinuous = "";
        lastSentFromContinuousTime = 0;
        if (silenceSendTimer) clearTimeout(silenceSendTimer);
        silenceSendTimer = null;
        if (continuousClearTimer) clearInterval(continuousClearTimer);
        continuousClearTimer = null;
        var isContinuous = listenMode === "continuous";
        if (isContinuous) {
          continuousClearTimer = setInterval(function () {
            if (btnMicContinuous && btnMicContinuous.classList.contains("recording")) {
              clearOnRestart = true;
              try { recognition.stop(); } catch (_) {}
            }
          }, 30000);
        }
        setFaceState("listening");
        setStatus("正在听… 请说话" + (isContinuous ? "（说「" + getWakeWord() + "」后说完话，停一下再发；再次点击结束；约 30 秒无唤醒会清空重听）" : "（说完整句后填入输入框，由您点击发送）"));
        if (btnMic && listenMode === "one-shot") btnMic.classList.add("recording");
        if (btnMicContinuous && listenMode === "continuous") btnMicContinuous.classList.add("recording");
        if (chatInput) chatInput.value = "";
      };
      recognition.onend = function () {
        var keepListening = !stoppedForSend && listenMode === "continuous" && btnMicContinuous && btnMicContinuous.classList.contains("recording");
        if (keepListening) {
          if (clearOnRestart && chatInput) chatInput.value = "";
          clearOnRestart = false;
          setTimeout(function () {
            if (btnMicContinuous && btnMicContinuous.classList.contains("recording")) {
              try { recognition.start(); } catch (_) {}
            }
          }, 150);
          return;
        }
        if (silenceSendTimer) clearTimeout(silenceSendTimer);
        silenceSendTimer = null;
        if (continuousClearTimer) clearInterval(continuousClearTimer);
        continuousClearTimer = null;
        setFaceState("idle");
        if (connected) setStatus("Gateway 已连接");
        if (btnMic) btnMic.classList.remove("recording");
        if (btnMicContinuous) btnMicContinuous.classList.remove("recording");
      };
      recognition.onresult = function (ev) {
        var full = "";
        var hasFinal = false;
        for (var i = 0; i < ev.results.length; i++) {
          var r = ev.results[i];
          full += r[0].transcript;
          if (r.isFinal) hasFinal = true;
        }
        if (chatInput) chatInput.value = full;
        if (!hasFinal) return;
        var isContinuous = listenMode === "continuous";
        if (isContinuous) {
          var wake = getWakeWord();
          var idx = full.indexOf(wake);
          if (idx === -1) return;
          var after = full.slice(idx + wake.length).trim();
          if (!after) {
            setStatus("请说出指令");
            if (silenceSendTimer) clearTimeout(silenceSendTimer);
            silenceSendTimer = null;
            return;
          }
          var now = Date.now();
          if (after === lastSentFromContinuous && (now - lastSentFromContinuousTime) < 4000) {
            if (silenceSendTimer) clearTimeout(silenceSendTimer);
            silenceSendTimer = null;
            return;
          }
          if (silenceSendTimer) clearTimeout(silenceSendTimer);
          silenceSendTimer = setTimeout(function () {
            silenceSendTimer = null;
            var txt = (chatInput && chatInput.value) ? String(chatInput.value) : "";
            var w = getWakeWord();
            var i = txt.indexOf(w);
            var toSend = (i >= 0 ? txt.slice(i + w.length).trim() : txt.trim()) || "";
            if (!toSend) return;
            var t = Date.now();
            if (toSend === lastSentFromContinuous && (t - lastSentFromContinuousTime) < 3000) {
              if (chatInput) chatInput.value = "";
              return;
            }
            lastSentFromContinuous = toSend;
            lastSentFromContinuousTime = t;
            sendMessage(toSend);
            setStatus("已发送：" + (toSend.length > 24 ? toSend.slice(0, 24) + "…" : toSend));
            if (chatInput) chatInput.value = "";
          }, SILENCE_SEND_MS);
        } else {
          if (full.trim()) {
            recognition.stop();
            setStatus("识别完成，可编辑后点击发送");
          } else {
            setStatus("未识别到内容，请再试一次");
          }
        }
      };
      recognition.onerror = function (ev) {
        var err = ev.error || "";
        if (err === "aborted") return;
        setFaceState("idle");
        if (btnMic) btnMic.classList.remove("recording");
        if (btnMicContinuous) btnMicContinuous.classList.remove("recording");
        if (err === "not-allowed") setStatus("麦克风被拒绝或当前不可用。若刚拔掉外接麦克风，请连接麦克风或检查系统默认输入设备后刷新重试；若之前点过「拒绝」，请到地址栏锁/信息 → 网站设置 → 麦克风改为「允许」后刷新。");
        else if (err === "no-speech") setStatus("未检测到语音，请靠近麦克风说话后重试");
        else if (err === "network") setStatus("语音识别需要网络");
        else if (err) setStatus("语音识别失败: " + err);
      };
      function isRecording() {
        return (btnMic && btnMic.classList.contains("recording")) || (btnMicContinuous && btnMicContinuous.classList.contains("recording"));
      }
      function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      }
      function startVoice(continuous) {
        listenMode = continuous ? "continuous" : "one-shot";
        recognition.continuous = continuous;
        setStatus("正在请求麦克风权限… 请在弹出的窗口中点击「允许」");
        var doStart = function () {
          try { recognition.start(); } catch (err) {
            setStatus("语音识别启动失败: " + (err.message || err.name));
          }
        };
        if (isIOS()) {
          doStart();
        } else if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
          navigator.mediaDevices.getUserMedia({ audio: {} })
            .then(function (stream) {
              stream.getTracks().forEach(function (t) { t.stop(); });
              doStart();
            })
            .catch(function (err) {
              var name = err.name || "";
              if (name === "NotAllowedError" || name === "PermissionDeniedError") {
                setStatus("麦克风被拒绝。若之前点过「拒绝」，请到地址栏锁/信息 → 网站设置 → 麦克风改为「允许」后刷新。");
              } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
                setStatus("未检测到麦克风设备。请连接麦克风（或插回外接麦克风）并检查系统默认输入设备后刷新重试。");
              } else if (name === "NotReadableError" || name === "TrackStartError") {
                setStatus("麦克风不可用（可能被占用或已断开）。请连接麦克风或检查系统默认输入后刷新重试。");
              } else {
                doStart();
              }
            });
        } else {
          doStart();
        }
      }
      if (btnMic) {
        if (!isSecureContext) btnMic.title = "麦克风需在 HTTPS 或 localhost 下使用（当前为不安全连接）";
        btnMic.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!isSecureContext) { setStatus("麦克风需在 HTTPS 或 localhost 下使用，当前为不安全连接"); return; }
          if (!connected) { setStatus("请稍候，正在连接…"); return; }
          if (isRecording()) {
            if (btnMic) btnMic.classList.remove("recording");
            if (btnMicContinuous) btnMicContinuous.classList.remove("recording");
            recognition.stop();
            return;
          }
          startVoice(false);
        });
      }
      if (btnMicContinuous) {
        if (!isSecureContext) btnMicContinuous.title = "麦克风需在 HTTPS 或 localhost 下使用（当前为不安全连接）";
        btnMicContinuous.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!isSecureContext) { setStatus("麦克风需在 HTTPS 或 localhost 下使用，当前为不安全连接"); return; }
          if (!connected) { setStatus("请稍候，正在连接…"); return; }
          if (isRecording()) {
            if (btnMic) btnMic.classList.remove("recording");
            if (btnMicContinuous) btnMicContinuous.classList.remove("recording");
            recognition.stop();
            return;
          }
          startVoice(true);
        });
      }
    } else {
      if (btnMic) { btnMic.disabled = true; btnMic.title = "当前浏览器不支持语音识别，请用 Chrome 或 Edge"; }
      if (btnMicContinuous) { btnMicContinuous.disabled = true; btnMicContinuous.title = "当前浏览器不支持语音识别，请用 Chrome 或 Edge"; }
    }
  }

  function main() {
    const { token, wsUrl, sessionKey } = parseUrl();
    if (authPrompt) authPrompt.classList.add("hidden");
    if (!token) {
      if (authPrompt) authPrompt.classList.remove("hidden");
      setStatus("请在 URL 加上 ?token=你的gateway_token");
      if (face) face.classList.add("state-idle");
      return;
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setStatus("当前为 HTTP 不安全连接，麦克风需在 HTTPS 或 localhost 下使用");
    }
    runFace(token, wsUrl, sessionKey);
  }

  main();
})();
