import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ConflictResolutionResult,
  ScanFinding,
  SyncChangeSummary,
  SyncFileDiff,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Spinner, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  KIND_META,
  RISK_META,
  errorDetailLines,
  formatLines,
  validateMergedFile,
} from '../../lib/syncView'

const STRATEGIES = [
  {
    value: 'take-remote',
    title: 'Take the repository version',
    icon: 'download' as const,
    description: 'Replaces the local revision with remote content. Local changes are discarded.',
  },
  {
    value: 'keep-local',
    title: 'Keep the local version',
    icon: 'arrowUp' as const,
    description: 'Keeps local content and creates a pending outgoing change so you can push it back.',
  },
  {
    value: 'manual',
    title: 'Merge manually',
    icon: 'pencil' as const,
    description: 'Edit the merged result file by file, write it locally, and queue it for push.',
  },
] as const

type Strategy = (typeof STRATEGIES)[number]['value']

function VersionColumn({ title, content, tone }: { title: string; content: string | null; tone: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className={cn('text-[11px] font-medium', tone)}>{title}</span>
        <span className="text-[10px] text-muted-foreground">{formatLines(content)}</span>
      </div>
      {content === null ? (
        <div className="flex min-h-28 items-center justify-center px-3 py-6 text-center text-[11px] text-muted-foreground">
          Not present in this version.
        </div>
      ) : (
        <pre className="max-h-60 min-h-28 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11px] leading-5">
          {content}
        </pre>
      )}
    </div>
  )
}

function binaryNotice(file: SyncFileDiff): boolean {
  return file.mediaKind === 'binary'
}

export function ConflictResolveModal({
  change,
  onClose,
  onResolved,
}: {
  change: SyncChangeSummary | null
  onClose: () => void
  onResolved: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [strategy, setStrategy] = useState<Strategy>('take-remote')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [merged, setMerged] = useState<Record<string, string>>({})
  const [activePath, setActivePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [findings, setFindings] = useState<ScanFinding[]>([])
  const [result, setResult] = useState<ConflictResolutionResult | null>(null)

  const detailQuery = useQuery({
    queryKey: queryKeys.sync.change(change?.id ?? ''),
    queryFn: () => ipc.sync.changeDetail({ changeId: change?.id ?? '' }),
    enabled: !!change,
  })
  const detail = detailQuery.data

  useEffect(() => {
    if (!change) return
    setStrategy('take-remote')
    setConfirmDiscard(false)
    setMerged({})
    setActivePath('')
    setError(null)
    setDetails([])
    setFindings([])
    setResult(null)
  }, [change?.id])

  useEffect(() => {
    if (!detail) return
    const next: Record<string, string> = {}
    for (const file of detail.files) {
      if (file.mediaKind !== 'text' || file.remote === null) continue
      next[file.path] = file.local ?? file.remote ?? file.base ?? ''
    }
    setMerged(next)
    setActivePath(Object.keys(next)[0] ?? '')
  }, [detail?.id])

  const textFiles = useMemo(
    () =>
      (detail?.files ?? []).filter(
        (file) => file.mediaKind === 'text' && file.remote !== null,
      ),
    [detail],
  )

  const activeFile = textFiles.find((file) => file.path === activePath) ?? textFiles[0] ?? null

  const validationError = useMemo(() => {
    if (strategy !== 'manual') return null
    for (const file of textFiles) {
      const problem = validateMergedFile(file.path, merged[file.path] ?? '')
      if (problem) return problem
    }
    return null
  }, [merged, strategy, textFiles])

  const resolve = useMutation({
    mutationFn: (input: {
      changeId: string
      expectedFingerprint: string
      strategy: Strategy
      mergedFiles?: Array<{ path: string; content: string }>
      confirm?: boolean
    }) => ipc.sync.conflictResolve(input),
  })

  async function apply(): Promise<void> {
    if (!detail) return
    setError(null)
    setDetails([])
    setFindings([])
    try {
      const response = await resolve.mutateAsync({
        changeId: detail.id,
        expectedFingerprint: detail.fingerprint,
        strategy,
        ...(strategy === 'manual'
          ? {
              mergedFiles: textFiles.map((file) => ({
                path: file.path,
                content: merged[file.path] ?? '',
              })),
            }
          : {}),
        ...(strategy === 'take-remote' ? { confirm: true } : {}),
      })
      setResult(response)
      void queryClient.invalidateQueries()
      toast.success(
        strategy === 'take-remote'
          ? 'Conflict resolved with the repository version.'
          : strategy === 'keep-local'
            ? 'Conflict resolved. A pending outgoing change is ready to push.'
            : 'Manual merge written. A pending outgoing change is ready to push.',
      )
      onResolved()
    } catch (caught) {
      if (isIpcError(caught) && caught.code === 'SECURITY_BLOCK') {
        const structured = caught.details
        if (structured?.kind === 'security-block') setFindings(structured.findings)
      }
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  const canApply =
    !!detail &&
    !resolve.isPending &&
    !result &&
    (strategy !== 'take-remote' || confirmDiscard) &&
    (strategy !== 'manual' || (!validationError && textFiles.length > 0))

  return (
    <Modal
      open={!!change}
      onClose={onClose}
      width="max-w-5xl"
      title={change ? `Resolve conflict — ${change.assetName}` : 'Resolve conflict'}
      subtitle={change ? `${KIND_META[change.kind].label} · Both sides changed the same asset` : undefined}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={resolve.isPending}>
              Later
            </Button>
            <Button onClick={() => void apply()} disabled={!canApply}>
              {resolve.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
              {resolve.isPending ? 'Applying…' : 'Apply and mark resolved'}
            </Button>
          </>
        )
      }
    >
      {detailQuery.isLoading && !result && (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Loading the three-way comparison…
        </div>
      )}

      {detailQuery.isError && !result && (
        <div className="space-y-3">
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
            <p className="font-medium">{errorMessage(detailQuery.error)}</p>
            {errorDetailLines(errorDetails(detailQuery.error)).map((line) => (
              <p key={line} className="mt-1 leading-5">
                {line}
              </p>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {detail && !result && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Base (last sync)</div>
              <div className="mt-0.5 text-sm font-semibold text-muted-foreground">
                {detail.baseVersion ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Repository version</div>
              <div className="mt-0.5 text-sm font-semibold text-info">{detail.remoteVersion ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Local version</div>
              <div className="mt-0.5 text-sm font-semibold text-warning">{detail.localVersion ?? '—'}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {detail.risk.map((risk) => (
              <Badge key={risk} variant={RISK_META[risk].tone}>
                <Icon name={RISK_META[risk].icon} className="h-3 w-3" />
                {RISK_META[risk].label}
              </Badge>
            ))}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{detail.path}</code>
            <span className="text-[11px] text-muted-foreground">
              +{detail.additions} / −{detail.deletions}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {STRATEGIES.map((option) => {
              const disabled = option.value === 'manual' && textFiles.length === 0
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStrategy(option.value)}
                  disabled={disabled}
                  aria-pressed={strategy === option.value}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    disabled && 'cursor-not-allowed opacity-50',
                    strategy === option.value
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <Icon name={option.icon} className="h-3.5 w-3.5" />
                    {option.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {option.description}
                  </div>
                </button>
              )
            })}
          </div>

          {textFiles.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {textFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1 font-mono text-[10.5px]',
                    activeFile?.path === file.path
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {file.path}
                </button>
              ))}
            </div>
          )}

          {activeFile && (
            <div className="grid gap-2 lg:grid-cols-3">
              <VersionColumn title="Base (last sync)" content={activeFile.base} tone="text-muted-foreground" />
              <VersionColumn title="Local library" content={activeFile.local} tone="text-warning" />
              <VersionColumn title="Remote repository" content={activeFile.remote} tone="text-info" />
            </div>
          )}

          {strategy === 'take-remote' && activeFile && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <div className="flex items-center gap-1.5 font-medium">
                <Icon name="alert" className="h-3.5 w-3.5" />
                Local changes will be discarded
              </div>
              <p className="mt-1 leading-5">
                Taking the repository version replaces the local revision. Related Agent projections are marked stale.
              </p>
              <div className="mt-2">
                <Checkbox
                  checked={confirmDiscard}
                  onChange={setConfirmDiscard}
                  label={
                    <span className="text-[11px] leading-5">
                      I understand that local changes will be discarded.
                    </span>
                  }
                />
              </div>
            </div>
          )}

          {strategy === 'keep-local' && activeFile && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              Keeping local content creates a pending outgoing change. Push it from Changes to update the repository.
            </div>
          )}

          {strategy === 'manual' && activeFile && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="conflict-merged-content"
                >
                  Merged result for <span className="font-mono">{activeFile.path}</span>
                </label>
                <span className="text-[10px] text-muted-foreground">
                  {formatLines(merged[activeFile.path] ?? '')}
                </span>
              </div>
              <Textarea
                id="conflict-merged-content"
                rows={14}
                value={merged[activeFile.path] ?? ''}
                onChange={(event) =>
                  setMerged((current) => ({ ...current, [activeFile.path]: event.target.value }))
                }
                className="font-mono text-xs leading-5"
              />
              <p className={cn('mt-1 text-[11px] leading-5', validationError ? 'text-danger' : 'text-muted-foreground')}>
                {validationError ??
                  'The merge starts from the local version. Prompt merges must keep frontmatter and both System / User headings; instruction merges must keep frontmatter and a non-empty body.'}
              </p>
            </div>
          )}

          {strategy === 'manual' && textFiles.length === 0 && (
            <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              No text files are available for a manual merge. Choose a different strategy.
            </p>
          )}

          {detail.files.some(binaryNotice) && (
            <p className="text-[11px] leading-5 text-muted-foreground">
              Binary files cannot be edited here. They follow the chosen strategy as a whole.
            </p>
          )}

          {findings.length > 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <div className="flex items-center gap-1.5 font-medium">
                <Icon name="lock" className="h-3.5 w-3.5" />
                The merged result contains credentials
              </div>
              <ul className="mt-1 space-y-1 leading-5">
                {findings.map((finding, index) => (
                  <li key={`${finding.ruleId}-${index}`}>
                    <span className="font-mono">
                      {finding.path ?? 'content'}
                      {finding.line ? `:${finding.line}` : ''}
                    </span>{' '}
                    — {finding.preview}. Replace with {finding.replacement}.
                  </li>
                ))}
              </ul>
              <p className="mt-1 leading-5">
                Remove the real values from the merged content, then apply again.
              </p>
            </div>
          )}

          {error && findings.length === 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <p className="font-medium">{error}</p>
              {details.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                  {details.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 text-xs text-success">
            <Icon name="circleCheck" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">Conflict resolved</p>
              <p className="mt-0.5 leading-5">
                Strategy: {result.strategy === 'take-remote' ? 'take repository' : result.strategy === 'keep-local' ? 'keep local' : 'manual merge'}.
              </p>
            </div>
          </div>

          <dl className="divide-y divide-border/60 rounded-lg border border-border px-3">
            <div className="flex items-baseline gap-3 py-2 text-xs">
              <dt className="w-40 shrink-0 text-muted-foreground">Local revision</dt>
              <dd className="break-all font-mono">{result.localRevisionId ?? 'No new revision'}</dd>
            </div>
            <div className="flex items-baseline gap-3 py-2 text-xs">
              <dt className="w-40 shrink-0 text-muted-foreground">Outgoing change</dt>
              <dd className="break-all font-mono">{result.outgoingChangeId ?? 'None created'}</dd>
            </div>
            <div className="flex items-baseline gap-3 py-2 text-xs">
              <dt className="w-40 shrink-0 text-muted-foreground">Resolved</dt>
              <dd>{result.resolved ? 'Yes' : 'No'}</dd>
            </div>
          </dl>

          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            {result.strategy === 'take-remote'
              ? 'The local library now matches the repository version. Related Agent projections are marked stale; nothing is dispatched automatically.'
              : 'The result is written to the local library and queued as an outgoing change. Push it from Changes to update the repository.'}
          </p>

          {error && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
