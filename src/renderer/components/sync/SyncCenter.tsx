import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuditEvent, RepoStatus } from '../../../shared/contracts'
import { Badge, Button, Checkbox, Spinner } from '../ui/core'
import { ConfirmDialog } from '../ui/modal'
import { Tabs } from '../ui/tabs'
import { Icon } from '../../lib/icons'
import { cn, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  AUDIT_META,
  CLONE_MODE_LABEL,
  PUSH_MODE_LABEL,
  REPO_PROVIDER_LABEL,
  formatInterval,
  policySummary,
} from '../../lib/syncView'
import { RepoConnectModal, RepoEditModal } from './RepoConnectModal'
import { SyncChanges } from './SyncChanges'
import { SyncDeploy } from './SyncDeploy'
import { SyncHistory } from './SyncHistory'

type SyncTab = 'overview' | 'changes' | 'dispatch' | 'history'

const RESULT_TONE = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
} as const

export function SyncCenter() {
  const [tab, setTab] = useState<SyncTab>('overview')
  const [connectOpen, setConnectOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })
  const repoQuery = useQuery({
    queryKey: queryKeys.sync.repo,
    queryFn: () => ipc.sync.repoGet(),
  })

  const repo = repoQuery.data !== undefined ? repoQuery.data : (bootstrap.data?.repo ?? null)
  const pending = bootstrap.data?.pending

  const changesCount =
    (pending?.incoming ?? 0) + (pending?.outgoing ?? 0) + (pending?.conflicts ?? 0)
  const dispatchCount = (pending?.dispatchStale ?? 0) + (pending?.dispatchDrifted ?? 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'changes', label: 'Changes', count: changesCount },
            { value: 'dispatch', label: 'Dispatch', count: dispatchCount },
            { value: 'history', label: 'History' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as SyncTab)}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <Icon name="gitBranch" className="h-3.5 w-3.5 shrink-0" />
          {repo ? (
            <>
              <span className="max-w-[280px] truncate font-mono text-[10.5px]">
                {repo.url} · {repo.branch}
              </span>
              <Badge variant="success" className="shrink-0">
                Connected
              </Badge>
            </>
          ) : (
            <Badge variant="warning">No repository connected</Badge>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <SyncOverview
            repo={repo}
            repoLoading={repoQuery.isLoading}
            repoError={repoQuery.isError ? errorMessage(repoQuery.error) : null}
            onRetryRepo={() => void repoQuery.refetch()}
            pending={pending}
            detectedAgents={bootstrap.data?.detectedAgentIds ?? []}
            onOpenTab={setTab}
            onConnect={() => setConnectOpen(true)}
            onEdit={() => setEditOpen(true)}
            onDisconnect={() => setDisconnectOpen(true)}
          />
        )}
        {tab === 'changes' && <SyncChanges onManageRepository={() => setTab('overview')} />}
        {tab === 'dispatch' && <SyncDeploy />}
        {tab === 'history' && <SyncHistory />}
      </div>

      <RepoConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      {repo && <RepoEditModal open={editOpen} onClose={() => setEditOpen(false)} repo={repo} />}
      {repo && (
        <DisconnectDialog
          open={disconnectOpen}
          repo={repo}
          onClose={() => setDisconnectOpen(false)}
        />
      )}
    </div>
  )
}

function SyncOverview({
  repo,
  repoLoading,
  repoError,
  onRetryRepo,
  pending,
  detectedAgents,
  onOpenTab,
  onConnect,
  onEdit,
  onDisconnect,
}: {
  repo: RepoStatus | null
  repoLoading: boolean
  repoError: string | null
  onRetryRepo: () => void
  pending: { incoming: number; outgoing: number; conflicts: number; dispatchStale: number; dispatchDrifted: number } | undefined
  detectedAgents: string[]
  onOpenTab: (tab: SyncTab) => void
  onConnect: () => void
  onEdit: () => void
  onDisconnect: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const fetchRepo = useMutation({
    mutationFn: () => ipc.sync.fetch({}),
    onSuccess: () => {
      toast.info('Fetch started. Remote differences appear in Changes when it completes.')
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },
    onError: (error) => toast.error(`Fetch did not start: ${errorMessage(error)}`),
  })

  const recent = useQuery({
    queryKey: queryKeys.sync.history({ limit: 5 }),
    queryFn: () => ipc.sync.history({ limit: 5 }),
  })

  if (repoLoading && !repo) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
        <Icon name="refresh" className="h-4 w-4 animate-spin" />
        Reading repository status…
      </div>
    )
  }

  if (repoError && !repo) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
        <p className="mt-2 text-sm font-medium">Repository status could not be read</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{repoError}</p>
        <Button className="mt-4" variant="outline" onClick={onRetryRepo}>
          Retry
        </Button>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-5">
        <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon name="lock" className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-base font-semibold">Your library is local-first</h2>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            Prompts, instructions, Skills, and MCP servers live in a local database on this machine and keep working
            without a network. Connecting a Git repository is optional: it adds team sharing with reviewable
            three-way sync, and it never overwrites local edits automatically.
          </p>
          <div className="mx-auto mt-4 grid max-w-2xl gap-2 text-left sm:grid-cols-3">
            {[
              {
                icon: 'download' as const,
                title: 'Fetch is read-only',
                text: 'Remote differences are reported in Changes; nothing is merged on your behalf.',
              },
              {
                icon: 'shield' as const,
                title: 'Review before merge',
                text: 'Prompts and instructions are reviewed one item at a time. Credentials never enter Git.',
              },
              {
                icon: 'send' as const,
                title: 'Explicit dispatch',
                text: 'Agent directories are written only when you dispatch or project, and drift is never bulk-overwritten.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon name={item.icon} className="h-3.5 w-3.5 text-primary" />
                  {item.title}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>
          <Button className="mt-5" onClick={onConnect}>
            <Icon name="gitBranch" />
            Connect Git repository
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A four-step wizard previews the repository before anything is written.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Icon name="history" className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Recent activity</h3>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenTab('history')}>
              All history
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          </div>
          <RecentEvents events={recent.data?.items ?? []} loading={recent.isLoading} />
        </section>
      </div>
    )
  }

  const busy = !!repo.operation
  const dispatchPending = (pending?.dispatchStale ?? 0) + (pending?.dispatchDrifted ?? 0)

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-soft/70 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Icon name="gitBranch" className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="break-all text-base font-semibold">{repo.url}</h2>
                <Badge variant="secondary">{REPO_PROVIDER_LABEL[repo.provider]}</Badge>
                <Badge variant="outline">
                  <Icon name="gitBranch" className="h-3 w-3" />
                  {repo.branch}
                </Badge>
                <Badge variant={repo.security.blocked ? 'danger' : 'success'}>
                  <Icon name={repo.security.blocked ? 'lock' : 'shield'} className="h-3 w-3" />
                  {repo.security.blocked ? 'Push blocked' : 'Security clear'}
                </Badge>
                {busy && (
                  <Badge variant="info">
                    <Icon name="refresh" className="h-3 w-3 animate-spin" />
                    Operation running
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Last fetch {relativeTime(repo.lastFetchedAt)} · Last merge {relativeTime(repo.lastSyncedAt)} ·{' '}
                {CLONE_MODE_LABEL[repo.cloneMode]} · {repo.auth.mode === 'token'
                  ? `Access token ${repo.auth.hasToken ? 'stored' : 'not set'}`
                  : repo.auth.mode === 'ssh'
                    ? 'SSH key'
                    : 'System Git credentials'}
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{repo.localPath}</p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchRepo.mutate()}
                disabled={busy || fetchRepo.isPending}
              >
                {fetchRepo.isPending ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                )}
                Fetch now
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenTab('changes')} disabled={busy}>
                <Icon name="arrowUp" className="h-3.5 w-3.5" />
                Changes
              </Button>
              <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
                <Icon name="sliders" className="h-3.5 w-3.5" />
                Edit settings
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={onDisconnect}
                disabled={busy}
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="info">
              <Icon name="arrowUp" className="h-3 w-3" />
              Ahead {repo.ahead}
            </Badge>
            <Badge variant="warning">
              <Icon name="arrowDown" className="h-3 w-3" />
              Behind {repo.behind}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {PUSH_MODE_LABEL[repo.pushMode]} ·{' '}
              {repo.autoFetch ? `${formatInterval(repo.fetchIntervalMin)} (read-only)` : 'Manual fetch only'} ·{' '}
              {policySummary(repo.policies)}
            </span>
          </div>
        </div>
      </section>

      {repo.fetchError && (
        <section className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Fetch failed ({repo.fetchError.code})</div>
            <p className="mt-0.5 leading-5">{repo.fetchError.message}</p>
            {repo.fetchError.retryable && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => fetchRepo.mutate()}
                disabled={busy}
              >
                Retry fetch
              </Button>
            )}
          </div>
        </section>
      )}

      {repo.security.blocked && (
        <button
          type="button"
          onClick={() => onOpenTab('changes')}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-left"
        >
          <Icon name="lock" className="h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-danger">
              {repo.security.plaintextCredentialCount} plaintext credential
              {repo.security.plaintextCredentialCount === 1 ? '' : 's'} found; push is blocked
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              Replace real values with placeholders in Changes. The repository accepts only {'{{variable}}'} or{' '}
              ${'{'}VAR{'}'} references.
            </p>
          </div>
          <Icon name="chevronRight" className="ml-auto h-4 w-4 text-danger" />
        </button>
      )}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Incoming"
          value={pending?.incoming ?? 0}
          tone="info"
          hint="Review remote changes item by item"
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Outgoing"
          value={pending?.outgoing ?? 0}
          tone="warning"
          hint="Select changes to push"
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Conflicts"
          value={pending?.conflicts ?? 0}
          tone="danger"
          hint="Both sides changed the same asset"
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Dispatch pending"
          value={dispatchPending}
          tone="primary"
          hint={`${pending?.dispatchStale ?? 0} stale · ${pending?.dispatchDrifted ?? 0} drifted`}
          onClick={() => onOpenTab('dispatch')}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            {
              key: 'skills' as const,
              icon: 'grid' as const,
              title: 'Skills',
              badge: 'Two-way sync',
              description:
                'Written as skills/<folder>/<skill>/SKILL.md. Scripts travel with the Skill and are reviewed before dispatch.',
            },
            {
              key: 'mcp' as const,
              icon: 'server' as const,
              title: 'MCP',
              badge: 'Templates both ways',
              description:
                'Written as mcp/<folder>/<name>.json. Only placeholders enter the repository; real secrets stay local.',
            },
            {
              key: 'prompts' as const,
              icon: 'message' as const,
              title: 'Prompts',
              badge: 'Per-Prompt opt-in',
              description:
                'Written as prompts/<folder>/<slug>.prompt.md. Every remote change is previewed one at a time.',
            },
            {
              key: 'contracts' as const,
              icon: 'file' as const,
              title: 'Instructions',
              badge: 'Per-instruction opt-in',
              description:
                'Written as instructions/<folder>/<slug>.contract.md. Projection to Agents is a separate confirmed action.',
            },
          ] as const
        ).map((card) => {
          const enabled = repo.policies[card.key]
          return (
            <div key={card.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon name={card.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="text-[13px] font-semibold">{card.title}</span>
                <Badge variant={enabled ? 'primary' : 'outline'} className="ml-auto shrink-0 font-normal">
                  {enabled ? card.badge : 'Local only'}
                </Badge>
              </div>
              <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">{card.description}</p>
            </div>
          )
        })}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Icon name="folder" className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Repository layout</h3>
          </div>
          <div className="mt-2 divide-y divide-border/60">
            {(
              [
                { label: 'Prompts', path: repo.layout.prompts },
                { label: 'Instructions', path: repo.layout.contracts },
                { label: 'Skills', path: repo.layout.skills },
                { label: 'MCP', path: repo.layout.mcp },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex items-baseline gap-3 py-1.5 text-[11px]">
                <span className="w-20 shrink-0 text-muted-foreground">{row.label}</span>
                <code className="break-all font-mono">{row.path}</code>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">
            Folders map directly to repository directories. Edit the roots in repository settings.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Icon name="grid" className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Detected Agents</h3>
            <Badge variant="success">{detectedAgents.length} detected</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenTab('dispatch')}>
              Open dispatch
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Prompt Keeper writes only to tools it detects on this machine. Undetected tools never get empty
            directories. Re-check detection from the Dispatch tab.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detectedAgents.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No Agents detected yet.</span>
            ) : (
              detectedAgents.map((agentId) => (
                <Badge key={agentId} variant="outline" className="font-mono text-[10px]">
                  {agentId}
                </Badge>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="history" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Recent sync activity</h3>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenTab('history')}>
            All history
            <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
        <RecentEvents events={recent.data?.items ?? []} loading={recent.isLoading} />
      </section>
    </div>
  )
}

function RecentEvents({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
        <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" />
        Loading activity…
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <p className="py-3 text-[11px] text-muted-foreground">
        No sync activity yet. History records fetches, reviews, pushes, conflicts, dispatch, and security blocks.
      </p>
    )
  }
  return (
    <div className="mt-1 divide-y divide-border/60">
      {events.map((event) => {
        const meta = AUDIT_META[event.type]
        return (
          <div key={event.id} className="flex items-start gap-2.5 py-2">
            <Icon name={meta.icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{event.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {meta.label} · {formatEventTime(event.at)}
              </div>
            </div>
            <Badge variant={RESULT_TONE[event.result]} className="shrink-0">
              {event.result === 'success' ? 'Success' : event.result === 'warning' ? 'Attention' : 'Failed'}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}

function formatEventTime(iso: string): string {
  return relativeTime(iso)
}

function StatCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string
  value: number
  hint: string
  tone: 'info' | 'warning' | 'danger' | 'primary'
  onClick: () => void
}) {
  const toneClass = {
    info: 'text-info bg-info-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
    primary: 'text-primary bg-primary-soft',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-sm font-semibold',
            toneClass,
          )}
        >
          {value}
        </span>
        <span className="text-xs font-medium">{label}</span>
        <Icon name="chevronRight" className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>
    </button>
  )
}

function DisconnectDialog({
  open,
  repo,
  onClose,
}: {
  open: boolean
  repo: RepoStatus
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [deleteClone, setDeleteClone] = useState(false)

  useEffect(() => {
    if (open) setDeleteClone(false)
  }, [open])

  const disconnect = useMutation({
    mutationFn: () =>
      ipc.sync.repoDisconnect({
        confirm: true,
        ...(repo.cloneMode === 'managed' && deleteClone ? { deleteManagedClone: true } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      toast.success('Repository disconnected. Local assets, history, and dispatched files are kept.')
      onClose()
    },
    onError: (error) => toast.error(`Repository was not disconnected: ${errorMessage(error)}`),
  })

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => disconnect.mutate()}
      title="Disconnect repository?"
      confirmText="Disconnect"
      message={
        <div className="space-y-3">
          <p>
            This removes the sync relationship with <span className="font-medium text-foreground">{repo.url}</span>.
            Local assets, version history, and files already dispatched to Agents are not deleted. Sync resumes after
            reconnecting.
          </p>
          {repo.cloneMode === 'managed' ? (
            <Checkbox
              checked={deleteClone}
              onChange={setDeleteClone}
              label={
                <span className="text-xs">
                  Also delete the app-managed clone at <span className="font-mono">{repo.localPath}</span>
                </span>
              }
            />
          ) : (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              This repository uses a bound clone at <span className="font-mono">{repo.localPath}</span>. A bound clone
              is owned by you and is never deleted by Prompt Keeper.
            </p>
          )}
        </div>
      }
    />
  )
}
