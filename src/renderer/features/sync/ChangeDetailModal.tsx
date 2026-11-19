import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SyncChangeDetail, SyncFileDiff } from '../../../shared/contracts'
import { Badge, Button, Checkbox, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  CHANGE_META,
  CHANGE_STATUS_META,
  DIRECTION_META,
  KIND_META,
  RISK_META,
  errorDetailLines,
  formatLines,
  syncVersionLine,
} from '../../lib/viewModels/sync'

function DiffColumn({ title, content, emptyLabel }: { title: string; content: string | null; emptyLabel: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground">{formatLines(content)}</span>
      </div>
      {content === null ? (
        <div className="flex min-h-32 items-center justify-center px-3 py-6 text-center text-[11px] text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <pre className="max-h-72 min-h-32 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11px] leading-5">
          {content}
        </pre>
      )}
    </div>
  )
}

function FileDiffView({ file }: { file: SyncFileDiff }) {
  if (file.mediaKind === 'binary') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Icon name="file" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <p className="font-medium text-foreground">Binary file</p>
          <p className="mt-0.5 leading-5">
            Binary content is not returned to the interface. Review it in the repository before approving.
          </p>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="grid gap-2 lg:grid-cols-3">
        <DiffColumn title="Base (last sync)" content={file.base} emptyLabel="No base version." />
        <DiffColumn title="Local library" content={file.local} emptyLabel="Not present locally." />
        <DiffColumn title="Remote repository" content={file.remote} emptyLabel="Not present remotely." />
      </div>
      {file.truncated && (
        <p className="text-[11px] leading-5 text-warning">
          Content was truncated by the backend because the file exceeds the preview limit.
        </p>
      )}
    </>
  )
}

export function ChangeDetailModal({
  changeId,
  onClose,
}: {
  changeId: string | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [fileIndex, setFileIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [invalidated, setInvalidated] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const detailQuery = useQuery({
    queryKey: queryKeys.sync.change(changeId ?? ''),
    queryFn: () => ipc.sync.changeDetail({ changeId: changeId ?? '' }),
    enabled: !!changeId,
  })

  const detail = detailQuery.data

  useEffect(() => {
    setFileIndex(0)
    setError(null)
    setDetails([])
    setInvalidated(false)
    setConfirmed(false)
  }, [changeId])

  const review = useMutation({
    mutationFn: ({ target, decision }: { target: SyncChangeDetail; decision: 'approve' | 'dismiss' }) =>
      ipc.sync.review({
        changeIds: [target.id],
        decision,
        expectedFingerprints: { [target.id]: target.fingerprint },
        reviewTokens: { [target.id]: target.reviewToken },
      }),
  })

  async function submit(decision: 'approve' | 'dismiss'): Promise<void> {
    if (!detail) return
    setError(null)
    setDetails([])
    setInvalidated(false)
    try {
      const result = await review.mutateAsync({ target: detail, decision })
      if (result.invalidated.includes(detail.id)) {
        setInvalidated(true)
        setError('Remote content changed since this preview opened. Reload the change and review it again.')
        await detailQuery.refetch()
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['sync'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      toast.success(
        decision === 'approve'
          ? 'Change approved. Select approved incoming changes to pull them into the local library.'
          : 'Change dismissed. It will not be pulled until remote content changes.',
      )
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
      if (isIpcError(caught) && caught.code === 'VALIDATION') {
        const structured = caught.details
        if (structured?.kind === 'review-invalidated') {
          setInvalidated(true)
          await detailQuery.refetch()
        }
        if (structured?.kind === 'per-item-required') {
          setError(
            'The backend requires this item to be reviewed on its own. Keep this dialog open, review the full content, and try again.',
          )
        }
      }
    }
  }

  const files = detail?.files ?? []
  const activeFile = files.length > 0 ? files[Math.min(fileIndex, files.length - 1)] : null
  const kindMeta = detail ? KIND_META[detail.kind] : null
  const directionMeta = detail ? DIRECTION_META[detail.direction] : null
  const statusMeta = detail ? CHANGE_STATUS_META[detail.status] : null
  const canReview =
    !!detail &&
    detail.direction === 'incoming' &&
    detail.status !== 'resolved' &&
    detail.status !== 'dismissed'
  const requiresAcknowledgement =
    !!detail &&
    (detail.kind === 'prompt' || detail.kind === 'contract' || detail.risk.length > 0)

  return (
    <Modal
      open={!!changeId}
      onClose={onClose}
      width="max-w-6xl"
      title={detail ? `${kindMeta?.label ?? 'Change'} · ${detail.assetName}` : 'Change detail'}
      subtitle={
        detail
          ? `${CHANGE_META[detail.change].label} · ${detail.path}`
          : 'Loading the three-way comparison and review token…'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {canReview && (
            <>
              <Button
                variant="outline"
                onClick={() => void submit('dismiss')}
                disabled={review.isPending}
              >
                Dismiss
              </Button>
              <Button onClick={() => void submit('approve')} disabled={review.isPending || (requiresAcknowledgement && !confirmed)}>
                {review.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
                {review.isPending ? 'Reviewing…' : 'Approve change'}
              </Button>
            </>
          )}
        </>
      }
    >
      {detailQuery.isLoading && (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Loading change detail…
        </div>
      )}

      {detailQuery.isError && (
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

      {detail && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {kindMeta && <Badge variant={kindMeta.tone}>{kindMeta.label}</Badge>}
            {directionMeta && (
              <Badge variant={directionMeta.tone}>
                <Icon name={directionMeta.icon} className="h-3 w-3" />
                {directionMeta.label}
              </Badge>
            )}
            <Badge variant={CHANGE_META[detail.change].tone}>{CHANGE_META[detail.change].label}</Badge>
            {statusMeta && <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>}
            {detail.risk.map((risk) => (
              <Badge key={risk} variant={RISK_META[risk].tone}>
                <Icon name={RISK_META[risk].icon} className="h-3 w-3" />
                {RISK_META[risk].label}
              </Badge>
            ))}
            {detail.blocked && <Badge variant="danger">Push blocked</Badge>}
            <span className={cn('text-[11px]', 'text-muted-foreground')}>{syncVersionLine(detail)}</span>
            <span className="text-[11px] text-success">+{detail.additions}</span>
            <span className="text-[11px] text-danger">−{detail.deletions}</span>
          </div>

          {detail.summary && (
            <p className="text-xs leading-5 text-muted-foreground">{detail.summary}</p>
          )}

          {detail.blocked && detail.blockReason && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">Push is blocked</p>
                <p className="mt-0.5 leading-5">{detail.blockReason}</p>
                <p className="mt-0.5 leading-5">
                  Replace real credentials with {'{{variable}}'} in Prompts or instructions, or ${'{'}VAR{'}'} in MCP
                  env and headers. The scanner never rewrites content automatically.
                </p>
              </div>
            </div>
          )}

          {detail.risk.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detail.risk.map((risk) => (
                <span
                  key={risk}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] leading-4 text-muted-foreground"
                >
                  {RISK_META[risk].description}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-info">
            <Icon name="eye" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Content is redacted: credentials are never shown, and only placeholders appear in previews. Comparing
              base, local, and remote explains exactly what each side changed.
            </span>
          </div>

          {canReview && requiresAcknowledgement && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
              <Checkbox
                checked={confirmed}
                onChange={setConfirmed}
                label={
                  <span className="text-[11px] leading-5 text-warning">
                    {detail.kind === 'prompt' || detail.kind === 'contract'
                      ? 'I have previewed the full content and confirm it is safe and contains no private information of mine.'
                      : 'I have reviewed the files and understand that scripts or network commands may run on this machine.'}
                  </span>
                }
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <p className="font-medium">{error}</p>
              {details.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                  {details.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {invalidated && (
                <p className="mt-1 leading-5">
                  The review token was invalidated. The dialog stays open so the refreshed content can be reviewed.
                </p>
              )}
            </div>
          )}

          {files.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {files.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setFileIndex(index)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1 font-mono text-[10.5px] transition-colors',
                    index === fileIndex
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {file.path}
                </button>
              ))}
            </div>
          )}

          {activeFile ? <FileDiffView file={activeFile} /> : (
            <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              No file content is available for this change.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <span>Created {formatDate(detail.createdAt)}</span>
            <span>Updated {formatDate(detail.updatedAt)}</span>
            {detail.reviewedAt && <span>Reviewed {formatDate(detail.reviewedAt)}</span>}
            <span className="break-all">
              Fingerprint <code className="font-mono">{detail.fingerprint}</code>
            </span>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Review token
            </div>
            <code className="mt-0.5 block break-all font-mono text-[11px] text-foreground">
              {detail.reviewToken}
            </code>
            <p className="mt-1 text-[10.5px] leading-5 text-muted-foreground">
              The review is bound to this token and fingerprint. If the remote content changes, the approval is
              invalidated and must be repeated.
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}
