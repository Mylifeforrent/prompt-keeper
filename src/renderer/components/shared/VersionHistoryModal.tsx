import { useEffect, useMemo, useState } from 'react'
import type { RevisionSummary } from '../../../shared/contracts'
import { Badge, Button, Spinner } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { DiffView } from './DiffView'

export interface VersionFile {
  path: string
  content: string | null
}

/**
 * Shared revision history modal.
 *
 * History is append-only: every save creates an immutable revision and restoring
 * a historical revision creates a new revision. The API has no version delete
 * channel, so this dialog never offers a delete action.
 */
export function VersionHistoryModal({
  open,
  onClose,
  title,
  versions,
  currentRevisionId,
  currentFiles,
  onRestore,
  restorePending = false,
  loading = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  versions: RevisionSummary[]
  currentRevisionId?: string
  currentFiles?: VersionFile[]
  onRestore: (revisionId: string) => void | Promise<void>
  restorePending?: boolean
  loading?: boolean
}) {
  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  )
  const current = useMemo(
    () => sorted.find((revision) => revision.id === currentRevisionId) ?? sorted[0],
    [sorted, currentRevisionId],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'diff'>('preview')
  const [confirmRestore, setConfirmRestore] = useState<RevisionSummary | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedId(current?.id ?? null)
    setMode('preview')
    setConfirmRestore(null)
  }, [open, current?.id])

  const selected = sorted.find((revision) => revision.id === selectedId) ?? current
  const selectedFiles = selected?.files ?? []
  const referenceFiles = currentFiles ?? current?.files ?? []
  const isCurrent = !!selected && !!current && selected.id === current.id

  const selectedByPath = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const file of selectedFiles) map.set(file.path, file.content)
    return map
  }, [selectedFiles])

  const referenceByPath = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const file of referenceFiles) map.set(file.path, file.content)
    return map
  }, [referenceFiles])

  const diffPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const file of selectedFiles) paths.add(file.path)
    for (const file of referenceFiles) paths.add(file.path)
    return [...paths].sort((a, b) => a.localeCompare(b))
  }, [selectedFiles, referenceFiles])

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        subtitle="Each save creates an immutable revision. Restoring creates a new revision and never deletes existing history."
        width="max-w-3xl"
      >
        {loading && sorted.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Spinner className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Loading revision history…</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
            <Icon name="history" className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">No revisions yet</p>
            <p className="text-xs text-muted-foreground">The first save creates version 1.</p>
          </div>
        ) : (
          <div className="flex h-[460px] min-h-0 gap-4">
            <div className="w-52 shrink-0 space-y-1 overflow-y-auto pr-1">
              {sorted.map((revision) => {
                const active = revision.id === selected?.id
                const currentRevision = revision.id === current?.id
                return (
                  <button
                    key={revision.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(revision.id)
                      setMode('preview')
                    }}
                    aria-pressed={active}
                    className={cn(
                      'w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors',
                      active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      v{revision.version}
                      {currentRevision && (
                        <Badge variant="primary">
                          <Icon name="check" className="h-3 w-3" />
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDate(revision.createdAt)}
                    </div>
                    {revision.note && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {revision.note}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {selected && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-muted p-0.5">
                      {(
                        [
                          { value: 'preview', label: 'Version preview' },
                          { value: 'diff', label: 'Compare with current' },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMode(option.value)}
                          aria-pressed={mode === option.value}
                          className={cn(
                            'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            mode === option.value
                              ? 'bg-card text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {selected.note ? `Note: ${selected.note}` : null}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-3">
                    {mode === 'preview' ? (
                      selectedFiles.length === 0 ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          This revision entry does not include stored file content, so a preview is not
                          available.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {selectedFiles.map((file) => (
                            <section key={file.path}>
                              <div className="mb-1 break-all font-mono text-[10.5px] text-muted-foreground">
                                {file.path}
                              </div>
                              {file.content === null ? (
                                <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
                                  Binary content is not previewed.
                                </p>
                              ) : (
                                <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-5">
                                  {file.content || '(empty)'}
                                </pre>
                              )}
                            </section>
                          ))}
                        </div>
                      )
                    ) : selectedFiles.length === 0 ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        This revision has no stored text content, so it cannot be compared line by line.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {diffPaths.map((path) => {
                          const before = selectedByPath.get(path)
                          const after = referenceByPath.get(path)
                          if (before === undefined && after === undefined) return null
                          return (
                            <section key={path}>
                              <div className="mb-1 break-all font-mono text-[10.5px] text-muted-foreground">
                                {path}
                              </div>
                              {before === null || after === null ? (
                                <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
                                  Binary files are not compared.
                                </p>
                              ) : (
                                <DiffView before={before ?? ''} after={after ?? ''} />
                              )}
                            </section>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="mr-auto text-[11px] leading-4 text-muted-foreground">
                      History is append-only. Restoring v{selected.version} copies it into a new
                      revision; the current version is not deleted.
                    </span>
                    {!isCurrent && (
                      <Button
                        size="sm"
                        disabled={restorePending}
                        onClick={() => setConfirmRestore(selected)}
                      >
                        {restorePending ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <Icon name="history" className="h-3.5 w-3.5" />
                        )}
                        Restore this version
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => {
          if (confirmRestore) {
            void onRestore(confirmRestore.id)
          }
        }}
        title="Restore this version?"
        confirmText="Restore"
        danger={false}
        message={
          <>
            The current content is first saved as a new revision, then{' '}
            <b className="text-foreground">v{confirmRestore?.version}</b> is restored. No history is
            deleted, and restoring a synced Prompt creates a new pending change instead of pushing
            automatically.
          </>
        }
      />
    </>
  )
}
