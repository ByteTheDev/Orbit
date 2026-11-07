<p align="center">
  <img src="build/appicon.png" alt="Orbit" width="160" />
</p>

# Orbit

> **One galaxy per project. One planet per agent.**  
> A Wails v3 desktop app that orchestrates Claude Code and Codex CLI agents inside your git repositories — with a built-in terminal, diff review, conflict detection, and a native browser.

## ✨ Features

- 🪐 **Galaxy view** — every project is a sun, every agent a planet orbiting it. Pan, zoom, and pick a project at a glance.
- 🤖 **Multi-agent** — run Claude Code and Codex side by side in the same repo; mix models per turn.
- 📝 **Diff & commit** — review per-file diffs, stage what you want, and commit from the Changes tab. No leaving the app.
- ⚠️ **Conflict radar** — detects when two agents touch the same file before you merge.
- 🖥️ **Embedded terminal** — a real PTY shell (ConPTY on Windows) rooted in the project.
- 🌐 **Native browser** — a WebView2 page view plus a text-mode `browse_page` MCP tool agents can call.
- 💾 **One-file state** — everything persists as a single versioned JSON file; easy to back up or move.
- ⌨️ **Keyboard-first** — full shortcut map, shown in Settings › Keyboard.

## 🚀 Quick start

```bash
# Prerequisites: Go, Node.js, npm, Git, Wails v3 CLI
# plus the agent CLIs you want (claude, codex) on PATH

git clone https://github.com/spoiled/Orbit.git
cd Orbit
wails3 dev -config build/config.yml
```

Open the dev server at `http://localhost:34115` to call Go methods from devtools, or use the app window directly.

## 🛠️ Build

```bash
# Production build
wails3 build

# Output: bin/Orbit (or Orbit.exe on Windows)
```

Platform notes:

- **Windows** — full feature set, including the native browser view.
- **macOS / Linux** — build on the target OS with Go, Node, npm, Git, and Wails v3. The terminal uses `$SHELL` (falling back to `/bin/sh`); the native browser view currently falls back to the text view. Desktop runtime behavior on these platforms still needs verification.

Install and sign in to the agent CLIs separately, and make sure they are on the `PATH` available to Orbit when launched.

## 🧪 Development

```bash
# Go tests
go test ./...

# Frontend tests
cd frontend && npm test

# Frontend typecheck
cd frontend && npm run typecheck
```

## 🗂️ Project layout

```
Orbit/
├── main.go                 # Wails entrypoint
├── app.go                  # Bound App methods
├── internal/
│   ├── agent/              # Projects, agents, turns, event batching
│   ├── browser/            # Fetch + browse_page MCP server
│   ├── conflict/           # Cross-agent file conflict detection
│   ├── gitdiff/            # Diff, status, stage, commit
│   ├── provider/           # Claude Code & Codex adapters
│   ├── store/              # Single-file persistence
│   ├── terminal/           # PTY shells
│   └── webpane/            # Native page view (Windows)
└── frontend/               # React + TypeScript (Vite)
    └── src/
        ├── lib/            # Pure logic, store, bridge, actions
        └── components/     # UI
```

## 📡 Backend ↔ frontend contract

- Frontend calls Go through `frontend/src/lib/bridge.ts` (generated bindings in `frontend/bindings/` — do not edit).
- Go pushes updates on the `orbit:events` channel; terminals use `terminal:output` / `terminal:exit`.
- Empty collections serialize as `[]`, never `null`.

## 🤝 Contributing

Issues and PRs welcome. Keep pure logic in `lib/` and `internal/` free of React/Wails so it stays unit-testable, and route user-facing failures through toasts in `actions.ts`.

---

Built with [Wails v3](https://wails.io) · [React](https://react.dev) · [TypeScript](https://www.typescriptlang.org) · [Vite](https://vitejs.dev)