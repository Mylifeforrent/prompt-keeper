# Prompt Keeper

本地优先的 Prompt · Agent 指令 · Skill · MCP 资产工作台，以及 **Git 仓库 ⇄ 本地库 → 多 Agent** 的同步 / 投影 / 分发控制面 —— 可交互产品原型。

功能提取自 [PromptHub](https://github.com/legeling/PromptHub)（v0.6.2）的 Prompt / Skill / MCP 管理域，v0.2 增加 Git 同步与 Agent 分发层，v0.3 把 Prompt 纳入结构化同步，v0.4 新增独立的 Agent 指令契约域。v0.5 把四类资产统一为「**文件夹即仓库目录**」：目录内可继续建子文件夹，最后一级保持单文件 / 单技能目录约定；同时为 Agent 指令增加**可改写路径的本机全局目录分发**，并补全 Skill / MCP 的本地编辑 → 待推送闭环。交互设计依据 [docs/interaction-design.md](./docs/interaction-design.md)。

## 运行

```bash
npm install
npm run dev        # 开发预览，默认 http://localhost:5173（端口占用时自动顺延）
npm run build      # 类型检查 + 产物构建
```

要求 Node 18+。原型无后端：数据保存在浏览器 localStorage（键 `pk_state_v1`，schema v4），设置页可一键重置为演示数据。

## 核心设计

```text
Git 仓库（共享事实源，文件夹即目录结构）
   ⇅  拉取 / 推送：三方合并，冲突显式解决
本地资产库（本机控制面，同一套文件夹树）
   →  分发：Skill / MCP 单向写出，按 Agent 默认目录适配
   →  项目投影：Agent 指令编译为 AGENTS.md / CLAUDE.md / .cursor/rules 等
   →  全局分发：Agent 指令写入各工具用户级全局目录（路径可改写）
各 Agent（Claude Code / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder）
```

- **文件夹即仓库目录**：四类资产的 `folder` 直接映射为 Git 目录，目录内可继续建子文件夹；即使不打开平台，也能在仓库中按目录浏览。
- **Skill**：双向同步；按 `skills/<folder>/<name>/SKILL.md` 组织；本地可编辑，保存生成版本与待推送；拉取后审核，再分发。
- **MCP**：双向同步；一个 server 一个 `mcp/<folder>/<name>.json`，仓库只存 `${VAR}` 模板，明文密钥禁止进 Git；真实值只存本机钥匙串。
- **Prompt**：可选的 Git 同步资产；路径 `prompts/<folder>/<slug>.prompt.md`，元数据在 frontmatter，正文分 System / User 两段。可逐条设为「仅本机」，且不写入 Agent 默认目录。
- **Agent 指令**：独立资产域。一份 canonical `.contract.md` 描述 folder / scope / activation / priority / imports / targets，由目标适配器编译为各工具原生格式；支持生效预览、项目级 managed block 合并、投影漂移检测与逐项覆盖。
- **Agent 全局目录分发**：勾选多条指令 × 多个本机 Agent，写入各自用户级目录；路径可编辑、可恢复默认，路径变化会把相关投影标记为待更新。
- **分发 / 投影**：Skill / MCP 默认 symlink，失败回退 copy；Agent 内被手工修改的文件标记为「漂移」，不会被批量覆盖。项目投影与全局分发同理，drifted 必须逐项确认。

### 仓库目录结构

```text
prompts/编程/代码质量/review.prompt.md
instructions/团队/前端/frontend.contract.md
skills/开发流程/Git/commit-helper/SKILL.md
mcp/开发/GitHub/github.json
```

- 文件夹路径就是仓库目录；目录内可以继续建子文件夹。
- 最后一级保持单文件约定：Prompt / 指令一条一个 `.md`，Skill 一个技能一个目录，MCP 一个 server 一个 `.json`。
- 平台与仓库使用同一套层级：平台新建文件夹 → 推送后仓库出现同名目录；仓库新增子目录 → 拉取后文件夹树出现。

### Prompt 同步文件

```markdown
---
id: "p-review"
title: "代码审查助手"
description: "按正确性 / 可读性 / 性能 / 安全四个维度审查代码"
folder: "编程/代码质量"
tags: ["编程","代码审查"]
variables: [{"name":"code","type":"textarea","required":true}]
---

## System Prompt

你是一位资深代码审查专家…

## User Prompt

请审查以下 {{language}} 代码：{{code}}
```

拉取 Prompt 必须逐条预览（不进入批量接受）；推送前扫描正文中的高置信度凭据，命中后要求替换为 `{{变量}}`。冲突仍走远端 / 本地 / 基线三方对比，手动合并结果必须保留上述文件结构。

### Agent 指令同步文件

```markdown
---
id: "c-frontend"
title: "前端代码规范"
description: "对 src 下的 TypeScript / TSX 文件生效"
folder: "团队/前端"
scope: "path"
path: "src"
activation: {"mode":"glob","globs":["src/**/*.{ts,tsx}"]}
priority: 60
imports: []
targets: ["copilot-path","cursor","agents-md"]
tags: ["前端","规范"]
---

# 前端代码规范

- 函数组件 + hooks；不要新增 class 组件。
- 使用 Tailwind token，禁止散落十六进制颜色。
```

- 一条契约一个 `.contract.md`，路径 `instructions/<folder>/<slug>.contract.md`；正文不拆 System / User。
- 目标注册表在 `src/data/contractTargets.ts`：AGENTS.md、CLAUDE.md、copilot-instructions、Copilot 路径级、Cursor `.mdc`、Windsurf rule。
- 全局目录目标在 `src/data/globalTargets.ts`：Claude / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder；每个目标路径可改写，写入本机用户级目录。
- 生效预览按「目标 + 文件路径」计算命中链、跳过原因、字节预算与重复行；编译预览生成各工具原生内容。
- 单文件目标用 `<!-- pk:begin/end -->` managed block 合并；目标文件被手工修改时标记漂移，禁止批量覆盖。
- 项目投影与全局目录分发分开：前者写项目根目录，后者写用户级目录；全局路径保存在本机，不进入 Git。
- 拉取指令必须逐条预览；推送前同样扫描凭据。仓库默认只提交 canonical `.contract.md`，不把生成物当第二事实源。

## 原型覆盖

| 工作区 | 可交互闭环 |
| --- | --- |
| Prompts | 我的 Prompt（**多级文件夹树** / 搜索 / 标签 / 收藏 / 排序 / 按文件夹分组的卡片·表格视图、双击 inline 编辑、`{{变量}}` 复制表单、版本历史、AI 测试抽屉、逐条同步范围与列表同步状态、仓库路径回显）+ 平台发现（分类搜索、预览、复制、保存到本地） |
| Agent 指令 | 契约库（**文件夹树** / 范围 / 激活 / 优先级 / 目标 / `@import`、版本、逐条同步范围）+ 生效预览（目标 × 路径 → 命中链 / 跳过原因 / 字节预算 / 编译文件）+ 项目投影与漂移（投影 / 重新投影 / 覆盖确认 / 移除 / 回滚）+ **全局分发**（8 个本机 Agent 用户级目录、路径编辑 / 恢复默认、多选批量投影、全局漂移） |
| Skills | 我的技能（**文件夹树 / 分组卡片 / 编辑 → 版本 + 待推送**、平台分发状态、symlink/copy 安装、移除、仓库状态徽标）、技能商店（内容审核 → 选平台 → 结果 三步向导）、版本历史 |
| MCP | 我的库（**文件夹树 / 一 server 一 JSON 路径**、传输类型、启停、健康检查、`[REDACTED]` 脱敏配置、个人备注、保存即待推送）、三种新建方式、应用到平台、版本历史、Agent MCP 反向导入、MCP 商店 |
| 同步 | 仓库连接四步向导、概览（仓库卡 / 四类资产策略 / **目录结构示例** / 阻塞提醒 / 统计 / Agent 状态）、变更（Prompt / 指令全文预览 / 待拉取审核 / 待推送 / 冲突解决 / 凭据替换）、分发矩阵（Skill × MCP × Agent，含漂移 / 回滚 / 移除）、同步历史 |
| 通用 | 全局搜索（`/` 聚焦）、新建快捷键（`N`）、亮/暗/跟随系统主题、Toast 反馈、破坏性操作二次确认、空状态归因 |

与真实产品的差异（无 Electron / SQLite / 真实 Git / 真实写入 Agent 目录，AI 响应为模拟）见设计文档 §8.2。

## 目录结构

```text
docs/interaction-design.md      交互设计文档（同步域设计判断 / IA / 交互规范 / 验收清单）
src/data/seed.ts                Prompt / Skill / MCP / 商店 / 平台清单（含文件夹种子）
src/data/syncSeed.ts            仓库、三方变更、Prompt 同步文件、冲突、分发矩阵、历史、平台 Prompt 种子
src/data/contractSeed.ts        Agent 指令契约、项目投影状态、指令同步变更种子
src/data/contractTargets.ts     项目级目标注册表（AGENTS.md / CLAUDE.md / Copilot / Cursor / Windsurf）
src/data/globalTargets.ts       Agent 全局目录目标（8 个本机工具）与全局投影种子
src/store/store.tsx             全局状态 + localStorage 持久化 + 版本快照 + 同步 / 项目投影 / 全局分发动作
src/lib/folders.ts              多级文件夹树、目录匹配、仓库路径生成与反推
src/lib/promptSync.ts           Prompt ⇄ .prompt.md 序列化 / 解析、同步范围判定、凭据扫描与替换
src/lib/contracts.ts            契约序列化 / 解析、glob 匹配、生效预览、项目目标编译
src/lib/globalTargets.ts        全局目录路径解析、兼容性判断、全局文件编译
src/lib/skills.ts               Skill 目录 / 仓库路径
src/lib/mcp.ts                  MCP 仓库模板序列化 / 解析、健康检查与脱敏
src/lib/                        变量解析、行级 diff、同步状态元数据、图标
src/components/ui/              shadcn 风格基础组件（源码内置，无运行时组件库依赖）
src/components/instructions/    Agent 指令工作区（契约库 / 生效预览 / 项目投影 / 全局分发）
src/components/shared/FolderTree.tsx  多级文件夹树与文件夹输入（四类资产共用）
src/components/prompts|skills|mcp|sync|layout/   各工作区与布局组件
```
