# Prompt Keeper

A local-first workspace for Prompt, Agent Instructions, Skill, and MCP assets, and the sync / projection / dispatch control plane for **Git repo ⇄ local library → multiple Agents** — an interactive product prototype.

Features are extracted from the Prompt / Skill / MCP management domains of [PromptHub](https://github.com/legeling/PromptHub) (v0.6.2). v0.2 added the Git sync and Agent dispatch layer, v0.3 brought Prompts into structured sync, and v0.4 introduced the standalone Agent Instructions contract domain. v0.5 unified all four asset types under "**folders are repo directories**": directories can contain nested subfolders, and the last level keeps the single-file / single-skill-directory convention. It also added **local global-directory dispatch for Agent Instructions with editable paths**, and completed the local edit → pending push loop for Skill / MCP. The interaction design is documented in [docs/interaction-design.md](./docs/interaction-design.md).

## Run

```bash
npm install
npm run dev        # dev preview, default http://localhost:5173 (auto-increments when the port is taken)
npm run build      # type check + production build
```

Requires Node 18+. The prototype has no backend: data lives in browser localStorage (key `pk_state_v1`, schema v4), and the Settings page can reset to demo data in one click.

## Core design

```text
Git repo (shared source of truth; folders are the directory structure)
   ⇅  pull / push: three-way merge, conflicts resolved explicitly
Local asset library (local control plane, same folder tree)
   →  dispatch: one-way write for Skill / MCP, adapted to each Agent's default directory
   →  project projection: Agent Instructions compiled to AGENTS.md / CLAUDE.md / .cursor/rules, etc.
   →  global dispatch: Agent Instructions written to each tool's user-level global directory (editable paths)
Agents (Claude Code / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder)
```

- **Folders are repo directories**: the `folder` of all four asset types maps directly to a Git directory, and directories can contain nested subfolders; you can browse by directory in the repo even without opening the platform.
- **Skill**: two-way sync; organized as `skills/<folder>/<name>/SKILL.md`; editable locally, saving produces a version and a pending push; pull, review, then distribute.
- **MCP**: two-way sync; one server per `mcp/<folder>/<name>.json`, the repo stores only `${VAR}` templates and plaintext secrets are never committed to Git; real values live only in the local keychain.
- **Prompt**: an optional Git-synced asset; path `prompts/<folder>/<slug>.prompt.md`, metadata in frontmatter, body split into System / User sections. Each Prompt can be set to "local only" individually, and is never written to Agent default directories.
- **Agent Instructions**: a standalone asset domain. A canonical `.contract.md` describes folder / scope / activation / priority / imports / targets, and target adapters compile it into each tool's native format; supports resolution preview, project-level managed block merging, projection drift detection, and item-by-item overwrite confirmation.
- **Agent global directory dispatch**: select multiple instructions × multiple local Agents and write them to their user-level directories; paths are editable and can be restored to default, and path changes mark related projections as Stale.
- **Dispatch / projection**: Skill / MCP default to symlink, falling back to copy on failure; files modified by hand inside an Agent are marked "Drifted" and are never bulk-overwritten. The same applies to project projections and global dispatch: drifted items must be confirmed individually.

### Repository directory structure

```text
prompts/engineering/code-quality/review.prompt.md
instructions/team/frontend/frontend.contract.md
skills/dev-workflow/git/commit-helper/SKILL.md
mcp/development/github/github.json
```

- Folder paths are repo directories; directories can contain nested subfolders.
- The last level keeps the single-file convention: one `.md` per Prompt / instruction, one directory per Skill, one `.json` per MCP server.
- The platform and the repo share one hierarchy: create a folder in the platform → after a push, a same-named directory appears in the repo; add a subdirectory in the repo → after a pull, it appears in the folder tree.

### Prompt sync file

```markdown
---
id: "p-review"
title: "Code Review Assistant"
description: "Review code across correctness / readability / performance / security"
folder: "engineering/code-quality"
tags: ["Engineering","Code Review"]
variables: [{"name":"code","type":"textarea","required":true}]
---

## System Prompt

You are a senior code review expert...

## User Prompt

Please review the following {{language}} code: {{code}}
```

Pulling Prompts always requires previewing each item (batch accept is not offered); before pushing, the body is scanned for high-confidence credentials, and hits must be replaced with `{{variable}}`. Conflicts still go through a remote / local / base three-way comparison, and manually merged results must preserve the file structure above.

### Agent Instructions sync file

```markdown
---
id: "c-frontend"
title: "Frontend Code Standards"
description: "Applies to TypeScript / TSX files under src"
folder: "team/frontend"
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

- One contract per `.contract.md`, path `instructions/<folder>/<slug>.contract.md`; the body is not split into System / User.
- Target registry in `src/data/contractTargets.ts`: AGENTS.md, CLAUDE.md, copilot-instructions, Copilot path-level, Cursor `.mdc`, Windsurf rule.
- Global directory targets in `src/data/globalTargets.ts`: Claude / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder; each target path is editable and written to the local machine's user-level directory.
- Resolution preview computes the match chain, skip reasons, byte budget, and duplicate lines for "target + file path"; the compiled preview generates each tool's native content.
- Single-file targets are merged using `<!-- pk:begin/end -->` managed blocks; if the target file is modified by hand it is marked Drifted and bulk overwrite is prohibited.
- Project projection and global directory dispatch are separate: the former writes to the project root, the latter to user-level directories; global paths are stored locally and never enter Git.
- Pulling instructions must be previewed item by item; credentials are also scanned before pushing. By default the repo only commits the canonical `.contract.md`; generated artifacts are not treated as a second source of truth.

## Prototype coverage

| Workspace | Interactive loop |
| --- | --- |
| Prompts | My Prompts (**nested folder tree** / search / tags / favorites / sorting / card and table views grouped by folder, double-click inline editing, `{{variable}}` copy form, version history, AI test drawer, per-item sync scope and list sync status, repo path echo) + Platform Discovery (category search, preview, copy, save locally) |
| Agent Instructions | Contract library (**folder tree** / scope / activation / priority / targets / `@import`, versions, per-item sync scope) + resolution preview (target × path → match chain / skip reasons / byte budget / compiled files) + project projection and drift (project / re-project / overwrite confirmation / remove / roll back) + **global dispatch** (user-level directories for 8 local Agents, path editing / restore default, multi-select batch projection, global drift) |
| Skills | My Skills (**folder tree / grouped cards / edit → version + pending push**, per-platform dispatch status, symlink/copy install, remove, repo status badge), Skill Store (content review → select platforms → results, a three-step wizard), version history |
| MCP | My Library (**folder tree / one JSON per server**, transport, enable/disable, health check, `[REDACTED]` redacted config, personal notes, save → pending push), three creation methods, apply to platform, version history, Agent MCP reverse import, MCP Store |
| Sync | Four-step Connect repository wizard, Overview (repo card / strategies for the four asset types / **directory structure example** / blocking alerts / stats / Agent status), Changes (full-text preview for Prompts / instructions, incoming review, outgoing, conflict resolution, credential replacement), dispatch matrix (Skill × MCP × Agent, with drift / roll back / remove), sync History |
| Common | Global search (`/` to focus), new-asset shortcut (`N`), light/dark/system theme, toast feedback, second confirmation for destructive actions, empty states that explain the cause |

Differences from the real product (no Electron / SQLite / real Git / real writes to Agent directories; AI responses are simulated) are covered in design doc §8.2.

## Directory structure

```text
docs/interaction-design.md      Interaction design doc (sync domain decisions / IA / interaction specs / acceptance checklist)
src/data/seed.ts                Prompt / Skill / MCP / store / platform lists (including folder seeds)
src/data/syncSeed.ts            Repo, three-way changes, Prompt sync files, conflicts, dispatch matrix, history, platform Prompt seeds
src/data/contractSeed.ts        Agent Instructions contracts, project projection status, instruction sync change seeds
src/data/contractTargets.ts     Project-level target registry (AGENTS.md / CLAUDE.md / Copilot / Cursor / Windsurf)
src/data/globalTargets.ts       Agent global directory targets (8 local tools) and global projection seeds
src/store/store.tsx             Global state + localStorage persistence + version snapshots + sync / project projection / global dispatch actions
src/lib/folders.ts              Nested folder tree, directory matching, repo path generation and reverse mapping
src/lib/promptSync.ts           Prompt ⇄ .prompt.md serialization / parsing, sync scope resolution, credential scanning and replacement
src/lib/contracts.ts            Contract serialization / parsing, glob matching, resolution preview, project target compilation
src/lib/globalTargets.ts        Global directory path resolution, compatibility checks, global file compilation
src/lib/skills.ts               Skill directories / repo paths
src/lib/mcp.ts                  MCP repo template serialization / parsing, health checks and redaction
src/lib/                        Variable resolution, line-level diff, sync status metadata, icons
src/components/ui/              shadcn-style base components (source included, no runtime component library dependency)
src/components/instructions/    Agent Instructions workspace (contract library / resolution preview / project projection / global dispatch)
src/components/shared/FolderTree.tsx  Nested folder tree and folder input (shared by all four asset types)
src/components/prompts|skills|mcp|sync|layout/   Workspace and layout components
```
