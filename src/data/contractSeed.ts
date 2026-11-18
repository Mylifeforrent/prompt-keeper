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

const baselineV1 = `# 仓库通用约定

## 构建与测试
- 安装依赖使用 \`npm ci\`，不要手改 lockfile。
- 提交前必须运行 \`npm run build\`，类型错误不得提交。

## 代码风格
- TypeScript 严格模式；禁止 \`any\`。
- 注释只解释约束与原因，不复述代码。
`

const baselineBody = `# 仓库通用约定

## 构建与测试
- 安装依赖使用 \`npm ci\`，不要手改 lockfile。
- 提交前必须运行 \`npm run build\`，类型错误不得提交。
- 单元测试使用 \`npm test -- --run\`，新增逻辑必须带测试。

## 代码风格
- TypeScript 严格模式；禁止 \`any\`，确需逃逸时写 \`unknown\` + 类型守卫。
- 组件保持单一职责；跨模块共享逻辑放 \`src/lib/\`。
- 注释只解释约束与原因，不复述代码。

## 安全
- 禁止把密钥、Token、真实用户数据写入仓库。
- 外部输入必须校验；不要拼接 shell 命令。
`

const frontendV1 = `# 前端代码规范

## 组件
- 函数组件 + hooks；不要新增 class 组件。
- 状态提升到最近的共同父级。

## 样式
- 使用 Tailwind token，禁止散落十六进制颜色。
`

const frontendBody = `# 前端代码规范

## 组件
- 函数组件 + hooks；不要新增 class 组件。
- 状态提升到最近的共同父级；跨页面状态才进入 Context。
- 列表渲染必须有稳定 key，禁止用数组下标。

## 样式
- 使用 Tailwind token（\`bg-card\` / \`text-muted-foreground\`），禁止散落十六进制颜色。
- 交互态必须覆盖 hover / focus-visible / disabled。

## 可访问性
- 图标按钮必须有 \`title\` 或 \`aria-label\`。
- 弹层打开后焦点进入弹层，Esc 可关闭。
`

const frontendRemote = `${frontendBody}
## 性能
- 大列表使用虚拟滚动；避免在渲染函数里创建新对象作为 props。
- 图片懒加载，并显式设置宽高避免布局抖动。
`

const baselineSeed: ContractSeed = {
  id: 'c-repo-baseline',
  title: '仓库通用约定',
  description: '所有 Agent 在本仓库工作时必须遵守的构建、测试与安全约定',
  body: baselineBody,
  folder: '团队/仓库基线',
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 100,
  imports: [],
  targets: ['agents-md', 'claude', 'copilot', 'cursor', 'windsurf'],
  tags: ['仓库', '基线'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const frontendSeed: ContractSeed = {
  id: 'c-frontend',
  title: '前端代码规范',
  description: '对 src 下的 TypeScript / TSX 文件生效的组件、样式与可访问性约束',
  body: frontendBody,
  folder: '团队/前端',
  scope: 'path',
  path: 'src',
  activation: { mode: 'glob', globs: ['src/**/*.{ts,tsx}'] },
  priority: 60,
  imports: [],
  targets: ['copilot-path', 'cursor', 'agents-md'],
  tags: ['前端', '规范'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const claudeSeed: ContractSeed = {
  id: 'c-claude-session',
  title: 'Claude Code 会话偏好',
  description: '计划优先、先读设计文档、不自动提交；通过 @import 引用交互文档',
  folder: '个人/会话偏好',
  body: `# Claude Code 会话约定

- 先读 \`docs/interaction-design.md\`，再改交互相关代码。
- 修改前先给出目标、涉及文件、验证命令；复杂任务先列计划。
- 不要自动提交；提交信息使用简体中文。
- 遇到设计文档与代码冲突时，先指出冲突，不要自行折中。
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 80,
  imports: ['docs/interaction-design.md'],
  targets: ['claude'],
  tags: ['Claude', '协作'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const reviewSeed: ContractSeed = {
  id: 'c-cursor-review',
  title: 'Cursor 评审规则',
  description: '当用户要求代码评审、review 或检查改动时应用的评审口径',
  folder: '个人/评审',
  body: `# 代码评审口径

- 先看正确性与边界条件，再看可读性、性能、安全。
- 每条问题必须给出文件位置、触发条件、修复建议。
- 不确定的结论标注「待验证」，不要猜测。
- 不把风格偏好写成缺陷；风格问题单独归类。
`,
  scope: 'project',
  activation: {
    mode: 'model',
    globs: [],
    description: '当用户要求代码评审、review 或检查改动时应用',
  },
  priority: 40,
  imports: [],
  targets: ['cursor', 'windsurf'],
  tags: ['评审'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const releaseSeed: ContractSeed = {
  id: 'c-release-checklist',
  title: '发布检查清单',
  description: '发版前手动引用的回滚、迁移与监控检查项',
  folder: '团队/发布',
  body: `# 发布检查清单

1. 确认版本号与 CHANGELOG 一致。
2. 运行完整测试与构建。
3. 检查数据库迁移是否可回滚。
4. 确认监控与告警已覆盖新接口。
5. 准备回滚命令与负责人。
`,
  scope: 'project',
  activation: { mode: 'manual', globs: [] },
  priority: 20,
  imports: [],
  targets: ['cursor', 'windsurf'],
  tags: ['发布'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const legacySeed: ContractSeed = {
  id: 'c-legacy-cursor',
  title: '旧版 Cursor 规则（待合并）',
  description: '与当前前端规范冲突的历史规则，保留用于对照合并',
  folder: '归档/遗留规则',
  body: `# 旧版 Cursor 规则

- 所有函数必须写 JSDoc。
- 使用 4 空格缩进。
- 优先使用 class 组件。
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 10,
  imports: [],
  targets: ['cursor'],
  tags: ['遗留'],
  syncPolicy: 'inherit',
  inRepo: true,
}

const teamUiSeed: ContractSeed = {
  id: 'c-team-ui',
  title: '团队 UI 约定',
  description: '团队共享的组件命名与空状态规范，等待拉取',
  folder: '团队/UI',
  body: `# 团队 UI 约定

- 组件文件使用 PascalCase；一个文件只导出一个主组件。
- 空状态必须区分「无数据」与「无匹配」，并提供下一步动作。
- 危险操作的主按钮使用红色，并在文案中写明对象名。
- 所有弹层支持 Esc 关闭，并在关闭后恢复焦点。
`,
  scope: 'project',
  activation: { mode: 'always', globs: [] },
  priority: 70,
  imports: [],
  targets: ['agents-md', 'claude', 'copilot'],
  tags: ['团队', 'UI'],
  syncPolicy: 'inherit',
  inRepo: false,
  }

export const SEED_CONTRACTS: AgentContract[] = [
  {
    ...baselineSeed,
    versions: makeVersions(baselineSeed, [
      { version: 2, at: daysAgo(1), note: '补充安全约束与测试要求' },
      { version: 1, at: daysAgo(12), note: '初始版本', body: baselineV1 },
    ]),
    createdAt: daysAgo(12),
    updatedAt: daysAgo(1),
  },
  {
    ...frontendSeed,
    versions: makeVersions(frontendSeed, [
      { version: 2, at: daysAgo(2), note: '增加可访问性与列表 key 约束' },
      { version: 1, at: daysAgo(9), note: '初始版本', body: frontendV1 },
    ]),
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
  {
    ...claudeSeed,
    versions: makeVersions(claudeSeed, [
      { version: 2, at: daysAgo(3), note: '加入 @import 与冲突处理要求' },
      { version: 1, at: daysAgo(15), note: '初始版本' },
    ]),
    createdAt: daysAgo(15),
    updatedAt: daysAgo(3),
  },
  {
    ...reviewSeed,
    versions: makeVersions(reviewSeed, [
      { version: 2, at: daysAgo(4), note: '区分缺陷与风格偏好' },
      { version: 1, at: daysAgo(18), note: '初始版本' },
    ]),
    createdAt: daysAgo(18),
    updatedAt: daysAgo(4),
  },
  {
    ...releaseSeed,
    versions: makeVersions(releaseSeed, [
      { version: 2, at: daysAgo(6), note: '加入监控与回滚负责人' },
      { version: 1, at: daysAgo(20), note: '初始版本' },
    ]),
    createdAt: daysAgo(20),
    updatedAt: daysAgo(6),
  },
  {
    ...legacySeed,
    versions: makeVersions(legacySeed, [
      { version: 1, at: daysAgo(30), note: '历史规则导入' },
    ]),
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  },
]

/* ---------------- 投影状态 ---------------- */

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
  projection('c-repo-baseline', 'claude', 'stale', 'v1', daysAgo(4), '本地已到 v2，等待重新投影'),
  projection('c-repo-baseline', 'copilot', 'synced', 'v2', hoursAgo(2)),
  projection('c-frontend', 'copilot-path', 'drifted', 'v1', daysAgo(3), '目标文件在 Agent 侧被手工修改，未自动覆盖'),
  projection('c-frontend', 'cursor', 'stale', 'v1', daysAgo(3), '契约已更新到 v2，等待重新投影'),
  projection('c-claude-session', 'claude', 'synced', 'v2', daysAgo(1)),
  projection('c-cursor-review', 'cursor', 'synced', 'v2', daysAgo(4)),
  projection('c-release-checklist', 'windsurf', 'synced', 'v2', daysAgo(6)),
  projection('c-release-checklist', 'cursor', 'synced', 'v2', daysAgo(6)),
  projection('c-legacy-cursor', 'cursor', 'synced', 'v1', daysAgo(30)),
]

/* ---------------- Git 同步种子 ---------------- */

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
    summary: '新增团队指令：组件命名、空状态与危险操作规范',
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
    summary: '本地补充安全约束与测试要求，等待推送',
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
    summary: '仓库补充性能约束；本地补充可访问性约束，双方都改动了同一文件',
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
