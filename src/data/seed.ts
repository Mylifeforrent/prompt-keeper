import type {
  McpServer,
  McpStoreItem,
  ModelOption,
  Prompt,
  Skill,
  SkillPlatform,
  McpTarget,
  StoreSkill,
  VersionSnapshot,
} from '../types'

const daysAgo = (d: number, h = 10) => {
  const t = new Date()
  t.setDate(t.getDate() - d)
  t.setHours(h, 24, 0, 0)
  return t.toISOString()
}

function snap(version: number, createdAt: string, data: Record<string, string>, note?: string): VersionSnapshot {
  return { id: `v${version}-${Math.random().toString(36).slice(2, 8)}`, version, note, createdAt, data }
}

/* ---------------- Platform registry ---------------- */

export const SKILL_PLATFORMS: SkillPlatform[] = [
  { id: 'claude', name: 'Claude Code', dir: '~/.claude/skills' },
  { id: 'cursor', name: 'Cursor', dir: '~/.cursor/skills' },
  { id: 'windsurf', name: 'Windsurf', dir: '~/.codeium/windsurf/skills' },
  { id: 'codex', name: 'Codex CLI', dir: '~/.codex/skills' },
  { id: 'cline', name: 'Cline', dir: '~/.cline/skills' },
  { id: 'kiro', name: 'Kiro', dir: '~/.kiro/skills' },
  { id: 'qoder', name: 'Qoder', dir: '~/.qoder/skills' },
  { id: 'opencode', name: 'OpenCode', dir: '~/.config/opencode/skills' },
]

export const MCP_TARGETS: McpTarget[] = [
  { id: 'claude-desktop', name: 'Claude Desktop', file: '~/Library/Application Support/Claude/claude_desktop_config.json', format: 'json' },
  { id: 'claude', name: 'Claude Code', file: '~/.claude.json', format: 'json' },
  { id: 'cursor', name: 'Cursor', file: '~/.cursor/mcp.json', format: 'json' },
  { id: 'vscode', name: 'VS Code', file: '~/.vscode/mcp.json', format: 'json' },
  { id: 'codex', name: 'Codex CLI', file: '~/.codex/config.toml', format: 'toml' },
  { id: 'cline', name: 'Cline', file: '~/Library/Application Support/Cline/mcp_settings.json', format: 'json' },
  { id: 'gemini', name: 'Gemini CLI', file: '~/.gemini/settings.json', format: 'json' },
  { id: 'windsurf', name: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json', format: 'json' },
]

export const AI_MODELS: ModelOption[] = [
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' },
  { id: 'deepseek-v4', name: 'DeepSeek V4' },
]

/* ---------------- Prompt seeds ---------------- */

const reviewV1 = {
  title: 'Code Review Assistant',
  description: 'Review code across four dimensions: correctness, readability, performance, and security',
  systemPrompt: 'You are a senior code review expert. Review the code submitted by the user across four dimensions: correctness, readability, performance, and security. Give a score and concrete improvement suggestions for each dimension, then finish with an overall assessment. Respond in English.',
  userPrompt: 'Review the following {{language}} code:\n\n```\n{{code}}\n```\n\nFocus on: {{focus}}',
}

const PROMPT_SEEDS: Omit<Prompt, 'syncPolicy'>[] = [
  {
    id: 'p-review',
    title: 'Code Review Assistant',
    description: 'Review code across four dimensions: correctness, readability, performance, and security',
    systemPrompt: reviewV1.systemPrompt,
    userPrompt: reviewV1.userPrompt,
    folder: 'engineering/code-quality',
    tags: ['Engineering', 'Code Review'],
    isFavorite: true,
    isPinned: true,
    usageCount: 42,
    variables: [
      { name: 'language', type: 'text', example: 'typescript', required: true },
      { name: 'code', type: 'textarea', required: true, label: 'Code to review' },
      { name: 'focus', type: 'select', options: ['Correctness', 'Performance', 'Security', 'Readability'], required: false },
    ],
    versions: [
      snap(3, daysAgo(1), reviewV1, 'Added the "Focus on" variable'),
      snap(
        2,
        daysAgo(6),
        { ...reviewV1, userPrompt: 'Review the following {{language}} code:\n\n```\n{{code}}\n```' },
        'Expanded the scoring dimension notes',
      ),
      snap(1, daysAgo(20), { ...reviewV1, systemPrompt: 'You are a code review expert. Review the code submitted by the user and give suggestions.' }),
    ],
    createdAt: daysAgo(20),
    updatedAt: daysAgo(1),
  },
  {
    id: 'p-commit',
    title: 'Git Commit Message Generator',
    description: 'Generate commit messages that follow the Conventional Commits spec from a diff',
    systemPrompt: 'You are a Conventional Commits expert. From the diff provided by the user, produce one compliant commit message: a subject line (no more than 50 characters), a blank line, then bullet points in the body. Output only the commit message itself, with no explanation.',
    userPrompt: '{{diff}}',
    folder: 'engineering/git',
    tags: ['Engineering', 'Git'],
    isFavorite: true,
    isPinned: false,
    usageCount: 87,
    variables: [{ name: 'diff', type: 'textarea', required: true, label: 'Git diff content' }],
    versions: [snap(2, daysAgo(3), { title: 'Git Commit Message Generator', description: 'Generate commit messages that follow the Conventional Commits spec from a diff', systemPrompt: 'You are a Conventional Commits expert. From the diff provided by the user, produce one compliant commit message: a subject line (no more than 50 characters), a blank line, then bullet points in the body. Output only the commit message itself, with no explanation.', userPrompt: '{{diff}}' }, 'Disallowed explanatory text in the output'), snap(1, daysAgo(15), { title: 'Git Commit Message Generator', description: 'Generate a commit message from a diff', systemPrompt: 'Write one commit message based on the diff.', userPrompt: '{{diff}}' })],
    createdAt: daysAgo(15),
    updatedAt: daysAgo(3),
  },
  {
    id: 'p-regex',
    title: 'Regular Expression Explainer',
    description: 'Explain a regular expression piece by piece and flag backtracking risks',
    systemPrompt: 'You are a regular expression expert. Explain the regular expression provided by the user piece by piece and summarize each capture group in a table. Finish by calling out potential catastrophic backtracking risks.',
    userPrompt: 'Explain this regular expression: {{regex}}',
    folder: 'engineering/fundamentals',
    tags: ['Engineering'],
    isFavorite: false,
    isPinned: false,
    usageCount: 15,
    variables: [{ name: 'regex', type: 'text', required: true, example: '^\\d{4}-\\d{2}$' }],
    versions: [snap(1, daysAgo(9), { title: 'Regular Expression Explainer', description: 'Explain a regular expression piece by piece and flag backtracking risks', systemPrompt: 'You are a regular expression expert. Explain the regular expression provided by the user piece by piece and summarize each capture group in a table. Finish by calling out potential catastrophic backtracking risks.', userPrompt: 'Explain this regular expression: {{regex}}' })],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(9),
  },
  {
    id: 'p-weekly',
    title: 'Weekly Report Generator',
    description: 'Turn this week\'s commit history into a structured weekly report',
    systemPrompt: 'You are a project assistant. Turn the commit history provided by the user into a weekly report: a two-sentence overview of the week, a bulleted list of highlights grouped by module, and suggested plans for next week. Tone: {{tone}}.',
    userPrompt: 'This week\'s commit history:\n{{commits}}',
    folder: 'writing/reporting',
    tags: ['Productivity', 'Writing'],
    isFavorite: true,
    isPinned: false,
    usageCount: 63,
    variables: [
      { name: 'commits', type: 'textarea', required: true, label: 'This week\'s commit history' },
      { name: 'tone', type: 'select', options: ['Concise', 'Detailed'], required: false },
    ],
    versions: [snap(1, daysAgo(5), { title: 'Weekly Report Generator', description: 'Turn this week\'s commit history into a structured weekly report', systemPrompt: 'You are a project assistant. Turn the commit history provided by the user into a weekly report: a two-sentence overview of the week, a bulleted list of highlights grouped by module, and suggested plans for next week. Tone: {{tone}}.', userPrompt: 'This week\'s commit history:\n{{commits}}' })],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(2),
  },
  {
    id: 'p-doc-en',
    title: 'Technical Documentation Polish',
    description: 'Rewrite rough notes into clear, idiomatic technical documentation',
    systemPrompt: 'You are a technical writing editor. Rewrite the user\'s rough notes into clear, concise, idiomatic technical documentation. Preserve code blocks verbatim and output only the rewritten text.',
    userPrompt: '{{text}}',
    folder: 'writing/docs',
    tags: ['Writing', 'English'],
    isFavorite: false,
    isPinned: false,
    usageCount: 28,
    variables: [{ name: 'text', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(12), { title: 'Technical Documentation Polish', description: 'Rewrite rough notes into clear, idiomatic technical documentation', systemPrompt: 'You are a technical writing editor. Rewrite the user\'s rough notes into clear, concise, idiomatic technical documentation. Preserve code blocks verbatim and output only the rewritten text.', userPrompt: '{{text}}' })],
    createdAt: daysAgo(12),
    updatedAt: daysAgo(4),
  },
  {
    id: 'p-unit-test',
    title: 'Unit Test Generator',
    description: 'Generate unit tests that cover edge cases for a function',
    systemPrompt: 'You are a test engineer. Write unit tests for the function provided by the user that cover both the happy path and edge cases. List the test cases first, then give the complete code.',
    userPrompt: 'Language: {{language}}\nTest framework: {{framework}}\nFunction:\n```\n{{code}}\n```',
    folder: 'engineering/testing',
    tags: ['Engineering', 'Testing'],
    isFavorite: false,
    isPinned: false,
    usageCount: 34,
    variables: [
      { name: 'language', type: 'text', example: 'typescript', required: true },
      { name: 'framework', type: 'select', options: ['Vitest', 'Jest', 'pytest', 'go test'], required: false },
      { name: 'code', type: 'textarea', required: true },
    ],
    versions: [snap(1, daysAgo(7), { title: 'Unit Test Generator', description: 'Generate unit tests that cover edge cases for a function', systemPrompt: 'You are a test engineer. Write unit tests for the function provided by the user that cover both the happy path and edge cases. List the test cases first, then give the complete code.', userPrompt: 'Language: {{language}}\nTest framework: {{framework}}\nFunction:\n```\n{{code}}\n```' })],
    createdAt: daysAgo(7),
    updatedAt: daysAgo(7),
  },
  {
    id: 'p-sql',
    title: 'SQL Optimization Advisor',
    description: 'Analyze execution plan risks and recommend optimizations',
    systemPrompt: 'You are a database optimization expert. Analyze the SQL provided by the user: point out likely execution plan risks, missing indexes, and rewrite options, ranking recommendations from highest to lowest payoff.',
    userPrompt: 'Optimize this SQL (the table schema is in the comments):\n\n{{sql}}',
    folder: 'engineering/database',
    tags: ['Database'],
    isFavorite: false,
    isPinned: false,
    usageCount: 9,
    variables: [{ name: 'sql', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(18), { title: 'SQL Optimization Advisor', description: 'Analyze execution plan risks and recommend optimizations', systemPrompt: 'You are a database optimization expert. Analyze the SQL provided by the user: point out likely execution plan risks, missing indexes, and rewrite options, ranking recommendations from highest to lowest payoff.', userPrompt: 'Optimize this SQL (the table schema is in the comments):\n\n{{sql}}' })],
    createdAt: daysAgo(18),
    updatedAt: daysAgo(18),
  },
  {
    id: 'p-error',
    title: 'Error Message Explainer',
    description: 'Explain error messages and provide troubleshooting steps',
    systemPrompt: 'You are a debugging assistant. Explain the error message provided by the user, identify the most likely cause, and give 2-3 troubleshooting steps ordered by likelihood.',
    userPrompt: '{{error}}',
    folder: null,
    tags: ['Productivity'],
    isFavorite: false,
    isPinned: false,
    usageCount: 51,
    variables: [{ name: 'error', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(25), { title: 'Error Message Explainer', description: 'Explain error messages and provide troubleshooting steps', systemPrompt: 'You are a debugging assistant. Explain the error message provided by the user, identify the most likely cause, and give 2-3 troubleshooting steps ordered by likelihood.', userPrompt: '{{error}}' })],
    createdAt: daysAgo(25),
    updatedAt: daysAgo(11),
  },
  {
    id: 'p-api-debug',
    title: 'Internal API Debug Assistant',
    description: 'Generate integration requests, error code troubleshooting steps, and fixes from an API definition',
    systemPrompt: 'You are a backend integration assistant. Based on the API definition, provide curl requests that can be run directly, troubleshooting steps for common error codes, and suggested fixes.',
    userPrompt: 'Endpoint: {{endpoint}}\nTest token: sk-live-8f3a2c9d4e5b6a71\nGenerate an integration request and reuse this token in the example.',
    folder: 'engineering/debugging',
    tags: ['API', 'Debugging'],
    isFavorite: false,
    isPinned: false,
    usageCount: 6,
    variables: [{ name: 'endpoint', type: 'text', required: true, example: 'GET /v1/orders' }],
    versions: [snap(1, daysAgo(2), { title: 'Internal API Debug Assistant', description: 'Generate integration requests, error code troubleshooting steps, and fixes from an API definition', systemPrompt: 'You are a backend integration assistant. Based on the API definition, provide curl requests that can be run directly, troubleshooting steps for common error codes, and suggested fixes.', userPrompt: 'Endpoint: {{endpoint}}\nTest token: sk-live-8f3a2c9d4e5b6a71\nGenerate an integration request and reuse this token in the example.' })],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  },
]

export const SEED_PROMPTS: Prompt[] = PROMPT_SEEDS.map((p) => ({
  ...p,
  // Demo: personal troubleshooting notes stay local by default; everything else follows repo policy (v0.3 enables Prompt sync by default)
  syncPolicy: p.id === 'p-error' ? 'local' : 'inherit',
  inRepo: p.id !== 'p-error' && p.id !== 'p-api-debug',
}))

const commitHelperMd = `# Commit Helper

Generate commit messages that follow the **Conventional Commits** spec.

## Usage
1. Read the output of \`git diff --staged\`
2. Determine the change type: feat / fix / refactor / docs / chore
3. Output a subject line plus bullet points in the body

## Rules
- Keep the subject under 50 characters
- Explain "why" in the body, not "what changed"
- Always append \`!\` for breaking changes

\`\`\`bash
git diff --staged | commit-helper
\`\`\`
`

const codeReviewerMd = `# Code Reviewer

Review the changes on the current branch across four dimensions:

- **Correctness**: logic errors, edge cases
- **Readability**: naming, function length, comment density
- **Performance**: cyclomatic complexity, N+1 queries
- **Security**: injection, unauthorized access, sensitive data leaks

## Output format
Give a score (0-10) and supporting line numbers for each dimension, then finish with an overall assessment and a merge recommendation.
`

const testWriterMd = `# Test Writer

Generate unit tests for a given function:

1. Analyze the function signature and branches
2. List the case matrix (happy path / edge / error)
3. Generate runnable test code
4. Add more cases when coverage is below 80%

Supports Vitest, Jest, pytest, and go test.
`

const docWriterMd = `# Doc Writer

Turn code changes into documentation updates:

- Infer from public API changes whether the README needs an update
- Add request / response examples for new endpoints
- Generate a migration guide section when a change breaks compatibility
`

const frontendDesignMd = `# Frontend Design

Review design consistency in the frontend implementation:

- Do spacing / radius / shadow follow the design tokens?
- Are interaction states complete (hover / focus / disabled / loading / empty)?
- Dark mode contrast check
`

const pythonStandardsMd = `# Python Standards

 enforce the team Python standards:

- Use \`uv\` to manage dependencies; never hand-write requirements.txt
- Full type annotations; public APIs must have docstrings
- Catch only recoverable exceptions; never use a bare except
`

export const SEED_SKILLS: Skill[] = [
  {
    id: 's-commit-helper',
    name: 'commit-helper',
    emoji: '📝',
    description: 'Generate commit messages that follow the Conventional Commits spec, automatically distinguishing feat / fix / chore.',
    author: 'anthropic',
    version: '1.2.0',
    source: 'official',
    category: 'Dev Workflow',
    folder: 'dev-workflow/git',
    tags: ['git', 'Standards'],
    instructions: commitHelperMd,
    installs: { claude: 'symlink', cursor: 'copy' },
    versions: [snap(2, daysAgo(3), { instructions: commitHelperMd }, 'Added the breaking change rule'), snap(1, daysAgo(14), { instructions: '# Commit Helper\n\nGenerate commit messages that follow the Conventional Commits spec.\n' })],
    installedAt: daysAgo(14),
  },
  {
    id: 's-code-reviewer',
    name: 'code-reviewer',
    emoji: '🔍',
    description: 'Review and score branch changes across correctness, readability, performance, and security.',
    author: 'anthropic',
    version: '2.0.1',
    source: 'official',
    category: 'Code Quality',
    folder: 'dev-workflow/code-quality',
    tags: ['Review'],
    instructions: codeReviewerMd,
    installs: { claude: 'symlink' },
    versions: [snap(1, daysAgo(8), { instructions: codeReviewerMd })],
    installedAt: daysAgo(8),
  },
  {
    id: 's-test-writer',
    name: 'test-writer',
    emoji: '🧪',
    description: 'Generate unit tests that cover edge cases, with support for four major frameworks.',
    author: 'community',
    version: '1.0.0',
    source: 'community',
    category: 'Testing',
    folder: 'dev-workflow/testing',
    tags: ['Testing'],
    instructions: testWriterMd,
    installs: { codex: 'copy' },
    versions: [snap(1, daysAgo(6), { instructions: testWriterMd })],
    installedAt: daysAgo(6),
  },
  {
    id: 's-doc-writer',
    name: 'doc-writer',
    emoji: '📄',
    description: 'Infer documentation updates from code changes and generate migration guides.',
    author: 'anthropic',
    version: '1.4.2',
    source: 'official',
    category: 'Documentation',
    folder: 'docs/technical-writing',
    tags: ['Documentation'],
    instructions: docWriterMd,
    installs: { cursor: 'copy', kiro: 'symlink' },
    versions: [snap(1, daysAgo(10), { instructions: docWriterMd })],
    installedAt: daysAgo(10),
  },
  {
    id: 's-frontend-design',
    name: 'frontend-design',
    emoji: '🎨',
    description: 'Review frontend implementations for design token consistency and complete interaction states.',
    author: 'community',
    version: '0.9.0',
    source: 'community',
    category: 'Design',
    folder: 'design/frontend',
    tags: ['Frontend', 'Design'],
    instructions: frontendDesignMd,
    installs: {},
    versions: [snap(1, daysAgo(2), { instructions: frontendDesignMd })],
    installedAt: daysAgo(2),
  },
  {
    id: 's-python-standards',
    name: 'python-standards',
    emoji: '🐍',
    description: 'Team Python standards: uv dependency management, type annotations, and exception handling conventions.',
    author: 'local',
    version: '1.1.0',
    source: 'import',
    category: 'Language Standards',
    folder: 'language-standards/python',
    tags: ['Python'],
    instructions: pythonStandardsMd,
    installs: { windsurf: 'copy', claude: 'external' },
    versions: [snap(1, daysAgo(16), { instructions: pythonStandardsMd })],
    installedAt: daysAgo(16),
  },
]

/* ---------------- Skill Store ---------------- */

const storeMd = (name: string, what: string, usage: string[]) =>
  `# ${name}\n\n${what}\n\n## When to use\n${usage.map((u) => `- ${u}`).join('\n')}\n\n## How it works\n1. Understand the user's goal\n2. Follow best practices\n3. Deliver the result and explain the rationale\n`

export const SEED_STORE_SKILLS: StoreSkill[] = [
  {
    id: 'ss-spreadsheet',
    name: 'spreadsheet-editor',
    emoji: '📊',
    description: 'Create, edit, and analyze spreadsheets, with formula evaluation and chart generation.',
    author: 'anthropic',
    version: '1.3.0',
    category: 'Office',
    downloads: 128400,
    source: 'official',
    instructions: storeMd('Spreadsheet Editor', 'Read and write xlsx / csv, with formulas, pivot tables, and charts.', ['Bulk data cleanup', 'Generate reports from spreadsheets']),
    files: [{ path: 'SKILL.md', size: '3.2 KB' }, { path: 'scripts/formulas.py', size: '1.8 KB' }],
  },
  {
    id: 'ss-pdf',
    name: 'pdf-processor',
    emoji: '📕',
    description: 'Split, merge, extract text from, and fill PDF forms.',
    author: 'anthropic',
    version: '2.1.0',
    category: 'Office',
    downloads: 96200,
    source: 'official',
    instructions: storeMd('PDF Processor', 'Perform common PDF operations while preserving layout.', ['Extract key contract clauses', 'Merge scanned documents']),
    files: [{ path: 'SKILL.md', size: '2.7 KB' }, { path: 'scripts/merge.py', size: '1.1 KB' }],
  },
  {
    id: 'ss-skill-creator',
    name: 'skill-creator',
    emoji: '✨',
    description: 'Guide you through writing a well-structured, spec-compliant SKILL.md from scratch.',
    author: 'anthropic',
    version: '1.0.4',
    category: 'Meta Skills',
    downloads: 154000,
    source: 'official',
    instructions: storeMd('Skill Creator', 'Generate a SKILL.md per the official spec: frontmatter, instruction body, reference files.', ['Turn repeated workflows into Skills', 'Convert existing prompts into Skills']),
    files: [{ path: 'SKILL.md', size: '4.6 KB' }, { path: 'references/spec.md', size: '6.0 KB' }],
  },
  {
    id: 'ss-web-researcher',
    name: 'web-researcher',
    emoji: '🌐',
    description: 'Search the web, cross-check findings, and produce a research summary with sources.',
    author: 'community',
    version: '0.8.2',
    category: 'Research',
    downloads: 43100,
    source: 'community',
    instructions: storeMd('Web Researcher', 'Multi-round search with source verification; outputs a structured research report.', ['Technology selection comparisons', 'Competitor feature inventories']),
    files: [{ path: 'SKILL.md', size: '2.2 KB' }],
  },
  {
    id: 'ss-sqlite',
    name: 'sqlite-analyst',
    emoji: '🗄️',
    description: 'Analyze SQLite schemas, review slow queries, and recommend indexes.',
    author: 'community',
    version: '1.1.0',
    category: 'Data',
    downloads: 28700,
    source: 'community',
    instructions: storeMd('SQLite Analyst', 'Inspect schemas, EXPLAIN query plans, and recommend indexes.', ['Find slow queries', 'Review table design']),
    files: [{ path: 'SKILL.md', size: '2.9 KB' }, { path: 'scripts/analyze.sql', size: '0.9 KB' }],
  },
  {
    id: 'ss-api-designer',
    name: 'api-designer',
    emoji: '🧭',
    description: 'Review API design against REST and OpenAPI conventions, with refactoring suggestions.',
    author: 'community',
    version: '2.0.0',
    category: 'Architecture',
    downloads: 35900,
    source: 'community',
    instructions: storeMd('API Designer', 'Review resource modeling, status codes, pagination, and error structure.', ['Review a new service API', 'Audit OpenAPI documentation']),
    files: [{ path: 'SKILL.md', size: '3.5 KB' }],
  },
  {
    id: 'ss-release-notes',
    name: 'git-release-notes',
    emoji: '🏷️',
    description: 'Collect commits between two tags and generate user-facing release notes.',
    author: 'anthropic',
    version: '1.2.1',
    category: 'Dev Workflow',
    downloads: 58300,
    source: 'official',
    instructions: storeMd('Release Notes', 'Group commits by feature / fix / breaking.', ['Prepare a release announcement', 'Compile a changelog']),
    files: [{ path: 'SKILL.md', size: '1.9 KB' }],
  },
  {
    id: 'ss-ppt-writer',
    name: 'ppt-writer',
    emoji: '🖼️',
    description: 'Expand a topic into a slide outline, per-slide speaker notes, and visual suggestions.',
    author: 'community',
    version: '0.5.0',
    category: 'Office',
    downloads: 19400,
    source: 'community',
    instructions: storeMd('PPT Writer', 'Generate an outline and per-slide speaker notes, with visual and chart suggestions.', ['Project updates', 'Technical talks']),
    files: [{ path: 'SKILL.md', size: '2.4 KB' }],
  },
]

/* ---------------- MCP seeds ---------------- */

export const SEED_MCPS: McpServer[] = [
  {
    id: 'm-filesystem',
    name: 'filesystem',
    description: 'Read and write the local filesystem: list directories, read files, controlled writes.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/macbookair/Projects'],
    env: {},
    enabled: true,
    isFavorite: true,
    folder: 'local-tools/files',
    tags: ['Files'],
    source: 'manual',
    installs: { 'claude-desktop': true, cursor: true },
    notes: '',
    versions: [
      snap(2, daysAgo(2), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/macbookair/Projects'], env: {} }, null, 2) }, 'Changed the root directory to Projects'),
      snap(1, daysAgo(9), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: {} }, null, 2) }),
    ],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
  {
    id: 'm-github',
    name: 'github',
    description: 'Query and operate on GitHub repositories / issues / PRs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_SixteenCharsExample0000' },
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    enabled: true,
    isFavorite: true,
    folder: 'development/github',
    tags: ['Development'],
    source: 'market',
    installs: { 'claude-desktop': true },
    notes: 'Token is rotated every six months.',
    versions: [snap(1, daysAgo(6), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '***' } }, null, 2) })],
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
  },
  {
    id: 'm-amap',
    name: 'amap-maps',
    description: 'Amap (Gaode Maps): geocoding, POI search, and route planning.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-amap'],
    env: { AMAP_API_KEY: '' },
    requiredEnv: ['AMAP_API_KEY'],
    enabled: true,
    isFavorite: false,
    folder: 'external-services/maps',
    tags: ['Maps'],
    source: 'market',
    installs: {},
    notes: '',
    versions: [snap(1, daysAgo(4), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-amap'], env: { AMAP_API_KEY: '' } }, null, 2) })],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
  },
  {
    id: 'm-fetch',
    name: 'fetch',
    description: 'Fetch web pages and convert them to Markdown so the model can read web content.',
    transport: 'http',
    url: 'https://mcp.fetch-service.dev/sse',
    headers: { Authorization: 'Bearer fk_live_9f8e7d6c5b4a' },
    enabled: false,
    isFavorite: false,
    folder: 'external-services/web',
    tags: ['Web'],
    source: 'import',
    installs: { cursor: true },
    notes: '',
    versions: [snap(1, daysAgo(13), { config: JSON.stringify({ transport: 'http', url: 'https://mcp.fetch-service.dev/sse', headers: { Authorization: '***' } }, null, 2) })],
    createdAt: daysAgo(13),
    updatedAt: daysAgo(13),
  },
  {
    id: 'm-sqlite',
    name: 'sqlite-explorer',
    description: 'Run read-only queries against SQLite databases and explain execution plans.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data/app.db'],
    env: {},
    enabled: true,
    isFavorite: false,
    folder: 'local-tools/data',
    tags: ['Data'],
    source: 'manual',
    installs: { claude: true },
    notes: '',
    versions: [snap(1, daysAgo(1), { config: JSON.stringify({ transport: 'stdio', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', './data/app.db'], env: {} }, null, 2) })],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  {
    id: 'm-slack',
    name: 'slack',
    description: 'Send and receive Slack channel messages and search message history.',
    transport: 'stdio',
    command: '',
    args: [],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: 'T024K92XP' },
    requiredEnv: ['SLACK_BOT_TOKEN'],
    enabled: false,
    isFavorite: false,
    folder: 'external-services/office',
    tags: ['Office'],
    source: 'manual',
    installs: {},
    notes: 'Enabled once a Bot Token is issued.',
    versions: [snap(1, daysAgo(8), { config: JSON.stringify({ transport: 'stdio', command: '', env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: 'T024K92XP' } }, null, 2) })],
    createdAt: daysAgo(8),
    updatedAt: daysAgo(8),
  },
]

/* ---------------- MCP Store ---------------- */

export const SEED_MCP_STORE: McpStoreItem[] = [
  {
    id: 'ms-notion',
    name: 'notion',
    description: 'Connect to a Notion workspace to search and read/write pages and databases.',
    whatItDoes: 'Access shared pages as an integration: full-text search, page creation, block appends, and database view queries.',
    useCases: ['Write meeting notes to Notion', 'Search project material across databases'],
    installCommand: 'npx -y @mcp/notion',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/notion'],
    envDocs: [
      { key: 'NOTION_API_KEY', desc: 'Create an Internal Integration Token under Notion "Integrations"', placeholder: 'ntn_xxxxxxxx' },
    ],
  },
  {
    id: 'ms-postgres',
    name: 'postgres',
    description: 'Connect to PostgreSQL for read-only queries and schema browsing.',
    whatItDoes: 'List table schemas, run read-only SQL, and explain query plans; writes are disabled by default.',
    useCases: ['Let AI query business data', 'Review slow queries'],
    installCommand: 'npx -y @mcp/postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/postgres'],
    envDocs: [
      { key: 'DATABASE_URL', desc: 'PostgreSQL connection string; a read-only account is recommended', placeholder: 'postgres://user:pass@host:5432/db' },
    ],
  },
  {
    id: 'ms-brave-search',
    name: 'brave-search',
    description: 'Brave Search API wrapper for web and news search.',
    whatItDoes: 'Run web / news / image searches and return titles, snippets, and links.',
    useCases: ['Real-time information lookup', 'Track competitor updates'],
    installCommand: 'npx -y @mcp/brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/brave-search'],
    envDocs: [
      { key: 'BRAVE_API_KEY', desc: 'Apply for the Free plan at brave.com/search/api', placeholder: 'BSAxxxxxxxx' },
    ],
  },
  {
    id: 'ms-firecrawl',
    name: 'firecrawl',
    description: 'Crawl any web page into clean Markdown / structured data.',
    whatItDoes: 'Single-page scraping, whole-site crawling, and JS rendering, automatically converted to Markdown.',
    useCases: ['Scrape documentation sites', 'Prepare corpora for RAG'],
    installCommand: 'npx -y @mcp/firecrawl',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/firecrawl'],
    envDocs: [
      { key: 'FIRECRAWL_API_KEY', desc: 'Get it from the firecrawl.dev console', placeholder: 'fc-xxxxxxxx' },
    ],
  },
  {
    id: 'ms-memory',
    name: 'memory',
    description: 'Local knowledge graph memory: remember entities and relationships across sessions.',
    whatItDoes: 'Write entities and relationships from the conversation into a local knowledge graph file and recall them in later sessions.',
    useCases: ['Remember project context', 'Long-term preference memory'],
    installCommand: 'npx -y @mcp/memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/memory'],
    envDocs: [],
  },
  {
    id: 'ms-puppeteer',
    name: 'puppeteer',
    description: 'Browser automation: navigate, click, take screenshots, and run scripts.',
    whatItDoes: 'Drive headless Chromium to perform page actions and return screenshots.',
    useCases: ['End-to-end smoke verification', 'Auto-fill forms'],
    installCommand: 'npx -y @mcp/puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/puppeteer'],
    envDocs: [],
  },
]

/* ---------------- Agent MCP external entries (reverse-import demo) ---------------- */

export const AGENT_EXTERNAL_ENTRIES: Record<string, { name: string; hint: string }[]> = {
  cursor: [{ name: 'figma-developer-mcp', hint: 'Installed externally · reads design file data' }],
  'claude-desktop': [{ name: 'notion-api', hint: 'Installed externally · not in My Library' }],
  cline: [{ name: 'time-server', hint: 'Installed externally · local time lookup' }],
}
