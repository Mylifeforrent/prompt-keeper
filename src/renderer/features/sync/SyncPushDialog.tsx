import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ScanFinding, SyncChangeSummary } from '../../../shared/contracts'
import { Badge, Button, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { useToast } from '../../components/ui/toast'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { CHANGE_META, KIND_META, errorDetailLines } from '../../lib/viewModels/sync'

export interface PushSecurityBlock {
  message: string
  findings: ScanFinding[]
}

export function PushSecurityBlockDialog({
  block,
  onClose,
}: {
  block: PushSecurityBlock | null
  onClose: () => void
}) {
  return (
    <Modal
      open={!!block}
      onClose={onClose}
      width="max-w-2xl"
      title="Push blocked by the credential scan"
      subtitle="The commit was not created. Findings are redacted; replace each value and push again."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {block && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{block.message}</span>
          </div>
          {block.findings.length > 0 ? (
            <div className="rounded-lg border border-border">
              {block.findings.map((finding, index) => (
                <div
                  key={`${finding.ruleId}-${index}`}
                  className="border-b border-border/60 px-3 py-2 text-xs last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={finding.confidence === 'high' ? 'danger' : 'warning'}>
                      {finding.confidence} confidence
                    </Badge>
                    <span className="font-mono text-[11px]">
                      {finding.path ?? 'content'}
                      {finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ''}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {finding.preview}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Replace with <span className="font-mono">{finding.replacement}</span>.
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              The scanner blocked the push but returned no redacted locations. Review the selected assets for plaintext
              credentials before pushing again.
            </p>
          )}
          <p className="text-[11px] leading-5 text-muted-foreground">
            Real credential values never enter the repository or this dialog. Prompts and instructions use{' '}
            {'{{variable}}'}; MCP env and headers use ${'{'}VAR{'}'}. After replacing the values, review and push again.
          </p>
        </div>
      )}
    </Modal>
  )
}

export function SyncPushDialog({
  open,
  changes,
  onClose,
  onPushed,
}: {
  open: boolean
  changes: SyncChangeSummary[]
  onClose: () => void
  onPushed: () => void
}) {
  const toast = useToast()
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })
  const repo = bootstrap.data?.repo ?? null

  const [message, setMessage] = useState('')
  const [method, setMethod] = useState<'direct' | 'branch'>('branch')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [findings, setFindings] = useState<ScanFinding[]>([])

  useEffect(() => {
    if (!open) return
    setMessage('')
    setMethod(repo?.pushMode ?? 'branch')
    setError(null)
    setDetails([])
    setFindings([])
    // The repository mode only seeds the initial choice when the dialog opens.
  }, [open])

  const push = useMutation({
    mutationFn: (input: { changeIds: string[]; commitMessage: string; method: 'direct' | 'branch' }) =>
      ipc.sync.push(input),
  })

  async function submit(): Promise<void> {
    if (!message.trim() || changes.length === 0) return
    setError(null)
    setDetails([])
    setFindings([])
    try {
      await push.mutateAsync({
        changeIds: changes.map((change) => change.id),
        commitMessage: message.trim(),
        method,
      })
      toast.info('Push started. The operation panel shows progress; blocked findings never enter the commit.')
      onPushed()
      onClose()
    } catch (caught) {
      if (isIpcError(caught) && caught.code === 'SECURITY_BLOCK') {
        const structured = caught.details
        if (structured?.kind === 'security-block') setFindings(structured.findings)
      }
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={`Push to repository — ${changes.length} change${changes.length === 1 ? '' : 's'}`}
      subtitle={repo ? `${repo.url} · ${repo.branch}` : 'Repository'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={push.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!message.trim() || changes.length === 0 || push.isPending}
          >
            {push.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="arrowUp" />}
            {push.isPending ? 'Pushing…' : 'Push changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {changes.length === 0 ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              No outgoing changes are selected.
            </p>
          ) : (
            changes.map((change) => (
              <div
                key={change.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <Icon name={KIND_META[change.kind].icon} className="text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{change.assetName}</span>
                <Badge variant="secondary">{KIND_META[change.kind].label}</Badge>
                <Badge variant={CHANGE_META[change.change].tone}>{CHANGE_META[change.change].label}</Badge>
                <code className="ml-auto min-w-0 max-w-[45%] truncate font-mono text-[11px] text-muted-foreground">
                  {change.path}
                </code>
              </div>
            ))
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="push-commit-message">
            Commit message *
          </label>
          <Input
            id="push-commit-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="chore: sync assets from Prompt Keeper"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Required, trimmed, and must not be empty. Prompt Keeper never commits or pushes without this dialog.
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Push method</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: 'branch',
                  title: 'Separate branch',
                  description: 'Creates a branch for review. The current branch is not modified directly.',
                },
                {
                  value: 'direct',
                  title: 'Current branch',
                  description: 'Commits and pushes directly to the checked-out branch.',
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMethod(option.value)}
                aria-pressed={method === option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                  method === option.value
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-muted/60',
                )}
              >
                <Icon
                  name={option.value === 'branch' ? 'gitBranch' : 'arrowUp'}
                  className={cn(
                    'mt-0.5 h-4 w-4',
                    method === option.value ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span>
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {method === 'direct' && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
              Direct pushes write commits to the current branch. Prompt Keeper never force-pushes, amends, or rewrites
              remote history.
            </p>
          )}
        </div>

        {findings.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon name="lock" className="h-3.5 w-3.5" />
              Security scan blocked the push
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
              The scanner never rewrites content. Replace each value in the asset, then review and push again.
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

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Push rescans Prompt and instruction bodies plus MCP env and headers. The entire commit is blocked on
            plaintext credentials; only placeholders may enter the repository.{' '}
            {changes.length > 0
              ? `${changes.length} selected change${changes.length === 1 ? '' : 's'} will be fingerprinted again before commit.`
              : 'Select outgoing changes to push.'}
          </span>
        </div>
      </div>
    </Modal>
  )
}
