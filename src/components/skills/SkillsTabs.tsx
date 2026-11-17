import { useState } from 'react'
import { Tabs } from '../ui/tabs'
import { EmptyState } from '../ui/core'
import { MySkills, StoreTab } from './SkillsWorkspace'
import { Icon } from '../../lib/icons'

export function SkillsTabs({ query }: { query: string }) {
  const [tab, setTab] = useState('mine')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'mine', label: '我的技能' },
            { value: 'store', label: '技能商店' },
            { value: 'projects', label: '项目工作区' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'mine' && <MySkills query={query} />}
        {tab === 'store' && <StoreTab query={query} />}
        {tab === 'projects' && (
          <EmptyState
            icon="folder"
            title="项目级 Skill 工作区（后续迭代）"
            description="注册项目根目录与扫描路径后，可为单个项目建立独立技能空间：扫描 .claude/skills、.agents/skills 等目录，双向导入、独立分发，不污染全局库。"
            action={
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Icon name="sparkles" className="h-3.5 w-3.5" />
                原型暂未实现，见交互设计文档 §3.2
              </span>
            }
          />
        )}
      </div>
    </div>
  )
}
