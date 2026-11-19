import type { AssetSyncState } from '../../../shared/contracts'

export type BadgeTone =
  | 'default'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary'
  | 'outline'

export interface SyncStateMeta {
  label: string
  shortLabel: string
  tone: BadgeTone
  dot: string
  description: string
}

/** One status dictionary shared by asset lists, detail headers, and sync dialogs. */
export const SYNC_STATE_META: Record<AssetSyncState, SyncStateMeta> = {
  'not-connected': {
    label: 'Not connected',
    shortLabel: 'Local',
    tone: 'outline',
    dot: 'bg-muted-foreground/50',
    description:
      'No repository is connected. This item stays in the local library and nothing is written elsewhere.',
  },
  'local-only': {
    label: 'Local only',
    shortLabel: 'Local',
    tone: 'secondary',
    dot: 'bg-muted-foreground/50',
    description:
      'Excluded from Git sync. Edits never create pending pushes, and repository updates never touch this item.',
  },
  'in-sync': {
    label: 'Synced',
    shortLabel: 'Synced',
    tone: 'success',
    dot: 'bg-success',
    description: 'Local content matches the latest repository file. Nothing needs to be pushed.',
  },
  outgoing: {
    label: 'Local unpushed',
    shortLabel: 'Unpushed',
    tone: 'warning',
    dot: 'bg-warning',
    description:
      'Local edits are waiting in the Sync Center. Nothing is committed or pushed automatically.',
  },
  incoming: {
    label: 'Repository updated',
    shortLabel: 'Incoming',
    tone: 'info',
    dot: 'bg-info',
    description:
      'The repository has a newer version. Review it and pull from the Sync Center; local content is not overwritten automatically.',
  },
  conflict: {
    label: 'Conflict',
    shortLabel: 'Conflict',
    tone: 'danger',
    dot: 'bg-danger',
    description:
      'Both the local copy and the repository changed. Resolve the conflict in the Sync Center before syncing again.',
  },
  blocked: {
    label: 'Push blocked',
    shortLabel: 'Blocked',
    tone: 'danger',
    dot: 'bg-danger',
    description:
      'A security scan blocked the pending push. Replace suspected credentials with template variables, then retry from the Sync Center.',
  },
}

export function syncStateMeta(state: AssetSyncState): SyncStateMeta {
  return SYNC_STATE_META[state]
}
