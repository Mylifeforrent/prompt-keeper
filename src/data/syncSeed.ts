import type {
  AgentRuntime,
  Deployment,
  PromptPlatformItem,
  RepoConfig,
  SyncChange,
  SyncEvent,
} from '../types'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const hoursAgo = (h: number) => minutesAgo(h * 60)
const daysAgo = (d: number) => minutesAgo(d * 24 * 60)

/* ---------------- 本机 Agent 清单 ---------------- */

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

/* ---------------- 仓库配置 ---------------- */

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
  layout: { skills: 'skills', mcp: 'mcp/servers.json', prompts: 'prompts' },
  policies: { skills: true, mcp: true, prompts: false },
}

/* ---------------- 待处理变更 ---------------- */

const docWriterBase = `# Doc Writer

把代码变更转化为文档更新：

- 从公开 API 变更推断 README 是否需要更新
- 为新端点补充请求 / 响应示例
- 变更破坏兼容性时生成迁移指南段落
`

const docWriterRemote = `${docWriterBase}
## 迁移指南格式
1. 变更摘要（一句话）
2. 受影响调用方清单
3. 修改前后代码对比
4. 回滚方式
`

const docWriterLocal = `${docWriterBase}
## 输出格式
- 使用二级标题分段
- 每段不超过 5 行
- 代码示例统一使用 TypeScript
`

const releaseNotesRemote = `# Release Notes

汇总两个 tag 之间的提交，生成面向用户的发布说明。

## 何时使用
- 准备版本发布公告
- 整理 changelog

## 工作方式
1. 运行 scripts/collect.sh <from-tag> <to-tag>
2. 按 feature / fix / breaking 分类
3. 面向用户描述影响，而不是罗列 commit
4. 破坏性变更必须给出迁移提示

## 注意
- 脚本只读取 git log，不修改仓库
- 输出使用简体中文
`

const commitHelperRemote = `# Commit Helper

依据 **Conventional Commits** 规范生成提交信息。

## 使用方式
1. 读取 \`git diff --staged\` 输出
2. 判断变更类型：feat / fix / refactor / docs / chore
3. 输出一行主题 + 正文要点

## 规则
- 主题不超过 50 字符
- 正文说明「为什么」而不是「改了什么」
- 涉及破坏性变更时必须带 \`!\`，并在正文末行给出迁移提示
- 一次提交只做一件事

\`\`\`bash
git diff --staged | commit-helper
\`\`\`
`

export const SEED_SYNC_CHANGES: SyncChange[] = [
  {
    id: 'sc-release-notes',
    kind: 'skill',
    assetName: 'release-notes',
    path: 'skills/release-notes/SKILL.md',
    change: 'added',
    direction: 'incoming',
    summary: '新增技能：汇总两个 tag 之间的提交，生成面向用户的发布说明',
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
    path: 'skills/commit-helper/SKILL.md',
    change: 'modified',
    direction: 'incoming',
    summary: '规则更新：破坏性变更必须带 ! 并给出迁移提示',
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
    path: 'mcp/servers.json',
    change: 'modified',
    direction: 'incoming',
    summary: '新增 toolsets 参数，凭据仍以 ${GITHUB_PERSONAL_ACCESS_TOKEN} 占位',
    additions: 5,
    deletions: 1,
    risk: 'none',
    remoteVersion: 'v2',
    localVersion: 'v1',
    baseVersion: 'v1',
  },
  {
    id: 'sc-code-reviewer',
    kind: 'skill',
    assetName: 'code-reviewer',
    path: 'skills/code-reviewer/SKILL.md',
    change: 'modified',
    direction: 'outgoing',
    summary: '新增「可维护性」审查维度与评分门槛',
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
    path: 'mcp/servers.json',
    change: 'modified',
    direction: 'outgoing',
    summary: '数据库路径改为 ${SQLITE_DB_PATH}，避免提交本机绝对路径',
    additions: 1,
    deletions: 1,
    risk: 'none',
    localVersion: 'v2',
    baseVersion: 'v1',
  },
  {
    id: 'sc-amap-mcp',
    kind: 'mcp',
    assetName: 'amap-maps',
    path: 'mcp/servers.json',
    change: 'modified',
    direction: 'outgoing',
    summary: '检测到明文 AMAP_API_KEY，已阻止推送',
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
    path: 'skills/doc-writer/SKILL.md',
    change: 'modified',
    direction: 'conflict',
    summary: '仓库新增「迁移指南格式」；本地修改了「输出格式」，双方都改动了同一文件',
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
]

/* ---------------- 分发矩阵 ---------------- */

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
  deploy('skill', 's-commit-helper', 'commit-helper', 'cursor', 'stale', 'copy', 'v1.1.0', daysAgo(6), '仓库 v1.3.0 / 库 v1.2.0，Agent 仍是 v1.1.0'),
  deploy('skill', 's-code-reviewer', 'code-reviewer', 'claude', 'synced', 'symlink', 'v2.0.1', daysAgo(3)),
  deploy('skill', 's-test-writer', 'test-writer', 'codex', 'synced', 'copy', 'v1.0.0', daysAgo(5)),
  deploy('skill', 's-doc-writer', 'doc-writer', 'cursor', 'drifted', 'copy', 'v1.4.2', daysAgo(8), 'Agent 目录中的 SKILL.md 被手工改过，与库不一致'),
  deploy('skill', 's-doc-writer', 'doc-writer', 'kiro', 'synced', 'symlink', 'v1.4.2', daysAgo(8)),
  deploy('skill', 's-python-standards', 'python-standards', 'claude', 'synced', 'symlink', 'v1.1.0', daysAgo(16)),
  deploy('skill', 's-python-standards', 'python-standards', 'windsurf', 'synced', 'copy', 'v1.1.0', daysAgo(16)),
  deploy('mcp', 'm-filesystem', 'filesystem', 'claude-desktop', 'synced', 'copy', 'v2', daysAgo(2)),
  deploy('mcp', 'm-filesystem', 'filesystem', 'cursor', 'synced', 'copy', 'v2', daysAgo(2)),
  deploy('mcp', 'm-github', 'github', 'claude-desktop', 'stale', 'copy', 'v1', daysAgo(6), '仓库模板已到 v2，等待拉取后重新分发'),
  deploy('mcp', 'm-fetch', 'fetch', 'cursor', 'drifted', 'copy', 'v1', daysAgo(13), 'Agent 配置文件中的 headers 被手工修改'),
  deploy('mcp', 'm-sqlite', 'sqlite-explorer', 'claude', 'synced', 'copy', 'v1', daysAgo(1)),
]

/* ---------------- 同步历史 ---------------- */

export const SEED_SYNC_EVENTS: SyncEvent[] = [
  {
    id: 'ev-fetch-1',
    at: minutesAgo(12),
    type: 'fetch',
    title: '自动 fetch 完成 · 仓库有 3 个新提交',
    detail: 'tony/ai-assets · main · 未自动合并，等待你确认',
    result: 'success',
  },
  {
    id: 'ev-review-1',
    at: hoursAgo(2),
    type: 'review',
    title: 'skill:release-notes 需要人工审核',
    detail: '含可执行脚本 scripts/collect.sh，尚未写入本机库',
    result: 'warning',
  },
  {
    id: 'ev-pull-1',
    at: hoursAgo(2),
    type: 'pull',
    title: '拉取 2 个技能更新 · 1 个 MCP 模板',
    detail: 'fast-forward 到 4c9e21b，未覆盖任何本地改动',
    result: 'success',
  },
  {
    id: 'ev-push-1',
    at: hoursAgo(26),
    type: 'push',
    title: '推送 2 个变更 · commit 7f3a1c2',
    detail: '分支 prompt-keeper/sync-1130，已创建 PR #24',
    result: 'success',
  },
  {
    id: 'ev-conflict-1',
    at: hoursAgo(27),
    type: 'conflict',
    title: 'doc-writer 双向修改，已生成冲突',
    detail: '仓库 v1.5.0 / 本地 v1.4.3 / 基线 v1.4.2',
    result: 'warning',
  },
  {
    id: 'ev-deploy-1',
    at: daysAgo(3),
    type: 'deploy',
    title: '分发 4 项到 Claude Code / Cursor',
    detail: '3 个 symlink，1 个 copy；失败 0',
    result: 'success',
  },
  {
    id: 'ev-connect-1',
    at: daysAgo(5),
    type: 'connect',
    title: '连接仓库 tony/ai-assets',
    detail: 'main · 系统 Git 凭据 · 本地克隆位于应用数据目录',
    result: 'success',
  },
]

/* ---------------- 平台 Prompt（发现，不参与 Git 同步） ---------------- */

export const SEED_PLATFORM_PROMPTS: PromptPlatformItem[] = [
  {
    id: 'pf-prd-review',
    title: '产品需求文档评审',
    description: '按目标、边界、异常流、验收标准四层拆解 PRD，输出可执行的评审意见。',
    author: 'prompt-keeper',
    category: '产品',
    tags: ['产品', '评审'],
    systemPrompt:
      '你是资深产品评审专家。请以「用户价值 → 范围边界 → 异常流程 → 验收标准」四层结构评审用户提供的 PRD，指出缺失项与自相矛盾之处，并按严重程度排序。用简体中文回答。',
    userPrompt: '请评审以下 PRD：\n\n{{prd}}',
    variables: [
      { name: 'prd', type: 'textarea', required: true, label: 'PRD 正文' },
    ],
    uses: 18420,
    updatedAt: daysAgo(2),
  },
  {
    id: 'pf-api-error',
    title: 'API 错误码与错误结构设计',
    description: '为 REST 接口设计一致、可调试、不泄漏内部实现的错误响应。',
    author: 'community',
    category: '后端',
    tags: ['API', '后端'],
    systemPrompt:
      '你是 API 设计专家。请为用户描述的业务场景设计错误码体系：分层（客户端 / 业务 / 依赖）、命名、HTTP 状态码映射、响应体结构与可重试标记。禁止泄漏堆栈与内部实现细节。',
    userPrompt: '业务场景：{{scenario}}\n现有错误处理：{{current}}',
    variables: [
      { name: 'scenario', type: 'text', required: true },
      { name: 'current', type: 'textarea', required: false, label: '现有错误处理（可选）' },
    ],
    uses: 9260,
    updatedAt: daysAgo(5),
  },
  {
    id: 'pf-migration-plan',
    title: '技术迁移方案生成',
    description: '把「从 A 迁到 B」拆成可回滚的阶段计划，标注风险与验证点。',
    author: 'prompt-keeper',
    category: '架构',
    tags: ['架构', '迁移'],
    systemPrompt:
      '你是负责落地的技术负责人。请为迁移任务输出阶段化计划：每阶段的目标、改动范围、数据兼容策略、回滚方式、验证指标与责任人角色。优先双写/灰度，避免一次性切换。',
    userPrompt: '迁移目标：{{goal}}\n当前约束：{{constraints}}',
    variables: [
      { name: 'goal', type: 'textarea', required: true, label: '迁移目标与范围' },
      { name: 'constraints', type: 'textarea', required: false, label: '团队/时间/兼容性约束' },
    ],
    uses: 7710,
    updatedAt: daysAgo(8),
  },
  {
    id: 'pf-interview',
    title: '技术面试题生成',
    description: '按岗位与级别生成递进式面试题，附评分要点与追问路径。',
    author: 'community',
    category: '招聘',
    tags: ['招聘', '面试'],
    systemPrompt:
      '你是技术面试官。请按岗位与级别生成 6 道递进式问题：基础 → 实战 → 设计 → 排障。每题给出考察点、参考回答要点、可继续追问的两层问题，并标注区分度。',
    userPrompt: '岗位：{{role}}\n级别：{{level}}\n团队技术栈：{{stack}}',
    variables: [
      { name: 'role', type: 'text', required: true },
      { name: 'level', type: 'select', options: ['初级', '中级', '高级', '专家'], required: true },
      { name: 'stack', type: 'text', required: false },
    ],
    uses: 6130,
    updatedAt: daysAgo(11),
  },
  {
    id: 'pf-competitor',
    title: '竞品分析框架',
    description: '从用户、场景、能力、商业模式、护城河五维对比竞品。',
    author: 'prompt-keeper',
    category: '产品',
    tags: ['产品', '调研'],
    systemPrompt:
      '你是产品战略分析师。请按「目标用户 / 核心场景 / 能力矩阵 / 商业模式 / 迁移成本与护城河」五个维度对比用户提供的竞品，输出表格与结论，明确哪些差距是必须补齐、哪些可以放弃。',
    userPrompt: '我们的产品：{{ours}}\n竞品清单：{{competitors}}',
    variables: [
      { name: 'ours', type: 'textarea', required: true },
      { name: 'competitors', type: 'textarea', required: true },
    ],
    uses: 5480,
    updatedAt: daysAgo(15),
  },
  {
    id: 'pf-weekly',
    title: '团队周报精炼',
    description: '把零散进展整理成结论先行、可决策的周报。',
    author: 'community',
    category: '写作',
    tags: ['写作', '效率'],
    systemPrompt:
      '你是团队负责人。把用户的零散记录整理成周报：先给三行结论，再按「已完成 / 进行中 / 风险 / 需要决策」分类。风险项必须写明影响与建议动作，禁止只罗列过程。',
    userPrompt: '本周记录：\n{{notes}}\n\n下周重点：{{next}}',
    variables: [
      { name: 'notes', type: 'textarea', required: true },
      { name: 'next', type: 'text', required: false },
    ],
    uses: 12890,
    updatedAt: daysAgo(4),
  },
]
