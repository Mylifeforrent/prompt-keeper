import type {
  AgentRuntime,
  Deployment,
  Prompt,
  PromptPlatformItem,
  RepoConfig,
  SyncChange,
  SyncEvent,
} from '../types'
import { promptFilePath, serializePromptFile } from '../lib/promptSync'
import { serializeMcpRepoFile } from '../lib/mcp'
import { SEED_MCPS, SEED_PROMPTS } from './seed'
import { SEED_CONTRACT_SYNC_CHANGES } from './contractSeed'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const hoursAgo = (h: number) => minutesAgo(h * 60)
const daysAgo = (d: number) => minutesAgo(d * 24 * 60)

/* ---------------- Local agent registry ---------------- */

export const AGENT_RUNTIMES: AgentRuntime[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    skillDir: '~/.claude/skills',
    mcpFile: '~/.claude.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    skillDir: '~/.codex/skills',
    mcpFile: '~/.codex/config.toml',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    skillDir: '~/.cursor/skills',
    mcpFile: '~/.cursor/mcp.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    skillDir: '~/.codeium/windsurf/skills',
    mcpFile: '~/.codeium/windsurf/mcp_config.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    skillDir: '~/.config/opencode/skills',
    mcpFile: '~/.config/opencode/opencode.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    skillDir: '',
    mcpFile: '~/Library/Application Support/Claude/claude_desktop_config.json',
    supportsSkills: false,
    supportsMcp: true,
  },
  {
    id: 'cline',
    name: 'Cline',
    skillDir: '~/.cline/skills',
    mcpFile: '~/Library/Application Support/Cline/mcp_settings.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'kiro',
    name: 'Kiro',
    skillDir: '~/.kiro/skills',
    mcpFile: '~/.kiro/settings/mcp.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'qoder',
    name: 'Qoder',
    skillDir: '~/.qoder/skills',
    mcpFile: '~/.qoder/mcp.json',
    supportsSkills: true,
    supportsMcp: true,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    skillDir: '',
    mcpFile: '~/.vscode/mcp.json',
    supportsSkills: false,
    supportsMcp: true,
  },
]

export const SEED_DETECTED_AGENTS = ['claude', 'codex', 'cursor', 'windsurf', 'opencode', 'claude-desktop']

/* ---------------- Repository config ---------------- */

export const SEED_REPO: RepoConfig = {
  connected: true,
  provider: 'github',
  url: 'tony/ai-assets',
  branch: 'main',
  localPath: '~/Library/Application Support/Prompt Keeper/repos/ai-assets',
  auth: 'credential',
  autoFetch: true,
  fetchIntervalMin: 15,
  pushMode: 'branch-pr',
  lastFetchedAt: minutesAgo(12),
  lastSyncedAt: hoursAgo(2),
  ahead: 2,
  behind: 3,
  layout: { skills: 'skills', mcp: 'mcp', prompts: 'prompts', contracts: 'instructions' },
  policies: { skills: true, mcp: true, prompts: true, contracts: true },
}

/* ---------------- Pending changes ---------------- */

const docWriterBase = `# Doc Writer

Turn code changes into documentation updates:

- Infer from public API changes whether the README needs an update
- Add request / response examples for new endpoints
- Generate a migration guide section when a change breaks compatibility
`

const docWriterRemote = `${docWriterBase}
## Migration guide format
1. Change summary (one sentence)
2. List of affected callers
3. Before / after code comparison
4. Rollback procedure
`

const docWriterLocal = `${docWriterBase}
## Output format
- Use H2 headings to separate sections
- Keep each section under 5 lines
- Use TypeScript for all code examples
`

const releaseNotesRemote = `# Release Notes

Collect commits between two tags and generate user-facing release notes.

## When to use
- Prepare a release announcement
- Compile a changelog

## How it works
1. Run scripts/collect.sh <from-tag> <to-tag>
2. Group by feature / fix / breaking
3. Describe the user-facing impact rather than listing commits
4. Always include migration notes for breaking changes

## Notes
- The script only reads git log; it does not modify the repository
- Write the output in English
`

const mcpSeed = (name: string) => {
  const server = SEED_MCPS.find((m) => m.name === name)
  if (!server) throw new Error(`missing mcp seed: ${name}`)
  return server
}

const githubMcpRemote = serializeMcpRepoFile({
  ...mcpSeed('github'),
  args: [...(mcpSeed('github').args ?? []), '--toolsets', 'repos,issues,pull_requests'],
})

const sqliteMcpLocal = serializeMcpRepoFile({
  ...mcpSeed('sqlite-explorer'),
  args: ['mcp-server-sqlite', '--db-path', '${SQLITE_DB_PATH}'],
})

const commitHelperRemote = `# Commit Helper

Generate commit messages that follow the **Conventional Commits** spec.

## Usage
1. Read the output of \`git diff --staged\`
2. Determine the change type: feat / fix / refactor / docs / chore
3. Output a subject line plus bullet points in the body

## Rules
- Keep the subject under 50 characters
- Explain "why" in the body, not "what changed"
- Always append \`!\` for breaking changes, and add a migration note on the last line of the body
- One commit does one thing

\`\`\`bash
git diff --staged | commit-helper
\`\`\`
`

/* ---------------- Prompt sync seeds (.prompt.md) ---------------- */

const promptById = (id: string): Prompt => {
  const prompt = SEED_PROMPTS.find((p) => p.id === id)
  if (!prompt) throw new Error(`missing prompt seed: ${id}`)
  return prompt
}

const promptFile = (prompt: Prompt, patch: Partial<Prompt> = {}) =>
  serializePromptFile({ ...prompt, ...patch })

const apiContractRemote: Prompt = {
  id: 'p-api-contract',
  title: 'API Contract Review',
  description: 'Review an OpenAPI contract for compatibility, error structure, idempotency, and observability',
  systemPrompt:
    'You are the API platform lead. Review the OpenAPI fragment provided by the user: output a list of issues across four areas — compatibility / error structure / idempotency and retries / observability — flag breaking changes, and give actionable fixes. Do not settle for high-level principles.',
  userPrompt: 'Review the following OpenAPI contract:\n\n```yaml\n{{spec}}\n```',
  folder: 'engineering',
  tags: ['API', 'Review'],
  isFavorite: false,
  isPinned: false,
  usageCount: 0,
  variables: [{ name: 'spec', type: 'textarea', required: true, label: 'OpenAPI fragment' }],
  syncPolicy: 'inherit',
  versions: [],
  createdAt: daysAgo(1),
  updatedAt: daysAgo(1),
}

const reviewLocal = promptById('p-review')
const reviewBase: Prompt = {
  ...reviewLocal,
  systemPrompt:
    'You are a senior code review expert. Review the code submitted by the user across four dimensions: correctness, readability, performance, and security. Give a score and concrete improvement suggestions for each dimension.',
  userPrompt: 'Review the following {{language}} code:\n\n```\n{{code}}\n```',
  updatedAt: daysAgo(6),
}

const unitLocal = promptById('p-unit-test')
const unitRemote: Prompt = {
  ...unitLocal,
  systemPrompt:
    'You are a test engineer. Write unit tests for the function provided by the user that cover both the happy path and edge cases. List the test cases first (including at least null values, boundary values, and error branches), then give the complete code. Never cover only the happy path.',
  userPrompt:
    'Language: {{language}}\nTest framework: {{framework}}\nFunction:\n```\n{{code}}\n```\n\nRequirement: list the test cases in a table and note the edge case each one covers.',
  updatedAt: daysAgo(1),
}
const unitBase: Prompt = {
  ...unitLocal,
  systemPrompt:
    'You are a test engineer. Write unit tests for the function provided by the user that cover both the happy path and edge cases. List the test cases first, then give the complete code.',
  userPrompt: 'Language: {{language}}\nTest framework: {{framework}}\nFunction:\n```\n{{code}}\n```',
  updatedAt: daysAgo(9),
}

const weeklyLocal = promptById('p-weekly')
const weeklyRemote: Prompt = {
  ...weeklyLocal,
  systemPrompt:
    'You are a project assistant. Turn the commit history into a weekly report: start with three lines of conclusions, then group items under "Done / In progress / Risks / Decisions needed". For every risk, state the impact and the recommended action. Tone: {{tone}}.',
  userPrompt:
    'This week\'s notes:\n{{commits}}\n\nProduce the weekly report and finish with three priorities for next week.',
  tags: [...weeklyLocal.tags, 'Weekly Report'],
  updatedAt: daysAgo(1),
}
const weeklyBase: Prompt = {
  ...weeklyLocal,
  systemPrompt: 'You are a project assistant. Turn the commit history provided by the user into a weekly report. Tone: {{tone}}.',
  userPrompt: 'This week\'s commit history:\n{{commits}}',
  updatedAt: daysAgo(6),
}

export const SEED_SYNC_CHANGES: SyncChange[] = [
  {
    id: 'sc-release-notes',
    kind: 'skill',
    assetName: 'release-notes',
    path: 'skills/dev-workflow/release/release-notes/SKILL.md',
    change: 'added',
    direction: 'incoming',
    summary: 'New Skill: collect commits between two tags and generate user-facing release notes',
    additions: 86,
    deletions: 0,
    risk: 'scripts',
    versionLabel: 'v1.0.0',
    remoteVersion: 'v1.0.0',
    remoteContent: releaseNotesRemote,
    files: [
      { path: 'SKILL.md', size: '2.1 KB' },
      { path: 'scripts/collect.sh', size: '1.2 KB' },
    ],
  },
  {
    id: 'sc-commit-helper',
    kind: 'skill',
    assetName: 'commit-helper',
    path: 'skills/dev-workflow/git/commit-helper/SKILL.md',
    change: 'modified',
    direction: 'incoming',
    summary: 'Rule update: breaking changes must carry ! and include migration notes',
    additions: 14,
    deletions: 2,
    risk: 'none',
    remoteVersion: 'v1.3.0',
    localVersion: 'v1.2.0',
    baseVersion: 'v1.2.0',
    remoteContent: commitHelperRemote,
  },
  {
    id: 'sc-github-mcp',
    kind: 'mcp',
    assetName: 'github',
    path: 'mcp/development/github/github.json',
    change: 'modified',
    direction: 'incoming',
    summary: 'Added the toolsets argument; credentials still use ${GITHUB_PERSONAL_ACCESS_TOKEN} as a placeholder',
    additions: 5,
    deletions: 1,
    risk: 'none',
    remoteVersion: 'v2',
    localVersion: 'v1',
    baseVersion: 'v1',
    remoteContent: githubMcpRemote,
  },
  {
    id: 'sc-code-reviewer',
    kind: 'skill',
    assetName: 'code-reviewer',
    path: 'skills/dev-workflow/code-quality/code-reviewer/SKILL.md',
    change: 'modified',
    direction: 'outgoing',
    summary: 'Added the "Maintainability" review dimension and a score threshold',
    additions: 18,
    deletions: 4,
    risk: 'none',
    localVersion: 'v2.1.0',
    baseVersion: 'v2.0.1',
  },
  {
    id: 'sc-sqlite-mcp',
    kind: 'mcp',
    assetName: 'sqlite-explorer',
    path: 'mcp/local-tools/data/sqlite-explorer.json',
    change: 'modified',
    direction: 'outgoing',
    summary: 'Database path changed to ${SQLITE_DB_PATH} to avoid committing machine-specific absolute paths',
    additions: 1,
    deletions: 1,
    risk: 'none',
    localVersion: 'v2',
    baseVersion: 'v1',
    localContent: sqliteMcpLocal,
  },
  {
    id: 'sc-amap-mcp',
    kind: 'mcp',
    assetName: 'amap-maps',
    path: 'mcp/external-services/maps/amap-maps.json',
    change: 'modified',
    direction: 'outgoing',
    summary: 'Plaintext AMAP_API_KEY detected; push blocked',
    additions: 2,
    deletions: 1,
    risk: 'secrets',
    blocked: true,
    localVersion: 'v2',
    baseVersion: 'v1',
  },
  {
    id: 'sc-doc-writer',
    kind: 'skill',
    assetName: 'doc-writer',
    path: 'skills/docs/technical-writing/doc-writer/SKILL.md',
    change: 'modified',
    direction: 'conflict',
    summary: 'The repo added a "Migration guide format" section; the local copy changed "Output format". Both sides edited the same file.',
    additions: 22,
    deletions: 9,
    risk: 'none',
    remoteVersion: 'v1.5.0',
    localVersion: 'v1.4.3',
    baseVersion: 'v1.4.2',
    remoteContent: docWriterRemote,
    localContent: docWriterLocal,
    baseContent: docWriterBase,
  },
  {
    id: 'sc-prompt-api-contract',
    kind: 'prompt',
    assetId: apiContractRemote.id,
    assetName: apiContractRemote.title,
    path: promptFilePath(apiContractRemote),
    change: 'added',
    direction: 'incoming',
    summary: 'New team Prompt: review API contracts for compatibility / error structure / idempotency / observability',
    additions: 24,
    deletions: 0,
    risk: 'none',
    versionLabel: 'v1.0.0',
    remoteVersion: 'v1.0.0',
    remoteContent: promptFile(apiContractRemote),
  },
  {
    id: 'sc-prompt-unit-test',
    kind: 'prompt',
    assetId: unitLocal.id,
    assetName: unitLocal.title,
    path: promptFilePath(unitLocal),
    change: 'modified',
    direction: 'incoming',
    summary: 'The repo added an edge case checklist and minimum coverage requirements',
    additions: 9,
    deletions: 2,
    risk: 'none',
    remoteVersion: 'v2',
    localVersion: 'v1',
    baseVersion: 'v1',
    remoteContent: promptFile(unitRemote),
    localContent: promptFile(unitLocal),
    baseContent: promptFile(unitBase),
  },
  {
    id: 'sc-prompt-review',
    kind: 'prompt',
    assetId: reviewLocal.id,
    assetName: reviewLocal.title,
    path: promptFilePath(reviewLocal),
    change: 'modified',
    direction: 'outgoing',
    summary: 'Added the "Focus on" variable locally and required an overall assessment',
    additions: 11,
    deletions: 3,
    risk: 'none',
    localVersion: 'v3',
    baseVersion: 'v2',
    localContent: promptFile(reviewLocal),
    baseContent: promptFile(reviewBase),
  },
  {
    id: 'sc-prompt-api-debug',
    kind: 'prompt',
    assetId: 'p-api-debug',
    assetName: 'Internal API Debug Assistant',
    path: promptFilePath({ id: 'p-api-debug', title: 'Internal API Debug Assistant', folder: 'engineering/debugging' }),
    change: 'added',
    direction: 'outgoing',
    summary: 'Plaintext sk-live token detected in the prompt content; push blocked',
    additions: 18,
    deletions: 0,
    risk: 'secrets',
    blocked: true,
    localVersion: 'v1',
  },
  {
    id: 'sc-prompt-weekly',
    kind: 'prompt',
    assetId: weeklyLocal.id,
    assetName: weeklyLocal.title,
    path: promptFilePath(weeklyLocal),
    change: 'modified',
    direction: 'conflict',
    summary: 'The repo moved to a conclusions-first structure; the local copy added tone and format requirements. Both sides edited the same file.',
    additions: 16,
    deletions: 8,
    risk: 'none',
    remoteVersion: 'v4',
    localVersion: 'v3',
    baseVersion: 'v2',
    remoteContent: promptFile(weeklyRemote),
    localContent: promptFile(weeklyLocal),
    baseContent: promptFile(weeklyBase),
  },
  ...SEED_CONTRACT_SYNC_CHANGES,
]

/* ---------------- Dispatch matrix ---------------- */

const deploy = (
  kind: Deployment['kind'],
  assetId: string,
  assetName: string,
  agentId: string,
  status: Deployment['status'],
  mode: Deployment['mode'],
  deployedVersion: string,
  deployedAt: string,
  note?: string,
): Deployment => ({
  id: `dep-${kind}-${assetId}-${agentId}`,
  kind,
  assetId,
  assetName,
  agentId,
  status,
  mode,
  deployedVersion,
  deployedAt,
  note,
})

export const SEED_DEPLOYMENTS: Deployment[] = [
  deploy('skill', 's-commit-helper', 'commit-helper', 'claude', 'synced', 'symlink', 'v1.2.0', hoursAgo(2)),
  deploy('skill', 's-commit-helper', 'commit-helper', 'cursor', 'stale', 'copy', 'v1.1.0', daysAgo(6), 'Repo v1.3.0 / library v1.2.0; the Agent is still on v1.1.0'),
  deploy('skill', 's-code-reviewer', 'code-reviewer', 'claude', 'synced', 'symlink', 'v2.0.1', daysAgo(3)),
  deploy('skill', 's-test-writer', 'test-writer', 'codex', 'synced', 'copy', 'v1.0.0', daysAgo(5)),
  deploy('skill', 's-doc-writer', 'doc-writer', 'cursor', 'drifted', 'copy', 'v1.4.2', daysAgo(8), 'SKILL.md in the Agent directory was edited by hand and no longer matches the library'),
  deploy('skill', 's-doc-writer', 'doc-writer', 'kiro', 'synced', 'symlink', 'v1.4.2', daysAgo(8)),
  deploy('skill', 's-python-standards', 'python-standards', 'claude', 'synced', 'symlink', 'v1.1.0', daysAgo(16)),
  deploy('skill', 's-python-standards', 'python-standards', 'windsurf', 'synced', 'copy', 'v1.1.0', daysAgo(16)),
  deploy('mcp', 'm-filesystem', 'filesystem', 'claude-desktop', 'synced', 'copy', 'v2', daysAgo(2)),
  deploy('mcp', 'm-filesystem', 'filesystem', 'cursor', 'synced', 'copy', 'v2', daysAgo(2)),
  deploy('mcp', 'm-github', 'github', 'claude-desktop', 'stale', 'copy', 'v1', daysAgo(6), 'The repo template is at v2; re-dispatch after pulling'),
  deploy('mcp', 'm-fetch', 'fetch', 'cursor', 'drifted', 'copy', 'v1', daysAgo(13), 'The headers in the Agent config file were edited by hand'),
  deploy('mcp', 'm-sqlite', 'sqlite-explorer', 'claude', 'synced', 'copy', 'v1', daysAgo(1)),
]

/* ---------------- Sync history ---------------- */

export const SEED_SYNC_EVENTS: SyncEvent[] = [
  {
    id: 'ev-fetch-1',
    at: minutesAgo(12),
    type: 'fetch',
    title: 'Auto-fetch complete · 3 new commits in the repo',
    detail: 'tony/ai-assets · main · not auto-merged, waiting for your confirmation',
    result: 'success',
  },
  {
    id: 'ev-review-1',
    at: hoursAgo(2),
    type: 'review',
    title: 'skill:release-notes needs manual review',
    detail: 'Contains the executable script scripts/collect.sh; not yet written to the local library',
    result: 'warning',
  },
  {
    id: 'ev-pull-1',
    at: hoursAgo(2),
    type: 'pull',
    title: 'Pulled 2 Skill updates · 1 MCP template',
    detail: 'Fast-forwarded to 4c9e21b; no local changes were overwritten',
    result: 'success',
  },
  {
    id: 'ev-prompt-pull-1',
    at: hoursAgo(3),
    type: 'pull',
    title: 'Prompt sync enabled · merged 2 team Prompt templates',
    detail: 'unit-test / api-contract entered the local library; "Error Message Explainer" stays local only',
    result: 'success',
  },
  {
    id: 'ev-prompt-conflict-1',
    at: hoursAgo(25),
    type: 'conflict',
    title: 'prompt:Weekly Report Generator was modified on both sides; conflict created',
    detail: 'Repo v4 / local v3 / base v2; waiting for a manual merge strategy',
    result: 'warning',
  },
  {
    id: 'ev-push-1',
    at: hoursAgo(26),
    type: 'push',
    title: 'Pushed 2 changes · commit 7f3a1c2',
    detail: 'Branch prompt-keeper/sync-1130; PR #24 created',
    result: 'success',
  },
  {
    id: 'ev-conflict-1',
    at: hoursAgo(27),
    type: 'conflict',
    title: 'doc-writer was modified on both sides; conflict created',
    detail: 'Repo v1.5.0 / local v1.4.3 / base v1.4.2',
    result: 'warning',
  },
  {
    id: 'ev-deploy-1',
    at: daysAgo(3),
    type: 'deploy',
    title: 'Dispatched 4 items to Claude Code / Cursor',
    detail: '3 symlinks, 1 copy; 0 failures',
    result: 'success',
  },
  {
    id: 'ev-connect-1',
    at: daysAgo(5),
    type: 'connect',
    title: 'Connected repository tony/ai-assets',
    detail: 'main · system Git credentials · local clone lives in the app data directory',
    result: 'success',
  },
]

/* ---------------- Platform Prompts (discovery; saved locally, then governed by Prompt sync scope) ---------------- */

export const SEED_PLATFORM_PROMPTS: PromptPlatformItem[] = [
  {
    id: 'pf-prd-review',
    title: 'PRD Review',
    description: 'Break a PRD down into goals, boundaries, exception flows, and acceptance criteria, and output actionable review comments.',
    author: 'prompt-keeper',
    category: 'Product',
    tags: ['Product', 'Review'],
    systemPrompt:
      'You are a senior product review expert. Review the PRD provided by the user using four layers — user value → scope boundaries → exception flows → acceptance criteria — pointing out gaps and contradictions and ranking them by severity. Respond in English.',
    userPrompt: 'Review the following PRD:\n\n{{prd}}',
    variables: [
      { name: 'prd', type: 'textarea', required: true, label: 'PRD content' },
    ],
    uses: 18420,
    updatedAt: daysAgo(2),
  },
  {
    id: 'pf-api-error',
    title: 'API Error Codes and Error Structure Design',
    description: 'Design consistent, debuggable error responses for REST APIs that do not leak internal implementation details.',
    author: 'community',
    category: 'Backend',
    tags: ['API', 'Backend'],
    systemPrompt:
      'You are an API design expert. Design an error code system for the business scenario described by the user: layering (client / business / dependency), naming, HTTP status code mapping, response body structure, and retryable flags. Do not leak stack traces or internal implementation details.',
    userPrompt: 'Business scenario: {{scenario}}\nCurrent error handling: {{current}}',
    variables: [
      { name: 'scenario', type: 'text', required: true },
      { name: 'current', type: 'textarea', required: false, label: 'Current error handling (optional)' },
    ],
    uses: 9260,
    updatedAt: daysAgo(5),
  },
  {
    id: 'pf-migration-plan',
    title: 'Technical Migration Plan Generator',
    description: 'Split "migrate from A to B" into a rollback-friendly phased plan, flagging risks and verification checkpoints.',
    author: 'prompt-keeper',
    category: 'Architecture',
    tags: ['Architecture', 'Migration'],
    systemPrompt:
      'You are the engineering lead responsible for delivery. Produce a phased plan for the migration: goals, change scope, data compatibility strategy, rollback approach, verification metrics, and responsible roles for each phase. Prefer dual-write / canary rollout over a one-shot cutover.',
    userPrompt: 'Migration goal: {{goal}}\nCurrent constraints: {{constraints}}',
    variables: [
      { name: 'goal', type: 'textarea', required: true, label: 'Migration goal and scope' },
      { name: 'constraints', type: 'textarea', required: false, label: 'Team / schedule / compatibility constraints' },
    ],
    uses: 7710,
    updatedAt: daysAgo(8),
  },
  {
    id: 'pf-interview',
    title: 'Technical Interview Question Generator',
    description: 'Generate progressively harder interview questions by role and level, with scoring points and follow-up paths.',
    author: 'community',
    category: 'Hiring',
    tags: ['Hiring', 'Interview'],
    systemPrompt:
      'You are a technical interviewer. Generate six progressive questions by role and level: fundamentals → hands-on → design → troubleshooting. For each question, give the evaluation focus, key points for a reference answer, two levels of follow-up questions, and note how well it discriminates between candidates.',
    userPrompt: 'Role: {{role}}\nLevel: {{level}}\nTeam tech stack: {{stack}}',
    variables: [
      { name: 'role', type: 'text', required: true },
      { name: 'level', type: 'select', options: ['Junior', 'Mid-level', 'Senior', 'Expert'], required: true },
      { name: 'stack', type: 'text', required: false },
    ],
    uses: 6130,
    updatedAt: daysAgo(11),
  },
  {
    id: 'pf-competitor',
    title: 'Competitive Analysis Framework',
    description: 'Compare competitors across five dimensions: users, scenarios, capabilities, business model, and moat.',
    author: 'prompt-keeper',
    category: 'Product',
    tags: ['Product', 'Research'],
    systemPrompt:
      'You are a product strategy analyst. Compare the competitors provided by the user across five dimensions — target users / core scenarios / capability matrix / business model / switching costs and moat. Output a table and conclusions that make clear which gaps must be closed and which can be left alone.',
    userPrompt: 'Our product: {{ours}}\nCompetitor list: {{competitors}}',
    variables: [
      { name: 'ours', type: 'textarea', required: true },
      { name: 'competitors', type: 'textarea', required: true },
    ],
    uses: 5480,
    updatedAt: daysAgo(15),
  },
  {
    id: 'pf-weekly',
    title: 'Team Weekly Report Refiner',
    description: 'Turn scattered progress notes into a conclusions-first weekly report that supports decisions.',
    author: 'community',
    category: 'Writing',
    tags: ['Writing', 'Productivity'],
    systemPrompt:
      'You are a team lead. Turn the user\'s scattered notes into a weekly report: start with three lines of conclusions, then group items under "Done / In progress / Risks / Decisions needed". For every risk, state the impact and the recommended action. Do not just list activities.',
    userPrompt: 'This week\'s notes:\n{{notes}}\n\nNext week\'s priorities: {{next}}',
    variables: [
      { name: 'notes', type: 'textarea', required: true },
      { name: 'next', type: 'text', required: false },
    ],
    uses: 12890,
    updatedAt: daysAgo(4),
  },
]
