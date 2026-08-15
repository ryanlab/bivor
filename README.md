<p align="center">
  <img src="docs/logo.png" width="80" alt="Bivor">
</p>

<h1 align="center">Bivor</h1>

<p align="center">A desktop workbench for the pi coding agent — macOS &amp; Windows.</p>

<p align="center">
  <a href="https://github.com/ryanlab/bivor/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ryanlab/bivor?style=flat-square&color=c2410c" /></a>
  <a href="https://github.com/ryanlab/bivor/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/ryanlab/bivor/ci.yml?branch=main&style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/ryanlab/bivor?style=flat-square" /></a>
  <a href="https://github.com/ryanlab/bivor/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/ryanlab/bivor?style=flat-square" /></a>
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-0078D4?style=flat-square&logo=gitforwindows&logoColor=white" />
</p>

<p align="center">
  <a href="README.md"><b>English</b></a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#developing-from-source">Develop</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#license">License</a>
</p>

**Bivor** (from *beaver* — the industrious builder) is a desktop workbench for macOS and Windows based on the [pi coding agent](https://github.com/badlogic/pi-mono), built to match the experience of Codex / Claude desktop apps — and go further with visual harness orchestration, guardrails, cloud VM sandboxes, and parallel git-worktree tasks.

Each chat runs the pi SDK (`AgentSessionRuntime`) inside its own isolated Electron utility process. Sessions, auth, skills, prompts, and MCP config are fully shared with the pi CLI under `~/.pi/agent/`, so you can move between the terminal and the desktop app freely.

## Features

### Core chat & multitasking

- **Parallel tasks** — every chat lives in its own utility process: crash-isolated, independently abortable
- **Git worktree tasks** — one click runs an agent in a dedicated worktree + branch (`pi/task-*`); multiple agents edit code simultaneously without conflicts, then merge back from the built-in merge panel
- **Session tree & forking** — visual history tree; fork from any message (full history kept in the same file, switch branches anytime); "edit & fork" any user message; abandoned branches can carry an LLM-generated summary into the new branch
- **Streaming UI** — collapsible thinking blocks, streaming Markdown with dual-theme shiki highlighting, cursor animation
- **Tool call visualization** — live bash output, read/grep/ls results, inline diffs for edits, file previews for writes, with running/success/failure states and per-category styling
- **Changes review** — aggregated per-file unified diffs of everything the session touched, compared against a git baseline
- **Checkpoints & rollback** — a git snapshot (`refs/pi-checkpoints/`, never touches your index) is taken before every prompt; restore the whole workspace or individual files from any user message
- **Steer / follow-up** — interject while the agent is running, or queue a follow-up; queued messages are visible and clearable
- **Mission Control** (⌘O) — live grid of all tasks: status, current tool, inline approvals, subagents, tokens & cost
- **Images** — paste / drag / pick images for multimodal models
- **`!` bash & `@` file mentions** — prefix with `!` to run commands in the session shell (output streams into agent context); type `@` to fuzzy-search project files
- **Search & export** — in-session search (⌘F), full-text search across all historical sessions, export to HTML or JSONL
- **Auto-naming, retries, notifications** — LLM-generated titles, visible auto-retry on rate limits, system notifications when a background task finishes

### Runtime presets

Pick how much power each chat gets — presets gate tools and UI surfaces:

| Preset | What it is |
|--------|------------|
| **Daily** | Chat / writing assistant. No coding side effects; web search, web fetch, memory |
| **Coding** | Full agent: all tools, worktrees, sandbox, harness |
| **Review** | Read/search only; guardrails deny write/edit/bash |
| **Minimal** | Just `bash` + `read` + `edit` |

### Harness orchestration & governance

- **Visual assembly canvas** — the full agent pipeline as a live graph: model → system prompt (with sources, AGENTS.md composition, token estimates) → extra instructions → tools → extensions → skills → prompt templates
- **Hot re-orchestration** — toggle skills/extensions or append system instructions per session; `session.reload()` recomposes the system prompt in place while keeping conversation history
- **Guardrails** — per-tool allow/ask/deny policies, regex rules for bash commands, budgets (turns, tool calls, session cost), subagent limits, repeated-call circuit breaker; everything surfaces as inline approval cards
- **Self-tuning** — the agent can propose assembly changes via `harness_propose`; proposals require approval and hot-apply after the turn
- **Trajectory drawer** — per-step snapshots of the exact assembly and tool calls sent to the model
- **Tool disclosure** — with large tool sets, tools collapse behind `tool_search` / `tool_activate` to save context
- **Preset library** — save and reuse harness configurations

### Agent capabilities

- **Execution worlds** — built-in bash/read/write/edit run either locally or inside a cloud VM (`set_execution_world`)
- **Cloud VM sandbox (E2B)** — full desktop VM with live screen streaming, `vm_gui` mouse/keyboard control, `vm_file` transfer, `vm_screenshot`
- **Local sandbox** — macOS seatbelt profiles: `off` / `workspace` / `strict`
- **Subagents** — `subagent_run` spawns up to 4 parallel workers (optionally readonly or VM-bound), monitored in a dock
- **Browser** — headed Chrome/Edge automation via puppeteer-core with a persistent profile
- **Web** — Tavily-powered `web_search` plus keyless `web_fetch` (page → markdown)
- **Code mode** — `code_run` executes JavaScript in `node:vm` with `pi.bash` / `pi.log`, under the same guardrails and execution world
- **Deploy** — one-command workspace deploy to Vercel (preview by default, secrets and `.env` excluded, approval required), plus a full deployments ops panel (logs, promote, rollback, redeploy)
- **Project memory** — agent persists long-term memories to `.pi/memory.md`, injected into the system prompt across sessions

### Resources & interop

- **Package management** — install / remove / bulk-update npm and git plugin packages (global or per-project), shared with the pi CLI `packages` config
- **Skills & prompts** — list all sources (global / project / packages), create from a SKILL.md scaffold, edit, delete in-app
- **MCP** — one-click `pi-mcp-adapter` install, visual server overview, edit global `mcp.json` / project `.mcp.json`
- **CLI interop** — reads and writes pi's JSONL session files directly (`~/.pi/agent/sessions/`); resume, rename, and trash historical sessions
- **Project trust gating** — `.pi` project resources load only after explicit user consent, matching the pi CLI security model

### Sessions, models & auth

- **Model management** — full provider catalog from the pi SDK, thinking-level switching, context gauge, cost tracking, manual compaction
- **API keys** — stored in `~/.pi/agent/auth.json`, shared with the CLI; custom providers / relays via `models.json`
- **Desktop OAuth** — subscription accounts (Claude Pro, ChatGPT, Copilot, …) authorize in-app via browser flow, no terminal needed

### Scheduler & UX

- **Scheduled tasks** — interval / daily / weekly agent runs, in the background or opening a chat, with notifications
- **Terminals** — multi-tab user PTYs per chat, plus an interactive agent shell you can type into while the agent works
- **Design system** — warm Claude-style light/dark themes (follows system), serif headings, fine-grained motion
- **Command palette** (⌘K), shortcuts overlay (⌘/), usage dashboard, i18n (English / 中文)

## Install

Download from [Releases](https://github.com/ryanlab/bivor/releases):

- **macOS** — DMG, `arm64` for Apple Silicon, `x64` for Intel Macs
- **Windows** — `Bivor-Setup-*.exe` installer (per-user, no admin needed) or portable `-win-x64.zip`

> [!WARNING]
> Builds are currently unsigned (no code-signing certificate yet).
> - **macOS**: on first launch, right-click the app → **Open**, or clear the quarantine flag: `xattr -cr /Applications/Bivor.app`.
> - **Windows**: if SmartScreen appears, click **More info** → **Run anyway**.

> [!NOTE]
> On Windows the agent's `bash` tool needs a POSIX shell — install [Git for Windows](https://git-scm.com/download/win) (Git Bash), which you almost certainly already have for the git-based features.

## Developing from source

Requirements: macOS (Apple Silicon or Intel) or Windows 10+, Node.js ≥ 20, [pnpm](https://pnpm.io).

```bash
git clone https://github.com/ryanlab/bivor.git
cd bivor
pnpm install
pnpm dev          # electron-vite dev with HMR
pnpm typecheck
pnpm build        # build to out/
pnpm dist:mac     # package DMG + ZIP into dist/ (macOS)
pnpm dist:win     # package NSIS installer + ZIP into dist/ (Windows)
```

### Configuration

| What | Where |
|------|-------|
| Model API keys / OAuth (shared with pi CLI) | `~/.pi/agent/auth.json` — manage from Settings |
| Custom providers / relays | `models.json` (pi CLI-compatible) |
| Sessions (shared with pi CLI) | `~/.pi/agent/sessions/` |
| App config (optional keys below) | Electron `userData/bivor-config.json` |

Optional integrations, each enabling extra tools when configured in Settings:

- **E2B API key** — cloud VM sandbox (`E2B_API_KEY`)
- **Tavily API key** — `web_search` (`TAVILY_API_KEY`)
- **Vercel token** — deploy tool + deployments panel (`VERCEL_TOKEN`, `VERCEL_TEAM_ID`)
- **`CHROME_PATH`** — override the browser binary used by the browser tool

## Architecture

```
┌─────────────┐  IPC   ┌──────────────┐  postMessage  ┌────────────────────┐
│  Renderer    │◄──────►│ Main process │◄─────────────►│ Utility process ×N │
│  React 19    │        │ windows/menu │               │ pi SDK             │
│  zustand     │        │ global svcs  │               │ AgentSessionRuntime│
└─────────────┘        └──────────────┘               └────────────────────┘
```

- `src/main/` — windows, menu, chat process orchestration, global services (model catalog / auth / OAuth / sessions / worktrees / checkpoints / scheduler / terminals)
- `src/host/` — agent host: embeds the pi SDK runtime, trims and forwards the event stream, tree navigation, sandbox / guardrails / subagents / browser / web / code mode / deploy / memory
- `src/preload/` — typed contextBridge API
- `src/renderer/` — React UI; the event-stream reducer lives in `stores/app-store.ts`
- `src/shared/protocol.ts` — typed protocol shared across all three processes

## Testing

```bash
node scripts/sdk-smoke.mjs <provider>    # SDK-level smoke test
node scripts/e2e-cdp.mjs full "task"     # real end-to-end UI run driven over CDP
node scripts/e2e-harness.mjs             # resources center + hot harness orchestration
node scripts/shot.mjs out.png "js expr"  # CDP screenshot / state injection
```

E2E scripts require the app to be started with `--remote-debugging-port=9223`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
