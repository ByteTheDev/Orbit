@AGENTS.md

# Claude Code notes

The project map and commands are in AGENTS.md, imported above. Keep this file to Claude-specific habits.

## Finding code cheaply

- Start from the table in AGENTS.md. Don't Glob or read the whole tree to find something.
- Use `Grep` for a symbol or string, then `Read` with `offset` and `limit` around the match. Don't read the large files whole: `internal/agent/manager.go`, `frontend/src/lib/universe/render.ts`, `frontend/src/lib/universe/galaxyGL.ts`, `frontend/src/components/dialogs/Dialogs.tsx`, `frontend/src/components/inspector/Inspector.tsx`.
- Don't read these at all unless the task is about them: `frontend/wailsjs/`, `frontend/dist/`, `build/bin/`, `node_modules/`, `frontend/package-lock.json`, `go.sum`.
- For a broad question ("where is X handled across the app?"), send an Explore subagent instead of reading many files into this context.
- After an edit, don't re-read the file to check it. The Edit tool already reports failure.

## Verifying a change

- Frontend change: run `npm run typecheck` and `npm test` in `frontend/`.
- Go change: run `go test ./...` from the root.
- Changes to exported `App` methods or `internal/model` types also need the bindings regenerated and `frontend/src/types.ts` updated. See AGENTS.md.
- Run only the tests for the area you changed while iterating. Run the full suite once before reporting done.

## Git

- Current branch is `master`. The main branch for PRs is `main`.
- The tree has uncommitted changes from the user, including untracked files. Stage only the files you changed. Don't use `git add -A`.
