# Prompt Keeper Frontend-Backend IPC API Contract

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Frontend-Backend IPC API Contract |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; binding after frontend, backend, and security review |
| Runtime | Electron renderer (frontend) and Electron main process (backend) |
| Transport | Typed IPC through the preload bridge; no HTTP server |
| Primary audience | Frontend, backend, QA, security, release engineering |
| Related documents | [`docs/prd.md`](./prd.md), [`docs/architecture.md`](./architecture.md), [`docs/tech-stack.md`](./tech-stack.md), [`docs/frontend-design.md`](./frontend-design.md), [`docs/backend-design.md`](./backend-design.md), [`docs/interaction-design.md`](./interaction-design.md) |
| Annotation rules | `[FACT]`, `[ASSUMPTION]`, `[TBD-UX]`, `[TBD-BE]`, `[TBD-INFRA]`, `[CONFLICT]` |

## Document status

This document defines the **boundary contract** between the Electron renderer and the Electron main process. It is implemented by `src/shared/contracts.ts`, `src/shared/bridge.ts`, `src/shared/channels.ts`, the preload bridge, and the main-process IPC registry.

The contract is intentionally narrower than an HTTP API:

- It defines request and response payloads, error semantics, event payloads, concurrency rules, and security invariants.
- It does not define the SQLite schema, Git command behavior, or projection algorithms. Those remain owned by [`docs/backend-design.md`](./backend-design.md).
- It does not define renderer component structure or visual behavior. Those remain owned by [`docs/frontend-design.md`](./docs/frontend-design.md) and [`docs/interaction-design.md`](./docs/interaction-design.md).

Priority markers follow the PRD: **P0** is required for the desktop MVP, **P1** is post-MVP, and **P2** is out of scope for this contract.

## 1. Authority, scope, and definitions

### 1.1 Authority order

When two documents disagree about the renderer-main boundary, resolve in this order:

1. **This document** for channel names, request and response shapes, error codes, event payloads, and concurrency rules.
2. [`docs/backend-design.md`](./backend-design.md) for service behavior, transactions, Git sequences, projection algorithms, and storage.
3. [`docs/frontend-design.md`](./frontend-design.md) for renderer architecture, query keys, and feature behavior.
4. [`docs/prd.md`](./prd.md) and [`docs/interaction-design.md`](./interaction-design.md) for product behavior and UX.

If a conflict cannot be resolved by that order, record it as `[CONFLICT]` and stop. Do not invent a compromise in code.

### 1.2 Scope

In scope:

- All P0 renderer-main channels for Prompts, Agent Instructions, Skills, MCP, Git sync, dispatch, projection, search, settings, and events.
- P1 channels for AI test, curated catalogs, reverse import, and update checks where the PRD already requires them.
- The typed preload surface consumed by the renderer.

Out of scope:

- A public HTTP API, remote API, plugin API, or third-party integration API.
- Direct database access from the renderer.
- Direct filesystem, Git, network, or process access from the renderer.
- A production sync service, hosted inference, telemetry backend, or account system.

### 1.3 Definitions

| Term | Meaning |
| --- | --- |
| Channel | A single renderer-to-main request, named `domain:verb`, for example `prompts:update`. |
| Event | A main-to-renderer notification, for example `domain:changed`. Events carry identifiers and status, not content. |
| DTO | The JSON-safe object returned by a channel. DTOs never contain raw database rows, ciphertext, or secret values. |
| Asset | A Prompt, Contract, Skill, or MCP server entry. |
| Revision | An immutable content snapshot of an asset. Every content save creates a revision. |
| Operation | A long-running backend action with an operation ID, progress events, and a completion event. |
| Projection | A compiled Contract written to a project-level or global instruction target. |
| Deployment | A Skill or MCP asset delivered to an Agent directory or Agent configuration file. |
| Preview | A read-only, redacted result that the renderer must show before a destructive or external write. |
| Effective sync | Whether an asset participates in Git sync after the repository policy and the per-asset policy are combined. |

### 1.4 Channel naming rules

- Channels use `domain:verb` in lower camel case, for example `sync:repoGet` and `projections:overwriteDrift`.
- A channel performs one use case. Do not add flag-only channels that switch unrelated behavior.
- Read channel verbs include `list`, `get`, `versions`, `files`, `resolve`, `compile`, `health`, `matrix`, `status`, or `history`.
- Write channel verbs include `create`, `update`, `delete`, `restore`, `restoreVersion`, `setSyncPolicy`, `setFavorite`, `setPinned`, `setEnabled`, `import`, `project`, `dispatch`, `apply`, `remove`, `rollback`, `pull`, `push`, `review`, `cancel`, `backup`, or `reset`.
- Long-running writes return an operation reference, not a final result.
- Event names use `domain:event` in lower camel case, for example `domain:changed` and `operation:completed`.
- Preload method names mirror the channel verb exactly. Do not create aliases.

## 2. Documentation gaps resolved by this contract

The frontend design names several client methods that are absent from or named differently in the backend channel catalog. This section resolves those gaps so both teams implement the same surface.

### 2.1 Channels added by this contract

These channels are **not present** in [`docs/backend-design.md`](./backend-design.md) section 4.3. They are required by documented UI flows and PRD requirements. The backend design must add them before implementation.

| Channel | Reason | Source requirement |
| --- | --- | --- |
| `prompts:versions`, `contracts:versions`, `skills:versions`, `mcp:versions` | The frontend design has separate version queries and query keys. Loading version history must not require a full detail fetch. | Frontend design sections 5.2 and 9.1-9.4; PRD PRM-005, SKL-003, MCP-005, INS-015 |
| `prompts:restoreVersion`, `contracts:restoreVersion`, `skills:restoreVersion`, `mcp:restoreVersion` | The catalog's `restore` channel restores a soft-deleted asset. Restoring a historical revision is a separate use case. | PRD PRM-005, SKL-003, MCP-005, INS-015 |
| `prompts:setFavorite`, `prompts:setPinned`, `mcp:setFavorite` | Favorite and pin toggles are metadata-only mutations and must not create a revision or require a content update. | Frontend design section 9.1; prototype behavior; schema `prompts.is_pinned` |
| `targets:list` | The frontend queries the project target registry with capabilities. The registry remains shared code, but the renderer needs one validated snapshot. | Frontend design section 9.2; PRD INS-002, INS-004 |
| `sync:changeDetail` | The changes list must stay small. Full three-way content is loaded only when a review dialog opens. | Frontend design section 9.5; backend design section 9.6 |
| `globalProjections:reproject`, `globalProjections:remove`, `globalProjections:rollback`, `globalProjections:overwriteDrift` | Global projections need the same item-level actions as project projections; the catalog only defines `globalProjections:project`. | Frontend design section 9.2; PRD INS-011, INS-012, INS-014 |
| `mcp:importExternal` | Reverse import is a P1 workflow that reads Agent configuration, previews entries, and imports selected servers. | PRD MCP-012; frontend design section 9.4 |
| `settings:reset` | Destructive reset is a separate Settings action from backup restore. | PRD SET-005 |
| `ai:providerSave` | AI provider configuration includes a write-only API key and cannot be expressed by `settings:update`. | PRD SET-010, AI-001 |
| `prompts:storeList` | Platform Discovery is a P1 curated prompt catalog with the same review-before-save rule as the other stores. | PRD PRM-012; frontend design section 9.1 |
| `projects:list`, `projects:register`, `projects:remove` | Project-level projections require a registered project root. The registry UX is unresolved, so these channels are marked `[TBD-UX]` and are not binding until INS-007 is designed. | PRD INS-007; architecture AR-01 |

### 2.2 Frontend client names renamed by this contract

The preload surface uses the channel verb directly. Frontend design references to the left column must be updated to the right column during migration.

| Frontend design reference | Contract method | Channel |
| --- | --- | --- |
| `prompts.detail` | `prompts.get` | `prompts:get` |
| `contracts.detail` | `contracts.get` | `contracts:get` |
| `skills.detail` | `skills.get` | `skills:get` |
| `mcp.detail` | `mcp.get` | `mcp:get` |
| `dispatch.skillStatus` | `dispatch.detail` | `dispatch:detail` |
| `skills.store.list` | `skills.storeList` | `skills:storeList` |
| `mcp.store.list` | `mcp.storeList` | `mcp:storeList` |
| `targets.list` | `targets.list` | `targets:list` |
| `prompts.versions` | `prompts.versions` | `prompts:versions` |
| `restoreVersion` mutation | `<domain>.restoreVersion` | `<domain>:restoreVersion` |
| `toggleFavorite` mutation | `<domain>.setFavorite` | `<domain>:setFavorite` |

### 2.3 Conventions resolved by this contract

| Topic | Contract decision | Rationale |
| --- | --- | --- |
| Root folder | DTOs represent the root folder as the empty string `''`. `null` is not used for folders. | Matches the database and canonical path rules. |
| Folder selection | Omitting `folder` selects all folders. `folder: ''` selects the root. `includeDescendants` defaults to `true`. | Matches the "selecting a parent includes descendants" requirement. |
| Tag filters | Multiple tags are combined with AND. | Avoids ambiguous result counts. |
| Timestamps | ISO 8601 UTC strings with a `Z` suffix. | Matches the database convention. |
| Risk values | `SyncChangeSummary.risk` is an array; an empty array means no risk. | Matches `sync_changes.risk_json`. |
| Sync policy | Only Prompts and Contracts have `syncPolicy`. Skills and MCP follow the repository policy. | Matches the current UI and backend schema usage. |
| Skill naming | The DTO uses `versionLabel` and `icon`. The prototype's `version` and `emoji` fields map to these names during migration. | Aligns with the `skills` table and the canonical Skill manifest. |
| Asset display name | `AssetBase.title` is canonical for all four asset types. The prototype's `name` on Skill and MCP maps to `title`; UI labels may still say Name. | Matches the `assets.title` column and keeps list and detail DTOs uniform. |
| Contract targets | DTOs use `targetIds`. The prototype field is `targets`. | Matches `contracts.target_ids_json` and avoids confusion with the target registry. |
| Push mode | DTOs use `direct` or `branch`. The prototype's `branch-pr` maps to `branch`. | Matches the `repos.push_mode` check constraint. |
| MCP source | DTOs use `manual`, `market`, or `import`. | Matches the MCP-specific source semantics and the prototype. |
| MCP values | DTOs wrap env and header values in `McpFieldValue`. Plain strings are accepted only on write. | Makes redaction state explicit and prevents accidental secret round trips. |
| Project identity | Projections use an explicit `projectId`. The prototype's single implicit project maps to the first registered project. `[ASSUMPTION]` | Required by the `projects` table and project-root validation. |
| Projection status | `synced`, `stale`, `drifted`, `missing`. | Matches the projection table. |
| Dispatch status | `synced`, `stale`, `drifted`, `missing`, `unsupported`. `unsupported` is computed for matrix cells and is never stored. | Matches the dispatch matrix. |
| Deleted assets | Delete is soft by default. `restore` restores a soft-deleted asset. `restoreVersion` creates a new revision from history. | Separates two different user actions. |
| Revision preconditions | Content updates require `expectedRevisionId`. Metadata-only writes do not. | Prevents lost updates without blocking favorites. |
| Error taxonomy | `REVISION_CONFLICT` is reserved for an `expectedRevisionId` mismatch. `CONFLICT` covers every other business-state conflict. | The backend table overlaps the two codes; this contract splits them so the renderer can choose the right recovery action. |
| Binary content | Binary files are represented by metadata only. The renderer does not receive binary bytes. | Keeps IPC JSON-safe and avoids rendering untrusted binaries. |
| Null versus absent | On patch inputs, an absent field means "no change". A present `null` means "clear" only where the field is documented as nullable. | Prevents accidental clears. |

### 2.4 Decisions intentionally not invented

These items remain open. The contract marks them instead of inventing production behavior.

| Topic | Status | Owner and phase |
| --- | --- | --- |
| Project root registration, selection, and removal UX | `[TBD-UX]` | Design and product before INS-007 implementation |
| Maximum IPC request and response payload sizes | `[TBD-BE]` | Backend before M1 |
| Preview token lifetime and binding algorithm | `[TBD-BE]` | Backend and security before M2 |
| Idempotency record retention window | `[TBD-BE]` | Backend before M2 |
| Imported Skill symlink policy | `[TBD-BE]` | Backend and security before SKL-010 |
| Git credential helper and token storage UX | `[TBD-BE]` | Backend and product before SYN-001 |
| AI provider adapter list and capability matrix | `[TBD-BE]` | Backend before P1 AI work |
| Multi-window event targeting | `[TBD-BE]` | Backend before any multi-window decision |
| Exact `settings:reset` deletion scope | `[TBD-BE]` | Backend and product before SET-005 implementation |
| Operation status after a renderer reload | Resolved for now by `BootstrapSnapshot.activeOperations`; no operation query channel exists | Backend to confirm sufficiency |

## 3. Transport and envelope

### 3.1 Bridge model

- The preload script exposes a frozen object at `window.promptKeeper`.
- Every channel is an `invoke` call that returns a promise. The renderer never uses `ipcRenderer` directly.
- The renderer may subscribe to events only through the bridge.
- The preload bridge is generated from the channel catalog in this document. Hand-written aliases are prohibited.
- The renderer accesses the bridge only through `src/lib/ipc.ts`; feature components do not call `window.promptKeeper`.

### 3.2 Result envelope

Every channel resolves to exactly one shape:

```ts
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcErrorPayload }
```

Rules:

- A rejected promise is a transport failure, not a business error. The renderer treats a rejected invoke as `INTERNAL` with a trace ID when available.
- `data` is always JSON-safe: strings, numbers, booleans, `null`, arrays, and plain objects.
- `Buffer`, `ArrayBuffer`, `Date`, `Map`, `Set`, `BigInt`, and class instances are not allowed in payloads.
- The renderer unwraps the envelope once in `src/lib/ipc.ts` and converts errors to a typed `IpcError`.
- The renderer never logs payloads. It may log channel names, error codes, and trace IDs.

### 3.3 Serialization and limits

- Request and response bodies are validated against the schemas in the shared contract module.
- Unknown request fields are rejected with `VALIDATION`. Unknown response fields are ignored by the renderer for forward compatibility.
- The main process enforces a request size cap before parsing. The cap is `[TBD-BE]` and must return `VALIDATION` with `details.kind: 'limit-exceeded'`.
- Response bodies that would exceed the cap must be paginated or truncated with an explicit flag. Silent truncation is prohibited.
- All list channels are paginated. The default page size is 50 and the maximum is 200 unless a channel states otherwise.
- Phased responses use a `phase` field: `'preview'`, `'applied'`, or `'started'`. The renderer branches on `phase` before reading other fields.

### 3.4 Timeouts and long-running work

- A synchronous channel must return within 10 seconds. Validation, database reads, and small writes fit this budget.
- Any action that can exceed 10 seconds returns an `OperationRef` immediately and reports progress through events.
- Git fetch, pull, push, dispatch batches, projection batches, MCP apply and remove, backup, restore, reset, search rebuild, and update download are operations.
- Repository connect may clone a large repository. The current contract keeps connect synchronous with a two-phase preview/apply shape; promoting clone and connect to an operation is `[TBD-BE]` and tracked as API-13.
- The renderer must not wrap an operation-starting invoke in a short timeout. It starts the operation, tracks the `operationId`, and reacts to events.
- `app:bootstrap` reports active operations so the renderer can recover its operation panel after a reload.

## 4. Error contract

### 4.1 Error payload

```ts
type IpcErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'PERMISSION'
  | 'LOCKED'
  | 'GIT_NOT_FOUND'
  | 'GIT_AUTH'
  | 'GIT_CONFLICT'
  | 'NETWORK'
  | 'SECURITY_BLOCK'
  | 'UNSUPPORTED'
  | 'CORRUPT'
  | 'INTERNAL'

interface IpcErrorPayload {
  code: IpcErrorCode
  message: string
  details?: IpcErrorDetails
  retryable: boolean
  traceId?: string
}
```

Rules:

- `message` is user-facing English. It states the action and the consequence.
- `details` never contains secret values, ciphertext, full asset bodies, or unredacted configuration.
- `traceId` is present for `INTERNAL` and may be present for other codes. The UI shows it for support.
- The backend sets `retryable`; the renderer does not guess.

### 4.2 Error codes

| Code | Meaning | Default retryable | Renderer behavior |
| --- | --- | --- | --- |
| `VALIDATION` | Invalid input or a business rule violation | No | Show field or inline errors; keep the draft |
| `NOT_FOUND` | Asset, target, revision, or record missing | No | Refresh the affected query and show a message |
| `CONFLICT` | A business-state conflict such as duplicate slug, dirty worktree, invalidated review, or drifted projection | No | Explain the state; offer reload, refresh, or item-level resolution |
| `REVISION_CONFLICT` | `expectedRevisionId` does not match the current revision | No | Preserve the draft; offer reload or compare |
| `PERMISSION` | Filesystem or OS permission denied | No | Explain the path and the permission |
| `LOCKED` | Another operation holds the relevant lock | Yes | Show the blocking operation; retry after it finishes |
| `GIT_NOT_FOUND` | Git executable missing | No | Show onboarding or Settings guidance |
| `GIT_AUTH` | Git credential or SSH authentication failure | No | Show operation context; never echo credentials |
| `GIT_CONFLICT` | Non-fast-forward or repository merge state | No | Fetch and recompute changes |
| `NETWORK` | Timeout or connection failure | Yes | Retry when safe; show offline state |
| `SECURITY_BLOCK` | Credential scan or security policy blocked the action | No | Show the redacted findings and the replacement workflow |
| `UNSUPPORTED` | Target cannot perform the action | No | Disable the action and explain why |
| `CORRUPT` | Integrity check failed | No | Offer backup restore or diagnostics |
| `INTERNAL` | Unexpected failure | No | Show the trace ID and a log reference |

### 4.3 Error details

```ts
type IpcErrorDetails =
  | { kind: 'validation'; fields: Array<{ path: string; message: string }> }
  | { kind: 'limit-exceeded'; limitBytes: number }
  | { kind: 'revision-conflict'; currentRevisionId: string; currentVersion: number; updatedAt: string }
  | { kind: 'projection-drift'; projectionId: string; targetPath: string; fileHash?: string }
  | { kind: 'review-required'; changeIds: string[] }
  | { kind: 'review-invalidated'; changeIds: string[]; currentFingerprints: Record<string, string> }
  | { kind: 'per-item-required'; changeIds: string[]; reason: string }
  | { kind: 'security-block'; operation: 'push' | 'apply' | 'import' | 'export'; findings: ScanFinding[] }
  | { kind: 'unsupported'; targetId?: string; feature?: string; reason: string }
  | { kind: 'lock'; operationId?: string; operationType?: OperationType }
  | { kind: 'target-warnings'; warnings: string[]; requiresAcknowledgement: true }
  | { kind: 'data-disclosure-required'; providerId: string }
  | { kind: 'duplicate'; field: string; value: string }
  | { kind: 'unknown'; [key: string]: unknown }
```

Rules:

- `VALIDATION` with `kind: 'target-warnings'` means the draft is valid but the user must acknowledge target capability warnings. The renderer shows the warnings and resubmits with `acknowledgeTargetWarnings: true`.
- `REVISION_CONFLICT` always uses `kind: 'revision-conflict'` and includes the current revision. `CONFLICT` is used for all other state conflicts.
- `CONFLICT` with `kind: 'projection-drift'` must lead to `projections:overwriteDrift` or `globalProjections:overwriteDrift`, never to a bulk rewrite.
- `CONFLICT` with `kind: 'review-invalidated'` means the remote content changed after review. The renderer reopens the review dialog.
- `SECURITY_BLOCK` findings contain masked previews only. The full match is never returned or logged.
- `UNSUPPORTED` is used for unsupported activation modes, disabled MCP servers, and unavailable symlink mode.

### 4.4 Error precedence

When more than one condition applies, return the first matching code in this order:

1. `SECURITY_BLOCK`
2. `VALIDATION`
3. `REVISION_CONFLICT`
4. `CONFLICT`
5. `NOT_FOUND`
6. `UNSUPPORTED`
7. `LOCKED`
8. `PERMISSION`
9. `GIT_NOT_FOUND`, `GIT_AUTH`, `GIT_CONFLICT`
10. `NETWORK`
11. `CORRUPT`
12. `INTERNAL`

## 5. Common value types

```ts
type IsoTimestamp = string
type AssetKind = 'prompt' | 'contract' | 'skill' | 'mcp'
type SyncPolicy = 'inherit' | 'sync' | 'local'
type ThemeMode = 'light' | 'dark' | 'system'
type Density = 'comfortable' | 'compact'

type AssetSyncState =
  | 'not-connected'
  | 'local-only'
  | 'in-sync'
  | 'outgoing'
  | 'incoming'
  | 'conflict'
  | 'blocked'

interface PageRequest {
  limit?: number
  offset?: number
}

interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

interface FolderNode {
  path: string
  name: string
  directCount: number
  totalCount: number
  children: FolderNode[]
}

interface AssetListResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  folders: FolderNode[]
}

interface RevisionSummary {
  id: string
  version: number
  note: string | null
  manifestHash: string
  createdAt: IsoTimestamp
  // Additive extension: optional text content for version comparison.
  // Binary files use content: null. This avoids a second revision-content channel.
  files?: Array<{ path: string; content: string | null }>
}

interface AssetBase {
  id: string
  kind: AssetKind
  title: string
  slug: string
  folder: string
  description: string
  tags: string[]
  syncPolicy: SyncPolicy
  effectiveSync: boolean
  syncState: AssetSyncState
  inRepo: boolean
  currentRevisionId: string
  currentVersion: number
  versionCount: number
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

interface DeleteInput {
  id: string
  confirm: true
  requestId?: string
}

interface DeleteResult {
  id: string
  deletedAt: IsoTimestamp
  withdrawnChangeIds: string[]
}

interface SetFavoriteInput {
  id: string
  favorite: boolean
}

interface FavoriteResult {
  id: string
  isFavorite: boolean
}

interface SetPinnedInput {
  id: string
  pinned: boolean
}

interface PinnedResult {
  id: string
  isPinned: boolean
}

interface SetSyncPolicyInput {
  id: string
  syncPolicy: SyncPolicy
}

interface AssetSyncPolicyResult {
  id: string
  syncPolicy: SyncPolicy
  effectiveSync: boolean
  withdrawnChangeIds: string[]
}

interface RestoreVersionInput {
  id: string
  revisionId: string
  expectedRevisionId: string
  note?: string
  requestId?: string
}

interface StoreQuery extends PageRequest {
  search?: string
  category?: string
}

interface ScanFinding {
  ruleId: string
  confidence: 'high' | 'medium'
  path?: string
  line?: number
  column?: number
  preview: string
  replacement: '{{variable}}' | '${VAR}'
}

interface HealthIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}
```

Rules:

- `AssetBase.folder` uses `''` for the root folder.
- `AssetBase.inRepo` is `true` only when the asset existed in the repository at the last successful sync.
- `AssetBase.effectiveSync` applies the repository-wide policy first. When the repository policy is off, every asset behaves as local-only regardless of its per-asset value.
- `AssetListResult.folders` is computed with the query filters applied except `folder` and `includeDescendants`, so the tree does not collapse when the user selects a folder.
- `Page<T>` is used for non-asset lists. `AssetListResult<T>` is used for asset lists.

### 5.1 Canonical folder and path rules

- Folder paths use `/` separators, no leading slash, no trailing slash, and no `.` or `..` segments.
- The root folder is `''`.
- Slug generation is shared code. Duplicate slugs within the same `kind` and `folder` are rejected with `CONFLICT` and `details.kind: 'duplicate'`.
- Moving an asset changes its `folder`, repository path, and pending sync paths. The backend never deletes or renames the remote file on a local move.
- Repository paths follow [`docs/prd.md`](./prd.md) section 9.1 exactly.

## 6. Channel catalog

The catalog is the canonical list. Request and response types are defined in the referenced sections.

### 6.1 App, projects, and bootstrap

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `app:bootstrap` | `void` | `BootstrapSnapshot` | Initial state, capabilities, counts, active operations |
| `app:theme` | `{ theme: ThemeMode }` | `ThemeUpdateResult` | Fast path for theme changes; also persists the setting |
| `app:openExternal` | `{ url: string }` | `void` | HTTPS only; rejects credentials in the URL |
| `app:revealPath` | `{ target: RevealTarget }` | `void` | Known locations or recorded projection/deployment targets only |
| `projects:list` | `void` | `ProjectSummary[]` | `[TBD-UX]` until INS-007 is designed |
| `projects:register` | `ProjectRegisterInput` | `ProjectSummary` | `[TBD-UX]`; validates an existing directory |
| `projects:remove` | `{ projectId: string; confirm: true }` | `ProjectRemoveResult` | `[TBD-UX]`; marks projections orphaned, never deletes files |

### 6.2 Prompts

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `prompts:list` | `PromptQuery` | `AssetListResult<PromptListItem>` | Filter, search, sort, folder tree |
| `prompts:get` | `{ id: string }` | `PromptDetail` | Full content and metadata |
| `prompts:versions` | `{ id: string }` | `RevisionSummary[]` | Newest first |
| `prompts:create` | `PromptCreateInput` | `PromptDetail` | Creates version 1 |
| `prompts:update` | `PromptUpdateInput` | `PromptDetail` | Requires `expectedRevisionId` |
| `prompts:delete` | `DeleteInput` | `DeleteResult` | Soft delete; remote file untouched |
| `prompts:restore` | `{ id: string }` | `PromptDetail` | Restores a soft-deleted asset |
| `prompts:restoreVersion` | `RestoreVersionInput` | `PromptDetail` | Creates a new revision from history |
| `prompts:copyRender` | `PromptCopyInput` | `PromptCopyResult` | Renders variables, increments usage, optionally writes clipboard |
| `prompts:setSyncPolicy` | `SetSyncPolicyInput` | `AssetSyncPolicyResult` | Metadata-only; may withdraw pending changes |
| `prompts:setFavorite` | `SetFavoriteInput` | `FavoriteResult` | Metadata-only; no revision |
| `prompts:setPinned` | `SetPinnedInput` | `PinnedResult` | Metadata-only; no revision |
| `prompts:folders` | `PromptFolderQuery` | `FolderNode[]` | Same tree as `prompts:list.folders` |
| `prompts:storeList` | `StoreQuery` | `Page<PromptStoreItem>` | P1 curated catalog |

### 6.3 Contracts and targets

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `targets:list` | `void` | `ContractTarget[]` | Project-level target registry |
| `contracts:list` | `ContractQuery` | `AssetListResult<ContractListItem>` | Filter, search, folder tree |
| `contracts:get` | `{ id: string }` | `ContractDetail` | Includes target compatibility |
| `contracts:versions` | `{ id: string }` | `RevisionSummary[]` | Newest first |
| `contracts:create` | `ContractCreateInput` | `ContractDetail` | Creates version 1 |
| `contracts:update` | `ContractUpdateInput` | `ContractDetail` | Requires `expectedRevisionId` |
| `contracts:delete` | `DeleteInput` | `DeleteResult` | Leaves orphan projections |
| `contracts:restore` | `{ id: string }` | `ContractDetail` | Restores a soft-deleted asset |
| `contracts:restoreVersion` | `RestoreVersionInput` | `ContractDetail` | Marks affected projections stale |
| `contracts:resolve` | `ContractResolveInput` | `ResolvedPreview` | Inclusion, skips, bytes, warnings; no writes |
| `contracts:compile` | `ContractCompileInput` | `ContractCompileResult` | Target files plus a preview token; no writes |
| `contracts:setSyncPolicy` | `SetSyncPolicyInput` | `AssetSyncPolicyResult` | Metadata-only |

### 6.4 Projections and global targets

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `projections:list` | `ProjectionQuery` | `Page<ProjectionDetail>` | Project and global rows by filter |
| `projections:project` | `ProjectionProjectInput` | `OperationRef` | Requires confirmation; excludes drifted items; result arrives in `operation:completed` |
| `projections:reproject` | `{ projectionId: string }` | `ProjectionDetail` | Refuses drifted projections |
| `projections:remove` | `{ projectionId: string; confirm: true }` | `ProjectionRemoveResult` | Removes only the managed block or file |
| `projections:rollback` | `{ projectionId: string }` | `ProjectionDetail` | Restores the previous deployed version |
| `projections:overwriteDrift` | `ProjectionOverwriteDriftInput` | `ProjectionDetail` | Item-level only |
| `globalProjections:list` | `GlobalProjectionQuery` | `Page<ProjectionDetail>` | `scope` is forced to `global` |
| `globalProjections:project` | `GlobalProjectionProjectInput` | `OperationRef` | Requires confirmation; excludes drifted items; result arrives in `operation:completed` |
| `globalProjections:reproject` | `{ projectionId: string }` | `ProjectionDetail` | Refuses drifted projections |
| `globalProjections:remove` | `{ projectionId: string; confirm: true }` | `ProjectionRemoveResult` | Removes only the managed block or file |
| `globalProjections:rollback` | `{ projectionId: string }` | `ProjectionDetail` | Restores the previous deployed version |
| `globalProjections:overwriteDrift` | `ProjectionOverwriteDriftInput` | `ProjectionDetail` | Item-level only |
| `globalTargets:list` | `void` | `GlobalTargetDetail[]` | Includes counts and path state |
| `globalTargets:updatePath` | `GlobalTargetUpdateInput` | `GlobalTargetUpdateResult` | Marks non-drifted projections stale |
| `globalTargets:restoreDefault` | `{ targetId: string }` | `GlobalTargetUpdateResult` | Marks non-drifted projections stale |

### 6.5 Skills

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `skills:list` | `SkillQuery` | `AssetListResult<SkillListItem>` | Filter, search, folder tree |
| `skills:get` | `{ id: string }` | `SkillDetail` | Metadata, file tree, install summary |
| `skills:versions` | `{ id: string }` | `RevisionSummary[]` | Newest first |
| `skills:files` | `SkillFilesInput` | `SkillFilesResult` | File metadata; optional text content |
| `skills:create` | `SkillCreateInput` | `SkillDetail` | Must contain `SKILL.md` |
| `skills:update` | `SkillUpdateInput` | `SkillDetail` | Requires `expectedRevisionId`; full file replacement |
| `skills:delete` | `DeleteInput` | `DeleteResult` | Local only; Agent installs untouched |
| `skills:restore` | `{ id: string }` | `SkillDetail` | Restores a soft-deleted asset |
| `skills:restoreVersion` | `RestoreVersionInput` | `SkillDetail` | Creates a new revision from history |
| `skills:import` | `SkillImportInput` | `SkillImportResult` | Preview then apply |
| `skills:storeList` | `StoreQuery` | `Page<SkillStoreItem>` | P1 curated catalog |

### 6.6 MCP

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `mcp:list` | `McpQuery` | `AssetListResult<McpListItem>` | Filter, search, folder tree |
| `mcp:get` | `{ id: string }` | `McpDetail` | Redacted configuration and health |
| `mcp:versions` | `{ id: string }` | `RevisionSummary[]` | Newest first |
| `mcp:create` | `McpCreateInput` | `McpDetail` | Classifies and encrypts secrets |
| `mcp:update` | `McpUpdateInput` | `McpDetail` | Patch semantics for secrets |
| `mcp:delete` | `DeleteInput` | `DeleteResult` | Does not modify Agent configuration |
| `mcp:restore` | `{ id: string }` | `McpDetail` | Restores a soft-deleted asset |
| `mcp:restoreVersion` | `RestoreVersionInput` | `McpDetail` | Restores non-secret config; preserves current secret values |
| `mcp:health` | `{ id: string }` | `McpHealthResult` | Static checks only; no process or network |
| `mcp:setEnabled` | `{ id: string; enabled: boolean }` | `McpDetail` | Metadata-only |
| `mcp:setFavorite` | `SetFavoriteInput` | `FavoriteResult` | Metadata-only |
| `mcp:agentState` | `{ agentIds?: string[] }` | `AgentMcpState[]` | Redacted reverse-import inspection |
| `mcp:importExternal` | `McpImportInput` | `McpImportResult` | Preview then apply; P1 |
| `mcp:apply` | `McpApplyInput` | `McpApplyResult` | Preview then operation; plaintext-at-rest acknowledgement required |
| `mcp:remove` | `McpRemoveInput` | `OperationRef` | Removes only managed entries; result arrives in `operation:completed` |
| `mcp:storeList` | `StoreQuery` | `Page<McpStoreItem>` | P1 curated catalog |

### 6.7 Git sync

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `sync:repoGet` | `void` | `RepoStatus \| null` | `null` when no repository is connected |
| `sync:repoConnect` | `RepoConnectInput` | `RepoConnectResult` | Preview then apply |
| `sync:repoDisconnect` | `RepoDisconnectInput` | `RepoDisconnectResult` | Never deletes a user-provided clone |
| `sync:repoUpdate` | `RepoUpdateInput` | `RepoStatus` | Policies, layout, auto-fetch, push mode, auth |
| `sync:fetch` | `{ requestId?: string }` | `OperationRef` | Read-only fetch; never auto-pulls |
| `sync:changes` | `SyncChangeQuery` | `Page<SyncChangeSummary>` | Summary only |
| `sync:changeDetail` | `{ changeId: string }` | `SyncChangeDetail` | Three-way content, redacted |
| `sync:review` | `SyncReviewInput` | `SyncReviewResult` | Approve or dismiss; invalidates on fingerprint change |
| `sync:pull` | `SyncPullInput` | `OperationRef` | Applies reviewed changes only |
| `sync:push` | `SyncPushInput` | `OperationRef` | Never forces; scanner blocks on credentials |
| `sync:conflictResolve` | `SyncConflictResolveInput` | `ConflictResolutionResult` | Take repository, keep local, or manual merge |
| `sync:history` | `SyncHistoryQuery` | `Page<AuditEvent>` | Redacted audit trail |
| `sync:cancel` | `{ operationId: string }` | `CancelResult` | Best effort; final state arrives as an event |

### 6.8 Dispatch

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `dispatch:matrix` | `DispatchMatrixQuery` | `DispatchMatrix` | Computed Skill and MCP matrix |
| `dispatch:detail` | `{ assetId: string }` | `DispatchDetail` | Per-Agent cells and history |
| `dispatch:install` | `DispatchInstallInput` | `DispatchInstallResult` | Skill install; preview then operation |
| `dispatch:remove` | `DispatchRemoveInput` | `OperationRef` | Skill install only; result arrives in `operation:completed` |
| `dispatch:rollback` | `DispatchRollbackInput` | `OperationRef` | Skill install only; result arrives in `operation:completed` |
| `dispatch:syncStale` | `DispatchSyncStaleInput` | `OperationRef` | Stale only; drifted items reported, never overwritten |

MCP dispatch uses `mcp:apply` and `mcp:remove`. The matrix includes MCP rows, but `dispatch:install`, `dispatch:remove`, and `dispatch:rollback` are Skill-only channels.

### 6.9 Search

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `search:query` | `SearchQuery` | `SearchResultPage` | Main-process FTS query |
| `search:rebuild` | `{ requestId?: string }` | `OperationRef` | Rebuilds the index with progress |

### 6.10 Settings, data, and updates

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `settings:get` | `void` | `SettingsSnapshot` | No secrets |
| `settings:update` | `SettingsUpdateInput` | `SettingsSnapshot` | Explicit save; no secret values |
| `settings:backup` | `SettingsBackupInput` | `OperationRef` | Consistent snapshot |
| `settings:restore` | `RestoreInput` | `RestoreResult` | Preview then operation |
| `settings:reset` | `ResetInput` | `ResetResult` | Preview then operation |
| `settings:diagnostics` | `{ requestId?: string }` | `DiagnosticExportResult` | Redacted export |
| `updates:check` | `void` | `UpdateStatus` | Never blocks startup |
| `updates:download` | `{ requestId?: string }` | `OperationRef` | Verifies signature before install |
| `updates:install` | `UpdateInstallInput` | `OperationRef` | Defers during active writes |
| `updates:status` | `void` | `UpdateStatus` | Current channel, version, and download state |

### 6.11 AI (P1)

| Channel | Request | Response | Notes |
| --- | --- | --- | --- |
| `ai:providers` | `void` | `AiProviderInfo[]` | Includes `hasKey`, never the key |
| `ai:providerSave` | `AiProviderSaveInput` | `AiProviderInfo` | API key is write-only |
| `ai:test` | `AiTestInput` | `AiStreamHandle` | Starts a streamed request |
| `ai:cancel` | `{ streamId: string }` | `CancelResult` | Stops the stream and records cancellation |
| `ai:history` | `AiHistoryQuery` | `Page<AiTestRun>` | Local history, no secrets |

### 6.12 Events

| Event | Payload | Notes |
| --- | --- | --- |
| `domain:changed` | `DomainChangedEvent` | Coalesced invalidation hint |
| `operation:progress` | `OperationProgressEvent` | All non-sync operations |
| `operation:completed` | `OperationCompletedEvent` | All operations |
| `sync:progress` | `SyncProgressEvent` | Sync operations only; replaces `operation:progress` for those operations |
| `update:available` | `UpdateAvailableEvent` | Signed update available |
| `ai:stream` | `AiStreamEvent` | Streaming AI response |

## 7. App, bootstrap, and project roots

### 7.1 Bootstrap

```ts
type DataLocationId =
  | 'database'
  | 'blobs'
  | 'library'
  | 'clones'
  | 'backups'
  | 'logs'
  | 'operations'

interface DataLocation {
  id: DataLocationId
  label: string
  path: string
  exists: boolean
  sizeBytes?: number
}

interface BootstrapSnapshot {
  appVersion: string
  buildId: string
  schemaVersion: number
  contractVersion: 1
  platform: 'darwin' | 'win32'
  locale: string
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
  density: Density
  safeStorage: {
    available: boolean
    reason?: string
  }
  capabilities: {
    ai: boolean
    updates: boolean
    globalProjections: boolean
    multiWindow: false
  }
  repo: RepoStatus | null
  counts: Record<AssetKind, number>
  pending: {
    incoming: number
    outgoing: number
    conflicts: number
    dispatchStale: number
    dispatchDrifted: number
    projectionStale: number
    projectionDrifted: number
  }
  detectedAgentIds: string[]
  activeOperations: OperationRef[]
  recovery: {
    degraded: boolean
    issues: string[]
  }
  dataLocations: DataLocation[]
}
```

Rules:

- `app:bootstrap` is called once after the renderer loads. It is the only channel that may return aggregate counts across domains.
- `contractVersion` is the version of this document. `schemaVersion` is the database schema version.
- `safeStorage.available` is `false` when OS encryption is unavailable. The renderer must disable secret entry and explain why.
- `activeOperations` lets the renderer restore its operation panel after a reload. There is no separate operation query channel in this contract.
- `recovery.degraded` is `true` when startup reconciliation found partial writes or integrity issues that need user review.
- `dataLocations` contains local paths only. It never contains secrets.

### 7.2 Theme

```ts
interface ThemeUpdateResult {
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
}
```

- `app:theme` persists the preference and returns the effective theme.
- `settings:get` returns the same preference. The two channels must not diverge.

### 7.3 External links and reveal

```ts
type RevealTarget =
  | { kind: 'data-location'; location: DataLocationId }
  | { kind: 'projection'; projectionId: string }
  | { kind: 'deployment'; deploymentId: string }
```

- `app:openExternal` accepts `https:` URLs only. It rejects URLs with embedded credentials, `file:`, `javascript:`, custom schemes, and data URLs.
- `app:revealPath` accepts only a `RevealTarget`. The renderer never passes an arbitrary absolute path.
- The main process resolves the path from its own records and verifies it is inside an allowed root before revealing it.

### 7.4 Project roots

```ts
interface ProjectSummary {
  id: string
  name: string
  rootPath: string
  createdAt: IsoTimestamp
  projectionCount: number
  staleCount: number
  driftedCount: number
}

interface ProjectRegisterInput {
  name: string
  rootPath: string
}

interface ProjectRemoveResult {
  projectId: string
  orphanedProjectionIds: string[]
}
```

- `projects:list` is read-only and safe to implement before the registration UX exists.
- `projects:register` and `projects:remove` are `[TBD-UX]`. The contract defines the shape, but the interaction design must decide how a user selects and removes roots.
- Removing a project never deletes files. It marks its projections orphaned.

## 8. Asset common contract

### 8.1 Revisions and content writes

- Every content save creates a new immutable revision with the next integer version.
- Metadata-only changes such as `setFavorite` and `setSyncPolicy` do not create revisions.
- Content updates require `expectedRevisionId`. A mismatch returns `REVISION_CONFLICT`.
- A revision always has a manifest, even for a single file.
- The manifest hash is SHA-256 over a canonical JSON representation sorted by path.
- The canonical repository file is authoritative for sync, export, materialization, diff, and rollback.
- The backend writes the structured columns and the canonical file in the same transaction. If they diverge later, the asset is marked degraded until the user reviews the conflict.

### 8.2 Soft delete, restore, and revision restore

- `delete` is soft by default. It sets `deletedAt`, withdraws pending sync changes, and leaves revisions and remote files intact.
- Soft-deleted assets are excluded from lists and search.
- `restore` restores a soft-deleted asset. It fails with `NOT_FOUND` when the retention window has expired or the asset was purged.
- `restoreVersion` creates a **new** revision from a historical revision. It never rewrites history.
- Restoring a synced asset creates a pending outgoing change when the asset participates in sync.
- Local delete never deletes the remote repository file. The UI must explain that a remote file can reappear on the next pull.

### 8.3 List semantics

- `AssetListResult.folders` uses the same filters as `items` except `folder` and `includeDescendants`.
- `directCount` counts assets directly in the folder. `totalCount` includes descendants.
- The default sort is `updated` descending.
- Tag filters use AND semantics.
- Search is performed by the main-process FTS index, not by filtering a full in-memory list.

### 8.4 Sync policy semantics

- `inherit`: participates when the repository policy for the asset kind is enabled.
- `sync`: participates when the repository is connected and the repository policy for the asset kind is enabled.
- `local`: never enters Git and never appears in pending pushes.
- Skills and MCP do not expose per-asset sync scope. Their `syncPolicy` is always `inherit`, and `setSyncPolicy` is not available for them.
- Turning an asset to `local` withdraws its unprocessed pending changes and leaves repository files untouched.
- `effectiveSync` is computed by the backend and returned on every asset DTO.

### 8.5 Folder tree channel

`prompts:folders` exists because the Prompt workspace loads the tree independently. The other asset workspaces use `folders` from their list result. Both sources must produce identical trees for identical filters.

```ts
interface PromptFolderQuery {
  search?: string
  tags?: string[]
  favorite?: boolean
  pinned?: boolean
}
```

## 9. Prompts

### 9.1 Types

```ts
type PromptVariableType = 'text' | 'textarea' | 'number' | 'select'

interface PromptVariable {
  name: string
  type: PromptVariableType
  label?: string
  example?: string
  options?: string[]
  required?: boolean
}

interface PromptListItem extends AssetBase {
  kind: 'prompt'
  excerpt: string
  variableCount: number
  usageCount: number
  isFavorite: boolean
  isPinned: boolean
  pendingChangeCount: number
}

interface PromptDetail extends AssetBase {
  kind: 'prompt'
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  usageCount: number
  isFavorite: boolean
  isPinned: boolean
}

interface PromptQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  favorite?: boolean
  pinned?: boolean
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title' | 'usage'
  order?: 'asc' | 'desc'
}

interface PromptCreateInput {
  requestId?: string
  title: string
  description?: string
  folder?: string
  tags?: string[]
  systemPrompt?: string
  userPrompt?: string
  variables?: PromptVariable[]
  syncPolicy?: SyncPolicy
}

interface PromptUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  folder?: string
  tags?: string[]
  systemPrompt?: string
  userPrompt?: string
  variables?: PromptVariable[]
}

interface PromptCopyInput {
  id: string
  values: Record<string, string>
  writeClipboard?: boolean
}

interface PromptCopyResult {
  text: string
  unresolvedVariables: string[]
  warnings: string[]
  usageCount: number
  wroteClipboard: boolean
}

interface PromptStoreItem {
  id: string
  title: string
  description: string
  author: string
  category: string
  tags: string[]
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  uses: number
  updatedAt: IsoTimestamp
}
```

### 9.2 Behavior

- Title is required. At least one of `systemPrompt` or `userPrompt` must be non-empty.
- Variable names are unique and valid identifiers. The backend re-parses `{{name}}` and `{{name:example}}` from both bodies and merges them with stored definitions. The response is authoritative.
- Variable values are never persisted to the asset, version history, repository file, or logs.
- `prompts:copyRender` renders with literal replacement. Unknown or empty values remain visible and are returned in `unresolvedVariables`.
- `prompts:copyRender` increments `usageCount` once per successful render. It writes to the clipboard only when `writeClipboard` is `true`.
- `prompts:setSyncPolicy` is metadata-only. When the new policy is `local`, the backend withdraws pending changes and returns their IDs.
- `prompts:setFavorite` is metadata-only and may be optimistic in the renderer.
- `prompts:setPinned` is metadata-only and may be optimistic in the renderer.
- Duplicating a Prompt is a renderer composition: `prompts:get` followed by `prompts:create` with a new title. Do not add a duplicate channel.
- `prompts:storeList` is P1. Saving a catalog item is a renderer composition of review, `prompts:create`, and local tags; the catalog is labeled as curated data.
- Prompts are never dispatched to Agent directories. There is no dispatch channel for Prompts.

## 10. Contracts, targets, and resolution

### 10.1 Types

```ts
type ContractScope = 'user' | 'project' | 'path'
type ContractActivationMode = 'always' | 'glob' | 'model' | 'manual'
type ContractFormat =
  | 'agents-md'
  | 'claude-md'
  | 'copilot-instructions'
  | 'copilot-path'
  | 'cursor-mdc'
  | 'windsurf-rule'

interface ContractActivation {
  mode: ContractActivationMode
  globs: string[]
  description?: string
}

interface ContractTarget {
  id: string
  agentId: string
  agentName: string
  label: string
  format: ContractFormat
  pathTemplate: string
  merge: 'single-file' | 'per-contract'
  precedence: 'nearest' | 'concat' | 'override'
  supports: {
    globs: boolean
    modelDecision: boolean
    manual: boolean
    imports: boolean
  }
  maxBytes?: number
  note: string
}

interface TargetCompatibility {
  targetId: string
  compatible: boolean
  blocking: boolean
  unsupportedFeatures: Array<'globs' | 'modelDecision' | 'manual' | 'imports'>
  warnings: string[]
}

interface ContractListItem extends AssetBase {
  kind: 'contract'
  scope: ContractScope
  pathPrefix: string | null
  activationMode: ContractActivationMode
  priority: number
  targetIds: string[]
  compatibility: TargetCompatibility[]
  pendingChangeCount: number
}

interface ContractDetail extends AssetBase {
  kind: 'contract'
  body: string
  scope: ContractScope
  pathPrefix: string | null
  activation: ContractActivation
  priority: number
  imports: string[]
  targetIds: string[]
  compatibility: TargetCompatibility[]
}

interface ContractQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  scope?: ContractScope
  activationMode?: ContractActivationMode
  targetId?: string
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title' | 'priority'
  order?: 'asc' | 'desc'
}

interface ContractCreateInput {
  requestId?: string
  title: string
  description?: string
  body?: string
  folder?: string
  scope: ContractScope
  pathPrefix?: string
  activation: ContractActivation
  priority?: number
  imports?: string[]
  targetIds: string[]
  tags?: string[]
  syncPolicy?: SyncPolicy
  acknowledgeTargetWarnings?: boolean
}

interface ContractUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  body?: string
  folder?: string
  scope?: ContractScope
  pathPrefix?: string | null
  activation?: ContractActivation
  priority?: number
  imports?: string[]
  targetIds?: string[]
  tags?: string[]
  acknowledgeTargetWarnings?: boolean
}
```

### 10.2 Validation

- `scope: 'path'` requires a non-empty `pathPrefix`. The prefix is a relative directory path without `..`.
- `scope: 'project'` requires `projectId` on resolve, compile, and project requests. `scope: 'global'` must not include `projectId`.
- `activation.mode: 'glob'` requires at least one glob.
- `activation.mode: 'model'` requires a non-empty `description`.
- `imports` are relative paths inside the repository root. They must not contain `..`, must not be URLs, and are never executed. `[ASSUMPTION]` The stricter relative-only rule replaces the vague "documented paths" wording until a concrete need is reviewed.
- Target IDs must exist in the registry.
- Incompatible target capabilities are warnings, not silent downgrades.
- `blocking: true` means the target cannot represent the selected activation mode. Saving is still allowed, but projection for that target is disabled with an explanation.
- When warnings exist and `acknowledgeTargetWarnings` is not `true`, the backend returns `VALIDATION` with `details.kind: 'target-warnings'`. The renderer shows the warnings and resubmits.
- Saving or restoring a version creates a revision, marks affected projections stale, and never writes to target files.

### 10.3 Target registry

- `targets:list` returns the project-level registry from shared code. The registry is data-driven and contains no vendor-specific workspaces.
- Global targets are returned by `globalTargets:list`, not `targets:list`.
- Capability flags are the only supported way for the renderer to disable an activation mode. The renderer must not hard-code vendor behavior.

### 10.4 Resolution and compilation

```ts
interface ContractResolveInput {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  samplePath?: string
  contractIds?: string[]
}

interface ResolvedContractEntry {
  contractId: string
  title: string
  sourcePath: string
  reason: string
  bytes: number
  revisionId: string
  activationMode: ContractActivationMode
}

interface SkippedContractEntry {
  contractId: string
  title: string
  reason: string
  code:
    | 'path-scope-mismatch'
    | 'glob-not-matched'
    | 'activation-unsupported'
    | 'target-not-selected'
    | 'deleted'
    | 'model-decision'
    | 'manual-only'
}

interface ResolvedPreview {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  samplePath?: string
  included: ResolvedContractEntry[]
  skipped: SkippedContractEntry[]
  totalBytes: number
  maxBytes?: number
  budgetExceeded: boolean
  warnings: string[]
  compiledFilePaths: string[]
  approximationNotice: string
}

interface ContractCompileInput {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  contractIds: string[]
  samplePath?: string
}

interface CompiledFile {
  targetId: string
  path: string
  content: string
  bytes: number
}

interface ContractCompileResult {
  files: CompiledFile[]
  warnings: string[]
  previewToken: string
}
```

Rules:

- `contracts:resolve` is read-only. It reports inclusion, skip reasons, per-contract bytes, total bytes, budget warnings, and compiled file paths. It does not return full file content.
- When `contractIds` is omitted, the backend resolves every contract eligible for the target and scope. When it is present, only those contracts are considered and other eligible contracts appear as `target-not-selected`.
- `contracts:compile` is read-only. It returns the exact target files and a `previewToken` that binds the selection and output hash.
- Preview and write use the same compiler. The main process recompiles from validated database state before writing; it never writes renderer-supplied content.
- `approximationNotice` is a persistent English notice that the preview is an approximation and the target tool is authoritative.
- Equal priorities are ordered deterministically by `updatedAt` ascending, then `id` ascending. A warning is added when equal priorities overlap in the same target scope. `[ASSUMPTION]`
- A target with `maxBytes` emits `budgetExceeded` and a warning; it does not silently truncate.
- Imports are rendered where the target supports imports. Unsupported imports produce a warning.

## 11. Projections and global targets

### 11.1 Types

```ts
type ProjectionStatus = 'synced' | 'stale' | 'drifted' | 'missing'

interface ProjectionDetail {
  id: string
  contractId: string | null
  contractTitle: string
  contractSlug: string
  targetId: string
  scope: 'project' | 'global'
  projectId: string
  targetPath: string
  status: ProjectionStatus
  deployedRevisionId: string | null
  deployedVersion: number | null
  previousVersion?: number
  deployedAt?: IsoTimestamp
  fileHash?: string
  outsideHash?: string
  blockHash?: string
  note?: string
  orphaned: boolean
}

interface ProjectionQuery extends PageRequest {
  contractId?: string
  targetId?: string
  scope?: 'project' | 'global'
  projectId?: string
  status?: ProjectionStatus
  orphaned?: boolean
}

interface GlobalProjectionQuery extends Omit<ProjectionQuery, 'scope' | 'projectId'> {}

interface ProjectionProjectInput {
  contractIds: string[]
  targetIds: string[]
  projectId: string
  confirm: true
  previewToken?: string
  requestId?: string
}

interface GlobalProjectionProjectInput {
  contractIds: string[]
  targetIds: string[]
  confirm: true
  previewToken?: string
  requestId?: string
}

interface ProjectionFailure {
  contractId: string
  targetId: string
  targetPath?: string
  code: IpcErrorCode
  message: string
}

interface BatchProjectionResult {
  projected: number
  skipped: number
  driftedNotOverwritten: number
  skippedItems: Array<{ contractId: string; targetId: string; reason: string }>
  failed: ProjectionFailure[]
}

interface ProjectionOperationResult extends BatchProjectionResult {
  scope: 'project' | 'global'
}

interface ProjectionRemoveResult {
  projectionId: string
  removed: boolean
  targetPath: string
  note?: string
}

interface ProjectionOverwriteDriftInput {
  projectionId: string
  expectedFileHash: string
  confirm: true
}

interface GlobalTargetDetail {
  id: string
  agentId: string
  agentName: string
  label: string
  description: string
  pathMode: 'file' | 'dir'
  defaultPath: string
  path: string
  format: 'claude-md' | 'agents-md' | 'cursor-mdc' | 'windsurf-rule' | 'plain-md'
  merge: 'single-file' | 'per-contract'
  fileExt?: string
  supports: {
    globs: boolean
    modelDecision: boolean
    manual: boolean
    imports: boolean
  }
  maxBytes?: number
  note: string
  exists: boolean
  detected: boolean
  projectionCount: number
  staleCount: number
  driftedCount: number
  updatedAt: IsoTimestamp
}

interface GlobalTargetUpdateInput {
  targetId: string
  path: string
  expectedUpdatedAt?: IsoTimestamp
}

interface GlobalTargetUpdateResult {
  target: GlobalTargetDetail
  markedStale: number
  driftedNotChanged: number
}
```

### 11.2 Projection rules

- `projections:project` and `globalProjections:project` accept selections only. The renderer never sends target paths or compiled content.
- A batch projection starts an operation and returns `OperationRef`. The final `ProjectionOperationResult` arrives in `operation:completed`.
- The backend recompiles from database state, validates every target path, and writes each target atomically.
- Drifted projections are excluded from bulk projection. They appear in `driftedNotOverwritten` and in `skippedItems` with a reason.
- `previewToken` is optional but recommended. When supplied, the backend verifies that the selection and compiled output still match. `[ASSUMPTION]`
- `projections:reproject` refuses `drifted` projections with `CONFLICT` and `details.kind: 'projection-drift'`. Use `overwriteDrift` for an explicit item-level overwrite.
- `projections:overwriteDrift` requires the current `expectedFileHash` and `confirm: true`. It never applies to a bulk selection.
- `projections:remove` removes only the managed block or the per-contract file created by the app. It does not delete the Contract.
- `projections:rollback` restores the previous deployed version and updates the projection record.
- Deleting a Contract or removing a project marks projections orphaned. Orphaned rows cannot regenerate content; they can only be removed or rolled back.
- A target file missing at projection time is created with a generation marker.
- A path change marks non-drifted projections stale. Drifted projections are not modified and are counted in `driftedNotChanged`.
- Global target paths are local-only and never written to Git.

### 11.3 Global path validation

- A global target path must be absolute or start with `~`.
- It must not contain a newline, NUL, or `..` segment.
- The backend expands `~` with the OS home directory. It does not expand arbitrary environment variables from renderer input.
- The parent directory is created only at write time, after confirmation.
- `globalTargets:updatePath` and `globalTargets:restoreDefault` never move or rewrite files.

### 11.4 Managed blocks

- Single-file targets use `<!-- pk:begin <contract-id> -->` and `<!-- pk:end <contract-id> -->`.
- Nested or unclosed markers are a validation error. The file is marked drifted and not rewritten.
- Duplicate contract IDs in one file are a validation error.
- Content outside markers is preserved byte-for-byte except for line-ending normalization on write.
- A file with no markers is treated as outside content and receives blocks in deterministic order.

## 12. Skills

### 12.1 Types

```ts
type SkillSource = 'local' | 'official' | 'community' | 'import' | 'scan'
type InstallMode = 'symlink' | 'copy'

interface SkillFileEntry {
  path: string
  size: number
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

interface SkillFileWrite {
  path: string
  content: string
}

interface SkillListItem extends AssetBase {
  kind: 'skill'
  versionLabel: string
  icon: string
  source: SkillSource
  category: string
  fileCount: number
  pendingChangeCount: number
  installSummary: {
    synced: number
    stale: number
    drifted: number
    missing: number
    unsupported: number
  }
}

interface SkillDetail extends AssetBase {
  kind: 'skill'
  versionLabel: string
  author: string
  category: string
  icon: string
  source: SkillSource
  files: SkillFileEntry[]
  installSummary: SkillListItem['installSummary']
}

interface SkillQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  source?: SkillSource
  category?: string
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title'
  order?: 'asc' | 'desc'
}

interface SkillCreateInput {
  requestId?: string
  title: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files: SkillFileWrite[]
}

interface SkillUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files?: SkillFileWrite[]
}

interface SkillFilesInput {
  assetId: string
  revisionId?: string
  includeContent?: boolean
}

interface SkillFilesResult {
  assetId: string
  revisionId: string
  manifestHash: string
  files: SkillFileEntry[]
  contents?: Record<string, string>
  omitted: Array<{ path: string; reason: 'binary' | 'too-large' }>
}

interface SkillImportInput {
  requestId?: string
  sourcePaths?: string[]
  pickFromDialog?: boolean
  confirm: boolean
  previewToken?: string
  acknowledgeScripts?: boolean
}

interface SkillImportPreview {
  phase: 'preview'
  sources: Array<{
    sourcePath: string
    name: string
    files: SkillFileEntry[]
    risk: SyncRisk[]
    findings: ScanFinding[]
    warnings: string[]
  }>
  conflicts: Array<{ sourcePath: string; reason: string }>
  previewToken: string
}

interface SkillImportApplied {
  phase: 'applied'
  imported: SkillDetail[]
  skipped: Array<{ sourcePath: string; reason: string }>
}

type SkillImportResult = SkillImportPreview | SkillImportApplied

interface SkillStoreItem {
  id: string
  name: string
  icon: string
  description: string
  author: string
  version: string
  category: string
  downloads: number
  source: 'official' | 'community'
  files: SkillFileEntry[]
}
```

### 12.2 Behavior

- A Skill directory must contain `SKILL.md` at its root.
- Duplicate titles within the same folder are rejected with `CONFLICT`.
- `skills:update.files`, when present, is the **complete** desired file set for the next revision. It is not a patch. Omit `files` to keep the current files.
- Binary files are stored in blobs but never returned as content. Their metadata is returned with `mediaKind: 'binary'`.
- Executable bits are preserved in the manifest but never executed.
- `skills:files` returns text content only when `includeContent` is `true`. The backend enforces per-file and total caps; omitted files are listed in `omitted`. The exact caps are `[TBD-BE]`.
- `skills:import` opens a native picker when `sourcePaths` is absent and `pickFromDialog` is `true`. The preview phase reports files, risks, script findings, and conflicts. The apply phase requires `confirm: true` and the matching `previewToken`.
- Imported symlinks are rejected unless a reviewed policy allows them. This policy is `[TBD-BE]`.
- When the preview reports script-like files, the apply phase requires `acknowledgeScripts: true`.
- Saving or restoring a Skill marks affected deployments stale. The renderer refetches dispatch state; the mutation response does not enumerate deployments.
- Deleting a Skill removes only the local asset and withdraws pending changes. Existing Agent installs and repository directories are untouched.
- `skills:storeList` is P1. Installing from the store is a renderer composition: review the item, then `skills:create` with the reviewed files or `skills:import` for a bundled local source.

## 13. MCP

### 13.1 Types

```ts
type McpTransport = 'stdio' | 'http'
type McpSource = 'manual' | 'market' | 'import'

interface McpFieldValue {
  value: string
  redacted: boolean
  hasValue: boolean
}

interface McpListItem extends AssetBase {
  kind: 'mcp'
  transport: McpTransport
  source: McpSource
  enabled: boolean
  isFavorite: boolean
  pendingChangeCount: number
  healthStatus: 'ok' | 'warning' | 'error'
}

interface McpDetail extends AssetBase {
  kind: 'mcp'
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  env: Record<string, McpFieldValue>
  headers: Record<string, McpFieldValue>
  requiredEnv: string[]
  enabled: boolean
  isFavorite: boolean
  notes: string
  source: McpSource
  healthStatus: 'ok' | 'warning' | 'error'
  health: HealthIssue[]
}

interface McpQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  transport?: McpTransport
  enabled?: boolean
  favorite?: boolean
  healthStatus?: 'ok' | 'warning' | 'error'
  sort?: 'updated' | 'created' | 'title'
  order?: 'asc' | 'desc'
}

interface McpCreateInput {
  requestId?: string
  title: string
  description?: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  requiredEnv?: string[]
  folder?: string
  tags?: string[]
  notes?: string
  source?: McpSource
}

interface McpUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  transport?: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string | null>
  headers?: Record<string, string | null>
  requiredEnv?: string[]
  folder?: string
  tags?: string[]
  notes?: string
  confirmClearSecrets?: boolean
}

interface McpHealthResult {
  id: string
  status: 'ok' | 'warning' | 'error'
  issues: HealthIssue[]
  checkedAt: IsoTimestamp
}

interface AgentMcpState {
  agentId: string
  agentName: string
  configPath: string
  exists: boolean
  format: 'json' | 'jsonc' | 'toml'
  servers: Array<{
    name: string
    transport: McpTransport
    managed: boolean
    drift: 'none' | 'modified' | 'unknown'
    redactedConfig: Record<string, unknown>
  }>
}

interface McpImportInput {
  agentId: string
  serverNames: string[]
  confirm: boolean
  previewToken?: string
  requestId?: string
}

interface McpImportPreview {
  phase: 'preview'
  agentId: string
  entries: Array<{
    name: string
    transport: McpTransport
    redactedConfig: Record<string, unknown>
    secretKeys: string[]
    warnings: string[]
  }>
  previewToken: string
}

interface McpImportApplied {
  phase: 'applied'
  imported: McpDetail[]
  skipped: Array<{ name: string; reason: string }>
}

type McpImportResult = McpImportPreview | McpImportApplied

interface McpApplyInput {
  serverIds: string[]
  agentIds: string[]
  confirm: boolean
  previewToken?: string
  acknowledgePlaintextAtRest?: boolean
  requestId?: string
}

interface McpApplyPreview {
  phase: 'preview'
  targets: Array<{
    agentId: string
    agentName: string
    configPath: string
    format: 'json' | 'jsonc' | 'toml'
    entries: Array<{
      serverId: string
      serverName: string
      redactedEntry: Record<string, unknown>
      action: 'create' | 'update' | 'noop'
      drift: boolean
    }>
    warnings: string[]
  }>
  previewToken: string
}

interface McpApplyResultItem {
  agentId: string
  serverId: string
  ok: boolean
  action: 'created' | 'updated' | 'removed' | 'noop'
  targetPath: string
  error?: IpcErrorPayload
}

interface McpApplyOperationResult {
  results: McpApplyResultItem[]
}

type McpApplyResult = McpApplyPreview | OperationRef

interface McpRemoveInput {
  serverIds: string[]
  agentIds: string[]
  confirm: true
  requestId?: string
}

interface McpRemoveOperationResult {
  results: McpApplyResultItem[]
}

interface McpStoreItem {
  id: string
  name: string
  description: string
  whatItDoes: string
  useCases: string[]
  installCommand: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  envDocs: Array<{ key: string; description: string; placeholder: string }>
}
```

### 13.2 Redaction contract

- The renderer never receives a stored secret value.
- For a secret key with a stored value: `value` is `'[REDACTED]'`, `redacted` is `true`, and `hasValue` is `true`.
- For a secret key without a stored value: `value` is `''`, `redacted` is `false`, and `hasValue` is `false`.
- For a non-secret key: `value` is the actual value, `redacted` is `false`, and `hasValue` is `true` when non-empty.
- Redaction happens at the DTO boundary. The renderer never redacts as a security control.
- Version history stores redacted snapshots. Diffs operate on redacted content.
- `mcp:restoreVersion` restores non-secret configuration and preserves the current secret values. Redacted placeholders are never written back as literal values.

### 13.3 Write semantics

- The backend classifies credential-like keys by key name. Values for those keys are encrypted with `safeStorage`; they are never written to the JSON column or the repository file.
- The renderer must not send `[REDACTED]` back as a value. Unchanged secret keys are omitted; new values are plain strings.
- `mcp:create` accepts plain values for env and headers. The backend splits secret and non-secret values.
- `mcp:update` patches env and headers by key:
  - Absent key: keep the current value.
  - String value: replace the value.
  - `null`: clear the value.
  - Clearing a secret key requires `confirmClearSecrets: true`; otherwise the backend returns `VALIDATION`.
- Omitting `env` or `headers` leaves the whole object unchanged.
- `args`, `requiredEnv`, `command`, `url`, `transport`, `notes`, `tags`, and `folder` replace the current value when present.
- Switching transport requires the fields for the new transport. Fields for the old transport are ignored and omitted from the canonical file.
- Saving a revision never logs secret values. A changed secret creates a new encrypted secret record, not a plaintext history entry.
- Saving or restoring an MCP revision marks affected deployments stale. No Agent configuration file is rewritten until `mcp:apply` is confirmed.
- `mcp:setEnabled` is metadata-only. A disabled server cannot be applied; `mcp:apply` returns `UNSUPPORTED` with a reason.
- `mcp:health` performs static validation only. It never spawns the command or opens the URL.

### 13.4 Apply and remove

- `mcp:apply` preview is always redacted. The apply phase requires `confirm: true`, a matching `previewToken`, and `acknowledgePlaintextAtRest: true` because the target Agent configuration will contain the real value at rest.
- The apply phase returns `OperationRef`. The final `McpApplyOperationResult` arrives in `operation:completed`.
- The backend parses JSON, JSONC, and TOML, edits only the managed entry, preserves unrelated keys and comments where the format allows, and writes atomically.
- `mcp:remove` deletes only the managed entry or file created by the app. It never removes external entries. It returns `OperationRef`; the final `McpRemoveOperationResult` arrives in `operation:completed`.
- Reverse import reads Agent configuration, returns a redacted preview, and moves selected secret values into encrypted storage on apply.
- `mcp:storeList` is P1. Installing from the catalog is a renderer composition: review the item, then `mcp:create`.

## 14. Git sync

### 14.1 Types

```ts
type RepoProvider = 'github' | 'gitlab' | 'generic'
type SyncRisk = 'scripts' | 'secrets' | 'network'
type SyncDirection = 'incoming' | 'outgoing' | 'conflict'
type SyncChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'
type SyncChangeStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed'

type RepoAuthInput =
  | { mode: 'credential' }
  | { mode: 'ssh'; keyPath?: string }
  | { mode: 'token'; token?: string; clearToken?: boolean }

interface RepoPolicies {
  skills: boolean
  mcp: boolean
  prompts: boolean
  contracts: boolean
}

interface RepoLayout {
  prompts: string
  contracts: string
  skills: string
  mcp: string
}

interface RepoStatus {
  connected: true
  provider: RepoProvider
  url: string
  branch: string
  localPath: string
  cloneMode: 'managed' | 'bound'
  auth: {
    mode: 'credential' | 'ssh' | 'token'
    hasToken: boolean
  }
  policies: RepoPolicies
  layout: RepoLayout
  autoFetch: boolean
  fetchIntervalMin: number
  pushMode: 'direct' | 'branch'
  lastFetchedAt?: IsoTimestamp
  lastSyncedAt?: IsoTimestamp
  ahead: number
  behind: number
  operation: OperationRef | null
  security: {
    plaintextCredentialCount: number
    blocked: boolean
  }
  fetchError?: {
    code: IpcErrorCode
    message: string
    retryable: boolean
  }
}

interface RepoConnectInput {
  url: string
  provider?: RepoProvider
  branch?: string
  localPath?: string
  cloneMode: 'managed' | 'bound'
  auth: RepoAuthInput
  policies?: RepoPolicies
  layout?: RepoLayout
  autoFetch?: boolean
  fetchIntervalMin?: number
  confirm: boolean
  previewToken?: string
  acknowledgeScripts?: boolean
  requestId?: string
}

interface RepoConnectPreview {
  phase: 'preview'
  repo: {
    provider: RepoProvider
    url: string
    branch: string
    localPath: string
    cloneMode: 'managed' | 'bound'
    headCommit: string | null
  }
  layout: RepoLayout
  counts: Record<AssetKind, number>
  malformed: Array<{ path: string; reason: string }>
  duplicateIds: Array<{ id: string; paths: string[] }>
  scripts: Array<{ path: string; kind: string }>
  credentialFindings: ScanFinding[]
  warnings: string[]
  previewToken: string
}

interface RepoConnectApplied {
  phase: 'applied'
  repo: RepoStatus
}

type RepoConnectResult = RepoConnectPreview | RepoConnectApplied

interface RepoDisconnectInput {
  confirm: true
  deleteManagedClone?: boolean
  requestId?: string
}

interface RepoDisconnectResult {
  disconnected: boolean
  cloneDeleted: boolean
}

interface RepoUpdateInput {
  policies?: Partial<RepoPolicies>
  layout?: Partial<RepoLayout>
  autoFetch?: boolean
  fetchIntervalMin?: number
  pushMode?: 'direct' | 'branch'
  auth?: RepoAuthInput
  confirmPolicyWithdrawal?: boolean
  requestId?: string
}

interface SyncChangeSummary {
  id: string
  kind: AssetKind
  assetId: string | null
  assetName: string
  path: string
  change: SyncChangeKind
  direction: SyncDirection
  status: SyncChangeStatus
  risk: SyncRisk[]
  summary: string
  additions: number
  deletions: number
  blocked: boolean
  blockReason?: string
  fingerprint: string
  remoteVersion: string | null
  localVersion: string | null
  baseVersion: string | null
  reviewedAt?: IsoTimestamp
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

interface SyncChangeQuery extends PageRequest {
  direction?: SyncDirection
  status?: SyncChangeStatus
  kind?: AssetKind
  risk?: SyncRisk
  blocked?: boolean
  search?: string
}

interface SyncFileDiff {
  path: string
  change: SyncChangeKind
  mediaKind: 'text' | 'binary'
  base: string | null
  local: string | null
  remote: string | null
  truncated: boolean
}

interface SyncChangeDetail extends SyncChangeSummary {
  files: SyncFileDiff[]
  redacted: true
  reviewToken: string
}

interface SyncReviewInput {
  changeIds: string[]
  decision: 'approve' | 'dismiss'
  expectedFingerprints: Record<string, string>
  reviewTokens?: Record<string, string>
  note?: string
}

interface SyncReviewResult {
  approved: string[]
  dismissed: string[]
  invalidated: string[]
}

interface SyncPullInput {
  changeIds: string[]
  expectedFingerprints: Record<string, string>
  requestId?: string
}

interface SyncPushInput {
  changeIds: string[]
  commitMessage: string
  method: 'direct' | 'branch'
  requestId?: string
}

interface SyncConflictResolveInput {
  changeId: string
  expectedFingerprint: string
  strategy: 'take-remote' | 'keep-local' | 'manual'
  mergedFiles?: Array<{ path: string; content: string }>
  confirm?: boolean
  note?: string
  requestId?: string
}

interface ConflictResolutionResult {
  changeId: string
  resolved: boolean
  strategy: 'take-remote' | 'keep-local' | 'manual'
  localRevisionId?: string
  outgoingChangeId?: string
}

type AuditEventType =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'conflict'
  | 'deploy'
  | 'projection'
  | 'blocked'
  | 'connect'
  | 'rollback'
  | 'review'
  | 'backup'
  | 'restore'
  | 'reset'
  | 'security'
  | 'update'

interface AuditEvent {
  id: string
  at: IsoTimestamp
  type: AuditEventType
  result: 'success' | 'warning' | 'error'
  title: string
  detail?: Record<string, unknown>
  assetId?: string
  targetId?: string
  repoId?: string
  operationId?: string
}

interface SyncHistoryQuery extends PageRequest {
  type?: AuditEventType
  result?: 'success' | 'warning' | 'error'
  from?: IsoTimestamp
  to?: IsoTimestamp
}

interface CancelResult {
  cancelled: boolean
}
```

### 14.2 Repository connection

- One repository per workspace in the MVP.
- `sync:repoConnect` is two-phase:
  - `confirm: false` returns `RepoConnectPreview` and performs no writes.
  - `confirm: true` requires the matching `previewToken`, persists the repository, layout, policies, and initial base, and returns `RepoConnectApplied`.
- A URL must be HTTPS or SSH and must not contain credentials.
- A local path must be absolute, writable, and not inside the application bundle.
- A bound clone must be a Git worktree.
- Layout roots must be relative paths without `..`.
- Duplicate asset IDs across files are blocking. Malformed files are reported, not rewritten.
- If the preview reports scripts, the apply phase requires `acknowledgeScripts: true`. The acknowledgement records that the user understands scripts and MCP commands may run on this machine.
- A managed clone is created and owned by the app. A bound clone is user-provided and is never deleted by disconnect unless the user explicitly chooses `deleteManagedClone` and the clone is app-managed.
- `sync:repoDisconnect` removes the relationship only. It does not delete assets, revisions, or a user-provided clone.
- On connect, `{ mode: 'token' }` requires a token. On `sync:repoUpdate`, omit `token` to keep the stored token, or set `clearToken: true` to clear it.
- Changing layout roots invalidates existing base paths. The backend recomputes changes and may return an empty change set until the next fetch.
- Turning a repository policy off while pending changes exist requires `confirmPolicyWithdrawal: true`; otherwise the backend returns `CONFLICT`.

### 14.3 Fetch, changes, and review

- `sync:fetch` is read-only with respect to assets, blobs, and base state. It updates sync changes and `lastFetchedAt`.
- Fetch never auto-pulls and never auto-merges.
- Change computation compares local, remote, and base manifests per stable asset ID. A rename is the same ID at a different path.
- Risk is an array: `scripts` for executable or script-like Skill files, `secrets` for credential findings, and `network` for MCP servers with a URL or network command.
- `sync:changes` returns summaries only. `sync:changeDetail` returns redacted three-way content and a `reviewToken`.
- `sync:changeDetail` returns text content only. Binary files appear with `mediaKind: 'binary'` and null content. Oversized text is truncated and marked with `truncated: true`.
- Review is invalidated when the remote content fingerprint changes. `sync:review` returns invalidated IDs; `sync:pull` rechecks fingerprints before applying.
- Review rules enforced by the backend:
  - Prompts and Contracts require per-item review and cannot be bulk-approved.
  - New or script-containing Skills from a remote source require full-content review and an explicit trust acknowledgement.
  - Other Skills may be bulk-approved when they do not carry risk markers.
- A violation returns `VALIDATION` with `details.kind: 'per-item-required'` or `'review-required'`.
- `sync:pull` applies only approved changes. If any selected change is not approved, it returns `VALIDATION` with `details.kind: 'review-required'`.
- Applying a pull creates a new local revision, updates the base manifest and commit, and marks the change resolved.

### 14.4 Push

- `sync:push` runs a credential scan and validates canonical file structure before committing.
- Any high-confidence finding returns `SECURITY_BLOCK` with redacted findings. The scanner never rewrites content automatically.
- Push refuses when the worktree or index has uncommitted changes in managed paths that the app did not create.
- Push never uses `--force`, never amends, never rebases, and never deletes remote branches.
- In `branch` mode, the backend creates a branch and returns a compare URL in the operation result when the provider supports it.
- On commit failure, the backend restores the managed paths from `HEAD`. On push failure, it keeps the commit and leaves changes pending for retry.
- The commit message is required, trimmed, and must not be empty.

### 14.5 Conflicts

- `take-remote` replaces the local revision with remote content, sets the base to the remote manifest, marks the conflict resolved, and marks related projections stale. It requires `confirm: true` because local changes are discarded.
- `keep-local` keeps the local revision, sets the base to the remote manifest, creates an outgoing change, and marks the conflict resolved with a note.
- `manual` requires `mergedFiles`. Each file path must exist in the change file set. The backend validates the merged structure, creates a local revision, records both parents in the note, sets the base to the remote manifest, and creates an outgoing change.
- A manual merge that still contains credential findings returns `SECURITY_BLOCK`.
- Conflict resolution never writes to Agent directories or projections automatically.

### 14.6 Scheduler and history

- Auto-fetch uses the repository interval with jitter. It skips when offline, when another operation is running, or when the app is suspended.
- Auto-fetch emits a change count and never merges.
- History is an append-only, redacted audit trail. `sync:history` returns the same records used by the Sync History tab.
- Every dispatch, projection, sync, security block, rollback, backup, restore, and reset writes at least one audit event.

## 15. Dispatch

### 15.1 Types

```ts
type DispatchStatus = 'synced' | 'stale' | 'drifted' | 'missing' | 'unsupported'

interface DispatchAgent {
  id: string
  name: string
  detected: boolean
  supportsSkills: boolean
  supportsMcp: boolean
  skillDir?: string
  mcpFile?: string
}

interface DispatchCell {
  assetId: string
  agentId: string
  status: DispatchStatus
  deploymentId?: string
  targetPath?: string
  mode?: InstallMode
  deployedVersion?: number
  deployedAt?: IsoTimestamp
  note?: string
}

interface DispatchMatrixQuery {
  kinds?: Array<'skill' | 'mcp'>
  includeUndetected?: boolean
  onlyAnomalies?: boolean
  folder?: string
}

interface DispatchMatrix {
  agents: DispatchAgent[]
  rows: Array<{
    assetId: string
    kind: 'skill' | 'mcp'
    title: string
    folder: string
    currentVersion: number
    cells: DispatchCell[]
  }>
  summary: {
    synced: number
    stale: number
    drifted: number
    missing: number
    unsupported: number
  }
}

interface DeploymentSummary {
  id: string
  agentId: string
  mode: InstallMode
  status: Exclude<DispatchStatus, 'unsupported'>
  deployedVersion: number
  deployedAt: IsoTimestamp
  targetPath: string
}

interface DispatchDetail {
  assetId: string
  kind: 'skill' | 'mcp'
  title: string
  currentVersion: number
  cells: DispatchCell[]
  history: DeploymentSummary[]
}

interface DispatchInstallInput {
  assetId: string
  agentIds: string[]
  mode: InstallMode
  confirm: boolean
  previewToken?: string
  confirmOverwriteExternal?: boolean
  acknowledgeScripts?: boolean
  requestId?: string
}

interface DispatchPreview {
  phase: 'preview'
  assetId: string
  agentIds: string[]
  mode: InstallMode
  risk: SyncRisk[]
  targets: Array<{
    agentId: string
    agentName: string
    targetPath: string
    action: 'create' | 'replace' | 'noop'
    conflict: 'none' | 'external' | 'drifted'
    files: SkillFileEntry[]
    warnings: string[]
  }>
  previewToken: string
}

interface DispatchResultItem {
  agentId: string
  ok: boolean
  action: 'installed' | 'replaced' | 'removed' | 'rolled-back' | 'noop'
  targetPath: string
  error?: IpcErrorPayload
}

interface DispatchOperationSummary {
  installed: number
  replaced: number
  removed: number
  rolledBack: number
  skippedDrifted: number
  failed: number
}

type DispatchOperationResult =
  | {
      mode: 'install' | 'remove' | 'rollback'
      results: DispatchResultItem[]
      summary: DispatchOperationSummary
    }
  | { mode: 'sync-stale'; result: DispatchBatchResult }

type DispatchInstallResult = DispatchPreview | OperationRef

interface DispatchRemoveInput {
  assetId: string
  agentIds: string[]
  confirm: true
  requestId?: string
}

interface DispatchRollbackInput {
  assetId: string
  agentIds: string[]
  requestId?: string
}

interface DispatchSyncStaleInput {
  assetIds?: string[]
  agentIds?: string[]
  requestId?: string
}

interface DispatchBatchResult {
  synced: number
  skippedDrifted: number
  failed: Array<{ assetId: string; agentId: string; code: IpcErrorCode; message: string }>
}
```

### 15.2 Behavior

- `dispatch:matrix` is computed, not stored. Rows include Skills and MCP assets; columns include detected Agents and optionally undetected ones.
- `DispatchMatrix.summary` counts cells, not rows. A single asset contributes one count per Agent column.
- `dispatch:install`, `dispatch:remove`, `dispatch:rollback`, and `dispatch:syncStale` return `OperationRef` on the apply path. The final `DispatchOperationResult` arrives in `operation:completed`.
- Cell status:
  - No deployment and supported: `missing`.
  - Deployment revision equals current revision and hash matches: `synced`.
  - Deployment revision is older: `stale`.
  - Hash mismatch: `drifted`.
  - Agent does not support the asset type: `unsupported`.
- Skill install supports `symlink` and `copy`. Symlink failure is reported as `UNSUPPORTED` with a reason; the renderer offers copy mode and the user must choose it. There is no silent fallback.
- Copy mode refuses to overwrite an unmanaged existing directory unless `confirmOverwriteExternal` is `true`.
- Install never executes Skill scripts, hooks, or package managers.
- When the preview reports script-like files, the apply phase requires `acknowledgeScripts: true`.
- Remove deletes only app-managed content. Rollback restores the previous deployed revision using the same mode.
- Drift is hash-based for both symlink and copy modes. Timestamps do not count.
- `dispatch:syncStale` operates on `stale` items only. Drifted items are counted in `skippedDrifted` and are never overwritten.
- MCP dispatch uses `mcp:apply` and `mcp:remove`, not `dispatch:install`.

## 16. Search

### 16.1 Types

```ts
interface SearchQuery extends PageRequest {
  q: string
  kinds?: AssetKind[]
  folder?: string
  includeDescendants?: boolean
}

interface SearchResultItem {
  assetId: string
  kind: AssetKind
  title: string
  path: string
  folder: string
  snippet: string
  rank: number
}

interface SearchResultPage extends Page<SearchResultItem> {
  rebuilding: boolean
}
```

### 16.2 Behavior

- `q` is treated as tokens by default. The backend supports prefix matching for the last token.
- `snippet` is plain text containing literal `<mark>` and `</mark>` sentinels. The renderer escapes all other characters and converts only those sentinels.
- Results exclude soft-deleted assets and assets the user cannot access in the library.
- `search:rebuild` is an operation and reports progress.
- If the index is rebuilding, `rebuilding` is `true` and the renderer shows the rebuilding state rather than an empty result.

## 17. Settings, data management, and updates

### 17.1 Settings types

```ts
interface SettingsSnapshot {
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
  density: Density
  repository: {
    autoFetch: boolean
    fetchIntervalMin: number
    policies: RepoPolicies
    pushMode: 'direct' | 'branch'
  }
  privacy: {
    telemetry: boolean
    dataDisclosureAcceptedAt?: IsoTimestamp
  }
  updates: {
    channel: 'stable' | 'beta'
    autoCheck: boolean
    lastCheckedAt?: IsoTimestamp
  }
  data: {
    locations: DataLocation[]
    storageBytes: {
      database: number
      blobs: number
      library: number
      backups: number
    }
  }
  ai: {
    configured: boolean
    providers: AiProviderInfo[]
  }
  app: {
    version: string
    buildId: string
    schemaVersion: number
    contractVersion: 1
  }
}

interface SettingsUpdateInput {
  theme?: ThemeMode
  density?: Density
  privacy?: {
    telemetry?: boolean
  }
  updates?: {
    channel?: 'stable' | 'beta'
    autoCheck?: boolean
  }
}
```

- `settings:update` is an explicit save. It never accepts secret values, AI keys, repository tokens, or arbitrary filesystem paths.
- `SettingsSnapshot.repository` mirrors the current repository summary. `sync:repoGet` is authoritative for connection state and ahead/behind counts.
- Repository settings shown in Settings are read from `sync:repoGet` and changed through `sync:repoUpdate`. Global target paths are changed through `globalTargets:updatePath`.
- Turning a repository policy off can withdraw pending changes. The renderer uses `sync:repoUpdate` for that action so it receives the withdrawal result.

### 17.2 Backup and restore

```ts
interface SettingsBackupInput {
  includeLogs?: boolean
  requestId?: string
}

interface RestoreInput {
  backupPath?: string
  pickFromDialog?: boolean
  confirm: boolean
  previewToken?: string
  requestId?: string
}

interface RestorePreview {
  phase: 'preview'
  backupPath: string
  manifest: {
    appVersion: string
    schemaVersion: number
    createdAt: IsoTimestamp
    counts: Record<AssetKind, number>
    blobCount: number
    totalBytes: number
  }
  warnings: string[]
  previewToken: string
}

type RestoreResult = RestorePreview | OperationRef
```

- `settings:backup` creates a consistent snapshot while the app is running. The operation result contains the backup path and byte count.
- A backup includes the database, including encrypted secret ciphertext. It does not make secrets portable; if the OS encryption key is unavailable on restore, affected MCP servers are marked degraded.
- If `backupPath` is absent and `pickFromDialog` is `true`, the backend opens a native file picker.
- `settings:restore` validates the backup, creates a safety backup, and restores only after confirmation.
- A backup from a newer schema version is rejected with `VALIDATION`; a checksum failure is `CORRUPT`.
- A failed restore leaves current data intact.

### 17.3 Reset

```ts
interface ResetInput {
  scope: 'library' | 'all'
  confirm: boolean
  confirmationText?: string
  previewToken?: string
  requestId?: string
}

interface ResetPreview {
  phase: 'preview'
  scope: 'library' | 'all'
  willDelete: {
    assets: number
    revisions: number
    blobs: number
    deployments: number
    projections: number
    settingsReset: boolean
    repositoryDisconnected: boolean
  }
  willKeep: {
    repositoryFiles: true
    userProvidedClone: true
    backups: boolean
  }
  requiredConfirmationText: string
  previewToken: string
}

type ResetResult = ResetPreview | OperationRef
```

- `scope: 'library'` deletes local assets, revisions, blobs, deployments, projections, and search rows. It keeps settings, the repository connection, clones, backups, and logs.
- `scope: 'all'` also resets settings and disconnects the repository. It never deletes a user-provided clone, repository files, or existing backups.
- The apply phase requires `confirmationText` to equal `requiredConfirmationText` and a matching `previewToken`.
- The exact deletion list is `[TBD-BE]` and must be shown in the preview.
- Reset is separate from restore. It is not a backup operation.

### 17.4 Diagnostics

```ts
interface DiagnosticExportResult {
  path: string
  sections: string[]
  redacted: true
}
```

- Diagnostics include logs, environment details, schema version, and recent operation summaries.
- Diagnostics exclude secrets, ciphertext, asset bodies, full repository URLs with credentials, and arbitrary personal paths beyond the recorded data locations.
- The export is written to a user-chosen location after a native save dialog.

### 17.5 Updates

```ts
interface UpdateAvailable {
  version: string
  channel: 'stable' | 'beta'
  releaseNotes: string
  publishedAt: IsoTimestamp
  sizeBytes: number
}

interface UpdateStatus {
  channel: 'stable' | 'beta'
  currentVersion: string
  available?: UpdateAvailable
  download?: {
    state: 'idle' | 'downloading' | 'downloaded' | 'installing' | 'failed'
    progress: number
    error?: IpcErrorPayload
  }
  lastCheckedAt?: IsoTimestamp
}

interface UpdateInstallInput {
  version: string
  confirm: true
  requestId?: string
}
```

- Update checks never block startup.
- Downloads verify the signature before installation.
- Installation is deferred while a critical write is active and returns `LOCKED`.
- A downgrade requires explicit consent and is not part of the MVP.
- `update:available` is emitted when a new signed update is found.

## 18. AI test (P1)

### 18.1 Types

```ts
interface AiProviderInfo {
  id: string
  name: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyUpdatedAt?: IsoTimestamp
  isDefault: boolean
}

interface AiProviderSaveInput {
  id?: string
  name: string
  baseUrl: string
  model: string
  apiKey?: string | null
  confirmClearKey?: boolean
  isDefault?: boolean
}

interface AiTestInput {
  providerId: string
  model?: string
  promptId?: string
  systemPrompt: string
  userPrompt: string
  values: Record<string, string>
  acknowledgeDataDisclosure?: boolean
}

interface AiStreamHandle {
  streamId: string
  startedAt: IsoTimestamp
}

interface AiStreamEvent {
  streamId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  error?: IpcErrorPayload
  at: IsoTimestamp
}

interface AiTestRun {
  id: string
  providerId: string
  model: string
  promptId: string | null
  startedAt: IsoTimestamp
  durationMs: number
  status: 'completed' | 'cancelled' | 'failed'
  responsePreview: string
  errorCode?: IpcErrorCode
}

interface AiHistoryQuery extends PageRequest {
  providerId?: string
  status?: 'completed' | 'cancelled' | 'failed'
}
```

### 18.2 Behavior

- API keys are encrypted and never returned to the renderer. `hasKey` is the only key state exposed.
- `ai:providerSave` accepts a new key or `null` to clear it. Clearing requires `confirmClearKey: true`.
- The first AI request requires `acknowledgeDataDisclosure: true`. Without it, the backend returns `VALIDATION` with `details.kind: 'data-disclosure-required'`.
- Requests go directly to the user's configured provider. The product does not proxy or host inference.
- Prompt content and variable values are sent only to the configured provider and are never written to logs.
- `ai:test` renders the prompt with shared variable rules, sends the request, and streams deltas through `ai:stream`.
- `ai:cancel` stops the stream and records a cancelled result.
- Response content is untrusted Markdown. The renderer must sanitize it before rendering.
- `ai:history` stores model, duration, time, status, and a response preview. It never stores API keys or hidden system prompts beyond the user's own input. `[TBD-BE]` for exact retention.

## 19. Events

### 19.1 Types

```ts
type DomainName =
  | 'prompts'
  | 'contracts'
  | 'skills'
  | 'mcp'
  | 'sync'
  | 'dispatch'
  | 'projections'
  | 'globalTargets'
  | 'settings'
  | 'search'
  | 'ai'

type DomainChangeReason =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'synced'
  | 'reviewed'
  | 'dispatched'
  | 'projected'
  | 'drift'
  | 'reconciled'

interface DomainChangedEvent {
  domain: DomainName
  reason: DomainChangeReason
  ids: string[]
  operationId?: string
  at: IsoTimestamp
}

type OperationType =
  | 'sync_fetch'
  | 'sync_pull'
  | 'sync_push'
  | 'dispatch'
  | 'projection'
  | 'mcp_apply'
  | 'mcp_remove'
  | 'backup'
  | 'restore'
  | 'search_rebuild'
  | 'update_download'
  | 'update_install'
  | 'reset'

interface OperationRef {
  phase: 'started'
  operationId: string
  type: OperationType
  startedAt: IsoTimestamp
}

interface OperationProgressEvent {
  operationId: string
  type: OperationType
  phase: string
  completed: number
  total: number
  message?: string
  cancellable: boolean
  at: IsoTimestamp
}

interface SyncProgressEvent extends OperationProgressEvent {
  repoId: string
  direction?: 'fetch' | 'pull' | 'push'
}

type OperationResult =
  | { type: 'sync_fetch'; incoming: number; outgoing: number; conflicts: number }
  | { type: 'sync_pull'; applied: number; skipped: number; failed: number }
  | {
      type: 'sync_push'
      commit: string | null
      branch: string
      pushed: number
      failed: number
      compareUrl?: string
    }
  | {
      type: 'dispatch'
      result: DispatchOperationResult
    }
  | {
      type: 'projection'
      result: ProjectionOperationResult
    }
  | { type: 'mcp_apply'; result: McpApplyOperationResult }
  | { type: 'mcp_remove'; result: McpRemoveOperationResult }
  | { type: 'backup'; path: string; bytes: number }
  | { type: 'restore'; restored: boolean; safetyBackupPath: string }
  | { type: 'search_rebuild'; indexed: number }
  | { type: 'update_download'; version: string; path: string }
  | { type: 'update_install'; version: string }
  | { type: 'reset'; scope: 'library' | 'all' }

interface OperationCompletedEvent {
  operationId: string
  type: OperationType
  state: 'committed' | 'failed' | 'cancelled'
  result?: OperationResult
  error?: IpcErrorPayload
  at: IsoTimestamp
}

interface UpdateAvailableEvent {
  available: UpdateAvailable
  at: IsoTimestamp
}
```

### 19.2 Delivery rules

- Events are sent to the main window only.
- Events carry IDs and status, never asset bodies, secret values, or full file content.
- Events are emitted after the database transaction commits.
- Burst events are coalesced with a short debounce. A coalesced `domain:changed` event may contain the union of affected IDs.
- Events are hints, not data. The renderer refetches authoritative state through channels.
- There is no event replay. After a reload, `app:bootstrap` and normal queries provide current state.
- `sync:progress` is emitted for sync operations instead of `operation:progress`. `operation:completed` is always emitted.
- Event listener registration happens once in `EventBridge`; feature components do not subscribe directly.

### 19.3 Event-to-invalidations map

| Event | Domains to invalidate |
| --- | --- |
| `domain:changed` with `domain: 'prompts'` | Prompt lists and details; Sync changes and counts |
| `domain:changed` with `domain: 'contracts'` | Contract lists and details; projections; global targets |
| `domain:changed` with `domain: 'skills'` | Skill lists and details; dispatch matrix; Sync changes |
| `domain:changed` with `domain: 'mcp'` | MCP lists and details; dispatch matrix; Sync changes |
| `domain:changed` with `domain: 'sync'` | Sync overview, changes, history; asset sync states |
| `domain:changed` with `domain: 'dispatch'` | Dispatch matrix and detail; asset install summaries |
| `domain:changed` with `domain: 'projections'` | Projection lists; contract lists; global target counts |
| `domain:changed` with `domain: 'globalTargets'` | Global target list; global projections |
| `domain:changed` with `domain: 'settings'` | Settings snapshot; bootstrap counts |
| `domain:changed` with `domain: 'search'` | Search results when not actively typing |
| `operation:progress` / `sync:progress` | Operation panel only; do not refetch lists |
| `operation:completed` | All domains named in the operation type, then refresh counts |
| `update:available` | Update status and Settings Updates section |
| `ai:stream` | AI drawer only |

## 20. Operations, concurrency, and idempotency

### 20.1 Operation lifecycle

- The backend creates an operation record before starting work.
- The channel returns `OperationRef` with `phase: 'started'`.
- Progress events report phase, completed count, total count, and cancellability. A total of `0` means progress is indeterminate.
- Completion reports `committed`, `failed`, or `cancelled` with an optional typed result.
- A cancelled operation is not a rollback of already committed work. The result describes what was committed.
- A failed operation must leave pending sync changes intact and must not report success.
- The operations journal is used for crash recovery. On startup, the backend reconciles interrupted operations before the renderer sees authoritative status.

### 20.2 Locks

- One repository operation at a time.
- One write per target file at a time.
- One write per Agent configuration file at a time.
- One write per projection target file at a time.
- A conflicting request returns `LOCKED` with `details.kind: 'lock'` and the blocking operation ID when available.
- The renderer disables conflicting buttons while an operation is active but does not block navigation.

### 20.3 Revision preconditions

| Operation | Precondition |
| --- | --- |
| Content create | None |
| Content update | `expectedRevisionId` required |
| Version restore | `expectedRevisionId` required |
| Metadata-only update (favorite, enabled, sync policy) | None |
| MCP secret clear | `confirmClearSecrets: true` |
| Projection overwrite drift | `expectedFileHash` and `confirm: true` |
| Push/pull reviewed change | `expectedFingerprints` for every selected change |
| Conflict resolution | `expectedFingerprint` for the change |

### 20.4 Idempotency

- Mutation inputs accept an optional `requestId`.
- When a `requestId` is supplied, the backend records the result and returns the same result for a duplicate request within the retention window.
- The retention window is `[TBD-BE]`.
- `requestId` is required for operations that the renderer may retry automatically after a transport failure: repository connect and update, fetch, pull, push, conflict resolution, batch dispatch, batch projection, MCP apply and remove, backup, restore, reset, search rebuild, update download, and update install.
- A duplicate `requestId` with a different payload returns `VALIDATION`.

### 20.5 Draft and conflict behavior

- Editors keep drafts in renderer state, not in the query cache.
- A `REVISION_CONFLICT` preserves the draft and returns the current revision ID and version.
- The renderer offers compare or reload; it never silently overwrites the newer revision.
- Low-risk metadata such as favorite or pin may be optimistic with rollback. Content mutations are never optimistic.

## 21. Security invariants

### 21.1 Secrets

- The renderer never receives a stored secret value, ciphertext, or encryption key.
- MCP DTOs use `[REDACTED]` with `hasValue: true`.
- Git tokens and AI keys are write-only. They are never returned in any DTO, error detail, log, event, backup manifest, or diagnostic export.
- If `safeStorage` is unavailable, the backend refuses to store secrets and returns a typed error. It never falls back to plaintext.
- Clearing a secret requires explicit confirmation.
- Version history and diffs operate on redacted content.

### 21.2 Filesystem and Git

- The renderer sends asset IDs, target IDs, projection IDs, deployment IDs, and selections. It never sends an arbitrary write path.
- The backend resolves every write path from its own records and verifies that it stays inside an allowed root: library, managed clone, registered project root, global target path, Agent directory, blob store, or backup directory.
- The backend never writes outside configured roots.
- The backend never executes Skill scripts, MCP commands, package managers, or repository hooks.
- Git commands use argument arrays, not shell strings, and never use force, amend, or rebase.
- The backend never deletes a user-provided clone.

### 21.3 Content scanning

- Credential scanning runs before sync push, export, catalog install, and diagnostic export.
- Findings are blocking for push and catalog install.
- The scanner never rewrites content automatically.
- The scanner never sends content to a network service.
- Findings in errors and logs use masked previews.
- The scanner does not block AI requests; the user may intentionally send sensitive context. The UI warns instead. `[TBD-BIZ]`

### 21.4 IPC hardening

- Every handler validates the sender is the main window and that the payload matches the schema.
- Sender validation runs before expensive parsing.
- Payload size limits are enforced before parsing.
- Unknown channels are rejected.
- The renderer is sandboxed with context isolation; it has no Node integration.
- `app:openExternal` accepts HTTPS only and rejects embedded credentials.
- `app:revealPath` accepts structured targets only.

### 21.5 Logging

- Logs contain operation names, IDs, durations, counts, and error codes.
- Logs never contain secret values, full asset bodies, full MCP configuration, or repository URLs with credentials.
- The renderer never logs request or response payloads.
- Audit events are separate from logs and are append-only.

## 22. Renderer integration contract

### 22.1 Typed client

`src/lib/ipc.ts` is the only module that touches `window.promptKeeper`.

```ts
class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly details?: IpcErrorDetails,
    readonly retryable = false,
    readonly traceId?: string,
  ) {
    super(message)
  }
}

async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) {
    const { code, message, details, retryable, traceId } = result.error
    throw new IpcError(code, message, details, retryable, traceId)
  }
  return result.data
}

export const ipc = {
  prompts: {
    list: (query: PromptQuery) => unwrap(window.promptKeeper.prompts.list(query)),
    get: (id: string) => unwrap(window.promptKeeper.prompts.get(id)),
  },
}
```

Rules:

- No feature component calls `window.promptKeeper` directly.
- No retry for `VALIDATION`, `CONFLICT`, `REVISION_CONFLICT`, `SECURITY_BLOCK`, or `UNSUPPORTED`.
- Retry at most once for `LOCKED`, `NETWORK`, and other transient codes.
- Do not log payloads. Log the channel name, error code, and trace ID.
- A rejected invoke is wrapped as `INTERNAL` and shown with a trace ID when available.

### 22.2 Bridge shape

```ts
interface PromptKeeperBridge {
  app: {
    bootstrap(): Promise<IpcResult<BootstrapSnapshot>>
    theme(input: { theme: ThemeMode }): Promise<IpcResult<ThemeUpdateResult>>
    openExternal(input: { url: string }): Promise<IpcResult<void>>
    revealPath(input: { target: RevealTarget }): Promise<IpcResult<void>>
  }
  prompts: {
    list(query: PromptQuery): Promise<IpcResult<AssetListResult<PromptListItem>>>
    get(id: string): Promise<IpcResult<PromptDetail>>
    versions(id: string): Promise<IpcResult<RevisionSummary[]>>
  }
  events: {
    onDomainChanged(listener: (event: DomainChangedEvent) => void): () => void
    onOperationProgress(listener: (event: OperationProgressEvent) => void): () => void
    onOperationCompleted(listener: (event: OperationCompletedEvent) => void): () => void
    onSyncProgress(listener: (event: SyncProgressEvent) => void): () => void
    onUpdateAvailable(listener: (event: UpdateAvailableEvent) => void): () => void
    onAiStream(listener: (event: AiStreamEvent) => void): () => void
  }
}
```

- The bridge contains every namespace in the channel catalog, generated from the same source. The example is shortened.
- Except for the renames listed in section 2.2, the method path is the channel split on `:`. For example, `sync:repoGet` is `window.promptKeeper.sync.repoGet` and `projections:overwriteDrift` is `window.promptKeeper.projections.overwriteDrift`.
- No namespace, method, or event is added by hand outside the shared contract module.

### 22.3 Query keys

| Domain | Keys |
| --- | --- |
| Prompts | `['prompts','list',query]`, `['prompts','detail',id]`, `['prompts','versions',id]`, `['prompts','folders',query]` |
| Contracts | `['contracts','list',query]`, `['contracts','detail',id]`, `['contracts','versions',id]`, `['contracts','resolution',input]`, `['contracts','compiled',input]` |
| Projections | `['projections','list',query]`, `['globalProjections','list',query]`, `['globalTargets','list']` |
| Skills | `['skills','list',query]`, `['skills','detail',id]`, `['skills','versions',id]`, `['skills','files',input]` |
| MCP | `['mcp','list',query]`, `['mcp','detail',id]`, `['mcp','versions',id]`, `['mcp','health',id]` |
| Sync | `['sync','repo']`, `['sync','changes',query]`, `['sync','change',id]`, `['sync','history',query]` |
| Dispatch | `['dispatch','matrix',query]`, `['dispatch','detail',assetId]` |
| Search | `['search',query]` |
| Settings | `['settings']`, `['settings','updates']` |
| AI | `['ai','providers']`, `['ai','history',query]` |

Rules:

- Filters are part of the key.
- Lists and details are separate.
- Derived previews such as resolution and compiled files are separate queries so they can be invalidated independently.
- Events invalidate the smallest affected key set listed in section 19.3.

### 22.4 Query defaults

| Setting | Value |
| --- | --- |
| `staleTime` | 30 seconds for lists, 5 minutes for static registries |
| `gcTime` | 5 minutes |
| `retry` | 1 for transient errors, 0 for validation and conflicts |
| `refetchOnWindowFocus` | false |
| `refetchOnReconnect` | false |
| `placeholderData` | Previous list data where appropriate |

### 22.5 Long-running operations in the UI

- Starting an operation opens or updates a persistent operation strip.
- Progress events update phase, counts, and cancellability.
- Completion triggers a refetch of affected domains and shows a result summary.
- Closing a dialog does not cancel a committed operation.
- A `LOCKED` response explains which operation is blocking and offers to open its panel.

## 23. Contract tests

The shared contract module must include automated checks. The repository currently has no test runner; adding one requires explicit approval. The following tests are required before the desktop migration is considered complete.

| Test | Requirement |
| --- | --- |
| Request schema tests | Every channel has a schema; unknown fields are rejected; required fields produce field-level errors |
| Response schema tests | Every channel response matches its DTO in development and test builds |
| Error mapping tests | Service errors map to the documented codes, details, and retryable flags |
| Redaction tests | MCP, Git, and AI responses never contain a sentinel secret or ciphertext |
| Secret leak tests | Logs, events, audit records, and diagnostics never contain sentinel secrets |
| Path validation tests | Write paths outside allowed roots are rejected |
| Revision conflict tests | Stale `expectedRevisionId` returns `REVISION_CONFLICT` and does not write |
| Idempotency tests | Duplicate `requestId` returns the same result; changed payload returns `VALIDATION` |
| Review invalidation tests | Changed remote fingerprint invalidates review and blocks pull |
| Drift tests | Bulk projection and dispatch exclude drifted items; item-level overwrite requires confirmation |
| Preview token tests | Expired or mismatched tokens are rejected; preview and write use the same compiler |
| Event schema tests | Every event payload matches its DTO and contains no content |
| Canonical file tests | Serialize/parse round trips produce stable bytes for Prompts, Contracts, Skills, and MCP |
| Channel catalog drift test | The preload bridge and channel types contain exactly the catalog entries; no aliases |

## 24. Open questions

| ID | Question | Status | Owner and phase |
| --- | --- | --- | --- |
| API-01 | How does a user register, select, and remove project roots? | `[TBD-UX]` | Design and product before INS-007 |
| API-02 | What are the exact request and response payload caps? | `[TBD-BE]` | Backend before M1 |
| API-03 | What is the preview token lifetime and binding algorithm? | `[TBD-BE]` | Backend and security before M2 |
| API-04 | How long are idempotency results retained? | `[TBD-BE]` | Backend before M2 |
| API-05 | Are imported Skill symlinks ever accepted after review? | `[TBD-BE]` | Backend and security before SKL-010 |
| API-06 | Which AI providers are supported, and what is the adapter capability matrix? | `[TBD-BE]` | Backend before P1 AI |
| API-07 | Which Git credential helper and token storage flow is used? | `[TBD-BE]` | Backend and product before SYN-001 |
| API-08 | How are events targeted if multiple windows are allowed? | `[TBD-BE]` | Backend before any multi-window decision |
| API-09 | What exactly does `settings:reset` delete for each scope? | `[TBD-BE]` | Backend and product before SET-005 |
| API-10 | Do equal Contract priorities need a user-visible tie-break control? | `[ASSUMPTION]` | Deterministic order is defined; product to confirm |
| API-11 | Is `BootstrapSnapshot.activeOperations` sufficient after a renderer reload, or is an operation query channel needed? | `[TBD-BE]` | Backend before M2 |
| API-12 | Does the exact package layout use `shared/contracts` or generated types from this document? | `[TBD-BE]` | Architecture before M1 |
| API-13 | Should repository clone and connect be promoted to an operation? The backend operation types do not include them. | `[TBD-BE]` | Backend before SYN-001 |

## 25. Traceability

| Contract section | Source |
| --- | --- |
| Envelope and error codes | Backend design section 4.1-4.2; frontend design section 5.1 |
| Channel catalog | Backend design section 4.3; frontend design sections 5.1 and 9 |
| Prompt contract | PRD PRM-001 to PRM-013; backend design section 5.2; frontend design section 9.1 |
| Contract and target contract | PRD INS-001 to INS-018; backend design sections 5.3 and 11; frontend design section 9.2 |
| Projection contract | PRD INS-006 to INS-016; backend design sections 5.9 and 11.4-11.6 |
| Skill contract | PRD SKL-001 to SKL-015; backend design sections 5.4 and 10.2; frontend design section 9.3 |
| MCP contract | PRD MCP-001 to MCP-015; backend design sections 5.5, 10.3, and 12; frontend design section 9.4 |
| Sync contract | PRD SYN-001 to SYN-017; backend design sections 5.7 and 9; frontend design section 9.5 |
| Dispatch contract | Backend design sections 5.8 and 10.1-10.4; frontend design section 9.5 |
| Search contract | Backend design section 14; frontend design section 9.7 |
| Settings and data contract | PRD SET-001 to SET-011; backend design sections 5.13-5.15 and 16 |
| AI contract | PRD AI-001 to AI-004 and SET-010; backend design section 5.16 |
| Security invariants | Backend design section 18; architecture sections 9-10; PRD section 8.3 |
| Event model | Backend design section 4.5; frontend design section 5.5 |
| Concurrency and idempotency | Backend design sections 4.4 and 8.1; frontend design sections 5.4-5.7 |
| Operation model | Backend design sections 3.4 and 5.7; frontend design section 5.6 |

## 26. Change log

| Date | Change |
| --- | --- |
| 2026-11-19 | Initial contract draft. Adds missing version, restore-version, favorite, target registry, change-detail, global projection action, reverse import, reset, AI provider, and prompt catalog channels. Resolves frontend and backend naming differences. |
