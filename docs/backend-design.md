# Prompt Keeper Backend Technical Design

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Backend Technical Design |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; pending backend and security review |
| Runtime | Electron main process (local service layer) |
| Language | TypeScript, strict |
| Primary audience | Backend, platform, security, QA, release engineering |
| Related documents | [`docs/prd.md`](./prd.md), [`docs/architecture.md`](./architecture.md), [`docs/tech-stack.md`](./tech-stack.md), [`docs/frontend-design.md`](./frontend-design.md), [`docs/interaction-design.md`](./interaction-design.md) |
| Annotation rules | `[FACT]`, `[ASSUMPTION]`, `[TBD-UX]`, `[TBD-BE]`, `[TBD-INFRA]` |

## Document status

This document describes the **main-process backend implemented in this repository**. The service layer, SQLite schema, blob store, Git adapter, dispatch engine, and projection engine exist under `src/main`. Simplifications and deferred items are tracked in [`docs/implementation-status.md`](./implementation-status.md).

The term **backend** in this document means the Electron main process and its local services. There is no HTTP server, no remote database, and no hosted application backend in the target architecture.

## 1. Scope and responsibilities

The main process owns every durable effect:

- SQLite schema, queries, transactions, and migrations.
- Content-addressed blob storage.
- Materialized library files.
- Git clone management and Git commands.
- Sync state, three-way merge, and conflict records.
- Agent detection, Skill dispatch, and MCP configuration writes.
- Contract compilation, project and global projection, and drift detection.
- Secret encryption and decryption.
- Credential scanning.
- Full-text index maintenance.
- Audit events, logs, backups, and restore.
- Update checks and application lifecycle.
- AI provider requests and streaming (P1).

It must not:

- Render UI.
- Trust renderer input.
- Execute Skill scripts, MCP commands, or repository hooks.
- Write outside configured roots.
- Send stored secrets to the renderer.
- Perform automatic merge, commit, push, projection, or dispatch.

## 2. Process and service architecture

```text
+---------------------------------------------------------------+
| Electron main process                                         |
|                                                               |
|  Bootstrap                                                    |
|    single instance, security, window, lifecycle               |
|                                                               |
|  IPC edge                                                     |
|    sender validation, schema validation, rate limits           |
|                                                               |
|  Application services                                         |
|    Asset | Prompt | Contract | Skill | Mcp                    |
|    Repo | Sync | Dispatch | Projection                        |
|    Secret | Scan | Search | Audit | Backup                    |
|    Update | Ai | Settings                                     |
|                                                               |
|  Repositories                                                 |
|    Drizzle queries and raw SQL                                |
|                                                               |
|  Adapters                                                     |
|    Git CLI | filesystem | agents | config formats | network   |
|                                                               |
|  Infrastructure                                               |
|    SQLite | blobs | library | clones | logs | journal         |
+---------------------------------------------------------------+
```

### 2.1 Service layering

| Layer | Rule |
| --- | --- |
| IPC handlers | Thin: validate, authorize, call a service, map errors |
| Services | Own use cases, transactions, policy, and events |
| Repositories | Own SQL and row mapping; no business policy |
| Adapters | Own OS and external protocol details; no domain policy |
| Shared domain | Pure deterministic rules used by services and renderer previews |

### 2.2 Dependency rules

- A service may call repositories, adapters, and shared domain functions.
- A repository may not call a service.
- An adapter may not write the database directly.
- Shared domain code may not import Electron, Node builtins, or database modules.
- Services return DTOs, never raw database rows or secret ciphertext.

## 3. Bootstrap and lifecycle

### 3.1 Startup

```ts
app.requestSingleInstanceLock()
app.enableSandbox()
configureSecurity()
await ensureDirectories()
initLogger()
await openDatabase()
await checkIntegrity()
await backupBeforeMigration()
await migrate()
initBlobStore()
initSecretCipher()
initServices()
registerIpcHandlers()
await reconcileInterruptedOperations()
createMainWindow()
startScheduler()
startWatchers()
```

Ordering rules:

- The database opens before any service constructs queries.
- Migrations run before repositories are used.
- Reconciliation runs before the window shows authoritative state.
- The window may show a loading shell while reconciliation runs, but must not display stale delivery status as current.
- Watchers and the scheduler start after the first paint to reduce startup contention.

### 3.2 Shutdown

```ts
stopScheduler()
stopWatchers()
await cancelInFlightOperations({ timeoutMs: 5000 })
await flushAuditQueue()
closeDatabase()
releaseSingleInstanceLock()
```

- `before-quit` may be deferred once while a critical write finishes.
- A second quit request force-closes after the timeout.
- Git child processes are terminated with their process group where possible.

### 3.3 Single instance

- The app acquires a single-instance lock.
- A second launch focuses the existing window and forwards any command-line intent.
- Multiple windows are allowed only after the multi-window decision is made; the default is one window.
- The database is never opened by two app instances.

### 3.4 Crash recovery

The app maintains an `operations` journal. On startup:

1. Run `PRAGMA quick_check`; if it fails, enter recovery mode.
2. Find operations in state `started` or `writing`.
3. For each operation, compare the target file hash and the database record.
4. If the target matches the intended new content, finalize the record.
5. If the target matches the previous content, mark the operation failed.
6. If the target is partially written, restore from the operation backup and mark degraded.
7. Reconcile deployments and projections by hashing targets.
8. Rebuild the FTS index if a migration or corruption marker requires it.

## 4. IPC contract

### 4.1 Result envelope

```ts
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcErrorPayload }

interface IpcErrorPayload {
  code: ErrorCode
  message: string
  details?: unknown
  retryable: boolean
}
```

`details` must never contain secrets, full asset bodies, or unredacted configuration.

### 4.2 Error codes

| Code | Meaning | Renderer behavior |
| --- | --- | --- |
| `VALIDATION` | Invalid input or business rule violation | Show field or inline error |
| `NOT_FOUND` | Asset, target, or record missing | Refresh and show a message |
| `CONFLICT` | Revision precondition failed | Preserve draft; offer reload or compare |
| `REVISION_CONFLICT` | Concurrent content change | Same as `CONFLICT` |
| `PERMISSION` | Filesystem permission denied | Explain path and permission |
| `LOCKED` | File locked by another process | Retry or guide the user |
| `GIT_NOT_FOUND` | Git executable missing | Onboarding or settings guidance |
| `GIT_AUTH` | Credential or SSH failure | Show operation context; do not echo secrets |
| `GIT_CONFLICT` | Non-fast-forward or merge state | Fetch and recompute |
| `NETWORK` | Timeout or connection failure | Retry when safe |
| `SECURITY_BLOCK` | Credential or policy violation | Show replacement workflow |
| `UNSUPPORTED` | Target cannot perform the action | Disable action with reason |
| `CORRUPT` | Integrity check failed | Offer backup restore |
| `INTERNAL` | Unexpected error | Show trace ID and log reference |

### 4.3 Channel catalog

The canonical channel list, request and response DTOs, error details, event payloads, and concurrency rules are defined in [`docs/api-contract.md`](./api-contract.md). This table is a summary. When the two documents differ about a channel name or payload shape, the API contract wins and this table must be updated.

| Group | Channels |
| --- | --- |
| Bootstrap | `app:bootstrap`, `app:theme`, `app:openExternal`, `app:revealPath` |
| Prompts | `prompts:list`, `prompts:get`, `prompts:create`, `prompts:update`, `prompts:delete`, `prompts:restore`, `prompts:copyRender`, `prompts:setSyncPolicy`, `prompts:folders` |
| Contracts | `contracts:list`, `contracts:get`, `contracts:create`, `contracts:update`, `contracts:delete`, `contracts:restore`, `contracts:resolve`, `contracts:compile`, `contracts:setSyncPolicy` |
| Skills | `skills:list`, `skills:get`, `skills:create`, `skills:update`, `skills:delete`, `skills:restore`, `skills:files`, `skills:import`, `skills:storeList` |
| MCP | `mcp:list`, `mcp:get`, `mcp:create`, `mcp:update`, `mcp:delete`, `mcp:restore`, `mcp:health`, `mcp:setEnabled`, `mcp:apply`, `mcp:remove`, `mcp:agentState`, `mcp:storeList` |
| Sync | `sync:repoGet`, `sync:repoConnect`, `sync:repoDisconnect`, `sync:repoUpdate`, `sync:fetch`, `sync:changes`, `sync:review`, `sync:pull`, `sync:push`, `sync:conflictResolve`, `sync:history`, `sync:cancel`, `sync:progress` (event) |
| Dispatch | `dispatch:matrix`, `dispatch:detail`, `dispatch:install`, `dispatch:remove`, `dispatch:rollback`, `dispatch:syncStale` |
| Projection | `projections:list`, `projections:project`, `projections:reproject`, `projections:remove`, `projections:rollback`, `projections:overwriteDrift` |
| Global targets | `globalTargets:list`, `globalTargets:updatePath`, `globalTargets:restoreDefault`, `globalProjections:list`, `globalProjections:project` |
| Search | `search:query`, `search:rebuild` |
| Settings | `settings:get`, `settings:update`, `settings:backup`, `settings:restore`, `settings:diagnostics` |
| Updates | `updates:check`, `updates:download`, `updates:install`, `updates:status` |
| AI | `ai:providers`, `ai:test`, `ai:stream` (event), `ai:cancel`, `ai:history` |
| Events | `domain:changed`, `operation:progress`, `operation:completed`, `update:available` |

### 4.4 Handler template

```ts
register('prompts:update', PromptUpdateRequest, async (input, event) => {
  assertMainWindow(event)
  const prompt = await promptService.update(input.id, input, { expectedRevisionId: input.expectedRevisionId })
  emitDomainChanged({ domain: 'prompts', ids: [prompt.id], reason: 'updated' })
  return prompt
})
```

Rules:

- The request schema is parsed before the service call.
- The response schema is validated in development and in tests.
- Sender validation runs before parsing expensive input.
- Mutation handlers are idempotent where a request ID is supplied.
- Payload size limits are enforced before parsing.

### 4.5 Event delivery

- Events are sent to the main window only.
- Events are coalesced for burst updates.
- Events carry IDs, not content.
- If the renderer reloads, it refetches; no event replay is required.

## 5. Service catalog

### 5.1 Asset service

Responsibilities:

- Common asset CRUD and metadata.
- Folder normalization and slug generation.
- Stable ID generation.
- Revision creation and manifest computation.
- Materialization into the library tree.
- Soft delete and purge.
- Tag management.
- Domain event emission.

Operations:

```ts
createAsset(kind, input): Promise<AssetDetail>
updateAsset(id, input, expectedRevisionId): Promise<AssetDetail>
softDelete(id): Promise<void>
restore(id): Promise<AssetDetail>
purge(id): Promise<void>
getAsset(id): Promise<AssetDetail>
listAssets(query): Promise<AssetPage>
createRevision(assetId, files, note): Promise<Revision>
materialize(assetId, revisionId): Promise<void>
```

Write sequence:

```text
1. Validate folder, slug, and metadata.
2. Normalize file paths; reject traversal.
3. Hash and write new blobs (outside the DB transaction).
4. Begin transaction.
5. Insert revision and file manifest.
6. Update asset metadata and updated_at.
7. Update tags.
8. Update FTS rows.
9. Commit.
10. Materialize the library tree.
11. Emit domain event.
```

If materialization fails, the revision is still durable; a reconciler repairs the materialized tree. If the transaction fails, orphan blobs remain until garbage collection.

### 5.2 Prompt service

Responsibilities:

- Prompt-specific validation and serialization.
- Variable parsing and copy rendering.
- Sync policy management.
- Version restore.

Rules:

- At least one of System or User must be non-empty.
- Variable names are unique and valid identifiers.
- Variable values are never stored.
- Serialization uses the canonical `.prompt.md` format.
- Copy rendering substitutes values and escapes nothing beyond the declared variables; unknown variables remain visible and produce a warning.

### 5.3 Contract service

Responsibilities:

- Contract validation and serialization.
- Target compatibility checks.
- Resolution preview.
- Compilation for project and global targets.
- Version restore.

Rules:

- Target registry data is loaded from shared code.
- The same compiler is used for preview and write.
- Incompatible activation modes produce a warning, not a silent downgrade.
- Path scope requires a prefix; glob activation requires at least one glob.
- Imports are validated as relative or documented paths and never executed.

### 5.4 Skill service

Responsibilities:

- Multi-file Skill import and editing.
- Text and binary classification.
- Manifest computation.
- Version labels.
- Store review metadata (P1).

Rules:

- A Skill directory must contain `SKILL.md` at its root.
- Duplicate names within a folder are rejected.
- Binary files are stored in blobs but not rendered.
- Executable bits are preserved in the manifest but not executed.
- Imported symlinks are rejected unless the user explicitly reviews them `[TBD-BE]`.

### 5.5 MCP service

Responsibilities:

- MCP configuration validation and serialization.
- Secret key detection and storage.
- Health checks.
- Redacted DTO generation.
- Target application.

Rules:

- A server is either stdio (command) or HTTP (URL).
- Credential-like keys are stored in `secrets`, not in plain JSON.
- Non-secret values may remain in JSON.
- Redaction is applied at the DTO boundary, not in the renderer.
- Health checks are static and do not spawn processes.
- Saving a config creates a revision and a sync change if the asset participates.

### 5.6 Repo service

Responsibilities:

- Repository connection and validation.
- Clone management.
- Directory layout and policies.
- Authentication mode.
- Repository metadata and status.

Rules:

- One repository per workspace in the MVP.
- The local path must be absolute and writable.
- A bound clone must be clean in managed paths before writes.
- The app never deletes a user-provided clone.
- Disconnecting removes the relationship only, not local assets or clones, unless the user explicitly deletes the app-managed clone.

### 5.7 Sync service

Responsibilities:

- Fetch, compute changes, review, pull, push.
- Three-way merge and conflict state.
- Base snapshot management.
- Operation journal and progress events.
- Audit events.

Rules:

- One operation per repository at a time.
- Fetch is read-only.
- Pull applies only reviewed changes.
- Push never forces.
- A failed operation leaves pending changes intact.
- The remote content hash is rechecked before applying a reviewed change.

### 5.8 Dispatch service

Responsibilities:

- Agent detection.
- Skill install, remove, rollback.
- MCP apply, remove, rollback.
- Drift detection.
- Status matrix.

Rules:

- Disabled MCP servers cannot be applied.
- Skill scripts are never executed.
- Drift is hash-based.
- Removal deletes only app-managed content.
- Symlink fallback is explicit.

### 5.9 Projection service

Responsibilities:

- Project and global projection.
- Managed block merging.
- Drift classification.
- Path changes and stale state.
- Rollback and orphan records.

Rules:

- Project roots must be registered and validated.
- Global paths are local-only.
- Drift blocks bulk operations.
- Removing a projection never deletes the contract.
- Deleting a contract leaves orphan records.

### 5.10 Secret service

Responsibilities:

- Encrypt and decrypt secret values.
- Redact DTOs and logs.
- Rotate values.
- Detect availability of safeStorage.

Rules:

- If encryption is unavailable, refuse to store and return a typed error.
- Decryption is allowed only during a confirmed write or an explicit user reveal action `[TBD-BE]`.
- The renderer never receives a stored value.
- Secret values are not logged, even at debug level.
- A test cipher is used only in tests.

### 5.11 Scanner service

Responsibilities:

- Scan content before push, export, and catalog install.
- Return findings with location, rule, and safe preview.
- Provide replacement guidance.

Rules:

- Findings are blocking for push and catalog install.
- The scanner never rewrites content automatically.
- The scanner never sends content to a network service.
- Findings are redacted in logs.

### 5.12 Search service

Responsibilities:

- Maintain `assets_fts`.
- Query with ranking and snippets.
- Rebuild the index.
- Folder counts and aggregates.

Rules:

- Index updates happen in the same transaction as the asset change.
- Deletes remove index rows.
- Search never returns content that the user cannot access in the library.
- Query results are capped and paginated.

### 5.13 Audit service

Responsibilities:

- Append audit events.
- Query and filter history.
- Export redacted events.
- Retain by policy.

Rules:

- Audit events are append-only.
- They never include secrets or full bodies.
- Every dispatch, projection, sync, security block, and rollback writes one event.

### 5.14 Backup service

Responsibilities:

- Database snapshot.
- Blob snapshot.
- Manifest and integrity verification.
- Restore with safety backup.

Rules:

- A backup is consistent even while the app is running.
- Restore validates every blob hash before swapping.
- A failed restore leaves current data intact.

### 5.15 Update service

Responsibilities:

- Check for signed updates.
- Download and verify.
- Prompt for restart.
- Report channel and version.

Rules:

- Update checks never block startup.
- Installation is deferred during active writes.
- Downgrades require explicit consent.

### 5.16 AI service (P1)

Responsibilities:

- Provider configuration.
- Streaming requests from the main process.
- Cancellation.
- Test history.

Rules:

- API keys are encrypted and never returned to the renderer.
- Requests go directly to the user's provider.
- No product proxy or hosted inference.
- The first request requires a data disclosure acknowledgement.
- Response content is rendered as untrusted Markdown.

## 6. Data model

### 6.1 Conventions

- IDs are opaque strings with a type prefix, for example `ast_`, `rev_`, `dep_`, `prj_`, `evt_`.
- Timestamps are ISO 8601 UTC strings.
- Booleans are integers 0/1 in SQLite.
- Folder paths use `/` separators and no leading or trailing slash; the root folder is the empty string.
- JSON columns are validated on write.
- Foreign keys are enabled.
- `STRICT` tables are recommended where all columns have clear types `[TBD-BE]`.

### 6.2 Schema DDL

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('prompt', 'contract', 'skill', 'mcp')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sync_policy TEXT NOT NULL DEFAULT 'inherit'
    CHECK (sync_policy IN ('inherit', 'sync', 'local')),
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (kind, folder, slug)
);

CREATE INDEX idx_assets_kind_folder ON assets (kind, folder);
CREATE INDEX idx_assets_updated ON assets (updated_at DESC);
CREATE INDEX idx_assets_deleted ON assets (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE asset_revisions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  note TEXT,
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version)
);

CREATE INDEX idx_revisions_asset ON asset_revisions (asset_id, version DESC);

CREATE TABLE asset_files (
  revision_id TEXT NOT NULL REFERENCES asset_revisions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  blob_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'text'
    CHECK (media_kind IN ('text', 'binary')),
  is_executable INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (revision_id, path)
);

CREATE TABLE prompts (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL DEFAULT '',
  user_prompt TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE contracts (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'path')),
  path_prefix TEXT,
  activation_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  imports_json TEXT NOT NULL DEFAULT '[]',
  target_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE skills (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL DEFAULT '1.0.0',
  author TEXT,
  category TEXT,
  icon TEXT
);

CREATE TABLE mcp_servers (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  env_json TEXT NOT NULL DEFAULT '{}',
  headers_json TEXT NOT NULL DEFAULT '{}',
  required_env_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  health_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('mcp_env', 'mcp_header', 'ai_key')),
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, key)
);

CREATE TABLE tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag)
);

CREATE INDEX idx_tags_tag ON tags (tag);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'generic')),
  url TEXT NOT NULL,
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('credential', 'ssh', 'token')),
  clone_mode TEXT NOT NULL CHECK (clone_mode IN ('managed', 'bound')),
  policies_json TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  auto_fetch INTEGER NOT NULL DEFAULT 0,
  fetch_interval_min INTEGER NOT NULL DEFAULT 15,
  push_mode TEXT NOT NULL DEFAULT 'direct'
    CHECK (push_mode IN ('direct', 'branch')),
  last_fetched_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repo_assets (
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  remote_path TEXT NOT NULL,
  base_commit TEXT,
  base_revision_id TEXT REFERENCES asset_revisions(id),
  base_manifest_hash TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (repo_id, asset_id)
);

CREATE TABLE sync_changes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('prompt', 'contract', 'skill', 'mcp')),
  asset_name TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'conflict')),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'deleted', 'renamed')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  risk_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  local_revision_id TEXT REFERENCES asset_revisions(id),
  base_revision_id TEXT REFERENCES asset_revisions(id),
  remote_commit TEXT,
  remote_blob_hash TEXT,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repo_id, fingerprint)
);

CREATE INDEX idx_sync_changes_repo ON sync_changes (repo_id, direction, status);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'sync_fetch', 'sync_pull', 'sync_push', 'dispatch', 'projection',
    'migration', 'restore', 'backup', 'catalog_install'
  )),
  state TEXT NOT NULL CHECK (state IN ('started', 'writing', 'committed', 'failed', 'cancelled')),
  repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  target_path TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_operations_state ON operations (state, started_at);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  detected INTEGER NOT NULL DEFAULT 0,
  detected_at TEXT,
  skill_dir TEXT,
  mcp_file TEXT,
  supports_skills INTEGER NOT NULL DEFAULT 0,
  supports_mcp INTEGER NOT NULL DEFAULT 0,
  config_format TEXT
);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('skill', 'mcp')),
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('symlink', 'copy')),
  status TEXT NOT NULL CHECK (status IN ('synced', 'stale', 'drifted', 'missing')),
  target_path TEXT NOT NULL,
  deployed_revision_id TEXT REFERENCES asset_revisions(id),
  previous_revision_id TEXT REFERENCES asset_revisions(id),
  manifest_hash TEXT NOT NULL,
  managed_keys_json TEXT NOT NULL DEFAULT '[]',
  deployed_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (asset_id, agent_id)
);

CREATE INDEX idx_deployments_agent ON deployments (agent_id, status);

CREATE TABLE projections (
  id TEXT PRIMARY KEY,
  contract_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  contract_title TEXT,
  contract_slug TEXT,
  target_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id TEXT NOT NULL DEFAULT '',
  target_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('synced', 'stale', 'drifted', 'missing')),
  deployed_revision_id TEXT REFERENCES asset_revisions(id),
  previous_revision_id TEXT REFERENCES asset_revisions(id),
  file_hash TEXT,
  outside_hash TEXT,
  block_hash TEXT,
  deployed_at TEXT,
  note TEXT,
  CHECK (
    (scope = 'global' AND project_id = '') OR
    (scope = 'project' AND project_id <> '')
  ),
  UNIQUE (contract_id, target_id, scope, project_id)
);

CREATE INDEX idx_projections_contract ON projections (contract_id);
CREATE INDEX idx_projections_target ON projections (target_id, scope, project_id);

CREATE TABLE global_targets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  path_mode TEXT NOT NULL CHECK (path_mode IN ('file', 'dir')),
  path TEXT NOT NULL,
  default_path TEXT NOT NULL,
  format TEXT NOT NULL,
  merge_mode TEXT NOT NULL CHECK (merge_mode IN ('single-file', 'per-contract')),
  file_ext TEXT,
  supports_json TEXT NOT NULL,
  max_bytes INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'warning', 'error')),
  title TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  asset_id TEXT,
  target_id TEXT,
  repo_id TEXT,
  operation_id TEXT
);

CREATE INDEX idx_audit_at ON audit_events (at DESC);
CREATE INDEX idx_audit_type ON audit_events (type, at DESC);

CREATE VIRTUAL TABLE assets_fts USING fts5(
  asset_id UNINDEXED,
  kind UNINDEXED,
  title,
  description,
  body,
  tags,
  path,
  tokenize = 'unicode61'
);
```

### 6.3 Index rationale

| Index | Supports |
| --- | --- |
| `assets(kind, folder)` | Folder tree and list filters |
| `assets(updated_at DESC)` | Default sort |
| `asset_revisions(asset_id, version DESC)` | Version history |
| `tags(tag)` | Tag filters |
| `sync_changes(repo_id, direction, status)` | Changes lists |
| `operations(state, started_at)` | Crash recovery |
| `deployments(agent_id, status)` | Dispatch matrix |
| `projections(target_id, scope, project_id)` | Projection pages |
| `audit_events(at DESC)` | History |

### 6.4 JSON column contracts

| Column | Shape |
| --- | --- |
| `prompts.variables_json` | `PromptVariable[]` |
| `contracts.activation_json` | `{ mode, globs, description? }` |
| `contracts.imports_json` | `string[]` |
| `contracts.target_ids_json` | `string[]` |
| `mcp_servers.args_json` | `string[]` |
| `mcp_servers.env_json` | `Record<string, string \| { "$secret": string }>` |
| `mcp_servers.headers_json` | Same as env |
| `mcp_servers.required_env_json` | `string[]` |
| `mcp_servers.health_json` | `HealthIssue[]` |
| `repos.policies_json` | `{ skills, mcp, prompts, contracts: boolean }` |
| `repos.layout_json` | `{ prompts, contracts, skills, mcp: string }` |
| `sync_changes.risk_json` | `SyncRisk[]` |
| `global_targets.supports_json` | `{ globs, modelDecision, manual, imports: boolean }` |
| `audit_events.detail_json` | Redacted event detail |

All JSON is validated by Zod before write and parsed defensively on read.

### 6.5 Structured columns and canonical files

Prompt, Contract, and MCP assets have both structured columns and a canonical repository file per revision.

- The structured columns (`prompts.system_prompt`, `contracts.body`, `mcp_servers.env_json`, and so on) are the editable source used by the UI and fast reads.
- `asset_files` stores the exact canonical file bytes for each revision, used for sync, export, materialization, diff, and rollback.
- Both are written in the same transaction and must describe the same content.
- On sync, export, and rollback, the canonical blob is authoritative.
- If the two ever diverge because of a bug or an interrupted write, the asset is marked degraded, the canonical file is preserved, and the user reviews the conflict before the structured columns are rebuilt.

For Skills, there is no separate structured body; the file manifest is the content model.

## 7. Blob store and manifests

### 7.1 Blob operations

```ts
interface BlobStore {
  write(content: Buffer): Promise<{ hash: string; size: number }>
  read(hash: string): Promise<Buffer>
  exists(hash: string): Promise<boolean>
  deleteUnreferenced(hashes: string[]): Promise<void>
  verify(hash: string): Promise<boolean>
}
```

Rules:

- Content is hashed before write.
- If the blob exists, verify its hash and reuse it.
- Writes are atomic: temp file, fsync, rename.
- Reads verify size and hash before returning content used for a write.
- A hash mismatch is a `CORRUPT` error.
- Blob paths are not derived from user file names.

### 7.2 Manifest

```ts
interface AssetManifest {
  files: Array<{
    path: string
    blobHash: string
    size: number
    mediaKind: 'text' | 'binary'
    isExecutable: boolean
  }>
  hash: string
}
```

- Manifest hash is SHA-256 over a canonical JSON representation sorted by path.
- A revision always has a manifest, even for a single file.
- Two revisions with the same manifest hash are identical content.
- The manifest is the basis for drift and sync comparison.

### 7.3 Garbage collection

- Mark phase: collect hashes referenced by all revisions, deployments, projections, and active operations.
- Sweep phase: delete unreferenced blobs older than a grace period.
- Never delete a blob during an active operation.
- Run GC after version purge, backup rotation, or a low-disk event.
- Log the count and bytes reclaimed.

## 8. Asset services in detail

### 8.1 Revision creation

```ts
interface CreateRevisionInput {
  assetId: string
  files: Array<{ path: string; content: Buffer; mediaKind: 'text' | 'binary'; isExecutable?: boolean }>
  note?: string
  expectedRevisionId?: string
}
```

Steps:

1. Validate the asset and expected revision.
2. Normalize and validate file paths.
3. Write blobs.
4. Compute the manifest.
5. Begin a transaction.
6. Insert the revision with the next version number.
7. Insert file rows.
8. Update the asset `updated_at` and metadata.
9. Update tags and FTS.
10. Commit.
11. Materialize and emit an event.

Concurrency:

- The transaction uses `BEGIN IMMEDIATE` for write operations.
- The next version number is computed inside the transaction.
- Unique constraints protect against duplicate versions.

### 8.2 Materialization

- Target directory: `library/<kind>/<asset-id>/`.
- The current revision's files are written to a staging directory, then swapped into place.
- File modes are applied from the manifest.
- The previous materialized directory is removed only after the swap succeeds.
- A materialization failure does not invalidate the revision; a repair job retries.
- Materialization is skipped for assets that are never symlinked, but is kept for consistency and user-visible paths.

### 8.3 Soft delete and purge

- Soft delete sets `deleted_at`, withdraws pending sync items, and keeps revisions for a retention window.
- Soft-deleted assets are excluded from lists and search.
- Purge deletes revisions and files, then garbage-collects blobs.
- A purged asset cannot be restored; the UI warns before purge.
- The repository is never modified by local delete or purge.

### 8.4 Stable ID and slug

- A new asset gets an ID once.
- The slug is derived from the title, but an existing slug is preserved on rename unless the user explicitly changes it.
- Duplicate slugs in the same kind and folder are rejected.
- Moving an asset changes `folder` and `repo_path` and updates pending sync paths.
- The repository file name uses the slug, not the ID.

## 9. Git adapter and sync engine

### 9.1 Git adapter interface

```ts
interface GitClient {
  version(): Promise<string>
  clone(input: CloneInput): Promise<void>
  status(repoPath: string): Promise<GitStatus>
  fetch(repoPath: string, remote: string): Promise<void>
  resolveRef(repoPath: string, ref: string): Promise<string>
  listTree(repoPath: string, ref: string, roots: string[]): Promise<GitTreeEntry[]>
  readFile(repoPath: string, ref: string, path: string): Promise<Buffer>
  add(repoPath: string, paths: string[]): Promise<void>
  commit(repoPath: string, message: string, paths: string[]): Promise<string>
  push(repoPath: string, remote: string, branch: string): Promise<void>
  restore(repoPath: string, paths: string[]): Promise<void>
  log(repoPath: string, limit: number): Promise<GitCommit[]>
}
```

### 9.2 Command execution

```ts
spawn('git', args, {
  cwd,
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
  },
})
```

Rules:

- Never use a shell string; always pass an argument array.
- Set a timeout per command.
- Capture stdout and stderr with a size limit.
- Redact credentials from stderr before logging.
- Use `-z` or porcelain formats for parsing.
- Never run `git gui`, `git add -p`, or any interactive command.
- Never set `--force`.
- Use `--no-pager`.
- Use `--no-tags` for fetch unless tags are needed.

### 9.3 Repository connect

```text
validate URL / owner-repo / local path
  -> check Git version
  -> clone or bind
  -> check status
  -> inspect layout roots
  -> scan files and parse frontmatter
  -> report counts, malformed files, scripts, credentials
  -> user confirmation
  -> persist repo, layout, policies, initial base
```

Validation rules:

- URL must be HTTPS or SSH and must not contain credentials.
- Local path must be absolute, writable, and not inside the app bundle.
- Bound clone must be a Git worktree.
- Layout roots must be relative paths without `..`.
- Duplicate asset IDs across files are blocking.
- Malformed files are reported, not rewritten.

### 9.4 Fetch sequence

```text
1. Acquire the repo lock.
2. Create an operation row.
3. git fetch --prune --no-tags <remote>
4. Resolve the remote branch commit.
5. If the remote commit equals the last fetched commit, finish.
6. List the remote tree under managed roots.
7. For changed paths, read content and parse assets by stable ID.
8. Compute incoming, outgoing, and conflicts against local and base.
9. Upsert sync_changes with fingerprints.
10. Update last_fetched_at.
11. Finish the operation and emit progress/completion.
```

Fetch does not modify assets, blobs, or base. It may store remote content hashes only.

### 9.5 Change computation

For each asset ID in the union of local, remote, and base:

```text
local = current revision manifest
remote = parsed remote files
base = base revision manifest
```

Classify per file and aggregate:

| Situation | Result |
| --- | --- |
| Local manifest equals base, remote equals base | In sync |
| Local differs, remote equals base | Outgoing |
| Remote differs, local equals base | Incoming |
| Both differ but remote manifest equals local manifest | In sync |
| Both differ and differ from each other | Conflict |
| Local deleted, remote equals base | Outgoing deletion |
| Remote deleted, local equals base | Incoming deletion |
| Deleted on one side, modified on the other | Conflict |

Risk computation:

- `scripts`: Skill contains executable or script-like files.
- `secrets`: scanner finds a likely credential.
- `network`: MCP has a URL or a network command.
- `none`: no risk markers.

### 9.6 Review and pull

Review records:

- Change ID, content hash, risk, and the user's confirmation.
- Review is invalidated if the remote hash changes.

Pull steps:

1. Re-read the remote content and verify the reviewed hash.
2. Parse and validate the asset.
3. Write blobs.
4. Create a new local revision.
5. Update the asset.
6. Update `repo_assets` base to the remote manifest and commit.
7. Mark the change resolved.
8. Emit a domain event.

If any step fails, the transaction rolls back and the change remains pending.

### 9.7 Push

```text
1. Acquire the repo lock.
2. Validate selected outgoing changes.
3. Validate file structure and stable IDs.
4. Scan bodies and MCP files for credentials.
5. Recompute canonical files.
6. Check the clone is clean in managed paths.
7. Write canonical files to the worktree.
8. git add -- <managed paths>
9. git commit --only -m <message> -- <managed paths>
10. git push <remote> <branch>
11. On success, update base for pushed assets and mark changes resolved.
12. On failure, leave the local commit and changes pending; report the phase.
```

Safety:

- If the worktree has uncommitted changes in managed paths, refuse and explain.
- If the index has staged changes in managed paths that the app did not create, refuse.
- On commit failure, restore the worktree paths from `HEAD`.
- On push failure after commit, keep the commit; the next push retries.
- Never amend, rebase, force-push, or delete remote branches.
- Never commit files outside managed roots.

### 9.8 Conflict resolution

Take repository:

- Replace the local revision with remote content.
- Create a new local revision.
- Set base to the remote manifest.
- Mark resolved.
- Mark related projections stale.

Keep local:

- Keep the local revision.
- Set base to the remote manifest.
- Create a new outgoing change.
- Mark the conflict resolved with a note.

Manual merge:

- Merge per file where possible.
- Present conflicting files for editing.
- Validate structure after merge.
- Create a local revision with both parents recorded in the revision note.
- Set base to the remote manifest.
- Create an outgoing change.

### 9.9 Rename and deletion

- Stable ID determines identity.
- A rename is detected when the same ID exists at a different path.
- A delete plus add with different IDs is treated as two changes.
- Local deletion never deletes the remote file.
- Remote deletion is an incoming change; applying it deletes the local asset only after review.
- Tombstone deletion push is not in the MVP.

### 9.10 Auto-fetch scheduler

- One timer per repository.
- Interval from settings, with jitter.
- Skips when offline, when another operation is running, or when the app is suspended.
- Exponential backoff on failure.
- Emits a change count, never auto-merges.
- No auto-fetch when the repository is disconnected.

## 10. Dispatch engine

### 10.1 Agent registry

The registry is static shared data:

```ts
interface AgentDefinition {
  id: string
  name: string
  platforms: {
    darwin?: AgentPaths
    win32?: AgentPaths
  }
  supportsSkills: boolean
  supportsMcp: boolean
  mcpFormat: 'json' | 'jsonc' | 'toml'
  globalInstructionTargetId?: string
}
```

Rules:

- Paths are resolved with home directory expansion and platform-specific app data.
- Detection is filesystem-based: directory or config file exists.
- Undetected agents can be shown manually but are not written unless the user configures a path.
- An agent that does not support a type is `UNSUPPORTED`, not `MISSING`.

### 10.2 Skill install

```text
resolve agent target directory
  -> validate path
  -> check existing state
  -> preview files and target
  -> write
```

Symlink mode:

- Ensure `library/skills/<asset-id>` is materialized at the current revision.
- Create a directory symlink or junction at `<agent>/<skill-name>`.
- On Windows, use `junction`.
- On failure, return a typed error and offer copy mode.

Copy mode:

- Build a staging directory under the agent parent.
- Copy the manifest files.
- Verify hashes.
- Rename staging to the final directory.
- If the final directory exists and is managed, back it up and replace atomically.
- If it exists and is not managed, refuse unless the user confirms overwrite.

Manifest:

- Record every deployed file path and hash.
- Record the deployed revision and previous revision.
- Record the mode.

Drift:

- Symlink: compare the library tree to the current revision.
- Copy: compare the target tree to the deployment manifest.
- Only content changes count; timestamps do not.

Remove:

- Symlink: verify the link target then unlink.
- Copy: delete only manifest files and empty directories created by the app.
- Never delete unknown files.

Rollback:

- Materialize the previous revision.
- Write it using the same mode.
- Update the deployment record.

### 10.3 MCP apply

```text
resolve target config
  -> parse (JSON / JSONC / TOML)
  -> extract managed entry
  -> compare to last written entry
  -> preview redacted
  -> decrypt secrets
  -> apply targeted edit
  -> atomic write
  -> record deployment
```

JSON:

- Parse with `JSON.parse` for strict files.
- If the file is empty, create the minimal structure.
- Preserve key order where practical.

JSONC:

- Parse with `jsonc-parser`.
- Use `modify` and `applyEdits` to change only the managed entry.
- Preserve comments and formatting outside the edited range.

TOML:

- Parse for validation and entry extraction.
- Edit by section:
  - Find the `[mcp_servers.<name>]` table header.
  - Find the next top-level table header.
  - Replace or remove that section.
  - Preserve all other text, including comments.
- If the file uses inline tables or an unsupported structure, refuse and explain.

Managed entry tracking:

- `deployments.managed_keys_json` stores the target server key and the entry hash.
- Drift if the current managed entry differs from the last written entry.
- Removing deletes only the managed entry.

Secret handling:

- The applied file contains the real value needed by the Agent.
- The preview is redacted.
- The confirmation explains plaintext at rest in the Agent config.
- Non-secret values may be written directly.
- Secrets are never logged.

### 10.4 Dispatch matrix

The matrix is computed, not stored:

- Rows: Skill and MCP assets.
- Columns: detected agents plus optionally undetected ones.
- Cell status from deployments and current asset revisions:
  - No deployment and supported: `missing`.
  - Deployment revision equals current revision and hash matches: `synced`.
  - Deployment revision older: `stale`.
  - Hash mismatch: `drifted`.
  - Unsupported: `unsupported`.

Bulk stale sync:

- Only `stale` items.
- Drifted items are reported, not overwritten.
- Result includes success, skipped, drifted, failed counts.

## 11. Projection engine

### 11.1 Target resolution

Project target:

```text
projectRoot + target.pathTemplate
```

Global target:

```text
expand(globalTarget.path)
if pathMode = file: use path
if pathMode = dir: path + slug + fileExt
```

Rules:

- The resolved path must stay inside the allowed root.
- `~` expands to the OS home directory.
- Environment variables are not expanded from arbitrary renderer input.
- The parent directory is created only at write time, after confirmation.

### 11.2 Compilation

Compilation is a pure function in `shared/domain`:

```ts
compileTargetFile(target, contracts, options): CompiledFile[]
```

- Single-file targets return one file containing managed blocks.
- Per-contract targets return one file per contract with frontmatter.
- Generated content includes a generation marker.
- The compiler preserves line endings based on the target file.

### 11.3 Managed block algorithm

```text
parseManagedBlocks(text):
  scan for <!-- pk:begin <id> --> and <!-- pk:end <id> -->
  return outside segments and blocks
```

Rules:

- Nested or unclosed markers are a validation error; the file is marked drifted and not rewritten.
- Duplicate contract IDs are a validation error.
- Content outside markers is preserved byte-for-byte except for line-ending normalization on write.
- Removing a projection removes only its block and surrounding blank lines according to a deterministic rule.
- A file with no markers is treated as outside content and receives blocks appended in a deterministic order.

### 11.4 Drift classification

Single-file target:

```text
if target missing -> missing
if fileHash == lastWrittenFileHash:
   if revision changed -> stale
   else -> synced
else:
   parse blocks
   if outsideHash != lastOutsideHash -> drifted
   if any blockHash != lastBlockHash -> drifted
   else -> drifted (unknown external change)
```

Per-contract target:

```text
if target missing -> missing
if fileHash == lastWrittenFileHash:
   if revision changed -> stale
   else -> synced
else -> drifted
```

Projection records store `file_hash`, `outside_hash`, and `block_hash` to make this classification possible without storing full content.

### 11.5 Project and global boundaries

- Project projections use a registered `projects` row.
- Global projections use `project_id = ''`.
- Project root deletion marks projections orphaned, not deleted.
- Global path changes update `global_targets` and mark non-drifted projections stale.
- Global paths are never written to Git.

### 11.6 Batch projection

```text
input: contractIds[], targetIds[]
1. Validate all contracts and targets.
2. Compute compatibility.
3. Group by target and target file.
4. For single-file targets, compute the final file with all selected and existing contracts.
5. Exclude drifted items from bulk overwrite.
6. Preview the final files.
7. On confirm, write each target atomically.
8. Record projections and one audit event per batch.
```

Result:

```ts
interface BatchProjectionResult {
  projected: number
  skipped: number
  driftedNotOverwritten: number
  failed: Array<{ contractId: string; targetId: string; reason: string }>
}
```

## 12. Secret service

### 12.1 Interface

```ts
interface SecretCipher {
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}
```

Production uses Electron `safeStorage`. Tests use an in-memory fake that is never shipped.

### 12.2 Storage

- Ciphertext is stored in `secrets.ciphertext`.
- `key_version` supports future rotation.
- A secret is identified by `(owner_type, owner_id, key)`.
- Deleting an owner deletes its secrets in the same transaction.

### 12.3 Redaction

- MCP DTOs replace secret values with `[REDACTED]` and include `hasValue: true`.
- Version history stores redacted snapshots; the ciphertext remains in `secrets`.
- Diff views operate on redacted content.
- Diagnostic exports exclude secrets and asset bodies.
- Error messages never echo a secret.

### 12.4 SafeStorage failure

If `safeStorage.isEncryptionAvailable()` is false:

- The app refuses to save secrets.
- The UI explains that OS encryption is unavailable.
- The app does not fall back to plaintext.
- Existing secrets cannot be decrypted; affected MCP servers are marked degraded.

## 13. Credential scanner

### 13.1 Rule model

```ts
interface ScanRule {
  id: string
  description: string
  pattern: RegExp
  confidence: 'high' | 'medium'
  appliesTo: Array<'prompt' | 'contract' | 'mcp' | 'catalog'>
}
```

Initial high-confidence rules:

- OpenAI-style `sk-` tokens.
- GitHub `ghp_` tokens.
- AWS access key IDs (`AKIA...`).
- Private key headers.
- Additional provider tokens added through reviewed rules.

### 13.2 Entropy heuristic

- Compute Shannon entropy on candidate strings.
- Flag long high-entropy strings only when they appear near credential-like keys such as `token`, `secret`, `password`, `api_key`, or `authorization`.
- Allowlist placeholders, example values, URLs, hashes, and known false positives.
- Entropy findings are medium confidence and still block push by default `[TBD-BE]`.

### 13.3 Output

```ts
interface ScanFinding {
  ruleId: string
  confidence: 'high' | 'medium'
  path?: string
  line?: number
  column?: number
  preview: string
  replacement: '{{variable}}' | '${VAR}'
}
```

The preview shows a shortened, partially masked match. The full match is never logged.

### 13.4 Enforcement points

- Before Skill, MCP, Prompt, or Contract push.
- Before repository serialization.
- Before catalog install.
- Before diagnostic export.
- Before AI request? No; the user may intentionally send a Prompt containing sensitive context. The app warns but does not block `[TBD-BIZ]`.

## 14. Search service

### 14.1 Index update

- Insert or replace the asset's FTS row after a revision or metadata change.
- Remove the row on soft delete or purge.
- Use the current revision body text, title, description, tags, and repository path.
- Truncate extremely large bodies for indexing; the full content remains in blobs.
- Update within the same transaction as the asset change.

### 14.2 Query

```sql
SELECT asset_id, kind,
       snippet(assets_fts, 3, '<mark>', '</mark>', '...', 12) AS snippet,
       bm25(assets_fts) AS rank
FROM assets_fts
WHERE assets_fts MATCH ?
ORDER BY rank
LIMIT ? OFFSET ?;
```

Rules:

- Escape FTS query syntax; treat user input as tokens by default.
- Support prefix matching for the last token.
- Cap results and snippet length.
- Filter by kind and folder in a join with `assets`.
- Never return soft-deleted assets.

### 14.3 Rebuild

- A rebuild command deletes and repopulates the index.
- Run after a schema migration that changes indexed fields.
- Show a progress state in the UI.

## 15. Scheduler, watchers, and reconciliation

### 15.1 Scheduler

- Auto-fetch timer per repository.
- Jitter of +/- 10 percent.
- Skip if offline or an operation is running.
- Backoff on repeated failure.
- No auto-pull.

### 15.2 Watchers

- Watch library, Agent install roots, and project roots.
- Pause while the app writes to the same path.
- Debounce 300-500 ms.
- On event, hash the file and compare to the expected manifest.
- Emit a drift event; do not write automatically.
- A full reconciliation runs on startup and on manual refresh.

### 15.3 Reconciliation

For each deployment and projection:

1. Resolve the target path.
2. Check existence.
3. Hash content.
4. Compare to the recorded manifest or block hash.
5. Set `synced`, `stale`, `drifted`, or `missing`.
6. Do not change files.

Reconciliation is read-only and safe to run frequently.

## 16. Backup, migration, and restore

### 16.1 Database backup

```ts
db.exec(`VACUUM INTO '${backupPath}'`)
```

- Run before migrations and before a restore.
- Verify the backup opens and passes `quick_check`.
- Store schema version and app version.

### 16.2 Full snapshot

- Database backup.
- Referenced blobs.
- Manifest with hashes.
- Settings and global paths (local-only, included in backup but never Git).
- No logs unless the user explicitly includes them.

### 16.3 Migration

- Migrations are numbered TypeScript or SQL files.
- Each migration is idempotent only by version tracking, not by re-running.
- Wrap transactional DDL in a transaction where SQLite supports it.
- Test each migration against a fixture database from the previous release.
- If a migration fails, restore the pre-migration backup and show a recovery dialog.

### 16.4 Restore

- Validate the snapshot manifest and every blob hash.
- Create a safety backup of current data.
- Stage the restore in a temporary directory.
- Close the database.
- Swap directories.
- Reopen and reconcile.
- On failure, roll back to the safety backup.

## 17. Error handling and logging

### 17.1 Error mapping

- Domain errors are typed classes with a code and user-safe message.
- Adapter errors are translated into domain errors; raw stack traces never reach the renderer.
- Unexpected errors get a trace ID printed in the UI and linked to a redacted log entry.
- Validation errors include field paths.
- Git errors include the failing subcommand and a redacted stderr excerpt.

### 17.2 Logging

- `electron-log` with JSON formatting.
- Fields: timestamp, level, component, operation ID, trace ID, message, sanitized detail.
- Redaction rules:
  - Secret values and ciphertext.
  - Authorization headers.
  - Tokens matching scanner rules.
  - Home directory paths are shortened to `~` where practical.
- Log rotation: size and age limits.
- Debug level is opt-in.
- Asset bodies are never logged.

### 17.3 Audit vs logs

| Aspect | Audit events | Logs |
| --- | --- | --- |
| Audience | User and product | Engineering diagnostics |
| Storage | SQLite | Rotating files |
| Content | Redacted summaries | Redacted technical detail |
| Retention | Product policy | Short rotation |
| Export | Yes, P1 | Yes, diagnostics |

## 18. Security controls

### 18.1 IPC

- Named channels only.
- Zod validation on request and response.
- Sender URL and window identity checks.
- Payload size limits.
- No direct path or command execution from renderer input.
- No generic object passing to Git or shell.

### 18.2 Filesystem

- Allowlist roots.
- Canonical path checks.
- No `..`, NUL, or absolute paths from untrusted input.
- Reject symlink escapes.
- Atomic writes with backup.
- No recursive delete of unknown content.
- No execution of scripts.

### 18.3 Git

- No shell interpolation.
- No credential storage in the app database.
- Redact remote URLs that contain user info.
- Reject URLs with embedded passwords.
- Never force-push.
- Never run hooks interactively.
- Timeouts and cancellation.

### 18.4 Secrets

- safeStorage only.
- No plaintext at rest.
- No renderer exposure.
- No logs.
- No export.
- No clipboard.

### 18.5 Content

- Parse and validate all repository content.
- Size limits.
- Sanitized rendering happens in the renderer, but the main process still treats content as hostile.
- No execution of Markdown, HTML, scripts, or config commands.

### 18.6 Update and dependencies

- Signed updates.
- Lockfile.
- Dependency review.
- SBOM.
- No remote code at runtime.

## 19. Performance design

### 19.1 Database

- Prepared statements.
- Indexed queries.
- `BEGIN IMMEDIATE` for writes.
- Batch inserts for manifests and tags.
- Avoid N+1 queries in lists.
- Paginate large lists.
- Keep FTS updates incremental.
- Profile queries over 20 ms and add indexes where needed.

### 19.2 File I/O

- Stream large files; do not read everything into memory.
- Hash large trees in a worker.
- Limit concurrent file operations.
- Use atomic writes.
- Debounce watcher events.

### 19.3 Git

- Async child process.
- Progress parsing where available.
- Content on demand.
- Avoid checking out the whole repo for a single read.
- Cache remote file hashes per fetch.
- Cancel on user request.

### 19.4 CPU-heavy work

- Hashing large manifests, entropy scanning, and archive inspection can run in `worker_threads`.
- A worker receives plain data and returns results; it does not write the database.
- Worker errors are mapped to domain errors.

## 20. Testing strategy

### 20.1 Unit

- Shared domain functions.
- Scanner rules.
- Managed block parser.
- Path normalization.
- Status classification.
- Redaction.
- Manifest hashing.

### 20.2 Integration

- Asset services with temp SQLite and temp blob store.
- Prompt and contract serialization round trips.
- MCP config merge for JSON, JSONC, and TOML.
- Projection drift classification.
- Dispatch symlink and copy in temp Agent directories.
- Backup and restore.
- Migration fixtures.

### 20.3 Git integration

- Local bare repository fixtures.
- Clone, fetch, pull, push.
- Incoming, outgoing, conflict, rename, delete.
- Dirty worktree protection.
- Non-fast-forward push failure.
- Interrupted operation recovery.

### 20.4 Security tests

- IPC rejects invalid payloads.
- Path traversal rejected.
- Symlink escape rejected.
- Secret never returned in DTO.
- Secret never logged.
- Markdown sanitization (renderer side).
- Scan blocks push.
- Update signature verification.

### 20.5 End-to-end

- Connect a local test repository.
- Edit a Prompt, push, fetch on a second clone, pull.
- Resolve a conflict.
- Install a Skill to a fake Agent directory.
- Apply an MCP server to a fake JSON and TOML config.
- Project a contract to a fake project and global path.
- Simulate drift and confirm per-item overwrite.
- Restore from backup.

### 20.6 Test seams

- `SecretCipher` interface with a fake implementation.
- Clock interface for timestamps and retention.
- Git executable path override.
- User data root override.
- Agent path override.
- Network client interface for AI and catalog.

No test may use real credentials or write outside a temp directory.

## 21. Implementation milestones

| Milestone | Scope | Exit criteria |
| --- | --- | --- |
| M1 Foundation | Electron shell, security, SQLite, migrations, blob store, IPC, settings, theme bootstrap | App launches on Windows and macOS; data survives restart; security checklist passes |
| M2 Prompts | Asset service, Prompt service, folders, variables, versions, search index | Prompt CRUD, copy, versions, folders, search verified |
| M3 Contracts | Contract service, target registry, resolution preview, project projection, global targets | Preview matches compiled output; drift and global batch verified |
| M4 Skills | Skill service, files, versions, Agent detection, dispatch, drift, rollback | Symlink and copy install work on both platforms |
| M5 MCP | MCP service, secrets, redaction, health, JSON/JSONC/TOML apply, drift | Secrets never leak; config merges preserve unrelated content |
| M6 Sync | Git adapter, connect, fetch, review, pull, push, conflicts, history | Full three-way flow against local and remote test repositories |
| M7 Hardening | Backup, restore, crash recovery, logging, scanner, performance, accessibility | Release checklist and security review pass |
| M8 Packaging | Signing, notarization, auto-update, installers, notices | Clean install and upgrade on both OSes |
| M9 Migration cleanup | Remove prototype store and simulation paths; update docs | Prototype code retired; acceptance suite green |

Sequencing rationale:

- Storage and IPC come first because every domain depends on them.
- Prompts are the simplest single-file domain and validate the asset model.
- Contracts add compilation and projection, the most complex pure logic.
- Skills add multi-file manifests and OS-specific dispatch.
- MCP adds secrets and format-preserving configuration.
- Sync comes after the asset model is stable, because it depends on canonical serialization, revisions, and conflict records.
- Hardening and packaging are not left to the end, but the full gate is at M7-M8.

## 22. Open questions

| ID | Question | Owner | Needed by |
| --- | --- | --- | --- |
| BE-01 | Minimum supported Git version and missing-Git behavior | Backend + product | M6 |
| BE-02 | TOML section editor scope and fallback behavior | Backend | M5 |
| BE-03 | Project root registration data flow `[TBD-UX]` | Backend + design | M3 |
| BE-04 | Whether to offer environment references instead of inline MCP secrets | Backend + security | M5 |
| BE-05 | Branch-plus-PR integration in the MVP | Backend + product | M6 |
| BE-06 | Blob and tree size limits per asset type | Backend + product | M2 |
| BE-07 | Version and audit retention policy | Product + legal | M7 |
| BE-08 | Whether to move SQLite to a utility process if writes block | Backend | After performance measurement |
| BE-09 | SafeStorage fallback behavior on unsupported environments | Backend + security | M1 |
| BE-10 | Catalog signature format and verification | Security + backend | P1 |
| BE-11 | AI provider adapters and streaming protocol | Backend + product | P1 |
| BE-12 | Telemetry event schema and endpoint | Product + legal | P1 |

## 23. Glossary

| Term | Meaning |
| --- | --- |
| Asset manifest | Sorted list of files and blob hashes for a revision |
| Base | Last synchronized content for an asset |
| Blob | Content-addressed file content |
| Deployment | A Skill or MCP delivery record |
| Drift | External modification of a managed target |
| Fingerprint | Stable hash identifying a sync change |
| Materialization | Writing a revision into the library tree |
| Operation journal | Durable record of multi-step writes for crash recovery |
| Projection | A contract write to an instruction target |
| Reconciliation | Read-only comparison of recorded state to actual files |
| Revision | Immutable snapshot of asset content |
| Sync change | Computed incoming, outgoing, or conflict item |

**End of document.** Changes to the data model, IPC contract, Git behavior, secret handling, or write safety require an update to this document, the architecture document, and the affected tests.
