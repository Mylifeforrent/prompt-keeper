import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ContractDetail, SyncPolicy } from '../../../shared/contracts'
import { Badge, Button } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  SYNC_POLICY_META,
  contractRepositoryPath,
  syncStateMeta,
} from '../../lib/contractView'

const OPTIONS: SyncPolicy[] = ['inherit', 'sync', 'local']

export function ContractSyncModal({
  open,
  contract,
  onClose,
}: {
  open: boolean
  contract: ContractDetail
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [policy, setPolicy] = useState<SyncPolicy>(contract.syncPolicy)

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 60_000,
    enabled: open,
  })

  useEffect(() => {
    if (open) setPolicy(contract.syncPolicy)
  }, [open, contract.syncPolicy])

  const state = syncStateMeta(contract)
  const repo = bootstrap.data?.repo ?? null
  const policyEnabled = repo?.policies.contracts ?? false

  const saveMutation = useMutation({
    mutationFn: () => ipc.contracts.setSyncPolicy({ id: contract.id, syncPolicy: policy }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['projections'] })
      void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
      void queryClient.invalidateQueries({ queryKey: ['globalTargets'] })
      void queryClient.invalidateQueries({ queryKey: ['sync'] })
      const withdrawn = result.withdrawnChangeIds.length
      toast.success(
        `Sync policy for "${contract.title}" is now ${SYNC_POLICY_META[result.syncPolicy].short.toLowerCase()}.` +
          (withdrawn > 0
            ? ` ${withdrawn} pending change${withdrawn === 1 ? '' : 's'} withdrawn; repository files are untouched.`
            : ''),
      )
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={`Sync policy — ${contract.title}`}
      subtitle="Instruction contracts travel between machines only through Git. Projection to Agent directories is controlled separately."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Icon name="check" />
            {saveMutation.isPending ? 'Saving…' : 'Save policy'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5">
          <Badge variant={contract.effectiveSync ? 'info' : 'outline'}>
            {contract.effectiveSync ? 'Participating in sync' : 'Local only right now'}
          </Badge>
          <Badge variant={state.variant}>{state.label}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {repo
              ? policyEnabled
                ? 'Repository connected · contract sync enabled'
                : 'Repository connected · contract sync disabled'
              : 'No repository connected'}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {contract.currentVersion ? `v${contract.currentVersion}` : ''}
          </span>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const meta = SYNC_POLICY_META[option]
            const active = policy === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => setPolicy(option)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
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
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {meta.label}
                    {option === 'local' && <Badge variant="outline">Private content</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {meta.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Repository file</div>
          <div className="mt-0.5 break-all font-mono text-xs">
            {contractRepositoryPath(contract.folder, contract.slug)}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Frontmatter holds folder, scope, activation, priority, imports, and targets; the body is the rule
            content. Tool-generated files must not become a second source of truth.
          </p>
        </div>

        {policy === 'local' && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Setting this contract to local only withdraws its unprocessed pending changes. Existing repository
            files are untouched and can reappear on the next pull.
          </div>
        )}

        {!repo && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            <Icon name="cloud" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No repository is connected. The policy is stored locally and takes effect once a repository is
            connected and contract sync is enabled.
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Sync policy is metadata only: it does not create a revision and never writes to AGENTS.md, CLAUDE.md,
          .cursor/rules, or any Agent directory.
        </div>
      </div>
    </Modal>
  )
}
