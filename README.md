# Prompt Keeper

本地优先的 Prompt · Skill · MCP 资产工作台 —— 可交互产品原型。

功能提取自 [PromptHub](https://github.com/legeling/PromptHub)（v0.6.2）的 Prompt / Skill / MCP 管理域，交互设计依据 [docs/interaction-design.md](./docs/interaction-design.md)。

## 运行

```bash
npm install
npm run dev        # 开发预览，默认 http://localhost:5173
npm run build      # 类型检查 + 产物构建
```

要求 Node 18+。原型无后端：数据保存在浏览器 localStorage（键 `pk_state_v1`），设置页可一键重置为演示数据。

## 原型覆盖

| 工作区 | 可交互闭环 |
| --- | --- |
| Prompts | 搜索 / 标签 / 收藏 / 排序 / 卡片·表格视图、双击 inline 编辑、`{{变量}}` 复制表单（30 天记忆）、版本历史（diff + 恢复 + 删除）、AI 测试抽屉（模拟流式 + 历史） |
| Skills | 我的技能（平台分发状态、symlink/copy 安装、移除）、技能商店（内容审核 → 选平台 → 结果 三步向导）、版本历史 |
| MCP | 我的库（传输类型、启停、健康检查、`[REDACTED]` 脱敏配置、个人备注）、三种新建方式（来源识别 / 粘贴 JSON / 手动）、应用到平台（写入预览 + 移除）、版本历史、Agent MCP 反向导入、MCP 商店一键入库 |
| 通用 | 全局搜索（`/` 聚焦）、新建快捷键（`N`）、亮/暗/跟随系统主题、Toast 反馈、破坏性操作二次确认、空状态归因 |

与真实产品的差异（无 Electron / SQLite / 真实写入，AI 响应为模拟）见设计文档 §8.2。

## 目录结构

```text
docs/interaction-design.md   交互设计文档（功能提取汇总 / IA / 交互规范 / 验收清单）
src/data/seed.ts             演示种子数据（Prompt / Skill / MCP / 商店 / 平台清单）
src/store/store.tsx          全局状态 + localStorage 持久化 + 版本快照逻辑
src/lib/                     变量解析、行级 diff、健康检查与脱敏、图标、工具
src/components/ui/           shadcn 风格基础组件（源码内置，无运行时组件库依赖）
src/components/prompts|skills|mcp|shared|layout/  各工作区与共享组件
```
