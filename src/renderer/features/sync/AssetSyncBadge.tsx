import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AssetKind, AssetSyncState, SyncPolicy, SyncChangeSummary } from '../../../shared/contracts'
import { Badge } from '../../components/ui/primitives'
import { ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { policyKeyForKind } from '../../lib/viewModels/sync'
import { SYNC_STATE_META } from '../../lib/viewModels/assetStatus'
import { cn } from '../../lib/cn'

function stateForChanges(changes: SyncChangeSummary[]): AssetSyncState {
  const active = changes.filter(
    (change) => change.status !== 'dismissed' && change.status !== 'resolved',
  )
  if (active.some((change) => change.direction === 'conflict')) return 'conflict'
  if (active.some((change) => change.blocked)) return 'blocked'
  if (active.some((change) => change.direction === 'outgoing')) return 'outgoing'
  if (active.some((change) => change.direction === 'incoming')) return 'incoming'
  return 'in-sync'
}

/**
 * Sync status badge for asset detail and list views. It reads the same query
 * keys as the Sync Center so refreshes stay consistent across workspaces.
 */
export function AssetSyncBadge({
  kind,
  name,
  assetId,
  policy,
  compact = false,
  syncState,
}: {
  kind: AssetKind
  name: string
  assetId?: string
  policy?: SyncPolicy
  compact?: boolean
  syncState?: AssetSyncState
}) {
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })
  const repo = bootstrap.data?.repo ?? null
  const policyEnabled = repo ? repo.policies[policyKeyForKind(kind)] : false
  const enabled = !syncState && !!repo && policyEnabled && policy !== 'local'

  const changes = useQuery({
    queryKey: queryKeys.sync.changes({ kind, limit: 200 }),
    queryFn: () => ipc.sync.changes({ kind, limit: 200 }),
    enabled,
    staleTime: 15_000,
  })

  const resolvedState = useMemo<AssetSyncState | null>(() => {
    if (syncState) return syncState
    if (!bootstrap.data) return null
    if (!repo) return 'not-connected'
    if (!policyEnabled || policy === 'local') return 'local-only'
    if (changes.isError) return null
    if (!changes.data) return null
    const matching = changes.data.items.filter((change) =>
      assetId ? change.assetId === assetId : change.assetName === name,
    )
    return stateForChanges(matching)
  }, [assetId, bootstrap.data, changes.data, changes.isError, name, policy, policyEnabled, repo, syncState])

  if (!resolvedState) return null

  const meta = SYNC_STATE_META[resolvedState]
  if (compact) {
    if (resolvedState === 'not-connected') return null
    return (
      <Badge
        variant={meta.tone}
        title={meta.label}
        className="shrink-0 gap-1 px-1.5 text-[10px] font-normal"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
        {meta.label}
      </Badge>
    )
  }

  return (
    <Badge variant={meta.tone} title={meta.label} className="gap-1.5">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}
