import type { AssetKind, PromptSyncPolicy } from '../../types'
import { useStore } from '../../store/store'
import { assetRepoState, REPO_STATE_META, type AssetRepoState } from '../../lib/sync'
import { Badge } from '../ui/core'

const SHORT_LABEL: Record<AssetRepoState, string> = {
  'in-sync': '已同步',
  'remote-ahead': '有更新',
  'local-ahead': '未推送',
  diverged: '冲突',
  blocked: '已阻断',
  ignored: '仅本机',
}

const DOT: Record<AssetRepoState, string> = {
  'in-sync': 'bg-success',
  'remote-ahead': 'bg-info',
  'local-ahead': 'bg-warning',
  diverged: 'bg-danger',
  blocked: 'bg-danger',
  ignored: 'bg-muted-foreground/50',
}

/** 资产详情 / 列表里的仓库同步状态徽标，避免用户为了看状态跳到同步中心 */
export function AssetSyncBadge({
  kind,
  name,
  assetId,
  policy,
  compact = false,
}: {
  kind: AssetKind
  name: string
  /** Prompt 等可重命名资产用稳定 id 匹配待同步变更 */
  assetId?: string
  /** Prompt 的同步范围；Skill / MCP 不传 */
  policy?: PromptSyncPolicy
  compact?: boolean
}) {
  const { state } = useStore()

  if (!state.repo.connected) {
    return compact ? null : <Badge variant="outline">未连接仓库</Badge>
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
  const label = st === 'ignored' && (kind === 'prompt' || kind === 'contract') ? '仅本机' : meta.label

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
