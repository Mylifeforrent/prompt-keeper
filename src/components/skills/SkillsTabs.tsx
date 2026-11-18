import { useState } from 'react'
import { Tabs } from '../ui/tabs'
import { EmptyState } from '../ui/core'
import { MySkills, StoreTab } from './SkillsWorkspace'
import { Icon } from '../../lib/icons'

export function SkillsTabs({ query }: { query: string }) {
  const [tab, setTab] = useState('mine')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'mine', label: 'My Skills' },
            { value: 'store', label: 'Skill Store' },
            { value: 'projects', label: 'Project Workspace' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Icon name="layers" className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">SKILL.md + scripts · symlink / copy dispatch supported</span>
        </span>
      </div>
      <div className={tab === 'mine' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}>
        {tab === 'mine' && <MySkills query={query} />}
        {tab === 'store' && <StoreTab query={query} />}
        {tab === 'projects' && (
          <EmptyState
            icon="folder"
            title="Project-level Skill workspace (future iteration)"
            description="Register a project root and scan paths to give each project its own Skill space: scan directories such as .claude/skills and .agents/skills, import both ways, and dispatch independently without polluting the global library."
            action={
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Icon name="sparkles" className="h-3.5 w-3.5" />
                Not implemented in the prototype yet; see interaction design doc §3.2
              </span>
            }
          />
        )}
      </div>
    </div>
  )
}
