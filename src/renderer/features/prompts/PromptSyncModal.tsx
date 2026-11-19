import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDetail, SyncPolicy } from '../../../shared/contracts'
import { Badge, Button, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { useToast } from '../../components/ui/toast'
import { syncStateMeta } from '../../lib/viewModels/assetStatus'
import { promptRepositoryPath } from '../../lib/viewModels/prompt'

const OPTIONS: Array<{ value: SyncPolicy; title: string; description: string }> = [
  {
    value: 'inherit',
    title: 'Follow repository policy',
    description:
      'Participates in Git sync only while Prompt sync is enabled for the connected repository.',
  },
  {
    value: 'sync',
    title: 'Participate in sync',
    description:
      'Opts this Prompt into Git sync. Requires a connected repository with Prompt sync enabled.',
  },
  {
    value: 'local',
    title: 'Local only',
    description:
      'Never enters Git and never creates pending pushes. Repository files are not deleted.',
  },
]

export function PromptSyncModal({
  open,
  onClose,
  prompt,
}: {
  open: boolean
  onClose: () => void
  prompt: PromptDetail
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [policy, setPolicy] = useState<SyncPolicy>(prompt.syncPolicy)
  const [withdrawn, setWithdrawn] = useState<string[]>([])

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setPolicy(prompt.syncPolicy)
    setWithdrawn([])
  }, [open, prompt.id, prompt.syncPolicy])

  const repo = bootstrap.data?.repo ?? null
  const connected = !!repo
  const repoPromptSync = repo?.policies.prompts ?? false
  const previewEffective = policy !== 'local' && connected && repoPromptSync
  const switchingToLocal = policy === 'local' && prompt.syncPolicy !== 'local'
  const currentSync = syncStateMeta(prompt.syncState)

  const mutation = useMutation({
    mutationFn: (next: SyncPolicy) =>
      ipc.prompts.setSyncPolicy({ id: prompt.id, syncPolicy: next }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts'] })
      setPolicy(result.syncPolicy)
      if (result.withdrawnChangeIds.length > 0) {
        setWithdrawn(result.withdrawnChangeIds)
        toast.warning(
          `${result.withdrawnChangeIds.length} pending sync change(s) were withdrawn. Repository files were not deleted.`,
        )
        return
      }
      toast.success(
        result.syncPolicy === 'local'
          ? 'This Prompt is now local only. Future edits create no pending pushes.'
          : result.syncPolicy === 'sync'
            ? 'This Prompt participates in sync. Pushes still require confirmation in the Sync Center.'
            : 'This Prompt now follows the repository policy.',
      )
      onClose()
    },
    onError: (error) => {
      toast.error(`Sync scope not saved: ${errorMessage(error)}`)
    },
  })

  const done = withdrawn.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={`Sync policy — ${prompt.title}`}
      subtitle="Prompts travel between machines only through Git. They are never written to Agent directories."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate(policy)} disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
              Save policy
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5">
          <Badge variant={previewEffective ? 'info' : 'outline'}>
            {previewEffective ? 'In sync scope' : 'Local only'}
          </Badge>
          <Badge variant={currentSync.tone}>
            Current: {currentSync.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {connected
              ? repoPromptSync
                ? 'Repository connected · Prompt sync enabled'
                : 'Repository connected · Prompt sync disabled'
              : 'No repository connected'}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {bootstrap.isLoading ? 'Checking repository policy…' : `Effective today: ${prompt.effectiveSync ? 'synced' : 'local only'}`}
          </span>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const disabled =
              option.value === 'sync' && (!connected || !repoPromptSync)
            const active = policy === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled || mutation.isPending || done}
                onClick={() => setPolicy(option.value)}
                aria-pressed={active}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-primary bg-primary' : 'border-input',
                  )}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {option.title}
                    {option.value === 'local' && (
                      <Badge variant="outline">Recommended for private Prompts</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {option.description}
                    {disabled
                      ? ' Enable Prompt sync in the repository settings first.'
                      : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Repository file</div>
          <div className="mt-0.5 break-all font-mono text-xs">
            {promptRepositoryPath(prompt)}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Metadata and variable definitions live in frontmatter; the body is split into System and
            User sections. Variable values are never written to disk.
          </p>
        </div>

        {switchingToLocal && !done && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Switching to local only withdraws any unprocessed pending changes for this Prompt.
              Repository files are not deleted, so the remote copy stays as it is.
            </span>
          </div>
        )}

        {done && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon name="undo" className="h-3.5 w-3.5" />
              {withdrawn.length} pending change(s) withdrawn
            </div>
            <ul className="mt-1.5 space-y-0.5 font-mono text-[10.5px]">
              {withdrawn.map((id) => (
                <li key={id} className="break-all">
                  {id}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 font-sans">
              These entries no longer appear in the Sync Center. The repository file was not
              modified.
            </p>
          </div>
        )}

        {!connected && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            <Icon name="cloud" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No repository is connected. Your choice is saved as a preference and takes effect after a
            repository connection.
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Sync is not dispatch: this Prompt is never written to an Agent directory. For rule-like
          content, use the Agent Instructions workspace.
        </div>
      </div>
    </Modal>
  )
}
