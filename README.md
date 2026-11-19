# Prompt Keeper

Prompt Keeper is a **local-first desktop control plane for AI coding assets**. It unifies four asset types in one application and closes the loop between a shared Git repository, a local asset library, and the directories that AI coding Agents read:

```text
Git repository (shared source of truth)
   <->  fetch / pull / push with three-way review and conflicts
Local asset library (SQLite + content-addressed blobs)
   ->  project projection and global dispatch for Agent Instructions
   ->  symlink or copy dispatch for Skills
   ->  format-preserving merge for MCP configuration
AI coding Agents (Claude Code / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder)
```

| Asset | Canonical repository form | Delivery |
| --- | --- | --- |
| Prompt | `prompts/<folder>/<slug>.prompt.md` | Local library and optional Git sync only |
| Agent Instructions contract | `instructions/<folder>/<slug>.contract.md` | Project projection and user-level global dispatch |
| Skill | `skills/<folder>/<skill-name>/SKILL.md` plus files | Agent skill directories, symlink or copy |
| MCP server | `mcp/<folder>/<server-name>.json` | Agent MCP configuration files |

The application is built with Electron. The main process is the backend; there is no HTTP server, no hosted service, and no account system.

## Status

The desktop MVP is implemented in this repository:

- Electron shell with a sandboxed renderer, context isolation, typed preload bridge, strict CSP, and single-instance lock.
- SQLite schema, content-addressed blob store, materialized library, append-only revisions, and full-text search.
- Prompt, Contract, Skill, and MCP libraries with CRUD, versions, folders, tags, favorites, filters, and copy/render flows.
- Six project-level instruction targets, eight global instruction targets, managed-block projection, drift detection, batch projection, rollback, and item-level overwrite.
- Skill symlink/copy dispatch with drift protection, removal, rollback, stale sync, and reverse import.
- MCP secret encryption with OS `safeStorage`, `[REDACTED]` DTOs, static health checks, JSON/JSONC/TOML managed-entry merge, apply, remove, and reverse import.
- Git synchronization through the system Git CLI: two-phase repository connection, fetch, per-item incoming review, pull, push with credential blocking, three-way conflict resolution, and an audit trail.
- Settings for appearance, repository policy, global target paths, backups, restore, reset, diagnostics, updates, privacy, and AI provider configuration.
- Vitest unit and integration tests plus Playwright Electron end-to-end tests.

Open or simplified areas are tracked in [`docs/implementation-status.md`](./docs/implementation-status.md). Code signing, notarization, auto-update feeds, hosted catalogs, and team features are not part of this implementation.

## Requirements

- Node.js 20 or later for build scripts.
- npm (do not use pnpm, yarn, or bun).
- System Git for repository features.
- macOS 13+ or Windows 10 21H2+ for the packaged product. Development on macOS is what this repository is currently verified on.

## Quick start

```bash
npm install
npm run rebuild      # rebuild better-sqlite3 for the installed Electron ABI
npm run dev          # launch the Electron app with renderer hot reload
```

Other commands:

```bash
npm run build        # tsc --noEmit + electron-vite build
npm test             # Vitest inside Electron's Node runtime
npm run test:unit
npm run test:integration
npm run test:e2e     # Playwright Electron; run npm run build first
npm run package      # electron-vite build + electron-builder
npm run package:mac      # macOS zip (arm64 + x64), ad-hoc signed
npm run package:win      # Windows portable .exe (x64)
npm run package:portable # both portable formats
```

Portable packages need no installation. Unzip the macOS archive and run `Prompt Keeper.app`; the Windows `.exe` is a single self-extracting executable. Artifacts land in `release/`. Neither package is Developer ID signed or notarized, so on first launch macOS may require right-click → Open (or clearing the quarantine attribute) and Windows SmartScreen may warn. `npm run package:win` cross-builds on macOS and finishes with `npm run rebuild` so the host native module is ready for development again.

`npm test` runs Vitest through `scripts/run-tests.mjs`, which uses Electron's Node runtime so `better-sqlite3` loads with the ABI it was rebuilt for. Unit and integration tests share the same runner.

If Electron's binary is missing or only partially extracted after an install, rerun `node node_modules/electron/install.js`. The native module must be rebuilt after an Electron upgrade:

```bash
npm run rebuild
```

## Architecture

```text
src/main/        Electron main process (backend)
  adapters/      Git CLI, filesystem, blob store, safeStorage secrets, MCP config formats
  db/            SQLite connection, pragmas, forward-only migrations
  ipc/           Channel registration, sender validation, envelope and idempotency
  logging/       Redacted structured logs
  services/      Asset, sync, dispatch, projection, search, settings, AI, update services
src/preload/     Frozen typed bridge exposed at window.promptKeeper
src/renderer/    React 19 renderer: workspaces, UI primitives, IPC client, query cache
src/shared/      IPC contract types, channel catalog, pure domain logic
tests/           Unit, integration, and Electron end-to-end tests
```

Key rules:

- Only the main process writes SQLite, blobs, the library, Git clones, and Agent directories.
- The renderer sends IDs, selections, and content. It never sends arbitrary write paths and never receives stored secrets.
- Preview and write share the same pure compiler in `src/shared/domain`.
- Every external write is atomic, manifest-tracked, and auditable.
- No automatic merge, commit, push, projection, or dispatch.

The binding renderer-main contract is [`docs/api-contract.md`](./docs/api-contract.md). Channel names and payload shapes in `src/shared` mirror it.

## Data locations

Electron's `userData` directory is used for all application data:

| Data | Path |
| --- | --- |
| SQLite database | `<userData>/db/prompt-keeper.sqlite` |
| Content blobs | `<userData>/blobs/<aa>/<bb>/<sha256>` |
| Materialized library | `<userData>/library/<kind>/<asset-id>/` |
| Managed Git clones | `<userData>/repos/` |
| Backups | `<userData>/backups/` |
| Logs | `<userData>/logs/` |
| Operation journal | `<userData>/operations/` |

On macOS, `userData` is `~/Library/Application Support/Prompt Keeper`. On Windows it is `%APPDATA%\Prompt Keeper`. Global target paths and Agent detection results live in SQLite and are never written into a Git repository.

## Repository file formats

### Prompt

```markdown
---
id: ast_example
title: Code review
description: Review code for correctness and security
folder: engineering
tags:
  - review
syncPolicy: inherit
variables:
  - name: code
    type: textarea
    required: true
---

## System Prompt

You are a senior reviewer.

## User Prompt

Review the following code: {{code}}
```

### Agent Instructions contract

```markdown
---
id: ast_contract
title: API conventions
folder: engineering
scope: path
pathPrefix: src/api
activation:
  mode: glob
  globs:
    - src/api/**/*.ts
priority: 80
imports: []
targetIds:
  - claude
  - cursor
tags: []
syncPolicy: inherit
---

Use consistent error envelopes.
```

### Skill

```text
skills/<folder>/<skill-name>/SKILL.md
skills/<folder>/<skill-name>/scripts/...
```

### MCP

```json
{
  "id": "ast_mcp",
  "title": "GitHub server",
  "folder": "dev",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  },
  "enabled": true
}
```

Repository MCP files contain only `${VAR}` placeholders. Real values are encrypted with the operating-system secret store and never enter Git, logs, audit events, diagnostics, or renderer payloads.

## Security model

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`.
- Navigation and new windows are blocked; external links require HTTPS.
- Permission requests are denied by default.
- Strict CSP in production; the renderer makes no network requests.
- IPC handlers validate the sender, payload size, schemas, and business rules.
- Secrets use `safeStorage`; when unavailable, the app refuses to store them.
- Credential scanning blocks pushes with high-confidence findings and returns masked previews only.
- Skill scripts and MCP commands are never executed.
- External writes use temp-file plus atomic rename with retries; target paths are resolved from database records and constrained to allowed roots.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/prd.md`](./docs/prd.md) | Product requirements, scope, priority, and release criteria |
| [`docs/architecture.md`](./docs/architecture.md) | Electron process model, storage, sync, dispatch, projection, and security |
| [`docs/tech-stack.md`](./docs/tech-stack.md) | Technology choices and rejected alternatives |
| [`docs/frontend-design.md`](./docs/frontend-design.md) | Renderer architecture and feature design |
| [`docs/backend-design.md`](./docs/backend-design.md) | Main-process services, schema, Git engine, and projection algorithms |
| [`docs/api-contract.md`](./docs/api-contract.md) | Binding IPC channels, DTOs, errors, events, and concurrency rules |
| [`docs/interaction-design.md`](./docs/interaction-design.md) | UX and domain behavior source of truth |
| [`docs/implementation-status.md`](./docs/implementation-status.md) | What is implemented, simplified, or deferred |
| [`docs/business-model.md`](./docs/business-model.md) | Business model draft and commercial hypotheses |

## Repository layout

```text
src/main/                     Electron main process
src/preload/index.ts          Typed bridge
src/renderer/                 React application
src/shared/contracts.ts       IPC DTOs
src/shared/channels.ts        Channel catalog
src/shared/domain/            Pure domain modules
tests/unit/                   Domain tests
tests/integration/            SQLite, blob, and asset tests
tests/e2e/                    Playwright Electron tests
docs/                         Product and technical documentation
```

## License

MIT. See [`LICENSE`](./LICENSE).
