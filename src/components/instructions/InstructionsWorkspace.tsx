import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentContract, ContractScope, PromptSyncPolicy } from '../../types'
import type { Page } from '../layout/Sidebar'
import { useStore } from '../../store/store'
import { Badge, Button, Select } from '../ui/core'
import { Tabs } from '../ui/tabs'
import { ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { ContractList } from './ContractList'
import { ContractDetail } from './ContractDetail'
import { ContractEditModal } from './ContractEditModal'
import { ContractSyncModal } from './ContractSyncModal'
import { ResolvedPreview } from './ResolvedPreview'
import { ContractProjections } from './ContractProjections'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { useToast } from '../ui/toast'
import { CONTRACT_SCOPE_META, contractSyncEnabled, formatContractSnapshot } from '../../lib/contracts'
import { CONTRACT_TARGETS } from '../../data/contractTargets'
import { folderMatches, folderLabel } from '../../lib/folders'
import { FolderTree } from '../shared/FolderTree'
import { GlobalDispatch } from './GlobalDispatch'

type InstructionTab = 'library' | 'preview' | 'projections' | 'global'

export function InstructionsWorkspace({
  query,
  createSignal,
}: {
  query: string
  createSignal: { n: number; page: Page }
}) {
  const {
    state,
    deleteContract,
    restoreContractVersion,
    deleteContractVersion,
  } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<InstructionTab>('library')
  const [selectedId, setSelectedId] = useState<string | null>(state.contracts[0]?.id ?? null)
  const [scopeFilter, setScopeFilter] = useState<'all' | ContractScope>('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [folderFilter, setFolderFilter] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'priority' | 'title'>('updated')

  const [editing, setEditing] = useState<{ open: boolean; contract: AgentContract | null }>({
    open: false,
    contract: null,
  })
  const [versionOf, setVersionOf] = useState<AgentContract | null>(null)
  const [syncOf, setSyncOf] = useState<AgentContract | null>(null)
  const [deleteOf, setDeleteOf] = useState<AgentContract | null>(null)
  const lastCreate = useRef(createSignal.n)

  useEffect(() => {
    if (createSignal.page === 'instructions' && createSignal.n > lastCreate.current) {
      lastCreate.current = createSignal.n
      setTab('library')
      setEditing({ open: true, contract: null })
    }
  }, [createSignal])

  const localCount = state.contracts.filter((c) => !contractSyncEnabled(state.repo, c)).length
  const attention = state.contractProjections.filter(
    (p) => p.status === 'stale' || p.status === 'drifted',
  ).length
  const globalAttention = state.globalProjections.filter(
    (p) => p.status === 'stale' || p.status === 'drifted',
  ).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = state.contracts.filter((c) => {
      if (folderFilter && !folderMatches(c.folder, folderFilter)) return false
      if (scopeFilter !== 'all' && c.scope !== scopeFilter) return false
      if (targetFilter !== 'all' && !c.targets.includes(targetFilter)) return false
      if (q) {
        const hay = [c.title, c.description, c.body, c.tags.join(' '), c.path ?? '', c.folder ?? '']
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          return b.priority - a.priority
        case 'title':
          return a.title.localeCompare(b.title, 'en')
        default:
          return b.updatedAt.localeCompare(a.updatedAt)
      }
    })
  }, [state.contracts, query, folderFilter, scopeFilter, targetFilter, sortBy])

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null
  const hasFilter =
    !!query.trim() || !!folderFilter || scopeFilter !== 'all' || targetFilter !== 'all'
  const deleteProjections = deleteOf
    ? state.contractProjections.filter((p) => p.contractId === deleteOf.id).length
    : 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'library', label: 'Contracts', count: state.contracts.length },
            { value: 'preview', label: 'Resolution preview' },
            { value: 'projections', label: 'Project projections', count: attention },
            { value: 'global', label: 'Global dispatch', count: globalAttention },
          ]}
          value={tab}
          onChange={(v) => setTab(v as InstructionTab)}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Badge variant={state.repo.policies.contracts ? 'info' : 'outline'}>
            {state.repo.policies.contracts ? 'Git sync optional' : 'Git sync off'}
          </Badge>
          <span className="whitespace-nowrap">{localCount} local only · projection confirmed separately</span>
        </span>
      </div>

      {tab === 'library' && (
        <div className="flex min-h-0 flex-1">
          <FolderTree
            items={state.contracts}
            getFolder={(c) => c.folder}
            selected={folderFilter}
            onSelect={setFolderFilter}
            className="hidden w-[176px] shrink-0 border-r border-border bg-card/40 xl:flex"
            title="Instruction folders"
          />
          <div className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background/40 xl:w-[400px]">
            {folderFilter && (
              <div className="flex items-center gap-1.5 border-b border-border bg-muted/25 px-4 py-1.5 text-[11px] text-muted-foreground">
                <Icon name="folder" className="h-3 w-3" />
                <span className="truncate text-foreground">{folderLabel(folderFilter)}</span>
                <button
                  type="button"
                  onClick={() => setFolderFilter('')}
                  className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                >
                  All folders
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-3">
              <Select className="h-8 flex-1 text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="updated">Last updated</option>
                <option value="priority">By priority</option>
                <option value="title">Title</option>
              </Select>
              <Select
                className="h-8 w-[104px] text-xs"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
                aria-label="Filter by scope"
              >
                <option value="all">All scopes</option>
                {(Object.keys(CONTRACT_SCOPE_META) as ContractScope[]).map((s) => (
                  <option key={s} value={s}>
                    {CONTRACT_SCOPE_META[s].short}
                  </option>
                ))}
              </Select>
              <Select
                className="h-8 w-[116px] text-xs"
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                aria-label="Filter by target"
              >
                <option value="all">All targets</option>
                {CONTRACT_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <ContractList
                contracts={filtered}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                hasFilter={hasFilter}
                onClearFilter={() => {
                  setFolderFilter('')
                  setScopeFilter('all')
                  setTargetFilter('all')
                }}
                onCreate={() => setEditing({ open: true, contract: null })}
              />
            </div>

            <div className="flex items-center gap-2 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
              <span className="tabular">{filtered.length} / {state.contracts.length} contracts</span>
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setFolderFilter('')
                    setScopeFilter('all')
                    setTargetFilter('all')
                  }}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
                >
                  Clear filters
                </button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                onClick={() => setEditing({ open: true, contract: null })}
                title="New contract (shortcut N)"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {selected ? (
              <ContractDetail
                contract={selected}
                onEdit={() => setEditing({ open: true, contract: selected })}
                onDelete={() => setDeleteOf(selected)}
                onShowVersions={() => setVersionOf(selected)}
                onSync={() => setSyncOf(selected)}
                onPreview={() => setTab('preview')}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Icon name="file" className="h-6 w-6" />
                Select a contract on the left to see details
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'preview' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ResolvedPreview />
        </div>
      )}

      {tab === 'projections' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ContractProjections />
        </div>
      )}

      {tab === 'global' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <GlobalDispatch query={query} />
        </div>
      )}

      <ContractEditModal
        open={editing.open}
        contract={editing.contract}
        onClose={() => setEditing({ open: false, contract: null })}
      />

      {syncOf && <ContractSyncModal open contract={syncOf} onClose={() => setSyncOf(null)} />}

      {versionOf && (
        <VersionHistoryModal
          open
          onClose={() => setVersionOf(null)}
          title={`Version history — ${versionOf.title}`}
          versions={versionOf.versions.map((v) => ({
            ...v,
            data: { content: formatContractSnapshot(v.data.content) },
          }))}
          fields={[{ key: 'content', label: 'Contract content (metadata + body)' }]}
          onRestore={(v) => {
            restoreContractVersion(versionOf.id, v.id)
            toast.success(`Restored v${v.version}; current content was saved as a new version`)
          }}
          onDeleteVersion={(vid) => {
            deleteContractVersion(versionOf.id, vid)
            toast.success('Version deleted')
          }}
          restoreHint="Restoring writes to the local library and marks the change as outgoing, and marks affected projections as Stale; Agent directories are never overwritten automatically."
        />
      )}

      <ConfirmDialog
        open={!!deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={() => {
          if (deleteOf) {
            deleteContract(deleteOf.id)
            setSelectedId(null)
            toast.success(`Deleted "${deleteOf.title}"`)
          }
        }}
        title="Delete instruction contract?"
        message={
          <>
            Deletes "<b className="text-foreground">{deleteOf?.title}</b>" and all {deleteOf?.versions.length ?? 0} of its versions. This cannot be undone.
            {deleteOf && contractSyncEnabled(state.repo, deleteOf) && (
              <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning">
                This contract is part of repo sync. Only the local copy is deleted; repo files are untouched. If the remote still has the file, it will reappear on the next pull.
              </p>
            )}
            {deleteProjections > 0 && (
              <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning">
                Projected to {deleteProjections} targets. Deleting the local contract does not delete files already written to Agent directories; remove them individually in Project projections.
              </p>
            )}
          </>
        }
      />
    </div>
  )
}
