# Contributing to Bivor

Thanks for your interest in contributing!

## Development setup

Requirements: macOS (Apple Silicon or Intel), Node.js ≥ 20, [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # electron-vite dev with HMR
```

Before submitting a change, make sure the project type-checks:

```bash
pnpm typecheck
```

## Project layout

- `src/main/` — Electron main process: windows, menu, chat process orchestration, global services
- `src/host/` — agent host running in utility processes: embeds the pi SDK runtime, tools, sandbox, guardrails
- `src/preload/` — typed contextBridge API
- `src/renderer/` — React 19 UI; the event-stream reducer lives in `stores/app-store.ts`
- `src/shared/` — protocol types, runtime presets, and i18n locales shared across processes

When changing the IPC surface, update `src/shared/protocol.ts` first and let the types propagate through preload, main, host, and renderer.

## Guidelines

- Keep changes focused; one feature or fix per pull request.
- User-facing strings must go through the i18n system (`src/shared/locales/`) with both `en` and `zh` entries.
- Never commit API keys, tokens, or personal config. Keys belong in `~/.pi/agent/auth.json` or the app settings, not in the repo.
- Manual verification: run the relevant E2E scripts under `scripts/` (the app must be started with `--remote-debugging-port=9223`).

## Reporting issues

Please include your macOS version, app version, steps to reproduce, and any relevant output from the developer console (View → Toggle Developer Tools).
