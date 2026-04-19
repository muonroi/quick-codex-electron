# quick-codex-electron

Electron host for Quick Codex native UI.

## Local workspace setup

This repo consumes Quick Codex as an external dependency.

Expected sibling layout:

```text
/mnt/d/Personal/Core/
├── quick-codex/
└── quick-codex-electron/
```

Install and run:

```bash
npm install
npm run dev
```

For headless smoke on Linux/WSL:

```bash
npm run smoke:xvfb
```
