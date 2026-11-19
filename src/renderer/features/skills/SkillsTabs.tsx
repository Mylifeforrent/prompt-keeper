import { useEffect, useRef, useState } from 'react'
import { Tabs } from '../../components/ui/tabs'
import { Button } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import type { WorkspaceProps } from '../../app/navigation'
import { SkillImportModal, SkillsWorkspace } from './SkillsWorkspace'
import { SkillStoreTab } from './SkillStoreTab'

type SkillsTab = 'library' | 'store'

export function SkillsTabs({ query, createSignal, openAsset, onAssetOpened }: WorkspaceProps) {
  const [tab, setTab] = useState<SkillsTab>('library')
  const [importOpen, setImportOpen] = useState(false)
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const focusSeq = useRef(0)

  useEffect(() => {
    if (!openAsset || openAsset.kind !== 'skill') return
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
            { value: 'store', label: 'Browse Store' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as SkillsTab)}
        />
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Icon name="download" className="h-3.5 w-3.5" />
          Import
        </Button>
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Icon name="layers" className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">
            SKILL.md + supporting files · symlink or copy install · scripts never run
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'library' && (
          <SkillsWorkspace
            query={query}
            createSignal={createSignal}
            openAsset={null}
            onAssetOpened={onAssetOpened}
            focus={focus}
          />
        )}
        {tab === 'store' && (
          <div className="h-full overflow-y-auto">
            <SkillStoreTab query={query} onAdded={() => setTab('library')} />
          </div>
        )}
      </div>

      <SkillImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
