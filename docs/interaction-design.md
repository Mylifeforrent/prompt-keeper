# Prompt Keeper Interaction Design Document

| Item | Content |
| --- | --- |
| Product name | Prompt Keeper (working name `[ASSUMPTION]`; named after the working directory; requires product confirmation before launch) |
| Version | v0.5 (folders are repo directories: directory structure alignment across the four asset types + Agent global directory dispatch + Skill / MCP two-way sync completed) |
| Date | 2026-11-18 |
| Feature source | github.com/legeling/PromptHub @ main (v0.6.2); extracted by a scripted scan of renderer components, packages/core, shared/types, spec/knowledge, and i18n entries |
| Implementation | This repository's Electron app under `src/`; the frozen visual reference is `design/prototype/` |

---

## 1. Design goals and scope

### 1.1 Product positioning

A local-first workspace for AI coding assets: **Prompt**, **Agent Instructions (AGENTS.md / CLAUDE.md / .cursor/rules, etc.)**, **Skill (SKILL.md)**, and **MCP server configuration** live in one workspace, closing the loop "organize → author → distribute / project into AI coding tools → trace versions."

v0.4 added the **Agent Instructions contract domain**. It is not a Prompt subcategory, nor a set of per-vendor modules, but an independent asset domain: one canonical contract describes "scope / activation / priority / targets", and target adapters compile it into each tool's native files. The rationale rests on three dimensions — **discovery, activation semantics, and delivery path**: persistent instructions and Prompts differ on all three, while vendors are merely different dialects of the same thing.

Since v0.2 there has been a cross-asset supply chain: **Git repo (shared source of truth) ⇄ local asset library (local control plane) → each Agent's default directory (delivery target)**. Git handles cross-machine / cross-team sharing; the local machine handles review, conflict resolution, projection, and dispatch; Agent directories are only final consumers and are never treated as a source of truth.

v0.3 explicitly brought **Prompts into Git sync**, but with a boundary different from Skill / MCP: Prompts sync as structured "one `.prompt.md` per Prompt" files, follow the repo policy by default, and can be set to local-only individually; Prompts do not enter the Agent dispatch matrix in this phase and only move between the local library and the repo.

v0.5 fixed the four most critical structural problems of the previous version: **directory structure was not a first-class citizen**, **Agent Instructions could only project to project-level targets**, **Skill / MCP lacked a stable local edit → pending push exit**, and **folders were single-level and disconnected from repo paths**. The new version makes "folders are repo directories" the shared organizational protocol for all four asset types and splits Agent Instructions delivery into two independent channels: "project projection" and "local global directory projection".

### 1.2 Design goals

1. All four asset types share one "list-detail" interaction pattern: learn one, know all four.
2. Every "dispatch / projection" action (installing a Skill to a platform, applying MCP to an Agent config, writing an instruction contract into AGENTS.md, etc.) must be explicitly confirmed and show what will be written and where.
3. Every place that "reads sensitive content" (MCP credentials) is redacted by default (`[REDACTED]`).
4. Destructive actions (delete, restore-version overwrite, bulk remove) must require confirmation and state the consequences.
5. **Git sync must never use a silent "remote overwrites local" policy**: any two-sided change must go through a three-way merge (remote / local / base), with conflicts resolved item by item.
6. **MCP secrets must never enter Git**: the repo stores only `${VAR}` placeholders; real values live only in the local keychain; plaintext must be scanned and blocked before push.
7. **Skill scripts are treated as executable code**: pulling a new Skill that contains scripts must first review its content and file list before writing it to the local library, let alone auto-distributing it.
8. **Dispatch must be traceable**: record "which version, when, written to which Agent, via symlink/copy", and support rollback.
9. **Prompt sync must be structured and individually excludable**: one `.prompt.md` per Prompt (frontmatter holds metadata and variable definitions, body split into System / User sections); private / confidential Prompts must be one click away from local-only rather than relying on the honor system of "don't commit".
10. **Prompt pulls must be previewed item by item**: Prompts feed instructions, so even without scripts they never enter batch accept; the full text or the local → repo diff must be visible before pulling.
11. **Prompt sync is not Agent dispatch**: Prompts are written only to the local asset library; projection of rule-like Prompts into `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` is handled by the separate Agent Instructions domain.
12. **Agent Instructions must be an independent domain**: persistent instructions have scope (user / project / path), activation (always / glob / model / manual), priority, imports, and other fields, which cannot be squeezed into Prompt's System / User / variable model.
13. **Vendor differences must be data, not modules**: paths, frontmatter, and priority rules for Copilot / Claude / Cursor / Windsurf / Codex, etc. converge into the target registry; duplicating a CRUD, versioning, and sync stack per vendor is prohibited.
14. **Resolution preview is a core capability**: given "target tool + current file path", the product must explain which contracts enter the context, in what order, totaling how many bytes, which are skipped, and why.
15. **Projections must be traceable and never silently overwrite**: single-file targets use managed block merging; if a target file is modified by hand it is marked Drifted, bulk overwrite is prohibited, and only per-item confirmation is allowed.
16. **Agent Instructions pulls must be previewed item by item**: instructions automatically enter the context of every session, so their risk is higher than Prompts; batch accept is prohibited.
17. **Folders are repo directories**: library folders for Prompt / Agent Instructions / Skill / MCP must map directly to Git directories; directories can contain nested subfolders, while the last level keeps the single-file or single-skill-directory convention. Users can browse by directory in the repo without opening the platform.
18. **Homogeneous organization across the four asset types**: all four types must have a folder tree, search, and repo path echo; local edits to Skill / MCP must produce stable pending-push changes, forming a real two-way sync loop.
19. **Agent Instructions global directories are configurable**: users must be able to select multiple instructions and multiple local Agents and project them to their respective user-level directories; each tool's global directory path must be editable again and restorable to default, and changes mark related projections as Stale.
20. **Global directory writes must be explainable and rollback-able**: show the target path and file content before writing; if the target file is modified by hand it is marked Drifted, bulk overwrite is prohibited, and only per-item confirmation is allowed.

### 1.3 Scope for this phase

This phase delivers a clickable high-fidelity prototype covering the four asset workspaces + Sync Center + Prompt Platform Discovery + the core loop of **structured Prompt / Agent Instructions sync** (see §8 prototype scope). WebDAV / S3 snapshots as a backup option alongside Git, CLI, multilingual support, dedicated image/video Prompt testing, relationship graphs, etc. are marked for later iterations and are not part of this phase's prototype.

### 1.4 Design decisions for the sync domain (corrections to the "Git repo + multi-Agent" understanding)

The original understanding — "maintain Skill / MCP with Git, after pulling dispatch to each Agent's default directory, Prompts are rarely synced" — is broadly right, but the following judgments must be added, or the real product will suffer data loss or security incidents:

| # | Original understanding | Judgment | Revised design |
| --- | --- | --- | --- |
| 1 | Git is the maintenance repo for Skill / MCP | ✅ Correct | Git suits file-tree assets (SKILL.md, scripts, MCP JSON/TOML) and is indeed the most common way for teams to share |
| 2 | Prompts are mostly copy-paste and rarely synced | ⚠️ Partly correct, needs revision | Prompts can be synced; only the sync unit differs: **library Prompts** (reusable templates) sync as one `.prompt.md` per Prompt, follow repo policy by default, and can be local-only individually; **private Prompts** are set to local-only; **rule-like content** has moved to the Agent Instructions domain (see §6.2) and is no longer shoved into Prompts |
| 3 | After pulling the repo, sync to multiple Agent directories | ✅ Correct, but missing the middle layer | It must be three layers: **repo ⇄ local library → Agent**; the repo must not connect directly to Agent directories, otherwise review, conflicts, drift, and auditing all disappear |
| 4 | Two-way sync | ⚠️ Needs refinement | Not pull + push but a **three-way merge**: remote / local / last-sync base; if both sides changed, it becomes a conflict and silent overwrite is prohibited |
| 5 | — | ➕ Must add | **MCP secrets**: plaintext tokens must never enter Git; the repo stores only `${VAR}`, and real values stay in the local keychain |
| 6 | — | ➕ Must add | **Trust gate**: Skills may carry executable scripts and MCP starts local processes; after pulling, review before writing to the library / distributing |
| 7 | — | ➕ Must add | **Agent detection and adaptation**: distribute only to tools installed on this machine; directories, formats, and symlink support differ per tool, so a per-target adapter is required |
| 8 | — | ➕ Must add | **Automation boundaries**: automatic fetch / read-only notifications are fine; automatic merge, automatic commit, and automatic workspace overwrite are prohibited |
| 9 | — | ➕ Must add | **Prompt sync format**: never stuff the whole library JSON into the repo. One Markdown file per Prompt, frontmatter holds metadata and variable definitions, body split into System / User, so diffs are readable and conflicts mergeable |
| 10 | — | ➕ Must add | **Prompt pull preview and credential scanning**: Prompts are instruction inputs, so pulls must be previewed item by item and never batch-accepted; before push, scan the body for high-confidence credentials and require replacement with `{{variable}}` |
| 11 | — | ➖ Explicitly excluded | **Prompts are not distributed to Agent directories**: there is no general Prompt directory convention in this phase; Git sharing only; rule-like content is handled by the Agent Instructions domain (see §6.2) |
| 12 | — | ➕ Must add | **Agent Instructions are the fourth asset type**: AGENTS.md / CLAUDE.md / copilot-instructions / .cursor/rules / .windsurf rules share "persistent, scope, activation, priority" semantics and must be modeled independently |
| 13 | — | ➕ Must add | **Vendor differences live in the target registry**: path templates, frontmatter, merge strategy, and capability switches (glob / model decision / manual / @import) are all data; adding a tool means adding one config entry |
| 14 | — | ➕ Must add | **Resolution preview and projection drift**: the same contract yields different contexts in different tools and must be previewable per path; after projecting to a target file, external manual modifications must be detected |

Therefore this phase's Sync Center handles repo sync for all four asset types, but Prompts and Agent Instructions each have their own sync scope and preview rules; Skill / MCP continue through the dispatch matrix, while Agent Instructions go through "projection and drift".

### 1.5 v0.5 gap analysis and fixes (retrospective on the current prototype)

| # | Current prototype | Problem | v0.5 fix |
| --- | --- | --- | --- |
| 1 | Prompts only have a single-level `folder` dropdown, repo path fixed at `prompts/<slug>.prompt.md` | Folder is only a filter field inside the platform; files remain flat in the repo; directories cannot be used for classification, and "browse without the platform" is not met | `folder` becomes a multi-level path; repo path unified as `prompts/<folder>/<slug>.prompt.md`, echoed in four places: folder tree, grouped cards, table column, detail path |
| 2 | Agent Instructions only have project-level targets (AGENTS.md / CLAUDE.md / .cursor/rules) | Instructions cannot be synced to the **user-level global directories** of Claude Code, Codex, Cursor, etc.; there is no visual configuration for global directories | New "Global dispatch" tab: select multiple instructions × multiple tools, write to each tool's user-level directory; each tool's path is editable and restorable to default, and global projection status is recorded |
| 3 | Skill / MCP only have pull and dispatch; local edits have no stable pending-push exit | "Two-way sync" only completed remote → local; local edits never become pending push, so the loop doesn't close | Skills gain an edit dialog and version snapshots; MCP creates a pending push on save; deleting/renaming/moving folders all update repo paths and pending-sync items |
| 4 | MCP is fixed at `mcp/servers.json` in the repo layout | One large JSON inevitably conflicts when several people add servers at once, and cannot be classified by directory | Changed to `mcp/<folder>/<name>.json`, one file per server; credentials still stored only as `${VAR}` placeholders |
| 5 | Prompt / Skill / MCP lists have no folder tree, only dropdowns or category fields | Users can only understand assets through the "current filter"; they cannot see the repo hierarchy or form a mental model of subfolders | All four workspaces gain a collapsible folder tree; selecting a parent directory includes all subdirectories; cards/tables and repo paths use the same hierarchy |
| 6 | Global directory paths are hard-coded in the target registry or docs | Install paths differ per machine; users cannot adapt their own directories, and writes fail | Global target paths become editable and are stored locally; path changes put related projections into "Stale" to avoid silently writing to the old path |

Design conclusion: **the platform's organizational model must be isomorphic to the Git repository's model**. The platform is just a more convenient editor and dispatch control plane, not the only entry point. Any folder created in the platform must appear as a same-named directory in the repo; any subfolder added in the repo must appear in the platform's folder tree after a pull.

---

## 2. Users and core scenarios

| # | Scenario | User story | Workspace |
| --- | --- | --- | --- |
| S1 | Save a useful Prompt | I wrote a tuned Prompt and want to save it, tag it, and next time copy it with one click and fill in the variables | Prompts |
| S2 | Find and install a Skill | I see a commit Skill in the Skill Store and want to preview it before installing it into Claude Code and Cursor | Skills |
| S3 | Manage MCP configuration centrally | I have one MCP config in each of 5 tools; I want to edit in one place, sync everywhere with one click, and see which were changed externally | MCP |
| S4 | Roll back a bad change | I changed a Prompt/Skill/MCP config and it got worse; I want to compare versions and roll back | All three |
| S5 | Migrate to a new machine / tool | I got a new computer or installed a new AI tool and want to distribute existing assets quickly | Skills / MCP |
| S6 | Share Skills and MCP with the team | The team maintains Skills and MCP templates in a Git repo; I want to pull updates, review them, use them locally, then push local improvements back to the repo | Sync |
| S7 | Dispatch to multiple Agents after pulling | I just pulled a batch of Skills from the repo and have Claude Code / Codex / Cursor locally; I want to see at once what's Synced, Stale, and hand-modified before dispatching | Sync |
| S8 | Share Prompt templates across machines / teams | I use the same Prompts at work and at home; I want reusable templates maintained in the repo while keeping local variable-filling habits | Prompts / Sync |
| S9 | Keep private Prompts from leaking | I have a Prompt with internal API details or personal context that should stay on my machine; other Prompts should still sync normally | Prompts / Sync |
| S10 | Review others' Prompts before pulling | The team repo updated a few Prompts; I want the full text or diff first to confirm there are no malicious instructions or my private info before accepting | Sync |
| S11 | Write a rule once, apply it in many tools | I write build, test, and security conventions as one contract and want it projected into AGENTS.md, CLAUDE.md, and Copilot at once instead of maintaining three copies | Agent Instructions |
| S12 | See which instructions a given path actually reads | I changed components under `src`; I want to know which rules Cursor / Copilot / Claude actually read, in what order, and whether the context budget is exceeded | Agent Instructions |
| S13 | Projected files were modified by hand | A colleague edited CLAUDE.md in the repo directly; I don't want it silently overwritten on re-projection and need to see the drift and confirm item by item | Agent Instructions / Sync |
| S14 | A personal Git repo as a long-term asset library | I want Prompts / instructions / Skills / MCP all placed in one personal repo by folder, so I can find them by directory after switching machines or without the platform | All workspaces / Sync |
| S15 | Multi-level folder classification | My Prompts need hierarchies like "engineering / frontend / React", not just tags; the repo should show the same directories | Prompts / Sync |
| S16 | Sync selected instructions to local global directories | I select 3 general rules and want them written into the user-level directories of Claude Code and Codex at once; the Cursor rules directory on my machine is not at the default path | Agent Instructions → Global dispatch |
| S17 | The global directory path changed | I installed Cursor in a custom directory; the platform should let me change the path and warn that previously projected files need re-syncing | Agent Instructions → Global dispatch / Settings |

---

## 3. Feature extraction summary

Below is the complete feature set extracted and consolidated from PromptHub. **The "Prototype" column = whether this phase's prototype implements it**: ✅ implemented; ⚪ static mock/placeholder; ✖ later iteration.

### 3.1 Prompt domain

| Feature | Description | Prototype |
| --- | --- | --- |
| Platform Prompt discovery | Search Prompts collected by the platform, preview, copy with variables filled, save locally; platform sources themselves do not enter the repo | ✅ |
| Git sync (optional) | One `.prompt.md` per Prompt, three-way merge with the repo; each can be set to local-only | ✅ |
| Three-state sync scope | Follow repo policy / Participate in sync / Local only; when the repo-wide switch is off everything falls back to local | ✅ |
| Structured files | frontmatter stores stable id, title, description, folder, tags, and variable definitions; body split into System / User | ✅ |
| Pull preview | Prompt changes must be previewed in full or as a "local → repo" diff; batch accept is not offered | ✅ |
| Body credential scanning | Before push, scan for high-confidence tokens / private keys; hits must be replaced with `{{variable}}` before pushing | ✅ |
| Delete boundary | Deleting a synced Prompt only removes the local copy, not the repo; the dialog must state this | ✅ |
| Three-layer organization: folders + tags + favorites | **Nested folders** (folder tree, parent includes children), multiple tags, favorites pinned | ✅ |
| Folders are repo directories | `folder` maps directly to `prompts/<folder>/<slug>.prompt.md`; card groups, table column, and details all echo the path | ✅ |
| Multi-view lists | Card / table view toggle with persisted preference; cards grouped by folder | ✅ (cards + table) |
| Full-text search | Hits in title/description/body/tags are highlighted (PromptHub uses SQLite FTS5; the prototype uses in-memory filtering) | ✅ |
| Template variables `{{var}}` | text/textarea/number/select types; a form appears on copy/test; values remembered for 30 days | ✅ |
| New/edit | Title, description, System/User Prompt, automatic variable detection, tags, folder | ✅ |
| Inline detail editing | Double-click the detail card to edit in place | ✅ |
| Version history | Auto-snapshot on every save, two-version comparison, restore, delete, change notes | ✅ |
| AI test | Pick a model, fill variables, streaming response, test history (simulated stream in the prototype) | ✅ (simulated) |
| Copy and use | Copy runs the variable form → renders the body → writes to the clipboard, usage +1 | ✅ |
| Bulk operations | Multi-select, bulk favorite/tag/move/delete | ⚪ |
| Relationships and graphs | related_to / variant_of relationships, force-directed graph view | ✖ |
| Image/video Prompts | Image generation workbench, image-to-prompt, video task polling | ✖ |
| Bilingual Prompts / AI rewrite | Sidecar English version, four preset rewrite instructions | ⚪ (button mock only) |
| Private folders | Unlock with a master password, hidden in-app | ⚪ |
| Clipboard import | Detect clipboard content and offer import | ✖ |

### 3.2 Skill domain

| Feature | Description | Prototype |
| --- | --- | --- |
| Skill Store | Built-in official/community and other sources, category filtering, search, pagination | ✅ (2 built-in sources) |
| Pre-install review | Show the full SKILL.md and file list; write only after confirmation | ✅ |
| One-click install to platform | 37 targets including Claude Code, Cursor; symlink / copy modes | ✅ (8 representative platforms) |
| Platform status echo | Per platform: Installed / Managed by this app / External / Not installed | ✅ |
| Local scan import | Discover existing SKILL.md files on the machine, preview then import | ⚪ |
| Version history | Timeline, diff, named snapshots, rollback, delete version | ✅ (reuses the shared version dialog) |
| Folder tree | Multi-level classification, mapping repo directories as `skills/<folder>/<skill>/SKILL.md` | ✅ |
| Local editing | Edit name / icon / description / tags / folder / SKILL.md; saving creates a version and a pending push | ✅ |
| Source update reconciliation | Five states in-sync / remote-ahead / local-ahead / diverged / blocked, badge on the detail page | ✅ |
| AI translation / polishing | Sidecar translation, stale badge, retranslate | ⚪ |
| Project-level workspaces | Register project directories, independent Skill spaces, two-way import | ⚪ |
| Security scan | Three-dimension content/AI scan score, high-risk second confirmation | ⚪ |
| Custom store sources | marketplace-json / git-repo / local-dir | ✖ |
| Bulk install/update/remove | Store bulk toolbar | ✖ |

### 3.3 MCP domain

| Feature | Description | Prototype |
| --- | --- | --- |
| My MCP library | Server list (gallery/list), enable/disable, favorites, tag filter, **folder tree** | ✅ |
| Folders are repo directories | `mcp/<folder>/<name>.json`, one file per server; save → pending push | ✅ |
| Three creation methods | Add from source (auto-detect command/URL/path), paste JSON config, manual form | ✅ (detection simulated) |
| Credential redaction | env/header values stored AES-256-GCM encrypted; always displayed as `[REDACTED]`; unchanged fields keep the original value | ✅ (display layer) |
| Health check | stdio missing command / invalid URL / missing env / invalid env value format → ok / warning / error badge | ✅ |
| Apply to Agent config | Preview projected content → apply to selected platforms → atomic write; cards show server count / not created / external | ✅ |
| Target sync status | Shows synced / stale / drifted / missing in the Sync → Dispatch matrix, with repair support | ✅ |
| Version history | Config changes create versions automatically; compare, notes, restore (creates a new version), current version cannot be deleted | ✅ |
| MCP Store | Official catalog + MCP Registry; details include overview / environment variables / install command; one-click add to My Library | ✅ |
| Agent reverse import | Read existing MCP configs from each tool and import external entries into My Library | ⚪ |
| Drag/paste import | Files, source directories, and GitHub URLs converted to commands; .env imported on demand | ⚪ |
| Project-level MCP | Derive targets from registered projects | ✖ |

### 3.4 Git sync and dispatch domain

| Feature | Description | Prototype |
| --- | --- | --- |
| Connect repository wizard | Four steps: Connect repository → directory mapping → sync policy → first preflight; authentication reuses system Git credentials / SSH keys | ✅ |
| Asset sync policy | Skill two-way, MCP templates two-way, Prompt structured two-way with per-item exclusion, Agent Instructions structured two-way with per-item exclusion; global Prompt and instruction switches on by default | ✅ |
| Three-way sync status | `in-sync` / `remote-ahead` / `local-ahead` / `diverged` / `blocked` / `ignored` | ✅ |
| Prompt sync files | `prompts/<folder>/<slug>.prompt.md`; stable id binds the asset so a rename doesn't split into delete + add | ✅ |
| Repo directory structure | Folder hierarchies of the four asset types map directly to repo directories; directories can contain nested subfolders, and the last level keeps the single-file convention | ✅ |
| Prompt sync scope | Follow repo / Participate in sync / Local only; status echoed in both list and details | ✅ |
| Prompt pull preview | New items show the full text, modifications show the local → repo diff; confirmation checkbox required before accepting | ✅ |
| Prompt credential scanning | Scan the body before push; hits must be replaced with `{{variable}}`; real values never touch disk | ✅ |
| Prompt delete boundary | Only deletes the local copy and withdraws pending sync items; the repo is untouched, and the item reappears on the next pull if still present remotely | ✅ |
| Prompt dispatch boundary | Prompts do not enter the Agent dispatch matrix and only move between the local library and the repo | ✅ (by design, absent) |
| Incoming review | Added / Modified; new or script-containing Skills must be reviewed item by item; Prompts and Agent Instructions always preview full text / diff and never batch-accept | ✅ |
| Pending push | Commit message, branch + PR or direct push; before pushing, scan Prompt / instruction bodies and MCP credentials and block | ✅ |
| Conflict resolution | Remote / local / base three-way comparison; take repo, keep local, or manual merge; manual merges of Prompt / instruction files must pass file structure validation | ✅ |
| Agent detection | Scan each tool's default directory and config files; by default show only installed tools | ✅ (simulated) |
| Dispatch matrix | Skill / MCP × Agent overview of synced / stale / drifted / missing / unsupported; Prompts are not included | ✅ |
| Dispatch details | Target path, install mode, MCP write preview, re-sync, remove, roll back previous version | ✅ |
| Sync history | Local audit of fetch / pull / push / conflicts / dispatch / security blocks / rollback | ✅ |
| Auto fetch | Read-only metadata fetch with difference notices, configurable interval; never auto-merges | ⚪ (setting only) |
| Multiple repositories | Bind multiple repos to one workspace, subscribe per asset | ✖ |
| Agent Instructions project projection | Compile persistent rules into AGENTS.md / CLAUDE.md / .github/instructions / .cursor/rules / .windsurf rules | ✅ (independent domain, see §6.2) |
| Agent global directory dispatch | Select multiple instructions × multiple local Agents and write to user-level global directories; paths editable, restorable to default, drifted items overwritten only after item-by-item confirmation | ✅ (see §6.2.6) |
| Git LFS / large files | Skills shipping large models or data files | ✖ |

### 3.5 Agent Instructions domain

| Feature | Description | Prototype |
| --- | --- | --- |
| Instruction contract library | Manage persistent rules centrally: title, description, body, scope, activation, priority, imports, targets, tags | ✅ |
| Unified asset model | One canonical contract, not split per vendor; one contract can select multiple targets | ✅ |
| Target registry | Six targets: AGENTS.md / CLAUDE.md / copilot-instructions / copilot path-level / .cursor/rules / .windsurf rules | ✅ |
| Scope and activation | User / Project / Path; four activation modes: always / glob / model / manual | ✅ |
| Capability switches | Whether a target supports glob, model decision, manual reference, @import; incompatibility is stated explicitly rather than silently dropped | ✅ |
| Resolution preview | Target × current file path → match chain ordered by priority, sources, byte counts, over-limit / duplicate / ignored notices | ✅ |
| Compiled preview | Generate the actual content of AGENTS.md / CLAUDE.md / .mdc / .instructions.md / Windsurf rule | ✅ |
| Single-file merging | Multiple contracts merged into AGENTS.md / CLAUDE.md / copilot-instructions using managed block markers | ✅ |
| Projection status | synced / stale / drifted / missing; single-file targets are marked as a whole | ✅ |
| Drift protection | Target files modified by hand are marked Drifted, bulk overwrite is prohibited, and rewriting requires per-item confirmation | ✅ |
| Projection actions | Project / re-project / remove / roll back previous version; preview written content | ✅ |
| Global directory configuration | User-level instruction targets for 8 local Agents; path editing / restore default / path changes marked Stale | ✅ |
| Global batch dispatch | Multi-select instructions × multi-select tools; incompatible combinations explicitly skipped; drifted items excluded from bulk overwrite | ✅ |
| Git structured sync | One `.contract.md` per contract, frontmatter stores metadata, body is the specification content | ✅ |
| Pull preview | New items show the full text, modifications show local → repo diff; never batch accept | ✅ |
| Body credential scanning | Before push, scan for `sk-...` / `ghp_...` / `AKIA...` / private key headers; hits must be replaced with `{{api_key}}` | ✅ |
| Conflict resolution | Remote / local / base three-way comparison; manual merges must pass frontmatter + body structure validation | ✅ |
| More targets | More discovery paths and formats, e.g. Gemini CLI / Aider / Warp / Junie | ⚪ |
| Exact tool behavior simulation | Invoke each tool's CLI or parse its real config to verify merge results | ✖ |
| Commands / subagents / hooks | Non-persistent artifacts such as slash commands, subagents, and hooks | ✖ |
| Project-level / multiple repositories | Project by registered project directories, subscribe one workspace to multiple repos | ✖ |

### 3.6 Common domain

| Feature | Description | Prototype |
| --- | --- | --- |
| Global toast feedback | Success/error/warning states, auto-dismiss bottom right | ✅ |
| Destructive action confirmation | Delete, restore overwrite, bulk remove require confirmation | ✅ |
| Empty states | Attributed by filter: with filters show "Clear filters"; without data show a create prompt | ✅ |
| Settings | Appearance (light/dark/system), sync policy summary, demo data reset | ✅ |
| Status entry points | Top bar repo status badge (Connected / pending count) and per-domain counts in the sidebar | ✅ |

---

## 4. Information architecture

```text
Prompt Keeper
├── Prompts (default landing page)
│   ├── My Prompts (folder tree + list / detail / sync scope dialog / edit and version popovers)
│   └── Platform Discovery (platform Prompt search, preview, copy, save locally)
├── Agent Instructions
│   ├── Contract library (folder tree + list + details / edit / versions / sync scope)
│   ├── Resolution preview (target tool × file path → match chain + compiled files)
│   ├── Project projections (projection and drift for project-level AGENTS.md / CLAUDE.md / .cursor/rules)
│   └── Global dispatch (local Agent user-level directory config + multi-select batch projection + global drift)
├── Skills
│   ├── My Skills (folder tree + grouped cards + edit / platform dispatch panel)
│   ├── Skill Store (source tabs + card grid + install review flow)
│   └── Project workspaces (placeholder)
├── MCP
│   ├── My MCP (folder tree + library list + details: config/credentials/health/versions)
│   ├── Agent MCP (current config state of each tool + reverse import)
│   └── MCP Store (catalog + details + one-click add to library)
├── Sync
│   ├── Overview (repo card / strategies for the four asset types / pending stats / Agent status / recent events)
│   ├── Changes (incoming: Prompts and instructions always previewed / outgoing / conflicts)
│   ├── Dispatch (Skill / MCP × Agent matrix; Prompts and instructions are not included)
│   └── History (repo sync / Agent dispatch / projection / security review)
└── Settings (appearance / sync policy / data / about)
```

Navigation is a fixed left sidebar with five workspaces + Settings; each workspace switches subviews with segmented tabs. The Sync Center is the cross-asset control plane: repo pull / push / conflicts all live in the Sync Center; per-asset "sync scope" and "apply to platform" entries stay on detail pages, while bulk dispatch and drift repair happen in the Sync Center. Prompts only expose sync scope on the detail page and have no Agent dispatch entry.

Since v0.5, the four asset workspaces — Prompts / Agent Instructions / Skills / MCP — all use a three-part layout: "folder tree + list/cards + details": the folder tree expresses the repo directory hierarchy, the list handles search and selection, and the details show content and repo path. Agent Instructions additionally splits out "Project projections" and "Global dispatch": the former writes rule files in the project root, the latter writes user-level directories on this machine; their statuses and drift never mix.

**Agent Instructions are an independent domain, not a Prompt subcategory, nor multiple per-vendor workspaces.** All vendor differences live in the target registry and compiler: one contract can select multiple targets, and the resolution preview explains the context actually read under different tools. Commands / subagents / hooks are not part of this domain and will be listed separately; slash commands are on-demand invocations of Prompts and should not be mixed into persistent instructions.

---

## 5. Global layout

### 5.1 Layout structure (required)

```text
┌──────────┬────────────────────────────────────────────────────────────┐
│ Sidebar  │ Top bar: breadcrumbs · global search · repo status · theme │
│ nav      ├────────────────────────────────────────────────────────────┤
│          │                                                            │
│ Prompts  │   Workspace content (list-detail split view or grid)       │
│ Instr.   │                                                            │
│ Skills   │                                                            │
│ MCP      │                                                            │
│ Sync     │                                                            │
│ Settings │                                                            │
└──────────┴────────────────────────────────────────────────────────────┘
```

- The sidebar is 220px wide and can collapse into an icon rail (fixed expanded in the prototype).
- List-detail split view: list 340px, details flexible; on small screens it degrades to "list → tap to open detail page".
- The top bar always hosts global search, focused with `/`; the repo status badge shows the repo name and pending count, and clicking it opens the Sync Center.

### 5.2 Visual tone

- shadcn/ui style: neutral colors + a single primary color (indigo), 8px radius, thin borders, low shadows.
- Light/dark themes supported; follow system is the default.
- Status color semantics: success `emerald`, warning `amber`, error `red`, info `sky`; must not be used for anything else.

---

## 6. Interaction design per workspace

### 6.1 Prompts workspace

#### 6.1.1 Entry points and sync boundary

- Two tabs at the top: **My Prompts** (local library, optional Git sync) and **Platform Discovery** (platform collection).
- "My Prompts" are local assets eligible for Git sync: default "Follow repo policy"; they participate when Prompt sync is enabled for the repo, and automatically fall back to local-only when disabled. Each Prompt can also be explicitly set to "Participate in sync" or "Local only".
- The detail page always shows a sync status badge (Synced / Repository updated / Local unpushed / Two-way conflict / Push blocked / Local only) and a "Sync" button; the button opens the sync scope dialog, and direct push from the detail page is not allowed.
- List cards and the table both show sync status, so users can spot "accidentally participating in sync" or "should sync but is local-only" without opening each item.
- "Platform Discovery" is the main reuse entry for Prompts: global search, category filtering, full-text preview, fill variables and copy directly; after saving locally, whether it participates in Git is determined by that Prompt's sync scope. Platform sources themselves never enter the repo.
- Platform cards must show an "Already local" badge; if a Prompt with the same name exists when saving locally, block the save and prompt the user to rename first or copy directly, avoiding duplicate assets.
- **Prompts are not distributed to Agent directories in this phase**: tools have no general Prompt directory convention, and forcing distribution would only create multiple copies. Rule-like content (AGENTS.md / CLAUDE.md / .cursor/rules) is handled by the independent "Agent Instructions" workspace, see §6.2; do not copy Prompts into rule files.

#### 6.1.2 List

- **Folder tree (required)**: on the left of the list, showing nested folders and the asset count at each level; selecting a parent directory includes all subdirectories; "All" and "Uncategorized" are fixed entries; the folder path is exactly the repo directory. A persistent line at the bottom of the tree says "Folders map 1:1 to repo directories" so users don't mistake them for ordinary tags.
- **Filter bar**: search box (300ms debounce, hit highlighting), tag multi-select dropdown, favorites toggle, sort dropdown (newest/oldest/title/most used), view toggle (cards/table). When a folder is selected, the list header shows the directory breadcrumb and "Back to all".
- **Cards**: grouped by folder; the group header shows the folder name, count, and `prompts/<folder>` path; each card shows title, a one-line truncated description, a two-line body preview, tags, and badges (favorite ⭐ / pinned 📌 / variable count / version / sync status). Click opens details.
- **Table**: columns = title, folder, tags, variable count, sync status, last updated; clicking a row opens details. Sync status is hidden when no repo is connected to reduce noise; "Local only" is always shown.
- **Repo path echo**: the detail header must show the full repo file path; the card component and the folder input in the edit dialog show a "→ repo path" preview below.
- **Empty states**: with filters → "No matching results" + clear filters button; no data → "Create your first Prompt" call-to-action button.

#### 6.1.3 Details (right pane)

- Header: title, description, tags (add/remove), action button group: **Copy**, **Test**, **Edit**, **Sync**, **Favorite**, **Version**, **Delete**.
- Body area: System Prompt and User Prompt in separate blocks, rendered as Markdown; **double-click a body block to edit inline**, `Esc` cancels / `⌘S` saves.
- Copy flow (must go through the variable form): detect `{{var}}` → show the variable form (required validation, defaults, larger textarea fields) → render after confirm → write to clipboard → toast "Copied, usage +1". Copy directly when there are no variables.
- After editing a synced Prompt, the local library immediately creates a new version and a pending push appears in the Sync Center; no automatic commit / push. If the same Prompt also has a remote update, the edit escalates the state to a conflict, and silent overwrite is prohibited.

#### 6.1.4 New / edit dialog

- Fields: title (required), description, System Prompt, User Prompt (at least one non-empty; validation failure blocks submission with an inline error), tag input (press Enter to add), folder, sync scope (follow repo policy / participate in sync / local only).
- The folder is a free-form multi-level path (e.g. `engineering/frontend/React`) with autocomplete from existing directories; the corresponding repo path is shown live below. Moving a folder is equivalent to moving the file in the repo; saving updates the paths of pending push items.
- When global Prompt sync is off, "Participate in sync" is disabled with an explanation; new Prompts follow repo policy by default.
- Below the body, the `{{var}}` variable list is parsed live; the `{{var:example}}` syntax takes the text after the colon as the example value.

#### 6.1.5 Version history dialog

- Left: version timeline (version number, time, change note); right: full-text preview of the selected version.
- "Compare with current version": field-by-field diff with changed lines highlighted (additions = green background / deletions = red background).
- "Restore this version" → confirmation dialog explicitly states "v{n} will overwrite the current content, and the current content will first be saved as a new version" → toast after confirmation.
- Restoring a synced Prompt also creates a pending push; if a remote update exists at the same time, it escalates to a conflict.

#### 6.1.6 AI test drawer

- A full-height drawer slides out from the right. Steps: pick a model (dropdown from the simulated model pool in Settings) → if there are variables, fill the variable form first → "Run" → simulated streaming output appears character by character in the response area.
- Below the response area, the "Test history" tab: list of past runs (model, duration, time); click to review the response.
- While running, the "Run" button becomes "Stop"; closing the drawer preserves state.

#### 6.1.7 Prompt sync (Git, optional)

**Sync scope dialog (required)**

- Opened from the "Sync" button on the detail page; shows: current effective state, repo connection / global Prompt switch, number of pending changes, repo file path.
- Three options:
  - **Follow repo policy** (default): participates when globally enabled; falls back to local-only when disabled.
  - **Participate in sync**: explicitly opt in; disabled with an explanation when the global switch is off.
  - **Local only**: no pending pushes, no pulling remote updates; if there are unprocessed changes, warn before saving that "N pending sync items will be withdrawn, repo files will not be deleted".
- After saving the scope:
  - From "Local only / Follow policy (global off)" → "Participate": if the repo has no such file yet, create a "Pending push · Added" item; if a remote copy exists, go through the normal three-way comparison.
  - From "Participate" → "Local only": withdraw that Prompt's unprocessed pending sync items and write an audit event; the repo file stays as is.
- Sync scope only controls the Git boundary and does not affect copy, variables, versions, or AI testing.

**File format (required)**

```markdown
---
id: "p-review"                 # stable identifier; renames don't split into delete + add
title: "Code Review Assistant"
description: "Review code across correctness / readability / performance / security"
folder: "engineering"
tags: ["Engineering", "Code Review"]
variables: [{"name":"code","type":"textarea","required":true}]
---

## System Prompt

You are a senior code review expert...

## User Prompt

Please review the following {{language}} code: {{code}}
```

- One Prompt per file, path `prompts/<folder>/<slug>.prompt.md`; subfolders can nest further; exporting the whole library as a single JSON is prohibited, since diffs become unreadable and conflicts unmergeable.
- The `folder` frontmatter must match the directory; when pulling from the repo, prefer frontmatter and fall back to the containing directory if missing. Moving a folder moves the repo file with it, and the stable `id` ensures it doesn't split into "delete + add".
- Only variable definitions sync (name / type / options / required); **variable values never enter files, versions, or the repo**.
- Folders and tags are frontmatter metadata and do not map to directory moves; this avoids the noise of "changing a tag = renaming a file".
- Files that fail to parse must not be written silently: they go into "Malformed" with a prompt to fix them in the repo.

**Local editing and pushing**

- Editing the title, description, body, tags, folder, or variable definitions updates the sync file; content changes also create a version snapshot.
- Local changes become "Pending push"; pushing still requires confirming the commit message and method in the Sync Center.
- Before push, the body is scanned again; high-confidence credentials (`sk-...` / `ghp_...` / `AKIA...` / private key headers, etc.) block the entire commit.
- The credential handling dialog must show "original location → replacement result"; Prompts use the `{{api_key}}` template variable, not MCP's `${VAR}`.

**Pulling and conflicts**

- Every Prompt pull must open a preview dialog: new items show the full text, modifications show the "local → repo" diff; a confirmation checkbox is required before accepting.
- Prompts never enter the "Accept selected" batch operation; this is a hard rule with no exception even when the risk is `none`.
- Conflicts are still shown as a remote / local / base three-way comparison; manually merged results must preserve the frontmatter and both body headings, and submission is blocked when the structure is incomplete.
- "Take repo" directly overwrites the local copy and creates a new version; "Keep local" and "Manual merge" both automatically create a pending push, so the result isn't forgotten on the way back to the repo.

**Deletion and withdrawal**

- Deleting a synced Prompt removes only the local copy and withdraws that Prompt's unprocessed sync items; **the repo is not modified**.
- The confirmation dialog must state "If the remote file still exists, it will reappear on the next pull"; this phase does not provide tombstone deletion pushes.

**Explicitly out of scope**

- Prompts do not enter the Agent dispatch matrix and are not written to `~/.claude`, `~/.codex`, or similar directories.
- Rule-like content (AGENTS.md / CLAUDE.md / .cursor/rules) is managed separately by the "Agent Instructions" workspace and does not reuse the Prompt `.prompt.md` format or variable model; the boundary is described in §6.2.7.

### 6.2 Agent Instructions workspace

The Agent Instructions domain handles rules that "automatically enter the context of every session": `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/*.mdc`, `.windsurf/rules/*.md`. Its difference from Prompts is not prose length but that **discovery, activation semantics, and delivery path** are all different.

#### 6.2.1 Domain model and target adapters (required)

| Object | Responsibility |
| --- | --- |
| `AgentContract` | canonical contract: title, description, body, scope, activation, priority, imports, targets, tags, sync scope, version |
| `ContractTarget` | target dialect: file path templates, format, single-file / one-contract-per-file, priority semantics, capability switches, size limits |
| `ContractProjection` | projection record of a contract on a target: status, version, previous version, time, drift note |
| `ResolvedPreview` | match chain, skip reasons, byte counts, warnings for a given target + file path |

Target registry (six in this phase, all described by data; no vendor branches in components):

| Target | Native file | Merge strategy | Supported activation | Priority / limit |
| --- | --- | --- | --- | --- |
| `agents-md` | `AGENTS.md` | single-file merge | always | nearest wins; Codex defaults to 32 KiB |
| `claude` | `CLAUDE.md` | single-file merge | always; supports `@import` | root → current directory concatenation |
| `copilot` | `.github/copilot-instructions.md` | single-file merge | always | repository-level + path-level provided together |
| `copilot-path` | `.github/instructions/{slug}.instructions.md` | one contract per file | glob (`applyTo`) | layered on top of repository-level after path match |
| `cursor` | `.cursor/rules/{slug}.mdc` | one contract per file | always / glob / model / manual | `alwaysApply` / `globs` / `description` |
| `windsurf` | `.windsurf/rules/{slug}.md` | one contract per file | always / glob / model / manual | `trigger` four states |

**Required**:

- Vendor differences may appear only in the target registry and compiler; adding vendor workspaces such as `components/copilot/` or `components/claude/` is prohibited.
- When a target doesn't support an activation mode, the UI must explicitly say "will be skipped during projection"; silently downgrading glob to always is prohibited.
- `@import` is written only to targets that support imports; unsupported targets must ignore it with an explanation.
- One contract can select multiple targets, but each target computes matches and records projection status independently.

#### 6.2.2 Contract library

- Three tabs at the top: **Contract library**, **Resolution preview**, **Projections and drift**; the contract library is the default landing.
- List filters: search (title / description / body / tags / path), scope, target, sort (last updated / priority / title).
- List cards: title, two-line description, scope badge, activation badge, target count, version, Git sync status, tags.
- Details:
  - Header: title, description, version, Git status, scope, activation, priority, tags, last updated.
  - Actions: edit, resolution preview, versions, sync, copy body, delete.
  - Info cards: effective scope explanation, activation explanation, repo file path, Claude `@import`.
  - Target cards: for each target, native path, single-file / standalone file, projection status, drift note, activation incompatibility notice.
  - Body rendered as Markdown; the body is the specification content, not split into System / User.
- New / edit fields:
  - Title (required), description, priority, scope (user / project / path), path prefix (path-level only).
  - One of four activation modes; glob mode requires at least one glob; model-decision mode requires "when to apply".
  - Multi-select targets; each target shows capability tags and incompatibility warnings.
  - `@import` one per line; body (required); tags; three-state sync scope.
- Validation failure must block saving and give field-level reasons; target incompatibility is not a save error but must show the "will be skipped during projection" list before saving.
- Version history: each save creates a snapshot; restoring creates a new version and marks related projections as "Stale" without automatically overwriting Agent directories.

#### 6.2.3 Resolution preview (required)

**Input**: target format + the file path currently being worked on (e.g. `src/components/PromptDetail.tsx`).

**Output**:

1. **Matched persistent contracts**: sorted by that target's priority semantics; each shows title, match reason (project-level always on / path-level matched glob), source file, body byte count.
2. **Warnings**: total body size exceeds the target limit (e.g. Codex 32 KiB), too many persistent contracts (> 5), duplicate lines across contracts, `@import` ignored by an unsupported target.
3. **Not included in persistent context**: with a reason per item — path scope mismatch, glob miss, target doesn't support the activation mode, model decision, manual reference.
4. **Compiled target files**: single-file targets show the merged result (including managed blocks); one-contract-per-file targets show each file's full content with frontmatter.

**Required**:

- The preview is a static simulation and does not invoke any tool CLI; the UI must state "approximate result; the tool's actual behavior is authoritative".
- The same contract may yield different results under different targets; a uniform order must not be fabricated for UI consistency.
- Model decision / manual reference are not counted in "persistent context", but the UI must explain that they are still deployed as standalone files (if the target supports it).
- Path-level contracts must satisfy both "directory prefix" and "glob"; if only one matches, the skip reason must state which condition failed.
- The preview must allow switching sample paths directly (component file / doc / README / script) so users can see match differences at a glance.

#### 6.2.4 Projections and drift (required)

**Projection status**:

| Status | Meaning | Batch policy |
| --- | --- | --- |
| `synced` | Target file matches the current contract | May skip |
| `stale` | Contract updated, target file not updated | May batch re-project |
| `drifted` | Target file modified by hand | **Bulk overwrite prohibited**; confirm item by item |
| `missing` | Not projected to this target yet | Project on demand |

**Write rules**:

- Single-file targets (AGENTS.md / CLAUDE.md / copilot-instructions) use managed blocks:
  `<!-- pk:begin <contract-id> -->` ... `<!-- pk:end <contract-id> -->`, with a generation marker at the top of the file.
- One-contract-per-file targets generate frontmatter in their own formats: Copilot path-level uses `applyTo`; Cursor uses `description / globs / alwaysApply`; Windsurf uses `trigger / globs / description`.
- When the same contract is projected to a single-file target, re-projecting rewrites the entire managed block region; other contracts' blocks stay unchanged.
- After a target file is modified by hand, only an explicit "Overwrite projection" confirmation is allowed; the confirmation dialog must show the target path, drift note, and whether the file is a merged file.
- Actions: project / re-project, remove projection, roll back previous version. Rollback affects only the target file, not the local library or repo.
- When a target doesn't support the contract's activation mode, the projection table must show "Unsupported" and disable the projection button; it must not create a projection record that will never take effect.
- Deleting a local contract does not delete already-projected target files; the projection record remains as a "Deleted" orphan that can be removed or rolled back but can no longer regenerate content.
- Bulk operations such as "sync all stale" must not overwrite drifted items.

#### 6.2.5 Git sync and security

One `.contract.md` per contract, path `instructions/<folder>/<slug>.contract.md`; `folder` is also written into frontmatter, and subfolders can nest further:

```markdown
---
id: "c-frontend"
title: "Frontend Code Standards"
description: "Applies to TypeScript / TSX files under src"
scope: "path"
path: "src"
activation: {"mode":"glob","globs":["src/**/*.{ts,tsx}"]}
priority: 60
imports: []
targets: ["copilot-path","cursor","agents-md"]
tags: ["Frontend","Standards"]
---

# Frontend Code Standards

- Function components + hooks; do not add class components.
- Use Tailwind tokens; no scattered hex colors.
```

**Required**:

- Three-state sync scope: follow repo policy / participate in sync / local only; when the global switch is off everything falls back to local-only.
- Pulling must be previewed item by item: new items show the full text, modifications show the "local → repo" diff; batch accept is not offered.
- Before push, scan the body for high-confidence credentials; hits must be replaced with `{{api_key}}`, and real values never touch disk.
- Conflicts go through a remote / local / base three-way comparison; manual merges must pass frontmatter + body structure validation, and application is blocked when the structure is incomplete.
- After "Take repo" / manual merge, related projections are marked "Stale" and are not written to Agent directories automatically.
- Deleting a synced contract removes only the local copy and withdraws pending sync items, without modifying the repo; if the remote copy still exists it reappears on the next pull.
- By default the repo only commits the canonical `.contract.md`; whether to commit tool projections is decided separately by the team, and generated artifacts must not be treated as a second source of truth.

#### 6.2.6 Global directory dispatch (new in v0.5, required)

Project-level projection answers "which rules should this repo read"; global directory dispatch answers "which rules should every project on this machine read by default". Both share the canonical `.contract.md`, but targets, paths, status, and approval are completely separate.

**Entry**: Agent Instructions → Global dispatch. The page has four sections top to bottom:

1. **Global directory configuration**: one card per local Agent showing target name, format (single file / standalone files), whether detected, number projected, and current path. The path is an input field, editable and restorable to default.
2. **Select instructions**: filter by folder + global search; each row is selectable and shows title, folder, activation, version, and "in N global directories".
3. **Projection action bar**: shows "X selected × Y directories", number of incompatible combinations, number of drifted combinations; offers "Preview written content" and "Project selected".
4. **Global projection records**: each row shows instruction, target, written path, status, version / time, and actions (re-project / overwrite / remove / roll back).

**Global target registry (8 in this phase, all paths editable)**:

| Target | Default path | Write method | Supported activation |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | single-file merge, supports `@import` | always |
| Codex CLI | `~/.codex/AGENTS.md` | single-file merge | always |
| Cursor | `~/.cursor/rules/` | one `.mdc` per contract | always / glob / model / manual |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | single-file merge | always |
| OpenCode | `~/.config/opencode/AGENTS.md` | single-file merge | always |
| Cline | `~/Documents/Cline/Rules/` | one `.md` per contract | always |
| Kiro | `~/.kiro/steering/` | one `.md` per contract | always |
| Qoder | `~/.qoder/rules/` | one `.md` per contract | always |

**Path editing (required)**:

- When `pathMode=file` the input is a full file path; when `pathMode=dir` it is a directory, and the platform generates file names as `<slug>.mdc` / `<slug>.md`.
- Paths must be absolute, starting with `~` or `/`; invalid paths show an inline error and are not written to state.
- After saving a path, all non-drifted projections under that target immediately change from `synced` to `stale`, with a note "Global directory path changed, waiting to be re-projected".
- "Restore default" also triggers Stale and does not write files automatically.
- Paths are stored in local state and never enter Git; the UI explicitly says "This is a local machine path and will not be synced to other machines".

**Batch projection rules**:

- Users select multiple instructions and multiple tools; incompatible combinations (e.g. writing a glob instruction into an AGENTS.md that only supports always) are shown as "Skipped"; silent downgrade is prohibited.
- A single-file target rewrites the entire file in one pass, including all contracts selected this time and all existing projections for that target; the preview must show the final file content.
- Drifted items are excluded from bulk overwrite. If all selected combinations are drifted, "Project selected" is disabled; if only some are drifted, the batch writes only the remaining combinations and the result explicitly says "N drifted items not overwritten".
- Each batch projection writes one audit event containing "N instructions × M global directories / skipped / drifted".

**Global projection status**:

| Status | Meaning | Batch policy |
| --- | --- | --- |
| `synced` | File matches the current contract | May skip |
| `stale` | Contract updated or path changed, file not updated | May batch re-project |
| `drifted` | Global file modified by hand | **Bulk overwrite prohibited**; confirm item by item |

**Security and boundaries (required)**:

- Global directory writes are one-way writes: they never write back to Git or modify local contracts.
- When a target file is modified by hand, only mark drift; never overwrite automatically; overwrites require per-item user confirmation.
- Deleting a local contract does not delete global files; projection records remain as "Deleted" orphans that can only be removed or rolled back.
- Changing a global directory path is not the same as moving files; the platform only updates the record and marks it Stale, leaving the actual move to the user or the next projection (simulated in the prototype).
- Do not claim to simulate a tool's merge order exactly; the UI must state "approximate result; the tool's actual behavior is authoritative".

#### 6.2.7 Explicitly out of scope

- No standalone workspace, store, or sync logic per vendor.
- Slash commands (on-demand invocations of Prompts), subagents / chat modes, and hooks / settings are not included in this phase.
- No automatic projection, no automatic overwrite of drifted items, no automatic commit / push.
- No claim of exactly simulating each tool CLI's merge results; only explainable static approximations.
- Do not reuse the Prompt System / User / variable model for persistent instructions.

### 6.3 Skills workspace

#### 6.3.1 My Skills

- **Folder tree (required)**: displayed by the `skills/<folder>/<skill>` hierarchy; selecting a parent directory includes subdirectories; cards are grouped by folder and the group header shows the `skills/<folder>` path.
- Grid cards: icon (icon_url → emoji → first-letter fallback), name, one-line description, version, small icon group of distributed platforms, source badge (Official/Community/Imported), pending push badge.
- Click a card → **Details**: instruction content rendered as Markdown + a "Dispatch platforms" panel on the right; the header shows the folder and repo file `skills/<folder>/<name>/SKILL.md`.
- **Edit (required)**: name, icon, description, tags, folder, and SKILL.md are all editable; saving creates a version and a pending push. Changing the name changes the repo directory and must warn about conflict risk; duplicate names block saving.
- Next to the detail title, a repo sync badge is shown (Synced / Repository updated / Local unpushed / Two-way conflict / Push blocked); the badge is read-only, and operations go through the Sync Center.
- Dispatch platforms panel (required):
  - One row per platform: icon, name, status badge (`Not installed` / `Installed · managed by this app` / `External install` / `Unsupported`).
  - Click a platform → "Install to platform" dialog: mode radio **symlink (synced editing)** / **copy (independent copy)** with a one-line explanation of the difference → confirm → simulated write → status badge refresh → toast.
  - Hovering an installed platform reveals "Remove".
- Version history: same pattern as the Prompt version dialog (timeline + diff + restore).
- Delete boundary: deleting a local Skill removes only the local copy and withdraws pending sync items; it does not delete the repo directory or automatically remove files already distributed to Agents.

#### 6.3.2 Skill Store

- Top: source tabs (Official picks / Community) + category filter + search.
- Cards: icon, name, author, download count, installed-state badge.
- **Install review flow (must be three steps)**:
  1. Click "Install" → review dialog shows the full rendered SKILL.md + file list + size.
  2. At the bottom, select target platforms (multi-select chips) + mode (symlink/copy).
  3. "Confirm install" → per-platform progress → result list (success/failure details) → toast.
- The "Update" entry appears only when the store version > local version; it also goes through the review flow with a per-file change summary.

### 6.4 MCP workspace

#### 6.4.1 My MCP

- **Folder tree (required)**: displayed by the `mcp/<folder>` hierarchy; selecting a parent directory includes subdirectories; list items show the folder name.
- List rows/cards: name, transport badge (stdio / http), enable switch, health badge (✓ ok / ⚠ warning / ✕ error; hover shows problem details), tags, favorite.
- Next to the detail title, a repo sync badge and folder badge are shown; the header shows the repo file `mcp/<folder>/<name>.json`.
- Repo sync actions live in the "Sync" workspace; MCP details do not repeat pull / push, but saving locally immediately creates a pending push without manual triggering.
- New / edit provides a folder input and repo path preview; one server per JSON file, avoiding conflicts in a single `servers.json` when several people add servers concurrently.
- **Details** has three sections:
  1. **Configuration**: JSON preview (credential fields shown as `[REDACTED]`) + "Copy config" + "Edit"; in edit mode, JSON validation failure blocks saving and locates the error.
  2. **Health check**: problem list (severity, field, plain-language description) + "Re-check".
  3. **Version history**: same as the shared version dialog; the current version cannot be deleted; restoring creates a new version and the toast explains "Agent configs will not be updated automatically; apply manually".
- New dialog: three tabs — **Add from source** (enter command / URL / path; auto-detect type and fill the form), **Paste config** (paste mcpServers JSON / Codex TOML, parse and preview), **Manual configuration** (name, transport, command/args/env or url/headers, folder). env value inputs have a mask toggle and are marked as encrypted storage on save.
- After saving: config changes create a version and a pending push; the folder determines the repo path; credentials remain only as `${VAR}` in the repo file, with real values staying local.

#### 6.4.2 Apply to Agent (dispatch)

- Details or list multi-select → "Apply to platforms" dialog:
  - Multi-select platform cards; each card shows current state (Not created / Synced / Externally modified / Conflict).
  - "Preview written content" expands the projected JSON for the target config file.
  - Confirm → simulated atomic write → result details → toast.
- Disabled servers cannot be distributed; the button is disabled with the reason shown.

#### 6.4.3 Agent MCP

- Cards showing each tool's current config: server count in that tool's config file, source (managed by this app / external).
- External entries have an "Import to My Library" button → after confirmation, add to the library and mark source = Imported.

#### 6.4.4 MCP Store

- Official catalog card grid + search; detail dialog: overview, what it can do, use cases, required environment variables (with descriptions and placeholder hints), install command.
- "Install to My MCP" → name uniqueness check (duplicate → error toast) → add to library.

### 6.5 Sync workspace (Git ⇄ local library → Agent)

#### 6.5.1 Three-layer model and status dictionary

```text
Git repo (shared source of truth)
   ⇅  pull / push (three-way merge)
Local asset library (local control plane, SQLite + clone directory)
   →  dispatch (one-way write, per-Agent adapter)
Each Agent's default directories (~/.claude/skills, ~/.codex/config.toml ...)
```

**Must** follow: the repo never writes directly to Agent directories; Agent directories never write back to the repo. Otherwise review, conflicts, drift, and auditing all break down.

**Prompts and Agent Instructions only use the upper segment**: repo ⇄ local library; they never enter the "local library → Agent directories" segment. Skills and MCP enter the dispatch matrix; Agent Instructions enter this domain's own "project projection" and "global dispatch", writing rule files such as `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` rather than Skill / MCP install directories.

**Repo directory structure (required in v0.5)**:

```text
prompts/<folder>/<slug>.prompt.md
instructions/<folder>/<slug>.contract.md
skills/<folder>/<skill-name>/SKILL.md
mcp/<folder>/<server-name>.json
```

- Folder paths of the four asset types are reused directly as repo directories; directories can contain nested subfolders.
- The last level keeps the single-file / single-skill-directory convention: one `.md` per Prompt and instruction, one directory per Skill, one `.json` per MCP server.
- The platform and the repo share one hierarchy: after creating a folder in the platform, the next push creates a same-named directory in the repo; after adding a subdirectory in the repo, a pull makes it appear in the folder tree.
- MCP no longer uses a single `servers.json`, avoiding concentrated conflicts when several people add servers concurrently.

Asset-level sync status (detail badge + changes list):

| Status | Meaning | Allowed actions |
| --- | --- | --- |
| `in-sync` | Matches the repo | None |
| `remote-ahead` | Repo has a newer version | Pull after review |
| `local-ahead` | Local has unpushed changes | Push |
| `diverged` | Both sides changed (including simultaneous incoming / outgoing) | Resolve conflict |
| `blocked` | Hit a security policy (plaintext secret / credential) | Handle first, then push |
| `ignored` | Prompt / instruction set to local-only, or sync disabled for that type | Can be explicitly enabled in sync settings / repo settings |

Agent dispatch status (matrix cells):

| Status | Meaning | Batch policy |
| --- | --- | --- |
| `synced` | Agent directory matches the library | May skip |
| `stale` | Library updated but Agent not updated | May batch sync |
| `drifted` | Agent directory modified by hand | **Bulk overwrite prohibited**; confirm item by item |
| `missing` | Not yet distributed to that Agent | Distribute on demand |
| `unsupported` | The tool doesn't support this asset type | Display only, no write |

Risk markers: `none` (low risk), `scripts` (contains executable scripts), `secrets` (contains plaintext secrets), `network` (network access).

#### 6.5.2 Connect repository wizard (must be four steps)

1. **Connect repository**: repo address (`owner/repo` or full URL), branch, authentication method (system Git credentials / SSH key / one-time token), local clone mode (app-managed / bind existing clone), local path. Authentication information is not written to the app database; system credentials or the SSH agent are reused.
2. **Directory mapping**: auto-detect `skills/`, `mcp/`, `prompts/`, `instructions/`; allow overrides. The wizard must show directory examples: `prompts/engineering/code-quality/review.prompt.md`, `instructions/team/frontend/frontend.contract.md`, `skills/dev-workflow/git/commit-helper/SKILL.md`, `mcp/development/github/github.json`. The Prompt directory note must state: nested subfolders are allowed, one `.prompt.md` per Prompt, frontmatter holds metadata and variable definitions. The Agent Instructions directory note must state: nested subfolders are allowed, one `.contract.md` per contract, frontmatter holds folder / scope / activation / targets, and the body is the specification content. The MCP directory note must state: one `<name>.json` per server, credentials stored as `${VAR}` only. Show separate switches for "Include Prompts in repo sync" and "Include Agent Instructions in repo sync", both on by default; individual items can still be set to local-only. Unmatched assets go into "Unfiled" and must never be silently dropped.
3. **Sync policy**: read-only fetch interval (5 / 15 / 30 / 60 minutes, with a toggle), push method (separate branch + PR / push directly to the current branch), credential policy notes for MCP / Prompt / Agent Instructions (must be shown in full; collapsing or hiding is not allowed).
4. **First preflight**: remote asset count, script-containing Skills, Prompt and `.contract.md` file structure validation, credential scan results (Prompt / instruction bodies + MCP env / headers), uncommitted local clone changes; the user must check "I have confirmed the repo source and understand that scripts and MCP commands will execute on this machine" before the connection can be completed.

Disconnecting removes only the sync relationship and does not delete local assets, version history, or distributed files; a confirmation with that statement is required.

#### 6.5.3 Overview

- **Repo card**: repo name, private indicator, branch, last fetch / last merge, local clone path, auth method; actions `Fetch now`, `Push...`, `Settings`; shows ahead / behind and push method.
- **Asset strategy cards × 4**: Skills "two-way sync", MCP "templates both ways · secrets local", Prompts "per-Prompt participation · local-only allowed", Agent Instructions "per-contract participation · independent projection confirmation"; each card states a one-line reason, pending count, and local-only count.
- **Security block banner**: shown at the top when plaintext credentials exist (Prompt / instruction bodies or MCP env / headers); clicking it jumps to the changes list.
- **Stat cards × 4**: incoming / outgoing / conflicts / dispatch pending; the first two must separately show the counts for Prompts and Agent Instructions, so rule-related changes aren't drowned out by Skill / MCP numbers.
- **Local Agents**: list only detected tools; each shows default directory and pending count; provide "Re-detect" and "Manage dispatch". Undetected tools do not appear in the default matrix.
- **Recent sync**: the last 5 events; clicking opens History.

#### 6.5.4 Changes (incoming / outgoing / conflicts)

- A fixed explanation of the three-way merge model at the top, so users don't mistake "sync = overwrite".
- **Incoming**: each row shows asset type, name, change type (Added/Modified), version change, summary, path, added/deleted lines, risk badge; low-risk Skills / MCP can be accepted directly, while **Prompts, Agent Instructions, and new or script-containing Skills must be "Preview and accept"**.
  - Review dialog: risk description, file list and sizes, full SKILL.md (Markdown rendered), trust checkbox; accepting is blocked until checked.
  - Prompt preview dialog: new items show the full `.prompt.md` text, modifications show the "local → repo" diff; the user must check "I have previewed the full text and confirm it is safe and contains no private information".
  - Agent Instructions preview dialog: new items show the full `.contract.md` text, modifications show the "local → repo" diff; the copy must explain that "instructions automatically enter the context of every session", and acceptance requires a confirmation checkbox.
  - The bulk "Accept selected" action applies only to low-risk Skills / MCP; **Prompts and Agent Instructions never appear in batch accept**, and new or script-containing Skills must be reviewed item by item.
- **Outgoing**: each row is selectable; "Push selected" opens the push dialog — commit message, branch + PR / direct push, and a note about the second credential scan.
  - Blocked rows have no checkbox and only show "Handle credentials". The handling dialog shows the original location and replacement result: MCP uses `${VAR}`, Prompts / Agent Instructions use `{{variable}}`; real values stay in the keychain or are entered temporarily by the user when copying. After conversion, the item becomes a normal pending push.
- **Conflicts**: each row shows remote / local / base versions; action "Resolve conflict".
  - Conflict dialog: three version cards + three strategies (Take repo / Keep local / Manual merge) + the corresponding diff (remote vs. base, local vs. base) or an editable merged text.
  - Take repo: the local library updates and the repo becomes the base; Keep local / Manual merge: write to the local library and **automatically create a pending push change**, so the user doesn't forget to push the result back to the repo.
  - Manual merges of Prompts must preserve the frontmatter and both System / User headings; manual merges of Agent Instructions must preserve the frontmatter and body; "Apply and mark resolved" is disabled when structure validation fails.
  - Silent last-write-wins is prohibited.

#### 6.5.5 Dispatch matrix

- **Prompts and Agent Instructions do not appear in this matrix**: Prompts only do Git sync, and Agent Instructions go through "Agent Instructions → Projections and drift"; if users look for these two asset types in the filter, the copy should point to "Prompts → Sync" and "Agent Instructions → Projections and drift" respectively.
- Rows = Skill / MCP in the local library; columns = detected Agents (toggle "Show undetected Agents").
- Filter by asset type (All / Skills / MCP) and "Only anomalies"; the top shows detected count, stale count, drifted count.
- Cell status colors follow the global semantics: success / warning / danger / outline; unsupported shows "Unsupported", not "Missing".
- Clicking a cell opens dispatch details:
  - Target path (generated per tool convention), current version, deployment time, mode (symlink / copy), drift note.
  - MCP must show the write preview, with env / headers always `[REDACTED]`; explain that real secrets are injected at write time.
  - Actions: dispatch / re-sync, switch mode, remove dispatch, roll back to previous version (only when previousVersion exists).
  - **Disabled MCP servers cannot be dispatched or re-synced**; the button is disabled with a reason.
- The bulk "Sync all stale" only handles `stale`, never `drifted`; afterwards the toast explicitly says "Drifted items were not overwritten".
- symlink is the default mode; falling back to copy on failure must be reported item by item, never silently.

#### 6.5.6 History and rollback

- Event types: fetch / pull / push / conflict / deploy / blocked / review / connect / rollback; each includes time, result, summary, and target.
- History is stored locally only, to trace "which version was distributed to which Agent"; Git commit history remains authoritative in the repo.
- Adding / withdrawing a Prompt sync scope, deleting a synced Prompt, and credential replacement all write review-type events, to explain "why a Prompt no longer appears in pending push".
- Adding / withdrawing Agent Instructions, deleting, resolving conflicts, projecting / re-projecting / overwriting drift / rolling back also write review-type events, to explain "which rule, which version, written to which target file".
- Supports filtering and log export by "repo sync / Agent dispatch / security and review".
- Rollback of a dispatch affects only Agent directories, not the local library or the repo; the UI must state this.

#### 6.5.7 Automatic sync and security boundaries (required)

| Action | Policy |
| --- | --- |
| Auto fetch | Allowed, read-only; only reports differences, never auto-merges |
| Auto pull / overwrite local | Prohibited |
| Auto commit / push | Prohibited; pushing must be confirmed by the user in the push dialog |
| Auto write to Agent directories | Prohibited; dispatch and projection must be explicitly triggered |
| Bulk overwrite drifted | Prohibited; item-by-item confirmation required |
| Push plaintext secrets to Git | Prohibited; scanned and blocked before push |
| Push Prompt / Agent Instructions bodies with suspected credentials to Git | Prohibited; must be replaced with `{{variable}}` |
| Batch-accept Prompt / Agent Instructions pulls | Prohibited; full text / diff preview required item by item |
| Projection artifacts becoming a second source of truth | Prohibited; only canonical `.contract.md` is committed by default |
| New / script-containing Skills entering the library directly | Prohibited; review required first |

---

## 7. Common interaction specs

### 7.1 Feedback (required)

| Scenario | Form |
| --- | --- |
| Success (copy/install/apply/save/restore) | Success toast, auto-dismisses after 2.5s, stacked bottom right |
| Failure | Error toast + specific reason; form errors shown inline |
| Long-running actions (simulated install/dispatch/streaming) | Spinner inside the button; repeated clicks prohibited |
| Background status refresh | Badges/counts update in place without a full page refresh |

### 7.2 Confirmation and destructive actions (required)

- Deleting a Prompt / Agent Instructions / Skill / MCP server or a version: confirmation dialog with a red primary button that names the object in the copy.
- Deleting a synced Prompt or Agent Instructions: must additionally state "Only the local copy is deleted; the repo is not changed; if the remote still exists it will reappear on the next pull".
- Deleting a projected Agent Instructions item: must additionally state "Files already written to Agent directories will not be deleted automatically" and show the projection count.
- Changing a Prompt / Agent Instructions from "Participate in sync" to "Local only": if there are unprocessed changes, must warn "N pending sync items will be withdrawn; repo files will not be deleted".
- Replacing credentials in a Prompt / Agent Instructions body: the handling dialog must show the original location and the `{{variable}}` replacement result, and state that real values never touch disk.
- Overwriting a drifted projection: the confirmation dialog must show the target path, drift note, and whether the target is a multi-contract merged file; bulk overwrite is prohibited.
- Overwriting global directory drift: the confirmation dialog must show "local user-level path" and "only affects this Agent's global file", and note that it can be rolled back.
- Editing / restoring a global directory path: no destructive confirmation, but an inline notice that "related projections will be marked Stale" is required; invalid paths cannot be saved.
- Batch global projection: the result must state the success count, the number of skipped incompatible combinations, and the number of drifted items not overwritten; masking skips with "all succeeded" is prohibited.
- Removing a single projection: the confirmation dialog states the target path and that "the local library / repo are unaffected"; for merged files, it also notes that other contracts remain untouched.
- Restoring a version: the confirmation dialog states the overwrite semantics.
- Bulk removing dispatches: the confirmation dialog lists the number of affected platforms.
- Disconnecting the repo: the confirmation dialog states "Only the sync relationship is removed; local assets, version history, and distributed files are not deleted".
- Resolving a conflict: a strategy must be explicitly chosen; Take repo must warn "local changes will be discarded", and Keep local must warn "the result will become a pending push".
- Removing a single Agent dispatch: the confirmation dialog states the target path and notes that the local library and repo are unaffected.
- Rolling back a dispatch: the confirmation dialog states that only Agent directories are rolled back, not the repo or local library.
- Pushing: one-click silent push is prohibited; commit message and push method must be confirmed in the push dialog.

### 7.3 Keyboard shortcuts

| Key | Behavior |
| --- | --- |
| `/` | Focus global search |
| `N` (in list view) | Create an asset in the current domain |
| `Esc` | Close the topmost overlay / exit inline editing |
| `⌘Enter` | Submit inside a dialog |
| Double-click detail body | Enter inline editing |

### 7.4 Empty states and loading

- Empty states distinguish "no data" (guide creation) from "no matches" (clear filters); showing only a gray illustration is prohibited.
- Sync-related empty states must explain the cause: repo not connected → guide to connect; connected but no changes → "differences will appear here after fetch"; no conflicts → "appears only when both sides change the same file"; empty dispatch filter → suggest relaxing the filter.
- Prompt sync empty state: when all Prompts are local-only, the strategy card says "No Prompts are currently participating in repo sync" and offers "Go to Prompts to set sync scope"; when the repo has Prompt sync disabled, the sync dialog on the detail page explains where the global switch is, instead of showing "Synced".
- Agent Instructions empty states: with no contracts, guide to create one; when the resolution preview has no matches, explain "No persistent contracts match the current path" and suggest checking scope / glob / target capabilities; when projections are empty, guide to the contract library to select targets; when the drift filter is empty, explain "Target files have not been modified by hand".
- A 300ms skeleton screen is allowed on first entry to each workspace (the prototype renders directly; the real product connects to SQLite).

---

## 8. Prototype scope and implementation notes

> **Historical note:** this section records the original browser prototype stage. It is retained as design context. The shipped implementation is the Electron application described in [`architecture.md`](./architecture.md); the frozen visual reference is [`design/prototype/`](../design/prototype/README.md).

### 8.1 Tech stack

React 19 + TypeScript + Vite + Tailwind CSS v4; shadcn/ui-style component source included (`src/components/ui/`), no runtime component library. State uses React built-in hooks + Context; data is in-memory seed data + localStorage persistence (key `pk_state_v1`), resettable with one click in Settings.

Sync domain seeds are centralized in `src/data/syncSeed.ts`: one connected repo, 15 three-way changes (including 1 Skill conflict, 1 Prompt conflict, 1 instruction conflict, 2 credential blocks), 13 dispatch records, 9 history entries, 6 local Agents, 6 platform Prompts. Agent Instructions seeds are centralized in `src/data/contractSeed.ts`: 6 contracts, 10 project projection records, 3 instruction sync changes; the target registry is in `src/data/contractTargets.ts`. Global directory targets and global projection seeds are in `src/data/globalTargets.ts`: 8 local Agent targets, 5 global projections. The folder tree, repo paths, and reverse directory mapping live in `src/lib/folders.ts`; repo paths for Prompt / instructions / Skill / MCP are generated by `promptSync.ts` / `contracts.ts` / `skills.ts` / `mcp.ts` respectively. `load()` migrates older localStorage to v0.5 (`schemaVersion=4`): fills in `folder`, adds global directories and global projections, migrates the old `mcp/servers.json` to an `mcp/` directory, and recomputes pending-sync paths from current folders, preventing blank screens or mislocated asset paths after upgrades.

### 8.2 Differences from the real product (must know)

- The prototype has no backend: it doesn't connect to SQLite / Electron / a real filesystem; "Install to platform" and "Apply to Agent" only change in-prototype state and give result feedback.
- **All Git operations are simulated**: no clone / fetch / pull / commit / push, no real PRs; ahead / behind, commit hashes, and PR numbers on the repo card are demo data.
- **Prompt and Agent Instructions sync files are genuinely serialized**: `.prompt.md` and `.contract.md` frontmatter / body, parsing, diff, and "local → repo" content are generated in frontend memory; real repo files are not read or written.
- **Folder trees and repo paths are genuinely computed**: `folder` → repo directory mapping, reverse path → folder inference, and multi-level tree counts are all computed in memory; no real `git mv` is executed.
- **Target files are compiled into real strings**: the frontmatter, managed blocks, and merge order of `AGENTS.md` / `CLAUDE.md` / `.instructions.md` / `.mdc` / Windsurf rules are generated in the frontend; nothing is written to real Agent directories.
- **Resolution preview is a static approximation**: it sorts and filters by known rules in the target registry, doesn't invoke any tool CLI, and doesn't parse its real config; the UI must state the approximate nature.
- **Prompt / Agent Instructions credential scanning is a high-confidence regex simulation**: it covers common patterns such as `sk-...`, `ghp_...`, `AKIA...`, and private key headers, but is not equivalent to full secret scanning; the real product should combine entropy detection, allowlists, and manual confirmation.
- **All Agent writes are simulated**: no symlinks are created, nothing is written to `~/.claude/skills`, `~/.codex/config.toml`, `AGENTS.md`, or any global directory; drift detection, project projection, global dispatch, and rollback only update prototype state.
- **Global directory path editing is genuinely persisted**: path changes are saved in localStorage and drive state and path previews, but the real filesystem is not validated and files are not moved.
- AI testing is simulated streaming output without real network requests.
- Search is in-memory substring matching, not FTS5; Platform Discovery uses built-in seed data, not a real remote search.
- Credential redaction is a display-layer behavior only; the prototype has no real encryption or keychain; secret conversion only changes state and copy.

### 8.3 Acceptance checklist

1. All four asset workspaces — Prompts / Agent Instructions / Skills / MCP — complete the "browse → details → edit → versions" loop; Skill / MCP additionally complete the "dispatch" loop, Agent Instructions additionally complete the "resolution preview → projection → drift" loop, and Prompts have no Agent dispatch entry.
2. Copying a Prompt always opens the variable form (when variables exist).
3. Store installation goes through the three-step review flow.
4. Credentials in MCP configs are always displayed as `[REDACTED]`.
5. All destructive actions require confirmation.
6. Light/dark theme switches instantly.
7. Data survives page refresh (localStorage).
8. The Sync Center completes the "Overview → incoming review → conflict resolution → push → dispatch → History" loop.
9. New or script-containing Skills cannot be batch-accepted directly and must open the review dialog with a trust checkbox.
10. MCP pending push items with plaintext secrets are blocked; after conversion to `${VAR}` they enter the normal push flow.
11. The dispatch matrix correctly distinguishes synced / stale / drifted / missing / unsupported; "Sync all stale" does not overwrite drifted.
12. Disabled MCP servers cannot be dispatched / re-synced in dispatch details.
13. Prompt details allow setting the sync scope; local-only Prompts show "Local only" and create no pending pushes; Platform Discovery supports copy (with variable form) and save locally.
14. Disconnecting the repo removes only the sync relationship; local assets and dispatch records remain.
15. After editing a synced Prompt, the local library creates a new version and a pending push appears in the Sync Center; if a remote update also exists, the state escalates to a conflict instead of a silent overwrite.
16. Incoming Prompts must open a preview (full text for new / diff for modified) and never appear in batch accept; the accept button is disabled until the confirmation checkbox is checked.
17. Prompt conflicts support Take repo / Keep local / Manual merge; an incomplete manual merge structure blocks application, and a successful application creates a pending push.
18. Prompt bodies with suspected credentials are blocked; after replacement with `{{api_key}}` the normal push flow is available, and the original value no longer appears in the body.
19. Deleting a synced Prompt removes only the local copy and withdraws pending sync items; the dialog explicitly states the repo files are unaffected.
20. Sync Center strategy cards and stats correctly show Prompt pending counts and local-only counts; after disabling Prompt sync in the repo wizard, all Prompt states fall back to local-only.
21. After a page refresh, Prompt / Agent Instructions sync scopes, pending push / conflict states, and versions are preserved (localStorage v3 migration works).
22. The Agent Instructions workspace can create contracts, select multiple targets, and generate a version on save; after editing the body or metadata, related projections change from `synced` to `stale` without automatically writing to Agent directories.
23. When the resolution preview selects `cursor` and `src/components/PromptDetail.tsx`, it matches "Repository Conventions" and "Frontend Code Standards"; switching to `README.md` puts the frontend rule in the skip list because the path scope / glob doesn't match; when selecting `agents-md`, the frontend rule is explicitly marked as skipped because the target doesn't support glob.
24. The resolution preview's skip list distinguishes: path scope mismatch, glob miss, target doesn't support the activation mode, model decision, manual reference.
25. Single-file targets (AGENTS.md / CLAUDE.md / copilot-instructions) generate content containing managed blocks and a generation marker; per-contract targets generate frontmatter (`applyTo` / `globs` / `alwaysApply` / `trigger`).
26. The projection and drift page correctly distinguishes `synced` / `stale` / `drifted` / `missing`; `drifted` is excluded from batch operations and requires a second confirmation to "Overwrite and project"; targets with incompatible activation modes show "Unsupported" and cannot be projected.
27. Projection details show the target path, written content, version, and time, and support re-project, remove, and roll back previous version; after deleting a local contract, the projection record remains as a "Deleted" orphan and target files are not automatically deleted.
28. Incoming Agent Instructions must open a preview (full text for new / diff for modified) and never appear in batch accept; the accept button is disabled until the confirmation checkbox is checked.
29. Agent Instructions conflicts support Take repo / Keep local / Manual merge; a manual merge missing frontmatter or body blocks application, and a successful application creates a pending push.
30. Agent Instructions bodies with suspected credentials are blocked from pushing; after replacement with `{{api_key}}` normal push works; Sync Center strategy cards and stats correctly show instruction pending counts and local-only counts.
31. When creating / editing a Prompt, a multi-level folder can be entered; after saving, the folder tree shows the corresponding hierarchy, and card groups and the table folder column update accordingly.
32. Prompt repo paths follow folder changes: `prompts/engineering/code-quality/review.prompt.md` matches the detail page and edit dialog preview; paths of existing pending push items update too.
33. When creating / editing Agent Instructions, the folder is written into frontmatter and `instructions/<folder>/<slug>.contract.md`; when pulling from the repo without a folder, it is inferred from the path.
34. The Skills workspace shows the folder tree and grouped cards; after editing SKILL.md or the folder, a version is created and a pending push appears, and the path becomes `skills/<folder>/<name>/SKILL.md`.
35. The MCP workspace shows the folder tree; each server's repo path is `mcp/<folder>/<name>.json`; after saving the config a pending push is created, and repo content contains only `${VAR}`.
36. Agent Instructions → Global dispatch allows selecting multiple instructions × multiple tools; incompatible combinations show as skipped, and drifted items are excluded from bulk overwrite.
37. The Global dispatch page allows editing each tool's global directory path; invalid paths cannot be submitted; after saving, non-drifted projections under that target become "Stale".
38. After restoring the default global path, the path shows the default value, related projections remain Stale, and no files are written automatically.
39. Global projection previews show the final files: single-file targets include all contracts already projected to that target plus those selected this time; per-contract targets are shown file by file.
40. Global projection records support re-project, per-item drift overwrite, remove, and roll back; after deleting a local contract the record remains as "Deleted" and global files are not automatically deleted.
41. The Sync Center shows the "folders are repo directories" structure example; the repo wizard shows multi-level directory examples for the four asset types and the MCP one-server-one-file convention.
42. The Settings page shows all Agent global directory paths; after upgrading older localStorage, folder, global directories, and pending-sync paths are all migrated correctly.

---

## 9. Backlog (by priority)

1. **Multiple repositories and subscriptions**: bind multiple repos to one workspace; subscribe by asset source (team / personal / read-only upstream); explicit archiving process for unfiled assets in the repo.
2. **Sync enhancements**: Git LFS, binary files, rename detection, per-file / hunk merging; PR review status echo; upstream read-only mode.
3. **Dispatch enhancements**: more Agent adapters and project-level directories (`./.claude/skills`, `./.agents/skills`); reverse import of drift into the local library; row-level diff and bulk result details for dispatches.
4. **Agent Instructions enhancements**: more target adapters (Gemini CLI / Aider / Warp / Junie / Kiro), tool CLI behavior verification, project-level directories and multiple repos, rule conflict detection (semantic level) and merge suggestions.
5. **Prompt sync enhancements**: folder-level sync policies (team folders / personal folders), tombstone deletion push, structured diff of variable definitions, rename detection and batch confirmation.
6. **Prompt / instruction content security**: beyond credential regex, add entropy detection, example-value allowlists, AI instruction injection warnings, and source reputation.
7. **Real Platform Prompts**: remote search, publishing / team spaces, versions and ratings; currently built-in seeds only.
8. Full bulk-operation suite: multi-select, bulk tagging, bulk dispatch with result details.
9. Prompt relationship graph and image / video generation workbench.
10. Skill local scanning, source status expansion, security scan reports (content / AI three-dimension scoring).
11. MCP drag / paste import, on-demand .env import, dependency connectivity probing.
12. Private folders and master password.
13. WebDAV / S3 snapshots as backup options alongside Git (upload only, never overwrite).
14. CLI and desktop app (Electron + SQLite + FTS5) implementation.
15. **Non-persistent Agent artifacts**: slash commands (as a Prompt projection target), subagents / chat modes, hooks / settings, modeled independently and never mixed with persistent instructions.
