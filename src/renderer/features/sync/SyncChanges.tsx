import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AssetKind,
  SyncChangeStatus,
  SyncChangeSummary,
  SyncDirection,
  SyncRisk,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import { errorDetails, errorMessage, events, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  CHANGE_META,
  CHANGE_STATUS_META,
  DIRECTION_META,
  KIND_META,
  RISK_META,
  canReviewChange,
  canSelectForPull,
  canSelectForPush,
  errorDetailLines,
  fingerprintsOf,
  syncVersionLine,
} from '../../lib/viewModels/sync'
import { ChangeDetailModal } from './ChangeDetailModal'
import { ConflictResolveModal } from './ConflictResolveModal'
import { PushSecurityBlockDialog, SyncPushDialog, type PushSecurityBlock } from './SyncPushDialog'

const PAGE_SIZE = 20

export function SyncChanges({ onManageRepository }: { onManageRepository?: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [direction, setDirection] = useState<'all' | SyncDirection>('all')
  const [status, setStatus] = useState<'pending' | SyncChangeStatus>('pending')
  const [kind, setKind] = useState<'all' | AssetKind>('all')
  const [risk, setRisk] = useState<'all' | SyncRisk>('all')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Record<string, SyncChangeSummary>>({})
  const [detailId, setDetailId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SyncChangeSummary | null>(null)
  const [pushOpen, setPushOpen] = useState(false)
  const [pushBlock, setPushBlock] = useState<PushSecurityBlock | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })
  const connected = !!bootstrap.data?.repo

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(0)
  }, [direction, status, kind, risk, blockedOnly, debouncedSearch])

  useEffect(() => {
    setSelected({})
    setActionError(null)
  }, [direction, status, kind, risk, blockedOnly, debouncedSearch, page])

  useEffect(() => {
    return events.onOperationCompleted((event) => {
      if (event.type !== 'sync_push' || event.error?.code !== 'SECURITY_BLOCK') return
      const structured = event.error.details
      setPushBlock({
        message: event.error.message,
        findings: structured?.kind === 'security-block' ? structured.findings : [],
      })
    })
  }, [])

  const query = useMemo(
    () => ({
      ...(direction === 'all' ? {} : { direction }),
      ...(status === 'pending' ? {} : { status }),
      ...(kind === 'all' ? {} : { kind }),
      ...(risk === 'all' ? {} : { risk }),
      ...(blockedOnly ? { blocked: true } : {}),
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [blockedOnly, debouncedSearch, direction, kind, page, risk, status],
  )

  const changes = useQuery({
    queryKey: queryKeys.sync.changes(query),
    queryFn: () => ipc.sync.changes(query),
    enabled: connected,
    placeholderData: keepPreviousData,
  })

  const pull = useMutation({
    mutationFn: (targets: SyncChangeSummary[]) =>
      ipc.sync.pull({
        changeIds: targets.map((change) => change.id),
        expectedFingerprints: fingerprintsOf(targets),
      }),
  })

  const rows = changes.data?.items ?? []
  const total = changes.data?.total ?? 0
  const pullSelected = Object.values(selected).filter(canSelectForPull)
  const pushSelected = Object.values(selected).filter(canSelectForPush)
  const hasFilters =
    direction !== 'all' ||
    status !== 'pending' ||
    kind !== 'all' ||
    risk !== 'all' ||
    blockedOnly ||
    debouncedSearch.trim().length > 0

  function toggle(change: SyncChangeSummary): void {
    setSelected((current) => {
      if (current[change.id]) {
        const next = { ...current }
        delete next[change.id]
        return next
      }
      return { ...current, [change.id]: change }
    })
  }

  async function pullApproved(): Promise<void> {
    if (pullSelected.length === 0) return
    setActionError(null)
    try {
      await pull.mutateAsync(pullSelected)
      toast.info(
        `Pull started for ${pullSelected.length} approved change${pullSelected.length === 1 ? '' : 's'}.`,
      )
      setSelected({})
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    } catch (caught) {
      setActionError(errorMessage(caught))
      for (const line of errorDetailLines(errorDetails(caught))) {
        toast.warning(line)
      }
      void changes.refetch()
    }
  }

  function resetFilters(): void {
    setDirection('all')
    setStatus('pending')
    setKind('all')
    setRisk('all')
    setBlockedOnly(false)
    setSearch('')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Sync is a three-way comparison between <b>remote</b>, <b>local</b>, and the <b>base</b> from the last merge.
          One-sided changes advance normally; when both sides change the same asset it becomes a conflict and is never
          overwritten silently.
        </span>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Search changes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search asset or path"
            className="h-8 w-56 text-xs"
          />
          <Select
            aria-label="Direction"
            className="w-36"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'all' | SyncDirection)}
          >
            <option value="all">All directions</option>
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
            <option value="conflict">Conflicts</option>
          </Select>
          <Select
            aria-label="Status"
            className="w-44"
            value={status}
            onChange={(event) => setStatus(event.target.value as 'pending' | SyncChangeStatus)}
          >
            <option value="pending">Pending (open + reviewed)</option>
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </Select>
          <Select
            aria-label="Asset kind"
            className="w-36"
            value={kind}
            onChange={(event) => setKind(event.target.value as 'all' | AssetKind)}
          >
            <option value="all">All asset types</option>
            <option value="prompt">Prompts</option>
            <option value="contract">Instructions</option>
            <option value="skill">Skills</option>
            <option value="mcp">MCP</option>
          </Select>
          <Select
            aria-label="Risk"
            className="w-32"
            value={risk}
            onChange={(event) => setRisk(event.target.value as 'all' | SyncRisk)}
          >
            <option value="all">Any risk</option>
            <option value="scripts">Scripts</option>
            <option value="secrets">Secrets</option>
            <option value="network">Network</option>
          </Select>
          <Checkbox
            checked={blockedOnly}
            onChange={setBlockedOnly}
            label={<span className="text-xs">Blocked only</span>}
          />
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              <Icon name="x" className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {changes.isFetching ? 'Refreshing…' : `${total} change${total === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <Button
            size="sm"
            onClick={() => void pullApproved()}
            disabled={pullSelected.length === 0 || pull.isPending}
          >
            {pull.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="arrowDown" className="h-3.5 w-3.5" />}
            Pull approved ({pullSelected.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPushOpen(true)}
            disabled={pushSelected.length === 0}
          >
            <Icon name="arrowUp" className="h-3.5 w-3.5" />
            Push selected ({pushSelected.length})
          </Button>
          {(pullSelected.length > 0 || pushSelected.length > 0) && (
            <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
              Clear selection
            </Button>
          )}
          <span className="text-[11px] leading-5 text-muted-foreground">
            Prompts and instructions are approved one item at a time. Pull applies only approved changes.
          </span>
        </div>
        {actionError && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="cursor-pointer text-danger/70 hover:text-danger"
              aria-label="Dismiss error"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {!connected ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name="gitBranch" className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">No repository is connected</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            Local editing and dispatch work without a repository. Connect one in Overview to review remote changes,
            push local changes, and resolve conflicts.
          </p>
          {onManageRepository && (
            <Button className="mt-4" variant="outline" onClick={onManageRepository}>
              Open Overview
            </Button>
          )}
        </div>
      ) : changes.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Loading changes…
        </div>
      ) : changes.isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-6 text-center text-xs text-danger">
          <p className="font-medium">{errorMessage(changes.error)}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void changes.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name={hasFilters ? 'filter' : 'check'} className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">
            {hasFilters ? 'No changes match these filters' : 'No pending changes'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            {hasFilters
              ? 'Relax or clear the filters to see the full change set.'
              : 'Differences appear here after a fetch. Open and reviewed changes are pending; resolved and dismissed changes are hidden.'}
          </p>
          {hasFilters && (
            <Button className="mt-4" variant="outline" size="sm" onClick={resetFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              selected={!!selected[change.id]}
              onToggle={() => toggle(change)}
              onOpen={() => setDetailId(change.id)}
              onPush={() => {
                setSelected({ [change.id]: change })
                setPushOpen(true)
              }}
              onResolve={() => setConflict(change)}
            />
          ))}
        </div>
      )}

      {changes.data && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–
            {Math.min(total, page * PAGE_SIZE + rows.length)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              <Icon name="chevronLeft" className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => current + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
            >
              Next
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ChangeDetailModal changeId={detailId} onClose={() => setDetailId(null)} />

      <SyncPushDialog
        open={pushOpen}
        changes={pushSelected}
        onClose={() => setPushOpen(false)}
        onPushed={() => setSelected({})}
      />

      <PushSecurityBlockDialog block={pushBlock} onClose={() => setPushBlock(null)} />

      <ConflictResolveModal
        change={conflict}
        onClose={() => setConflict(null)}
        onResolved={() => {
          setSelected({})
          void queryClient.invalidateQueries({ queryKey: ['sync'] })
          void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
        }}
      />
    </div>
  )
}

function ChangeRow({
  change,
  selected,
  onToggle,
  onOpen,
  onPush,
  onResolve,
}: {
  change: SyncChangeSummary
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onPush: () => void
  onResolve: () => void
}) {
  const selectable = canSelectForPull(change) || canSelectForPush(change)
  const directionMeta = DIRECTION_META[change.direction]
  const kindMeta = KIND_META[change.kind]
  const changeMeta = CHANGE_META[change.change]
  const statusMeta = CHANGE_STATUS_META[change.status]

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-colors',
        change.direction === 'conflict'
          ? 'border-danger/30'
          : change.blocked
            ? 'border-danger/30 bg-danger-soft/20'
            : selected
              ? 'border-primary ring-2 ring-ring/15'
              : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex w-4 shrink-0 justify-center">
          {selectable ? (
            <Checkbox checked={selected} onChange={onToggle} />
          ) : change.direction === 'conflict' ? (
            <Icon name="alert" className="h-4 w-4 text-danger" />
          ) : change.blocked ? (
            <Icon name="lock" className="h-4 w-4 text-danger" />
          ) : (
            <Icon name="eye" className="h-4 w-4 text-info" />
          )}
        </div>

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name={kindMeta.icon} className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              className="cursor-pointer truncate text-sm font-medium hover:text-primary hover:underline"
            >
              {change.assetName}
            </button>
            <Badge variant={kindMeta.tone}>{kindMeta.label}</Badge>
            <Badge variant={changeMeta.tone}>{changeMeta.label}</Badge>
            <Badge variant={directionMeta.tone}>
              <Icon name={directionMeta.icon} className="h-3 w-3" />
              {directionMeta.label}
            </Badge>
            <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>
            {change.risk.map((entry) => (
              <Badge key={entry} variant={RISK_META[entry].tone}>
                <Icon name={RISK_META[entry].icon} className="h-3 w-3" />
                {RISK_META[entry].label}
              </Badge>
            ))}
            {change.blocked && <Badge variant="danger">Push blocked</Badge>}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{syncVersionLine(change)}</span>
            <span>·</span>
            <span className="text-success">+{change.additions}</span>
            <span className="text-danger">−{change.deletions}</span>
            <span>·</span>
            <span>updated {relativeTime(change.updatedAt)}</span>
          </div>

          {change.summary && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{change.summary}</p>
          )}

          {change.blocked && change.blockReason && (
            <p className="mt-1 text-[11px] leading-5 text-danger">{change.blockReason}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono">
              {change.path}
            </code>
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {change.direction === 'incoming' && canReviewChange(change) && (
            <Button size="sm" variant="outline" onClick={onOpen}>
              <Icon name="eye" className="h-3.5 w-3.5" />
              Review
            </Button>
          )}
          {change.direction === 'outgoing' && !change.blocked && (
            <Button size="sm" variant="outline" onClick={onPush}>
              <Icon name="arrowUp" className="h-3.5 w-3.5" />
              Push
            </Button>
          )}
          {change.direction === 'conflict' && (
            <Button size="sm" variant="danger" onClick={onResolve}>
              <Icon name="alert" className="h-3.5 w-3.5" />
              Resolve
            </Button>
          )}
          {change.direction !== 'incoming' && change.direction !== 'conflict' && change.blocked && (
            <Button size="sm" variant="outline" onClick={onOpen}>
              <Icon name="eye" className="h-3.5 w-3.5" />
              Details
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
