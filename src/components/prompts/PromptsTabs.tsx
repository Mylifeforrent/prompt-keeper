import { useEffect, useRef, useState } from 'react'
import type { Page } from '../layout/Sidebar'
import { Tabs } from '../ui/tabs'
import { PromptsWorkspace } from './PromptsWorkspace'
import { PromptPlatformTab } from './PromptPlatformTab'
import { useStore } from '../../store/store'
import { Badge } from '../ui/core'

export function PromptsTabs({
  query,
  createSignal,
}: {
  query: string
  createSignal: { n: number; page: Page }
}) {
  const { state } = useStore()
  const [tab, setTab] = useState<'mine' | 'platform'>('mine')
  const lastCreate = useRef(createSignal.n)

  useEffect(() => {
    if (createSignal.page === 'prompts' && createSignal.n > lastCreate.current) {
      lastCreate.current = createSignal.n
      setTab('mine')
    }
  }, [createSignal])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'mine', label: '我的 Prompt', count: state.prompts.length },
            { value: 'platform', label: '平台发现' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
        />
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {tab === 'mine' ? (
            <>
              <Badge variant="outline">仅本地</Badge>
              不参与 Git 同步与 Agent 分发
            </>
          ) : (
            <>
              <Badge variant="info">平台来源</Badge>
              按需搜索、复制或保存到本地
            </>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'mine' ? (
          <PromptsWorkspace query={query} createSignal={createSignal} />
        ) : (
          <PromptPlatformTab query={query} />
        )}
      </div>
    </div>
  )
}
