import type { AssetKind, PromptSyncPolicy } from '../../types'
import { useStore } from '../../store/store'
import { assetRepoState, REPO_STATE_META, type AssetRepoState } from '../../lib/sync'
import { Badge } from '../ui/core'

const SHORT_LABEL: Record<AssetRepoState, string> = {
  'in-sync': 'Synced',
  'remote-ahead': 'Incoming',
  'local-ahead': 'Unpushed',
  diverged: 'Conflict',
  blocked: 'Blocked',
  ignored: 'Local only',
}

const DOT: Record<AssetRepoState, string> = {
  'in-sync': 'bg-success',
  'remote-ahead': 'bg-info',
  'local-ahead': 'bg-warning',
  diverged: 'bg-danger',
  blocked: 'bg-danger',
  ignored: 'bg-muted-foreground/50',
}

/** Repo sync status badge for asset detail / list views, so users need not jump to Sync Center just to check status */
export function AssetSyncBadge({
  kind,
  name,
  assetId,
  policy,
  compact = false,
}: {
  kind: AssetKind
  name: string
  /** Renamable assets such as Prompts match pending sync changes by stable id */
  assetId?: string
  /** Sync scope for Prompts; omitted for Skills / MCP */
  policy?: PromptSyncPolicy
  compact?: boolean
}) {
  const { state } = useStore()

  if (!state.repo.connected) {
    return compact ? null : <Badge variant="outline">No repo connected</Badge>
  }

  const enabled =
    kind === 'prompt'
      ? state.repo.policies.prompts && policy !== 'local'
      : kind === 'contract'
        ? state.repo.policies.contracts && policy !== 'local'
        : kind === 'skill'
          ? state.repo.policies.skills
          : state.repo.policies.mcp

  const st = assetRepoState(state.syncChanges, kind, name, enabled, assetId)
  const meta = REPO_STATE_META[st]
  const label = st === 'ignored' && (kind === 'prompt' || kind === 'contract') ? 'Local only' : meta.label

  if (compact) {
    return (
      <Badge
        variant={meta.variant}
        title={label}
        className="shrink-0 gap-1 px-1.5 text-[10px] font-normal"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[st]}`} aria-hidden />
        {SHORT_LABEL[st]}
      </Badge>
    )
  }

  return (
    <Badge variant={meta.variant} title={label} className="gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[st]}`} aria-hidden />
      {label}
    </Badge>
  )
}
