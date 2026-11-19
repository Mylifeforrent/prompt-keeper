# Implementation Status

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Desktop Implementation Status |
| Date | 2026-11-19 |
| Scope | What the current Electron implementation covers against [`prd.md`](./prd.md), and what is simplified or deferred |
| Status | Verified on macOS with the commands in section 5 |

This document is descriptive. It does not change the binding requirements in the PRD, architecture, backend design, or API contract. When the code and those documents disagree, the documents define the intended behavior and the difference is listed here.

## 1. Implemented product areas

### App shell and navigation

- Fixed sidebar for Prompts, Agent Instructions, Skills, MCP, Sync, and Settings.
- Segmented sub-tabs in every workspace.
- Global search across all four asset types with grouped results, local FTS, and sanitized snippets.
- Light, dark, and system theme with persistence and immediate application.
- Toasts, confirmation dialogs, empty/loading/error states, and a first-run welcome panel.
- Keyboard shortcuts: `/` focuses search, `N` opens the current asset type's create flow, `Esc` closes overlays.
- Window state persistence with display-bounds checking and a single-instance lock.

### Prompts

- Create, read, update, duplicate, favorite, pin, copy with variables, and soft delete.
- Nested folder tree with descendant selection; repository path `prompts/<folder>/<slug>.prompt.md`.
- Structured YAML frontmatter with stable ID, tags, sync policy, and variable definitions.
- Immutable revisions on every save, version preview and diff, restore-as-new-version.
- Three-state sync scope with pending-change withdrawal when switching to local only.
- Variable detection for `{{name}}` and `{{name:example}}`, required fields, clipboard rendering, usage count.
- Per-item incoming review, three-way conflicts, credential scanning before push.
- Platform Discovery tab backed by a static, clearly labeled curated demo catalog.

### Agent Instructions

- Contract CRUD with revisions, nested folders, tags, scope, path prefix, activation, priority, imports, and target selection.
- Six project-level targets: AGENTS.md, CLAUDE.md, Copilot instructions, Copilot path instructions, Cursor rules, Windsurf rules.
- Eight global targets with editable local paths and restore-to-default.
- Resolution preview with inclusion order, skip reasons, per-contract bytes, budget warnings, duplicate-priority warnings, compiled paths, and the approximation notice.
- Compilation preview using the same pure compiler as the write path.
- Project projection into managed blocks or per-contract files, with preserved outside content.
- Hash-based drift detection, item-level overwrite, re-projection, removal, and rollback.
- Global batch projection with the same drift rules; path changes mark non-drifted projections stale.
- Project root registration and removal with absolute-path validation.

### Skills

- Skill CRUD with nested folders, tags, source, category, icon, author, version label, and multi-file content.
- Required `SKILL.md`, file tree, text preview, executable markers, and script warnings.
- Immutable revisions over the complete file set.
- Dispatch panel with per-agent status: synced, stale, drifted, missing, unsupported.
- Symlink install on macOS and junction on Windows, copy mode, explicit failure reporting with no silent fallback.
- Drift detection by content hash, per-item re-sync, stale-only bulk sync, remove, and rollback.
- Two-phase import from a directory with file list, risk findings, and script acknowledgement.
- Curated store tab backed by static demo data.

### MCP

- MCP CRUD with nested folders, tags, notes, enabled state, favorite, and source.
- stdio and HTTP transports with static health checks; no process or network execution.
- Credential-like values encrypted with `safeStorage`; DTOs return `[REDACTED]` with `hasValue`.
- Repository files contain `${VAR}` placeholders only.
- Version history with non-secret restore that preserves current secret values.
- Apply/remove across Agent configuration files with format-preserving edits for JSON, JSONC, and TOML; unrelated keys and comments are preserved where the format allows.
- Per-target redacted preview, drift reporting, placement acknowledgement, and per-target results.
- Agent configuration inspection and reverse import into encrypted storage.
- Curated store tab backed by static demo data.

### Git synchronization

- Two-phase repository connection for managed clones and bound clones, including layout detection, malformed-file reporting, duplicate-ID detection, script findings, and credential findings.
- Read-only fetch that never merges or writes assets.
- Per-stable-ID three-way classification: in sync, local ahead, remote ahead, conflict, added, deleted, renamed.
- Incoming review with redacted three-way content and review invalidation on fingerprint change.
- Pull that applies only reviewed changes and revalidates fingerprints.
- Push with commit message, direct or branch mode, credential blocking, dirty-worktree protection, and no force/amend/rebase.
- Conflict resolution: take repository, keep local, or manual merge with structure validation.
- Audit history for fetch, pull, push, review, conflict, connect, block, dispatch, projection, rollback, backup, restore, and reset.
- One repository operation at a time and best-effort cancellation.

### Dispatch, search, settings, and data

- Computed Skill/MCP dispatch matrix with detected and optional undetected Agents.
- "Sync all stale" that never overwrites drifted items.
- Full-text search index with snippets and rebuild operation.
- Settings for appearance, repository summary, global paths, data locations, backups, restore, reset, diagnostics, updates, privacy, AI providers, and About.
- Consistent SQLite snapshot backup with blob copies and a manifest.
- Restore with validation, safety backup, and table-content replacement.
- Library-only and full reset with required confirmation text.
- Redacted diagnostic export.
- OpenAI-compatible AI test with streaming, cancellation, and local history; keys stay encrypted.
- Optional telemetry preference exists but no telemetry client is implemented.

### Security and reliability

- `contextIsolation`, `sandbox`, no Node integration, no webview, blocked navigation, HTTPS-only external links, denied permissions, and strict production CSP.
- IPC sender validation, payload size limit, structured error envelopes, and request-id idempotency.
- Secret values never cross the IPC boundary.
- Atomic temp-file-plus-rename writes with retries and mode preservation.
- Content-addressed blobs with hash verification.
- Append-only revisions and audit events.
- Credential scanning blocks pushes with high-confidence findings and returns masked previews only.
- Skill scripts, MCP commands, package managers, and repository hooks are never executed.

## 2. Simplified or deferred behavior

| Area | Current implementation | Difference from the target documents |
| --- | --- | --- |
| IPC schema validation | Hand-written validation in handlers and services | Zod request/response schemas per channel are not implemented; unknown request fields are not uniformly rejected. Payload size and sender checks are enforced. |
| Auto-update | `updates:check/status` report the current version; download/install return a failed operation with `UNSUPPORTED` | `electron-updater` is not installed and no signed update feed is configured. Update failure never blocks the app. |
| Packaging and signing | `electron-builder.yml` defines NSIS/DMG/ZIP targets plus ASAR unpack rules. `npm run package:mac` builds ad-hoc-signed macOS zips (arm64 and x64); `npm run package:win` cross-builds an x64 Windows portable executable. | Installers are not signed or notarized. The Windows package is built and inspected on macOS but has not been launched on Windows hardware. |
| File watchers | Drift and dispatch/projection status are recomputed on read and before actions | No chokidar watcher, no live external-edit notification, no background reconciliation timer. |
| MCP drift | Detects missing config files and missing managed keys; apply and remove are exact | In-place edits to a managed entry are not always reported as drift. |
| Projection preview token | Accepted in the input shape | It is not cryptographically verified for batch projection; the backend always recompiles from database state. |
| Contract version delete | Not offered | The API has no version-delete channel. History is append-only; the current version cannot be deleted. |
| Prompt version content | `RevisionSummary.files` is an additive extension that returns text content for comparison | The published API contract originally returned summaries only. The extension is documented in `api-contract.md`. |
| MCP editor | Manual form with environment and header key/value editors | Paste-JSON and source auto-detection from the visual design are not implemented. |
| Skill store install | Creates a `SKILL.md` from the reviewed description | Store entries do not carry file contents, so no additional files are invented. |
| Skill file editing | Disabled when a revision contains binary or oversized files | Metadata-only saves keep the existing files. |
| Imported symlinks | Rejected | No reviewed symlink import policy is implemented. |
| Backup restore | Validates and restores database tables and blobs, then rebuilds search | Deployment and projection reconciliation after restore is not automated; unreferenced blobs are not garbage-collected. |
| Diagnostics | Writes a redacted JSON file under `backups/` | A native save dialog for the export location is not used. |
| Telemetry | Preference only | No telemetry endpoint or client exists; no data leaves the machine. |
| Windows support | Paths, junctions, and platform defaults are implemented | Not verified on Windows hardware. |
| Project root UX | Registration and removal exist with absolute-path validation | The interaction design still marks the registration flow as `[TBD-UX]`; the current implementation is a minimal form. |
| Auto-fetch | Timer with jitter, active-operation skip, and offline handling | Does not hook OS power-monitor suspension. |
| Git branch mode | Pushes a branch and reports a compare URL when the provider is known | Pull-request creation through a hosting API is not implemented. |
| Search fallback | FTS5 with a LIKE fallback for metadata and tags | The fallback cannot search revision bodies. |

## 3. Intentional product boundaries

- No backend service, HTTP API, hosted catalog, account system, telemetry pipeline, or marketplace.
- No execution of Skill scripts, MCP commands, or repository hooks.
- No automatic merge, commit, push, projection, or dispatch.
- No bulk overwrite of drifted files or entries.
- No plaintext secret at rest outside the Agent configuration that inherently needs it, and only after explicit acknowledgement.
- No Linux packaging target or store distribution.

## 4. Test coverage

| Level | Covered |
| --- | --- |
| Unit | Folder normalization, path safety, slug generation, folder trees; Prompt/Contract/MCP serialization and parsing; variable rendering; credential scanning and masking; managed blocks; target resolution and compatibility; diff helpers. |
| Integration | SQLite schema, blob store, revision creation, materialized library, FTS indexing, soft delete and restore; full Git connect, push, fetch, review, pull, conflict, and take-remote flow against local bare repositories. |
| End-to-end | Electron launch, first-run panel, Prompt create/copy, Contract create, Skill create, MCP create, global search, Settings data locations. |
| Manual smoke | All workspaces and sub-tabs clicked through with no renderer errors; projection drift, dispatch drift, symlink install, stale sync, remove, MCP JSON/JSONC/TOML apply, backup, and credential-blocking flows exercised through real IPC. |

## 5. Verification record

Commands run on macOS with Node 24, Electron 38.4.0, and Better SQLite 12.11.1:

```bash
npm run build       # tsc --noEmit + electron-vite main/preload/renderer builds
npm test            # Vitest in Electron's Node runtime
npm run test:e2e    # Playwright Electron, 8 tests
npm run package:portable  # macOS zips (arm64 + x64) and Windows portable exe (x64)
```

Results: build passed; 31 unit and integration tests passed; 8 end-to-end tests passed; the English-only language scan returned no files. Portable packages were produced for macOS arm64, macOS x64, and Windows x64; both macOS bundles pass strict ad-hoc signature verification, and every package contains a native module matching its target platform. `npm audit --omit=dev` reports 0 vulnerabilities in production dependencies. Build-only tooling still reports advisories in its own dependency tree; those packages are not shipped in the application.

The native module must be rebuilt after an Electron upgrade:

```bash
npm run rebuild
```

## 6. Next work if this moves toward release

1. Add Zod request/response schemas per channel and reject unknown fields uniformly.
2. Add file watchers and startup reconciliation for external edits.
3. Wire `electron-updater`, a signed update feed, and deferred installation.
4. Build, sign, and notarize installers; run clean-machine smoke tests on Windows and macOS.
5. Add MCP managed-entry hash drift detection.
6. Verify Windows junction dispatch and path behavior on real hardware.
7. Add restore reconciliation and blob garbage collection.
8. Add the project-root registration interaction approved by design.
9. Add audit export (`CSV` and `JSON`) as a separate channel, which is not in the current contract.
