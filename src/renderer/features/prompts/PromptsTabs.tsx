import { useEffect, useRef, useState } from 'react'
import type { WorkspaceProps } from '../../app/navigation'
import { Badge } from '../../components/ui/primitives'
import { Tabs } from '../../components/ui/tabs'
import { Icon } from '../../lib/icons'
import { PromptsWorkspace } from './PromptsWorkspace'
import { PromptPlatformTab } from './PromptPlatformTab'

type PromptTab = 'library' | 'platform'

export function PromptsTabs({ query, createSignal, openAsset, onAssetOpened }: WorkspaceProps) {
  const [tab, setTab] = useState<PromptTab>('library')
  const lastCreateSignal = useRef(createSignal.n)

  useEffect(() => {
    if (createSignal.page !== 'prompts') return
    if (createSignal.n <= lastCreateSignal.current) return
    lastCreateSignal.current = createSignal.n
    setTab('library')
  }, [createSignal])

  useEffect(() => {
    if (openAsset?.kind === 'prompt') setTab('library')
  }, [openAsset])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'library', label: 'Library' },
            { value: 'platform', label: 'Platform Discovery' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as PromptTab)}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          {tab === 'library' ? (
            <>
              <Icon name="message" className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">
                Local library · Git sync optional · never written to Agent directories
              </span>
            </>
          ) : (
            <>
              <Badge variant="info">Curated demo data</Badge>
              <span className="whitespace-nowrap">
                Preview and save a sample; saving is optional
              </span>
            </>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'library' ? (
          <PromptsWorkspace
            query={query}
            createSignal={createSignal}
            openAsset={openAsset}
            onAssetOpened={onAssetOpened}
          />
        ) : (
          <PromptPlatformTab query={query} onSaved={() => setTab('library')} />
        )}
      </div>
    </div>
  )
}
