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

There are currently no known violations. Do not add non-English business documents.

Chat replies to the user are not repository artifacts and MAY use the user's language, but everything written to disk MUST follow this policy.

---

## 2. Project scope and architecture (MUST)

Prompt Keeper is a **local-first interactive prototype**. There is no backend, no database, no network request, and no real Git or filesystem operation unless a task explicitly changes that scope.

- State lives in one `AppState` defined in `src/types.ts`.
- `src/store/store.tsx` is the only state owner and the only place that reads/writes `localStorage` (key `pk_state_v1`).
- When the persisted shape changes, bump `SCHEMA_VERSION` in `src/store/store.tsx` and extend `load()` with a backward-compatible migration.
- `src/lib/*` holds pure domain logic: no React hooks, no `localStorage`, no network, no side effects. The only exception is `src/lib/icons.tsx`, which renders icons.
- `src/data/*` holds seed data and target registries. Demo content MUST be English.
- `src/components/<domain>/*` holds workspace UI; `src/components/ui/*` holds the local shadcn/ui-style primitives.
- Components receive data and callbacks through props. Do not add a second state container, router, or data-fetching library.

Do not invent a backend, API, database, authentication, or real sync engine in this prototype. If a feature needs one, document it as `[TBD-BE]` / `[TBD-INFRA]` instead of faking production behavior.

### Repository asset paths (MUST)

```text
prompts/<folder>/<slug>.prompt.md
instructions/<folder>/<slug>.contract.md
skills/<folder>/<skill-name>/SKILL.md
mcp/<folder>/<server-name>.json
```

- Folders map directly to repository directories and MAY be nested.
- The last level keeps the single-file / single-skill-directory convention.
- Keep path generation and parsing in `src/lib/folders.ts`, `promptSync.ts`, `contracts.ts`, `skills.ts`, and `mcp.ts`; do not duplicate path logic in components.

### Security boundaries (MUST)

- Repository MCP files contain only `${VAR}` placeholders for credentials.
- Real credential values MUST never be persisted to Git, seed data, docs, or commit messages.
- Keep the existing redaction (`[REDACTED]`) and credential-scan behavior intact; do not add a path that bypasses it.
- Drifted items MUST NOT be bulk-overwritten; require item-by-item confirmation.
- Sync MUST NOT auto-commit, auto-push, auto-merge, or auto-write to Agent directories.

---

## 3. Code conventions (MUST)

- Use function components and hooks only. Do not add class components.
- Use named exports for components and helpers. `App` is the only default export.
- Keep TypeScript strict: no `any` unless required by a third-party boundary; type exported APIs explicitly.
- Use `import type` for type-only imports.
- Follow the existing formatting: 2-space indentation, single quotes, no semicolons, trailing commas in multiline expressions.
- Use relative imports; there is no path alias.
- Generate IDs with `uid()` and timestamps with `nowIso()` / `formatDate()` from `src/lib/utils.ts`.
- Build class names with `cn()` and Tailwind theme tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`, etc.). Do not scatter raw hex colors or invent a parallel color system.
- Keep comments in English and explain a non-obvious constraint or trade-off. Do not narrate the code or the change.
- Keep diffs focused. Do not reformat unrelated files or rename things outside the task.

---

## 4. Validation (MUST)

Before claiming work is complete:

1. Run the build; it must pass:

   ```bash
   npm run build
   ```

   This runs `tsc --noEmit` followed by `vite build`.

2. Run the language scan from section 1; it must return no files.
3. For UI changes, run `npm run dev` and manually check the affected flow, including empty, loading, error, and confirmation states where applicable.
4. State exactly what was verified. There is currently **no test runner and no linter** in this repository; do not claim that tests or lint passed. Do not add a test framework or linter without explicit approval.

Do not commit or report success if `npm run build` fails.

---

## 5. Dependencies and tooling (MUST)

- Use **npm** only. Do not use pnpm, yarn, or bun.
- Do not hand-edit `package-lock.json`.
- Do not add runtime dependencies without explicit approval. The UI primitives are vendored in `src/components/ui/`; do not add a component library.
- Node 18+ is required.
- Do not commit `node_modules/`, `dist/`, `*.local`, or `.DS_Store`.

---

## 6. Git conventions (MUST)

- Use Conventional Commits with an English subject: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`.
- Write the subject in the imperative mood, keep it at or below 72 characters, and do not end it with a period.
- Never use `git commit --no-verify`.
- Never rewrite published history or force-push `main`.
- Keep `main` buildable at all times.
- Commit only files related to the task. Leave `dist/` and local-only state out of Git.

---

## 7. Documentation (MUST)

- `README.md` is the entry point. Update it when behavior, setup commands, architecture, or repository layout changes.
- `docs/interaction-design.md` is the source of truth for UX and domain behavior. Update it when an interaction or sync rule changes; do not let code and design silently diverge.
- `docs/business-model.md` is a business draft. Keep the annotation markers `[FACT]`, `[ASSUMPTION]`, `[TBD-BIZ]`, `[TBD-INFRA]`, and `[CONFLICT]`, and do not present assumptions as facts.
- The target desktop product is specified in `docs/prd.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/frontend-design.md`, `docs/backend-design.md`, and `docs/api-contract.md`. These documents describe the Windows/macOS Electron product and do not change the current prototype scope until a migration is explicitly approved. `docs/api-contract.md` is the binding renderer-main boundary contract; when it disagrees with the other target documents about channel names or payload shapes, it wins.
- All documentation MUST be English.

---

## 8. Definition of done

A task is done only when all of the following are true:

- [ ] All added or changed content is English.
- [ ] `npm run build` passes.
- [ ] The language scan returns no files.
- [ ] The affected UI flow was checked in the browser, or the lack of manual verification is stated explicitly.
- [ ] README / design docs are updated if behavior, commands, or rules changed.
- [ ] No secrets, `dist/`, `node_modules/`, or unrelated files are included.
- [ ] The commit message follows section 6.
