import type { AssetKind } from '../../types'
import { useStore } from '../../store/store'
import { assetRepoState, REPO_STATE_META } from '../../lib/sync'
import { Badge } from '../ui/core'

/** 资产详情里的仓库同步状态徽标，避免用户为了看状态跳到同步中心 */
export function AssetSyncBadge({ kind, name }: { kind: AssetKind; name: string }) {
  const { state } = useStore()
  const enabled =
    kind === 'skill' ? state.repo.policies.skills : kind === 'mcp' ? state.repo.policies.mcp : state.repo.policies.prompts

  if (!state.repo.connected) return <Badge variant="outline">未连接仓库</Badge>

  const st = assetRepoState(state.syncChanges, kind, name, enabled)
  const meta = REPO_STATE_META[st]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}
