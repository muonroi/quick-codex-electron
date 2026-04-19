import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");

function resolveElectronCommand() {
  const electronCli = path.join(appDir, "node_modules", "electron", "cli.js");
  if (fs.existsSync(electronCli)) {
    return {
      command: process.execPath,
      argsPrefix: [electronCli]
    };
  }
  return {
    command: process.platform === "win32" ? "electron.cmd" : "electron",
    argsPrefix: []
  };
}

// Electron (Chromium) refuses to run as root unless --no-sandbox is provided.
// We only add it when needed so local (non-root) developer machines keep the sandbox.
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const extraArgs = [];

if (isRoot) {
  extraArgs.push("--no-sandbox");
}

// Common Linux/WSL stability flags.
if (process.platform === "linux") {
  extraArgs.push("--disable-gpu");
}

// If there's no display, prefer running via `npm run dev:xvfb`.
if (process.platform === "linux") {
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!hasDisplay) {
    // Keep this message short; it prints to the terminal in dev workflows.
    // eslint-disable-next-line no-console
    console.error("[qc-electron] No DISPLAY/WAYLAND_DISPLAY detected. Try: npm run dev:xvfb");
  }
}

const electronRuntime = resolveElectronCommand();
const child = spawn(
  electronRuntime.command,
  [...electronRuntime.argsPrefix, ...extraArgs, appDir],
  {
    cwd: appDir,
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error(`[qc-electron] failed to launch Electron host: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
