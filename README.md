# Prompt Keeper

本地优先的 Prompt · Skill · MCP 资产工作台，以及 **Git 仓库 ⇄ 本地库 → 多 Agent** 的同步 / 分发控制面 —— 可交互产品原型。

功能提取自 [PromptHub](https://github.com/legeling/PromptHub)（v0.6.2）的 Prompt / Skill / MCP 管理域，并在 v0.2 增加 Git 同步与 Agent 分发层。交互设计依据 [docs/interaction-design.md](./docs/interaction-design.md)。

## 运行

```bash
npm install
npm run dev        # 开发预览，默认 http://localhost:5173（端口占用时自动顺延）
npm run build      # 类型检查 + 产物构建
```

要求 Node 18+。原型无后端：数据保存在浏览器 localStorage（键 `pk_state_v1`），设置页可一键重置为演示数据。

## 核心设计

```text
Git 仓库（共享事实源）
   ⇅  拉取 / 推送：三方合并，冲突显式解决
本地资产库（本机控制面）
   →  分发：单向写出，按 Agent 默认目录适配
各 Agent（Claude Code / Codex / Cursor / Windsurf / OpenCode …）
```

- **Skill**：双向同步，拉取后审核，再分发。
- **MCP**：只同步 `${VAR}` 模板，明文密钥禁止进 Git；真实值只存本机钥匙串。
- **Prompt**：默认不参与 Git、不分发；以「平台发现 → 复制 / 保存到本地」为主要复用方式。
- **分发**：默认 symlink，失败回退 copy；Agent 内被手工修改的文件标记为「漂移」，不会被批量覆盖。

## 原型覆盖

| 工作区 | 可交互闭环 |
| --- | --- |
| Prompts | 我的 Prompt（搜索 / 标签 / 收藏 / 排序 / 卡片·表格视图、双击 inline 编辑、`{{变量}}` 复制表单、版本历史、AI 测试抽屉）+ 平台发现（分类搜索、预览、复制、保存到本地） |
| Skills | 我的技能（平台分发状态、symlink/copy 安装、移除、仓库状态徽标）、技能商店（内容审核 → 选平台 → 结果 三步向导）、版本历史 |
| MCP | 我的库（传输类型、启停、健康检查、`[REDACTED]` 脱敏配置、个人备注）、三种新建方式、应用到平台、版本历史、Agent MCP 反向导入、MCP 商店 |
| 同步 | 仓库连接四步向导、概览（仓库卡 / 资产策略 / 阻塞提醒 / 统计 / Agent 状态）、变更（待拉取审核 / 待推送 / 冲突解决）、分发矩阵（资产 × Agent，含漂移 / 回滚 / 移除）、同步历史 |
| 通用 | 全局搜索（`/` 聚焦）、新建快捷键（`N`）、亮/暗/跟随系统主题、Toast 反馈、破坏性操作二次确认、空状态归因 |

与真实产品的差异（无 Electron / SQLite / 真实 Git / 真实写入 Agent 目录，AI 响应为模拟）见设计文档 §8.2。

## 目录结构

```text
docs/interaction-design.md      交互设计文档（同步域设计判断 / IA / 交互规范 / 验收清单）
src/data/seed.ts                Prompt / Skill / MCP / 商店 / 平台清单
src/data/syncSeed.ts            仓库、三方变更、冲突、分发矩阵、历史、平台 Prompt 种子
src/store/store.tsx             全局状态 + localStorage 持久化 + 版本快照 + 同步/分发动作
src/lib/                        变量解析、行级 diff、健康检查与脱敏、同步状态元数据、图标
src/components/ui/              shadcn 风格基础组件（源码内置，无运行时组件库依赖）
src/components/prompts|skills|mcp|sync|shared|layout/   各工作区与共享组件
```
