# Prompt Keeper Product Requirements Document

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Product Requirements Document (PRD) |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; pending product, engineering, design, and security review |
| Product form | Local-first desktop application for Windows and macOS |
| Desktop framework decision | Electron (confirmed by product direction) |
| Primary audience | Product, design, frontend, backend, QA, security, release engineering |
| Sources | [`docs/interaction-design.md`](./interaction-design.md) v0.5, [`docs/business-model.md`](./business-model.md) v0.1, [`README.md`](../README.md), `src/` prototype, `high-fidelity/` |
| Supersedes | Nothing. This document converts the existing design and business material into a prioritized product requirements baseline for the desktop product. |

## Document status and relationship to the current prototype

The repository now contains the **Electron desktop MVP** described by this PRD. The former browser prototype has been migrated: the renderer lives in `src/renderer`, the main-process backend in `src/main`, the typed preload bridge in `src/preload`, and the shared contract and pure domain logic in `src/shared`. [`AGENTS.md`](../AGENTS.md) section 2 describes the current architecture. Remaining simplifications and deferred items are tracked in [`docs/implementation-status.md`](./implementation-status.md).

This PRD describes the **target desktop product**:

- It is a Windows and macOS desktop application built with Electron.
- It is not a web application and does not depend on a hosted backend.
- The local Electron main process acts as the local service layer for storage, Git, filesystem writes, and secret protection.
- The current React prototype is the interaction reference and the starting point for the renderer, not the production architecture.

The desktop migration has been applied, so the renderer, backend, and IPC rules in this PRD are now the rules of the repository. `docs/implementation-status.md` records any behavior that is simplified or not yet at the target level.

Where this PRD and [`docs/interaction-design.md`](./interaction-design.md) differ:

- `docs/interaction-design.md` remains the source of truth for UX and domain behavior.
- This PRD owns product scope, priority, platform requirements, and release criteria.
- A requirement in this PRD that needs new UX behavior is marked `[TBD-UX]` rather than silently inventing the interaction.

## Annotation rules

| Marker | Meaning |
| --- | --- |
| `[FACT]` | Established by the existing prototype, existing documentation, or repository code |
| `[ASSUMPTION]` | Hypothesis that must be validated; not a commitment |
| `[TBD-BIZ]` | Business decision pending |
| `[TBD-UX]` | UX decision pending; interaction design must be extended before implementation |
| `[TBD-FE]` | Frontend implementation decision pending |
| `[TBD-BE]` | Backend or local-service implementation decision pending |
| `[TBD-INFRA]` | Infrastructure, release, signing, or operations decision pending |
| `[CONFLICT]` | Documents disagree; do not silently invent a compromise |

## 1. Executive summary

### 1.1 Problem

Developers now use multiple AI coding Agents at the same time: Claude Code, Codex, Cursor, Windsurf, OpenCode, Cline, Kiro, Qoder, and others. Each tool has its own persistent instruction files, skill directories, MCP configuration format, and credential handling. The same Prompt, rule, Skill, or MCP server is copied into several places and then drifts. [FACT: `docs/business-model.md` section 2.1; `docs/interaction-design.md` section 1.1]

This creates five concrete problems:

1. **Asset fragmentation.** Prompts, instructions, Skills, and MCP configuration live in different tools and directories.
2. **Rule drift.** `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, and path-level instruction files diverge over time.
3. **Missing collaboration.** Git stores files but does not provide per-item review, three-way conflict handling, or delivery records.
4. **Security gaps.** MCP credentials are often plaintext; Skills may contain executable scripts; pulling shared assets means writing unknown content to disk.
5. **Missing governance.** Teams cannot answer "which version was delivered to which tool, when, and by whom," and cannot roll back reliably.

### 1.2 Product

Prompt Keeper is a **local-first control plane for AI coding assets**. It unifies four asset types in one desktop application:

| Asset type | Canonical repository form | Delivery |
| --- | --- | --- |
| Prompt | `prompts/<folder>/<slug>.prompt.md` | Local library and optional Git sync only |
| Agent Instructions contract | `instructions/<folder>/<slug>.contract.md` | Project-level projection and user-level global dispatch |
| Skill | `skills/<folder>/<skill-name>/SKILL.md` plus optional files | Agent default directories, symlink or copy |
| MCP server | `mcp/<folder>/<server-name>.json` | Agent MCP configuration files |

The product closes the loop:

```text
Git repository (shared source of truth)
   <->  fetch / pull / push with three-way merge
Local asset library (on-machine control plane)
   ->  dispatch or projection, with preview, drift detection, and rollback
AI coding Agents (Claude Code / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder)
```

### 1.3 Why a desktop application

A browser cannot safely perform the core job:

- It cannot write to arbitrary Agent directories such as `~/.claude`, `~/.codex`, or `%USERPROFILE%\.cursor`.
- It cannot reliably create symlinks or junctions in those directories.
- It cannot reuse system Git credentials and SSH agents without friction.
- It cannot protect credentials with the operating system keychain.
- It cannot work fully offline or manage a local Git clone.

The desktop form factor is therefore a product requirement, not a packaging preference. [FACT: `docs/business-model.md` section 5.6]

### 1.4 Product positioning

> For developers and teams who use multiple AI coding Agents, Prompt Keeper is a local-first desktop control plane that unifies Prompts, Agent Instructions, Skills, and MCP configuration, shares them through Git, and delivers them to each tool with per-item preview, drift protection, secret isolation, and rollback.

## 2. Goals, non-goals, and success metrics

### 2.1 Product goals

| ID | Goal | Rationale |
| --- | --- | --- |
| G1 | One workspace for four asset types | Users learn one list-detail model and apply it everywhere |
| G2 | Git-native collaboration | Teams use an existing transport and keep a reviewable history |
| G3 | Safe delivery to Agents | Every write is previewed, traceable, drift-aware, and reversible |
| G4 | Secret isolation | Plaintext credentials never enter Git, logs, or the renderer |
| G5 | Explainable cross-tool behavior | Resolution preview explains what each tool would read, in what order, and why |
| G6 | Desktop-grade reliability | Atomic writes, crash recovery, backups, signed installers, auto-update |
| G7 | Local-first trust | Core workflows work offline; no asset content leaves the machine by default |

### 2.2 Non-goals for the desktop MVP

- Not an AI chat client, model aggregator, or inference provider.
- Not a general-purpose secret manager or MCP gateway; integration is in scope, replacement is not.
- Not a general dotfiles manager; only AI coding assets with domain semantics.
- Not a cloud workspace or mandatory account system.
- Not a marketplace in the MVP.
- No automatic execution of Skill scripts or MCP server processes.
- No automatic merge, commit, push, or write to Agent directories.
- No web application or CLI in the MVP.
- No Linux support in the MVP.
- No team RBAC, approval flow, SSO, or billing in the MVP; these are Phase 2 and Phase 3 capabilities. [FACT: `docs/business-model.md` section 11.1]

### 2.3 Success metrics

The metrics below come from the business model and are hypotheses until beta data exists. [ASSUMPTION: `docs/business-model.md` section 9]

| Layer | Metric | Target (hypothesis) |
| --- | --- | --- |
| North star | Weekly Successful Deliveries (WSD), deduplicated by asset x target | >= 3 per active workspace per week |
| Activation | First real dispatch or projection within 7 days, with >= 3 assets | >= 40% of installs |
| Activation | Connects a Git repository or creates one | >= 30% of activated users |
| Retention | W4 workspace retention with at least one WSD per week | >= 30% |
| Trust | Silent overwrite or data-loss incidents | 0 (hard requirement) |
| Quality | Sync success rate | >= 99% |
| Quality | Crash-free sessions | >= 99.5% |
| Efficiency | Install to first successful delivery | < 24 hours |
| Monetization | Free to Pro conversion | >= 3% (Phase 2) |
| Monetization | Paying teams | 10 within 6 months of Team beta (Phase 2) |

### 2.4 Priority definitions

| Priority | Meaning | Release |
| --- | --- | --- |
| P0 | Required for the desktop MVP; the product is not shippable without it | Phase 1 |
| P1 | Important follow-up; can ship after the MVP without breaking trust | Phase 1.5 or Phase 2 |
| P2 | Later expansion or ecosystem work | Phase 2 or later |

Priority is about product scope, not engineering order. Engineering order is defined in [`docs/backend-design.md`](./backend-design.md) and [`docs/frontend-design.md`](./frontend-design.md).

## 3. Users and jobs

### 3.1 Personas

| Persona | Profile | Primary pain | What success looks like |
| --- | --- | --- | --- |
| Alex, multi-tool individual developer | Uses 2-4 Agents, owns 50-200 Prompts, 10-30 Skills, 5-10 MCP servers | Reconfiguring every machine; not knowing which rule is current; a token almost reached Git | One dispatch to all tools; restore on a new machine in minutes; no leaks |
| Priya, AI engineering productivity lead | 10-30 person team, 3+ Agents, shared Git repository | Rules differ per project; onboarding is manual; hand edits get overwritten; no delivery proof | One repository as the source of truth; visible drift; audit export |
| Sam, security or platform lead | Enterprise platform or security team | Plaintext tokens; scripts from unknown sources; no centralized policy or audit | Secrets only in the OS keychain or secret manager; enforceable policy; exportable audit |

[FACT: `docs/business-model.md` section 3.2]

### 3.2 Jobs to be done

1. When I change machines or tools, I want my assets immediately usable.
2. When team rules change, I want to change one place and deliver everywhere.
3. When I pull shared assets, I want to see what will be written, what will execute, and where secrets go.
4. When target files were edited by hand, I want to see the drift before deciding to overwrite.
5. Before committing, I want suspected secrets blocked and templated.
6. When something breaks, I want to know which version went where and roll it back.

[FACT: `docs/business-model.md` section 3.3]

### 3.3 Core scenarios

Scenarios S1-S17 in [`docs/interaction-design.md`](./interaction-design.md) section 2 are the canonical scenario set. The desktop MVP must cover all of them except the explicitly deferred cases noted in section 5 of this document.

## 4. Product principles and trust contract

These principles are non-negotiable product requirements, not implementation advice.

| ID | Principle | Consequence |
| --- | --- | --- |
| PP-01 | One shared asset model per domain | Folders, search, versions, and sync status behave consistently across all four asset types |
| PP-02 | Folders are repository directories | Every library folder maps to a directory under the configured repository root |
| PP-03 | Preview before write | Every dispatch, projection, overwrite, and restore shows what will be written and where |
| PP-04 | Per-item review for high-risk pulls | Prompts, Agent Instructions, new Skills, and Skills with scripts never enter batch accept |
| PP-05 | No silent overwrite | Drifted files require item-by-item confirmation; bulk overwrite is prohibited |
| PP-06 | Secrets never enter Git | MCP uses `${VAR}` placeholders; Prompts and Instructions use `{{variable}}` |
| PP-07 | No automatic mutations | Auto-fetch is read-only; no auto-merge, auto-commit, auto-push, auto-project, or auto-dispatch |
| PP-08 | Agent directories are never a source of truth | They are delivery targets only; changes are detected as drift, not silently imported |
| PP-09 | Every delivery is traceable and reversible | Record asset, version, target, path, mode, and time; support rollback |
| PP-10 | Explain approximations honestly | Resolution preview does not claim to simulate a vendor CLI exactly |
| PP-11 | Local-first | Core use is offline; no asset content is uploaded by default |
| PP-12 | Asymmetric trust | The renderer is untrusted for writes; the main process validates and performs every mutation |

## 5. Scope and priority

### 5.1 P0 scope: desktop MVP

The MVP must deliver a trustworthy end-to-end loop for all four asset types:

| Area | P0 capabilities |
| --- | --- |
| App shell | Sidebar navigation, five workspaces plus Settings, global search, theme, toasts, confirmation dialogs, keyboard shortcuts |
| Prompts | CRUD, nested folders, tags, favorites, variables, copy, versions, sync scope, `.prompt.md` sync, per-item pull preview, credential scan |
| Agent Instructions | Contract library, six project targets, scope and activation, resolution preview, project projection, drift protection, eight global targets with editable paths, batch global dispatch |
| Skills | Library, nested folders, file tree, versions, dispatch panel, symlink and copy modes, drift, remove, rollback |
| MCP | Library, one JSON per server, stdio and HTTP transports, encrypted secrets, redaction, health check, versions, apply to Agent configs, drift, remove |
| Git sync | Four-step repository connection, directory mapping, policies, fetch, incoming review, outgoing push, three-way conflicts, history |
| Dispatch | Skill/MCP matrix, status semantics, drift rules, rollback, audit events |
| Security | OS keychain-backed secret storage, credential scanning, IPC validation, Electron hardening, no plaintext secrets at rest or in logs |
| Desktop | Windows and macOS installers, code signing, notarization, auto-update, crash-safe storage, backup before migration |
| Data | Local SQLite database, content-addressed blob store, schema migrations, backup and restore |

### 5.2 P1 scope: post-MVP

- AI test with bring-your-own-key providers and streaming responses.
- Curated local catalog for Prompts, Skills, and MCP entries; no remote marketplace.
- Import existing Agent MCP configurations and local Skill directories.
- Additional target adapters beyond the initial Tier 1 set.
- Bulk operations across lists.
- Audit export (CSV and JSON).
- Optional anonymous telemetry with explicit opt-in.
- Multiple windows.

### 5.3 P2 scope: later

- Multiple repositories per workspace and per-asset subscriptions.
- Git LFS and large binary asset support.
- Branch plus pull-request push mode with hosting provider integration.
- Team roles, approval flows, policy packs, and billing.
- Enterprise SSO, SCIM, secret manager integration, and compliance reports.
- Marketplace and paid content.
- Linux support.
- CLI and CI integration.
- Project-level Skill and MCP workspaces.

### 5.4 Explicitly out of scope for this product line

- Hosting or executing model inference as part of the core product.
- Automatic execution of downloaded scripts.
- Reading or indexing Agent conversation history.
- Managing non-AI dotfiles.
- Replacing a dedicated secret manager, MCP gateway, or identity provider.

## 6. Platform and distribution requirements

### 6.1 Supported operating systems

| Platform | MVP support | Notes |
| --- | --- | --- |
| Windows 10 21H2 and later | Yes, x64 | Windows 11 also supported; arm64 is P1 |
| Windows 11 | Yes, x64 | Same installer family |
| macOS 13 Ventura and later | Yes, Apple Silicon and Intel | Universal build or two architecture-specific builds `[TBD-INFRA]` |
| macOS 12 and earlier | No | Electron support and notarization policy make this a clean cutoff `[ASSUMPTION]` |
| Linux | No | P2 |

[ASSUMPTION: exact minimum OS versions must be confirmed against the chosen Electron release and enterprise customer requirements.]

### 6.2 Installation and update

- Windows: signed NSIS installer, per-user installation, no administrator requirement for normal use.
- macOS: signed and notarized DMG or ZIP, hardened runtime, direct download.
- No Mac App Store or Microsoft Store distribution in the MVP. Store sandboxing conflicts with arbitrary writes to Agent directories. `[TBD-BIZ]`
- Auto-update from a signed release feed, with staged rollout and rollback. The app must remain usable offline; update checks must not block startup.
- The app must survive an upgrade from the previous installed version without losing assets, versions, projections, or dispatch records.

### 6.3 Offline behavior

| Capability | Offline behavior |
| --- | --- |
| Local library, editing, versions, search | Fully available |
| Dispatch and projection to local Agent directories | Fully available |
| Git fetch, pull, push | Unavailable; queued operations remain pending and explain the failure |
| AI test | Unavailable unless the provider is reachable |
| Catalog and store | Cached or unavailable; core workflows unaffected |
| Update check | Deferred; no blocking error |
| License validation, if introduced | Must allow a grace period; core local use must not be held hostage `[TBD-BIZ]` |

### 6.4 Local data locations

| Data | Location |
| --- | --- |
| SQLite database | `app.getPath('userData')/db/prompt-keeper.sqlite` |
| Blob store | `app.getPath('userData')/blobs/` |
| Managed Git clones | `app.getPath('userData')/repos/<repo-id>/` |
| Backups | `app.getPath('userData')/backups/` |
| Logs | `app.getPath('userData')/logs/` |
| Secrets | Encrypted values in SQLite using the OS-backed Electron safeStorage; never a plaintext sidecar file |
| Global target paths | Local SQLite settings only; never written into a Git repository |

Exact paths use Electron's `userData` directory, which resolves to `~/Library/Application Support/Prompt Keeper` on macOS and `%APPDATA%\Prompt Keeper` on Windows by default. [FACT: Electron platform convention]

## 7. Functional requirements

Requirement format:

- **ID**: stable identifier used by design, implementation, and test plans.
- **Priority**: P0, P1, or P2.
- **Statement**: the required behavior.
- **Acceptance**: the observable condition that proves it.

Detailed visual and interaction rules live in [`docs/interaction-design.md`](./interaction-design.md). This section defines product scope, not pixel-level behavior.

### 7.1 App shell and navigation

**APP-001 (P0) Fixed workspace navigation.**
The app provides a fixed left sidebar with Prompts, Agent Instructions, Skills, MCP, Sync, and Settings. Each workspace uses segmented tabs for its subviews.
Acceptance: every workspace is reachable without a URL router; the active workspace and tab survive a window reload.

**APP-002 (P0) Global search entry.**
The top bar hosts global search. Pressing `/` focuses it.
Acceptance: search is reachable from every workspace and returns grouped results across all four asset types.

**APP-003 (P0) Repository status indicator.**
The top bar shows repository connection state and pending change count; clicking it opens the Sync workspace.
Acceptance: the indicator updates after fetch, pull, push, and conflict resolution without a full reload.

**APP-004 (P0) Theme support.**
Light, dark, and system themes are available and persist across restarts.
Acceptance: switching themes applies immediately; system mode follows OS changes.

**APP-005 (P0) Feedback and confirmation.**
Success, failure, warning, and long-running states use toasts and inline messages. Destructive actions require a confirmation dialog that names the object and the consequence.
Acceptance: no destructive action executes from a single click; every write action reports a result.

**APP-006 (P0) Empty, loading, and error states.**
Every list and detail view distinguishes "no data" from "no matches" and explains the cause. Loading uses skeletons or progress indicators. Errors state the cause and a next action.
Acceptance: a first-run empty library, a filtered empty list, a disconnected repository, and a failed Git operation each have distinct, actionable copy.

**APP-007 (P0) Keyboard operation.**
`/` focuses search, `N` creates the current asset type, `Esc` closes the top overlay or exits inline editing, and Cmd/Ctrl+Enter submits dialogs.
Acceptance: all primary workflows are keyboard reachable; focus is visible and trapped correctly inside dialogs.

**APP-008 (P0) Window state.**
Window size, position, and maximized state persist between launches within the visible display bounds.
Acceptance: relaunching restores a usable window even if the previous display was disconnected.

**APP-009 (P0) First-run experience.**
A first-run state explains the four asset types, offers demo data or an empty library, and guides the user to connect a repository or create a first asset.
Acceptance: a new user can reach a first successful local action without external documentation.

**APP-010 (P1) Command palette.**
A command palette exposes navigation, create, sync, and settings actions with fuzzy search.
Acceptance: every top-level action is available from the palette; results are keyboard navigable.

**APP-011 (P0) Single instance.**
Opening a second instance focuses the existing window instead of opening a second database writer.
Acceptance: a second launch does not create a second main window or a second SQLite writer.

### 7.2 Prompts

**PRM-001 (P0) Prompt CRUD.**
Users can create, read, update, duplicate, and delete Prompts with title, description, System Prompt, User Prompt, tags, folder, and sync scope.
Acceptance: title is required; at least one of System or User Prompt must be non-empty; validation errors are inline and block saving.

**PRM-002 (P0) Nested folders are repository directories.**
A Prompt folder is a multi-level path. The repository path is `prompts/<folder>/<slug>.prompt.md`.
Acceptance: creating `engineering/code-quality` produces the same path in the folder tree, card group, table column, detail header, and repository file after push.

**PRM-003 (P0) List views.**
The Prompt list supports a folder tree, search, tag filter, favorites filter, sort, and card/table views. Selecting a parent folder includes descendants.
Acceptance: the selected view preference persists; counts at each folder level are correct.

**PRM-004 (P0) Variable detection and copy.**
The editor detects `{{variable}}` and `{{variable:example}}` syntax. Copying a Prompt with variables opens a form, validates required fields, renders the body, writes to the clipboard, and increments usage.
Acceptance: no variable value is persisted to the asset, version history, or repository.

**PRM-005 (P0) Version history.**
Every save creates a version snapshot. Users can compare a version with the current content, restore a version, and add a change note. Restoring creates a new version rather than rewriting history.
Acceptance: the current version cannot be deleted; restoring a synced Prompt creates a pending push.

**PRM-006 (P0) Three-state sync scope.**
A Prompt can follow repository policy, participate explicitly, or remain local only.
Acceptance: when the repository-wide Prompt policy is off, every Prompt behaves as local only; setting a Prompt to local only withdraws its unprocessed pending changes and leaves repository files untouched.

**PRM-007 (P0) Structured `.prompt.md` file.**
Prompts serialize to one Markdown file with YAML frontmatter containing a stable ID, title, description, folder, tags, and variable definitions, and a body split into System Prompt and User Prompt sections.
Acceptance: pulling a file with a missing folder infers the folder from the directory; a file that fails parsing appears as Malformed and is never silently written.

**PRM-008 (P0) Per-item pull preview.**
Every incoming Prompt change opens a preview with full text for additions or a local-to-repository diff for modifications, plus a confirmation checkbox.
Acceptance: Prompts never appear in batch accept.

**PRM-009 (P0) Credential scan before push.**
Prompt bodies are scanned for high-confidence credential patterns before push. A hit blocks the push and requires replacement with a `{{variable}}`.
Acceptance: the handling dialog shows the original location and replacement; the original value does not appear in the repository file.

**PRM-010 (P0) Delete boundary.**
Deleting a synced Prompt removes only the local copy and withdraws pending sync items. It does not delete the repository file.
Acceptance: the confirmation states that a remote file will reappear on the next pull.

**PRM-011 (P1) AI test.**
Users can run a Prompt against a configured model, fill variables, stream a response, cancel a run, and review test history.
Acceptance: API keys are stored only in the OS-backed encrypted store; the renderer never receives the stored key; no hosted inference is provided by the product.

**PRM-012 (P1) Curated Platform Discovery.**
Users can browse a curated catalog of Prompt templates, preview, copy, and save locally.
Acceptance: saving a duplicate name is blocked with an actionable message; catalog content is clearly marked as curated or demo data until a real service exists.

**PRM-013 (P0) No Agent dispatch for Prompts.**
Prompts are never written to Agent directories.
Acceptance: the Sync dispatch matrix does not include Prompts; the UI explains that rule-like content belongs to Agent Instructions.

### 7.3 Agent Instructions

**INS-001 (P0) Contract library.**
Users can create and manage contracts with title, description, body, folder, scope, path prefix, activation, priority, imports, targets, tags, and sync scope.
Acceptance: saving creates a version; validation blocks saving with field-level reasons.

**INS-002 (P0) Six project targets.**
The initial target registry contains `agents-md`, `claude`, `copilot`, `copilot-path`, `cursor`, and `windsurf`.
Acceptance: target behavior is data-driven; there are no vendor-specific workspaces or duplicated CRUD stacks.

**INS-003 (P0) Scope and activation.**
Contracts support user, project, and path scope, and always, glob, model, and manual activation.
Acceptance: glob activation requires at least one glob; model activation requires an applicability description; path scope requires a directory prefix.

**INS-004 (P0) Capability compatibility.**
Each target declares support for globs, model decision, manual reference, and imports.
Acceptance: unsupported combinations are shown as "will be skipped" before saving and during projection; silent downgrade is prohibited.

**INS-005 (P0) Resolution preview.**
For a selected target and sample file path, the app shows included contracts in target-specific priority order, skip reasons, per-contract bytes, total bytes, limit warnings, duplicate-line warnings, and compiled target files.
Acceptance: switching between a component path, a README, and a script produces explainable differences; the UI states that the result is an approximation and the tool is authoritative.

**INS-006 (P0) Project projection.**
Single-file targets merge contracts into managed blocks delimited by `<!-- pk:begin <contract-id> -->` and `<!-- pk:end <contract-id> -->`; per-contract targets write one file with target-specific frontmatter.
Acceptance: projecting one contract does not modify other contracts' blocks; generated files match the target format.

**INS-007 (P0) Project root registration.**
Project-level projections need a registered project root. `[TBD-UX]` The current prototype does not model a project registry; the production UX must define how a user registers, selects, and removes project roots before this requirement can be implemented.

**INS-008 (P0) Projection drift protection.**
A target file modified by hand is marked Drifted. Drifted projections are excluded from batch operations and require per-item confirmation to overwrite.
Acceptance: the overwrite dialog shows the target path, drift note, and whether the file contains multiple contracts; bulk overwrite is impossible.

**INS-009 (P0) Projection actions.**
Users can project, re-project, remove, and roll back a projection.
Acceptance: removing a projection does not affect the local library or repository; rollback affects only the target file.

**INS-010 (P0) Global directory targets.**
The app provides user-level targets for Claude Code, Codex, Cursor, Windsurf, OpenCode, Cline, Kiro, and Qoder. Each target path is editable and can be restored to its default.
Acceptance: paths must be absolute or start with `~`; invalid paths are rejected inline; paths are stored locally and never written to Git.

**INS-011 (P0) Global batch dispatch.**
Users can select multiple contracts and multiple global targets, preview the final files, and project them in one operation.
Acceptance: incompatible combinations are reported as skipped; drifted items are excluded from bulk overwrite; the result reports success, skipped, and drifted counts separately.

**INS-012 (P0) Path change invalidation.**
Changing a global target path marks non-drifted projections under that target as Stale.
Acceptance: restoring the default path also marks them Stale; no files are moved or written automatically.

**INS-013 (P0) `.contract.md` sync.**
Contracts serialize to one Markdown file with frontmatter containing folder, scope, activation, priority, imports, and targets; pulling, preview, credential scan, and three-way conflicts follow the same rules as Prompts.
Acceptance: manual merges must preserve frontmatter and body; incomplete structure blocks application.

**INS-014 (P0) Delete boundary and orphan projections.**
Deleting a local contract removes only the local copy and withdraws pending sync items. Existing projection records remain as orphaned records.
Acceptance: target files are not deleted; orphan records can be removed or rolled back but cannot regenerate content.

**INS-015 (P0) Version history.**
Each save creates a version. Restoring a version creates a new version and marks affected projections Stale.
Acceptance: restoring never writes to Agent directories automatically.

**INS-016 (P0) Honest simulation boundary.**
The app must not claim to reproduce a vendor's exact merge order or CLI behavior.
Acceptance: the resolution preview carries a persistent approximation notice.

**INS-017 (P0) No per-vendor workspaces.**
Vendor differences live in the target registry and compiler.
Acceptance: adding a target requires a registry entry and adapter tests, not a new workspace or CRUD stack.

**INS-018 (P1) Additional targets.**
More instruction targets such as Gemini CLI, Aider, Warp, Junie, and Kiro can be added through the registry.
Acceptance: each new target has contract tests and a support tier.

### 7.4 Skills

**SKL-001 (P0) Skill library.**
Users can create, import, edit, delete, search, filter, and organize Skills by nested folder.
Acceptance: repository paths are `skills/<folder>/<skill-name>/SKILL.md`; renaming a Skill warns about path changes and blocks duplicate names.

**SKL-002 (P0) Multi-file Skill content.**
A Skill is a directory with `SKILL.md` and optional scripts and supporting files. The app stores and displays the file tree, sizes, and content.
Acceptance: scripts are displayed and reviewed but never executed by the app.

**SKL-003 (P0) Version history.**
Saving a Skill creates a version. Users can compare, restore, and add a change note.
Acceptance: a version includes all Skill files, not only `SKILL.md`.

**SKL-004 (P0) Dispatch panel.**
Each Skill shows per-Agent status: not installed, installed and managed by this app, external installation, unsupported, stale, or drifted.
Acceptance: status is derived from real manifests and file hashes, not hard-coded seeds.

**SKL-005 (P0) Symlink and copy install.**
Users choose symlink or copy mode. Symlink is the default; copy is used when symlinks are unavailable or the user chooses independence.
Acceptance: symlink failure falls back to copy only with explicit item-level reporting; no silent fallback.

**SKL-006 (P0) Drift and overwrite protection.**
Hand edits inside an installed Skill directory are marked Drifted. Bulk sync and bulk overwrite never touch drifted items.
Acceptance: re-sync requires per-item confirmation and shows the target path.

**SKL-007 (P0) Remove and rollback.**
Users can remove a dispatch and roll back to the previous deployed version.
Acceptance: removing a dispatch does not delete the local Skill or repository copy; rollback affects only the Agent directory.

**SKL-008 (P0) Delete boundary.**
Deleting a Skill removes only the local copy and withdraws pending sync items.
Acceptance: repository directories and existing Agent installs are not deleted automatically.

**SKL-009 (P1) Curated Skill store.**
A curated catalog supports category filtering, search, preview, file list, target selection, and install review.
Acceptance: installation always passes through the review step; no one-click unreviewed install.

**SKL-010 (P1) Local scan import.**
The app can scan Agent directories for existing Skills and import them after preview.
Acceptance: imported Skills retain their source path and are marked Imported or Scanned.

**SKL-011 (P1) Content review.**
New or script-containing Skills from a remote source require full-content review and a trust checkbox before they enter the local library.
Acceptance: batch accept excludes these items.

**SKL-012 (P0) No script execution.**
The app never executes Skill scripts, install hooks, or package managers on behalf of a Skill.
Acceptance: no code path invokes a Skill-provided executable.

**SKL-013 (P1) Security scan.**
Optional content and script review produces a risk summary before install.
Acceptance: high-risk findings require an explicit second confirmation. `[TBD-BIZ: scoring model]`

**SKL-014 (P2) Project-level Skill workspaces.**
Register project directories and maintain independent Skill spaces with two-way import.

**SKL-015 (P2) Custom store sources.**
Support marketplace JSON, Git repository, and local directory sources for the Skill store.

### 7.5 MCP

**MCP-001 (P0) MCP library.**
Users can create, read, update, delete, enable, disable, favorite, tag, and organize MCP servers by nested folder.
Acceptance: each server maps to `mcp/<folder>/<server-name>.json`; one server per file.

**MCP-002 (P0) Transports and configuration.**
Servers support stdio (command, args, env) and HTTP (URL, headers).
Acceptance: invalid JSON blocks saving and locates the error; transport-specific fields are validated.

**MCP-003 (P0) Encrypted secrets and redaction.**
Credential-like environment values and headers are stored encrypted and always displayed as `[REDACTED]`.
Acceptance: the renderer receives only redacted values; plaintext never appears in logs, exports, repository files, or crash reports.

**MCP-004 (P0) Health check.**
The app reports static configuration health: missing command, invalid URL, missing required environment variables, and invalid environment value formats.
Acceptance: health checks do not start the MCP process or make network requests in the MVP.

**MCP-005 (P0) Version history.**
Saving a configuration creates a version. Users can compare, restore, and add a note.
Acceptance: restoring creates a new version and does not automatically rewrite Agent configuration files.

**MCP-006 (P0) Apply to Agent configuration.**
Users can preview and apply one or more servers to selected Agent configuration files.
Acceptance: the preview shows the exact projected content with secrets redacted; applying writes atomically and reports per-target results.

**MCP-007 (P0) Format-preserving configuration merge.**
The app supports JSON, JSONC, and TOML target files and preserves unknown keys and unrelated servers.
Acceptance: applying or removing a managed server does not reformat or delete unrelated configuration; comments are preserved where the format allows.

**MCP-008 (P0) Managed-entry drift.**
Hand edits to a managed server entry are detected as drift.
Acceptance: bulk re-sync skips drifted entries; overwrite requires per-entry confirmation.

**MCP-009 (P0) Remove dispatch.**
Removing a dispatch deletes only the managed entry or file created by the app.
Acceptance: external entries and unrelated keys remain untouched.

**MCP-010 (P0) Repository templates only.**
Repository MCP files contain only `${VAR}` placeholders. Before push, the app scans for plaintext credentials and blocks the commit.
Acceptance: a converted file enters the normal push flow; the original secret remains only in the encrypted local store.

**MCP-011 (P0) Disabled servers cannot be dispatched.**
A disabled server cannot be applied or re-synced.
Acceptance: the action is disabled and explains why.

**MCP-012 (P1) Reverse import.**
The app can read existing Agent MCP configuration and import external entries into the library after preview.
Acceptance: imported entries are marked Imported and secrets are moved to encrypted storage.

**MCP-013 (P1) Curated MCP catalog.**
A curated catalog shows overview, environment variables, and install command, with an add-to-library flow.
Acceptance: duplicate names are blocked; catalog content is clearly marked as curated until a live registry exists.

**MCP-014 (P0) No process execution.**
The app never launches an MCP server for health checking or testing in the MVP.
Acceptance: no code path spawns the configured command or opens the configured URL automatically.

**MCP-015 (P2) Connectivity probe.**
Optional user-triggered connectivity checks for remote MCP endpoints, with explicit consent and clear network disclosure.

### 7.6 Git synchronization

**SYN-001 (P0) Four-step repository connection.**
The wizard covers connect repository, directory mapping, sync policy, and first preflight.
Acceptance: the connection cannot complete until the user confirms the repository source and understands that scripts and MCP commands may run on this machine.

**SYN-002 (P0) Directory mapping.**
The wizard auto-detects `prompts/`, `instructions/`, `skills/`, and `mcp/`, allows overrides, and shows nested-directory examples.
Acceptance: unmatched assets are placed in an explicit Unfiled state and never silently dropped.

**SYN-003 (P0) Asset policies and per-item scope.**
Each asset type has a repository policy; Prompts and Contracts also have a per-item sync scope.
Acceptance: disabling a global policy makes all items of that type local only and does not delete repository files.

**SYN-004 (P0) Read-only auto-fetch.**
The app can fetch metadata and changes on a configurable interval.
Acceptance: auto-fetch never merges, pulls into the library, commits, pushes, or writes to Agent directories.

**SYN-005 (P0) Sync status dictionary.**
Assets report `in-sync`, `remote-ahead`, `local-ahead`, `diverged`, `blocked`, and `ignored`.
Acceptance: status is computed from real local, base, and remote content, not demo labels.

**SYN-006 (P0) Incoming review.**
Incoming changes show type, asset, path, line counts, and risk. New or script-containing Skills require full review. Prompts and Contracts always require item-by-item preview.
Acceptance: batch accept applies only to low-risk Skills and MCP templates.

**SYN-007 (P0) Outgoing push.**
Pushing requires a commit message and a push method. Direct push is the MVP default. Branch-plus-PR may push a branch and present a compare URL without provider API integration.
Acceptance: no silent or one-click push; a second credential scan runs before commit.

**SYN-008 (P0) Three-way conflict resolution.**
Conflicts show remote, local, and base content with Take repository, Keep local, and Manual merge strategies.
Acceptance: manual merges validate file structure; Take repository warns that local changes are discarded; Keep local and manual merge create a pending push.

**SYN-009 (P0) Stable IDs and renames.**
Frontmatter carries a stable asset ID so a rename does not become a delete plus an add.
Acceptance: moving a folder updates the path and pending change while preserving asset identity and history.

**SYN-010 (P0) Delete boundaries.**
Local deletion withdraws pending items and leaves the repository unchanged. Tombstone deletion pushes are not part of the MVP.
Acceptance: the UI states that a remote asset will reappear on the next pull.

**SYN-011 (P0) Non-destructive Git behavior.**
The app never force-pushes, never rewrites published history, and never discards uncommitted changes in a bound clone.
Acceptance: a dirty or diverged clone stops the operation with an explanation.

**SYN-012 (P0) Serialized repository operations.**
Only one fetch, pull, or push runs per repository at a time.
Acceptance: concurrent triggers queue or are rejected with a clear message; the database and worktree remain consistent.

**SYN-013 (P0) Sync history and audit.**
Every fetch, pull, push, conflict, dispatch, projection, block, review, and rollback creates a local audit event.
Acceptance: history can be filtered by category and exported; it records asset, version, target, path, result, and time.

**SYN-014 (P0) Branch and authentication.**
The app supports a configurable branch and reuses system Git credentials or an SSH agent.
Acceptance: the app does not store Git passwords; authentication failures are explained with the failing command context.

**SYN-015 (P0) Repository layout validation.**
The app validates directory layout, file naming, frontmatter, and duplicate IDs before push.
Acceptance: invalid files are reported with paths and reasons; the app does not silently rewrite user files to make them valid.

**SYN-016 (P2) Multiple repositories.**
Bind multiple repositories to one workspace and subscribe per asset source.

**SYN-017 (P2) Git LFS and binary assets.**
Support large files through Git LFS or an explicit external-file policy.

### 7.7 Dispatch and projection cross-cutting requirements

**DST-001 (P0) Dispatch matrix.**
The Sync workspace shows Skill and MCP status across detected Agents.
Acceptance: statuses distinguish synced, stale, drifted, missing, and unsupported; Prompts and Contracts do not appear.

**DST-002 (P0) Detected Agents.**
The app detects installed Agents from default directories and configuration files, and allows manual re-detection.
Acceptance: undetected Agents are hidden by default but can be shown; detection failure does not block local editing.

**DST-003 (P0) Write preview.**
Every dispatch and projection provides a preview of the target path and content.
Acceptance: MCP previews redact secrets; instruction previews show the final merged file.

**DST-004 (P0) Drift policy.**
Drift is detected by content hash and manifest, not by timestamp alone.
Acceptance: touching a file without changing content does not mark it drifted; changing content does.

**DST-005 (P0) Bulk stale sync.**
"Sync all stale" operates only on stale items and reports skipped drifted items.
Acceptance: the result message states how many drifted items were not overwritten.

**DST-006 (P0) Rollback.**
Each dispatch and projection can roll back to the previous deployed version when one exists.
Acceptance: rollback writes only the target; it does not change the local library or repository.

**DST-007 (P0) Unsupported combinations.**
Targets that do not support an asset type or activation mode are labeled Unsupported rather than Missing.
Acceptance: unsupported items cannot be dispatched or projected.

**DST-008 (P0) Audit trail.**
Every dispatch and projection records asset, version, target, path, mode, timestamp, and result.
Acceptance: the record is visible in history and in the item detail.

### 7.8 Search

**SRH-001 (P0) Global search.**
Search covers Prompts, Contracts, Skills, and MCP servers, with grouped results and highlighted matches.
Acceptance: results respect current repository connection and local-only state; no content leaves the machine.

**SRH-002 (P0) Local full-text index.**
Search uses a local full-text index and supports title, description, body, tags, and path.
Acceptance: query latency remains acceptable at the NFR target; the index updates after edits and deletes.

**SRH-003 (P0) Scoped search.**
Each workspace has scoped search and filters in addition to global search.
Acceptance: filters compose predictably and can be cleared in one action.

**SRH-004 (P0) Search states.**
Empty query, no results, index rebuilding, and search error states are distinct and actionable.
Acceptance: the UI never shows a blank panel without explanation.

### 7.9 Settings and data management

**SET-001 (P0) Appearance.**
Theme selection and density preference.
Acceptance: preferences persist and apply without a restart.

**SET-002 (P0) Repository settings.**
Show repository URL, branch, local path, authentication mode, policies, and fetch interval.
Acceptance: settings and Sync workspace agree on the same state.

**SET-003 (P0) Global target paths.**
Show all global instruction targets and their current paths.
Acceptance: editing a path follows INS-010 and INS-012.

**SET-004 (P0) Data location and backup.**
Show the database, blob store, clone, backup, and log locations, with actions to reveal them in the OS file manager and create a backup.
Acceptance: backup produces a consistent snapshot while the app is running.

**SET-005 (P0) Restore and reset.**
Restore from a backup requires confirmation and states exactly what will be replaced. Destructive reset is separate from backup.
Acceptance: the app validates the backup before replacing data and creates a safety backup first.

**SET-006 (P0) Update settings.**
Show current version, update channel, last check, and a manual check action.
Acceptance: update failure does not block the app; release notes are available offline after download.

**SET-007 (P0) Privacy settings.**
Telemetry is off by default and opt-in, with a clear description of what is collected.
Acceptance: with telemetry off, no network request carries asset content, titles, paths, or repository names.

**SET-008 (P0) Logs and diagnostics.**
Users can export logs with secrets and sensitive paths redacted.
Acceptance: exported logs contain no plaintext credentials and no asset bodies.

**SET-009 (P0) About and licenses.**
Version, build, license, and third-party notices are available offline.
Acceptance: open-source license obligations are included in the installer.

**SET-010 (P1) AI provider settings.**
Configure provider base URL, model, and API key. Keys are encrypted and never returned to the renderer.
Acceptance: a test connection can be run without exposing the stored key.

**SET-011 (P1) Local metrics panel.**
Show local counts for deliveries, drift events, blocked credentials, and sync results.
Acceptance: the panel reads only local audit data and does not require telemetry.

### 7.10 AI test

**AI-001 (P1) Bring your own key.**
Users configure an OpenAI-compatible provider or a supported provider adapter. The product does not sell or proxy inference by default.
Acceptance: no inference request is sent without an explicit user action and a configured provider.

**AI-002 (P1) Streaming and cancellation.**
Responses stream incrementally and can be cancelled. Test history stores model, duration, time, and response.
Acceptance: cancelling stops the stream and records a cancelled result.

**AI-003 (P1) Data disclosure.**
Before the first request, the app explains that Prompt content is sent directly to the configured provider.
Acceptance: the disclosure is recorded in settings and can be reviewed later.

**AI-004 (P2) Hosted inference.**
Hosted inference is out of scope unless a separate business decision changes the model. `[TBD-BIZ]`

### 7.11 Curated catalogs

**CAT-001 (P1) Curated content only.**
Prompt discovery, Skill store, and MCP catalog use a signed or bundled curated dataset in the MVP.
Acceptance: content is versioned with the app or delivered by an explicitly configured source; demo data is labeled.

**CAT-002 (P1) Review before install.**
Store installation always passes through content review, target selection, and confirmation.
Acceptance: no direct one-click install bypasses review.

**CAT-003 (P2) Remote catalog service.**
A remote catalog requires a separate service, moderation policy, and security review. `[TBD-BIZ]` `[TBD-INFRA]`

## 8. Non-functional requirements

### 8.1 Performance

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-PERF-001 | Cold start to interactive shell | <= 3 seconds on a reference machine with 10,000 assets |
| NFR-PERF-002 | Workspace navigation | <= 150 ms perceived |
| NFR-PERF-003 | Global search response | <= 150 ms for the 95th percentile with 10,000 assets |
| NFR-PERF-004 | Typical list scroll | 60 fps with 1,000 visible-row scrolling |
| NFR-PERF-005 | IPC round trip for a small query | <= 100 ms at the 95th percentile |
| NFR-PERF-006 | Memory | <= 500 MB resident in a typical session |
| NFR-PERF-007 | Large Git operation | Must not freeze the UI; progress and cancellation are visible |
| NFR-PERF-008 | Installer size | <= 150 MB compressed `[ASSUMPTION]` |

Targets are engineering budgets, not customer promises, until measured on reference hardware.

### 8.2 Reliability and data integrity

| ID | Requirement |
| --- | --- |
| NFR-REL-001 | All multi-table mutations run in a SQLite transaction |
| NFR-REL-002 | All file writes use temp-file plus atomic rename with retry and a pre-write backup |
| NFR-REL-003 | A crash during a write leaves either the previous or the new complete file, never a partial file |
| NFR-REL-004 | Schema migration creates a backup before changing the database and is forward-only |
| NFR-REL-005 | The app recovers from an interrupted dispatch by reconciling manifests on startup |
| NFR-REL-006 | No operation silently discards user content |
| NFR-REL-007 | A failed Git operation leaves the local library and pending changes intact |
| NFR-REL-008 | The app detects database corruption, preserves the corrupt file, and offers restore from backup |

### 8.3 Security and privacy

| ID | Requirement |
| --- | --- |
| NFR-SEC-001 | `contextIsolation` enabled, `nodeIntegration` disabled, `sandbox` enabled |
| NFR-SEC-002 | All IPC payloads are schema-validated in the main process; sender identity is checked |
| NFR-SEC-003 | The renderer has no Node.js, filesystem, shell, or arbitrary network access |
| NFR-SEC-004 | Markdown from repositories is sanitized; raw HTML, scripts, and event handlers are not rendered |
| NFR-SEC-005 | No remote code is loaded or executed; all updates are signed |
| NFR-SEC-006 | Secrets are encrypted with OS-backed safeStorage and never returned to the renderer |
| NFR-SEC-007 | Credential scanning runs before every push, export, and log write that could contain asset content |
| NFR-SEC-008 | Repository files contain only placeholders for credentials |
| NFR-SEC-009 | File operations are restricted to configured repository roots, project roots, and Agent target paths |
| NFR-SEC-010 | Symlinks in imported content are rejected or explicitly reviewed; path traversal is blocked |
| NFR-SEC-011 | The app never executes Skill scripts, MCP commands, or repository hooks |
| NFR-SEC-012 | Security-relevant events are recorded in the local audit log |
| NFR-PRIV-001 | No asset content, title, path, or repository name is sent anywhere without explicit user action |
| NFR-PRIV-002 | Telemetry is opt-in and limited to event type, asset type, target type, result, OS, and version |
| NFR-PRIV-003 | Local-only paths such as global target locations never enter a Git repository |
| NFR-PRIV-004 | Users can export and delete their local data |

### 8.4 Accessibility

| ID | Requirement |
| --- | --- |
| NFR-ACC-001 | Target WCAG 2.1 AA for contrast, focus, labels, and error identification |
| NFR-ACC-002 | All primary workflows are keyboard operable |
| NFR-ACC-003 | Focus is visible and trapped within modal dialogs |
| NFR-ACC-004 | Motion respects `prefers-reduced-motion` |
| NFR-ACC-005 | Status is not conveyed by color alone; badges have text or icons |

### 8.5 Observability and audit

| ID | Requirement |
| --- | --- |
| NFR-OBS-001 | Local audit events cover all sync, dispatch, projection, security block, and rollback actions |
| NFR-OBS-002 | Logs rotate by size and age; secrets and asset bodies are redacted |
| NFR-OBS-003 | Diagnostic export includes app version, OS, database schema version, and recent errors without content |
| NFR-OBS-004 | Crash reporting is off by default and opt-in if introduced |
| NFR-OBS-005 | A local metrics panel surfaces delivery and drift counts |

### 8.6 Packaging and updates

| ID | Requirement |
| --- | --- |
| NFR-PKG-001 | Windows installer is code-signed and supports per-user install and uninstall |
| NFR-PKG-002 | macOS app is signed, notarized, and uses hardened runtime |
| NFR-PKG-003 | Auto-update verifies signatures and never downgrades without explicit consent |
| NFR-PKG-004 | Update failure leaves the installed version usable |
| NFR-PKG-005 | Third-party notices and the license are included in the installer |
| NFR-PKG-006 | The app reports its version and build channel in Settings and logs |

### 8.7 Maintainability

| ID | Requirement |
| --- | --- |
| NFR-MAINT-001 | Shared TypeScript types and schemas define the IPC boundary |
| NFR-MAINT-002 | Target adapters have fixture-based contract tests |
| NFR-MAINT-003 | Schema migrations are numbered, reviewed, and tested against a previous release database |
| NFR-MAINT-004 | Domain path and serialization logic exists once and is shared between preview and write paths |
| NFR-MAINT-005 | No vendor-specific UI branches; vendor differences are data |
| NFR-MAINT-006 | All user-facing strings are English in this phase |

## 9. Data and asset format requirements

### 9.1 Canonical repository paths

```text
prompts/<folder>/<slug>.prompt.md
instructions/<folder>/<slug>.contract.md
skills/<folder>/<skill-name>/SKILL.md
mcp/<folder>/<server-name>.json
```

Requirements:

- Folders map directly to directories and may be nested.
- The last level keeps one file per Prompt or Contract, one directory per Skill, and one JSON file per MCP server.
- File names use a safe, deterministic slug derived from the asset title unless a stable slug already exists.
- Frontmatter carries a stable ID. Renaming a title must not change identity.
- All content is UTF-8. Line endings are normalized to LF on write; existing CRLF files are accepted on read and preserved only where the target format requires it.
- Files that fail parsing are surfaced as Malformed and are never silently rewritten.
- Repository files contain only placeholders for credentials.

### 9.2 Stable identifiers

- Asset IDs are generated once and stored in frontmatter and the local database.
- IDs are globally unique within an installation and stable across machines.
- A conflict between two assets claiming the same ID is a blocking error and requires user resolution.
- Slugs are unique within a folder; duplicate slugs are a validation error.

### 9.3 Version snapshots

- Every content-changing save creates a version.
- A version stores a complete manifest of files and content hashes, not a diff.
- Version history is local and is not committed to Git by default.
- Restoring a version creates a new version; history is append-only.
- The current version cannot be deleted.

### 9.4 Local-only data

The following data must never be written into a repository:

- MCP credential values.
- Global target paths and local Agent detection results.
- Local audit history.
- Version snapshots.
- User preferences.
- AI provider keys.

## 10. UX requirements

### 10.1 Required states

Every data surface must implement:

| State | Requirement |
| --- | --- |
| Initial load | Skeleton or progress indicator; no blank flash |
| Empty, no data | Explain what the asset type is and offer a primary create action |
| Empty, filtered | Explain that filters caused the result and offer clear filters |
| Error | State the cause, the affected object, and a recovery action |
| Long-running | In-place progress with cancellation where safe; repeated submission blocked |
| Confirmation | Name the object, the target, and the consequence |
| Success | Toast with the result and any follow-up action |

### 10.2 Destructive action confirmations

At minimum, confirmation is required for delete, restore, overwrite of drifted content, bulk dispatch removal, repository disconnect, local-only withdrawal with pending changes, and restore from backup. The confirmation copy rules in [`docs/interaction-design.md`](./interaction-design.md) section 7.2 are normative.

### 10.3 Desktop layout

- Minimum supported window: 1024 x 700 logical pixels `[ASSUMPTION]`.
- The sidebar is fixed and collapsible; it is not a web-style hamburger menu at desktop sizes.
- List-detail layouts must remain usable at 1280 x 800.
- The high-fidelity breakpoints below 900 px are for completeness; the desktop app may degrade to a list-first detail sheet, but must not pretend to be a mobile app.

### 10.4 Content display

- Markdown is rendered with sanitization.
- Code blocks use a monospace font and preserve whitespace.
- Diff views distinguish additions, deletions, and context without relying on color alone.
- Long paths are truncated in the middle, never at the end, so the file name remains visible.
- Repository paths are displayed with a copy action.

## 11. Acceptance and release criteria

### 11.1 Desktop MVP exit criteria

The MVP is ready for external beta only when all of the following are true:

1. All P0 requirements are implemented and verified.
2. A fresh install on Windows and macOS completes without administrator rights.
3. A second launch focuses the existing window and never opens a second database writer.
4. A real Git repository can be connected, fetched, pulled, pushed, and resolved through all three conflict strategies.
5. No push can proceed with plaintext credentials in a Prompt, Contract, or MCP file.
6. Skill dispatch works in symlink and copy modes on both platforms, including the documented fallback.
7. MCP configuration writes preserve unrelated keys in JSON, JSONC, and TOML targets.
8. Project and global instruction projections survive hand edits, mark drift, and never bulk overwrite.
9. A schema upgrade from the previous release preserves assets, versions, sync state, projections, and dispatch records.
10. A crash during a write leaves the previous or new file intact and the app recovers on restart.
11. Logs and diagnostic exports contain no plaintext credentials or asset bodies.
12. Installers are signed, macOS is notarized, and auto-update works from the previous release.
13. The English-only language scan passes for all repository files.
14. Performance budgets are measured and recorded on reference hardware.
15. A security review of IPC, file writes, secret handling, and update integrity is complete.

### 11.2 Definition of done for a feature

- Requirement ID and acceptance criteria are linked in the change.
- Unit tests cover domain rules; integration tests cover persistence and file writes where applicable.
- Empty, loading, error, and confirmation states are implemented.
- No plaintext secret path is introduced.
- Documentation is updated.
- The build passes and the language scan is clean.

## 12. Risks, assumptions, and open questions

### 12.1 Product and business risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Platform vendors absorb cross-tool management | High | Stay vendor-neutral; invest in governance, audit, and security |
| Individual willingness to pay is low | Medium | Keep the local core complete and free; monetize team governance |
| Adapter maintenance grows without bound | High | Data-driven registry, support tiers, contract tests, deprecation policy |
| Security incident from a malicious Skill or MCP entry | Very high | Review gates, no execution, secret isolation, signed releases, incident response |
| Local-first makes measurement hard | Medium | Opt-in telemetry, local metrics panel, design-partner research |
| Desktop signing and notarization complexity | Medium | Automate release pipeline, test installers on clean machines |
| Upstream license or derivative-work risk | High | Legal review before public release `[TBD-BIZ]` |

### 12.2 Technical risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| System Git is missing or too old | Medium | Detect at onboarding, require a minimum version, provide clear guidance |
| Windows symlink and junction restrictions | Medium | Use directory junctions where possible, explicit copy fallback, per-item reporting |
| Antivirus or file locks break atomic writes | Medium | Retry with backoff, write to a temporary file in the same directory, preserve a backup |
| Native SQLite module fails after an Electron upgrade | Medium | Pin Electron and rebuild native modules in CI; test upgrade path |
| Large repositories slow down sync | Medium | Async Git operations, progress reporting, pagination, and a future LFS path |
| Renderer compromise through malicious Markdown | High | Sanitize content, strict CSP, no raw HTML, no remote navigation |
| Secret leakage through logs or crash reports | High | Redaction, structured logging, opt-in crash reporting, tests |
| Drift detection false positives | Medium | Hash-based detection with manifests and content comparison, not mtime alone |
| Schema migration data loss | High | Backup before migration, forward-only migrations, restore path, upgrade tests |

### 12.3 Open questions

| ID | Question | Owner | Needed by |
| --- | --- | --- | --- |
| OQ-01 | Minimum Windows and macOS versions and architecture matrix | Product + release engineering | Before packaging |
| OQ-02 | Project root registration UX for project-level projections `[TBD-UX]` | Design + product | Before INS-007 implementation |
| OQ-03 | Branch-plus-PR behavior in the MVP: push branch only or provider API integration | Product + engineering | Before SYN-007 implementation |
| OQ-04 | Curated catalog source and signing process | Product + security | Before CAT-001 |
| OQ-05 | AI provider list and key validation behavior | Product + engineering | Before AI-001 |
| OQ-06 | Telemetry event schema and privacy review | Product + legal | Before SET-007 |
| OQ-07 | License and update service model | Business + legal | Before public release |
| OQ-08 | Support tier assignment for each Agent target | Product + engineering | Before beta |
| OQ-09 | Whether Windows arm64 ships with the MVP | Release engineering | Before packaging |
| OQ-10 | Minimum Git version and behavior when Git is absent | Engineering | Before SYN-001 |

## 13. Traceability

| Requirement group | Interaction design reference | Architecture reference | Technical design reference |
| --- | --- | --- | --- |
| App shell | Section 4, 5 | Section 4, 5 | Frontend sections 4-6 |
| Prompts | Section 6.1 | Section 7.1, 7.3 | Frontend section 9.1, Backend sections 5.2 and 8 |
| Agent Instructions | Section 6.2 | Section 7.7, 8, 11 | Frontend section 9.2, Backend sections 5.3 and 11 |
| Skills | Section 6.3 | Section 7.5, 12 | Frontend section 9.3, Backend sections 5.4 and 10 |
| MCP | Section 6.4 | Section 7.6, 12 | Frontend section 9.4, Backend sections 5.5 and 10 |
| Git sync | Section 6.5 | Section 7.2-7.4, 9 | Backend section 9 |
| Dispatch | Section 6.5.5 | Section 7.5-7.9 | Backend section 10, Frontend section 9.5 |
| Search | Section 7.3 | Section 6.6, 10 | Backend section 14, Frontend section 9.7 |
| Security | Section 6.5.7, 7.2 | Section 9 | Backend section 18, Frontend section 12 |
| Packaging | Section 8.2, backlog | Section 13 | Tech stack section 10 |

## 14. Glossary

| Term | Meaning |
| --- | --- |
| Agent | An AI coding tool that reads instruction, Skill, or MCP configuration |
| Asset | A Prompt, Agent Instructions contract, Skill, or MCP server managed by the product |
| Contract | The canonical, tool-neutral representation of persistent Agent instructions |
| Dispatch | A one-way write of a Skill or MCP configuration into an Agent directory or configuration file |
| Projection | A write of a contract into a project-level or user-level instruction target |
| Managed block | A region in a single-file target delimited by `<!-- pk:begin ... -->` and `<!-- pk:end ... -->` |
| Drift | A target file or managed entry changed outside the app after delivery |
| Base | The last content known to be synchronized between local and remote |
| Three-way merge | A merge that compares remote, local, and base content |
| Stable ID | An asset identifier stored in frontmatter that survives renames and moves |
| Tier 1 target | An officially verified target with contract tests and a support commitment |
| WSD | Weekly Successful Deliveries, the north-star product metric |

## 15. Appendix: requirement priority summary

| Group | P0 | P1 | P2 |
| --- | --- | --- | --- |
| App shell | APP-001 to APP-009, APP-011 | APP-010 | - |
| Prompts | PRM-001 to PRM-010, PRM-013 | PRM-011, PRM-012 | - |
| Agent Instructions | INS-001 to INS-017 | INS-018 | - |
| Skills | SKL-001 to SKL-008, SKL-012 | SKL-009, SKL-010, SKL-011, SKL-013 | SKL-014, SKL-015 |
| MCP | MCP-001 to MCP-011, MCP-014 | MCP-012, MCP-013 | MCP-015 |
| Git sync | SYN-001 to SYN-015 | - | SYN-016, SYN-017 |
| Dispatch | DST-001 to DST-008 | - | - |
| Search | SRH-001 to SRH-004 | - | - |
| Settings | SET-001 to SET-009 | SET-010, SET-011 | - |
| AI | - | AI-001 to AI-003 | AI-004 |
| Catalogs | - | CAT-001, CAT-002 | CAT-003 |

**End of document.** Changes to scope, priority, or trust rules require product and engineering approval and a corresponding update to the architecture and technical design documents.
