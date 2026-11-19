import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SkillDetail,
  SkillImportPreview,
  SkillImportResult,
  SkillListItem,
  SkillQuery,
  SkillSource,
  SyncRisk,
} from '../../../shared/contracts'
import { flattenFolderTree } from '../../../shared/domain/folders'
import { Badge, Button, Checkbox, EmptyState, Input, Select, Spinner } from '../../components/ui/primitives'
import { ConfirmDialog, Modal } from '../../components/ui/modal'
import { FolderTree } from '../../components/shared/FolderTree'
import { VersionHistoryModal } from '../../components/shared/VersionHistoryModal'
import { useToast } from '../../components/ui/toast'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn } from '../../lib/cn'
import { formatBytes, formatDate } from '../../lib/format'
import {
  SCRIPT_ACK_NOTICE,
  categoryOptions,
  isScriptFile,
  riskMeta,
  skillSourceMeta,
} from '../../lib/viewModels/skill'
import { syncStateMeta } from '../../lib/viewModels/assetStatus'
import type { WorkspaceProps } from '../../app/navigation'
import { SkillDetailView } from './SkillDetail'
import { SkillEditModal } from './SkillEditModal'

/**
 * The shared FolderTree and VersionHistoryModal speak the FolderNode and
 * RevisionSummary contracts, so this workspace consumes them directly.
 */

// Survives remounts so returning to the tab does not reopen an old create dialog.
let lastHandledCreate = 0

interface SkillsWorkspaceProps extends WorkspaceProps {
  focus: { id: string; n: number } | null
}

const SOURCE_OPTIONS: Array<{ value: SkillSource | 'all'; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'local', label: 'Local' },
  { value: 'official', label: 'Official' },
  { value: 'community', label: 'Community' },
  { value: 'import', label: 'Imported' },
  { value: 'scan', label: 'Scanned' },
]

export function SkillsWorkspace({
  query,
  createSignal,
  focus,
}: SkillsWorkspaceProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [folder, setFolder] = useState('')
  const [source, setSource] = useState<SkillSource | 'all'>('all')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<SkillDetail | null>(null)
  const [deleting, setDeleting] = useState<SkillDetail | null>(null)
  const [versionsOf, setVersionsOf] = useState<SkillDetail | null>(null)

  const effectiveSearch = search.trim() || query.trim()

  const listInput: SkillQuery = {
    search: effectiveSearch || undefined,
    folder: folder || undefined,
    includeDescendants: true,
    source: source === 'all' ? undefined : source,
    category: category || undefined,
    sort: 'updated',
    order: 'desc',
    limit: 200,
  }

  const listQuery = useQuery({
    queryKey: queryKeys.skills.list(listInput),
    queryFn: () => ipc.skills.list(listInput),
  })

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])
  const total = listQuery.data?.total ?? 0
  const folders = useMemo(() => listQuery.data?.folders ?? [], [listQuery.data])
  const folderPaths = useMemo(
    () => flattenFolderTree(folders).map((node) => node.path),
    [folders],
  )
  const categories = useMemo(() => {
    const values = new Set(categoryOptions(items))
    if (category) values.add(category)
    return [...values].sort((a, b) => a.localeCompare(b, 'en'))
  }, [items, category])

  const detailQuery = useQuery({
    queryKey: queryKeys.skills.detail(selectedId ?? 'none'),
    queryFn: () => {
      if (!selectedId) return Promise.reject(new Error('No Skill selected'))
      return ipc.skills.get(selectedId)
    },
    enabled: !!selectedId,
  })

  useEffect(() => {
    if (createSignal.page !== 'skills' || createSignal.n <= lastHandledCreate) return
    lastHandledCreate = createSignal.n
    setCreating(true)
  }, [createSignal])

  useEffect(() => {
    if (!focus) return
    setFolder('')
    setSource('all')
    setCategory('')
    setSearch('')
    setSelectedId(focus.id)
  }, [focus])

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  const filtered = !!(effectiveSearch || folder || source !== 'all' || category)

  const clearFilters = () => {
    setFolder('')
    setSource('all')
    setCategory('')
    setSearch('')
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await ipc.skills.delete({ id: deleting.id, confirm: true })
      toast.success(
        `Deleted "${deleting.title}" from the local library. Agent installs and repository files remain.`,
      )
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden w-[190px] shrink-0 border-r border-border bg-card/40 xl:flex xl:flex-col">
        <FolderTree
          nodes={folders}
          selected={folder}
          onSelect={setFolder}
          totalCount={total}
          title="Skill folders"
        />
      </div>

      <div className="flex w-[330px] shrink-0 flex-col border-r border-border bg-background/40 xl:w-[350px]">
        <div className="shrink-0 space-y-2 border-b border-border px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Filter Skills"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter Skills…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button size="sm" onClick={() => setCreating(true)} title="New Skill (shortcut N)">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Select
              aria-label="Filter by source"
              className="min-w-0 flex-1"
              value={source}
              onChange={(event) => setSource(event.target.value as SkillSource | 'all')}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by category"
              className="min-w-0 flex-1"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span>
              <span className="tabular font-medium text-foreground">{items.length}</span> of {total}
            </span>
            {folder && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
                <Icon name="folder" className="h-3 w-3 shrink-0" />
                <span className="truncate">{folder}</span>
              </span>
            )}
            {filtered && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listQuery.isLoading && (
            <div className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" />
              Loading the local Skill library…
            </div>
          )}
          {listQuery.isError && (
            <div className="px-4 py-8 text-center">
              <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
              <p className="mt-2 text-xs font-medium">The Skill library could not be loaded</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {errorMessage(listQuery.error)}
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void listQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
            <EmptyState
              icon="grid"
              title={filtered ? 'No Skills match these filters' : 'No Skills yet'}
              description={
                filtered
                  ? 'Try another keyword, source, category, or folder.'
                  : 'Create a Skill, import a folder, or add one from the curated store.'
              }
              action={
                filtered ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    Create Skill
                  </Button>
                )
              }
            />
          )}
          {items.map((item) => (
            <SkillRow
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onSelect={() => setSelectedId(item.id)}
            />
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden bg-background/30">
        {detailQuery.isLoading && selectedId && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Loading Skill details…
          </div>
        )}
        {detailQuery.isError && selectedId && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon name="alert" className="h-6 w-6 text-danger" />
            <p className="text-sm font-medium">Skill details could not be loaded</p>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              {errorMessage(detailQuery.error)}
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void detailQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {detailQuery.data && (
          <SkillDetailView
            skill={detailQuery.data}
            onEdit={() => setEditing(detailQuery.data ?? null)}
            onDelete={() => setDeleting(detailQuery.data ?? null)}
            onVersions={() => setVersionsOf(detailQuery.data ?? null)}
          />
        )}
        {!selectedId && !detailQuery.isLoading && (
          <EmptyState
            icon="layers"
            title="Select a Skill"
            description="Pick a Skill from the list to review its files, install status, and version history."
          />
        )}
      </div>

      <SkillEditModal
        open={creating || !!editing}
        skill={editing}
        folderOptions={folderPaths}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={(saved) => {
          setSelectedId(saved.id)
          setCreating(false)
          setEditing(null)
        }}
      />

      {versionsOf && <SkillVersionsModal skill={versionsOf} onClose={() => setVersionsOf(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this Skill?"
        confirmText="Delete local copy"
        message={
          <>
            <p>
              This deletes only the local copy of{' '}
              <b className="text-foreground">{deleting?.title}</b> and withdraws its pending sync changes.
            </p>
            <p className="mt-2">
              Agent installs are not removed, and the repository directory is not deleted. If the Skill is
              still present remotely, it may reappear on the next pull.
            </p>
          </>
        }
      />
    </div>
  )
}

function SkillRow({
  item,
  active,
  onSelect,
}: {
  item: SkillListItem
  active: boolean
  onSelect: () => void
}) {
  const sourceMeta = skillSourceMeta(item.source)
  const syncMeta = syncStateMeta(item.syncState)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full cursor-pointer border-b border-border/60 px-3.5 py-2.5 text-left transition-colors',
        active ? 'bg-primary-soft/40 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-sm">
          {item.icon || item.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{item.title}</span>
        <Badge variant="secondary" className="shrink-0 font-normal">
          v{item.versionLabel}
        </Badge>
        <Badge variant={sourceMeta.variant} className="shrink-0 font-normal">
          {sourceMeta.label}
        </Badge>
      </div>
      <p className="mt-0.5 truncate pl-9 text-[11px] text-muted-foreground">
        {item.description || 'No description'}
      </p>
      <div className="mt-1 flex items-center gap-1.5 overflow-hidden pl-9 text-[10px] text-muted-foreground">
        <Icon name="folder" className="h-3 w-3 shrink-0" />
        <span className="truncate">{item.folder || 'Uncategorized'}</span>
        {item.installSummary.drifted > 0 && (
          <Badge variant="danger" className="shrink-0 font-normal">
            {item.installSummary.drifted} drifted
          </Badge>
        )}
        {item.installSummary.stale > 0 && (
          <Badge variant="warning" className="shrink-0 font-normal">
            {item.installSummary.stale} stale
          </Badge>
        )}
        {item.installSummary.synced > 0 && (
          <Badge variant="success" className="shrink-0 font-normal">
            {item.installSummary.synced} synced
          </Badge>
        )}
        {item.pendingChangeCount > 0 && (
          <Badge variant="warning" className="shrink-0 font-normal">
            pending
          </Badge>
        )}
        <Badge variant={syncMeta.tone} className="shrink-0 font-normal">
          {syncMeta.label}
        </Badge>
        <span className="tabular ml-auto shrink-0">{formatDate(item.updatedAt, false)}</span>
      </div>
    </button>
  )
}

function SkillVersionsModal({ skill, onClose }: { skill: SkillDetail; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [restoring, setRestoring] = useState(false)

  const versions = useQuery({
    queryKey: queryKeys.skills.versions(skill.id),
    queryFn: () => ipc.skills.versions(skill.id),
  })

  const restore = async (revisionId: string) => {
    setRestoring(true)
    try {
      await ipc.skills.restoreVersion({
        id: skill.id,
        revisionId,
        expectedRevisionId: skill.currentRevisionId,
      })
      toast.success(
        'Version restored as a new revision. Agent installs are now stale and are not rewritten automatically.',
      )
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      onClose()
    } catch (error) {
      toast.error(`Restore failed: ${errorMessage(error)}`)
    } finally {
      setRestoring(false)
    }
  }

  if (versions.isLoading) {
    return (
      <Modal open onClose={onClose} title={`Version history — ${skill.title}`} width="max-w-md">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Loading version history…
        </div>
      </Modal>
    )
  }

  if (versions.isError) {
    return (
      <Modal
        open
        onClose={onClose}
        title={`Version history — ${skill.title}`}
        width="max-w-md"
        footer={
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="text-xs leading-5 text-danger">
          Version history could not be loaded: {errorMessage(versions.error)}
        </p>
      </Modal>
    )
  }

  return (
    <VersionHistoryModal
      open
      onClose={onClose}
      title={`Version history — ${skill.title}`}
      versions={versions.data ?? []}
      currentRevisionId={skill.currentRevisionId}
      loading={versions.isLoading}
      restorePending={restoring}
      onRestore={(revisionId) => {
        if (restoring) return
        void restore(revisionId)
      }}
    />
  )
}

export function SkillImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<SkillImportPreview | null>(null)
  const [applied, setApplied] = useState<Extract<SkillImportResult, { phase: 'applied' }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [ackScripts, setAckScripts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startPreview = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPreview(null)
    setApplied(null)
    setAckScripts(false)
    try {
      const result = await ipc.skills.import({ pickFromDialog: true, confirm: false })
      if (result.phase === 'preview') setPreview(result)
      else setApplied(result)
    } catch (errorValue) {
      const message = errorMessage(errorValue)
      if (message.toLowerCase().includes('cancel')) {
        setError(null)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void startPreview()
  }, [open, startPreview])

  const scriptRisk =
    preview?.sources.some((source) => source.risk.includes('scripts') || source.files.some(isScriptFile)) ??
    false

  const apply = async () => {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      const result = await ipc.skills.import({
        sourcePaths: preview.sources.map((source) => source.sourcePath),
        confirm: true,
        previewToken: preview.previewToken,
        ...(scriptRisk ? { acknowledgeScripts: true } : {}),
      })
      if (result.phase === 'applied') {
        setApplied(result)
        setPreview(null)
        toast.success(
          `Imported ${result.imported.length} Skill${result.imported.length === 1 ? '' : 's'}. Review each one before installing.`,
        )
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
        void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
        void queryClient.invalidateQueries({ queryKey: ['search'] })
      } else {
        setPreview(result)
      }
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setApplying(false)
    }
  }

  const riskBadges = (risks: SyncRisk[]) =>
    risks.map((risk) => {
      const meta = riskMeta(risk)
      return (
        <Badge key={risk} variant={meta.variant}>
          {meta.label}
        </Badge>
      )
    })

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title="Import Skill folders"
      subtitle="Choose one or more Skill folders. Every file, script finding, and conflict is shown before anything enters the library."
      footer={
        <>
          <div className="mr-auto min-w-0">
            {error && <p className="truncate text-xs text-danger">{error}</p>}
          </div>
          {applied ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={loading || applying}
                onClick={() => void startPreview()}
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Choose again
              </Button>
              <Button
                disabled={
                  !preview || applying || preview.sources.length === 0 || (scriptRisk && !ackScripts)
                }
                onClick={() => void apply()}
              >
                {applying ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
                Import {preview ? `${preview.sources.length} folder${preview.sources.length === 1 ? '' : 's'}` : ''}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-4 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Waiting for the folder picker and scanning files…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
            Import preview failed: {error}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void startPreview()}>
              Try again
            </Button>
          </div>
        )}

        {applied && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-xs text-success">
              <Icon name="check" className="h-4 w-4" />
              Imported {applied.imported.length} Skill{applied.imported.length === 1 ? '' : 's'}.
            </p>
            {applied.imported.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <span className="font-medium">{skill.title}</span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {skill.folder || 'Uncategorized'}
                </span>
              </div>
            ))}
            {applied.skipped.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
                <p className="font-medium">Skipped</p>
                <ul className="mt-1 space-y-0.5">
                  {applied.skipped.map((entry) => (
                    <li key={`${entry.sourcePath}-${entry.reason}`} className="truncate">
                      {entry.sourcePath}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {preview && !applied && (
          <>
            <p className="flex items-start gap-1.5 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">
              <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Nothing is written to the library until the import is confirmed. Scripts are stored and listed
              but never executed.
            </p>

            {preview.sources.map((source) => (
              <div key={source.sourcePath} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
                  <Icon name="folder" className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[12.5px] font-medium">{source.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                    {source.sourcePath}
                  </span>
                  {riskBadges(source.risk)}
                </div>
                <div className="px-3 py-2">
                  <div className="space-y-0.5">
                    {source.files.map((file) => (
                      <div key={file.path} className="flex items-center gap-2 font-mono text-[10.5px]">
                        <Icon name="file" className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{file.path}</span>
                        {file.isExecutable && <Badge variant="warning">exec</Badge>}
                        {isScriptFile(file) && <Badge variant="outline">script</Badge>}
                        <span className="tabular shrink-0 text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {source.findings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {source.findings.map((finding, index) => (
                        <div
                          key={`${finding.ruleId}-${index}`}
                          className="rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[10.5px] leading-4 text-danger"
                        >
                          <span className="font-medium">
                            {finding.ruleId} · {finding.confidence} confidence
                          </span>
                          <span className="ml-1 font-mono">{finding.preview}</span>
                          <span className="ml-1 text-muted-foreground">
                            (would be replaced with {finding.replacement})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {source.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-4 text-warning">
                      {source.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}

            {preview.conflicts.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
                <p className="font-medium">Skipped by the preview</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.conflicts.map((conflict) => (
                    <li key={conflict.sourcePath} className="truncate">
                      {conflict.sourcePath}: {conflict.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {scriptRisk && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2">
                <p className="flex items-start gap-1.5 text-[11px] leading-5 text-warning">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {SCRIPT_ACK_NOTICE}
                </p>
                <Checkbox
                  checked={ackScripts}
                  onChange={setAckScripts}
                  label={
                    <span className="text-[11px] leading-5">
                      I reviewed the script files and understand they are never executed.
                    </span>
                  }
                />
              </div>
            )}

            {preview.sources.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No importable Skill folder was selected.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
