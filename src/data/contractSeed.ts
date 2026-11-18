import type {
  AgentContract,
  ContractProjection,
  SyncChange,
  VersionSnapshot,
} from '../types'
import { contractFilePath, serializeContractFile } from '../lib/contracts'

const daysAgo = (d: number, h = 10) => {
  const t = new Date()
  t.setDate(t.getDate() - d)
  t.setHours(h, 24, 0, 0)
  return t.toISOString()
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60_000).toISOString()

type ContractSeed = Omit<AgentContract, 'versions' | 'createdAt' | 'updatedAt'>

function makeVersions(
  base: ContractSeed,
  history: { version: number; at: string; note?: string; body?: string }[],
): VersionSnapshot[] {
  return history.map((h) => ({
    id: `${base.id}-v${h.version}-${Math.random().toString(36).slice(2, 8)}`,
    version: h.version,
    note: h.note,
    createdAt: h.at,
    data: {
      content: JSON.stringify({
        title: base.title,
        description: base.description,
        folder: base.folder,
        body: h.body ?? base.body,
        scope: base.scope,
        path: base.path ?? '',
        activation: base.activation,
        priority: base.priority,
        imports: base.imports,
        targets: base.targets,
        tags: base.tags,
      }),
    },
  }))
}

const baselineV1 = `# Repository Conventions

## Build and test
- Install dependencies with \`npm ci\`; do not hand-edit the lockfile.
- Always run \`npm run build\` before committing; type errors must not be committed.

## Code style
- TypeScript strict mode; \`any\` is forbidden.
- Comments explain constraints and reasons, not restate the code.
`

const baselineBody = `# Repository Conventions

## Build and test
- Install dependencies with \`npm ci\`; do not hand-edit the lockfile.
- Always run \`npm run build\` before committing; type errors must not be committed.
- Run unit tests with \`npm test -- --run\`; new logic must include tests.

## Code style
- TypeScript strict mode; \`any\` is forbidden. When you truly need an escape hatch, use \`unknown\` plus a type guard.
- Keep components single-purpose; put logic shared across modules in \`src/lib/\`.
- Comments explain constraints and reasons, not restate the code.

## Security
- Never write secrets, tokens, or real user data into the repository.
- Validate all external input; never concatenate shell commands.
`

const frontendV1 = `# Frontend Code Standards

## Components
- Function components + hooks; do not add class components.
- Lift state to the nearest common parent.

## Styling
- Use Tailwind tokens; never scatter raw hex colors.
`

const frontendBody = `# Frontend Code Standards

## Components
- Function components + hooks; do not add class components.
- Lift state to the nearest common parent; only cross-page state belongs in Context.
- List rendering must use stable keys; never use array indices.

## Styling
- Use Tailwind tokens (\`bg-card\` / \`text-muted-foreground\`); never scatter raw hex colors.
- Interaction states must cover hover / focus-visible / disabled.

## Accessibility
- Icon buttons must have a \`title\` or \`aria-label\`.
- When an overlay opens, focus moves into it; Esc closes it.
`

const frontendRemote = `${frontendBody}
## Performance
- Use virtual scrolling for large lists; avoid creating new objects as props inside render functions.
- Lazy-load images and set explicit width/height to avoid layout shift.
`

const baselineSeed: ContractSeed = {
  id: 'c-repo-baseline',
  title: 'Repository Conventions',
  description: 'Build, test, and security conventions every Agent must follow when working in this repository',
  body: baselineBody,
  folder: 'team/repository-baseline',
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 100,
  imports: [],
  targets: ['agents-md', 'claude', 'copilot', 'cursor', 'windsurf'],
  tags: ['Repository', 'Baseline'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const frontendSeed: ContractSeed = {
  id: 'c-frontend',
  title: 'Frontend Code Standards',
  description: 'Component, styling, and accessibility constraints for TypeScript / TSX files under src',
  body: frontendBody,
  folder: 'team/frontend',
  scope: 'path',
  path: 'src',
  activation: { mode: 'glob', globs: ['src/**/*.{ts,tsx}'] },
  priority: 60,
  imports: [],
  targets: ['copilot-path', 'cursor', 'agents-md'],
  tags: ['Frontend', 'Standards'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const claudeSeed: ContractSeed = {
  id: 'c-claude-session',
  title: 'Claude Code Session Preferences',
  description: 'Plan first, read the design docs first, never auto-commit; reference the interaction design doc via @import',
  folder: 'personal/session-preferences',
  body: `# Claude Code Session Conventions

- Read \`docs/interaction-design.md\` before changing interaction-related code.
- Before editing, state the goal, the files involved, and the verification command; for complex tasks, write the plan first.
- Do not auto-commit; write commit messages in English.
- When the design doc and the code conflict, point out the conflict instead of inventing a compromise.
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 80,
  imports: ['docs/interaction-design.md'],
  targets: ['claude'],
  tags: ['Claude', 'Collaboration'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const reviewSeed: ContractSeed = {
  id: 'c-cursor-review',
  title: 'Cursor Review Rules',
  description: 'Review guidelines applied when the user asks for a code review or a change check',
  folder: 'personal/review',
  body: `# Code Review Guidelines

- Check correctness and edge cases first, then readability, performance, and security.
- Every issue must include the file location, trigger conditions, and a fix suggestion.
- Mark uncertain conclusions as "needs verification"; do not guess.
- Do not present style preferences as defects; categorize style issues separately.
`,
  scope: 'project',
  activation: {
    mode: 'model',
    globs: [],
    description: 'Applied when the user asks for a code review or a change check',
  },
  priority: 40,
  imports: [],
  targets: ['cursor', 'windsurf'],
  tags: ['Review'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const releaseSeed: ContractSeed = {
  id: 'c-release-checklist',
  title: 'Release Checklist',
  description: 'Rollback, migration, and monitoring checks to reference manually before a release',
  folder: 'team/release',
  body: `# Release Checklist

1. Confirm the version number matches the CHANGELOG.
2. Run the full test suite and build.
3. Check that database migrations can be rolled back.
4. Confirm monitoring and alerts cover the new endpoints.
5. Prepare the rollback commands and assign an owner.
`,
  scope: 'project',
  activation: { mode: 'manual', globs: [] },
  priority: 20,
  imports: [],
  targets: ['cursor', 'windsurf'],
  tags: ['Release'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const legacySeed: ContractSeed = {
  id: 'c-legacy-cursor',
  title: 'Legacy Cursor Rules (to be merged)',
  description: 'Historical rules that conflict with the current frontend standards, kept for comparison during the merge',
  folder: 'archive/legacy-rules',
  body: `# Legacy Cursor Rules

- All functions must have JSDoc comments.
- Use 4-space indentation.
- Prefer class components.
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 10,
  imports: [],
  targets: ['cursor'],
  tags: ['Legacy'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const teamUiSeed: ContractSeed = {
  id: 'c-team-ui',
  title: 'Team UI Conventions',
  description: 'Team-wide component naming and empty-state conventions, pending pull',
  folder: 'team/ui',
  body: `# Team UI Conventions

- Component files use PascalCase; each file exports exactly one main component.
- Empty states must distinguish "no data" from "no matches" and offer a next action.
- Primary buttons for destructive actions use red, and the label names the object being affected.
- All overlays close on Esc and restore focus afterward.
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 70,
  imports: [],
  targets: ['agents-md', 'claude', 'copilot'],
  tags: ['Team', 'UI'],
  syncPolicy: 'inherit',
  inRepo: false,
  }

export const SEED_CONTRACTS: AgentContract[] = [
  {
    ...baselineSeed,
    versions: makeVersions(baselineSeed, [
      { version: 2, at: daysAgo(1), note: 'Added security constraints and testing requirements' },
      { version: 1, at: daysAgo(12), note: 'Initial version', body: baselineV1 },
    ]),
    createdAt: daysAgo(12),
    updatedAt: daysAgo(1),
  },
  {
    ...frontendSeed,
    versions: makeVersions(frontendSeed, [
      { version: 2, at: daysAgo(2), note: 'Added accessibility and list key constraints' },
      { version: 1, at: daysAgo(9), note: 'Initial version', body: frontendV1 },
    ]),
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
  {
    ...claudeSeed,
    versions: makeVersions(claudeSeed, [
      { version: 2, at: daysAgo(3), note: 'Added @import and conflict handling requirements' },
      { version: 1, at: daysAgo(15), note: 'Initial version' },
    ]),
    createdAt: daysAgo(15),
    updatedAt: daysAgo(3),
  },
  {
    ...reviewSeed,
    versions: makeVersions(reviewSeed, [
      { version: 2, at: daysAgo(4), note: 'Separated defects from style preferences' },
      { version: 1, at: daysAgo(18), note: 'Initial version' },
    ]),
    createdAt: daysAgo(18),
    updatedAt: daysAgo(4),
  },
  {
    ...releaseSeed,
    versions: makeVersions(releaseSeed, [
      { version: 2, at: daysAgo(6), note: 'Added monitoring and rollback ownership' },
      { version: 1, at: daysAgo(20), note: 'Initial version' },
    ]),
    createdAt: daysAgo(20),
    updatedAt: daysAgo(6),
  },
  {
    ...legacySeed,
    versions: makeVersions(legacySeed, [
      { version: 1, at: daysAgo(30), note: 'Imported historical rules' },
    ]),
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  },
]

/* ---------------- Projection status ---------------- */

const projection = (
  contractId: string,
  targetId: string,
  status: ContractProjection['status'],
  deployedVersion: string,
  deployedAt?: string,
  note?: string,
): ContractProjection => ({
  id: `proj-${contractId}-${targetId}`,
  contractId,
  targetId,
  status,
  deployedVersion,
  deployedAt,
  note,
})

export const SEED_CONTRACT_PROJECTIONS: ContractProjection[] = [
  projection('c-repo-baseline', 'agents-md', 'synced', 'v2', hoursAgo(2)),
  projection('c-repo-baseline', 'claude', 'stale', 'v1', daysAgo(4), 'Local copy is at v2; waiting to be re-projected'),
  projection('c-repo-baseline', 'copilot', 'synced', 'v2', hoursAgo(2)),
  projection('c-frontend', 'copilot-path', 'drifted', 'v1', daysAgo(3), 'The target file was edited by hand on the Agent side; not overwritten automatically'),
  projection('c-frontend', 'cursor', 'stale', 'v1', daysAgo(3), 'Contract updated to v2; waiting to be re-projected'),
  projection('c-claude-session', 'claude', 'synced', 'v2', daysAgo(1)),
  projection('c-cursor-review', 'cursor', 'synced', 'v2', daysAgo(4)),
  projection('c-release-checklist', 'windsurf', 'synced', 'v2', daysAgo(6)),
  projection('c-release-checklist', 'cursor', 'synced', 'v2', daysAgo(6)),
  projection('c-legacy-cursor', 'cursor', 'synced', 'v1', daysAgo(30)),
]

/* ---------------- Git sync seeds ---------------- */

const remoteContractFile = (seed: ContractSeed) =>
  serializeContractFile({
    ...seed,
    versions: [],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  } as AgentContract)

const baselineBase = {
  ...baselineSeed,
  body: baselineV1,
  versions: [],
  createdAt: daysAgo(12),
  updatedAt: daysAgo(12),
} as AgentContract

const frontendBase = {
  ...frontendSeed,
  body: frontendV1,
  versions: [],
  createdAt: daysAgo(9),
  updatedAt: daysAgo(9),
} as AgentContract

const frontendRemoteContract = {
  ...frontendSeed,
  body: frontendRemote,
  versions: [],
  createdAt: daysAgo(9),
  updatedAt: daysAgo(1),
} as AgentContract

export const SEED_CONTRACT_SYNC_CHANGES: SyncChange[] = [
  {
    id: 'sc-contract-team-ui',
    kind: 'contract',
    assetId: teamUiSeed.id,
    assetName: teamUiSeed.title,
    path: contractFilePath(teamUiSeed),
    change: 'added',
    direction: 'incoming',
    summary: 'New team instruction: component naming, empty states, and destructive action conventions',
    additions: 16,
    deletions: 0,
    risk: 'none',
    versionLabel: 'v1',
    remoteVersion: 'v1',
    remoteContent: remoteContractFile(teamUiSeed),
  },
  {
    id: 'sc-contract-baseline',
    kind: 'contract',
    assetId: baselineSeed.id,
    assetName: baselineSeed.title,
    path: contractFilePath(baselineSeed),
    change: 'modified',
    direction: 'outgoing',
    summary: 'Added security constraints and testing requirements locally; pending push',
    additions: 8,
    deletions: 2,
    risk: 'none',
    localVersion: 'v2',
    baseVersion: 'v1',
    localContent: serializeContractFile({
      ...baselineSeed,
      versions: [],
      createdAt: daysAgo(12),
      updatedAt: daysAgo(1),
    } as AgentContract),
    baseContent: serializeContractFile(baselineBase),
  },
  {
    id: 'sc-contract-frontend',
    kind: 'contract',
    assetId: frontendSeed.id,
    assetName: frontendSeed.title,
    path: contractFilePath(frontendSeed),
    change: 'modified',
    direction: 'conflict',
    summary: 'The repo added performance constraints; the local copy added accessibility constraints. Both sides edited the same file.',
    additions: 12,
    deletions: 4,
    risk: 'none',
    remoteVersion: 'v2',
    localVersion: 'v2',
    baseVersion: 'v1',
    remoteContent: serializeContractFile(frontendRemoteContract),
    localContent: serializeContractFile({
      ...frontendSeed,
      versions: [],
      createdAt: daysAgo(9),
      updatedAt: daysAgo(2),
    } as AgentContract),
    baseContent: serializeContractFile(frontendBase),
  },
]
