# Prompt Keeper Frontend Technical Design

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Frontend Technical Design |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; pending frontend and design review |
| Runtime | Electron renderer process |
| UI stack | React 19 + TypeScript + Tailwind CSS v4 + CodeMirror 6 |
| Primary audience | Frontend engineers, design, QA, accessibility review |
| Related documents | [`docs/prd.md`](./prd.md), [`docs/architecture.md`](./architecture.md), [`docs/tech-stack.md`](./tech-stack.md), [`docs/backend-design.md`](./backend-design.md), [`docs/interaction-design.md`](./interaction-design.md) |
| Annotation rules | `[FACT]`, `[ASSUMPTION]`, `[TBD-UX]`, `[TBD-FE]`, `[TBD-BE]`, `[TBD-INFRA]` |

## Document status

This document describes the **target Electron renderer**. The current repository is still a browser prototype with a single React context store and localStorage persistence. The prototype's components, design tokens, and interaction patterns are the starting point, but its state architecture will be replaced during migration.

The prototype rules in [`AGENTS.md`](../AGENTS.md) remain in force until the migration is approved. This document does not authorize changing the prototype now.

## 1. Scope and responsibilities

The renderer owns:

- The application shell and navigation.
- All visual presentation and interaction states.
- Form state, client-side validation, and draft content.
- Presentation-level derivation: sorting labels, grouping, formatting, diff summaries returned by the backend.
- Preview rendering of compiled content using shared pure domain modules.
- Accessibility and keyboard operation.

The renderer does **not** own:

- Asset persistence.
- Filesystem, Git, or Agent directory access.
- Secret storage or retrieval.
- Credential scanning as an authoritative gate.
- Sync state machines or conflict resolution decisions.
- Any write that is not mediated by the main process.

## 2. Frontend architecture overview

```text
+---------------------------------------------------------------+
| Renderer                                                      |
|                                                               |
|  App shell (sidebar, topbar, workspace host, dialogs, toasts) |
|                                                               |
|  Features                                                     |
|    prompts | instructions | skills | mcp | sync | settings    |
|                                                               |
|  Shared UI                                                    |
|    folder tree | markdown | code editor | diff | merge         |
|    dialogs | forms | badges | empty states                    |
|                                                               |
|  Data layer                                                   |
|    typed IPC client                                           |
|    TanStack Query cache and mutations                         |
|    domain event bridge                                        |
|                                                               |
|  UI state                                                     |
|    feature contexts and reducers                              |
+---------------------------------------------------------------+
                              |
                     window.promptKeeper (preload)
```

### 2.1 Rendering model

- Single window, single React root.
- Fixed workspace navigation; no URL router.
- Each workspace is lazily loaded and kept mounted only while active, unless preserving a draft requires keeping it alive.
- Dialogs, drawers, and wizards are rendered through a portal layer at the app root.
- Toasts are global and non-blocking.
- Error boundaries are scoped per workspace so one failure does not blank the whole app.

### 2.2 Why no router

- The desktop app has a fixed information architecture.
- There are no shareable URLs or browser history requirements in the MVP.
- Workspace and tab state belong to the app, not to a URL.
- Avoiding a router removes an unnecessary dependency and edge cases around reload and deep links.
- If deep links are added later, they become an explicit navigation API with a small route table.

## 3. Folder structure

```text
src/renderer/
  main.tsx
  App.tsx
  app/
    AppShell.tsx
    WorkspaceHost.tsx
    ErrorBoundary.tsx
    NavigationContext.tsx
    ThemeProvider.tsx
    QueryProvider.tsx
    EventBridge.tsx
    ToastProvider.tsx
    DialogProvider.tsx
  components/
    layout/
      Sidebar.tsx
      Topbar.tsx
      GlobalSearch.tsx
      RepoStatusBadge.tsx
    ui/
      Button.tsx
      Input.tsx
      Select.tsx
      Dialog.tsx
      Drawer.tsx
      Tabs.tsx
      Toast.tsx
      Badge.tsx
      Tooltip.tsx
      Switch.tsx
      Checkbox.tsx
      RadioGroup.tsx
      Skeleton.tsx
      EmptyState.tsx
      Progress.tsx
    shared/
      FolderTree.tsx
      FolderInput.tsx
      RepoPathLabel.tsx
      Markdown.tsx
      CodeEditor.tsx
      DiffView.tsx
      MergeView.tsx
      VariableForm.tsx
      StatusBadge.tsx
      TargetCard.tsx
      DriftBanner.tsx
      ConfirmDialog.tsx
      ReviewCheckbox.tsx
      DataTable.tsx
      CommandPalette.tsx
  features/
    prompts/
      PromptsWorkspace.tsx
      PromptList.tsx
      PromptDetail.tsx
      PromptEditorDialog.tsx
      PromptCopyDialog.tsx
      PromptSyncDialog.tsx
      AiTestDrawer.tsx
      PlatformDiscovery.tsx
      queries.ts
      state.tsx
    instructions/
      InstructionsWorkspace.tsx
      ContractList.tsx
      ContractDetail.tsx
      ContractEditorDialog.tsx
      ResolutionPreview.tsx
      ProjectionTable.tsx
      GlobalDispatch.tsx
      GlobalTargetCard.tsx
      queries.ts
      state.tsx
    skills/
      SkillsWorkspace.tsx
      SkillGrid.tsx
      SkillDetail.tsx
      SkillEditorDialog.tsx
      InstallReviewWizard.tsx
      SkillStore.tsx
      queries.ts
    mcp/
      McpWorkspace.tsx
      McpList.tsx
      McpDetail.tsx
      McpEditorDialog.tsx
      ApplyToAgentsDialog.tsx
      AgentMcpTab.tsx
      McpStore.tsx
      queries.ts
    sync/
      SyncWorkspace.tsx
      SyncOverview.tsx
      SyncChanges.tsx
      ChangeReviewDialog.tsx
      ConflictDialog.tsx
      PushDialog.tsx
      DispatchMatrix.tsx
      DispatchDetailDialog.tsx
      SyncHistory.tsx
      queries.ts
    settings/
      SettingsWorkspace.tsx
      AppearanceSection.tsx
      RepositorySection.tsx
      GlobalTargetsSection.tsx
      DataSection.tsx
      PrivacySection.tsx
      UpdateSection.tsx
      AboutSection.tsx
      queries.ts
    search/
      SearchResults.tsx
      useGlobalSearch.ts
    onboarding/
      OnboardingFlow.tsx
  hooks/
    useIpcQuery.ts
    useIpcMutation.ts
    useDebouncedValue.ts
    useKeyboardShortcuts.ts
    useFocusTrap.ts
    useCopyToClipboard.ts
    useResizeObserver.ts
  lib/
    ipc.ts
    queryKeys.ts
    errors.ts
    format.ts
    cn.ts
    icons.tsx
  styles/
    tokens.css
    globals.css
```

Rules:

- Feature folders do not import from other feature folders. Shared behavior moves to `components/shared` or `hooks`.
- Only `lib/ipc.ts` calls `window.promptKeeper`.
- Query keys live in one module to prevent collisions.
- UI primitives have no domain knowledge.
- Shared domain logic comes from `src/shared/domain`, not from a renderer copy.

## 4. App shell

### 4.1 Layout

```text
+----------+------------------------------------------------------------+
| Sidebar  | Topbar: breadcrumb | global search | repo status | theme   |
|          +------------------------------------------------------------+
| Prompts  |                                                            |
| Instr.   |  Workspace content                                         |
| Skills   |                                                            |
| MCP      |                                                            |
| Sync     |                                                            |
| Settings |                                                            |
+----------+------------------------------------------------------------+
```

- Sidebar width: 220-232 px, collapsible to an icon rail.
- Topbar height: 56-60 px.
- Content area uses the full remaining height and manages its own scroll.
- The shell owns the single scrollbar per pane; nested page scrollbars are avoided unless a table or editor requires one.
- Floating layers: toasts bottom-right, dialogs centered, drawers right, command palette centered.

### 4.2 Navigation state

```ts
interface NavigationState {
  workspace: 'prompts' | 'instructions' | 'skills' | 'mcp' | 'sync' | 'settings'
  tab: string
  selectedIds: Record<string, string | null>
  returnTo: NavigationSnapshot | null
}
```

Requirements:

- Navigation survives a renderer reload by persisting the last workspace and tab in settings.
- Deep-linking from search or the topbar sets the workspace, tab, and selected item in one action.
- Unsaved draft navigation prompts a confirmation.
- The sidebar shows counts for actionable states, not vanity totals.

### 4.3 Keyboard map

| Key | Action |
| --- | --- |
| `/` | Focus global search |
| `N` | Create an asset in the current domain |
| `Esc` | Close the topmost overlay or exit inline editing |
| Cmd/Ctrl+Enter | Submit the active dialog |
| Cmd/Ctrl+S | Save the active editor when the save action is explicit |
| Cmd/Ctrl+K | Open command palette (P1) |
| Arrow keys | Navigate lists and folder trees |
| Enter | Open the selected item |

Shortcuts are registered through one registry so they can be displayed in menus and disabled inside editable fields except for explicit save and escape behavior.

## 5. Data layer

### 5.1 Typed IPC client

The client method names and payload types are defined by [`docs/api-contract.md`](./api-contract.md). This document describes renderer usage. Where a method name differs, the API contract wins; for example, the contract uses `prompts.get` rather than `prompts.detail`.

`lib/ipc.ts` wraps the preload API:

```ts
async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new IpcError(result.error.code, result.error.message, result.error.details)
  return result.data
}

export const ipc = {
  prompts: {
    list: (query: PromptQuery) => unwrap(window.promptKeeper.prompts.list(query)),
    get: (id: string) => unwrap(window.promptKeeper.prompts.get(id)),
    // ...
  },
}
```

Rules:

- Never call `window.promptKeeper` outside this module.
- Translate error codes into typed `IpcError` instances.
- Do not retry validation or conflict errors.
- Do not log payloads; log only operation names and error codes.

### 5.2 Query keys

```ts
export const queryKeys = {
  prompts: {
    all: ['prompts'] as const,
    list: (query: PromptQuery) => ['prompts', 'list', query] as const,
    detail: (id: string) => ['prompts', 'detail', id] as const,
    versions: (id: string) => ['prompts', 'versions', id] as const,
  },
  contracts: {
    all: ['contracts'] as const,
    list: (query: ContractQuery) => ['contracts', 'list', query] as const,
    detail: (id: string) => ['contracts', 'detail', id] as const,
    resolution: (input: ResolutionInput) => ['contracts', 'resolution', input] as const,
  },
  // skills, mcp, sync, dispatch, projections, settings, search
}
```

Rules:

- Keys are serializable and stable.
- Filters are part of the key.
- Lists and details are separate.
- Derived views (resolution preview, compiled files) are separate queries so they can be invalidated independently.

### 5.3 Query defaults

| Setting | Value | Rationale |
| --- | --- | --- |
| `staleTime` | 30 seconds for lists, 5 minutes for static registries | Local data changes through explicit events |
| `gcTime` | 5 minutes | Bound memory |
| `retry` | 1 for transient errors, 0 for validation/conflict | Avoid duplicate writes and noisy failures |
| `refetchOnWindowFocus` | false | Local app; event-driven invalidation is more accurate |
| `refetchOnReconnect` | false | No renderer network |
| `placeholderData` | Previous list data where appropriate | Avoid layout jumps during filter changes |

### 5.4 Mutations

- Each mutation calls the typed IPC method and invalidates the smallest affected key set.
- Content mutations are not optimistic. The main process may reject them, and the resulting revision must be authoritative.
- Low-risk UI preferences such as favorite or pinned may be optimistic with rollback.
- A successful mutation shows a toast only when the result is not visible in place.
- A mutation that affects multiple domains invalidates each affected domain explicitly.

Example:

```ts
const savePrompt = useMutation({
  mutationFn: (input: PromptUpdateInput) => ipc.prompts.update(input.id, input),
  onSuccess: (detail) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.prompts.detail(detail.id) })
    queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.sync.all })
  },
})
```

### 5.5 Event-driven invalidation

The main process emits `domain:changed` events. `EventBridge` maps them to invalidation:

```ts
const invalidationMap = {
  prompts: [queryKeys.prompts.all],
  contracts: [queryKeys.contracts.all],
  skills: [queryKeys.skills.all],
  mcp: [queryKeys.mcp.all],
  sync: [queryKeys.sync.all, queryKeys.dispatch.all],
  projections: [queryKeys.contracts.all, queryKeys.projections.all],
  settings: [queryKeys.settings.all],
}
```

Rules:

- Events are hints, not data payloads. The renderer always refetches authoritative state.
- Burst events are coalesced with a short debounce.
- Events include affected IDs so detail queries can be invalidated precisely.
- If the renderer misses an event, a manual refresh and route change still refetch stale data.

### 5.6 Long-running operations

- Sync, dispatch, projection, migration, and backup operations return an operation ID.
- Progress arrives as `sync:progress` or `operation:progress` events.
- The UI shows an operation panel with phase, counts, cancellation, and a result summary.
- The app blocks conflicting operations in the same domain but does not block navigation.
- Closing a dialog does not cancel a committed operation; the operation continues and the result is shown in the Sync workspace and history.

### 5.7 Draft state

- Editors keep draft text in component or feature state, not in the query cache.
- Navigating away with unsaved changes prompts before discarding.
- A draft is never written to SQLite until the user saves.
- If the main process reports a revision conflict on save, the draft is preserved and the user can compare or reload.

## 6. State management

### 6.1 Three kinds of state

| Kind | Owner | Examples | Persistence |
| --- | --- | --- | --- |
| Server state | Main process and SQLite | Assets, versions, sync changes, deployments, projections | Durable |
| Query cache | TanStack Query | Read-only copies of server state | Memory |
| UI state | React context and reducers | Selected folder, filters, open dialog, active tab | Some persisted as settings |
| Form state | react-hook-form | Field values, touched, errors | Memory until save |

### 6.2 Feature state

Each workspace that needs cross-component UI state uses a small reducer context:

```ts
interface PromptUiState {
  selectedFolder: string | null
  query: string
  tags: string[]
  favoritesOnly: boolean
  sort: 'updated' | 'created' | 'title' | 'usage'
  view: 'cards' | 'table'
  selectedId: string | null
}
```

Rules:

- Feature state is not a copy of server data.
- Persisted preferences (view mode, sort, theme) are stored through the settings service.
- Derived lists are computed with `useMemo` and stable comparators.
- Context providers are scoped to the workspace, not the whole app, when possible.

### 6.3 Form state

Use react-hook-form with a Zod resolver for complex forms:

- Prompt editor.
- Contract editor.
- MCP editor.
- Repository connection wizard.
- Global target path editor.
- Push and conflict dialogs where structured input is required.

Simple inline fields may use controlled state. Do not build a second form abstraction.

### 6.4 Validation strategy

| Layer | Responsibility |
| --- | --- |
| Field | Format, required, length, pattern; immediate feedback |
| Form | Cross-field rules, for example at least one Prompt body section |
| Shared schema | Same rules used by IPC and persistence |
| Main process | Authoritative validation, path safety, revision checks |
| Server response | Map field-level errors back to the form when possible |

Client validation improves responsiveness but never substitutes for main-process validation.

## 7. Design system

### 7.1 Tokens

The high-fidelity prototype defines the visual language. The target keeps the same semantic tokens:

```css
:root {
  --primary: #4f46e5;
  --primary-soft: #eef0ff;
  --bg: #f5f6fb;
  --card: #ffffff;
  --border: #e5e8ef;
  --fg: #0e1525;
  --muted-fg: #667085;
  --success: ...;
  --warning: ...;
  --danger: ...;
  --info: ...;
}

[data-theme='dark'] {
  --bg: #090f1a;
  --card: #111a2b;
  --primary: #7d7aff;
  --border: #22314a;
  --fg: ...;
  --muted-fg: ...;
}
```

Tailwind v4 maps tokens through `@theme`:

```css
@theme {
  --color-background: var(--bg);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-foreground: var(--fg);
  --color-muted-foreground: var(--muted-fg);
  --color-primary: var(--primary);
}
```

Rules:

- Components use semantic utilities (`bg-card`, `text-muted-foreground`, `border-border`), not raw hex values.
- Status colors have one meaning each: success, warning, danger, info.
- A status badge always includes text or an icon, not color alone.
- No parallel color system is introduced for a feature.

### 7.2 Typography and density

- Base font size: 13.5 px.
- Body text: 12-13 px; auxiliary text: 10-11 px; code: 11-12 px.
- `font-variant-numeric: tabular-nums` for counts, versions, and timestamps.
- Line height: 1.45 for body, 1.3 for dense tables.
- Card radius: 10-12 px; dialog radius: 14-16 px.
- Spacing scale: 4, 6, 8, 10, 14, 16, 20, 24.
- Avoid oversized marketing typography inside the app.

### 7.3 Theming

- Theme preference: light, dark, system.
- The main process knows the persisted preference before creating the window and sets the window background color to avoid a white flash.
- Preload exposes one bootstrapped theme value synchronously for the first paint. This is the only synchronous IPC read allowed.
- Theme changes apply by setting `data-theme` on the root element and updating the window background color through a small IPC call.
- System theme changes are observed with `matchMedia` and applied when the preference is `system`.
- CodeMirror and diff themes derive from the same token values.

### 7.4 Motion

- Standard durations: 120-200 ms for small state changes, 200-250 ms for overlays.
- Easing: ease-out for entering, ease-in for leaving.
- No layout-shifting animation on lists.
- All non-essential motion is disabled under `prefers-reduced-motion`.
- Progress indicators use determinate bars when counts are known, indeterminate spinners otherwise.

### 7.5 Desktop density and responsive behavior

- Minimum supported window: 1024 x 700.
- Sidebar collapses to an icon rail below 1120 px.
- Folder tree collapses below 960 px and becomes a filter drawer.
- List-detail becomes list-first with a full-height detail sheet below 900 px.
- Tables switch to a compact card list below 800 px.
- Dialogs max out at 90% of the window and scroll their body, not the page.

## 8. Shared components

### 8.1 Folder tree

Requirements:

- Nested folders with per-level counts.
- Selecting a parent includes descendants.
- Fixed entries: All and Uncategorized.
- Expand and collapse with keyboard support.
- Inline path echo: "Folders map 1:1 to repository directories."
- Virtualized rendering for large trees.
- Drag and drop is deferred; moving a folder is done through the editor in the MVP.

Data:

```ts
interface FolderNode {
  path: string
  label: string
  depth: number
  count: number
  children: FolderNode[]
}
```

The tree is built from the list query result or a dedicated aggregate query. For large libraries, use a dedicated `folders:tree` IPC query rather than deriving from all assets.

### 8.2 Repository path label

- Displays the full path with middle truncation.
- Keeps the file name visible.
- Copy action with toast.
- Optional monospace styling.
- Tooltip shows the full path.

### 8.3 Markdown renderer

- Uses `react-markdown`, `remark-gfm`, and `rehype-sanitize`.
- Raw HTML is disabled.
- Links are rendered as buttons or anchors with a click handler that asks the main process to open the URL externally after confirmation.
- Images from remote URLs are blocked; local asset images require a dedicated protocol and are P1.
- Code blocks are rendered without executing anything; syntax highlighting is optional and lazy.
- Large documents are memoized by content hash.
- The sanitize schema allows tables, task lists, headings, code, and safe links; it denies scripts, iframes, objects, event handlers, and `javascript:` URLs.

### 8.4 Code editor

- CodeMirror 6 with Markdown, JSON, JSONC, and TOML language support.
- Theme derived from app tokens.
- Line wrapping for prose, no wrapping for structured config.
- Search and replace built in.
- JSON validation for MCP editing; errors are shown as diagnostics, not blocking toasts.
- Editor content is a controlled draft; save is explicit.
- Read-only mode for compiled previews and version history.
- Merge view for conflict resolution uses `@codemirror/merge`.

### 8.5 Diff view

- Unified and split modes.
- Line numbers, additions, deletions, and context.
- Word-level highlight for modified lines where practical.
- Collapsible unchanged regions for large diffs.
- Copy action for the full content.
- No color-only meaning; additions and deletions use prefixes or icons.

### 8.6 Variable form

- Supported types: text, textarea, number, select.
- Required validation.
- Example values are shown as placeholders.
- Textarea fields expand for long content.
- Values are kept in memory for the copy flow and never persisted to the asset or repository.
- Optional 30-day local memory for convenience is a settings item `[TBD-UX]`.

### 8.7 Confirmation dialog

- Title states the action.
- Body states the object, target path, and consequence.
- Primary button uses destructive styling only for destructive actions.
- High-risk reviews require a checkbox before enabling the primary action.
- The dialog traps focus and restores it on close.

### 8.8 Status badges

A shared badge component maps domain statuses to consistent labels:

| Domain status | Label | Tone |
| --- | --- | --- |
| `in-sync` / `synced` | Synced | Success |
| `remote-ahead` | Repository updated | Info |
| `local-ahead` | Local unpushed | Warning |
| `diverged` | Conflict | Danger |
| `blocked` | Push blocked | Danger |
| `ignored` | Local only | Neutral |
| `stale` | Stale | Warning |
| `drifted` | Drifted | Danger |
| `missing` | Not deployed | Neutral |
| `unsupported` | Unsupported | Outline |

### 8.9 Empty and error states

Each state has:

- A title that names the condition.
- A one-sentence explanation of the cause.
- A primary action that resolves it.
- A secondary action only when it helps.

Examples:

- No assets: "No Prompts yet" plus "Create Prompt".
- Filtered empty: "No matches for these filters" plus "Clear filters".
- Repository not connected: "Connect a repository to sync changes" plus "Connect repository".
- No conflicts: "Conflicts appear only when both sides changed the same file."
- Drift filter empty: "No target files have been modified by hand."

### 8.10 Toasts

- Success: auto-dismiss after 2.5 seconds.
- Error: persists until dismissed or 8 seconds, with a details action.
- Warning: 5 seconds.
- Stacked bottom-right, maximum three visible.
- Announce through `aria-live="polite"` for success and `assertive` for errors.

## 9. Feature design

### 9.1 Prompts

**Queries**

- `prompts.list(query)`: filter, search, sort, favorite, folder.
- `prompts.detail(id)`: full content, variables, versions summary, sync status.
- `prompts.versions(id)`.
- `prompts.folders()` for the tree.
- `prompts.copyRender(id, values)` for the final copy text.

**Mutations**

- `create`, `update`, `delete`, `toggleFavorite`, `setSyncPolicy`, `restoreVersion`.

**Key UI flows**

1. List -> select Prompt -> detail.
2. Copy -> variable form -> render -> clipboard.
3. Edit -> dialog or inline -> save -> revision -> optional pending push.
4. Version history -> compare -> restore -> confirmation.
5. Sync scope -> choose policy -> warn on withdrawal.
6. AI test -> drawer -> provider selection -> stream -> history (P1).

**Performance**

- Grouped cards can produce many DOM nodes. Render a flat virtualized list with sticky group headers.
- Table view uses the same query and virtualization.
- Body previews are truncated before rendering Markdown; do not render full Markdown for every card.
- Search uses the main-process FTS index; the renderer does not filter the full dataset in memory.

**Edge cases**

- Duplicate title is allowed; duplicate slug in the same folder is not.
- A Prompt with no body sections cannot be saved.
- A deleted remote Prompt reappearing after pull is explained.
- A credential-blocked Prompt shows the replacement workflow, not a generic error.

### 9.2 Agent Instructions

**Tabs**

1. Contract library.
2. Resolution preview.
3. Projections and drift.
4. Global dispatch.

**Queries**

- `contracts.list`, `contracts.detail`, `contracts.versions`.
- `targets.list`: project and global target registries with capabilities.
- `contracts.resolve(input)`: included, skipped, bytes, warnings, compiled files.
- `projections.list(filter)`.
- `globalTargets.list()`.
- `globalProjections.list(filter)`.

**Mutations**

- Contract CRUD, sync policy, restore.
- Project, re-project, remove, overwrite drift, rollback.
- Global target path update, restore default.
- Global batch project.

**Resolution preview UI**

```text
[Target: Cursor v] [Path: src/components/PromptDetail.tsx v]

Included (3)                          Budget: 8.4 KB / 32 KB
  1. Repository Conventions   2.1 KB  Project, always on
  2. Frontend Code Standards  3.2 KB  Path scope, glob matched
  3. API Error Handling       3.1 KB  Path scope, glob matched

Skipped (2)
  - Release Checklist         Path scope does not match
  - Model Style Guide         Target does not support model decision

Warnings
  - Total context exceeds the target budget by 1.2 KB

[Compiled files: AGENTS.md | .cursor/rules/frontend.mdc | ...]
```

Requirements:

- Byte budget bar is visible and updates on target/path change.
- Skip reasons are specific, not "not applicable."
- Compiled files are read-only CodeMirror views with copy.
- The approximation notice is persistent.
- Sample paths are selectable from known project files and free-form input.

**Contract editor**

- Sections: identity, scope, activation, targets, imports, body, tags, sync.
- Target multi-select shows capability icons and incompatibility warnings before save.
- Activation form switches fields by mode.
- Path scope shows a directory prefix input.
- Imports are one per line with validation.
- Body uses CodeMirror Markdown with a preview tab.
- Save is blocked only for validation errors; incompatible targets are a warning with an explicit confirmation.

**Projection table**

- Columns: contract, target, target path, status, deployed version, time, actions.
- Status filter and drift-only filter.
- Row actions: preview, re-project, overwrite drift, remove, roll back.
- Bulk action: "Sync all stale" with a result summary that names skipped drifted items.
- Orphan records show a "Deleted contract" label and limited actions.

**Global dispatch**

- Target configuration cards at the top with path input, default path, detected state, and projection count.
- Instruction selection list with folder filter and search.
- Action bar: "X selected x Y targets", incompatible count, drifted count.
- Preview shows final files per target; single-file targets show the full merged file, per-contract targets show file tabs.
- Result dialog: projected, skipped, drifted not overwritten, failed.

**Edge cases**

- A target file missing at projection time is created with a generation marker.
- A path change invalidates status to stale; no automatic writes.
- A deleted contract leaves an orphan projection.
- An unsupported activation mode disables projection with an explanation.

### 9.3 Skills

**Queries**

- `skills.list`, `skills.detail`, `skills.versions`.
- `skills.files(assetId, revisionId)`.
- `skills.store.list` (P1).
- `dispatch.skillStatus(assetId)`.

**Mutations**

- CRUD, import, restore.
- Install to targets, remove, rollback.

**List and detail**

- Grid cards grouped by folder; virtualize rows of cards rather than every card.
- Card: icon, name, one-line description, version, platform icons, source badge, pending push badge.
- Detail: file tree, SKILL.md rendered, metadata, dispatch panel.
- File tree shows text and binary files; text files open in a read-only or editable editor depending on type.

**Install review wizard**

1. Content review: rendered SKILL.md, file list, sizes, risk badges, trust checkbox.
2. Targets and mode: Agent multi-select, symlink or copy, explanation of each mode.
3. Result: per-target progress and outcome, failures with reasons.

**Drift and status**

- The dispatch panel shows status per Agent.
- A drifted item has a "Review drift" action, not a one-click overwrite.
- Disabled or unsupported targets show why.

### 9.4 MCP

**Queries**

- `mcp.list`, `mcp.detail`, `mcp.versions`.
- `mcp.health(id)`.
- `mcp.agentState()` for reverse import.
- `mcp.store.list` (P1).

**Mutations**

- CRUD, enable/disable, favorite, restore.
- Apply to targets, remove, rollback.

**Detail layout**

1. Configuration: redacted JSON preview, copy, edit.
2. Health: issues with severity, field, and plain-language explanation.
3. Versions: shared version dialog.

**Editor**

Three modes:

- From source: command, URL, or path; detect type and prefill.
- Paste config: JSON or TOML; parse and preview.
- Manual: transport-specific fields.

Secret fields:

- Masked input with a reveal toggle for the value being typed only.
- Existing secrets show `[REDACTED]` with a "Replace" action; the stored value is never populated into the input.
- Clearing a secret requires explicit confirmation.
- Save sends only the new value; unchanged fields are not sent.

**Apply to Agents**

- Target cards show current state: not created, synced, externally modified, conflict.
- Preview is redacted and shows the exact projected structure with secret values replaced by placeholders.
- A persistent notice explains that the target Agent configuration will contain the real value at rest.
- Result is per target with failure details.

### 9.5 Sync

**Tabs**

- Overview.
- Changes (incoming, outgoing, conflicts).
- Dispatch matrix.
- History.

**Overview**

- Repository card: name, branch, local path, last fetch, last merge, ahead/behind, auth mode.
- Four policy cards: Skills, MCP, Prompts, Instructions, each with pending and local-only counts.
- Security block banner when plaintext credentials exist.
- Stats: incoming, outgoing, conflicts, dispatch pending.
- Detected Agents with status and pending counts.
- Recent events.

**Changes**

- Incoming rows: type, name, change, version, path, line counts, risk, actions.
- Outgoing rows: selectable, push action, blocked state.
- Conflict rows: three-way comparison action.
- Batch selection rules are encoded in the UI: Prompts and Contracts have no bulk checkbox; new or script Skills have no bulk checkbox.
- Review dialogs show full text or diff and require the confirmation checkbox.
- Credential handling dialog shows location and replacement, never the full secret.

**Conflict dialog**

- Three cards for remote, local, base.
- Strategy selector: take repository, keep local, manual merge.
- Diff against base for remote and local.
- Manual merge uses CodeMirror merge or a three-pane editor with validation.
- Apply is disabled when structure validation fails.
- Taking repository warns about discarded local changes.
- Keep local and manual merge explain that a pending push will be created.

**Push dialog**

- Selected changes summary.
- Commit message input with validation.
- Push method: direct or branch plus compare URL.
- Second credential scan notice.
- Progress and result.

**Dispatch matrix**

- Rows: Skill and MCP assets; columns: detected Agents.
- Cell status with text and icon.
- Filters: asset type, only anomalies, show undetected.
- Summary: detected, stale, drifted counts.
- Cell detail: target path, version, time, mode, drift note, actions.
- Bulk "Sync all stale" with explicit drifted exclusion.

**History**

- Filters by category and result.
- Event details with redacted payload.
- Export action (P1).

**Operation states**

- Sync operations show a persistent progress strip.
- Buttons are disabled while a conflicting operation runs.
- Failures preserve pending changes and show the failing phase.

### 9.6 Settings

Sections:

- Appearance: theme, density.
- Repository: connection summary, policies, fetch interval.
- Global targets: eight target cards with editable paths.
- Data: locations, backup, restore, storage usage.
- Privacy: telemetry off by default, diagnostic export.
- Updates: version, channel, check now.
- About: version, build, license, notices.

Rules:

- Settings forms save explicitly; path edits validate inline.
- Destructive actions require confirmation.
- Backup progress is visible and cancellable before the swap phase.
- The UI never displays a secret.

### 9.7 Global search and command palette

**Global search**

- Input in the topbar.
- `/` focuses it.
- 250 ms debounce.
- Results grouped by asset type with count.
- Keyboard navigation with arrow keys and Enter.
- Highlighted match snippets.
- Selecting a result navigates to the workspace, tab, and item.
- No result state explains whether the query is empty, the index is rebuilding, or nothing matched.

**Command palette (P1)**

- Fuzzy command search.
- Commands: navigate, create, connect repository, fetch, push, open settings, check updates.
- Recent commands first.
- Disabled commands show a reason.

## 10. Performance design

### 10.1 Budgets

| Metric | Budget |
| --- | --- |
| Renderer initial bundle | <= 2 MB gzip `[ASSUMPTION]` |
| Workspace lazy chunk | <= 400 KB gzip `[ASSUMPTION]` |
| Time to interactive shell | <= 3 seconds cold start |
| Search input to result | <= 150 ms at the 95th percentile |
| List scroll | 60 fps with 1,000 rows |
| Dialog open | <= 100 ms |

### 10.2 Techniques

- Lazy load workspaces with `React.lazy` and `Suspense`.
- Virtualize long lists, trees, and diffs.
- Memoize expensive derived data and Markdown output.
- Truncate previews before rendering.
- Use `useDeferredValue` for search input.
- Avoid context providers that change on every keystroke; isolate form state.
- Avoid querying all assets to build folder counts; use aggregate queries.
- Keep dialogs unmounted until opened.
- Use CSS containment for large panes where appropriate.
- Do not ship source maps or development-only diagnostics.
- Measure with React Profiler and Electron performance marks; keep a benchmark fixture.

### 10.3 Large content

- Limit rendered Markdown to a configured size; show a "Load full content" action for larger bodies.
- Diff virtualization for large files with collapsed unchanged regions.
- CodeMirror handles large files, but editors over a threshold open read-only with an explicit warning.
- File previews reject binary content and show a file-type placeholder.

## 11. Accessibility

- Every interactive element is keyboard reachable.
- Focus rings are visible and use a high-contrast token.
- Dialogs use a focus trap and restore focus to the trigger.
- The folder tree implements `role="tree"` semantics with arrow-key navigation.
- Tables use proper headers and row selection semantics.
- Status badges include text.
- Toasts use `aria-live`.
- Sync progress uses a progress bar with an accessible name.
- Form errors are associated with fields through `aria-describedby`.
- Color contrast targets WCAG 2.1 AA.
- Motion respects `prefers-reduced-motion`.
- The app supports OS text scaling without clipping primary actions.
- Automated accessibility checks run in component tests; manual keyboard checks are required for release.

## 12. Renderer security

Rules:

- No `dangerouslySetInnerHTML` with untrusted content.
- Markdown is sanitized; raw HTML is disabled.
- No `eval`, `new Function`, or dynamic script injection.
- No remote content is loaded in the renderer.
- External links go through a main-process allowlist and confirmation.
- The renderer never receives stored secrets; redacted DTOs only.
- The query cache stores only redacted DTOs.
- Error objects never include secret values or full file contents.
- Production builds do not log DTOs to the console.
- Clipboard writes are limited to the content the user explicitly copied.
- File paths displayed in the UI are not used as write targets.
- No Node.js or Electron APIs are referenced in renderer code.
- CSP is enforced; `connect-src` is `none`.

## 13. Testing strategy

| Level | Scope | Tool |
| --- | --- | --- |
| Unit | Hooks, formatting, reducers, query-key helpers | Vitest |
| Component | Forms, dialogs, lists, empty and error states | React Testing Library |
| Integration | Feature with a mocked preload API | Vitest + RTL |
| E2E | Full workflows against a real Electron app | Playwright Electron |
| Accessibility | Automated checks on primary screens | axe-core |
| Visual | Optional screenshot review for key screens | Playwright screenshots |

Rules:

- Tests use a typed fake preload API, not ad hoc global mocks.
- E2E uses temporary user data and fake Agent directories.
- No test contains a real credential.
- Destructive confirmation flows are tested.
- Drift, conflict, and blocked states have explicit component tests.
- Performance benchmarks are separate from correctness tests.

## 14. Migration from the prototype

### 14.1 Principles

- Do not rewrite the UI from scratch.
- Move pure logic to `shared` first.
- Introduce the Electron shell with a compatibility data adapter.
- Replace the store domain by domain.
- Keep the prototype runnable until its replacement is verified.

### 14.2 Mapping

| Prototype path | Target path | Notes |
| --- | --- | --- |
| `src/App.tsx` | `src/renderer/App.tsx` | Shell composition changes |
| `src/components/layout/*` | `src/renderer/components/layout/*` | Mostly preserved |
| `src/components/ui/*` | `src/renderer/components/ui/*` | Preserved primitives |
| `src/components/prompts/*` | `src/renderer/features/prompts/*` | Split list, detail, dialogs |
| `src/components/instructions/*` | `src/renderer/features/instructions/*` | Split tabs and dialogs |
| `src/components/skills/*` | `src/renderer/features/skills/*` | Add file tree and wizard |
| `src/components/mcp/*` | `src/renderer/features/mcp/*` | Add secret replace flow |
| `src/components/sync/*` | `src/renderer/features/sync/*` | Add operation progress |
| `src/components/settings/*` | `src/renderer/features/settings/*` | Add data, privacy, updates |
| `src/components/shared/*` | `src/renderer/components/shared/*` | Replace custom Markdown and diff where needed |
| `src/lib/*` | `src/shared/domain/*` | Pure logic; keep tests |
| `src/lib/icons.tsx` | `src/renderer/lib/icons.tsx` | Renderer-only |
| `src/data/*` | `src/shared/targets/*` and `src/shared/demo/*` | Registries are production data; seeds are demo only |
| `src/store/store.tsx` | Removed | Replaced by IPC queries and feature state |
| `src/types.ts` | `src/shared/types/*` and schemas | Split by domain; derive from Zod where practical |

### 14.3 Migration phases

**Phase A: shared extraction**

- Move pure path, serialization, variable, diff, glob, and compiler logic into `src/shared/domain`.
- Add unit tests.
- Keep the prototype importing from the new location through a temporary compatibility layer.

**Phase B: Electron shell**

- Add electron-vite, main, preload, and renderer entry points.
- Run the existing UI inside Electron with a read-only compatibility adapter backed by the existing seed data.
- Verify window, theme, preload API, and packaging.

**Phase C: Prompts**

- Add SQLite, blobs, Prompt service, and IPC.
- Replace the Prompt store with queries.
- Keep other domains on seed data.
- Validate save, versions, copy, and sync scope.

**Phase D: Instructions, Skills, MCP**

- Migrate one domain at a time, starting with the domain that has the fewest external side effects.
- Add real filesystem and Git capabilities only after the read path is stable.

**Phase E: Sync and dispatch**

- Implement repository connection, sync, dispatch, and projection behind the new UI states.
- Remove prototype simulation paths.

**Phase F: cleanup**

- Delete the legacy store, seeds used as runtime data, and simulation-only code.
- Update documentation and acceptance tests.

### 14.4 Compatibility rules

- During migration, a domain may use seed data only if the UI clearly labels it as demo.
- Do not mix localStorage and SQLite for the same domain.
- The legacy `AppState` shape is not a production database schema.
- The prototype's English-only rule continues through migration.

## 15. Open questions

| ID | Question | Owner | Needed by |
| --- | --- | --- | --- |
| FE-01 | Project root picker UX `[TBD-UX]` | Design + frontend | Before INS-007 |
| FE-02 | Markdown sanitize schema allowlist | Frontend + security | Before content rendering |
| FE-03 | CodeMirror bundle strategy and lazy loading | Frontend | Before editor implementation |
| FE-04 | Virtualized grouped card layout approach | Frontend | Before Prompt list migration |
| FE-05 | Whether to keep a renderer-only dev mode after Electron | Frontend | Migration start |
| FE-06 | Inline editing vs dialog editing for Prompt bodies | Design + frontend | Before Prompt migration |
| FE-07 | External link confirmation copy | Design + security | Before Markdown release |
| FE-08 | Screenshot and visual regression scope | QA + frontend | Before beta |
| FE-09 | Theme bootstrap mechanism and no-flash guarantee | Frontend + Electron | Before shell implementation |
| FE-10 | Accessibility audit schedule | QA + design | Before beta |

**End of document.** Any change to the renderer/backend boundary, the state model, or the security rules for rendering untrusted content requires an update to this document and the architecture document.
