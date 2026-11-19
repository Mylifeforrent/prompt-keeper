# Prompt Keeper Architecture Design

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Architecture Design |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; pending engineering and security review |
| Target product | Windows and macOS desktop application |
| Desktop framework | Electron |
| Primary audience | Frontend, backend, platform, security, QA, release engineering |
| Related documents | [`docs/prd.md`](./prd.md), [`docs/tech-stack.md`](./tech-stack.md), [`docs/frontend-design.md`](./frontend-design.md), [`docs/backend-design.md`](./backend-design.md), [`docs/interaction-design.md`](./interaction-design.md) |
| Annotation rules | `[FACT]`, `[ASSUMPTION]`, `[TBD-BIZ]`, `[TBD-UX]`, `[TBD-FE]`, `[TBD-BE]`, `[TBD-INFRA]`, `[CONFLICT]` |

## Document status

This document describes the **desktop architecture implemented in this repository**. The main process, preload bridge, shared domain modules, SQLite store, Git adapter, dispatch engine, and projection engine exist under `src/main`, `src/preload`, `src/shared`, and `src/renderer`. Implementation simplifications are tracked in [`docs/implementation-status.md`](./implementation-status.md).

The architecture was designed so the renderer, domain logic, target registry, and interaction patterns could be migrated incrementally. That migration is now applied: the browser prototype store and simulation paths have been removed.

## 1. Architecture summary

Prompt Keeper is a **single-machine, local-first Electron application** with three runtime layers:

```text
+---------------------------------------------------------------+
| Renderer process                                              |
| React 19 + TypeScript + Tailwind + CodeMirror                 |
| Sandboxed, no Node.js, no filesystem, no secrets             |
+-----------------------------+---------------------------------+
                              | typed IPC via preload contextBridge
+-----------------------------v---------------------------------+
| Preload script                                                |
| Minimal, allowlisted API surface; no business logic           |
+-----------------------------+---------------------------------+
                              | ipcMain.handle / webContents.send
+-----------------------------v---------------------------------+
| Main process (local service layer)                            |
| Assets, Sync, Dispatch, Projection, Secrets, Search, Audit   |
| SQLite + blob store + Git CLI + filesystem + safeStorage     |
+-----------------------------+---------------------------------+
                              |
        +---------------------+----------------------+
        |                     |                      |
   SQLite / blobs       Git CLI + clones      Agent directories
   (userData)           (userData/repos)       and project roots
```

Key decisions:

1. **No hosted backend is required for the core product.** The main process is the backend for the desktop app.
2. **The renderer is untrusted for mutations.** Every write is validated and executed in the main process.
3. **The local database is the operational source of truth for the library.** Git is the shared source of truth for syncable assets; Agent directories are delivery targets only.
4. **Domain logic is shared, not duplicated.** Path generation, serialization, glob matching, target compilation, and diff logic live in a pure shared module used by both preview and write paths.
5. **All external writes are atomic, previewed, manifest-tracked, and auditable.**
6. **Secrets are encrypted with OS-backed safeStorage and never returned to the renderer.**
7. **Git uses the system Git CLI**, preserving system credential helpers and SSH agents.

## 2. Principles and constraints

### 2.1 Architectural principles

| ID | Principle | Consequence |
| --- | --- | --- |
| AP-01 | Local-first by default | Core features work offline; network is an optional dependency |
| AP-02 | One writer | Only the main process writes SQLite, blobs, clones, and Agent targets |
| AP-03 | Preview and write share one compiler | A preview cannot differ from the actual write for the same inputs |
| AP-04 | Data-driven adapters | Agent paths, formats, capabilities, and merge rules are registry data |
| AP-05 | Immutable history | Asset versions and audit events are append-only |
| AP-06 | Hash-based truth | Drift and change detection use content hashes, not timestamps |
| AP-07 | Atomic effects | A failed operation leaves prior state intact |
| AP-08 | Explicit trust boundaries | Renderer, repository content, and Agent files are all treated as untrusted input |
| AP-09 | Reversible delivery | Every deployment and projection can be rolled back when a previous version exists |
| AP-10 | No hidden automation | Auto-fetch is read-only; no auto-merge, commit, push, or write |

### 2.2 Hard constraints

- Target platforms: Windows 10 21H2+ and macOS 13+. Linux is out of scope for the MVP.
- The app must run without administrator rights in normal use.
- The app must work with a system Git installation; Git is a runtime dependency for sync. `[TBD-BE: minimum version]`
- The app must not execute Skill scripts, MCP servers, or repository hooks.
- The app must not require a user account or a cloud service for local features.
- The app must remain usable if the update service, catalog service, or license service is unreachable.

## 3. System context

### 3.1 Context diagram

```text
                         +----------------------+
                         |      Developer       |
                         +----------+-----------+
                                    |
                                    | uses
                                    v
+----------------------+   +--------+-----------------------------+
| Git hosting provider |<->| Prompt Keeper desktop application |
| GitHub / GitLab /    |   | Windows / macOS                   |
| generic Git remote   |   +--+-------------+-------------+------+
+----------------------+      |             |             |
                               |             |             |
                    writes   |             | reads/writes |
                               v             v             v
                    +----------+--+  +-------+------+  +---+----------------+
                    | Local Agent |  | Local Git    |  | Project roots      |
                    | directories |  | clone        |  | (repositories)     |
                    | and configs |  | (managed)    |  |                    |
                    +-------------+  +--------------+  +--------------------+

Optional external dependencies, all user-triggered or opt-in:
  - AI model provider (bring your own key)
  - Curated catalog source
  - Signed update feed
  - License service (if introduced)
```

### 3.2 Actors and external systems

| Actor or system | Relationship | Trust level |
| --- | --- | --- |
| User | Operates the app and confirms writes | Trusted for intent, not for input safety |
| Git remote | Shared source of truth for syncable assets | Untrusted content; authenticated transport |
| Local Agent directories | Delivery targets and sources of drift | Untrusted content |
| Project roots | Targets for project-level projections | Untrusted content |
| AI provider | Optional inference endpoint | External; user-configured; no product proxy |
| Curated catalog | Optional signed or bundled content source | Untrusted until reviewed |
| Update feed | Signed application updates | Must be signature-verified |
| License service | Optional entitlement check | Must not block core local use |

## 4. Container and process view

### 4.1 Processes

| Process | Responsibility | Must not |
| --- | --- | --- |
| Renderer | UI, local view state, previews, input validation | Access Node.js, filesystem, Git, secrets, or arbitrary network |
| Preload | Expose a narrow typed API and event subscriptions | Contain business logic or expose `ipcRenderer` |
| Main | All persistence and side effects; orchestration | Render UI or trust renderer input |
| Utility process (optional) | CPU-heavy scanning, large hashing, archive inspection | Write shared state directly |
| Git child process | Clone, fetch, status, show, commit, push | Run interactively or inherit credentials into logs |
| OS file watcher | Detect external edits in library, Agent, and project paths | Trigger writes automatically |

### 4.2 Renderer

- React 19 function components and hooks.
- No Node integration. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Receives DTOs from the main process. DTOs never contain stored secret values.
- Keeps only view state (selection, filters, dialog state, unsaved drafts) plus a cache of queried data.
- Performs form validation for responsiveness, but the main process re-validates every mutation.

### 4.3 Preload

The preload script exposes one frozen object:

```ts
interface PromptKeeperApi {
  prompts: {
    list(query: PromptQuery): Promise<PromptSummary[]>
    get(id: string): Promise<PromptDetail>
    create(input: PromptCreateInput): Promise<PromptDetail>
    update(id: string, input: PromptUpdateInput): Promise<PromptDetail>
    delete(id: string, input: DeleteInput): Promise<DeleteResult>
    copyRender(id: string, values: Record<string, string>): Promise<{ text: string }>
    // ...
  }
  contracts: { /* ... */ }
  skills: { /* ... */ }
  mcp: { /* ... */ }
  sync: { /* ... */ }
  dispatch: { /* ... */ }
  settings: { /* ... */ }
  search: { /* ... */ }
  events: {
    onDomainChanged(listener: (event: DomainChangedEvent) => void): () => void
    onSyncProgress(listener: (event: SyncProgressEvent) => void): () => void
    onUpdateAvailable(listener: (event: UpdateEvent) => void): () => void
  }
}
```

Rules:

- No generic `invoke(channel, payload)` is exposed to renderer code.
- Every method maps to a named IPC channel and a schema.
- Event subscriptions return an unsubscribe function.
- The API is generated or checked against a single channel contract in `src/shared/ipc/`.

### 4.4 Main process

The main process is organized as a service layer:

```text
main/
  bootstrap/        app lifecycle, single instance, window creation, security
  ipc/              channel registration, sender validation, schema validation
  services/         application services and orchestration
  repositories/     SQLite repositories and query objects
  adapters/         git, agents, filesystem, secrets, catalogs, ai
  platform/         OS-specific paths, symlinks, permissions, long paths
  jobs/             scheduler, fetch loop, watchers, reconciliation
  logging/          structured logs, redaction, audit
```

### 4.5 Startup sequence

```text
1. Acquire single-instance lock.
2. Apply Electron security configuration and command-line switches.
3. Resolve userData paths and ensure directory structure.
4. Initialize logger and crash-safe operation journal.
5. Open SQLite, enable WAL and foreign keys, run integrity check.
6. Run pending migrations after creating a database backup.
7. Initialize blob store and verify referenced blobs lazily.
8. Initialize services and register IPC handlers.
9. Reconcile interrupted operations and deployment/projection state.
10. Create the main window and load the renderer.
11. Start the auto-fetch scheduler and file watchers after the first paint.
```

If a step fails:

- Database corruption: do not overwrite; show a recovery window that offers backup restore and diagnostic export.
- Migration failure: restore the pre-migration backup and leave the previous app version usable.
- Blob missing: mark the asset degraded and offer recovery from a version or repository pull; do not crash the whole app.

### 4.6 Shutdown sequence

```text
1. Stop the scheduler and watchers.
2. Cancel or finish in-flight Git operations with a bounded timeout.
3. Flush audit events and close the database.
4. Release the single-instance lock.
```

Long-running operations must be cancellable or safely abandoned; the operation journal records their state so the next launch can reconcile.

## 5. Module decomposition

### 5.1 Repository layout

The layout below is the current repository structure. Planned modules that are not implemented yet are tracked in [`implementation-status.md`](./implementation-status.md), not listed here.

```text
src/
  main/
    adapters/       blobStore, fs, git, hash, mcpConfig, secrets
    db/             database.ts
    ipc/            register.ts
    services/       app, assetStore, assetSyncState, auditService, ai, dispatch,
                    index, instructionContracts, mcp, projections, prompts,
                    search, settings, skills, sync, types, updates
    context.ts
    events.ts
    index.ts
    logger.ts
    operations.ts
    paths.ts
  preload/
    index.ts
  renderer/
    app/            FirstRun, OperationPanel, navigation
    components/
      layout/
      shared/
      ui/           primitives, modal, tabs, toast
    features/
      instructions/
      mcp/
      prompts/
      settings/
      skills/
      sync/
    lib/
      clipboard.ts
      cn.ts
      format.ts
      icons.tsx
      ids.ts
      ipc.ts
      queryKeys.ts
      viewModels/   assetStatus, contract, mcp, prompt, skill, sync
  shared/
    bridge.ts
    channels.ts
    contracts/      boundary DTOs split by domain, re-exported from index.ts
    domain/
      compiler.ts
      contractFile.ts
      credentialScanner.ts
      diff.ts
      errors.ts
      folders.ts
      ids.ts
      manifest.ts
      mcpFile.ts
      promptFile.ts
      targets.ts
      variables.ts
    global.d.ts
```

### 5.2 Dependency rules

| Layer | May import | Must not import |
| --- | --- | --- |
| `shared/domain` | TypeScript standard library only | React, Electron, Node builtins, database, filesystem |
| `shared/contracts` | Type-only modules and shared domain types | Electron runtime values, database, renderer components |
| `main` | Shared, Electron, Node, database, adapters | Renderer modules |
| `preload` | Shared IPC types and a minimal Electron API | Main services, database, renderer modules |
| `renderer` | Shared types/domain, React, renderer modules | Main, preload implementation, Node builtins |

Enforcement:

- TypeScript path aliases and code review are the current guardrails.
- Separate TypeScript projects, lint rules, and a CI check for shared-layer imports are planned and not yet configured.

### 5.3 Shared domain module

The shared module is the single implementation of deterministic rules:

- Folder normalization, slug generation, and repository path generation.
- Prompt, Contract, and MCP file serialization and parsing.
- Frontmatter validation.
- Glob matching for contract activation.
- Target registry data and target compilation.
- Managed block parsing and rendering.
- Line and three-way diff primitives.
- Variable parsing and rendering.
- Credential pattern definitions and scanning helpers.

Why shared:

- The renderer previews and the main process writes must produce identical output.
- The preview can run without a round trip for typing latency.
- Tests can target pure functions without Electron.

Why safe:

- The shared module has no side effects and no access to secrets.
- The main process recompiles from validated database state before writing; a malicious renderer cannot supply a precompiled file.

### 5.4 Main services

| Module | Responsibility |
| --- | --- |
| `services/assetStore.ts` | Asset CRUD, tags, folders, revisions, materialization |
| `services/assetSyncState.ts` | Effective sync state, repository policy lookups, local change recording |
| `services/prompts.ts` | Prompt validation, variable parsing, copy rendering |
| `services/instructionContracts.ts` | Contract CRUD, resolution preview, target compilation |
| `services/skills.ts` | Skill files, import, review, versions |
| `services/mcp.ts` | MCP configuration, secrets, health checks, versions |
| `services/sync.ts` | Repository connection, fetch, pull, push, status, conflicts |
| `services/dispatch.ts` | Agent detection, Skill install, MCP apply, drift, rollback |
| `services/projections.ts` | Project and global projection, drift, rollback |
| `services/search.ts` | FTS index maintenance and queries |
| `services/auditService.ts` | Append-only audit events and export |
| `services/settings.ts` | Settings, backup, restore, reset, diagnostics |
| `services/updates.ts` | Update check, download, and install (currently disabled) |
| `services/ai.ts` | Provider configuration, streaming requests, cancellation |
| `services/app.ts` | Bootstrap, theme, data locations, projects |
| `adapters/secrets.ts` | safeStorage encryption, decryption, and redaction |
| `adapters/blobStore.ts` | Content-addressed blob storage |
| `adapters/git.ts` | Git CLI integration |

### 5.5 Renderer features

```text
renderer/features/
  prompts/
  instructions/
  skills/
  mcp/
  sync/
  settings/
renderer/components/
  ui/          primitives, modal, tabs, toast
  layout/      shell, sidebar, topbar
  shared/      dialogs, diff, markdown, folder tree, version history
renderer/app/  first-run panel, operation panel, navigation types
renderer/lib/  IPC client, query keys, formatting, view models
```

Global search lives in the top bar rather than a separate feature folder. The frozen visual reference is `design/prototype/`; it is not shipped. The frontend design document owns the internal structure of each feature.

## 6. Data architecture

### 6.1 Storage layout

```text
<userData>/
  db/
    prompt-keeper.sqlite
    prompt-keeper.sqlite-wal
    prompt-keeper.sqlite-shm
  blobs/
    ab/
      cd/
        <sha256>
  library/
    prompts/<asset-id>/...
    instructions/<asset-id>/...
    skills/<asset-id>/...
    mcp/<asset-id>/...
  repos/
    <repo-id>/
  backups/
    db-<timestamp>.sqlite
    snapshot-<timestamp>.zip
  logs/
    main-<date>.log
  operations/
    journal.jsonl
```

- `db/` holds metadata, relationships, versions, sync state, deployments, projections, settings, and audit events.
- `blobs/` holds content-addressed file content.
- `library/` is the materialized working tree used for symlink dispatch and for user-visible file paths.
- `repos/` holds app-managed Git clones.
- `backups/` holds pre-migration and user-requested snapshots.

### 6.2 SQLite configuration

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
```

Rationale:

- WAL supports concurrent reads while the main process writes.
- `NORMAL` synchronous mode is a reasonable durability/performance trade-off for a local app; backups and atomic file writes cover the remaining risk.
- Foreign keys prevent orphaned revisions and projections.
- A single writer avoids lock contention.

### 6.3 Core tables

The following is a logical schema. The backend design contains the concrete DDL and index list.

| Table | Purpose |
| --- | --- |
| `schema_migrations` | Applied migration versions |
| `settings` | Key-value JSON settings |
| `assets` | Common identity and metadata for all four asset types |
| `asset_revisions` | Append-only version metadata |
| `asset_files` | File manifest for each revision |
| `prompts` | Prompt-specific body fields |
| `contracts` | Contract-specific fields |
| `skills` | Skill-specific metadata |
| `mcp_servers` | MCP-specific configuration |
| `secrets` | Encrypted secret values |
| `tags` | Normalized asset tags for filtering |
| `projects` | Registered project roots for project-level projection |
| `repos` | Connected Git repositories |
| `repo_assets` | Last synchronized base per asset |
| `sync_changes` | Computed incoming, outgoing, and conflict items |
| `operations` | Crash-recoverable operation journal for sync, dispatch, projection, migration, and restore |
| `agents` | Known Agent targets and detection state |
| `deployments` | Skill and MCP deliveries |
| `projections` | Contract projections, project and global |
| `global_targets` | User-level instruction target configuration |
| `audit_events` | Append-only local audit trail |
| `assets_fts` | Full-text search index |

### 6.4 Content model

An asset is metadata plus a sequence of revisions. A revision references a manifest of files. A file references a blob by SHA-256.

```text
assets (1) --- (n) asset_revisions (1) --- (n) asset_files ---> blobs
   |
   +--- prompts | contracts | skills | mcp_servers
   |
   +--- (n) deployments
   +--- (n) projections (contracts only)
```

Why content-addressed blobs:

- Deduplicates identical files across versions.
- Makes drift and change detection a hash comparison.
- Supports multi-file Skills without storing large scripts in SQLite rows.
- Keeps database backups small when content is unchanged.
- Makes rollback a manifest switch plus re-materialization.

Blob rules:

- Hash algorithm: SHA-256.
- Path: `blobs/<first two hex>/<next two hex>/<full hash>`.
- Write: temp file in the same directory, fsync, rename.
- Read: verify length and hash before trusting content for writes.
- Garbage collection: mark-and-sweep after version deletion or backup cleanup; never delete a blob referenced by any revision, deployment, projection, or in-flight operation.
- Maximum blob size: enforced per asset type; larger files are rejected with an explanation `[TBD-BE: limits]`.

### 6.5 Materialized library

The blob store is the durable source of content, but Agent symlinks and external editors need a normal file tree. The app maintains:

```text
library/skills/<asset-id>/SKILL.md
library/skills/<asset-id>/scripts/...
library/prompts/<asset-id>/<slug>.prompt.md
```

Rules:

- The materialized tree represents the current revision of each asset.
- Writes go through the main process: new revision, blob write, materialize, then delivery.
- External edits through a symlink are detected by a watcher and compared to the current revision.
- An external edit becomes a local change and a new revision only after the app reconciles it; the user sees a review prompt if the edit conflicts with a concurrent app edit.
- The materialized tree is disposable and can be rebuilt from blobs.

This is how "symlink means synced editing" is implemented safely without letting an Agent process mutate the database directly.

### 6.6 Migrations

- Forward-only, numbered migrations.
- Each migration runs inside a transaction when SQLite permits.
- Before the first migration of a launch, create a database backup with `VACUUM INTO`.
- Store the application version and schema version.
- Refuse to open a database created by a newer schema version; show an upgrade-required message.
- Rebuild derived tables (FTS, sync changes) after migration rather than migrating their contents blindly.

### 6.7 Backup and restore

A full backup contains:

- A consistent SQLite snapshot.
- All blobs referenced by the snapshot.
- A manifest with schema version, app version, creation time, and hashes.

Restore:

1. Validate the manifest and every hash.
2. Create a safety backup of current data.
3. Write to a staging directory.
4. Swap directories atomically where possible.
5. Reopen the database and reconcile deployments and projections.

## 7. Domain flows

### 7.1 Asset write path

Every local edit follows the same path:

```text
Renderer form
  -> IPC mutation with revision precondition
  -> main validates schema and business rules
  -> main loads current asset and revision
  -> main computes new content and manifest
  -> main writes new blobs
  -> main inserts revision and updates asset in one transaction
  -> main materializes the library file
  -> main updates FTS index
  -> main emits domain-changed event
  -> renderer refreshes affected queries
```

If the asset participates in sync, the write also creates or updates an outgoing `sync_change`. It never commits or pushes.

Optimistic concurrency:

- Every update includes the expected revision ID or asset `updated_at` token.
- A mismatch returns a conflict error with the current revision.
- This prevents two windows or an external symlink edit from silently overwriting each other.

### 7.2 Repository connection

```text
User enters URL, branch, auth mode, clone mode, local path
  -> main validates URL and path
  -> main checks Git availability and version
  -> clone or bind existing clone
  -> inspect directory layout
  -> detect candidate assets and parse frontmatter
  -> run preflight: counts, malformed files, scripts, credentials
  -> user confirms risk
  -> persist repo, layout, policies, and initial base state
```

Rules:

- Authentication uses system Git credentials or the SSH agent. The app does not store Git passwords.
- A bound existing clone is never modified without checking `git status --porcelain`.
- If the clone is dirty outside app-managed paths, the connection is read-only until the user resolves it.
- Unfiled assets are recorded, not dropped.
- A malformed file is reported; the app does not rewrite it.

### 7.3 Fetch, pull, and push

#### Fetch

```text
git fetch --prune <remote>
git rev-parse <remote>/<branch>
git ls-tree -r -z <ref> -- <managed roots>
git show <ref>:<path> for changed files
```

- Fetch is read-only.
- The app computes remote manifests and diffs against the last base.
- It never merges or writes to the library.
- It stores incoming change summaries, not full content, until the user reviews them; content is read on demand from Git.

#### Pull

```text
For each reviewed incoming item:
  - verify the remote bytes still match the reviewed hash
  - parse and validate the asset
  - write blobs and a new local revision
  - update repo_assets base to the remote content
  - update library materialization
  - mark the change resolved
```

- If the remote changed since review, the operation stops and asks the user to review again.
- A pull never overwrites a local revision that changed after the review was opened.

#### Push

```text
1. Collect selected outgoing changes.
2. Validate asset structure and stable IDs.
3. Scan Prompt and Contract bodies and MCP files for credentials.
4. Recompute the target file tree.
5. Verify the clone is clean in managed paths.
6. Write files into the clone worktree.
7. git add -- <managed paths>
8. git commit -m <user message>
9. git push <remote> <branch>
10. On success, update base and clear resolved changes.
11. On failure, keep changes pending and report the exact failing step.
```

Rules:

- Never `--force`, never rewrite history.
- Never commit unrelated files.
- Never bypass hooks silently; if a hook fails, surface the output and leave the changes pending.
- The commit message comes from the user; the app may add a trailer with the app version but must not invent content.
- If the remote moved, fetch and recompute; a non-fast-forward push is an error, not a force-push prompt.

### 7.4 Three-way merge

For each asset, the app has:

- **Local**: the current local revision.
- **Remote**: the file content at the remote ref.
- **Base**: the last synchronized revision recorded in `repo_assets`.

Classification:

| Local vs base | Remote vs base | Result |
| --- | --- | --- |
| Same | Same | In sync |
| Changed | Same | Local ahead |
| Same | Changed | Remote ahead |
| Changed | Changed, same result | In sync |
| Changed | Changed, different result | Conflict |
| Deleted | Same | Local deletion pending |
| Same | Deleted | Remote deletion pending |
| Deleted | Changed | Conflict |
| Changed | Deleted | Conflict |

Rename handling:

- Identity comes from the stable ID in frontmatter.
- A path change with the same ID is a rename, not a delete plus add.
- Duplicate IDs across files are a blocking error.

Conflict resolution:

- **Take repository**: replace the local revision with the remote content and update base.
- **Keep local**: keep the local revision, set base to the remote content, and create an outgoing change.
- **Manual merge**: the user edits a merged result; the app validates structure, writes a new local revision, sets base to the remote content, and creates an outgoing change.

Content stored for conflicts:

- The conflict view needs remote, local, and base text.
- Remote text is read from Git on demand and cached by hash.
- Local and base text come from blobs.
- Conflict state stores hashes and references, not duplicated content.

### 7.5 Skill dispatch

```text
Source revision manifest
  -> compute target directory: <agent skill dir>/<skill-name>
  -> verify Agent support and target path
  -> check existing state: missing, managed, external, drifted
  -> preview target path and files
  -> on confirm:
       symlink mode: create directory symlink/junction to library/skills/<id>
       copy mode:    copy manifest to temp dir, fsync, rename into place
  -> record deployment with manifest hash and revision
  -> audit event
```

Symlink behavior:

- macOS: `fs.symlink(target, path, 'dir')`.
- Windows: directory junction (`'junction'`) is preferred because it does not require elevation.
- If symlink creation fails with `EPERM` or `EINVAL`, the app offers copy mode; it does not silently fall back.
- Symlink targets point to the materialized library, not to the blob store.

Drift behavior:

- Symlink mode: the Agent sees the library files. An external edit changes the library. The watcher creates an "external edit" record; the user reviews it before it becomes a local revision.
- Copy mode: drift is a manifest hash mismatch in the Agent directory.
- In both modes, a drifted item is never bulk-overwritten.

Remove:

- Symlink mode: remove the link only after verifying it points to the expected library path.
- Copy mode: remove only files listed in the deployment manifest; never delete unknown files.
- Removal does not delete the library asset or repository content.

### 7.6 MCP dispatch

```text
MCP server revision (secrets redacted in DTO)
  -> resolve target config file
  -> read and parse the target file (JSON / JSONC / TOML)
  -> identify the managed entry key
  -> compare existing entry to last written entry (drift)
  -> preview projected content with secrets redacted
  -> on confirm:
       decrypt secret values in main
       write the managed entry with format-preserving edits
       atomically replace the file
       record deployment and managed key
  -> audit event
```

Format handling:

- JSON: parse and serialize only if the file is strict JSON and formatting preservation is not required; prefer a structural edit when possible.
- JSONC: use a JSONC parser that supports comments and trailing commas; apply targeted edits to preserve formatting.
- TOML: use a section-scoped editor that replaces or removes only the managed `[mcp_servers.<name>]` section. If the file uses an unsupported structure, refuse and ask the user to edit manually.

Managed entries:

- The deployment records the target file, the managed key, the last written entry hash, and the full-file hash.
- Applying updates only the managed key.
- Removing deletes only the managed key.
- External changes to the managed key are drift; external changes to other keys do not cause drift but must be preserved.

Secret injection:

- The written Agent config necessarily contains the value the Agent needs. This is inherent to MCP.
- The app warns before the first write that the Agent configuration will contain the secret in plaintext at rest.
- The renderer never sees the value; the preview is redacted.
- The app optionally supports environment references where a target supports them `[TBD-BE]`.

### 7.7 Instruction projection

```text
Contract revisions + target registry + project root or global path
  -> compile target files in shared/domain
  -> resolve target path
  -> read current file
  -> classify state (missing, synced, stale, drifted)
  -> preview final content
  -> on confirm:
       single-file target: replace only managed blocks
       per-contract target: replace only the contract file
       atomic write + backup
  -> record projection hashes and revision
  -> audit event
```

Single-file managed block algorithm:

```text
Input: current file text, existing contracts for target, selected contracts
1. Parse the file into outside segments and managed blocks by marker.
2. For each contract in scope, render its block.
3. Preserve all outside segments exactly.
4. Replace managed blocks for contracts being projected.
5. Remove blocks for contracts that were explicitly removed.
6. Leave blocks for other contracts untouched.
7. Write with the current file's line ending style.
```

Drift classification for a single-file target:

| Condition | State |
| --- | --- |
| File does not exist | `missing` |
| File hash equals last written hash, contract revision changed | `stale` |
| File hash equals last written hash, contract revision same | `synced` |
| Outside content changed since last write | `drifted` |
| Managed block content changed since last write | `drifted` |
| Only another contract's block changed | `drifted` for the file; item-level review required |

Per-contract target:

- File hash equals last written hash and revision same: `synced`.
- File hash equals last written hash and revision changed: `stale`.
- File hash differs: `drifted`.
- File missing: `missing`.

Global targets:

- Same algorithm, with absolute or `~`-expanded paths.
- Path changes mark all non-drifted projections under the target as `stale`.
- Paths are never written to Git.

Project roots:

- Project-level projections require a registered root.
- The project root is validated as an existing directory and stored locally.
- The target path is resolved relative to the root; path traversal outside the root is rejected.
- `[TBD-UX]` The interaction design does not yet define the project registration flow.

### 7.8 Drift detection summary

| Surface | Source of truth | Drift signal | Recovery |
| --- | --- | --- | --- |
| Skill symlink | Library materialized tree | Library file hash differs from current revision | Review external edit, accept as revision, or restore from revision |
| Skill copy | Deployment manifest | Target manifest hash differs | Re-sync with confirmation or roll back |
| MCP JSON/JSONC | Managed entry hash | Managed key or full file differs | Review, overwrite entry, or keep external |
| MCP TOML | Managed section hash | Managed section differs | Same as above |
| Projection single file | Outside and block hashes | Outside or any managed block differs | Per-item overwrite or keep |
| Projection per-contract | File hash | File differs | Per-item overwrite or rollback |
| Repository asset | Base manifest | Local or remote differs from base | Three-way merge |

### 7.9 Rollback

- A deployment or projection stores the previous revision or previous file hash.
- Rollback materializes the previous revision and writes it to the target.
- Rollback never changes the library revision and never creates a Git commit.
- If the target drifted since the deployment, rollback requires a confirmation because it will overwrite external changes.
- Every rollback creates an audit event.

## 8. IPC architecture

### 8.1 Channel contract

All channels are defined in `src/shared/ipc/channels.ts`:

```ts
export const channels = {
  promptsList: 'prompts:list',
  promptsGet: 'prompts:get',
  promptsCreate: 'prompts:create',
  promptsUpdate: 'prompts:update',
  promptsDelete: 'prompts:delete',
  // ...
} as const
```

Each channel has:

- A request schema.
- A response schema.
- An authorization rule (which window may call it).
- A timeout and cancellation policy.
- An error taxonomy.

### 8.2 Mutation rules

- All mutations are validated with Zod in the main process.
- Writes are idempotent where practical; create operations accept a client-generated request ID to avoid duplicates on retry.
- Inputs include a revision precondition for updates.
- Paths from the renderer are never used directly; the renderer sends asset IDs or registered target IDs, and the main process resolves paths.
- Errors are returned as structured results, not raw stack traces:

```ts
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }
```

### 8.3 Events

Main-to-renderer events:

| Event | Payload | Use |
| --- | --- | --- |
| `domain:changed` | `{ domain, ids, reason }` | Invalidate queries |
| `sync:progress` | `{ repoId, operationId, phase, current, total }` | Progress UI |
| `sync:completed` | `{ repoId, operationId, result }` | Refresh and toast |
| `dispatch:changed` | `{ deploymentIds }` | Refresh matrix |
| `projection:changed` | `{ projectionIds }` | Refresh projection views |
| `update:available` | `{ version, notes }` | Show update prompt |
| `update:downloaded` | `{ version }` | Offer restart |

Events are advisory. The renderer must still fetch authoritative state after reconnecting or reloading.

### 8.4 Sender validation

Every `ipcMain.handle` checks:

- The sender is the main window's web contents.
- The sender URL is the app's bundled URL, not a remote URL.
- The payload passes schema validation.
- The requested asset or target belongs to the current workspace.

### 8.5 Cancellation and streaming

- Long operations return an operation ID and stream progress events.
- Cancellation is a separate IPC call with the operation ID.
- AI streaming uses a request ID and chunk events; the renderer can cancel by ID.
- Streaming payloads are bounded and validated; no unvalidated content is rendered.

## 9. Security architecture

### 9.1 Trust boundaries

```text
Boundary 1: renderer <-> preload <-> main
  Untrusted input from renderer; validated at main.

Boundary 2: main <-> repository content
  Untrusted files and frontmatter; parse, validate, sanitize, limit.

Boundary 3: main <-> Agent directories and project roots
  Untrusted files; hash, parse, preserve unknown content.

Boundary 4: main <-> network
  Git remote, AI provider, catalog, updates; explicit user action, TLS, no content leakage.

Boundary 5: main <-> OS
  Keychain, filesystem, processes; least privilege and path allowlists.
```

### 9.2 Threat model

| Threat | Vector | Control |
| --- | --- | --- |
| Malicious Prompt or instruction content | Repository file | Sanitized Markdown, no raw HTML, no script execution, review gates |
| Malicious Skill scripts | Repository or catalog | No execution, content review, file list, trust checkbox |
| Malicious MCP command | MCP file | No process execution, health check is static, user confirmation on dispatch |
| Renderer XSS | Rendered Markdown or injected HTML | Strict sanitization, CSP, no remote content, no `dangerouslySetInnerHTML` on untrusted data |
| IPC injection | Compromised renderer | Allowlisted channels, schema validation, sender validation, no generic invoke |
| Path traversal | Asset paths, frontmatter, archive entries | Canonicalize and enforce root; reject `..`; no symlink escapes |
| Symlink attack | Repository or Skill content | Do not follow symlinks when reading or deleting; reject absolute or escaping symlinks |
| Secret exfiltration | Renderer, logs, crash reports | Never send stored secrets to renderer; redact logs; opt-in crash reporting |
| Update tampering | Update feed | Code signing, signature verification, HTTPS |
| Dependency compromise | npm supply chain | Lockfile, audit, minimal dependencies, pinned versions, review |
| Denial of service | Huge repository files, deep trees | Size and depth limits, pagination, async processing, cancellation |
| Local attacker | Same OS user | safeStorage protection, no plaintext secrets, OS file permissions |

### 9.3 Electron hardening

Required BrowserWindow configuration:

```ts
new BrowserWindow({
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    spellcheck: false,
  },
})
```

Required application controls:

- `app.enableSandbox()`.
- Disable navigation to remote URLs in `will-navigate`.
- Deny `window.open` and route allowed external links through `shell.openExternal` with an HTTPS allowlist and user confirmation.
- Reject permission requests by default (camera, microphone, geolocation, notifications).
- Use a strict Content Security Policy.
- Disable `eval` and remote script loading.
- Apply Electron fuses:
  - `runAsNode`: disabled.
  - `nodeCliInspect`: disabled.
  - `nodeOptions`: disabled.
  - `onlyLoadAppFromAsar`: enabled.
  - `enableEmbeddedAsarIntegrityValidation`: enabled where supported.
- Package native modules outside ASAR and load only signed app code.
- Do not expose `process`, `require`, or filesystem APIs to renderer.

Content Security Policy baseline:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'none';
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
```

Notes:

- `connect-src 'none'` is correct because the renderer does not make network requests; all network work happens in main.
- `style-src 'unsafe-inline'` may be required for React inline style attributes and CodeMirror. If the chosen styling approach avoids it, remove it. `[TBD-FE]`
- If local images are supported, they must be served through a custom protocol handler restricted to the asset roots, not `file://`.

### 9.4 Secret handling

```text
User enters a secret in renderer
  -> IPC payload (new value only)
  -> main encrypts with safeStorage
  -> ciphertext stored in SQLite
  -> renderer receives { hasValue: true, preview: '[REDACTED]' }
  -> decrypt only inside main during a confirmed write
```

Rules:

- If `safeStorage.isEncryptionAvailable()` is false, refuse to store secrets and show an actionable error. Never fall back to plaintext.
- Stored secrets are never included in list, detail, export, log, crash, or telemetry payloads.
- Diff and version views redact secret values.
- Secret rotation creates a new ciphertext and an audit event.
- Deleting a secret removes the ciphertext; the UI warns that Agent configs may still contain the old value until re-dispatched.
- Clipboard operations copy redacted configuration only.

### 9.5 Credential scanning

Scanner inputs:

- Prompt and Contract bodies before push.
- MCP env and header values before repository serialization.
- User-initiated export and diagnostic bundles.
- Catalog content before install.

Scanner design:

- Rule pack for known high-confidence patterns: `sk-...`, `ghp_...`, `AKIA...`, private key headers, and additional provider patterns.
- Entropy heuristic for long random strings, with allowlists for placeholders, URLs, and example values.
- Replacement guidance: `{{variable}}` for Prompts and Contracts, `${VAR}` for MCP.
- The scanner returns findings with location and a safe preview; it never logs the full match.
- A finding is blocking for pushes, not silently rewritten.

### 9.6 Filesystem safety

- Resolve and canonicalize every path with `fs.realpath` where the path exists.
- Enforce that the target is inside an allowed root: repository clone, project root, global target path, library, or blob store.
- Reject paths containing `..` after normalization.
- Use `lstat` and reject symlinks in repository content unless the asset type explicitly supports them.
- Do not follow symlinks during recursive copy or delete.
- Write with `O_CREAT | O_EXCL` for temp files; rename into place.
- Preserve file mode when updating an existing file; do not copy executable bits from untrusted content by default.
- Apply per-file and per-tree size limits.
- Reject Windows reserved device names and trailing dots or spaces in generated file names.

### 9.7 Supply chain and update integrity

- npm lockfile committed; installs use `npm ci` in CI.
- Dependency review for new runtime dependencies, including license and maintenance status.
- Native modules rebuilt for the target Electron ABI in CI.
- Release artifacts signed; macOS notarized; auto-update verifies signature and publisher.
- No post-install scripts from dependencies in production packaging unless reviewed.
- SBOM generated for each release `[TBD-INFRA]`.

## 10. Reliability and failure handling

### 10.1 Failure taxonomy

| Category | Example | Behavior |
| --- | --- | --- |
| Validation | Empty title, invalid glob | Inline error; no state change |
| Conflict | Revision precondition failed | Return current revision; ask user to reload |
| Not found | Deleted asset | Return a typed error; refresh list |
| Permission | Cannot write Agent directory | Explain path and permission; no partial write |
| Locked file | Windows file lock | Retry with backoff; then fail with guidance |
| Git auth | Credential or SSH failure | Preserve pending changes; show command context |
| Git conflict | Non-fast-forward | Fetch and recompute; never force |
| Database | Busy, corrupt, migration failure | Retry, backup restore, recovery window |
| Blob | Missing or hash mismatch | Mark degraded; offer version or pull recovery |
| Network | Offline, timeout | Queue or fail gracefully; core remains usable |
| Security | Credential detected | Block the operation; explain replacement |
| Internal | Unexpected exception | Structured error; log with redaction; no stack trace in UI |

### 10.2 Crash recovery

The app writes an operation journal entry before any multi-step operation:

```json
{
  "operationId": "op_...",
  "type": "dispatch|projection|sync|migration|restore",
  "state": "started|committed|failed",
  "targetPath": "...",
  "assetId": "...",
  "revisionId": "...",
  "startedAt": "...",
  "detail": {}
}
```

On startup:

- Started but not committed: inspect the target and database; if the target matches the new content, finalize the record; if not, mark the operation failed and leave the previous state.
- Target partially written: restore from backup if available; otherwise mark degraded and alert.
- Sync operation interrupted: re-fetch and recompute; never assume success.
- Deployment/projection reconciliation: compare manifests and file hashes; update status to synced, stale, drifted, or missing.

### 10.3 Atomic write helper

```text
writeAtomic(target, content):
  1. Ensure parent exists.
  2. Create temp file in the same directory.
  3. Write content; fsync file.
  4. Preserve mode if target exists.
  5. Rename temp to target; retry on EPERM/EBUSY with backoff.
  6. fsync parent directory where supported.
  7. On failure, delete temp and leave target untouched.
```

Before replacing an existing target, save the previous content hash and a backup copy.

## 11. Performance architecture

### 11.1 Hot paths

| Path | Risk | Mitigation |
| --- | --- | --- |
| App startup | Database migration, service init | Defer non-critical work until after first paint |
| List rendering | Thousands of rows | Virtualization, pagination, memoized rows |
| Search | FTS query and highlighting | FTS5, limits, debounce, snippet generation |
| Asset save | Blob write + materialization + FTS | Transaction boundaries, async file I/O, incremental index update |
| Git fetch | Network and large trees | Async child process, progress events, cancellation, content on demand |
| Dispatch | Many files and targets | Batch manifests, concurrency limit, progress |
| Drift reconciliation | Hashing large trees | Incremental hashes, watcher debounce, background queue |

### 11.2 Budgets

- Main-process event loop must not be blocked for more than 50 ms by a single operation.
- SQLite queries on the hot path must use indexes and return bounded result sets.
- FTS queries must cap results and snippet work.
- Git commands must use `--no-pager`, machine-readable output, and timeouts.
- File hashing runs in a worker or utility process for large trees.

### 11.3 Data growth

- Version history grows linearly. The app offers a retention setting `[TBD-BIZ]` and shows storage usage.
- Blob garbage collection runs after version deletion and backup rotation.
- Audit events are compact JSON and retained by policy `[TBD-BIZ]`.
- Sync change rows are pruned when resolved and older than a retention window, while audit events remain.

## 12. Platform-specific design

### 12.1 Path resolution

A platform-aware resolver expands:

- `~` to the OS home directory.
- Environment variables only for known Agent paths, never for arbitrary renderer input.
- macOS application support paths such as `~/Library/Application Support/...`.
- Windows roaming paths such as `%APPDATA%\...`.

The Agent registry stores platform-specific defaults, for example:

```ts
interface AgentTargetPath {
  darwin?: string
  win32?: string
  linux?: string
}
```

This is necessary because an earlier design's `~/Library/Application Support/...` paths are macOS-specific. Windows defaults must be defined explicitly before dispatch is enabled on Windows.

### 12.2 Windows

| Topic | Design |
| --- | --- |
| Symlinks | Use directory junctions for Skill installs; fall back to copy with explicit consent |
| Long paths | Enable long-path awareness in the installer manifest; normalize paths where possible |
| Line endings | Accept CRLF; preserve existing target file line endings |
| File locks | Retry atomic rename; surface a clear error if antivirus holds the file |
| Reserved names | Reject `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` in generated names |
| Case sensitivity | Treat asset paths as case-insensitive for collision checks |
| Install | Per-user NSIS installer; no admin requirement |
| Signing | Authenticode signature; timestamping enabled |

### 12.3 macOS

| Topic | Design |
| --- | --- |
| Symlinks | Standard directory symlinks |
| App distribution | Signed DMG or ZIP, hardened runtime, notarized with `notarytool` |
| Sandbox | Not sandboxed for direct distribution; App Sandbox would block Agent directory writes `[TBD-BIZ]` |
| Keychain | safeStorage uses the OS keychain |
| Apple Silicon | Native arm64 build or universal binary; native modules rebuilt per architecture |
| Quarantine | Standard notarization flow |

## 13. Packaging and update architecture

### 13.1 Artifacts

| Platform | Artifact |
| --- | --- |
| Windows | NSIS x64 installer, optional portable build `[TBD-INFRA]` |
| macOS | DMG and ZIP, arm64 and x64, or universal `[TBD-INFRA]` |
| Update metadata | `latest.yml` / `latest-mac.yml` from electron-builder |

### 13.2 Packaging rules

- ASAR enabled.
- `better-sqlite3` unpacked from ASAR and rebuilt for Electron.
- Migrations, target registry, and bundled catalogs included as read-only resources.
- No secrets, signing keys, or environment files in the package.
- Source maps are not shipped by default; upload them privately for diagnostics `[TBD-INFRA]`.

### 13.3 Update flow

```text
Startup or manual check
  -> query signed update feed over HTTPS
  -> verify version and signature
  -> download in background
  -> verify artifact signature
  -> prompt user to restart
  -> on restart, apply update
```

Rules:

- No update installation during a sync, dispatch, or projection operation.
- A failed update does not affect the installed version.
- Downgrades require explicit consent.
- Release channels: stable and beta. `[TBD-INFRA]`

## 14. Observability and audit

### 14.1 Audit events

Audit events are product-visible and persist in SQLite. They record:

- Event type and result.
- Asset ID and version.
- Target ID and path.
- Repository ID and commit, when applicable.
- Summary and redacted detail.

They never record secret values or full asset bodies.

### 14.2 Logs

- Structured JSON lines with timestamp, level, component, operation ID, and correlation ID.
- Rotated by size and age.
- Redaction filter for paths, tokens, and secret-like strings.
- Debug logging is opt-in and still redacted.
- Diagnostic export excludes asset content by default.

### 14.3 Local metrics

A local metrics panel aggregates audit data:

- Deliveries per week.
- Drift events.
- Blocked credentials.
- Sync success and failure counts.
- Storage usage by asset type and version history.

### 14.4 Telemetry

Off by default. If enabled:

- Event names only, no content.
- No asset titles, paths, repository names, or secret values.
- A documented event schema and privacy review.

## 15. Testing architecture

| Level | Scope | Tooling |
| --- | --- | --- |
| Unit | Shared domain: paths, serialization, globs, compiler, managed blocks, scanner, diff | Vitest |
| Integration | Services with temp SQLite, temp blobs, temp directories | Vitest + Node test environment |
| Git integration | Real Git CLI against local bare repositories | Vitest + fixtures |
| Contract tests | Each Agent target and each config format | Fixture-based tests |
| Component tests | Complex UI states and forms | React Testing Library |
| End-to-end | Install, edit, sync, dispatch, projection, conflict, rollback | Playwright Electron |
| Migration tests | Previous release database to current schema | Fixture databases |
| Security tests | IPC validation, path traversal, secret redaction, Markdown sanitization | Unit and integration |
| Packaging smoke tests | Install, launch, update, uninstall on both OSes | CI release pipeline |

Test fixtures must never contain real credentials. Use synthetic values that match scanner patterns but are clearly fake.

## 16. Architecture decision records

| ID | Decision | Alternatives | Rationale |
| --- | --- | --- | --- |
| ADR-001 | Electron for the desktop shell | Tauri, native, web-only | Reuses the React/TypeScript renderer and Node ecosystem; mature packaging, signing, and auto-update; consistent Chromium rendering |
| ADR-002 | Main process is the backend; no HTTP service | Local FastAPI sidecar, cloud backend | Single language, simpler packaging, no port management, direct OS integration, lower attack surface |
| ADR-003 | SQLite via better-sqlite3 | node:sqlite, sql.js, libsql, IndexedDB | Mature, synchronous transactions, FTS5, native performance, straightforward backup |
| ADR-004 | Content-addressed blob store | Store content in SQLite rows, plain files by ID | Deduplication, integrity checks, multi-file Skills, smaller database backups |
| ADR-005 | System Git CLI adapter | isomorphic-git, nodegit | Reuses system credentials and SSH agent; real Git behavior; avoids rebuilding libgit2 |
| ADR-006 | safeStorage for secrets | keytar, encrypted file with custom key | Built into Electron, OS-backed on Windows/macOS, no extra native dependency |
| ADR-007 | Shared pure domain module | Duplicate logic in renderer and main | Guarantees preview and write produce identical output |
| ADR-008 | Data-driven target registry | Per-vendor modules | Avoids duplicated CRUD and UI; adding a target is data plus tests |
| ADR-009 | Content-hash drift detection | mtime or size only | Correct under file copies, sync tools, and timestamp changes |
| ADR-010 | No automatic writes | Auto-apply on fetch | Preserves user trust and the product's safety contract |

Detailed technology choices and rejected alternatives are in [`docs/tech-stack.md`](./tech-stack.md).

## 17. Risks and open items

| ID | Item | Impact | Owner | Next step |
| --- | --- | --- | --- | --- |
| AR-01 | Project root registration UX is undefined `[TBD-UX]` | Blocks INS-007 | Design + product | Extend interaction design before implementation |
| AR-02 | TOML format-preserving editing is complex | MCP apply on Codex may reformat or refuse | Backend | Prototype the section-scoped editor and fixture tests |
| AR-03 | Windows junction behavior across Agents | Skill dispatch may fall back to copy | Backend + QA | Test with Claude Code, Cursor, Codex on Windows |
| AR-04 | External edits through symlinks | Could create unexpected revisions | Backend | Define watcher debounce and review UX |
| AR-05 | Large Skill directories | Hashing and copying cost | Backend | Set limits and measure |
| AR-06 | Git version and availability | Sync unavailable without Git | Product + engineering | Add detection and onboarding guidance |
| AR-07 | Code signing accounts and notarization | Blocks release | Release engineering | Confirm Apple Developer and Windows signing |
| AR-08 | Catalog source authenticity | Supply-chain risk | Security + product | Define signing and review process |
| AR-09 | Crash reporting and telemetry privacy | Compliance risk | Product + legal | Privacy review before enabling |
| AR-10 | SQLite synchronous writes on large imports | UI stalls | Backend | Batch transactions and measure |

## 18. Requirement traceability

| PRD group | Architecture sections |
| --- | --- |
| APP-001 to APP-011 | 4, 5.5, 8 |
| PRM-001 to PRM-013 | 5.3, 6.4, 7.1, 7.4 |
| INS-001 to INS-018 | 5.3, 7.7, 7.8, 7.9 |
| SKL-001 to SKL-015 | 5.3, 6.5, 7.5, 7.8 |
| MCP-001 to MCP-015 | 5.3, 6.4, 7.6, 9.4 |
| SYN-001 to SYN-017 | 7.2, 7.3, 7.4, 10 |
| DST-001 to DST-008 | 7.5 to 7.9, 14 |
| SRH-001 to SRH-004 | 6.3, 11 |
| SET-001 to SET-011 | 6.2, 6.7, 13, 14 |
| NFR performance | 11 |
| NFR reliability | 10 |
| NFR security | 9 |
| NFR packaging | 13 |
| NFR maintainability | 5, 15 |
| AI-001 to AI-004 | 4, 9, 15 |
| CAT-001 to CAT-003 | 9.7, 15 |

## 19. Glossary

| Term | Meaning |
| --- | --- |
| Main process | Electron process that owns the window, OS integration, and all writes |
| Renderer | Sandboxed Chromium process that renders the React UI |
| Preload | Script that exposes the typed IPC API to the renderer |
| Local service layer | The main-process services that act as the app's backend |
| Blob | Content-addressed file content stored outside SQLite |
| Materialized library | Normal file tree derived from the current asset revisions |
| Base | Last synchronized content between local and remote |
| Managed entry | A Skill deployment or MCP server entry owned by the app |
| Managed block | A marked region in a single-file instruction target |
| Projection | A contract write to a project-level or global instruction target |
| Drift | External modification of a managed file or entry |
| Reconciliation | Startup process that compares manifests and repairs status |

**End of document.** Any change to process boundaries, storage, security controls, or the trust contract requires an update to this document and a corresponding update to the PRD and technical design documents.
