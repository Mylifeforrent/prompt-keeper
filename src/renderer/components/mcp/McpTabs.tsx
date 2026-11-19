import { useEffect, useRef, useState } from 'react'
import { Tabs } from '../ui/tabs'
import { Icon } from '../../lib/icons'
import type { WorkspaceProps } from '../../app/types'
import { McpLibrary, McpStoreTab } from './McpLibrary'
import { AgentMcpTab } from './AgentMcpTab'

type McpTab = 'library' | 'agent' | 'store'

export function McpTabs({ query, createSignal, openAsset, onAssetOpened }: WorkspaceProps) {
  const [tab, setTab] = useState<McpTab>('library')
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const focusSeq = useRef(0)

  useEffect(() => {
    if (!openAsset || openAsset.kind !== 'mcp') return
    focusSeq.current += 1
    setFocus({ id: openAsset.id, n: focusSeq.current })
    setTab('library')
    onAssetOpened()
  }, [openAsset, onAssetOpened])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'library', label: 'Library' },
            { value: 'agent', label: 'Agent Config' },
            { value: 'store', label: 'Browse Store' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as McpTab)}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Icon name="shield" className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">
            Repository files hold placeholders only · credentials stay encrypted locally
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'library' && (
          <McpLibrary
            query={query}
            createSignal={createSignal}
            openAsset={null}
            onAssetOpened={onAssetOpened}
            focus={focus}
          />
        )}
        {tab === 'agent' && (
          <div className="h-full overflow-y-auto">
            <AgentMcpTab />
          </div>
        )}
        {tab === 'store' && (
          <div className="h-full overflow-y-auto">
            <McpStoreTab query={query} onAdded={() => setTab('library')} />
          </div>
        )}
      </div>
    </div>
  )
}
