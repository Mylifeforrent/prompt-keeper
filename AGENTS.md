# AGENTS.md

Project-level instructions for AI agents and human contributors working in **Prompt Keeper**.

**Precedence:** this file overrides user-level or global `AGENTS.md` preferences for this repository. If a global preference conflicts with a rule below, follow this file.

---

## 1. Language policy (MUST)

This repository is **English-only**. Every artifact that enters version control MUST be written in English.

MUST:

- Write source code, identifiers, comments, JSDoc, UI copy, error messages, toast/empty-state text, seed and demo data, README, docs, and test names in English.
- Write commit messages, branch names, PR titles, PR descriptions, and review comments in English.
- Keep each file in one language; do not mix English and another language in the same file.
- Use English UI copy that states the action and consequence explicitly (for example, "This overwrites the file in the Agent directory").
- Keep the canonical asset formats in English: `.prompt.md`, `.contract.md`, `SKILL.md`, and MCP JSON fields.

MUST NOT:

- Add Chinese or any other non-English text to comments, identifiers, UI strings, documentation, demo data, or commit messages.
- Commit a file whose user-visible content is non-English.
- Add an i18n framework or locale files in this phase unless the task explicitly requires it.

Verification (run before every commit; expected output is empty):

```bash
git ls-files -z --cached --others --exclude-standard \
  | xargs -0 perl -CSD -ne 'if (/\p{Han}/) { print "$ARGV\n"; close ARGV }'
```

Chat replies to the user are not repository artifacts and MAY use the user's language, but everything written to disk MUST follow this policy.

---

## 2. Product scope and architecture (MUST)

Prompt Keeper is a **local-first Electron desktop application** for Windows and macOS. The main process is the backend. There is no HTTP server, no hosted service, no account system, and no network request unless a feature explicitly requires one.

```text
src/main/       Electron main process: services, SQLite, blobs, Git, filesystem, safeStorage
src/preload/    Narrow typed IPC bridge; no business logic
src/renderer/   React renderer; no Node.js, filesystem, Git, or secrets
src/shared/     IPC contract types, channel catalog, pure domain logic
```

Runtime rules:

- `src/main` is the only writer of SQLite, blobs, the materialized library, Git clones, Agent directories, and project roots.
- The renderer sends asset IDs, target IDs, selections, and content payloads. It never sends arbitrary write paths and never receives stored secret values.
- `src/shared/contracts.ts`, `src/shared/bridge.ts`, and `src/shared/channels.ts` mirror [`docs/api-contract.md`](./docs/api-contract.md). The document wins when they disagree; update both together.
- `src/shared/domain/*` is pure and side-effect free. It owns folder/path rules, serializers, variable rendering, target compilation, managed blocks, diff primitives, and credential scanning. Preview and write MUST use the same functions.
- `src/main/services/*` owns business rules and persistence. `src/main/adapters/*` owns OS, Git, blob, and secret integration.
- Renderer feature components call `src/renderer/lib/ipc.ts`; they do not access `window.promptKeeper` directly.
- Renderer server state uses TanStack Query. Feature-local UI state uses hooks/reducers. Do not add Redux, Zustand, a router, or a second data-fetching library.
- IPC handlers validate the payload, the sender, and business rules in the main process. The renderer is untrusted for writes.

There is no prototype localStorage state anymore. The SQLite database under `app.getPath('userData')` is the operational source of truth for the library. Git is the shared source of truth for syncable assets. Agent directories are delivery targets only.

### Repository asset paths (MUST)

```text
prompts/<folder>/<slug>.prompt.md
instructions/<folder>/<slug>.contract.md
skills/<folder>/<skill-name>/SKILL.md
mcp/<folder>/<server-name>.json
```

- Folders map directly to repository directories and MAY be nested.
- The last level keeps the single-file / single-skill-directory convention.
- Keep path generation and parsing in `src/shared/domain`; services and renderer must not duplicate it.

### Security boundaries (MUST)

- Repository MCP files contain only `${VAR}` placeholders for credentials.
- Real credential values MUST never be persisted to Git, logs, audit events, diagnostics, error payloads, renderer DTOs, or commit messages.
- Secrets are encrypted with Electron `safeStorage`. If encryption is unavailable, refuse to store secrets; never fall back to plaintext.
- Keep the `[REDACTED]` contract and credential scanning intact; do not add a path that bypasses them.
- Drifted items MUST NOT be bulk-overwritten; require item-by-item confirmation.
- Sync MUST NOT auto-commit, auto-push, auto-merge, or auto-write to Agent directories.
- The backend MUST NOT execute Skill scripts, MCP commands, package managers, or repository hooks.
- Every write path MUST resolve from main-process records and stay inside an allowed root (library, clone, project root, global target, Agent directory, blob store, backup directory).
- Renderer Markdown is sanitized; do not render raw HTML from repository or AI content.

### Out of scope unless explicitly requested

- A hosted backend, database server, authentication, tenancy, billing, or telemetry service.
- Linux support or store distribution.
- Automatic execution of downloaded content.
- Replacing a dedicated secret manager, MCP gateway, or identity provider.

---

## 3. Code conventions (MUST)

Renderer:

- Use function components and hooks only. Do not add class components.
- Use named exports for components and helpers. `App` is the only default export.
- Use `import type` for type-only imports and relative imports; the only aliases are `@shared/*` and `@renderer/*`.
- Build class names with `cn()` and Tailwind theme tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`, etc.). Do not scatter raw hex colors or invent a parallel color system.
- Every data surface handles loading, empty (no data), empty (filtered), error, and confirmation states.
- Destructive actions require a confirmation dialog that names the object and the consequence.

Main and shared:

- TypeScript strict. No `any` unless required by a third-party boundary; type exported APIs explicitly.
- Use `AppError` and the documented error codes for business failures. Return structured `IpcResult` envelopes from handlers; never leak stack traces to the renderer.
- Use `ctx.assets` / `AssetStore` for revisions, blobs, materialization, and indexing. Do not write asset tables directly from a feature service unless the table is asset-type specific.
- Use `writeAtomic` / `writeAtomicSync` for external file writes. Do not write a target file in place.
- Use `ctx.operations.start()` for long-running work and emit progress; do not block an IPC handler for more than a few seconds.
- Emit `domain:changed` after a transaction commits. Events carry IDs, never content or secrets.
- Generate IDs with `newId(prefix)` and timestamps with `nowIso()` from `src/shared/domain/ids.ts`.
- Keep comments in English and explain a non-obvious constraint or trade-off. Do not narrate the code or the change.
- Follow the existing formatting: 2-space indentation, single quotes, no semicolons, trailing commas in multiline expressions.
- Keep diffs focused. Do not reformat unrelated files or rename things outside the task.

---

## 4. Validation (MUST)

Before claiming work is complete:

1. Run the type check and build; both must pass:

   ```bash
   npm run build
   ```

2. Run the tests:

   ```bash
   npm test
   ```

   Tests run inside Electron's Node runtime because `better-sqlite3` is rebuilt for the Electron ABI. If the native module fails to load, run `npm run rebuild` first.

3. Run the language scan from section 1; it must return no files.
4. For UI changes, run `npm run dev` and manually check the affected flow, including empty, loading, error, and confirmation states where applicable.
5. For end-to-end changes, run `npm run test:e2e` after a build.
6. State exactly what was verified. There is currently **no linter**; do not claim that lint passed. Do not add a linter or a new test framework without explicit approval.

Do not commit or report success if `npm run build` fails.

---

## 5. Dependencies and tooling (MUST)

- Use **npm** only. Do not use pnpm, yarn, or bun.
- Do not hand-edit `package-lock.json`.
- The approved stack is Electron + electron-vite + electron-builder, React + TypeScript + Vite + Tailwind, TanStack Query, better-sqlite3, Zod, YAML/JSONC/TOML parsers, picomatch, diff, and Playwright/Vitest for tests.
- Do not add runtime dependencies without explicit approval. The UI primitives are vendored in `src/renderer/components/ui/`; do not add a component library.
- Node 20+ is required for build scripts. Electron ships its own Node runtime.
- Do not commit `node_modules/`, `dist/`, `out/`, `release/`, `test-results/`, `playwright-report/`, `*.local`, or `.DS_Store`.
- Native modules (`better-sqlite3`) must match the Electron ABI. Rebuild with `npm run rebuild` after an Electron upgrade.

---

## 6. Git conventions (MUST)

- Use Conventional Commits with an English subject: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`.
- Write the subject in the imperative mood, keep it at or below 72 characters, and do not end it with a period.
- Never use `git commit --no-verify`.
- Never rewrite published history or force-push `main`.
- Keep `main` buildable at all times.
- Commit only files related to the task. Leave build output and local-only state out of Git.

---

## 7. Documentation (MUST)

- `README.md` is the entry point. Update it when behavior, setup commands, architecture, or repository layout changes.
- `docs/interaction-design.md` is the source of truth for UX and domain behavior. Update it when an interaction or sync rule changes; do not let code and design silently diverge.
- `docs/api-contract.md` is the binding renderer-main boundary contract. Update it together with `src/shared/contracts.ts`, `bridge.ts`, and `channels.ts`.
- `docs/backend-design.md` owns storage, service behavior, Git sequences, projection algorithms, and security controls.
- `docs/frontend-design.md` owns renderer architecture, query keys, and feature behavior.
- `docs/business-model.md` is a business draft. Keep the annotation markers `[FACT]`, `[ASSUMPTION]`, `[TBD-BIZ]`, `[TBD-INFRA]`, and `[CONFLICT]`, and do not present assumptions as facts.
- All documentation MUST be English.

---

## 8. Definition of done

A task is done only when all of the following are true:

- [ ] All added or changed content is English.
- [ ] `npm run build` passes.
- [ ] `npm test` passes for affected domains.
- [ ] The language scan returns no files.
- [ ] The affected UI flow was checked in the running app, or the lack of manual verification is stated explicitly.
- [ ] README / design docs / API contract are updated if behavior, channels, or rules changed.
- [ ] No secrets, build output, `node_modules/`, or unrelated files are included.
- [ ] The commit message follows section 6.
