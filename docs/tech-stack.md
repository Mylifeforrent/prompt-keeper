# Prompt Keeper Technology Stack

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Technology Stack and Technical Decision Record |
| Version | v1.0 (draft for review) |
| Date | 2026-11-19 |
| Status | Draft; pending engineering and security review |
| Product form | Windows and macOS desktop application |
| Desktop framework | Electron |
| Primary audience | Engineering, security, release engineering, technical leadership |
| Related documents | [`docs/prd.md`](./prd.md), [`docs/architecture.md`](./architecture.md), [`docs/frontend-design.md`](./frontend-design.md), [`docs/backend-design.md`](./backend-design.md) |
| Annotation rules | `[FACT]`, `[ASSUMPTION]`, `[TBD-BIZ]`, `[TBD-UX]`, `[TBD-FE]`, `[TBD-BE]`, `[TBD-INFRA]`, `[CONFLICT]` |

## Document status

This document defines the **target technology stack for the desktop product**. The current repository remains a browser prototype using React, TypeScript, Vite, Tailwind, and localStorage. The prototype rules in [`AGENTS.md`](../AGENTS.md) continue to apply until the desktop migration is explicitly approved.

The stack below is chosen for the desktop product, not retrofitted into the prototype by implication.

## 1. Decision summary

| Layer | Choice | Why |
| --- | --- | --- |
| Desktop shell | Electron | Reuses the React/TypeScript renderer, provides mature Windows/macOS packaging, signing, notarization, auto-update, and full Node.js access for local integration |
| Language | TypeScript, strict mode, end to end | One language across main, preload, renderer, shared domain, and tests |
| Package manager | npm | Project rule; single lockfile; no pnpm, yarn, or bun |
| Build tool | electron-vite | Purpose-built for Electron main/preload/renderer builds with Vite speed and correct bundling |
| Packaging | electron-builder | Mature NSIS and DMG targets, signing, notarization, ASAR control, and update metadata |
| Auto-update | electron-updater | Signature-aware update flow integrated with electron-builder artifacts |
| UI | React 19 + TypeScript | Existing renderer stack; strong ecosystem and testability |
| Styling | Tailwind CSS v4 + CSS variables + local primitives | Matches the existing design system and high-fidelity prototype; no runtime component library |
| Editor | CodeMirror 6 | Lightweight compared with Monaco; Markdown and merge support; good performance |
| Markdown | react-markdown + remark-gfm + rehype-sanitize | Safe rendering of repository content without raw HTML |
| Diff and merge | `diff` (jsdiff) + `@codemirror/merge` | Simple line diffs for lists; interactive three-way merge for conflicts |
| Data fetching | TanStack Query over typed IPC | Cache, request deduplication, and invalidation for asynchronous local queries |
| Forms | react-hook-form + Zod | Complex forms with shared validation and good performance |
| Validation | Zod | One schema definition for IPC, persistence, and forms |
| Virtualization | TanStack Virtual | Large asset lists and folder trees |
| Database | SQLite via better-sqlite3 | Mature, fast, transactional, FTS5 support, easy local backup |
| Data access | Drizzle ORM + drizzle-kit | Typed schema and migrations without hiding SQL |
| Content storage | Content-addressed blob store on disk | Deduplication, integrity, multi-file Skills, smaller database |
| Git | System Git CLI adapter | Reuses system credentials and SSH agent; real Git behavior without a second implementation |
| Secret storage | Electron safeStorage | OS-backed encryption on Windows and macOS; no extra native dependency |
| File watching | chokidar | Reliable cross-platform watch semantics for external edits |
| Glob matching | picomatch | Correct `**`, braces, and extension matching for contract activation |
| YAML | `yaml` | Strict, well-maintained frontmatter parsing |
| TOML | smol-toml plus a section-scoped editor | MCP target support for Codex-style TOML without whole-file rewrites |
| JSONC | jsonc-parser | Preserve comments and formatting in Agent configuration files |
| Logging | electron-log | Electron-aware file rotation and simple integration |
| Unit and integration tests | Vitest | Fast, TypeScript-native, works for pure and Node-side modules |
| Component tests | React Testing Library | Behavior-focused React tests |
| End-to-end tests | Playwright Electron | Real Electron launch, IPC, filesystem, and UI coverage |
| Lint and format | ESLint flat config + Prettier | Consistent code quality and formatting |
| CI | GitHub Actions | macOS and Windows runners, artifact signing, release automation |

## 2. Why Electron

### 2.1 Requirements that drive the choice

The product must:

- Write to arbitrary user-level Agent directories such as `~/.claude`, `~/.codex`, and `%APPDATA%`.
- Create directory symlinks or junctions and fall back to copy.
- Reuse system Git credentials and SSH agents.
- Encrypt secrets with the operating system keychain or DPAPI.
- Work offline.
- Ship a familiar, high-density desktop UI with a rich editor.
- Package and update reliably on Windows and macOS.

A browser-only application cannot satisfy these requirements. Electron can, with one runtime and one language.

### 2.2 Benefits

- The existing React 19 + TypeScript + Tailwind renderer and design system carry over.
- The main process provides Node.js APIs for SQLite, filesystem, child processes, and OS integration.
- Chromium is consistent across Windows and macOS, reducing rendering differences.
- Packaging, code signing, notarization, and auto-update are mature.
- Native modules such as better-sqlite3 are well supported.
- The team can work in one language and one repository.

### 2.3 Costs and mitigations

| Cost | Mitigation |
| --- | --- |
| Installer size around 100-150 MB | Accept for a developer tool; measure and optimize assets; no bundled model or runtime |
| Memory usage from Chromium | Virtualized lists, lazy workspace loading, bounded caches, no background browser windows |
| Larger attack surface than a native shell | Sandbox, context isolation, strict CSP, no Node in renderer, fuses, signed updates |
| Native module ABI coupling | Pin Electron, rebuild better-sqlite3 in CI, test upgrades |
| Auto-update and signing complexity | Automate release pipeline; test clean installs on both OSes |

### 2.4 Alternatives considered

| Alternative | Advantages | Why not chosen now |
| --- | --- | --- |
| Tauri | Smaller binaries, Rust backend, system WebView | Requires a Rust backend rewrite; WebView differences across Windows and macOS; smaller ecosystem for the required Node-style Git/filesystem work; team skill fit is weaker |
| Native Windows/macOS apps | Best performance and integration | Two codebases or a cross-platform native framework; loses the existing React renderer; much higher cost |
| Web app plus a local helper | Reuses the web UI | Requires installing and managing a separate local service; browser cannot write arbitrary directories; two distribution channels |
| PWA with File System Access API | No installer | Cannot write arbitrary Agent directories, no symlinks, no keychain, no Git credentials; fails core requirements |
| Electron Forge | Official Electron tooling | Viable alternative; electron-vite plus electron-builder gives a simpler main/preload/renderer build and a mature packaging path. Forge remains a fallback if electron-builder blocks a platform requirement |

Electron is a **product requirement enabler**, not a fashion choice. Tauri is the main fallback if installer size or memory becomes a market blocker, but it is a backend rewrite, not a packaging swap.

## 3. Why there is no Python or FastAPI backend

A Python + FastAPI backend is intentionally excluded from this product. The desktop form factor and the local-first requirements remove the need for a server, and there is no HTTP service in the target architecture.

Reasons:

1. **Electron already ships a Node.js runtime.** A Python sidecar adds a second runtime, a second package manager, a second security surface, and a second update path.
2. **All required capabilities exist in Node.** better-sqlite3, Git child processes, filesystem APIs, safeStorage, HTTP streaming, and FTS5 are all available.
3. **IPC is simpler than HTTP.** Typed Electron IPC avoids ports, localhost firewalls, authentication, process supervision, and CORS issues.
4. **Packaging is simpler.** A single signed app bundle is easier to notarize and support than an app plus an embedded Python environment.
5. **Security is simpler.** No localhost HTTP server means no local port attack surface and no token exchange between processes.
6. **Performance is better for local operations.** No serialization over HTTP and no Python startup cost.
7. **No ML workload requires Python in the core product.** AI inference is bring-your-own-key and runs at the provider, not locally.

If a future feature needs a Python-only library, it must run as an **optional isolated utility process** with a versioned, typed protocol, not as the core backend. That decision requires a new ADR.

The same reasoning rejects a Rust sidecar for the MVP. Rust is appropriate only if a measured bottleneck cannot be solved in Node.

## 4. Runtime and tooling

| Item | Choice | Policy |
| --- | --- | --- |
| Desktop runtime | Electron current stable major at migration start | Pin exact version; upgrade deliberately; never use an end-of-life major |
| Node.js | Bundled with Electron in production; a matching LTS for build scripts | Do not depend on the user's system Node |
| TypeScript | 5.x, `strict: true` | No `any` at domain boundaries; use `unknown` plus schema validation |
| Package manager | npm | `npm ci` in CI; commit `package-lock.json`; no pnpm/yarn/bun |
| Build | electron-vite | Separate main, preload, and renderer builds |
| Packaging | electron-builder | NSIS for Windows, DMG/ZIP for macOS |
| Update | electron-updater | Signed feed and artifact verification |
| Monorepo | Single npm package with `src/main`, `src/preload`, `src/renderer`, `src/shared` | No Turborepo or workspace complexity for one app |

### 4.1 TypeScript project layout

```text
tsconfig.json               solution style or project references
tsconfig.node.json          main, preload, shared, tests
tsconfig.web.json           renderer and shared
```

Requirements:

- Renderer and main do not share a runtime global.
- Shared modules compile without Electron or Node types where possible.
- Path aliases are limited to `@shared/*` and `@renderer/*`; all other imports are relative.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are recommended `[TBD-FE]`.

## 5. Renderer stack

| Concern | Choice | Notes |
| --- | --- | --- |
| UI framework | React 19 function components and hooks | No class components |
| Styling | Tailwind CSS v4 + CSS variables | Keep the existing token system and `cn()` helper |
| Components | Local primitives in `renderer/components/ui` | No runtime component library |
| Icons | Inline SVG, Lucide-style strokes | Existing approach; no icon font |
| Server state | TanStack Query over IPC | Query cache, mutation invalidation, retries only for transient errors |
| UI state | React context and reducers per feature | Selection, filters, dialogs, unsaved drafts |
| Forms | react-hook-form + Zod resolver | Shared schemas with main |
| Validation | Zod | Same schema used by IPC and persistence where appropriate |
| Editor | CodeMirror 6 | Markdown editing, search, merge view |
| Markdown | react-markdown + remark-gfm + rehype-sanitize | Raw HTML disabled |
| Diff | jsdiff for summaries; CodeMirror merge for interactive conflicts | No Monaco |
| Virtualization | TanStack Virtual | Lists, folder trees, diff views |
| Drag and drop | Deferred | P1; use dnd-kit only if needed |
| Router | None | Workspace and tab state in renderer; no URL routing in the MVP |
| i18n | None in this phase | English-only product copy |
| Date and number formatting | `Intl` APIs | No date library unless a concrete need appears |

### 5.1 State management rationale

The prototype forbids a second state container and a data-fetching library because it is a single-process, in-memory prototype. The desktop app has a different problem: every domain query crosses an asynchronous IPC boundary and the database can change because of a watcher, a sync, or a delivery.

The target design separates:

- **Server state**: data owned by the main process and SQLite. TanStack Query caches it, deduplicates requests, and invalidates on main-process events.
- **UI state**: selection, filters, sort, open dialogs, draft edits. React context and reducers own it.
- **Form state**: react-hook-form owns field-level state and validation.

This is not a second copy of domain state. It is a read cache with explicit invalidation. The main process remains the source of truth.

### 5.2 Why not Redux or Zustand

- Redux adds ceremony for a single-window app with server-owned state.
- Zustand is pleasant but would become a second place where domain state lives.
- Context plus reducers cover UI state, and TanStack Query covers async state.
- If a cross-cutting ephemeral store is needed later, it must be introduced through an ADR.

### 5.3 Editor rationale

CodeMirror 6 is chosen over Monaco because:

- Monaco is heavier and optimized for IDE-scale code editing.
- CodeMirror has first-class Markdown support and a merge view.
- It is easier to theme with CSS variables.
- It is sufficient for Prompts, Contracts, SKILL.md, and MCP JSON/TOML.

The editor is a controlled or semi-controlled component with explicit draft state and a save action; the app does not autosave every keystroke to the database.

## 6. Main process stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Electron main process | Node.js APIs available |
| Language | TypeScript | Same strict configuration as renderer |
| Database | better-sqlite3 | Synchronous API, transactions, FTS5 |
| ORM and migrations | Drizzle ORM + drizzle-kit | Typed schema; SQL remains visible |
| Blob storage | Node `fs` + SHA-256 hashing | Temp file plus rename |
| Git | System `git` CLI via `child_process.spawn` | No interactive prompts; machine-readable output |
| File watching | chokidar | Library, Agent, and project roots |
| Secrets | Electron safeStorage | Refuse to store if unavailable |
| HTTP client | Node `fetch` / `undici` | AI providers, optional catalog, update checks |
| Streaming | HTTP streams forwarded as IPC events | Cancellation by request ID |
| Logging | electron-log | Rotation and redaction wrapper |
| Scheduling | In-process timers with jitter | Auto-fetch only; no cron dependency |
| CPU-heavy work | `worker_threads` or Electron utility process | Hashing, scanning, archive inspection |
| IPC validation | Zod schemas | Shared with renderer |
| Archive handling | `yauzl` and `tar` (P1) | Zip-slip protection and size limits |

### 6.1 Why better-sqlite3

- Mature and widely used in Electron applications.
- Synchronous API is simple inside the main process and fast for local data.
- Transactions are explicit and reliable.
- FTS5 support is available.
- Backup via `VACUUM INTO` is straightforward.
- Native module rebuild is well understood.

Alternatives:

- `node:sqlite` is attractive but its stability and Electron ABI story should be re-evaluated at migration time.
- `sql.js` is WASM and avoids native modules but is slower and requires manual persistence.
- libsql adds a server-oriented dependency that the product does not need.
- IndexedDB is a browser storage API and does not fit the main-process architecture.

### 6.2 Why Drizzle ORM

- Typed schema and queries without hiding SQL.
- Migration generation that can be reviewed as SQL.
- Works with better-sqlite3.
- JSON columns and relations are supported.
- Avoids hand-written row mapping for a large schema.

Rules:

- All SQL lives in `main/repositories`.
- Drizzle types do not leak into shared or renderer modules.
- Migrations are reviewed as SQL files, not applied blindly from a generated diff.
- Complex FTS queries may use raw SQL through Drizzle's `sql` helper.

### 6.3 Why the system Git CLI

- Reuses the user's credential helper, SSH agent, and Git configuration.
- Behaves like Git, including hooks, `.gitattributes`, and line-ending rules.
- Avoids shipping a second Git implementation and its edge cases.
- Supports porcelain v2 and `-z` output for robust parsing.

Risks and controls:

- Git may be missing or too old: detect at onboarding and show guidance.
- Command output must be parsed defensively; use `-z` and porcelain formats.
- Never run interactive commands; set `GIT_TERMINAL_PROMPT=0`.
- Never pass user input through a shell; use `spawn` with argument arrays.
- Scrub environment variables that could redirect Git behavior unexpectedly.
- Timeouts and cancellation for network operations.

### 6.4 Why safeStorage

- Built into Electron.
- Uses the macOS Keychain and Windows DPAPI.
- No extra native dependency such as keytar, which is no longer actively maintained.
- Sufficient for local secret encryption at rest.

Limits:

- It protects at rest, not against a compromised logged-in user session.
- If encryption is unavailable, the app must refuse to store secrets.
- Enterprise secret manager integration is a Phase 3 capability and would use a separate adapter.

### 6.5 Why chokidar

- `fs.watch` behavior differs across platforms and can miss events.
- chokidar normalizes events and handles new files.
- The app needs to detect external edits in library, Agent, and project paths.

Rules:

- Watchers are advisory and debounced.
- On a watch event, the app hashes the file before concluding drift.
- Watchers are paused during app-initiated writes to avoid self-triggered events.
- A manual "Re-check" action exists for every drift surface.

## 7. Network and external services

| Capability | Transport | Policy |
| --- | --- | --- |
| Git remote | System Git over HTTPS or SSH | User-initiated or read-only fetch |
| AI provider | HTTPS from main process | Bring your own key; no product proxy |
| Curated catalog | HTTPS or bundled asset | Signed or bundled; review before install |
| Update feed | HTTPS | Signature verification |
| License service | HTTPS | Optional; offline grace period |
| Telemetry | HTTPS | Off by default; opt-in |

Rules:

- The renderer never makes network requests; `connect-src` is `none`.
- The main process allowlists destinations per feature.
- Requests include a user agent with app version, no asset content.
- TLS verification is never disabled.
- Proxy support follows Electron/Chromium session settings `[TBD-BE]`.
- Response bodies are size-limited and schema-validated.
- Redirects to unexpected hosts are rejected for sensitive operations.

## 8. Security tooling

| Concern | Tool or control |
| --- | --- |
| Electron hardening | `contextIsolation`, `sandbox`, fuses, CSP |
| IPC validation | Zod plus sender checks |
| Secret encryption | safeStorage |
| Secret scanning | In-house rule pack with regex and entropy checks |
| Markdown sanitization | rehype-sanitize and no raw HTML |
| Dependency audit | `npm audit` in CI plus advisory review |
| License compliance | License allowlist and third-party notices |
| SBOM | Generated at release `[TBD-INFRA]` |
| Signing | Authenticode, Apple Developer ID, notarization |
| Update integrity | electron-updater signature verification |
| Code review | Security checklist for IPC, filesystem, secrets, and content |

The in-house scanner is preferred over a large scanner dependency because the product needs precise replacement guidance (`{{variable}}` versus `${VAR}`) and must not send content anywhere. `secretlint` is a candidate for a second local engine if coverage gaps appear.

## 9. Testing and quality tooling

| Level | Tool | Scope |
| --- | --- | --- |
| Type checking | `tsc --noEmit` per project | Main, preload, renderer, shared |
| Lint | ESLint flat config | Correctness, import boundaries, hooks rules, security rules |
| Format | Prettier | Consistent formatting |
| Unit | Vitest | Shared domain and utilities |
| Integration | Vitest + temp SQLite/filesystem | Services, repositories, adapters |
| Git integration | Vitest + local bare repos | Fetch, pull, push, conflicts |
| Component | React Testing Library | Forms, dialogs, lists, states |
| End-to-end | Playwright Electron | Full workflows on Windows and macOS |
| Migration | Fixture databases | Upgrade and rollback safety |
| Packaging | CI smoke tests | Install, launch, update, uninstall |
| Accessibility | axe-core in component tests | Basic automated checks |
| Performance | Custom benchmarks | Startup, search, list rendering, IPC |

Rules:

- No test framework is added to the current prototype without approval.
- The desktop migration introduces the test stack deliberately, not incrementally by accident.
- Tests must not contain real credentials.
- E2E tests run against temporary user data directories and fake Agent directories.
- CI blocks on typecheck, lint, unit, integration, and build; E2E and packaging run on release candidates or a nightly matrix.

## 10. Build, packaging, and release

### 10.1 Build pipeline

```text
npm ci
  -> typecheck main, preload, renderer, shared
  -> lint and format check
  -> unit and integration tests
  -> electron-vite build
  -> package with electron-builder
  -> sign and notarize
  -> smoke test installer
  -> publish update metadata and artifacts
```

### 10.2 Packaging details

| Item | Decision |
| --- | --- |
| ASAR | Enabled |
| Native modules | `better-sqlite3` unpacked from ASAR and rebuilt for Electron |
| Migrations | Bundled as read-only resources |
| Target registry | Bundled as typed data |
| Catalogs | Bundled or downloaded to user data; never inside ASAR writable paths |
| Icons and assets | Optimized and committed |
| Source maps | Not shipped; uploaded privately for diagnostics `[TBD-INFRA]` |
| Windows installer | NSIS, per-user, x64; arm64 P1 |
| macOS installer | DMG and ZIP, arm64 and x64 or universal `[TBD-INFRA]` |
| update feed | GitHub Releases or object storage with signed metadata `[TBD-INFRA]` |

### 10.3 CI matrix

```text
windows-latest: typecheck, unit, integration, build, package, sign
macos-14:       typecheck, unit, integration, build, package, sign, notarize
ubuntu-latest:  typecheck, lint, unit, shared-domain tests (no packaging)
```

Linux CI validates shared code and fast tests without claiming Linux product support.

### 10.4 Signing and notarization

- Windows: Authenticode certificate with timestamping. Prefer an EV or cloud signing service. `[TBD-INFRA]`
- macOS: Developer ID Application certificate, hardened runtime, `notarytool`, stapled ticket.
- Secrets are stored in CI secret storage and never printed.
- Release builds are reproducible from a tagged commit and a lockfile.
- Signing credentials are rotated and access-controlled.

## 11. Dependency policy

### 11.1 Rules

- Runtime dependencies are kept minimal and reviewed.
- Every new runtime dependency requires:
  - A concrete capability gap it fills.
  - Maintenance and security review.
  - License compatibility.
  - Bundle-size and startup impact.
  - An exit strategy if abandoned.
- Prefer platform APIs and small focused libraries over frameworks.
- Avoid dependencies that ship their own UI system, state container, or network stack.
- No dependency may execute code from repository content.
- No post-install script runs unreviewed in production packaging.
- Pin the lockfile and use `npm ci`.

### 11.2 License policy

Allowed by default: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0.

Requires review: MPL-2.0, LGPL, and any license with notice or linking obligations.

Not allowed without explicit legal approval: GPL, AGPL, SSPL, and source-available licenses with incompatible terms.

### 11.3 Supply chain controls

- `npm audit` and advisory review in CI.
- Lockfile diff review on dependency updates.
- Dependabot or Renovate for updates, grouped by risk `[TBD-INFRA]`.
- SBOM per release.
- Code signing for the app; signature verification for updates.
- No remote code loading at runtime.

## 12. Version and upgrade policy

| Component | Policy |
| --- | --- |
| Electron | Pin a stable major; upgrade at least every two majors; test native modules and signing |
| Node (build) | Match the Node version bundled with the chosen Electron major |
| React | Stay on the current major; no experimental features in production |
| TypeScript | Minor upgrades monthly; review strictness changes |
| Tailwind | Current major; avoid mixing major versions |
| better-sqlite3 | Match Electron ABI; test rebuild on every Electron upgrade |
| SQLite schema | Forward-only migrations; backup before upgrade |
| Agent targets | Versioned registry; contract tests per target; support tiers |

## 13. Rejected alternatives summary

| Area | Rejected | Reason |
| --- | --- | --- |
| Desktop shell | Tauri | Backend rewrite and WebView variability; not justified for the MVP |
| Backend | Python + FastAPI sidecar | Second runtime and packaging complexity with no capability gain |
| Backend | Cloud API | Conflicts with local-first, secrets, and offline use |
| Database | IndexedDB | Browser storage, no main-process ownership, weak query tooling |
| Database | Postgres/MySQL | Requires a server; unnecessary for a single-user local app |
| ORM | Prisma | Heavy, engine binaries, and a migration model that fits client-server more than embedded SQLite |
| Git | isomorphic-git | Credential and SSH-agent integration is weaker; performance and edge-case risk |
| Git | nodegit | Native build complexity and maintenance risk |
| Secrets | keytar | Archived and unmaintained |
| Secrets | Custom encrypted file | Reinvents key management; higher risk than OS-backed safeStorage |
| Editor | Monaco | Too heavy for Markdown and prose editing |
| State | Redux | Ceremony without a matching need |
| Data fetching | Custom cache only | Reimplements invalidation and retries that TanStack Query already solves |
| Component library | Runtime UI kit | Conflicts with the existing local primitives and design tokens |
| Styling | CSS-in-JS runtime | Adds runtime cost; the app already uses tokens and Tailwind |
| Testing | Jest | Vitest is faster and simpler with Vite and TypeScript |
| E2E | Spectron | Deprecated; Playwright supports Electron directly |
| Router | React Router | The desktop app has fixed workspaces; URL routing adds complexity without value |
| i18n | i18next | English-only phase; revisit when localization is approved |

## 14. Stack-to-requirement mapping

| PRD requirement group | Stack elements |
| --- | --- |
| APP shell and navigation | Electron, React 19, Tailwind, local primitives, TanStack Query, TanStack Virtual |
| PRM Prompts | CodeMirror, react-markdown, Zod, shared prompt serializer, SQLite, blobs |
| INS Agent Instructions | Shared target registry and compiler, CodeMirror, react-markdown, SQLite, atomic file writes |
| SKL Skills | Blob store, manifest hashing, symlink/junction adapter, chokidar, SQLite |
| MCP | JSONC parser, smol-toml section editor, safeStorage, redaction layer, atomic writes |
| SYN Git sync | System Git CLI, three-way merge engine, operation journal, SQLite |
| DST Dispatch | Agent registry, filesystem adapter, manifest hashing, audit service |
| SRH Search | SQLite FTS5, search service, TanStack Query |
| SET Settings and data | SQLite settings, backup service, electron-updater, electron-log |
| NFR security | Electron sandbox, context isolation, CSP, fuses, safeStorage, Zod IPC, sanitization |
| NFR packaging | electron-builder, Authenticode, Developer ID, notarization, electron-updater |
| NFR quality | TypeScript strict, ESLint, Prettier, Vitest, RTL, Playwright |

## 15. Open technology decisions

| ID | Decision | Options | Owner | Needed by |
| --- | --- | --- | --- | --- |
| TS-01 | Exact Electron major and minimum OS versions | Current stable minus one vs latest | Engineering + release | Migration start |
| TS-02 | macOS universal vs separate arm64/x64 builds | Universal, separate, or arm64-only | Release engineering | Packaging |
| TS-03 | Windows arm64 in the MVP | Include or defer | Product + release | Packaging |
| TS-04 | Update feed hosting | GitHub Releases vs object storage | Release engineering | Before beta |
| TS-05 | Windows signing provider | Traditional certificate vs cloud signing | Release engineering | Before beta |
| TS-06 | Second scanner engine | In-house only vs secretlint | Security | Before beta |
| TS-07 | Catalog signature format | Signed manifest vs bundled only | Security + product | Before CAT-001 |
| TS-08 | AI provider adapter list | OpenAI-compatible only vs per-vendor adapters | Product + engineering | Before AI-001 |
| TS-09 | Telemetry provider | Self-hosted endpoint vs none vs third party | Product + legal | Phase 2 |
| TS-10 | Drizzle vs raw SQL for FTS and complex queries | Drizzle plus raw SQL vs full raw | Backend | Before schema implementation |

## 16. Glossary

| Term | Meaning |
| --- | --- |
| ABI | Native module binary interface; must match the Electron Node version |
| ASAR | Electron archive format for application files |
| CSP | Content Security Policy |
| FTS5 | SQLite full-text search extension |
| IPC | Inter-process communication between renderer and main |
| Main process | Electron process that owns OS integration and writes |
| Preload | Sandboxed bridge that exposes a typed API |
| Renderer | Chromium process that renders React |
| safeStorage | Electron API for OS-backed encryption |
| SBOM | Software bill of materials |

**End of document.** Any stack change that affects process boundaries, storage, security, packaging, or the renderer/backend contract requires an ADR update and a corresponding update to the architecture and technical design documents.
