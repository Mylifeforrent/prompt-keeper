import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DispatchAgent,
  DispatchCell,
  DispatchPreview,
  InstallMode,
  SkillDetail,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Spinner } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Markdown } from '../shared/Markdown'
import { useToast } from '../ui/toast'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn, copyToClipboard, formatDate } from '../../lib/utils'
import {
  SKILL_ENTRY_FILE,
  SCRIPT_ACK_NOTICE,
  dispatchStatusMeta,
  fileExtension,
  formatBytes,
  installSummaryParts,
  isScriptFile,
  riskMeta,
  skillRepoPath,
  skillSourceMeta,
  sortSkillFiles,
  syncStateMeta,
} from '../../lib/skillView'

export function SkillDetailView({
  skill,
  onEdit,
  onDelete,
  onVersions,
}: {
  skill: SkillDetail
  onEdit: () => void
  onDelete: () => void
  onVersions: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [installOpen, setInstallOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ agent: DispatchAgent; cell: DispatchCell } | null>(
    null,
  )
  const [rollbackTarget, setRollbackTarget] = useState<{ agent: DispatchAgent; cell: DispatchCell } | null>(
    null,
  )
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)

  const filesQuery = useQuery({
    queryKey: queryKeys.skills.files({ assetId: skill.id, includeContent: true }),
    queryFn: () => ipc.skills.files({ assetId: skill.id, includeContent: true }),
  })

  const matrixQuery = useQuery({
    queryKey: queryKeys.dispatch.matrix({ kinds: ['skill'] }),
    queryFn: () => ipc.dispatch.matrix({ kinds: ['skill'] }),
  })

  const dispatchQuery = useQuery({
    queryKey: queryKeys.dispatch.detail(skill.id),
    queryFn: () => ipc.dispatch.detail({ assetId: skill.id }),
  })

  const files = useMemo(() => sortSkillFiles(filesQuery.data?.files ?? []), [filesQuery.data])

  useEffect(() => {
    if (!files.length) return
    if (selectedFile && files.some((file) => file.path === selectedFile)) return
    const entry = files.find((file) => file.path === SKILL_ENTRY_FILE)
    setSelectedFile(entry?.path ?? files[0].path)
  }, [files, selectedFile])

  useEffect(() => {
    setRendered(false)
  }, [selectedFile])

  const repoPath = skillRepoPath(skill)
  const sourceMeta = skillSourceMeta(skill.source)
  const syncMeta = syncStateMeta(skill.syncState)

  const summaryParts = installSummaryParts(skill.installSummary)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  const matrixRow = matrixQuery.data?.rows.find((row) => row.assetId === skill.id)
  const cellByAgent = useMemo(() => {
    const map = new Map<string, DispatchCell>()
    for (const cell of dispatchQuery.data?.cells ?? []) map.set(cell.agentId, cell)
    for (const cell of matrixRow?.cells ?? []) if (!map.has(cell.agentId)) map.set(cell.agentId, cell)
    return map
  }, [dispatchQuery.data, matrixRow])

  const agentRows = useMemo(() => {
    const agents = matrixQuery.data?.agents
    if (agents?.length) {
      return agents.map((agent) => ({
        agent,
        cell: cellByAgent.get(agent.id),
      }))
    }
    return [...cellByAgent.values()].map((cell) => ({
      agent: {
        id: cell.agentId,
        name: cell.agentId,
        detected: true,
        supportsSkills: true,
        supportsMcp: false,
        skillDir: undefined,
      } satisfies DispatchAgent,
      cell,
    }))
  }, [matrixQuery.data, cellByAgent])

  const removeDispatch = useMutation({
    mutationFn: (agentId: string) =>
      ipc.dispatch.remove({ assetId: skill.id, agentIds: [agentId], confirm: true }),
    onSuccess: () => {
      toast.success('Remove started. The per-target result appears in the operation panel.')
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
    },
    onError: (error) => toast.error(`Remove failed: ${errorMessage(error)}`),
  })

  const rollbackDispatch = useMutation({
    mutationFn: (agentId: string) => ipc.dispatch.rollback({ assetId: skill.id, agentIds: [agentId] }),
    onSuccess: () => {
      toast.success('Rollback started. Only the Agent directory is affected.')
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
    },
    onError: (error) => toast.error(`Rollback failed: ${errorMessage(error)}`),
  })

  const resync = useMutation({
    mutationFn: () => ipc.dispatch.syncStale({ assetIds: [skill.id] }),
    onSuccess: () => {
      toast.success('Re-sync started. Stale targets are refreshed; drifted targets are skipped.')
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
    },
    onError: (error) => toast.error(`Re-sync failed: ${errorMessage(error)}`),
  })

  const copyRepoPath = async () => {
    const copied = await copyToClipboard(repoPath)
    if (copied) toast.success('Repository path copied to the clipboard.')
    else toast.error('The clipboard is not available in this window.')
  }

  const selectedEntry = files.find((file) => file.path === selectedFile)
  const omitted = filesQuery.data?.omitted.find((entry) => entry.path === selectedFile)
  const content = selectedFile ? filesQuery.data?.contents?.[selectedFile] : undefined
  const isMarkdown = selectedEntry ? fileExtension(selectedEntry.path) === 'md' : false

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/70 text-base">
              {skill.icon || skill.title.slice(0, 1).toUpperCase()}
            </span>
            <h2 className="truncate text-[17px] font-semibold leading-6 tracking-tight">{skill.title}</h2>
            <Badge variant="secondary">v{skill.versionLabel}</Badge>
            <Badge variant={sourceMeta.variant}>{sourceMeta.label}</Badge>
            <Badge variant={syncMeta.variant}>{syncMeta.label}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={onVersions}>
              <Icon name="history" className="h-3.5 w-3.5" />
              Versions ({skill.versionCount})
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete Skill"
              title="Delete Skill"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{skill.description || 'No description.'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Badge variant="secondary" className="gap-1 font-normal">
            <Icon name="folder" className="h-3 w-3" />
            {skill.folder || 'Uncategorized'}
          </Badge>
          <Icon name="gitBranch" className="h-3 w-3 shrink-0" />
          <span className="shrink-0">Repo entry</span>
          <code className="min-w-0 truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
            {repoPath}
          </code>
          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Copy repository path" onClick={() => void copyRepoPath()}>
            <Icon name="copy" className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => setInstallOpen(true)}>
            <Icon name="download" className="h-3.5 w-3.5" />
            Install to Agents
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resync.isPending || skill.installSummary.stale === 0}
            title={
              skill.installSummary.stale === 0
                ? 'No stale installs to re-sync'
                : 'Re-sync stale installs; drifted installs are skipped'
            }
            onClick={() => resync.mutate()}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', resync.isPending && 'animate-spin')} />
            Re-sync stale
          </Button>
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="primary" className="font-normal">
              #{tag}
            </Badge>
          ))}
          <span className="tabular ml-auto text-[10.5px] text-muted-foreground">
            Updated {formatDate(skill.updatedAt)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section className="grid gap-3 lg:grid-cols-[240px_1fr]">
          <div className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Icon name="layers" className="h-3.5 w-3.5" />
              Files ({files.length})
              <span className="tabular ml-auto normal-case tracking-normal">
                {formatBytes(totalBytes)}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {filesQuery.isLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" />
                  Loading files…
                </div>
              )}
              {filesQuery.isError && (
                <div className="px-2 py-3 text-xs leading-5 text-danger">
                  Files could not be loaded: {errorMessage(filesQuery.error)}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => void filesQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {files.map((file) => {
                const active = selectedFile === file.path
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedFile(file.path)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={file.path}
                  >
                    <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path}</span>
                    {file.isExecutable && <Badge variant="warning">exec</Badge>}
                    {isScriptFile(file) && !file.isExecutable && <Badge variant="outline">script</Badge>}
                    <span className="tabular shrink-0 text-[9.5px]">{formatBytes(file.size)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex min-w-0 min-h-[280px] flex-col rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {selectedFile ?? 'No file selected'}
              </span>
              {selectedEntry && (
                <span className="tabular text-[10px] text-muted-foreground">
                  {formatBytes(selectedEntry.size)}
                  {selectedEntry.isExecutable ? ' · executable' : ''}
                  {selectedEntry.mediaKind === 'binary' ? ' · binary' : ''}
                </span>
              )}
              {isMarkdown && content !== undefined && (
                <div className="inline-flex rounded-md bg-muted p-0.5">
                  {(
                    [
                      { value: false, label: 'Raw' },
                      { value: true, label: 'Rendered' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => setRendered(option.value)}
                      className={cn(
                        'cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium',
                        rendered === option.value
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!selectedEntry ? (
                <p className="text-xs text-muted-foreground">Select a file to preview it.</p>
              ) : omitted ? (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
                  This file is not shown to the renderer because it is{' '}
                  {omitted.reason === 'binary' ? 'binary' : 'too large'}. It is still stored in the
                  Skill revision and installed to Agents.
                </div>
              ) : content === undefined ? (
                <p className="text-xs text-muted-foreground">No text content is available for this file.</p>
              ) : rendered && isMarkdown ? (
                <Markdown text={content} className="text-[12px] leading-6" />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5">
                  {content}
                </pre>
              )}
            </div>
          </div>
        </section>

        <section className="mt-3 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Icon name="send" className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Install summary
            </span>
            <span className="text-[11px] text-muted-foreground">
              {summaryParts.length ? summaryParts.join(' · ') : 'Not installed on any Agent'}
            </span>
            {skill.installSummary.drifted > 0 && (
              <Badge variant="danger" className="ml-auto">
                Drifted installs need item-by-item review
              </Badge>
            )}
          </div>
          <div className="divide-y divide-border/60">
            {(matrixQuery.isLoading || dispatchQuery.isLoading) && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5" />
                Loading Agent status…
              </div>
            )}
            {(matrixQuery.isError || dispatchQuery.isError) && (
              <div className="px-3 py-3 text-xs leading-5 text-danger">
                Agent status could not be loaded:{' '}
                {errorMessage(matrixQuery.error ?? dispatchQuery.error)}
              </div>
            )}
            {agentRows.map(({ agent, cell }) => {
              const status = !agent.supportsSkills ? 'unsupported' : cell?.status ?? 'missing'
              const meta = dispatchStatusMeta(status)
              return (
                <div key={agent.id} className="flex items-start gap-2 px-3 py-2.5">
                  <Icon name="server" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-medium">{agent.name}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {cell?.mode && <Badge variant="secondary">{cell.mode}</Badge>}
                      {cell?.deployedVersion !== undefined && (
                        <span className="text-[10px] text-muted-foreground">v{cell.deployedVersion}</span>
                      )}
                      {!agent.detected && <Badge variant="outline">Not detected</Badge>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {cell?.targetPath ?? agent.skillDir ?? 'Target directory is resolved at install time'}
                    </div>
                    {status === 'drifted' && (
                      <p className="mt-1 text-[10.5px] leading-4 text-danger">
                        This directory was edited by hand. Bulk install and re-sync never overwrite drifted
                        targets; review the Agent directory first.
                      </p>
                    )}
                    {status === 'unsupported' && (
                      <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
                        This Agent does not support Skills.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {cell?.deployedVersion !== undefined && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRollbackTarget({ agent, cell })}
                        title="Restore the previous deployed version in the Agent directory"
                      >
                        Rollback
                      </Button>
                    )}
                    {status !== 'missing' && status !== 'unsupported' && cell?.targetPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => setRemoveTarget({ agent, cell })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {!matrixQuery.isLoading && !dispatchQuery.isLoading && agentRows.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No Agent targets are registered on this machine.
              </p>
            )}
          </div>
        </section>

        <section className="mt-3 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Author" value={skill.author || 'Not set'} />
            <Meta label="Category" value={skill.category || 'Not set'} />
            <Meta label="Revision" value={`v${skill.currentVersion} · ${skill.versionCount} total`} />
            <Meta label="Created" value={formatDate(skill.createdAt)} />
          </div>
        </section>
      </div>

      <SkillInstallModal open={installOpen} skill={skill} onClose={() => setInstallOpen(false)} />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) removeDispatch.mutate(removeTarget.agent.id)
        }}
        title="Remove this install?"
        confirmText="Remove install"
        message={
          <>
            This deletes the Skill directory managed for{' '}
            <b className="text-foreground">{removeTarget?.agent.name}</b> at{' '}
            <code className="break-all font-mono text-xs">{removeTarget?.cell.targetPath}</code>. The local
            library copy and the repository directory are not touched.
          </>
        }
      />

      <ConfirmDialog
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (rollbackTarget) rollbackDispatch.mutate(rollbackTarget.agent.id)
        }}
        title="Roll back this install?"
        confirmText="Roll back"
        danger={false}
        message={
          <>
            This restores the previous deployed version in{' '}
            <b className="text-foreground">{rollbackTarget?.agent.name}</b>. It only affects the Agent
            directory; the library and repository are unchanged.
          </>
        }
      />
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="truncate text-[11.5px] text-foreground/90" title={value}>
        {value}
      </div>
    </div>
  )
}

export function SkillInstallModal({
  open,
  skill,
  onClose,
}: {
  open: boolean
  skill: SkillDetail
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<InstallMode>('symlink')
  const [preview, setPreview] = useState<DispatchPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [ackScripts, setAckScripts] = useState(false)
  const [ackOverwrite, setAckOverwrite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  const matrixQuery = useQuery({
    queryKey: queryKeys.dispatch.matrix({ kinds: ['skill'] }),
    queryFn: () => ipc.dispatch.matrix({ kinds: ['skill'] }),
    enabled: open,
  })

  const detailQuery = useQuery({
    queryKey: queryKeys.dispatch.detail(skill.id),
    queryFn: () => ipc.dispatch.detail({ assetId: skill.id }),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    initialized.current = false
    setPreview(null)
    setAckScripts(false)
    setAckOverwrite(false)
    setError(null)
    setMode('symlink')
    setSelected([])
  }, [open])

  useEffect(() => {
    if (!open || initialized.current) return
    const agents = matrixQuery.data?.agents
    if (!agents) return
    initialized.current = true
    const detected = agents.filter((agent) => agent.supportsSkills && agent.detected).map((agent) => agent.id)
    setSelected(detected.length ? detected : agents.filter((agent) => agent.supportsSkills).map((agent) => agent.id))
  }, [open, matrixQuery.data])

  const selectionKey = selected.slice().sort().join(',')
  useEffect(() => {
    setPreview(null)
  }, [selectionKey, mode])

  const agents = matrixQuery.data?.agents ?? []
  const matrixRow = matrixQuery.data?.rows.find((row) => row.assetId === skill.id)
  const cellByAgent = useMemo(() => {
    const map = new Map<string, DispatchCell>()
    for (const cell of detailQuery.data?.cells ?? []) map.set(cell.agentId, cell)
    for (const cell of matrixRow?.cells ?? []) if (!map.has(cell.agentId)) map.set(cell.agentId, cell)
    return map
  }, [detailQuery.data, matrixRow])

  const toggle = (agentId: string) => {
    setSelected((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    )
  }

  const startPreview = async () => {
    if (!selected.length) return
    setPreviewing(true)
    setError(null)
    setPreview(null)
    try {
      const result = await ipc.dispatch.install({
        assetId: skill.id,
        agentIds: selected,
        mode,
        confirm: false,
      })
      if (result.phase === 'preview') setPreview(result)
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setPreviewing(false)
    }
  }

  const confirmInstall = async () => {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      await ipc.dispatch.install({
        assetId: skill.id,
        agentIds: selected,
        mode,
        confirm: true,
        previewToken: preview.previewToken,
        ...(preview.risk.includes('scripts') ? { acknowledgeScripts: true } : {}),
        ...(preview.targets.some((target) => target.conflict === 'external')
          ? { confirmOverwriteExternal: true }
          : {}),
      })
      toast.success('Install started. Progress and per-target results appear in the operation panel.')
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      onClose()
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setApplying(false)
    }
  }

  const scriptRisk = preview
    ? preview.risk.includes('scripts') ||
      preview.targets.some((target) => target.files.some(isScriptFile))
    : false
  const needsOverwrite = preview?.targets.some((target) => target.conflict === 'external') ?? false
  const driftedTargets = preview?.targets.filter((target) => target.conflict === 'drifted') ?? []
  const blockedByDrift = driftedTargets.length > 0
  const canConfirm =
    !!preview &&
    !blockedByDrift &&
    (!scriptRisk || ackScripts) &&
    (!needsOverwrite || ackOverwrite) &&
    !applying

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={`Install to Agents — ${skill.title}`}
      subtitle="Preview every target path and action before writing. Drifted targets are never overwritten in bulk."
      footer={
        <>
          <div className="mr-auto min-w-0">
            {error && <p className="truncate text-xs text-danger">{error}</p>}
            {blockedByDrift && !error && (
              <p className="truncate text-xs text-danger">
                Resolve drifted targets before installing.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button disabled={!canConfirm} onClick={() => void confirmInstall()}>
              {applying ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" className="h-3.5 w-3.5" />}
              Confirm install
            </Button>
          ) : (
            <Button disabled={!selected.length || previewing} onClick={() => void startPreview()}>
              {previewing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="eye" className="h-3.5 w-3.5" />}
              Preview install
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">Target Agents</h3>
            <span className="text-[11px] text-muted-foreground">{selected.length} selected</span>
          </div>
          {matrixQuery.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" />
              Loading Agent targets…
            </div>
          )}
          {matrixQuery.isError && (
            <p className="text-xs text-danger">Targets could not be loaded: {errorMessage(matrixQuery.error)}</p>
          )}
          <div className="space-y-1.5">
            {agents.map((agent) => {
              const cell = cellByAgent.get(agent.id)
              const status = !agent.supportsSkills ? 'unsupported' : cell?.status ?? 'missing'
              const meta = dispatchStatusMeta(status)
              const disabled = !agent.supportsSkills
              return (
                <label
                  key={agent.id}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                    disabled ? 'cursor-not-allowed border-border/60 opacity-70' : 'cursor-pointer border-border hover:bg-muted/40',
                    selected.includes(agent.id) && !disabled && 'border-primary/50 bg-primary-soft/40',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-current"
                    checked={selected.includes(agent.id)}
                    disabled={disabled}
                    onChange={() => toggle(agent.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-medium">{agent.name}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {!agent.detected && <Badge variant="outline">Not detected</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {cell?.targetPath ?? agent.skillDir ?? 'Resolved at install time'}
                    </span>
                  </span>
                </label>
              )
            })}
            {matrixQuery.isSuccess && agents.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No Agent Skill targets are registered on this machine.
              </p>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Install mode</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: 'symlink',
                  title: 'symlink (recommended)',
                  description: 'One shared directory; library edits take effect immediately.',
                },
                {
                  value: 'copy',
                  title: 'copy',
                  description: 'Each Agent gets an independent copy and must be re-installed after edits.',
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                  mode === option.value
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon
                    name={option.value === 'symlink' ? 'link' : 'copy'}
                    className={mode === option.value ? 'text-primary' : 'text-muted-foreground'}
                  />
                  {option.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {scriptRisk && (
          <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This Skill contains script-like files. {SCRIPT_ACK_NOTICE}
          </p>
        )}

        {preview && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground">Preview</h3>
              <Badge variant="outline">{preview.mode}</Badge>
              {preview.risk.map((risk) => {
                const meta = riskMeta(risk)
                return (
                  <Badge key={risk} variant={meta.variant}>
                    {meta.label}
                  </Badge>
                )
              })}
            </div>
            <div className="space-y-2">
              {preview.targets.map((target) => {
                const actionMeta =
                  target.action === 'create'
                    ? { label: 'Create', variant: 'success' as const }
                    : target.action === 'replace'
                      ? { label: 'Replace', variant: 'warning' as const }
                      : { label: 'No change', variant: 'outline' as const }
                return (
                  <div key={target.agentId} className="rounded-md border border-border bg-card px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium">{target.agentName}</span>
                      <Badge variant={actionMeta.variant}>{actionMeta.label}</Badge>
                      {target.conflict === 'external' && <Badge variant="warning">External directory</Badge>}
                      {target.conflict === 'drifted' && <Badge variant="danger">Drifted</Badge>}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {target.files.length} files
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {target.targetPath}
                    </div>
                    {target.warnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[10.5px] leading-4 text-warning">
                        {target.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>

            {blockedByDrift && (
              <p className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-[11px] leading-5 text-danger">
                {driftedTargets.length} target{driftedTargets.length === 1 ? '' : 's'} drifted after install.
                Bulk install never overwrites a drifted directory; remove that install or reconcile the Agent
                directory first.
              </p>
            )}

            <div className="space-y-2 pt-1">
              {scriptRisk && (
                <Checkbox
                  checked={ackScripts}
                  onChange={setAckScripts}
                  label={
                    <span className="text-[11px] leading-5">
                      I understand the script files are copied and listed but never executed.
                    </span>
                  }
                />
              )}
              {needsOverwrite && (
                <Checkbox
                  checked={ackOverwrite}
                  onChange={setAckOverwrite}
                  label={
                    <span className="text-[11px] leading-5">
                      I understand existing external directories will be replaced.
                    </span>
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
