import { useState } from 'react'
import { Tabs } from '../ui/tabs'
import { McpLibrary } from './McpLibrary'
import { AgentMcpTab, McpStoreTab } from './AgentMcpTab'
import { Icon } from '../../lib/icons'

export function McpTabs({ query, createSignal }: { query: string; createSignal: { n: number; page: string } }) {
  const [tab, setTab] = useState('mine')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'mine', label: '我的 MCP' },
            { value: 'agent', label: 'Agent MCP' },
            { value: 'store', label: 'MCP 商店' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Icon name="shield" className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">仓库只存模板 · 凭据加密在本机</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'mine' && <McpLibrary query={query} createSignal={createSignal} />}
        {tab === 'agent' && (
          <div className="h-full overflow-y-auto">
            <AgentMcpTab />
          </div>
        )}
        {tab === 'store' && (
          <div className="h-full overflow-y-auto">
            <McpStoreTab query={query} onInstalled={() => setTab('mine')} />
          </div>
        )}
      </div>
    </div>
  )
}
