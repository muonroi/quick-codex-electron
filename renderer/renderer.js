/* global Terminal, FitAddon */

const term = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: 13,
  theme: {
    background: "#0b0c10",
    foreground: "rgba(255,255,255,0.92)",
    cursor: "#68d391"
  }
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
const terminalElement = document.getElementById("terminal");
term.open(terminalElement);
fitAddon.fit();

const ACTIVE_MODE = "passthrough";
const dirInput = document.getElementById("dir");
const maxTurnsInput = document.getElementById("maxTurns");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const taskInput = document.getElementById("task");
const sendBtn = document.getElementById("send");
const inputBar = document.getElementById("inputbar");
const routePanel = document.getElementById("routePanel");
const protocolPanel = document.getElementById("protocolPanel");
const followPanel = document.getElementById("followPanel");
const sessionPanel = document.getElementById("sessionPanel");

let sessionStarted = false;
let sessionStatus = null;
let activeSurface = "terminal";
let promptReady = false;
let passthroughCompose = "";
let passthroughLineMode = null;
let passthroughComposing = false;
let testConfig = null;
let testScenarioStarted = false;
const uiState = {
  route: {
    route: "idle",
    source: "none",
    reason: "No routed task yet.",
    promptSource: "none",
    activeRun: "none",
    activeLock: "none"
  },
  protocol: {
    name: "none",
    gate: "none",
    artifact: "none",
    handoff: "none",
    status: "Waiting for the first routed task."
  },
  follow: {
    maxTurns: String(maxTurnsInput.value || 5),
    turnsExecuted: "0",
    decision: "idle",
    action: "none",
    stop: "none",
    phase: "unknown"
  },
  session: {
    mode: "native codex + qc auto",
    dir: dirInput.value.trim() || "default",
    started: "no",
    pending: "no",
    model: "default",
    reasoning: "default",
    approval: "unknown",
    sandbox: "unknown",
    thread: "unknown"
  }
};

dirInput.value = (window.localStorage.getItem("qc_dir") || "").trim();

function writeSystem(line) {
  term.writeln(`\x1b[38;5;243m[qc]\x1b[0m ${line}`);
}

function renderKeyvals(target, rows) {
  target.innerHTML = rows.map(([key, value, tone = ""]) => {
    const safeValue = String(value ?? "");
    const toneClass = tone ? ` ${tone}` : "";
    return `<div class="key">${key}</div><div class="value${toneClass}">${safeValue}</div>`;
  }).join("");
}

function toneForState(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "qc-flow") return "route-flow";
  if (normalized === "qc-lock") return "route-lock";
  if (normalized === "direct") return "route-direct";
  if (normalized === "clarify") return "gate-clarify";
  if (normalized === "research") return "gate-research";
  if (normalized === "plan-check") return "gate-plan-check";
  if (normalized === "execute") return "gate-execute";
  if (normalized === "preflight") return "gate-preflight";
  if (["yes", "active", "execute", "ready", "qc-flow", "qc-lock", "direct", "done"].includes(normalized)) {
    return "good";
  }
  if (["preflight", "clarify", "research", "plan-check", "pending", "in-progress", "waiting"].includes(normalized)) {
    return "warn";
  }
  if (["no", "blocked", "error", "failed"].includes(normalized)) {
    return "bad";
  }
  return "";
}

function compactReason(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return "No route reason recorded.";
  }
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function formatRouteSource(value) {
  const normalized = String(value ?? "unknown");
  return normalized
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatProtocolStatus(protocolName, gate) {
  if (!protocolName || protocolName === "none") {
    return "No enforced QC contract on this turn.";
  }
  if (protocolName === "qc-flow") {
    if (gate === "clarify") return "Clarifying scope and affected area.";
    if (gate === "research") return "Researching missing repo facts.";
    if (gate === "plan-check") return "Waiting for a verified plan.";
    if (gate === "execute") return "Execution is allowed by the run artifact.";
  }
  if (protocolName === "qc-lock") {
    if (gate === "preflight") return "Preflight is proving the lock is safe.";
    if (gate === "execute") return "Locked step execution is active.";
  }
  return "Protocol contract is active for this turn.";
}

function formatFollowAction(action) {
  const normalized = String(action ?? "none");
  if (normalized === "none") {
    return "No follow action queued.";
  }
  return normalized;
}

function renderPanels() {
  renderKeyvals(routePanel, [
    ["verdict", uiState.route.route, toneForState(uiState.route.route)],
    ["source", formatRouteSource(uiState.route.source)],
    ["reason", compactReason(uiState.route.reason)],
    ["prompt", uiState.route.promptSource],
    ["run", uiState.route.activeRun],
    ["lock", uiState.route.activeLock]
  ]);
  renderKeyvals(protocolPanel, [
    ["skill", uiState.protocol.name, toneForState(uiState.protocol.name)],
    ["gate", uiState.protocol.gate, toneForState(uiState.protocol.gate)],
    ["artifact", uiState.protocol.artifact],
    ["handoff", uiState.protocol.handoff],
    ["status", formatProtocolStatus(uiState.protocol.name, uiState.protocol.gate)]
  ]);
  renderKeyvals(followPanel, [
    ["budget", `${uiState.follow.turnsExecuted}/${uiState.follow.maxTurns}`],
    ["decision", uiState.follow.decision, toneForState(uiState.follow.decision)],
    ["action", formatFollowAction(uiState.follow.action)],
    ["stop", uiState.follow.stop, toneForState(uiState.follow.stop)],
    ["phase", uiState.follow.phase]
  ]);
  renderKeyvals(sessionPanel, [
    ["mode", uiState.session.mode],
    ["dir", uiState.session.dir],
    ["started", uiState.session.started, toneForState(uiState.session.started)],
    ["pending", uiState.session.pending, toneForState(uiState.session.pending)],
    ["model", uiState.session.model],
    ["reasoning", uiState.session.reasoning],
    ["approval", uiState.session.approval],
    ["sandbox", uiState.session.sandbox],
    ["thread", uiState.session.thread]
  ]);
}

function focusTerminal() {
  activeSurface = "terminal";
  term.focus();
}

function resetPassthroughCompose() {
  passthroughCompose = "";
  passthroughLineMode = null;
  passthroughComposing = false;
}

function clearLocalComposeEcho() {
  if (!passthroughCompose) {
    return;
  }
  term.write("\u001b[2K\r");
  passthroughCompose = "";
}

function detectPassthroughLineMode(text = "") {
  const chunk = String(text ?? "");
  if (passthroughLineMode) {
    return passthroughLineMode;
  }
  if (passthroughCompose.length === 0 && chunk.startsWith("/")) {
    return "raw";
  }
  return "intercept";
}

function appendLocalPassthroughText(text) {
  const chunk = String(text ?? "");
  if (!chunk) {
    return false;
  }
  passthroughLineMode = detectPassthroughLineMode(chunk);
  if (passthroughLineMode !== "intercept") {
    return false;
  }
  passthroughCompose += chunk;
  term.write(chunk);
  return true;
}

function isTaskInputFocused() {
  return document.activeElement === taskInput;
}

function isEditableElement(element) {
  if (!element) {
    return false;
  }
  const tagName = String(element.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || element.isContentEditable === true;
}

function isTerminalFocused() {
  return document.activeElement === term.textarea || terminalElement.contains(document.activeElement);
}

async function sendClipboardTextToTerminal(text, source = "clipboard") {
  const payload = String(text ?? "");
  if (!payload || ACTIVE_MODE !== "passthrough" || !sessionStarted) {
    return false;
  }
  if (shouldInterceptPassthroughInput() && detectPassthroughLineMode(payload) === "intercept") {
    appendLocalPassthroughText(payload);
    focusTerminal();
    return true;
  }
  const pre = applyPreInputHooks(payload, source);
  if (!pre || pre.handled) {
    return true;
  }
  await window.qc.write(pre.text);
  focusTerminal();
  return true;
}

async function pasteFromClipboard(source = "shortcut") {
  const response = await window.qc.readClipboardText();
  const text = response?.result ?? "";
  if (!text) {
    return false;
  }
  return sendClipboardTextToTerminal(text, source);
}

function updateUiForMode() {
  uiState.session.mode = "native codex + qc auto";
  uiState.follow.maxTurns = String(maxTurnsInput.value || 5);
  if (inputBar) {
    inputBar.style.display = "none";
  }
  renderPanels();
  setTimeout(() => {
    fitAddon.fit();
    resizePty().catch(() => {});
  }, 0);
}

async function resizePty() {
  const cols = term.cols || 120;
  const rows = term.rows || 40;
  await window.qc.resize(cols, rows);
}

window.addEventListener("resize", () => {
  fitAddon.fit();
  resizePty().catch(() => {});
});

const postOutputHooks = [
  (chunk) => chunk
];

function applyPostOutputHooks(chunk) {
  let current = chunk;
  for (const hook of postOutputHooks) {
    const next = hook(current);
    if (next && typeof next === "object" && Object.prototype.hasOwnProperty.call(next, "chunk")) {
      if (next.drop) return null;
      current = next.chunk;
      continue;
    }
    current = next;
  }
  return current;
}

window.qc.onData((data) => {
  const next = applyPostOutputHooks(data);
  if (next == null) return;
  term.write(String(next));
});

window.qc.onExit((data) => {
  writeSystem(`process exited (code=${data.exitCode})`);
});

window.qc.onStarted((data) => {
  sessionStarted = true;
  promptReady = true;
  resetPassthroughCompose();
  uiState.session.started = "yes";
  uiState.session.pending = "no";
  uiState.session.mode = "native codex + qc auto";
  uiState.session.dir = data.dir || "default";
  uiState.follow.maxTurns = String(data.maxTurns || maxTurnsInput.value || 5);
  renderPanels();
  writeSystem(`session started`);
  resizePty().catch(() => {});
  focusTerminal();
  maybeRunTestScenario();
});

window.qc.onStopped(() => {
  sessionStarted = false;
  promptReady = false;
  resetPassthroughCompose();
  uiState.session.started = "no";
  uiState.session.pending = "no";
  uiState.follow.decision = "idle";
  renderPanels();
  writeSystem("session stopped");
});

window.qc.onStatus((data) => {
  sessionStatus = data;
  uiState.session.started = data?.started ? "yes" : "no";
  uiState.session.pending = data?.pendingTask ? "yes" : "no";
  uiState.session.mode = "native codex + qc auto";
  uiState.session.dir = data?.dir || dirInput.value.trim() || "default";
  uiState.session.model = data?.model || "default";
  uiState.session.reasoning = data?.reasoningEffort || "default";
  uiState.session.approval = data?.policy?.approvalPolicy || "unknown";
  uiState.session.sandbox = data?.policy?.sandboxMode || "unknown";
  uiState.session.thread = data?.observer?.sessionId || "unknown";
  uiState.follow.maxTurns = String(data?.maxTurns || maxTurnsInput.value || 5);
  renderPanels();
});

window.qc.onSessionEvent((payload) => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (payload.type === "task-route") {
    uiState.route.route = payload.route || "unknown";
    uiState.route.source = payload.routeSource || "unknown";
    uiState.route.reason = payload.reason || "No route reason recorded.";
    uiState.route.promptSource = payload.promptSource || "unknown";
    uiState.route.activeRun = payload.activeRun || "none";
    uiState.route.activeLock = payload.activeLock || "none";
    uiState.protocol.name = payload.protocolEnforced ? (payload.protocolName || "unknown") : "none";
    uiState.protocol.gate = payload.protocolGate || "none";
    uiState.protocol.artifact = payload.protocolArtifactRun || payload.activeLock || payload.activeRun || "none";
    uiState.protocol.handoff = payload.protocolHandoffArtifactRun || "none";
    uiState.protocol.status = payload.protocolEnforced
      ? "Protocol contract is active."
      : "No enforced QC contract on this turn.";
    renderPanels();
    writeSystem(`route=${uiState.route.route} | source=${uiState.route.source} | prompt=${uiState.route.promptSource}`);
    if (payload.protocolEnforced) {
      writeSystem(`protocol=${payload.protocolName} | gate=${payload.protocolGate} | artifact=${payload.protocolArtifactRun || "none"}`);
    }
    return;
  }
  if (payload.type === "observer") {
    const observerType = payload.event?.type;
    if (observerType === "native-busy") {
      promptReady = false;
    } else if (observerType === "prompt-ready") {
      promptReady = true;
      if (passthroughLineMode === "intercept") {
        resetPassthroughCompose();
      }
    } else if (observerType === "turn-settled") {
      promptReady = false;
    }
    return;
  }
  if (payload.type === "model-route") {
    uiState.session.model = payload.model || "default";
    uiState.session.reasoning = payload.reasoningEffort || "default";
    renderPanels();
    writeSystem(`model=${uiState.session.model} | reasoning=${uiState.session.reasoning} | source=${payload.source || "unknown"}`);
    return;
  }
  if (payload.type === "session-model-ready") {
    uiState.session.model = payload.model || uiState.session.model;
    uiState.session.reasoning = payload.reasoningEffort || uiState.session.reasoning;
    renderPanels();
    return;
  }
  if (payload.type === "task-disambiguation") {
    writeSystem(`task requires disambiguation: ${payload.reason}`);
    for (const option of payload.options || []) {
      writeSystem(`- ${option.label}: ${option.description}`);
    }
    return;
  }
  if (payload.type === "task-result") {
    promptReady = false;
    uiState.session.pending = "no";
    renderPanels();
    writeSystem(`task settled`);
    return;
  }
  if (payload.type === "follow-loop-decision") {
    uiState.follow.decision = payload.shouldStop ? "stop" : "continue";
    uiState.follow.stop = payload.stopReason || "continue";
    uiState.follow.phase = payload.currentPhaseWave || "unknown";
    uiState.protocol.gate = payload.currentGate || uiState.protocol.gate;
    renderPanels();
    writeSystem(`follow=${uiState.follow.decision} | stop=${uiState.follow.stop} | phase=${uiState.follow.phase}`);
    return;
  }
  if (payload.type === "follow-loop-action") {
    uiState.follow.turnsExecuted = String(payload.turn || uiState.follow.turnsExecuted);
    uiState.follow.action = payload.slashCommand || payload.handoffAction || "none";
    renderPanels();
    writeSystem(`follow-action=${uiState.follow.action} | turn=${uiState.follow.turnsExecuted}`);
    return;
  }
  if (payload.type === "follow-loop-finished") {
    uiState.follow.turnsExecuted = String(payload.turnsExecuted || uiState.follow.turnsExecuted);
    uiState.follow.stop = payload.stoppedBecause || "none";
    uiState.follow.decision = payload.stoppedBecause === "completed" ? "done" : "stop";
    renderPanels();
    writeSystem(`follow-finished=${uiState.follow.decision} | stop=${uiState.follow.stop}`);
    return;
  }
  if (payload.type === "progress") {
    writeSystem(payload.entry);
  }
});

function maybeRunTestScenario() {
  if (!testConfig?.injectedInput || testScenarioStarted || !sessionStarted || !promptReady) {
    return;
  }
  testScenarioStarted = true;
  focusTerminal();
  for (const chunk of `${testConfig.injectedInput}\r`) {
    handlePassthroughTerminalData(chunk);
  }
}

async function startSession() {
  const dir = dirInput.value.trim();
  if (dir) {
    window.localStorage.setItem("qc_dir", dir);
  }
  const maxTurns = Number(maxTurnsInput.value || 5);
  await window.qc.startSession({
    mode: ACTIVE_MODE,
    dir: dir || undefined,
    maxTurns,
    cols: term.cols || 120,
    rows: term.rows || 40
  });
  focusTerminal();
}

async function stopSession() {
  await window.qc.stopSession();
}

const preInputHooks = [
  ({ text }) => {
    const trimmed = String(text || "").trim();
    if (!trimmed.startsWith("/qc")) return { text };
    const parts = trimmed.split(/\s+/);
    const cmd = parts[1] || "help";
    const rest = parts.slice(2).join(" ");

    if (cmd === "help") {
      writeSystem("Commands:");
      writeSystem("/qc help");
      writeSystem("/qc start | /qc stop");
      writeSystem("/qc dir <path>");
      writeSystem("/qc turns <n>");
      writeSystem("/qc slash /status|/compact|/clear|/resume --last");
      return { handled: true, text: "" };
    }
    if (cmd === "dir") {
      if (!rest.trim()) {
        writeSystem("Usage: /qc dir <path>");
        return { handled: true, text: "" };
      }
      dirInput.value = rest.trim();
      window.localStorage.setItem("qc_dir", dirInput.value);
      writeSystem(`dir=${dirInput.value}`);
      return { handled: true, text: "" };
    }
    if (cmd === "turns") {
      const next = Number(rest.trim());
      if (!Number.isFinite(next) || next < 1) {
        writeSystem("Usage: /qc turns <positive-integer>");
        return { handled: true, text: "" };
      }
      maxTurnsInput.value = String(next);
      writeSystem(`maxTurns=${next}`);
      return { handled: true, text: "" };
    }
    if (cmd === "start") {
      startSession().catch((e) => writeSystem(`start failed: ${e.message}`));
      return { handled: true, text: "" };
    }
    if (cmd === "stop") {
      stopSession().catch((e) => writeSystem(`stop failed: ${e.message}`));
      return { handled: true, text: "" };
    }
    if (cmd === "slash") {
      const command = rest.trim();
      if (!command.startsWith("/")) {
        writeSystem("Usage: /qc slash /status|/compact|/clear|/resume --last");
        return { handled: true, text: "" };
      }
      window.qc.slash(command).catch((e) => writeSystem(`slash failed: ${e.message}`));
      return { handled: true, text: "" };
    }

    writeSystem("Unknown /qc command. Use /qc help.");
    return { handled: true, text: "" };
  }
];

function applyPreInputHooks(text, source) {
  let current = { text: String(text || ""), source, handled: false };
  for (const hook of preInputHooks) {
    const next = hook(current);
    if (next == null) return null;
    if (next.handled) return { ...current, ...next, handled: true };
    current = { ...current, ...next };
  }
  return current;
}

async function sendTask() {
  const text = taskInput?.value?.trim?.() || "";
  if (!text) return;

  const pre = applyPreInputHooks(text, "taskbox");
  if (!pre) return;
  if (pre.handled) {
    taskInput.value = "";
    return;
  }

  if (ACTIVE_MODE !== "orchestrated") {
    writeSystem("Task box is only used in orchestrated mode.");
    if (taskInput) {
      taskInput.value = "";
    }
    return;
  }

  if (!sessionStarted) {
    await startSession();
  }
  await window.qc.submitTask(pre.text);
  if (taskInput) {
    taskInput.value = "";
  }
}

function shouldInterceptPassthroughInput() {
  return ACTIVE_MODE === "passthrough"
    && sessionStarted
    && activeSurface === "terminal";
}

function isPrintableChunk(data) {
  return /^[^\u0000-\u001f\u007f]+$/u.test(data);
}

async function submitPassthroughInterceptedTask(text) {
  if (!text.trim()) {
    await window.qc.write("\r");
    return;
  }
  term.write("\r\n");
  await window.qc.submitInterceptedTask(text);
}

function flushBufferedLineToNative(prefix = "") {
  const combined = `${passthroughCompose}${prefix}`;
  resetPassthroughCompose();
  if (!combined) {
    return;
  }
  window.qc.write(combined).catch(() => {});
}

function handlePassthroughTerminalData(data) {
  if (shouldInterceptPassthroughInput()) {
    if (passthroughLineMode == null) {
      passthroughLineMode = detectPassthroughLineMode(data);
    }

    if (passthroughLineMode === "intercept") {
      if (data === "\r") {
        const text = passthroughCompose;
        resetPassthroughCompose();
        submitPassthroughInterceptedTask(text).catch((e) => {
          writeSystem(`passthrough submit failed: ${e.message}`);
        });
        return;
      }
      if (data === "\u007f") {
        if (passthroughCompose.length > 0) {
          passthroughCompose = passthroughCompose.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }
      if (data === "\u0015") {
        clearLocalComposeEcho();
        resetPassthroughCompose();
        return;
      }
      if (isPrintableChunk(data)) {
        appendLocalPassthroughText(data);
        return;
      }

      flushBufferedLineToNative();
      passthroughLineMode = "raw";
    }
  }

  const pre = applyPreInputHooks(data, "terminal");
  if (!pre) return;
  if (pre.handled) {
    resetPassthroughCompose();
    return;
  }
  if (passthroughLineMode === "raw" && (data.includes("\r") || data.includes("\n"))) {
    resetPassthroughCompose();
  }
  window.qc.write(pre.text).catch(() => {});
}

startBtn.addEventListener("click", () => startSession().catch((e) => writeSystem(`start failed: ${e.message}`)));
stopBtn.addEventListener("click", () => stopSession().catch((e) => writeSystem(`stop failed: ${e.message}`)));
if (sendBtn) {
  sendBtn.addEventListener("click", () => sendTask().catch((e) => writeSystem(`send failed: ${e.message}`)));
}
maxTurnsInput.addEventListener("input", () => {
  uiState.follow.maxTurns = String(maxTurnsInput.value || 5);
  renderPanels();
});
dirInput.addEventListener("input", () => {
  uiState.session.dir = dirInput.value.trim() || "default";
  renderPanels();
});

if (taskInput) {
  taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendTask().catch((e) => writeSystem(`send failed: ${e.message}`));
    }
  });

  taskInput.addEventListener("focus", () => {
    activeSurface = "task";
  });
}

terminalElement.addEventListener("mousedown", () => {
  setTimeout(() => {
    focusTerminal();
  }, 0);
});

if (term.textarea) {
  term.textarea.addEventListener("compositionstart", () => {
    if (!shouldInterceptPassthroughInput()) {
      return;
    }
    passthroughComposing = true;
  });

  term.textarea.addEventListener("compositionend", () => {
    passthroughComposing = false;
    term.textarea.value = "";
  });

  // Handle committed IME text before xterm turns it into lossy key chunks.
  term.textarea.addEventListener("beforeinput", (event) => {
    if (!shouldInterceptPassthroughInput()) {
      return;
    }
    const inputType = String(event.inputType ?? "");
    const data = String(event.data ?? "");
    const isTextInsert = inputType.startsWith("insert");
    const needsLocalImePath = /[^\u0000-\u007f]/u.test(data)
      || inputType === "insertCompositionText"
      || inputType === "insertFromComposition";
    if (!isTextInsert || !data || !needsLocalImePath) {
      return;
    }
    if (detectPassthroughLineMode(data) !== "intercept") {
      return;
    }
    event.preventDefault();
    appendLocalPassthroughText(data);
    passthroughComposing = false;
    term.textarea.value = "";
  });
}

term.attachCustomKeyEventHandler((event) => {
  const key = String(event.key || "").toLowerCase();
  const isPasteShortcut = ((event.ctrlKey || event.metaKey) && key === "v")
    || (event.shiftKey && key === "insert");
  if (!isPasteShortcut || ACTIVE_MODE !== "passthrough" || !sessionStarted) {
    return true;
  }
  pasteFromClipboard("terminal-shortcut").catch((e) => {
    writeSystem(`paste failed: ${e.message}`);
  });
  return false;
});

document.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const activeElement = document.activeElement;
  const terminalPaste = activeSurface === "terminal" || isTerminalFocused();
  if (!text || !terminalPaste || isEditableElement(activeElement)) {
    return;
  }
  event.preventDefault();
  sendClipboardTextToTerminal(text, "terminal-paste").catch((e) => {
    writeSystem(`paste failed: ${e.message}`);
  });
}, true);

terminalElement.addEventListener("contextmenu", (event) => {
  const terminalContext = activeSurface === "terminal" || isTerminalFocused();
  if (!terminalContext) {
    return;
  }

  const selection = term.getSelection();
  if (selection) {
    event.preventDefault();
    window.qc.writeClipboardText(selection).then(() => {
      writeSystem("copied terminal selection");
      focusTerminal();
    }).catch((e) => {
      writeSystem(`copy failed: ${e.message}`);
    });
    return;
  }

  if (ACTIVE_MODE !== "passthrough" || !sessionStarted) {
    return;
  }

  event.preventDefault();
  pasteFromClipboard("terminal-contextmenu").catch((e) => {
    writeSystem(`paste failed: ${e.message}`);
  });
}, true);

term.onData((data) => {
  if (ACTIVE_MODE !== "passthrough" || !sessionStarted) {
    return;
  }
  handlePassthroughTerminalData(data);
});

updateUiForMode();
focusTerminal();
renderPanels();

writeSystem("ready.");
writeSystem("native codex + qc auto: native Codex stays in the transcript; QC routing panels update separately.");

window.qc.getTestConfig().then(async (response) => {
  testConfig = response?.result || null;
  if (!testConfig?.scenario) {
    return;
  }
  maxTurnsInput.value = String(testConfig.maxTurns || 3);
  updateUiForMode();
  await startSession();
  maybeRunTestScenario();
}).catch((e) => {
  writeSystem(`test-config failed: ${e.message}`);
});

window.qc.onSessionEvent((payload) => {
  if (payload?.type === "observer" && payload.event?.type === "prompt-ready") {
    maybeRunTestScenario();
  }
  if (testConfig?.quitOnFollowFinished && payload?.type === "follow-loop-finished") {
    setTimeout(() => {
      window.qc.quitApp().catch(() => {});
    }, 50);
  }
});
