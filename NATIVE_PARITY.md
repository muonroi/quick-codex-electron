# Electron Host Native Parity

This document is the truth table for how close the Quick Codex Electron host package is to stock Codex native behavior.

It exists to answer one narrow question before Quick Codex automation grows on top:

> Can the Electron host keep enough native Codex behavior that it is safe to treat it as the main automation boundary?

## Status Legend

- `proven-electron`: proven through Electron-host tests or smoke
- `proven-lower-layer`: proven in wrapper-native bridge tests, but not yet re-proven end-to-end through Electron host
- `manual-e2e`: requires real interactive Codex verification today
- `gap`: not proven yet

## Parity Matrix

| Behavior | Current status | Proof basis | Notes |
|----------|----------------|-------------|-------|
| Slash commands (`/status`, `/compact`, `/clear`, `/resume`) | `proven-electron` for session-manager forwarding; `proven-lower-layer` for guarded native execution | `tests/electron-host.test.js`, `tests/wrapper.test.js` | Electron host can forward slash commands into the live native session. Guarded native slash semantics are already proven in the wrapper-native bridge. |
| Autocomplete | `proven-electron` | manual/e2e operator verification on 2026-04-19 | Native slash autocomplete remains usable inside the Electron-hosted native Codex session. |
| Modal / menu selection | `proven-electron` | manual/e2e operator verification on 2026-04-19 plus lower-layer wrapper-native proof | Native model/reasoning menus and popup-style selections stayed usable in Electron host. |
| Model / reasoning switching | `proven-electron` | `tests/electron-host.test.js` | Session-manager restarts the live native session only when routed model/reasoning changes. |
| Session resume behavior | `proven-electron` | Electron-host runtime verification on 2026-04-19 plus lower-layer wrapper-native proof | In Electron host, `/clear` settled via `prompt-ready`, `/resume --last` settled via `prompt-ready`, and a follow-up `/status` also settled via `prompt-ready`, proving the resumed session returned to a stable prompt and accepted the next command. |
| Copy / paste + multiline input | `proven-electron` | manual/e2e verification on 2026-04-19 plus host-boundary clipboard bridge | Electron host now supports keyboard paste, paste events, and context-menu copy/paste in passthrough mode. |
| Terminal resize / scroll behavior | `proven-electron` | Electron-host test coverage plus manual/e2e operator verification on 2026-04-19 | Resize forwarding is covered by tests; live resize and scroll behavior were also confirmed usable in Electron host. |

## Automated Verification

Run these first:

```bash
node --test tests/electron-host.test.js
cd <qc-electron-package-root> && npm run smoke:xvfb
```

What they prove:

- session-manager keeps one live native session across internal orchestrated messages when model/reasoning does not change
- model/reasoning routing restarts the native session when needed
- raw passthrough writes delegate into the native session controller
- slash forwarding delegates into the active native session
- resize requests are forwarded to the live native session
- Electron host still boots and exits cleanly under xvfb

What they do **not** prove:

- no remaining parity gap from the current checklist

## Manual / E2E Checklist

Use this list in a real native Codex session inside Electron host.

Recommended mode:

```bash
cd <qc-electron-package-root>
npm run dev
```

Then verify:

1. `passthrough` mode
   - type directly into Codex and confirm native slash autocomplete still appears
   - open `/model`, change the model, then select a reasoning level
   - confirm multiline input still behaves like stock Codex
   - confirm paste works for both single-line and multiline text
   - resize the window and confirm Codex viewport redraw stays stable
   - scroll up/down in long output and confirm xterm viewport behavior remains usable

2. Internal orchestrated seam
   - used only by tests and migration coverage now
   - keep proof that routed model switches still land in a usable native prompt
   - keep proof that local `/qc slash /status`, `/qc slash /compact`, `/qc slash /clear`, `/qc slash /resume --last` remain safe through the same boundary

3. Resume-specific proof
   - clear or compact the session, then resume the saved thread
   - confirm the restored session lands in a stable prompt and accepts further native input

## Current Verdict

- Electron host is strong enough to act as the native-session control boundary.
- The current native-parity checklist is now fully closed: automated proof plus manual/e2e verification cover the listed behaviors.
- The next safe milestone is QC automation on top of this proven native baseline, not more parity speculation.
