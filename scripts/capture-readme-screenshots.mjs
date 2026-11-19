#!/usr/bin/env node
/**
 * Capture README screenshots from the real Electron application.
 *
 * The script boots the built app with isolated user data and a temporary HOME,
 * seeds a believable demo library through the typed preload bridge, creates a
 * local Git remote and a temporary project, then walks the real UI and captures
 * 1600x1000 CSS pixels at 2x. Originals stay in the system temp directory; the
 * downsized PNG deliverables are written to assets/screenshots.
 *
 * It never touches the real app data directory, real Agent directories, or a
 * real Git remote. Run it with `node scripts/capture-readme-screenshots.mjs`
 * after `npm run build`. Capture is macOS-only because downsampling uses sips.
 */

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'
import { stringify as stringifyYaml } from 'yaml'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(REPO_ROOT, 'assets', 'screenshots')
const RUN_ID = `pk-readme-${Date.now().toString(36)}`
// The demo root is intentionally short so repository and Agent paths remain
// readable in the UI. It is removed and recreated on every run.
const DEMO_ROOT = '/tmp/pk-readme-demo'
rmSync(DEMO_ROOT, { recursive: true, force: true })
mkdirSync(DEMO_ROOT, { recursive: true })
const USER_DATA = join(DEMO_ROOT, 'user-data')
const DEMO_HOME = join(DEMO_ROOT, 'home')
const PROJECT_ROOT = join(DEMO_ROOT, 'acme-console')
const GIT_ROOT = join(DEMO_ROOT, 'git')
const BARE_REMOTE = join(GIT_ROOT, 'acme-console.git')
const REMOTE_WORK = join(GIT_ROOT, 'acme-console-work')
const SHOT_ORIGINALS = mkdtempSync(join(tmpdir(), `${RUN_ID}-shots-`))
const SCREENSHOT_WIDTH = 2000
const CSS_WIDTH = 1600
const CSS_HEIGHT = 1000

const GIT_ENV = {
  ...process.env,
  HOME: DEMO_HOME,
  USERPROFILE: DEMO_HOME,
  GIT_CONFIG_GLOBAL: join(DEMO_HOME, '.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Prompt Keeper Demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'Prompt Keeper Demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
}

const AGENT_LAYOUT = [
  ['claude', ['.claude/skills'], '.claude.json', '{"mcpServers":{}}\n'],
  ['codex', ['.codex/skills'], '.codex/config.toml', '# Demo configuration for Prompt Keeper screenshots.\n[mcp_servers]\n'],
  ['cursor', ['.cursor/skills'], '.cursor/mcp.json', '{"mcpServers":{}}\n'],
  ['windsurf', ['.codeium/windsurf/skills'], '.codeium/windsurf/mcp_config.json', '{"mcpServers":{}}\n'],
  ['opencode', ['.config/opencode/skills'], '.config/opencode/opencode.json', '{\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {}\n}\n'],
  [
    'cline',
    ['Documents/Cline/Skills'],
    'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    '{"mcpServers":{}}\n',
  ],
  ['kiro', ['.kiro/skills'], '.kiro/settings/mcp.json', '{"mcpServers":{}}\n'],
  ['qoder', ['.qoder/skills'], '.qoder/mcp.json', '{"mcpServers":{}}\n'],
]

const GLOBAL_DIRS = [
  '.claude',
  '.codex',
  '.cursor/rules',
  '.codeium/windsurf/memories',
  '.config/opencode',
  'Documents/Cline/Rules',
  '.kiro/steering',
  '.qoder/rules',
]

/* ------------------------------------------------------------------ */
/* Demo content                                                        */
/* ------------------------------------------------------------------ */

const PROMPTS = [
  {
    title: 'Staff Engineer PR Review',
    description:
      'A rigorous pull-request review for production code: verdict first, findings ranked by severity, and explicit test gaps.',
    folder: 'engineering/review',
    tags: ['review', 'quality'],
    syncPolicy: 'sync',
    systemPrompt: [
      'You are a staff engineer reviewing a pull request in a production codebase. Protect correctness, security, and maintainability without slowing the team down.',
      '',
      'Review principles:',
      '- Read the change in context before commenting. Prefer whole-function reasoning over isolated lines.',
      '- Rank every finding: blocker, should-fix, question, or nit.',
      '- Cite the relevant line or symbol and explain the concrete failure mode.',
      '- Do not invent issues. If the change is sound, say so and name what you verified.',
      '- Call out missing tests and unsafe defaults explicitly.',
    ].join('\n'),
    userPrompt: [
      'Review the following {{language}} change.',
      '',
      '<code>',
      '{{code}}',
      '</code>',
      '',
      'Risk focus: {{riskFocus}}.',
      '',
      'Return:',
      '1. A one-paragraph verdict.',
      '2. Blockers and should-fix findings, each with a line reference, the failure mode, and a concrete fix.',
      '3. Security and performance notes.',
      '4. Test gaps.',
      '5. A short list of things the author did well.',
    ].join('\n'),
    variables: [
      { name: 'language', type: 'text', label: 'Language', example: 'TypeScript', required: true },
      {
        name: 'code',
        type: 'textarea',
        label: 'Code',
        example: 'Paste the diff or the changed function.',
        required: true,
      },
      {
        name: 'riskFocus',
        type: 'select',
        label: 'Risk focus',
        options: ['correctness', 'security', 'performance'],
        required: true,
      },
    ],
  },
  {
    title: 'Release Notes Writer',
    description:
      'Turns a range of merged changes into customer-facing release notes with a clear upgrade path.',
    folder: 'engineering/release',
    tags: ['release', 'automation'],
    syncPolicy: 'sync',
    systemPrompt: [
      'You write release notes for a developer tool used by engineering teams.',
      '',
      '- Lead with user-visible outcomes, not internal implementation details.',
      '- Separate breaking changes from additions and fixes.',
      '- Every claim must be supported by the supplied change list.',
      '- Keep the tone direct and calm. Do not use marketing superlatives.',
    ].join('\n'),
    userPrompt: [
      'Write release notes for {{product}} version {{version}}.',
      '',
      'Audience: {{audience}}',
      '',
      'Merged changes:',
      '{{changes}}',
      '',
      'Use these sections: Highlights, Breaking changes, Improvements, Fixes, Upgrade notes.',
      'If a section has no content, omit it.',
    ].join('\n'),
    variables: [
      { name: 'product', type: 'text', label: 'Product', example: 'Acme Console', required: true },
      { name: 'version', type: 'text', label: 'Version', example: '2.8.0', required: true },
      {
        name: 'audience',
        type: 'select',
        label: 'Audience',
        options: ['end users', 'platform engineers', 'administrators'],
        required: true,
      },
      { name: 'changes', type: 'textarea', label: 'Merged changes', required: true },
    ],
  },
  {
    title: 'API Contract Reviewer',
    description:
      'Compares an API change against the published contract and flags breaking behavior before it ships.',
    folder: 'engineering/api',
    tags: ['api', 'review'],
    syncPolicy: 'sync',
    systemPrompt: [
      'You review API contract changes for backward compatibility.',
      '',
      'Check status codes, error shapes, field nullability, pagination, idempotency, and authentication behavior. A change is breaking when an existing client can observe a different result without changing its request.',
      '',
      'For each finding include the affected endpoint, the client impact, and a compatible alternative.',
    ].join('\n'),
    userPrompt: [
      'Compare the current and proposed contract for `{{endpoint}}`.',
      '',
      'Current contract:',
      '```json',
      '{{current}}',
      '```',
      '',
      'Proposed contract:',
      '```json',
      '{{proposed}}',
      '```',
      '',
      'Return a compatibility verdict, a table of breaking changes, and a migration plan.',
    ].join('\n'),
    variables: [
      { name: 'endpoint', type: 'text', label: 'Endpoint', example: 'PATCH /v1/users/:id', required: true },
      { name: 'current', type: 'textarea', label: 'Current contract', required: true },
      { name: 'proposed', type: 'textarea', label: 'Proposed contract', required: true },
    ],
  },
  {
    title: 'Incident Postmortem Coach',
    description:
      'Guides a blameless postmortem from timeline to contributing factors and durable follow-up actions.',
    folder: 'operations/incidents',
    tags: ['incidents', 'operations'],
    syncPolicy: 'inherit',
    systemPrompt: [
      'You facilitate a blameless incident postmortem.',
      '',
      '- Separate trigger, contributing factors, and systemic causes.',
      '- Ask for evidence before accepting a cause.',
      '- Challenge vague action items; each must have an owner, a due date, and a verification method.',
      '- Keep the language factual and free of blame.',
    ].join('\n'),
    userPrompt: [
      'Draft a postmortem for {{incident}}.',
      '',
      'Timeline:',
      '{{timeline}}',
      '',
      'Impact:',
      '{{impact}}',
      '',
      'Produce: a summary, customer impact, detection and response review, contributing factors, what went well, and action items with owners.',
    ].join('\n'),
    variables: [
      { name: 'incident', type: 'text', label: 'Incident', example: 'Checkout latency spike', required: true },
      { name: 'timeline', type: 'textarea', label: 'Timeline', required: true },
      { name: 'impact', type: 'textarea', label: 'Impact', required: true },
    ],
  },
  {
    title: 'SQL Query Optimizer',
    description:
      'Reads a query plan and proposes safer, faster SQL with an explanation of each trade-off.',
    folder: 'data/warehouse',
    tags: ['data', 'performance'],
    syncPolicy: 'inherit',
    systemPrompt: [
      'You are a database performance engineer.',
      '',
      'Work from the provided plan and schema. Do not guess statistics. Prefer changes that reduce scanned rows or repeated work. State the expected effect and the risk of each change.',
      'Never suggest disabling safety features or running destructive statements.',
    ].join('\n'),
    userPrompt: [
      'Optimize this {{dialect}} query.',
      '',
      '```sql',
      '{{query}}',
      '```',
      '',
      'Plan:',
      '```text',
      '{{plan}}',
      '```',
      '',
      'Return: the bottleneck, an optimized query, index or schema recommendations, and a verification query.',
    ].join('\n'),
    variables: [
      {
        name: 'dialect',
        type: 'select',
        label: 'Dialect',
        options: ['PostgreSQL', 'MySQL', 'SQLite', 'BigQuery'],
        required: true,
      },
      { name: 'query', type: 'textarea', label: 'Query', required: true },
      { name: 'plan', type: 'textarea', label: 'Query plan', required: true },
    ],
  },
  {
    title: 'Product Spec Critic',
    description:
      'Stress-tests a product spec for ambiguous scope, unstated assumptions, and missing success criteria.',
    folder: 'product/discovery',
    tags: ['product', 'discovery'],
    syncPolicy: 'inherit',
    systemPrompt: [
      'You are a skeptical but constructive product reviewer.',
      '',
      'Evaluate the problem statement, user evidence, scope boundaries, success metrics, and rollback plan. Separate missing information from genuine design flaws. Ask at most five high-leverage questions.',
    ].join('\n'),
    userPrompt: [
      'Review this product spec:',
      '',
      '{{spec}}',
      '',
      'Return: the strongest part, the riskiest assumption, missing evidence, scope traps, and a revised success metric.',
    ].join('\n'),
    variables: [{ name: 'spec', type: 'textarea', label: 'Product spec', required: true }],
  },
  {
    title: 'Migration Risk Planner',
    description:
      'Plans a reversible data or platform migration with staged rollouts, checkpoints, and abort criteria.',
    folder: 'engineering/migrations',
    tags: ['migrations', 'reliability'],
    syncPolicy: 'inherit',
    systemPrompt: [
      'You plan production migrations.',
      '',
      'Every plan must be reversible or explicitly one-way with a verified backup. Define expand, migrate, verify, and contract phases. Name the abort criteria and the owner of each checkpoint.',
    ].join('\n'),
    userPrompt: [
      'Plan the migration from {{source}} to {{target}}.',
      '',
      'Constraints:',
      '{{constraints}}',
      '',
      'Return a phased plan, the data validation queries, rollback steps, and the go/no-go checklist.',
    ].join('\n'),
    variables: [
      { name: 'source', type: 'text', label: 'Source', example: 'Legacy orders table', required: true },
      { name: 'target', type: 'text', label: 'Target', example: 'Sharded orders service', required: true },
      { name: 'constraints', type: 'textarea', label: 'Constraints', required: true },
    ],
  },
  {
    title: 'Test Plan Generator',
    description:
      'Builds a risk-based test plan from a change description, covering happy paths, edges, and failure modes.',
    folder: 'engineering/quality',
    tags: ['testing', 'quality'],
    syncPolicy: 'inherit',
    systemPrompt: [
      'You design test plans that find real regressions.',
      '',
      'Start from the change surface. Cover the primary path, boundaries, invalid input, concurrency, retries, and observability. Prefer a small number of high-value cases over exhaustive duplication.',
    ].join('\n'),
    userPrompt: [
      'Create a test plan for this change:',
      '',
      '{{change}}',
      '',
      'Affected components: {{components}}',
      '',
      'Return a test matrix with case, layer (unit/integration/e2e), setup, expected result, and priority.',
    ].join('\n'),
    variables: [
      { name: 'change', type: 'textarea', label: 'Change', required: true },
      { name: 'components', type: 'text', label: 'Affected components', example: 'auth, billing', required: true },
    ],
  },
]

const CONTRACTS = [
  {
    title: 'Core Engineering Standards',
    description:
      'Always-on engineering standards for every project: review quality, delivery hygiene, and failure handling.',
    folder: 'engineering',
    scope: 'project',
    activation: { mode: 'always', globs: [] },
    priority: 90,
    targetIds: ['agents-md', 'claude', 'copilot', 'cursor', 'windsurf'],
    tags: ['standards', 'engineering'],
    syncPolicy: 'sync',
    body: [
      '# Core Engineering Standards',
      '',
      'These rules apply to every change in this repository. When a local convention conflicts with this file, raise the conflict in review instead of choosing silently.',
      '',
      '## Change quality',
      '',
      '- Keep behavior changes separate from refactors. A reviewer must be able to explain the diff in one sentence.',
      '- Prefer the smallest change that solves the stated problem; delete dead paths instead of hiding them behind flags.',
      '- New behavior needs a test that fails without the change. A manual verification note is not a test.',
      '- Public interfaces, persisted formats, and error contracts are versioned. Treat a rename as a breaking change unless proven otherwise.',
      '',
      '## Review bar',
      '',
      '- A blocking comment names the failure mode, the affected input, and a concrete fix.',
      '- Reviewers verify the happy path, one boundary, and one failure path before approving.',
      '- Authors respond to every comment. Unresolved questions move to a follow-up issue, not into the merge.',
      '- Security-sensitive changes require a second reviewer who reads the data flow end to end.',
      '',
      '## Delivery',
      '',
      '- Every deploy has a rollback step that was exercised in staging.',
      '- Migrations are expand-first and contract-last. Never drop a column in the same release that stops reading it.',
      '- Feature flags have an owner and an expiry date. Expired flags are removed.',
      '- Logs contain identifiers, not payloads or credentials.',
      '',
      '## Failure handling',
      '',
      '- Fail closed when authorization is uncertain; fail visibly when data integrity cannot be verified.',
      '- Retries need a budget, jitter, and an idempotency key. Unbounded retries are a defect.',
      '- Timeouts are explicit at every network boundary. There is no default infinite wait.',
    ].join('\n'),
  },
  {
    title: 'API Error Handling',
    description:
      'Path-scoped contract for API route handlers: stable error envelopes, status codes, and no leaked internals.',
    folder: 'engineering/api',
    scope: 'path',
    pathPrefix: 'src/api',
    activation: { mode: 'glob', globs: ['src/api/**/*.ts'] },
    priority: 70,
    targetIds: ['copilot-path', 'cursor', 'windsurf'],
    tags: ['api', 'errors'],
    syncPolicy: 'inherit',
    body: [
      '# API Error Handling',
      '',
      'Apply these rules to every route handler under `src/api`.',
      '',
      '## Error envelope',
      '',
      '- Return `{ error: { code, message, requestId } }` for every non-2xx response. Do not change the shape per endpoint.',
      '- `code` is a stable machine-readable token. `message` is safe to show to a caller.',
      '- Include the request ID from the inbound header or generate one at the edge.',
      '',
      '## Status codes',
      '',
      '- `400` for malformed input, `401` for missing identity, `403` for insufficient permission, `404` for absent resources, `409` for state conflicts, `422` for semantic validation, `429` for rate limits.',
      '- Do not return `200` with an error body. Do not return `500` for a validation failure.',
      '- A dependency failure returns `502` or `503` and names the dependency in logs, not in the response body.',
      '',
      '## Safety',
      '',
      '- Never include stack traces, SQL, internal hostnames, or credential fragments in a response.',
      '- Log the internal cause once with the request ID; return the same ID to the caller.',
      '- Authorization checks happen before resource lookup so existence is not leaked.',
    ].join('\n'),
  },
  {
    title: 'React Component Standards',
    description:
      'Path-scoped rules for renderer components: accessibility, state ownership, and predictable data flow.',
    folder: 'frontend',
    scope: 'path',
    pathPrefix: 'src/renderer',
    activation: { mode: 'glob', globs: ['src/renderer/**/*.tsx'] },
    priority: 60,
    targetIds: ['copilot-path', 'cursor', 'windsurf'],
    tags: ['frontend', 'react'],
    syncPolicy: 'inherit',
    body: [
      '# React Component Standards',
      '',
      'These rules apply to files under `src/renderer`.',
      '',
      '## Component shape',
      '',
      '- Prefer function components and named exports. One component owns one responsibility.',
      '- Keep server data in the query layer and feature-local UI state in hooks or reducers. Do not duplicate server state in component state.',
      '- Derive values during render instead of synchronizing them with effects.',
      '',
      '## Accessibility',
      '',
      '- Every interactive element is reachable by keyboard and has an accessible name.',
      '- Dialog titles are labelled; focus returns to the trigger on close.',
      '- Color is never the only signal for status. Pair it with text or an icon.',
      '',
      '## Reliability',
      '',
      '- Every data surface handles loading, empty, filtered-empty, and error states.',
      '- Destructive actions name the object and the consequence before confirmation.',
      '- Do not render raw repository or model HTML. Sanitize Markdown at the boundary.',
    ].join('\n'),
  },
  {
    title: 'Security Review Guardrails',
    description:
      'Highest-priority guardrails for changes that touch authentication, secrets, or untrusted content.',
    folder: 'security',
    scope: 'project',
    activation: { mode: 'always', globs: [] },
    priority: 100,
    targetIds: ['agents-md', 'claude', 'copilot', 'copilot-path', 'cursor', 'windsurf'],
    tags: ['security', 'review'],
    syncPolicy: 'sync',
    body: [
      '# Security Review Guardrails',
      '',
      'These guardrails override convenience. A change that violates them is blocked until the risk is removed or explicitly accepted by the security owner.',
      '',
      '## Secrets',
      '',
      '- Never commit a credential, token, private key, or production connection string. Repository files carry placeholders only.',
      '- Never log secret values, even at debug level. Redact before the value reaches a log sink.',
      '- Secret rotation must be possible without a code change.',
      '',
      '## Trust boundaries',
      '',
      '- Treat repository content, model output, and Agent configuration as untrusted input.',
      '- Validate at the boundary and re-check authorization in the service that performs the write.',
      '- A path from user input to the filesystem must resolve against an allowlisted root.',
      '',
      '## Data handling',
      '',
      '- Collect the minimum data needed for the feature. Do not add analytics or telemetry without an explicit decision.',
      '- Destructive or bulk operations require a preview and an item-by-item confirmation.',
      '- Drift from an externally edited file is reported, never overwritten in bulk.',
      '',
      '## Review',
      '',
      '- Security-sensitive changes need two reviewers, one of whom reads the full data flow.',
      '- Record the accepted risk and the follow-up date when a mitigation is deferred.',
    ].join('\n'),
  },
  {
    title: 'Testing Standards',
    description:
      'Path-scoped contract for test files: deterministic setup, meaningful assertions, and no shared mutable state.',
    folder: 'quality',
    scope: 'path',
    pathPrefix: 'tests',
    activation: { mode: 'glob', globs: ['tests/**/*.ts'] },
    priority: 50,
    targetIds: ['copilot-path', 'cursor', 'windsurf'],
    tags: ['testing', 'quality'],
    syncPolicy: 'inherit',
    body: [
      '# Testing Standards',
      '',
      'Apply these rules to files under `tests`.',
      '',
      '## Structure',
      '',
      '- One behavior per test. The test name states the observable outcome.',
      '- Arrange, act, assert. No assertions hidden in helpers that also mutate state.',
      '- Use a fresh temporary directory per test when the filesystem is involved.',
      '',
      '## Determinism',
      '',
      '- Do not depend on wall-clock time, network access, or execution order unless the test explicitly covers that behavior.',
      '- Seed randomness. Freeze time at the boundary instead of sleeping.',
      '- Clean up resources in a finally block or an afterEach hook.',
      '',
      '## Value',
      '',
      '- Prefer a test that would fail for the bug you are fixing over a test that restates the implementation.',
      '- Assert the contract, not private internals. A refactor should not require rewriting the test.',
      '- A skipped test needs a linked issue and an owner.',
    ].join('\n'),
  },
]

const SKILLS = [
  {
    title: 'release-notes',
    description:
      'Builds a review-ready release note from merged changes, with breaking changes separated from improvements.',
    folder: 'engineering/release',
    icon: '🚀',
    author: 'Platform Team',
    versionLabel: '1.4.0',
    category: 'Release',
    tags: ['release', 'automation'],
    files: [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: release-notes',
          'description: Build a review-ready release note from merged changes, with breaking changes separated from improvements.',
          'version: 1.4.0',
          '---',
          '',
          '# Release Notes',
          '',
          'Use this Skill when a release branch is frozen and the team needs notes that match the merged changes.',
          '',
          '## Workflow',
          '',
          '1. Collect merged, non-revert commits for the release range.',
          '2. Classify each change as a highlight, breaking change, improvement, or fix.',
          '3. Rewrite entries as user-visible outcomes; keep component names when useful.',
          '4. Put breaking changes first with the old behavior, new behavior, and required action.',
          '5. Verify every claim against the change list and delete the rest.',
          '',
          '## Guardrails',
          '',
          '- Never invent a feature, date, or migration step.',
          '- Do not describe an internal refactor as a customer benefit.',
          '- Keep the note short enough to scan in one screen per section.',
        ].join('\n'),
      },
      {
        path: 'references/template.md',
        content: [
          '# Release {{version}}',
          '',
          '## Highlights',
          '',
          '- ',
          '',
          '## Breaking changes',
          '',
          '### {{change}}',
          '',
          '**Before:** ',
          '',
          '**After:** ',
          '',
          '**Action required:** ',
          '',
          '## Improvements',
          '',
          '- ',
          '',
          '## Fixes',
          '',
          '- ',
          '',
          '## Upgrade notes',
          '',
          '- ',
        ].join('\n'),
      },
      {
        path: 'scripts/collect-changes.sh',
        content: [
          '#!/usr/bin/env bash',
          '# Demo helper. Prompt Keeper stores and lists this script but never executes it.',
          'set -euo pipefail',
          '',
          'range="${1:-HEAD~10..HEAD}"',
          "git log --no-merges --pretty='- %s (%h)' \"$range\"",
        ].join('\n'),
      },
    ],
  },
  {
    title: 'api-contract-audit',
    description:
      'Audits an OpenAPI diff for backward incompatibilities and produces a client migration checklist.',
    folder: 'engineering/api',
    icon: '🔎',
    author: 'API Guild',
    versionLabel: '2.1.0',
    category: 'API',
    tags: ['api', 'review'],
    files: [
      {
        path: 'SKILL.md',
        content: [
          '# API Contract Audit',
          '',
          'Compare two OpenAPI documents and report only observable client impact.',
          '',
          '## Checks',
          '',
          '- Removed or renamed fields, endpoints, and enum values.',
          '- Required fields that were previously optional.',
          '- Changed status codes and error envelopes.',
          '- Authentication and scope changes.',
          '- Pagination, sorting, and idempotency behavior.',
          '',
          '## Output',
          '',
          'Return a compatibility verdict and a table with endpoint, change, impact, and migration step.',
          'Separate confirmed breakages from suspected ones, and cite the schema location.',
        ].join('\n'),
      },
      {
        path: 'references/checklist.md',
        content: [
          '# Contract Audit Checklist',
          '',
          '- [ ] Diff request parameters and required flags.',
          '- [ ] Diff response fields, nullability, and enum values.',
          '- [ ] Diff status codes and error codes.',
          '- [ ] Diff authentication and scopes.',
          '- [ ] Check pagination and rate-limit headers.',
          '- [ ] Check idempotency keys and retry semantics.',
          '- [ ] Verify deprecation notices have a removal date.',
        ].join('\n'),
      },
    ],
  },
  {
    title: 'code-review-checklist',
    description:
      'A severity-first review checklist for correctness, security, performance, and test coverage.',
    folder: 'engineering/review',
    icon: '✅',
    author: 'Engineering Enablement',
    versionLabel: '1.2.0',
    category: 'Review',
    tags: ['review', 'quality'],
    files: [
      {
        path: 'SKILL.md',
        content: [
          '# Code Review Checklist',
          '',
          'Read the whole change before writing a finding. Then walk these areas in order.',
          '',
          '## Correctness',
          '',
          '- Does the change handle the empty, boundary, and failure cases?',
          '- Is state updated atomically, and is the rollback path real?',
          '- Are errors propagated instead of swallowed?',
          '',
          '## Security',
          '',
          '- Is untrusted input validated at the boundary?',
          '- Are authorization checks performed before reads and writes?',
          '- Do logs or errors contain secrets or personal data?',
          '',
          '## Performance',
          '',
          '- Is there an unbounded query, loop, or retry?',
          '- Does the change add work to a hot path without evidence?',
          '',
          '## Tests',
          '',
          '- Does a test fail without the change?',
          '- Is the test deterministic and independent of execution order?',
          '',
          'Rank each finding as blocker, should-fix, question, or nit.',
        ].join('\n'),
      },
      {
        path: 'references/severity.md',
        content: [
          '# Severity Guide',
          '',
          '**Blocker** — Data loss, security exposure, broken production path, or an unrecoverable migration.',
          '',
          '**Should-fix** — A real defect with a workaround, or a maintainability problem that will compound.',
          '',
          '**Question** — The intent is unclear and the answer changes the review outcome.',
          '',
          '**Nit** — Style or naming preference that does not change behavior.',
        ].join('\n'),
      },
    ],
  },
  {
    title: 'migration-planner',
    description:
      'Plans reversible data migrations with expand, migrate, verify, and contract phases.',
    folder: 'engineering/migrations',
    icon: '🧭',
    author: 'Data Platform',
    versionLabel: '1.0.3',
    category: 'Data',
    tags: ['migrations', 'data'],
    files: [
      {
        path: 'SKILL.md',
        content: [
          '# Migration Planner',
          '',
          'Produce a migration plan that can be paused and reversed at every checkpoint.',
          '',
          '## Phases',
          '',
          '1. **Expand** — Add the new structure without changing readers.',
          '2. **Dual write** — Write both shapes and compare results.',
          '3. **Backfill** — Copy historical data in bounded batches.',
          '4. **Verify** — Run count, checksum, and sample-query comparisons.',
          '5. **Switch reads** — Enable the new path behind a flag.',
          '6. **Contract** — Remove the old structure only after the rollback window.',
          '',
          '## Required details',
          '',
          '- Batch size, throttle, and resume token.',
          '- Abort criteria and the owner of each checkpoint.',
          '- Rollback command and the point of no return.',
        ].join('\n'),
      },
      {
        path: 'references/rollback.md',
        content: [
          '# Rollback Checklist',
          '',
          '- Stop backfill workers and record the last processed key.',
          '- Disable the new read path and confirm the old path is healthy.',
          '- Reconcile rows written during dual write.',
          '- Restore the last verified snapshot if reconciliation fails.',
          '- Record the incident and the data-loss window.',
        ].join('\n'),
      },
    ],
  },
  {
    title: 'frontend-a11y-pass',
    description:
      'Reviews a frontend change for keyboard access, focus management, naming, and contrast.',
    folder: 'engineering/frontend',
    icon: '♿',
    author: 'Design Systems',
    versionLabel: '1.1.0',
    category: 'Frontend',
    tags: ['frontend', 'a11y'],
    files: [
      {
        path: 'SKILL.md',
        content: [
          '# Frontend Accessibility Pass',
          '',
          'Review the changed surface with a keyboard and a screen reader in mind.',
          '',
          '## Checks',
          '',
          '- Every control is reachable in a logical order and has a visible focus ring.',
          '- Dialogs trap focus, restore it on close, and have an accessible title.',
          '- Icon-only buttons have an accessible name.',
          '- Status is not communicated by color alone.',
          '- Form errors are announced and tied to their fields.',
          '- Motion respects reduced-motion preferences.',
          '',
          'Report findings with the element, the barrier, and a concrete fix.',
        ].join('\n'),
      },
    ],
  },
]

const MCPS = [
  {
    title: 'GitHub MCP',
    description:
      'Read repositories, issues, and pull requests through the official GitHub MCP server. The token stays local.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'demo-github-token-not-real' },
    requiredEnv: ['GITHUB_TOKEN'],
    folder: 'dev/git',
    tags: ['git', 'github'],
    notes: 'Demo entry. Replace the token with a real value only on the machine that needs access.',
    source: 'manual',
  },
  {
    title: 'Postgres Read-Only',
    description:
      'Inspect schemas and run read-only queries against the demo warehouse with a least-privilege role.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: 'postgresql://readonly_demo@db.demo.internal:5432/acme_console' },
    requiredEnv: ['DATABASE_URL'],
    folder: 'data',
    tags: ['database', 'read-only'],
    notes: 'Use a dedicated read-only role. Never point this at a production primary.',
    source: 'manual',
  },
  {
    title: 'Sentry Issues',
    description: 'Search and triage Sentry issues from an Agent session without copying a real token.',
    transport: 'http',
    url: 'https://mcp.sentry.example/mcp',
    headers: { Authorization: '${SENTRY_AUTH_TOKEN}' },
    requiredEnv: ['SENTRY_AUTH_TOKEN'],
    folder: 'ops',
    tags: ['observability'],
    notes: 'Placeholder demo endpoint. The repository file stores only the header placeholder.',
    source: 'manual',
  },
  {
    title: 'Filesystem Workspace',
    description:
      'Gives an Agent scoped access to the demo project directory for reading and editing files.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', PROJECT_ROOT],
    env: {},
    requiredEnv: [],
    folder: 'dev',
    tags: ['filesystem'],
    notes: 'The path argument is limited to the temporary demo project root.',
    source: 'manual',
  },
]

const INCIDENT_PROMPT = {
  id: 'ast_incidentcomms01',
  title: 'Incident Comms Template',
  description:
    'Produces a calm, factual status update for an active incident at three levels of detail.',
  folder: 'operations/communications',
  tags: ['incidents', 'comms'],
  syncPolicy: 'sync',
  systemPrompt: [
    'You write incident communications for a technical audience.',
    '',
    '- State what is known, what is unknown, and when the next update will arrive.',
    '- Do not speculate about cause or blame.',
    '- Quantify impact when the data is available.',
  ].join('\n'),
  userPrompt: [
    'Write a status update for {{incident}} at severity {{severity}}.',
    '',
    'Current facts:',
    '{{facts}}',
    '',
    'Return a one-line summary, a short status page update, and an internal update for the response channel.',
  ].join('\n'),
  variables: [
    { name: 'incident', type: 'text', label: 'Incident', required: true },
    {
      name: 'severity',
      type: 'select',
      label: 'Severity',
      options: ['SEV1', 'SEV2', 'SEV3'],
      required: true,
    },
    { name: 'facts', type: 'textarea', label: 'Current facts', required: true },
  ],
}

/* ------------------------------------------------------------------ */
/* Serialization helpers (mirror src/shared/domain)                    */
/* ------------------------------------------------------------------ */

function serializePromptFile(model) {
  const frontmatter = {
    id: model.id,
    title: model.title,
    description: model.description,
    folder: model.folder,
    tags: model.tags,
    syncPolicy: model.syncPolicy,
    variables: model.variables,
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return [
    '---',
    yaml,
    '---',
    '',
    '## System Prompt',
    '',
    model.systemPrompt.trim(),
    '',
    '## User Prompt',
    '',
    model.userPrompt.trim(),
    '',
  ].join('\n')
}

function serializeContractFile(model) {
  const frontmatter = {
    id: model.id,
    title: model.title,
    description: model.description,
    folder: model.folder,
    scope: model.scope,
    pathPrefix: model.pathPrefix ?? '',
    activation: model.activation,
    priority: model.priority,
    imports: model.imports ?? [],
    targetIds: model.targetIds,
    tags: model.tags,
    syncPolicy: model.syncPolicy,
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return ['---', yaml, '---', '', model.body.trim(), ''].join('\n')
}

/* ------------------------------------------------------------------ */
/* Local setup                                                         */
/* ------------------------------------------------------------------ */

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function writeFile(path, content) {
  ensureDir(dirname(path))
  writeFileSync(path, content, 'utf8')
}

function setupIsolatedEnvironment() {
  ensureDir(ASSETS_DIR)
  writeFile(
    join(DEMO_HOME, '.gitconfig'),
    [
      '[user]',
      '\tname = Prompt Keeper Demo',
      '\temail = demo@example.invalid',
      '[init]',
      '\tdefaultBranch = main',
      '[url "file:///tmp/pk-readme-demo/git/acme-console.git"]',
      '\tinsteadOf = git@github.com:acme/team-assets.git',
      '',
    ].join('\n'),
  )

  for (const [, skillDirs, configFile, configContent] of AGENT_LAYOUT) {
    for (const dir of skillDirs) ensureDir(join(DEMO_HOME, dir))
    writeFile(join(DEMO_HOME, configFile), configContent)
  }
  for (const dir of GLOBAL_DIRS) ensureDir(join(DEMO_HOME, dir))

  writeFile(
    join(PROJECT_ROOT, 'README.md'),
    [
      '# Acme Console',
      '',
      'Demo application used to capture Prompt Keeper README screenshots.',
      '',
      '## Layout',
      '',
      '- `src/api` — HTTP handlers',
      '- `src/renderer` — React application',
      '- `tests/unit` — unit tests',
    ].join('\n'),
  )
  writeFile(
    join(PROJECT_ROOT, 'package.json'),
    JSON.stringify(
      {
        name: 'acme-console',
        private: true,
        version: '2.8.0',
        type: 'module',
        scripts: { test: 'vitest run', build: 'vite build' },
      },
      null,
      2,
    ),
  )
  writeFile(
    join(PROJECT_ROOT, 'src', 'api', 'users.ts'),
    [
      "import type { Request, Response } from 'express'",
      '',
      'export async function updateUser(request: Request, response: Response): Promise<void> {',
      '  const userId = request.params.id',
      '  if (!userId) {',
      "    response.status(400).json({ error: { code: 'missing_user_id', message: 'A user ID is required.' } })",
      '    return',
      '  }',
      '  response.status(200).json({ id: userId, updated: true })',
      '}',
      '',
    ].join('\n'),
  )
  writeFile(
    join(PROJECT_ROOT, 'src', 'renderer', 'app', 'App.tsx'),
    [
      "import { useQuery } from '@tanstack/react-query'",
      "import { UserTable } from '../components/UserTable'",
      '',
      'export function App() {',
      "  const users = useQuery({ queryKey: ['users'], queryFn: fetchUsers })",
      '  return <UserTable users={users.data ?? []} loading={users.isLoading} />',
      '}',
      '',
      'async function fetchUsers() {',
      "  const response = await fetch('/api/users')",
      '  return response.json()',
      '}',
      '',
    ].join('\n'),
  )
  writeFile(
    join(PROJECT_ROOT, 'tests', 'unit', 'example.test.ts'),
    [
      "import { describe, expect, it } from 'vitest'",
      '',
      "describe('user update contract', () => {",
      "  it('rejects a request without a user ID', () => {",
      "    expect(validate({})).toEqual({ ok: false, code: 'missing_user_id' })",
      '  })',
      '})',
      '',
      'function validate(input: Record<string, unknown>) {',
      "  return input.id ? { ok: true } : { ok: false, code: 'missing_user_id' }",
      '}',
      '',
    ].join('\n'),
  )
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function createInitialRepository(staff, core) {
  ensureDir(GIT_ROOT)
  git(['init', '--bare', '-b', 'main', BARE_REMOTE], GIT_ROOT)
  git(['init', '-b', 'main', REMOTE_WORK], GIT_ROOT)
  git(['config', 'user.name', 'Prompt Keeper Demo'], REMOTE_WORK)
  git(['config', 'user.email', 'demo@example.invalid'], REMOTE_WORK)

  const staffPath = join(
    REMOTE_WORK,
    'prompts',
    'engineering',
    'review',
    'staff-engineer-pr-review.prompt.md',
  )
  const corePath = join(
    REMOTE_WORK,
    'instructions',
    'engineering',
    'core-standards.contract.md',
  )
  writeFile(staffPath, serializePromptFile(staff))
  writeFile(corePath, serializeContractFile(core))
  writeFile(
    join(REMOTE_WORK, 'README.md'),
    '# Acme shared assets\n\nPrompt and Agent Instruction files shared by the Acme Console team.\n',
  )

  git(['add', '-A'], REMOTE_WORK)
  git(['commit', '-m', 'Seed demo shared assets'], REMOTE_WORK)
  git(['remote', 'add', 'origin', BARE_REMOTE], REMOTE_WORK)
  git(['push', '-u', 'origin', 'main'], REMOTE_WORK)
}

function addRemoteChanges(coreAfterConnect) {
  git(['pull', '--ff-only', 'origin', 'main'], REMOTE_WORK)

  const incidentPath = join(
    REMOTE_WORK,
    'prompts',
    'operations',
    'communications',
    'incident-comms-template.prompt.md',
  )
  writeFile(incidentPath, serializePromptFile(INCIDENT_PROMPT))

  const corePath = join(REMOTE_WORK, 'instructions', 'engineering', 'core-standards.contract.md')
  writeFile(
    corePath,
    serializeContractFile({
      ...coreAfterConnect,
      body: [
        coreAfterConnect.body.trim(),
        '',
        '## Organization policy addendum',
        '',
        '- Production incidents above SEV2 require an executive summary within one hour.',
        '- A change that touches billing data needs a named data owner in the review.',
        '- Quarterly dependency reviews are tracked by the platform team.',
      ].join('\n'),
    }),
  )

  git(['add', '-A'], REMOTE_WORK)
  git(['commit', '-m', 'Add incident comms prompt and policy addendum'], REMOTE_WORK)
  git(['push', 'origin', 'main'], REMOTE_WORK)
}

/* ------------------------------------------------------------------ */
/* Browser helpers                                                     */
/* ------------------------------------------------------------------ */

let page
let app
let cdp

async function waitForShell() {
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(500)
}

async function bridgeResult(group, method, arg) {
  return page.evaluate(
    async ({ group, method, arg }) => {
      const target = window.promptKeeper[group][method]
      return target(arg)
    },
    { group, method, arg },
  )
}

async function call(group, method, arg) {
  const result = await bridgeResult(group, method, arg)
  if (!result || result.ok !== true) {
    throw new Error(`${group}.${method} failed: ${JSON.stringify(result?.error ?? result)}`)
  }
  return result.data
}

async function installOperationTracker() {
  await page.evaluate(() => {
    window.__pkReadmeOps = []
    window.promptKeeper.events.onOperationCompleted((event) => {
      window.__pkReadmeOps.push(event)
    })
  })
}

async function waitOperation(ref) {
  if (!ref || !ref.operationId) throw new Error('Expected an operation reference.')
  await page.waitForFunction(
    (id) =>
      Array.isArray(window.__pkReadmeOps) &&
      window.__pkReadmeOps.some((event) => event.operationId === id),
    ref.operationId,
    { timeout: 120_000 },
  )
  const event = await page.evaluate(
    (id) => window.__pkReadmeOps.find((entry) => entry.operationId === id),
    ref.operationId,
  )
  if (event.state !== 'committed') {
    throw new Error(
      `Operation ${ref.type} ${event.state}: ${event.error?.code ?? ''} ${event.error?.message ?? ''}`,
    )
  }
  return event.result
}

async function applyViewport() {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: CSS_WIDTH,
    height: CSS_HEIGHT,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await page.waitForTimeout(350)
}

async function reloadApp() {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForShell()
  await applyViewport()
}

async function dismissFirstRun() {
  const heading = page.getByRole('heading', { name: 'Welcome to Prompt Keeper' })
  if (await heading.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await heading.waitFor({ state: 'hidden' }).catch(() => {})
  }
}

async function nav(label) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: label, exact: true })
    .click()
  await page.waitForTimeout(650)
}

async function tab(name) {
  await page.getByRole('tab', { name, exact: false }).first().click()
  await page.waitForTimeout(650)
}

async function settle() {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1_100)
  await page
    .waitForFunction(
      () => {
        if (document.querySelector('[aria-label="Dismiss notification"]')) return false
        const operationDismiss = [...document.querySelectorAll('button[aria-label="Dismiss"]')].some(
          (button) => button.getBoundingClientRect().width > 0,
        )
        if (operationDismiss) return false
        const busy = [...document.querySelectorAll('.animate-spin, .animate-pulse')].some((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        return !busy
      },
      null,
      { timeout: 20_000 },
    )
    .catch(() => {})
  await page.waitForTimeout(700)
}

async function capture(name) {
  await settle()
  const rawPath = join(SHOT_ORIGINALS, `${name}@2x.png`)
  const finalPath = join(ASSETS_DIR, `${name}.png`)
  await page.screenshot({ path: rawPath, animations: 'disabled' })
  execFileSync('sips', ['-Z', String(SCREENSHOT_WIDTH), rawPath, '--out', finalPath], {
    stdio: 'ignore',
  })
  const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', finalPath], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line.includes('pixel'))
    .map((line) => line.trim())
    .join(' ')
  const bytes = statSync(finalPath).size
  console.log(`captured ${name}.png | ${dimensions} | ${Math.round(bytes / 1024)} KB`)
}

/** Let a data-dense modal use the available capture height; content is unchanged. */
async function expandModalHeight() {
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) dialog.style.maxHeight = 'calc(100vh - 32px)'
  })
  await page.waitForTimeout(350)
}

/** Use the available content width so all eight Agent columns fit the matrix. */
async function widenDispatchContainer() {
  await page.evaluate(() => {
    const container = document.querySelector('.mx-auto.max-w-6xl')
    if (container) container.style.maxWidth = '1340px'
  })
  await page.waitForTimeout(500)
}

/** Keep the file preview and the install summary visible together at 1000px. */
async function capSkillPreviewHeight() {
  await page.evaluate(() => {
    const files = [...document.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Files ('),
    )
    if (files) files.style.height = '340px'
  })
  await page.waitForTimeout(450)
}

async function scrollModalContent(offset) {
  await page.evaluate((nextOffset) => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return
    const directChild = [...dialog.children].find(
      (element) => element.scrollHeight > element.clientHeight + 4,
    )
    const nested = [...dialog.querySelectorAll('div')].find(
      (element) => element.scrollHeight > element.clientHeight + 4,
    )
    const scroller = directChild ?? nested
    if (scroller) scroller.scrollTop = nextOffset
  }, offset)
  await page.waitForTimeout(450)
}

/* ------------------------------------------------------------------ */
/* Seed                                                               */
/* ------------------------------------------------------------------ */

const EARLY_PROMPT_TITLES = new Set(['Staff Engineer PR Review', 'Release Notes Writer'])
const EARLY_CONTRACT_TITLES = new Set(['Core Engineering Standards', 'Security Review Guardrails'])
const EARLY_PROMPTS = PROMPTS.filter((prompt) => EARLY_PROMPT_TITLES.has(prompt.title))
const LATE_PROMPTS = PROMPTS.filter((prompt) => !EARLY_PROMPT_TITLES.has(prompt.title)).map((prompt) => ({
  ...prompt,
  syncPolicy: 'local',
}))
const EARLY_CONTRACTS = CONTRACTS.filter((contract) => EARLY_CONTRACT_TITLES.has(contract.title))
const LATE_CONTRACTS = CONTRACTS.filter((contract) => !EARLY_CONTRACT_TITLES.has(contract.title)).map(
  (contract) => ({ ...contract, syncPolicy: 'local' }),
)

async function seedLibrary(prompts, contracts, skills, mcps) {
  console.log('seeding assets')
  const seeded = await page.evaluate(
    async (input) => {
      const unwrap = async (promise) => {
        const result = await promise
        if (!result || result.ok !== true) {
          throw new Error(JSON.stringify(result?.error ?? result))
        }
        return result.data
      }

      const prompts = []
      for (const spec of input.prompts) {
        prompts.push(await unwrap(window.promptKeeper.prompts.create(spec)))
      }
      const contracts = []
      for (const spec of input.contracts) {
        contracts.push(await unwrap(window.promptKeeper.contracts.create(spec)))
      }
      const skills = []
      for (const spec of input.skills) {
        skills.push(await unwrap(window.promptKeeper.skills.create(spec)))
      }
      const mcp = []
      for (const spec of input.mcps) {
        mcp.push(await unwrap(window.promptKeeper.mcp.create(spec)))
      }
      return { prompts, contracts, skills, mcp }
    },
    { prompts, contracts, skills, mcps },
  )
  return seeded
}

async function bumpTopPrompts(staffId, releaseId) {
  const staff = await call('prompts', 'get', staffId)
  await call('prompts', 'update', {
    id: staff.id,
    expectedRevisionId: staff.currentRevisionId,
    systemPrompt: [
      staff.systemPrompt.trim(),
      '',
      '- Verify that the rollout plan names an owner and an abort condition.',
    ].join('\n'),
  })
  const release = await call('prompts', 'get', releaseId)
  await call('prompts', 'update', {
    id: release.id,
    expectedRevisionId: release.currentRevisionId,
    userPrompt: [
      release.userPrompt.trim(),
      '',
      'End with the exact command a reader needs to upgrade from the previous version.',
    ].join('\n'),
  })
}

async function shapePrompts(seeded) {
  const byTitle = (title, list) => {
    const item = list.find((entry) => entry.title === title)
    if (!item) throw new Error(`Missing seeded asset: ${title}`)
    return item
  }
  const staff = byTitle('Staff Engineer PR Review', seeded.prompts)
  const release = byTitle('Release Notes Writer', seeded.prompts)
  const api = byTitle('API Contract Reviewer', seeded.prompts)
  const spec = byTitle('Product Spec Critic', seeded.prompts)

  await page.evaluate(
    async (input) => {
      const unwrap = async (promise) => {
        const result = await promise
        if (!result || result.ok !== true) throw new Error(JSON.stringify(result?.error ?? result))
        return result.data
      }

      for (const id of [input.staffId, input.releaseId]) {
        await unwrap(window.promptKeeper.prompts.setFavorite({ id, favorite: true }))
        await unwrap(window.promptKeeper.prompts.setPinned({ id, pinned: true }))
      }

      await unwrap(
        window.promptKeeper.prompts.update({
          id: input.apiId,
          expectedRevisionId: input.apiRevision,
          description:
            'Compares an API change against the published contract and flags breaking behavior before it ships. Includes a client migration checklist.',
        }),
      )
      await unwrap(
        window.promptKeeper.prompts.update({
          id: input.specId,
          expectedRevisionId: input.specRevision,
          systemPrompt: [
            'You are a skeptical but constructive product reviewer.',
            '',
            'Evaluate the problem statement, user evidence, scope boundaries, success metrics, and rollback plan. Separate missing information from genuine design flaws. Ask at most five high-leverage questions.',
            '',
            'Prefer a smaller release that proves the core assumption over a broad release with no clear owner.',
          ].join('\n'),
        }),
      )

      const usage = [
        [input.staffId, 47],
        [input.releaseId, 23],
        [input.apiId, 14],
        [input.promptIds.incident, 9],
        [input.promptIds.sql, 11],
        [input.promptIds.spec, 7],
        [input.promptIds.migration, 5],
        [input.promptIds.test, 6],
      ]
      for (const [id, count] of usage) {
        for (let index = 0; index < count; index += 1) {
          await unwrap(
            window.promptKeeper.prompts.copyRender({
              id,
              values: {
                language: 'TypeScript',
                code: 'const result = await loadUser(id)',
                riskFocus: 'security',
                product: 'Acme Console',
                version: '2.8.0',
                audience: 'platform engineers',
                changes: 'Add audit log export',
                endpoint: 'PATCH /v1/users/:id',
                current: '{}',
                proposed: '{}',
                incident: 'Checkout latency spike',
                timeline: '14:02 alert, 14:10 mitigation',
                impact: '12% of checkouts slowed',
                dialect: 'PostgreSQL',
                query: 'select * from orders',
                plan: 'Seq Scan on orders',
                spec: 'Improve onboarding',
                source: 'Legacy orders',
                target: 'Orders service',
                constraints: 'No downtime',
                change: 'Retry policy update',
                components: 'billing',
              },
            }),
          )
        }
      }
    },
    {
      staffId: staff.id,
      releaseId: release.id,
      apiId: api.id,
      apiRevision: api.currentRevisionId,
      specId: spec.id,
      specRevision: spec.currentRevisionId,
      promptIds: {
        incident: byTitle('Incident Postmortem Coach', seeded.prompts).id,
        sql: byTitle('SQL Query Optimizer', seeded.prompts).id,
        spec: spec.id,
        migration: byTitle('Migration Risk Planner', seeded.prompts).id,
        test: byTitle('Test Plan Generator', seeded.prompts).id,
      },
    },
  )
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  setupIsolatedEnvironment()
  console.log('isolated user data:', USER_DATA)
  console.log('isolated HOME:', DEMO_HOME)
  console.log('demo project:', PROJECT_ROOT)
  console.log('local Git remote:', BARE_REMOTE)

  app = await electron.launch({
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PK_USER_DATA: USER_DATA,
      PK_BUILD_ID: 'readme',
      HOME: DEMO_HOME,
      USERPROFILE: DEMO_HOME,
      GIT_CONFIG_GLOBAL: join(DEMO_HOME, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForShell()
  await dismissFirstRun()

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(1600, 1000)
    window.center()
  })
  await page.waitForTimeout(600)
  cdp = await page.context().newCDPSession(page)
  await applyViewport()

  await call('app', 'theme', { theme: 'light' })
  await reloadApp()
  await dismissFirstRun()
  await installOperationTracker()

  // Seed the four sync-story assets first so the review queue contains only
  // the changes that belong to the story. The rest of the library is created
  // after the fetch, with a local-only policy.
  const early = await seedLibrary(EARLY_PROMPTS, EARLY_CONTRACTS, [], [])

  const project = await call('projects', 'register', {
    name: 'Acme Console',
    rootPath: PROJECT_ROOT,
  })

  const staffSeeded = early.prompts.find((entry) => entry.title === 'Staff Engineer PR Review')
  const coreSeeded = early.contracts.find((entry) => entry.title === 'Core Engineering Standards')
  const releaseSeeded = early.prompts.find((entry) => entry.title === 'Release Notes Writer')
  if (!staffSeeded || !coreSeeded || !releaseSeeded) {
    throw new Error('The demo library did not seed the sync-story assets.')
  }

  console.log('creating the initial local Git repository')
  createInitialRepository(staffSeeded, coreSeeded)

  const connectBase = {
    url: 'git@github.com:acme/team-assets.git',
    provider: 'generic',
    branch: 'main',
    cloneMode: 'managed',
    auth: { mode: 'credential' },
    policies: { prompts: true, contracts: true, skills: false, mcp: false },
    autoFetch: false,
    confirm: false,
  }
  const connectPreview = await call('sync', 'repoConnect', connectBase)
  if (connectPreview.phase !== 'preview') throw new Error('Repository preview did not return a preview.')
  console.log(
    `repository preview: ${connectPreview.counts.prompt} prompts, ${connectPreview.counts.contract} contracts, ${connectPreview.malformed.length} malformed`,
  )
  await call('sync', 'repoConnect', {
    ...connectBase,
    confirm: true,
    previewToken: connectPreview.previewToken,
  })

  const staffAfterConnect = await call('prompts', 'get', staffSeeded.id)
  const coreAfterConnect = await call('contracts', 'get', coreSeeded.id)
  const releaseAfterConnect = await call('prompts', 'get', releaseSeeded.id)

  console.log('creating outgoing local changes')
  await call('prompts', 'update', {
    id: releaseAfterConnect.id,
    expectedRevisionId: releaseAfterConnect.currentRevisionId,
    userPrompt: [
      releaseAfterConnect.userPrompt.trim(),
      '',
      'Close with a one-line upgrade command for the current installation method.',
    ].join('\n'),
  })
  await call('prompts', 'update', {
    id: staffAfterConnect.id,
    expectedRevisionId: staffAfterConnect.currentRevisionId,
    systemPrompt: [
      staffAfterConnect.systemPrompt.trim(),
      '',
      '## Review protocol',
      '',
      '- Start with the verdict, then list findings by severity.',
      '- Name one thing the author did well before the first blocker.',
      '- If the diff is too large to reason about, ask for a split instead of guessing.',
    ].join('\n'),
  })
  await call('contracts', 'update', {
    id: coreAfterConnect.id,
    expectedRevisionId: coreAfterConnect.currentRevisionId,
    body: [
      coreAfterConnect.body.trim(),
      '',
      '## Local review protocol',
      '',
      '- Every pull request names the riskiest assumption and how it was tested.',
      '- A reviewer who cannot reproduce the change asks for a smaller slice.',
      '- Post-incident follow-ups are linked from the change description.',
    ].join('\n'),
  })

  console.log('adding remote changes and fetching')
  addRemoteChanges(coreAfterConnect)
  const fetchRef = await call('sync', 'fetch', {})
  const fetchResult = await waitOperation(fetchRef)
  console.log('fetch result:', JSON.stringify(fetchResult))
  const changesAfterFetch = await call('sync', 'changes', { limit: 50 })
  const directionCounts = changesAfterFetch.items.reduce(
    (counts, change) => {
      counts[change.direction] += 1
      counts.total += 1
      return counts
    },
    { incoming: 0, outgoing: 0, conflict: 0, total: 0 },
  )
  console.log('pending changes:', JSON.stringify(directionCounts))
  for (const change of changesAfterFetch.items) {
    console.log(`  ${change.direction.padEnd(8)} ${change.assetName} (${change.path})`)
  }
  if (directionCounts.conflict === 0) {
    console.log('warning: no Git conflict was produced; continuing with incoming and outgoing changes')
  }

  console.log('seeding the remaining library')
  const late = await seedLibrary(LATE_PROMPTS, LATE_CONTRACTS, SKILLS, MCPS)
  const seeded = {
    prompts: [...early.prompts, ...late.prompts],
    contracts: [...early.contracts, ...late.contracts],
    skills: late.skills,
    mcp: late.mcp,
  }
  await shapePrompts(seeded)
  await bumpTopPrompts(staffSeeded.id, releaseSeeded.id)

  const githubMcp = seeded.mcp.find((entry) => entry.title === 'GitHub MCP')
  const releaseSkill = seeded.skills.find((entry) => entry.title === 'release-notes')
  if (!githubMcp || !releaseSkill) {
    throw new Error('The demo library did not seed the Skill and MCP assets.')
  }
  await call('mcp', 'setFavorite', { id: githubMcp.id, favorite: true })

  console.log('projecting the core contract')
  const projectRef = await call('projections', 'project', {
    contractIds: [coreAfterConnect.id],
    targetIds: ['agents-md', 'claude'],
    projectId: project.id,
    confirm: true,
  })
  console.log('project projection:', JSON.stringify(await waitOperation(projectRef)))
  const globalRef = await call('globalProjections', 'project', {
    contractIds: [coreAfterConnect.id],
    targetIds: ['gt-claude', 'gt-codex'],
    confirm: true,
  })
  console.log('global projection:', JSON.stringify(await waitOperation(globalRef)))
  for (const path of [
    join(PROJECT_ROOT, 'AGENTS.md'),
    join(PROJECT_ROOT, 'CLAUDE.md'),
    join(DEMO_HOME, '.claude', 'CLAUDE.md'),
    join(DEMO_HOME, '.codex', 'AGENTS.md'),
  ]) {
    console.log(`projection file ${existsSync(path) ? 'present' : 'missing'}: ${path}`)
  }

  console.log('installing the release-notes Skill')
  async function installSkill(agentIds, mode) {
    const preview = await call('dispatch', 'install', {
      assetId: releaseSkill.id,
      agentIds,
      mode,
      confirm: false,
    })
    if (preview.phase !== 'preview') throw new Error('Dispatch preview did not return a preview.')
    const ref = await call('dispatch', 'install', {
      assetId: releaseSkill.id,
      agentIds,
      mode,
      confirm: true,
      previewToken: preview.previewToken,
      acknowledgeScripts: true,
    })
    return waitOperation(ref)
  }
  console.log('dispatch symlink:', JSON.stringify(await installSkill(['claude', 'cursor'], 'symlink')))
  console.log('dispatch copy:', JSON.stringify(await installSkill(['codex'], 'copy')))

  const releaseCurrent = await call('skills', 'get', releaseSkill.id)
  const nextFiles = releaseCurrent.files.map((file) => ({ path: file.path, content: '' }))
  const fileResult = await call('skills', 'files', {
    assetId: releaseSkill.id,
    includeContent: true,
  })
  const updatedSkill = await call('skills', 'update', {
    id: releaseSkill.id,
    expectedRevisionId: releaseCurrent.currentRevisionId,
    versionLabel: '1.5.0',
    description:
      'Builds a review-ready release note from merged changes, with breaking changes separated from improvements and a verified upgrade path.',
    files: nextFiles.map((file) => {
      const content = fileResult.contents?.[file.path] ?? ''
      if (file.path !== 'SKILL.md') return { path: file.path, content }
      return {
        path: file.path,
        content: [
          content.trim(),
          '',
          '## Coverage check',
          '',
          '- Confirm the release note mentions every breaking change in the range.',
          '- Confirm each upgrade step names the exact command or setting.',
          '- Remove entries that cannot be verified from the change list.',
        ].join('\n'),
      }
    }),
  })
  console.log(`release-notes updated to v${updatedSkill.versionLabel} (revision ${updatedSkill.currentVersion})`)
  console.log('dispatch to Windsurf:', JSON.stringify(await installSkill(['windsurf'], 'symlink')))
  console.log('refresh Claude to v1.5:', JSON.stringify(await installSkill(['claude'], 'symlink')))

  const releaseDetail = await call('dispatch', 'detail', { assetId: releaseSkill.id })
  const codexCell = releaseDetail.cells.find((cell) => cell.agentId === 'codex')
  if (codexCell?.targetPath) {
    const driftFile = join(codexCell.targetPath, 'SKILL.md')
    if (existsSync(driftFile)) {
      appendFileSync(
        driftFile,
        '\n\nHand-edited demo drift note: this line exists only in the isolated Agent copy.\n',
        'utf8',
      )
      console.log('introduced intentional drift in the isolated Codex copy:', driftFile)
    } else {
      console.log('warning: Codex copy not found at', driftFile)
    }
  }
  await call('dispatch', 'matrix', { kinds: ['skill'] })
  const releaseSummary = await call('skills', 'get', releaseSkill.id)
  console.log('release-notes install summary:', JSON.stringify(releaseSummary.installSummary))

  console.log('filling the dispatch matrix with more real installs')
  const allSkills = (await call('skills', 'list', { limit: 50 })).items
  const skillByTitle = (title) => allSkills.find((entry) => entry.title === title)
  async function installAnySkill(title, agentIds, mode) {
    const asset = skillByTitle(title)
    if (!asset) return
    const preview = await call('dispatch', 'install', {
      assetId: asset.id,
      agentIds,
      mode,
      confirm: false,
    })
    if (preview.phase !== 'preview') throw new Error(`Dispatch preview for ${title} did not return a preview.`)
    const ref = await call('dispatch', 'install', {
      assetId: asset.id,
      agentIds,
      mode,
      confirm: true,
      previewToken: preview.previewToken,
      acknowledgeScripts: true,
    })
    console.log(`dispatch ${title}:`, JSON.stringify(await waitOperation(ref)))
  }
  await installAnySkill('code-review-checklist', ['claude', 'cursor'], 'symlink')
  await installAnySkill('api-contract-audit', ['codex', 'cursor'], 'copy')
  await installAnySkill('frontend-a11y-pass', ['claude', 'windsurf'], 'symlink')
  await installAnySkill('migration-planner', ['codex', 'kiro'], 'copy')

  const allMcp = (await call('mcp', 'list', { limit: 50 })).items
  const mcpByTitle = (title) => allMcp.find((entry) => entry.title === title)
  async function applyAnyMcp(title, agentIds) {
    const server = mcpByTitle(title)
    if (!server) return
    const preview = await call('mcp', 'apply', { serverIds: [server.id], agentIds, confirm: false })
    if (preview.phase !== 'preview') throw new Error(`MCP preview for ${title} did not return a preview.`)
    const ref = await call('mcp', 'apply', {
      serverIds: [server.id],
      agentIds,
      confirm: true,
      previewToken: preview.previewToken,
      acknowledgePlaintextAtRest: true,
    })
    console.log(`mcp ${title}:`, JSON.stringify(await waitOperation(ref)))
  }
  await applyAnyMcp('GitHub MCP', ['claude', 'codex', 'cursor', 'windsurf', 'opencode', 'cline', 'kiro', 'qoder'])
  await applyAnyMcp('Postgres Read-Only', ['claude', 'codex'])
  await applyAnyMcp('Sentry Issues', ['cursor'])
  await applyAnyMcp('Filesystem Workspace', ['windsurf'])

  console.log('applying GitHub MCP to three Agents')
  const mcpPreview = await call('mcp', 'apply', {
    serverIds: [githubMcp.id],
    agentIds: ['claude', 'cursor', 'codex'],
    confirm: false,
  })
  if (mcpPreview.phase !== 'preview') throw new Error('MCP apply did not return a preview.')
  const mcpRef = await call('mcp', 'apply', {
    serverIds: [githubMcp.id],
    agentIds: ['claude', 'cursor', 'codex'],
    confirm: true,
    previewToken: mcpPreview.previewToken,
    acknowledgePlaintextAtRest: true,
  })
  console.log('mcp apply:', JSON.stringify(await waitOperation(mcpRef)))

  console.log('reloading the app for a clean capture state')
  await page.waitForTimeout(3_600)
  await call('app', 'theme', { theme: 'light' })
  await reloadApp()
  await dismissFirstRun()

  /* ------------------------------ shot 01 ------------------------------ */
  console.log('capturing 01-prompts-library')
  await nav('Prompts')
  await tab('Library')
  const expandEngineering = page.getByRole('button', { name: 'Expand engineering' })
  if (await expandEngineering.count()) await expandEngineering.first().click()
  await page.waitForTimeout(400)
  await page
    .locator('button')
    .filter({ hasText: 'Staff Engineer PR Review' })
    .first()
    .click()
  await page.getByRole('heading', { name: 'Staff Engineer PR Review' }).first().waitFor()
  await page.waitForTimeout(700)
  await capture('01-prompts-library')

  /* ------------------------------ shot 02 ------------------------------ */
  console.log('capturing 02-prompt-variables')
  await page.getByRole('button', { name: /Copy with variables/i }).first().click()
  const variableDialog = page.getByRole('dialog')
  await variableDialog.getByLabel('Language').fill('TypeScript')
  await variableDialog
    .getByLabel('Code')
    .fill(
      [
        'const cached = await redis.get(`user:${id}`)',
        'if (cached) return JSON.parse(cached)',
        'const user = await db.users.findOne({ id })',
        'return user',
      ].join('\n'),
    )
  await variableDialog.getByLabel('Risk focus').selectOption('security')
  await variableDialog
    .getByLabel('Code')
    .evaluate((element) => {
      element.scrollTop = 0
    })
  await page.waitForTimeout(500)
  await capture('02-prompt-variables')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})

  /* ------------------------------ shot 03 ------------------------------ */
  console.log('capturing 03-agent-instructions')
  await nav('Agent Instructions')
  await tab('Contract Library')
  await page.getByRole('button', { name: /Resolution preview/i }).first().click()
  const resolutionDialog = page.getByRole('dialog', { name: /Resolution preview/i })
  await resolutionDialog.waitFor()
  const resolutionSelects = resolutionDialog.locator('select')
  await resolutionSelects.nth(0).selectOption('cursor')
  await page.waitForTimeout(300)
  await resolutionSelects.nth(2).selectOption(project.id)
  await resolutionDialog
    .getByPlaceholder('src/components/PromptDetail.tsx')
    .fill('src/renderer/app/App.tsx')
  await resolutionDialog.getByText('Included contracts', { exact: true }).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(900)
  await expandModalHeight()
  await scrollModalContent(90)
  await capture('03-agent-instructions')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})

  /* ------------------------------ shot 04 ------------------------------ */
  console.log('capturing 04-skill-dispatch')
  await nav('Skills')
  await tab('Library')
  await page.locator('button').filter({ hasText: 'release-notes' }).first().click()
  await page.getByRole('heading', { name: 'release-notes' }).first().waitFor()
  await page.getByText('Install summary', { exact: true }).waitFor()
  await capSkillPreviewHeight()
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('span')].find(
      (element) => element.textContent?.trim() === 'Install summary',
    )
    const section = label?.closest('section')
    const scroller = section?.closest('.overflow-y-auto')
    if (scroller) scroller.scrollTop = 20
  })
  await page.waitForTimeout(600)
  await capture('04-skill-dispatch')

  /* ------------------------------ shot 05 ------------------------------ */
  console.log('capturing 05-mcp-secrets')
  await nav('MCP')
  await tab('Library')
  await page.locator('[role="button"]').filter({ hasText: 'GitHub MCP' }).first().click()
  await page.getByRole('heading', { name: 'GitHub MCP' }).first().waitFor()
  await page.getByRole('button', { name: /Apply to Agents/i }).first().click()
  const applyDialog = page.getByRole('dialog')
  await applyDialog.waitFor()
  await applyDialog.getByText('Claude Code', { exact: true }).first().waitFor({ timeout: 15_000 })
  const targetBoxes = applyDialog.locator('input[type="checkbox"]')
  const targetBoxCount = await targetBoxes.count()
  for (let index = 0; index < targetBoxCount; index += 1) {
    const box = targetBoxes.nth(index)
    if (index === 2) {
      if (!(await box.isChecked())) await box.check()
    } else if (await box.isChecked()) {
      await box.uncheck()
    }
  }
  await applyDialog.getByText('Preview apply', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  await applyDialog.getByRole('button', { name: /Preview apply/i }).click()
  await applyDialog.getByText('Preview', { exact: true }).waitFor({ timeout: 20_000 })
  await applyDialog.getByText('Redacted', { exact: true }).waitFor()
  await page.waitForTimeout(800)
  await expandModalHeight()
  await scrollModalContent(9999)
  await capture('05-mcp-secrets')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})

  /* ------------------------------ shot 06 ------------------------------ */
  console.log('capturing 06-sync-changes')
  await nav('Sync')
  await tab('Changes')
  await page.getByRole('button', { name: 'Incident Comms Template', exact: true }).first().waitFor({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Incident Comms Template', exact: true }).first().click()
  const changeDialog = page.getByRole('dialog')
  await changeDialog.getByText('Base (last sync)', { exact: true }).waitFor({ timeout: 20_000 })
  await changeDialog.getByText('Remote repository', { exact: true }).waitFor()
  const reviewAck = changeDialog.getByRole('checkbox')
  if (await reviewAck.count()) await reviewAck.check()
  await page.waitForTimeout(900)
  await capture('06-sync-changes')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})

  /* --------------------------- shot 06b: conflict ----------------------- */
  console.log('capturing 10-sync-conflict')
  await page.getByRole('button', { name: 'Core Engineering Standards', exact: true }).first().click()
  const conflictDialog = page.getByRole('dialog')
  await conflictDialog.getByText('Base (last sync)', { exact: true }).waitFor({ timeout: 20_000 })
  await conflictDialog.getByText('Conflict', { exact: true }).first().waitFor()
  await page.waitForTimeout(900)
  await capture('10-sync-conflict')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})

  /* ------------------------------ shot 07 ------------------------------ */
  console.log('capturing 07-dispatch-matrix')
  await tab('Dispatch')
  await page.getByText('Cells:', { exact: true }).waitFor({ timeout: 20_000 })
  await widenDispatchContainer()
  await page.waitForTimeout(1_000)
  await capture('07-dispatch-matrix')

  /* ------------------------------ shot 08 ------------------------------ */
  console.log('capturing 08-dark-prompts')
  await call('app', 'theme', { theme: 'dark' })
  await reloadApp()
  await nav('Prompts')
  await tab('Library')
  const darkExpand = page.getByRole('button', { name: 'Expand engineering' })
  if (await darkExpand.count()) await darkExpand.first().click()
  await page.waitForTimeout(400)
  await page
    .locator('button')
    .filter({ hasText: 'Staff Engineer PR Review' })
    .first()
    .click()
  await page.getByRole('heading', { name: 'Staff Engineer PR Review' }).first().waitFor()
  await page.waitForTimeout(700)
  await capture('08-dark-prompts')

  await call('app', 'theme', { theme: 'light' })
  await reloadApp()

  /* ------------------------------ shot 09 ------------------------------ */
  console.log('capturing 09-sync-overview')
  await nav('Sync')
  await tab('Overview')
  await page.getByText('Detected Agents', { exact: true }).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1_000)
  await capture('09-sync-overview')

  console.log('originals:', SHOT_ORIGINALS)
  console.log('deliverables:', ASSETS_DIR)
}

try {
  await main()
} catch (error) {
  console.error('capture failed:', error)
  if (page) {
    await page
      .screenshot({ path: join(SHOT_ORIGINALS, 'failure.png'), animations: 'disabled' })
      .catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
}
