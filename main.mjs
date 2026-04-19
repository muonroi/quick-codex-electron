import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, clipboard, ipcMain } from "electron";

import { ElectronSessionManager } from "./session-manager.mjs";
import { resolveElectronTestScenario } from "./test-scenarios.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultDir = process.env.QUICK_CODEX_DIR || process.cwd();
const testScenario = process.env.QUICK_CODEX_ELECTRON_TEST_SCENARIO || null;
const testTraceFile = process.env.QUICK_CODEX_ELECTRON_TEST_TRACE_FILE || null;
const resolvedScenario = resolveElectronTestScenario(testScenario);

let win = null;
const sessionManager = resolvedScenario?.sessionManager || new ElectronSessionManager();
const testTrace = [];

function emit(channel, payload) {
  win?.webContents.send(channel, payload);
}

function recordTrace(entry) {
  if (!testTraceFile) {
    return;
  }
  testTrace.push({
    at: Date.now(),
    ...entry
  });
}

function flushTrace() {
  if (!testTraceFile) {
    return;
  }
  fs.mkdirSync(path.dirname(testTraceFile), { recursive: true });
  fs.writeFileSync(testTraceFile, JSON.stringify({
    scenario: testScenario,
    trace: testTrace
  }, null, 2));
}

app.on("window-all-closed", () => {
  sessionManager.stopSession().catch(() => {});
  flushTrace();
  app.quit();
});

app.whenReady().then(() => {
  sessionManager.on("output", (payload) => {
    recordTrace({ channel: "output", payload });
    emit("pty:data", payload.chunk);
  });
  sessionManager.on("started", (payload) => {
    recordTrace({ channel: "started", payload });
    emit("session:started", payload);
  });
  sessionManager.on("stopped", (payload) => {
    recordTrace({ channel: "stopped", payload });
    emit("session:stopped", payload);
  });
  sessionManager.on("status", (payload) => {
    recordTrace({ channel: "status", payload });
    emit("session:status", payload);
  });
  sessionManager.on("session-event", (payload) => {
    recordTrace({ channel: "session-event", payload });
    emit("session:event", payload);
  });

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0c10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  const smokeExitMs = Number(process.env.QUICK_CODEX_ELECTRON_SMOKE_EXIT_MS || 0);
  if (Number.isFinite(smokeExitMs) && smokeExitMs > 0) {
    setTimeout(() => {
      sessionManager.stopSession().catch(() => {}).finally(() => {
        app.quit();
      });
    }, smokeExitMs);
  }

  ipcMain.handle("session:start", async (_evt, payload) => {
    const mode = payload?.mode || "passthrough";
    const dir = payload?.dir || defaultDir;
    const maxTurns = Number(payload?.maxTurns || 5);
    const cols = payload?.cols != null ? Number(payload.cols) : null;
    const rows = payload?.rows != null ? Number(payload.rows) : null;
    const result = await sessionManager.startSession({ mode, dir, maxTurns, cols, rows });
    return { ok: true, result };
  });

  ipcMain.handle("app:test-config:get", () => {
    return {
      ok: true,
      result: {
        scenario: testScenario,
        ...resolvedScenario?.config
      }
    };
  });

  ipcMain.handle("app:quit", () => {
    flushTrace();
    app.quit();
    return { ok: true };
  });

  ipcMain.handle("session:stop", async () => {
    await sessionManager.stopSession();
    return { ok: true };
  });

  ipcMain.handle("session:submit-task", async (_evt, payload) => {
    const result = await sessionManager.submitTask(payload?.task || "");
    return { ok: true, result };
  });

  ipcMain.handle("session:submit-intercepted-task", async (_evt, payload) => {
    const result = await sessionManager.submitInterceptedTask(payload?.task || "");
    return { ok: true, result };
  });

  ipcMain.handle("session:slash", async (_evt, payload) => {
    const result = await sessionManager.slash(payload?.command || "");
    return { ok: true, result };
  });

  ipcMain.handle("session:status:get", () => {
    return { ok: true, result: sessionManager.snapshot() };
  });

  ipcMain.handle("pty:write", async (_evt, payload) => {
    await sessionManager.writeRaw(String(payload?.text || ""));
    return { ok: true };
  });

  ipcMain.handle("pty:resize", (_evt, payload) => {
    const ok = sessionManager.resize(payload?.cols, payload?.rows);
    return { ok };
  });

  ipcMain.handle("clipboard:read-text", () => {
    return { ok: true, result: clipboard.readText() };
  });

  ipcMain.handle("clipboard:write-text", (_evt, payload) => {
    clipboard.writeText(String(payload?.text ?? ""));
    return { ok: true };
  });
});
