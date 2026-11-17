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

/* ---------------- 平台清单 ---------------- */

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

export const FOLDERS = ['默认', '编程', '写作']

/* ---------------- Prompt 种子 ---------------- */

const reviewV1 = {
  title: '代码审查助手',
  description: '按正确性 / 可读性 / 性能 / 安全四个维度审查代码',
  systemPrompt: '你是一位资深代码审查专家。请从正确性、可读性、性能、安全四个维度审查用户提交的代码，每个维度给出评分与具体改进建议，最后给出总评。使用简体中文回答。',
  userPrompt: '请审查以下 {{language}} 代码：\n\n```\n{{code}}\n```\n\n重点关注：{{focus}}',
}

export const SEED_PROMPTS: Prompt[] = [
  {
    id: 'p-review',
    title: '代码审查助手',
    description: '按正确性 / 可读性 / 性能 / 安全四个维度审查代码',
    systemPrompt: reviewV1.systemPrompt,
    userPrompt: reviewV1.userPrompt,
    folder: '编程',
    tags: ['编程', '代码审查'],
    isFavorite: true,
    isPinned: true,
    usageCount: 42,
    variables: [
      { name: 'language', type: 'text', example: 'typescript', required: true },
      { name: 'code', type: 'textarea', required: true, label: '待审查代码' },
      { name: 'focus', type: 'select', options: ['正确性', '性能', '安全', '可读性'], required: false },
    ],
    versions: [
      snap(3, daysAgo(1), reviewV1, '加入「重点关注」变量'),
      snap(
        2,
        daysAgo(6),
        { ...reviewV1, userPrompt: '请审查以下 {{language}} 代码：\n\n```\n{{code}}\n```' },
        '补充评分维度说明',
      ),
      snap(1, daysAgo(20), { ...reviewV1, systemPrompt: '你是一位代码审查专家，请审查用户提交的代码并给出建议。' }),
    ],
    createdAt: daysAgo(20),
    updatedAt: daysAgo(1),
  },
  {
    id: 'p-commit',
    title: 'Git 提交信息生成',
    description: '依据 diff 产出 Conventional Commits 规范的提交信息',
    systemPrompt: '你是 Conventional Commits 专家。根据用户提供的 diff 产出一条符合规范的提交信息：一行主题（不超过 50 字符），空一行后跟正文要点。只输出提交信息本身，不要任何解释。',
    userPrompt: '{{diff}}',
    folder: '编程',
    tags: ['编程', 'Git'],
    isFavorite: true,
    isPinned: false,
    usageCount: 87,
    variables: [{ name: 'diff', type: 'textarea', required: true, label: 'Git Diff 内容' }],
    versions: [snap(2, daysAgo(3), { title: 'Git 提交信息生成', description: '依据 diff 产出 Conventional Commits 规范的提交信息', systemPrompt: '你是 Conventional Commits 专家。根据用户提供的 diff 产出一条符合规范的提交信息：一行主题（不超过 50 字符），空一行后跟正文要点。只输出提交信息本身，不要任何解释。', userPrompt: '{{diff}}' }, '禁止输出解释文字'), snap(1, daysAgo(15), { title: 'Git 提交信息生成', description: '依据 diff 产出提交信息', systemPrompt: '根据 diff 写一条提交信息。', userPrompt: '{{diff}}' })],
    createdAt: daysAgo(15),
    updatedAt: daysAgo(3),
  },
  {
    id: 'p-regex',
    title: '正则表达式解释器',
    description: '逐段解释正则含义，指出回溯风险',
    systemPrompt: '你是正则表达式专家。请逐段解释用户给出的正则表达式，并用表格总结每个捕获组；最后指出潜在的灾难性回溯风险。',
    userPrompt: '请解释这个正则表达式：{{regex}}',
    folder: '编程',
    tags: ['编程'],
    isFavorite: false,
    isPinned: false,
    usageCount: 15,
    variables: [{ name: 'regex', type: 'text', required: true, example: '^\\d{4}-\\d{2}$' }],
    versions: [snap(1, daysAgo(9), { title: '正则表达式解释器', description: '逐段解释正则含义，指出回溯风险', systemPrompt: '你是正则表达式专家。请逐段解释用户给出的正则表达式，并用表格总结每个捕获组；最后指出潜在的灾难性回溯风险。', userPrompt: '请解释这个正则表达式：{{regex}}' })],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(9),
  },
  {
    id: 'p-weekly',
    title: '周报生成器',
    description: '把本周提交记录整理成一份结构化周报',
    systemPrompt: '你是项目助理。把用户提供的提交记录整理为周报：本周概览（2 句）、按模块分类的要点列表、下周计划建议。语气：{{tone}}。',
    userPrompt: '本周提交记录：\n{{commits}}',
    folder: '写作',
    tags: ['效率', '写作'],
    isFavorite: true,
    isPinned: false,
    usageCount: 63,
    variables: [
      { name: 'commits', type: 'textarea', required: true, label: '本周提交记录' },
      { name: 'tone', type: 'select', options: ['简洁', '详尽'], required: false },
    ],
    versions: [snap(1, daysAgo(5), { title: '周报生成器', description: '把本周提交记录整理成一份结构化周报', systemPrompt: '你是项目助理。把用户提供的提交记录整理为周报：本周概览（2 句）、按模块分类的要点列表、下周计划建议。语气：{{tone}}。', userPrompt: '本周提交记录：\n{{commits}}' })],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(2),
  },
  {
    id: 'p-doc-en',
    title: '技术文档英文润色',
    description: '把中文说明改写为地道的英文技术文档段落',
    systemPrompt: '你是技术写作编辑。把用户的中文说明改写为地道、简洁的英文技术文档段落，保留代码块原样，输出仅含英文改写结果。',
    userPrompt: '{{text}}',
    folder: '写作',
    tags: ['写作', '英文'],
    isFavorite: false,
    isPinned: false,
    usageCount: 28,
    variables: [{ name: 'text', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(12), { title: '技术文档英文润色', description: '把中文说明改写为地道的英文技术文档段落', systemPrompt: '你是技术写作编辑。把用户的中文说明改写为地道、简洁的英文技术文档段落，保留代码块原样，输出仅含英文改写结果。', userPrompt: '{{text}}' })],
    createdAt: daysAgo(12),
    updatedAt: daysAgo(4),
  },
  {
    id: 'p-unit-test',
    title: '单元测试生成',
    description: '为函数生成覆盖边界条件的单元测试',
    systemPrompt: '你是测试工程师。为用户提供的函数编写覆盖正常路径与边界条件的单元测试，先列出用例清单再给完整代码。',
    userPrompt: '语言：{{language}}\n测试框架：{{framework}}\n函数：\n```\n{{code}}\n```',
    folder: '编程',
    tags: ['编程', '测试'],
    isFavorite: false,
    isPinned: false,
    usageCount: 34,
    variables: [
      { name: 'language', type: 'text', example: 'typescript', required: true },
      { name: 'framework', type: 'select', options: ['Vitest', 'Jest', 'pytest', 'go test'], required: false },
      { name: 'code', type: 'textarea', required: true },
    ],
    versions: [snap(1, daysAgo(7), { title: '单元测试生成', description: '为函数生成覆盖边界条件的单元测试', systemPrompt: '你是测试工程师。为用户提供的函数编写覆盖正常路径与边界条件的单元测试，先列出用例清单再给完整代码。', userPrompt: '语言：{{language}}\n测试框架：{{framework}}\n函数：\n```\n{{code}}\n```' })],
    createdAt: daysAgo(7),
    updatedAt: daysAgo(7),
  },
  {
    id: 'p-sql',
    title: 'SQL 优化顾问',
    description: '分析执行计划风险并给出优化建议',
    systemPrompt: '你是数据库优化专家。分析用户给出的 SQL：指出可能的执行计划风险、缺失索引与改写方案，按收益从高到低排列建议。',
    userPrompt: '请优化这条 SQL（表结构见注释）：\n\n{{sql}}',
    folder: '编程',
    tags: ['数据库'],
    isFavorite: false,
    isPinned: false,
    usageCount: 9,
    variables: [{ name: 'sql', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(18), { title: 'SQL 优化顾问', description: '分析执行计划风险并给出优化建议', systemPrompt: '你是数据库优化专家。分析用户给出的 SQL：指出可能的执行计划风险、缺失索引与改写方案，按收益从高到低排列建议。', userPrompt: '请优化这条 SQL（表结构见注释）：\n\n{{sql}}' })],
    createdAt: daysAgo(18),
    updatedAt: daysAgo(18),
  },
  {
    id: 'p-error',
    title: '报错信息翻译',
    description: '翻译英文报错并给出排查步骤',
    systemPrompt: '你是调试助手。把用户的英文报错翻译成中文，解释最可能的原因，并给出 2-3 个排查步骤，按可能性排序。',
    userPrompt: '{{error}}',
    folder: '默认',
    tags: ['效率'],
    isFavorite: false,
    isPinned: false,
    usageCount: 51,
    variables: [{ name: 'error', type: 'textarea', required: true }],
    versions: [snap(1, daysAgo(25), { title: '报错信息翻译', description: '翻译英文报错并给出排查步骤', systemPrompt: '你是调试助手。把用户的英文报错翻译成中文，解释最可能的原因，并给出 2-3 个排查步骤，按可能性排序。', userPrompt: '{{error}}' })],
    createdAt: daysAgo(25),
    updatedAt: daysAgo(11),
  },
]

/* ---------------- Skill 种子 ---------------- */

const commitHelperMd = `# Commit Helper

依据 **Conventional Commits** 规范生成提交信息。

## 使用方式
1. 读取 \`git diff --staged\` 输出
2. 判断变更类型：feat / fix / refactor / docs / chore
3. 输出一行主题 + 正文要点

## 规则
- 主题不超过 50 字符
- 正文说明「为什么」而不是「改了什么」
- 涉及破坏性变更时必须带 \`!\`

\`\`\`bash
git diff --staged | commit-helper
\`\`\`
`

const codeReviewerMd = `# Code Reviewer

按四个维度审查当前分支的改动：

- **正确性**：逻辑错误、边界条件
- **可读性**：命名、函数长度、注释密度
- **性能**：循环复杂度、N+1 查询
- **安全**：注入、越权、敏感信息泄漏

## 输出格式
每个维度给出评分（0-10）与证据行号，最后输出总评与合并建议。
`

const testWriterMd = `# Test Writer

为指定函数生成单元测试：

1. 分析函数签名与分支
2. 列出用例矩阵（正常 / 边界 / 异常）
3. 生成可运行测试代码
4. 覆盖率不足 80% 时补充用例

支持 Vitest、Jest、pytest、go test。
`

const docWriterMd = `# Doc Writer

把代码变更转化为文档更新：

- 从公开 API 变更推断 README 是否需要更新
- 为新端点补充请求 / 响应示例
- 变更破坏兼容性时生成迁移指南段落
`

const frontendDesignMd = `# Frontend Design

审查前端实现的设计一致性：

- 间距 / 圆角 / 阴影是否符合设计 token
- 交互状态是否完整（hover / focus / disabled / loading / empty）
- 暗色模式对比度检查
`

const pythonStandardsMd = `# Python Standards

 enforce 团队 Python 规范：

- 使用 \`uv\` 管理依赖，禁止手写 requirements.txt
- 类型注解全覆盖，公共 API 必须有 docstring
- 错误只捕获可恢复异常，禁止裸 except
`

export const SEED_SKILLS: Skill[] = [
  {
    id: 's-commit-helper',
    name: 'commit-helper',
    emoji: '📝',
    description: '依据 Conventional Commits 生成规范提交信息，自动区分 feat / fix / chore。',
    author: 'anthropic',
    version: '1.2.0',
    source: 'official',
    category: '开发流程',
    tags: ['git', '规范'],
    instructions: commitHelperMd,
    installs: { claude: 'symlink', cursor: 'copy' },
    versions: [snap(2, daysAgo(3), { instructions: commitHelperMd }, '补充破坏性变更规则'), snap(1, daysAgo(14), { instructions: '# Commit Helper\n\n生成 Conventional Commits 提交信息。\n' })],
    installedAt: daysAgo(14),
  },
  {
    id: 's-code-reviewer',
    name: 'code-reviewer',
    emoji: '🔍',
    description: '按正确性 / 可读性 / 性能 / 安全四维审查分支改动并评分。',
    author: 'anthropic',
    version: '2.0.1',
    source: 'official',
    category: '代码质量',
    tags: ['审查'],
    instructions: codeReviewerMd,
    installs: { claude: 'symlink' },
    versions: [snap(1, daysAgo(8), { instructions: codeReviewerMd })],
    installedAt: daysAgo(8),
  },
  {
    id: 's-test-writer',
    name: 'test-writer',
    emoji: '🧪',
    description: '生成覆盖边界条件的单元测试，支持四大主流框架。',
    author: 'community',
    version: '1.0.0',
    source: 'community',
    category: '测试',
    tags: ['测试'],
    instructions: testWriterMd,
    installs: { codex: 'copy' },
    versions: [snap(1, daysAgo(6), { instructions: testWriterMd })],
    installedAt: daysAgo(6),
  },
  {
    id: 's-doc-writer',
    name: 'doc-writer',
    emoji: '📄',
    description: '从代码变更推断文档更新点，生成迁移指南。',
    author: 'anthropic',
    version: '1.4.2',
    source: 'official',
    category: '文档',
    tags: ['文档'],
    instructions: docWriterMd,
    installs: { cursor: 'copy', kiro: 'symlink' },
    versions: [snap(1, daysAgo(10), { instructions: docWriterMd })],
    installedAt: daysAgo(10),
  },
  {
    id: 's-frontend-design',
    name: 'frontend-design',
    emoji: '🎨',
    description: '审查前端实现与设计 token 的一致性，检查交互状态完整性。',
    author: 'community',
    version: '0.9.0',
    source: 'community',
    category: '设计',
    tags: ['前端', '设计'],
    instructions: frontendDesignMd,
    installs: {},
    versions: [snap(1, daysAgo(2), { instructions: frontendDesignMd })],
    installedAt: daysAgo(2),
  },
  {
    id: 's-python-standards',
    name: 'python-standards',
    emoji: '🐍',
    description: '团队 Python 规范：uv 依赖管理、类型注解、异常处理约定。',
    author: 'local',
    version: '1.1.0',
    source: 'import',
    category: '语言规范',
    tags: ['python'],
    instructions: pythonStandardsMd,
    installs: { windsurf: 'copy', claude: 'external' },
    versions: [snap(1, daysAgo(16), { instructions: pythonStandardsMd })],
    installedAt: daysAgo(16),
  },
]

/* ---------------- Skill 商店 ---------------- */

const storeMd = (name: string, what: string, usage: string[]) =>
  `# ${name}\n\n${what}\n\n## 何时使用\n${usage.map((u) => `- ${u}`).join('\n')}\n\n## 工作方式\n1. 理解用户目标\n2. 按最佳实践执行\n3. 输出结果并说明依据\n`

export const SEED_STORE_SKILLS: StoreSkill[] = [
  {
    id: 'ss-spreadsheet',
    name: 'spreadsheet-editor',
    emoji: '📊',
    description: '创建、编辑与分析电子表格，支持公式计算与图表生成。',
    author: 'anthropic',
    version: '1.3.0',
    category: '办公',
    downloads: 128400,
    source: 'official',
    instructions: storeMd('Spreadsheet Editor', '读写 xlsx / csv，支持公式、透视与图表。', ['批量整理数据', '从表格生成报表']),
    files: [{ path: 'SKILL.md', size: '3.2 KB' }, { path: 'scripts/formulas.py', size: '1.8 KB' }],
  },
  {
    id: 'ss-pdf',
    name: 'pdf-processor',
    emoji: '📕',
    description: 'PDF 拆分、合并、文本提取与表单填写。',
    author: 'anthropic',
    version: '2.1.0',
    category: '办公',
    downloads: 96200,
    source: 'official',
    instructions: storeMd('PDF Processor', '对 PDF 执行常见操作并保持版式。', ['提取合同关键条款', '合并多份扫描件']),
    files: [{ path: 'SKILL.md', size: '2.7 KB' }, { path: 'scripts/merge.py', size: '1.1 KB' }],
  },
  {
    id: 'ss-skill-creator',
    name: 'skill-creator',
    emoji: '✨',
    description: '引导你从零编写一份结构合规的 SKILL.md 技能。',
    author: 'anthropic',
    version: '1.0.4',
    category: '元技能',
    downloads: 154000,
    source: 'official',
    instructions: storeMd('Skill Creator', '按官方规范生成 SKILL.md：frontmatter、指令体、参考文件。', ['把重复流程沉淀为技能', '规范已有提示词为技能']),
    files: [{ path: 'SKILL.md', size: '4.6 KB' }, { path: 'references/spec.md', size: '6.0 KB' }],
  },
  {
    id: 'ss-web-researcher',
    name: 'web-researcher',
    emoji: '🌐',
    description: '联网检索、交叉验证并输出带来源的调研摘要。',
    author: 'community',
    version: '0.8.2',
    category: '调研',
    downloads: 43100,
    source: 'community',
    instructions: storeMd('Web Researcher', '多轮搜索与来源校验，输出结构化调研报告。', ['技术选型对比', '竞品功能盘点']),
    files: [{ path: 'SKILL.md', size: '2.2 KB' }],
  },
  {
    id: 'ss-sqlite',
    name: 'sqlite-analyst',
    emoji: '🗄️',
    description: '分析 SQLite 库结构，审查慢查询并建议索引。',
    author: 'community',
    version: '1.1.0',
    category: '数据',
    downloads: 28700,
    source: 'community',
    instructions: storeMd('SQLite Analyst', '读取库结构、EXPLAIN 查询计划、建议索引。', ['定位慢查询', '审查表设计']),
    files: [{ path: 'SKILL.md', size: '2.9 KB' }, { path: 'scripts/analyze.sql', size: '0.9 KB' }],
  },
  {
    id: 'ss-api-designer',
    name: 'api-designer',
    emoji: '🧭',
    description: '按 REST 与 OpenAPI 规范评审接口设计，给出重构建议。',
    author: 'community',
    version: '2.0.0',
    category: '架构',
    downloads: 35900,
    source: 'community',
    instructions: storeMd('API Designer', '审查资源建模、状态码、分页与错误结构。', ['新服务接口评审', 'OpenAPI 文档体检']),
    files: [{ path: 'SKILL.md', size: '3.5 KB' }],
  },
  {
    id: 'ss-release-notes',
    name: 'git-release-notes',
    emoji: '🏷️',
    description: '汇总两个 tag 之间的提交，生成面向用户的发布说明。',
    author: 'anthropic',
    version: '1.2.1',
    category: '开发流程',
    downloads: 58300,
    source: 'official',
    instructions: storeMd('Release Notes', '按 feature / fix / breaking 分类汇总提交记录。', ['准备版本发布公告', '整理 changelog']),
    files: [{ path: 'SKILL.md', size: '1.9 KB' }],
  },
  {
    id: 'ss-ppt-writer',
    name: 'ppt-writer',
    emoji: '🖼️',
    description: '把主题展开为 PPT 大纲、每页讲稿与视觉建议。',
    author: 'community',
    version: '0.5.0',
    category: '办公',
    downloads: 19400,
    source: 'community',
    instructions: storeMd('PPT Writer', '生成大纲与逐页讲稿，标注视觉与图表建议。', ['项目汇报', '技术分享']),
    files: [{ path: 'SKILL.md', size: '2.4 KB' }],
  },
]

/* ---------------- MCP 种子 ---------------- */

export const SEED_MCPS: McpServer[] = [
  {
    id: 'm-filesystem',
    name: 'filesystem',
    description: '本地文件系统读写：列目录、读文件、受控写入。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/macbookair/Projects'],
    env: {},
    enabled: true,
    isFavorite: true,
    tags: ['文件'],
    source: 'manual',
    installs: { 'claude-desktop': true, cursor: true },
    notes: '',
    versions: [
      snap(2, daysAgo(2), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/macbookair/Projects'], env: {} }, null, 2) }, '把根目录改为 Projects'),
      snap(1, daysAgo(9), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: {} }, null, 2) }),
    ],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
  {
    id: 'm-github',
    name: 'github',
    description: 'GitHub 仓库 / Issue / PR 查询与操作。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_SixteenCharsExample0000' },
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    enabled: true,
    isFavorite: true,
    tags: ['开发'],
    source: 'market',
    installs: { 'claude-desktop': true },
    notes: 'Token 半年轮换一次。',
    versions: [snap(1, daysAgo(6), { config: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '***' } }, null, 2) })],
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
  },
  {
    id: 'm-amap',
    name: 'amap-maps',
    description: '高德地图：地理编码、POI 搜索、路线规划。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-amap'],
    env: { AMAP_API_KEY: '' },
    requiredEnv: ['AMAP_API_KEY'],
    enabled: true,
    isFavorite: false,
    tags: ['地图'],
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
    description: '网页抓取与 Markdown 转换，供模型阅读网页内容。',
    transport: 'http',
    url: 'https://mcp.fetch-service.dev/sse',
    headers: { Authorization: 'Bearer fk_live_9f8e7d6c5b4a' },
    enabled: false,
    isFavorite: false,
    tags: ['网络'],
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
    description: '只读查询 SQLite 数据库并解释执行计划。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data/app.db'],
    env: {},
    enabled: true,
    isFavorite: false,
    tags: ['数据'],
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
    description: 'Slack 频道消息收发与历史检索。',
    transport: 'stdio',
    command: '',
    args: [],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: 'T024K92XP' },
    requiredEnv: ['SLACK_BOT_TOKEN'],
    enabled: false,
    isFavorite: false,
    tags: ['办公'],
    source: 'manual',
    installs: {},
    notes: '待申请 Bot Token 后启用。',
    versions: [snap(1, daysAgo(8), { config: JSON.stringify({ transport: 'stdio', command: '', env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: 'T024K92XP' } }, null, 2) })],
    createdAt: daysAgo(8),
    updatedAt: daysAgo(8),
  },
]

/* ---------------- MCP 商店 ---------------- */

export const SEED_MCP_STORE: McpStoreItem[] = [
  {
    id: 'ms-notion',
    name: 'notion',
    description: '连接 Notion 工作区，搜索与读写页面、数据库。',
    whatItDoes: '以 Integration 身份访问授权页面：全文搜索、创建页面、追加块、查询数据库视图。',
    useCases: ['把会议纪要写入 Notion', '跨库检索项目资料'],
    installCommand: 'npx -y @mcp/notion',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/notion'],
    envDocs: [
      { key: 'NOTION_API_KEY', desc: '在 Notion「Integrations」创建 Internal Integration Token', placeholder: 'ntn_xxxxxxxx' },
    ],
  },
  {
    id: 'ms-postgres',
    name: 'postgres',
    description: '连接 PostgreSQL，执行只读查询与结构浏览。',
    whatItDoes: '列出表结构、执行只读 SQL、解释查询计划，默认禁止写操作。',
    useCases: ['让 AI 查业务数据', '审查慢查询'],
    installCommand: 'npx -y @mcp/postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/postgres'],
    envDocs: [
      { key: 'DATABASE_URL', desc: 'PostgreSQL 连接串，建议使用只读账号', placeholder: 'postgres://user:pass@host:5432/db' },
    ],
  },
  {
    id: 'ms-brave-search',
    name: 'brave-search',
    description: 'Brave 搜索 API 封装，网页与新闻检索。',
    whatItDoes: '执行网页 / 新闻 / 图片搜索，返回标题、摘要与链接。',
    useCases: ['实时信息检索', '竞品动态追踪'],
    installCommand: 'npx -y @mcp/brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/brave-search'],
    envDocs: [
      { key: 'BRAVE_API_KEY', desc: '在 brave.com/search/api 申请 Free 计划即可', placeholder: 'BSAxxxxxxxx' },
    ],
  },
  {
    id: 'ms-firecrawl',
    name: 'firecrawl',
    description: '把任意网页爬取为干净的 Markdown / 结构化数据。',
    whatItDoes: '单页抓取、整站爬取、JS 渲染，自动转 Markdown。',
    useCases: ['文档站抓取', '为 RAG 准备语料'],
    installCommand: 'npx -y @mcp/firecrawl',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/firecrawl'],
    envDocs: [
      { key: 'FIRECRAWL_API_KEY', desc: '在 firecrawl.dev 控制台获取', placeholder: 'fc-xxxxxxxx' },
    ],
  },
  {
    id: 'ms-memory',
    name: 'memory',
    description: '本地知识图谱记忆：跨会话记住实体与关系。',
    whatItDoes: '把对话中的实体、关系写入本地知识图谱文件，下次会话可召回。',
    useCases: ['记住项目上下文', '长期偏好记忆'],
    installCommand: 'npx -y @mcp/memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/memory'],
    envDocs: [],
  },
  {
    id: 'ms-puppeteer',
    name: 'puppeteer',
    description: '浏览器自动化：导航、点击、截图与执行脚本。',
    whatItDoes: '驱动无头 Chromium 完成网页操作并截图回传。',
    useCases: ['端到端冒烟验证', '自动填写表单'],
    installCommand: 'npx -y @mcp/puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/puppeteer'],
    envDocs: [],
  },
]

/* ---------------- Agent MCP 外部条目（反向导入演示） ---------------- */

export const AGENT_EXTERNAL_ENTRIES: Record<string, { name: string; hint: string }[]> = {
  cursor: [{ name: 'figma-developer-mcp', hint: '外部安装 · 读取设计稿数据' }],
  'claude-desktop': [{ name: 'notion-api', hint: '外部安装 · 未纳入我的库' }],
  cline: [{ name: 'time-server', hint: '外部安装 · 本地时间查询' }],
}
