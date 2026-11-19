import type {
  AssetSyncState,
  ContractActivation,
  ContractActivationMode,
  ContractScope,
  ContractTarget,
  GlobalTargetDetail,
  ProjectionStatus,
  SkippedContractEntry,
  SyncPolicy,
  TargetCompatibility,
} from '../../../shared/contracts'
import type { IconName } from '../icons'
import { syncStateMeta } from './assetStatus'
import type { BadgeTone } from './assetStatus'

interface Meta {
  label: string
  short: string
  description: string
}

export const CONTRACT_SCOPE_META: Record<ContractScope, Meta> = {
  user: {
    label: 'User',
    short: 'User',
    description: 'Intended for global dispatch to user-level Agent directories on this machine.',
  },
  project: {
    label: 'Project',
    short: 'Project',
    description: 'Applies inside a registered project root; project projections are explicit writes.',
  },
  path: {
    label: 'Path',
    short: 'Path',
    description: 'Applies only when the working file is under the directory prefix and a glob matches.',
  },
}

export const ACTIVATION_META: Record<ContractActivationMode, Meta> = {
  always: {
    label: 'Always on',
    short: 'Always',
    description: 'Enters context in every session that reads this target.',
  },
  glob: {
    label: 'Path by glob',
    short: 'Glob',
    description: 'Applies only when the working file matches one of the glob patterns.',
  },
  model: {
    label: 'Model decision',
    short: 'Model',
    description: 'The target tool decides from the description whether to include this contract.',
  },
  manual: {
    label: 'Manual reference',
    short: 'Manual',
    description: 'Never automatic; a user attaches the contract explicitly.',
  },
}

export const SYNC_POLICY_META: Record<SyncPolicy, Meta> = {
  inherit: {
    label: 'Follow repository policy',
    short: 'Inherit',
    description: 'Participates in Git sync only while the repository policy for contracts is enabled.',
  },
  sync: {
    label: 'Participate in sync',
    short: 'Sync',
    description: 'Enters Git sync while a repository is connected and the contracts policy is enabled.',
  },
  local: {
    label: 'Local only',
    short: 'Local',
    description: 'Never enters Git and never appears in pending pushes.',
  },
}

export const PROJECTION_STATUS_META: Record<
  ProjectionStatus,
  { label: string; short: string; variant: BadgeTone; icon: IconName }
> = {
  synced: { label: 'Synced', short: 'Synced', variant: 'success', icon: 'check' },
  stale: { label: 'Stale', short: 'Stale', variant: 'warning', icon: 'refresh' },
  drifted: { label: 'Drifted', short: 'Drifted', variant: 'danger', icon: 'alert' },
  missing: { label: 'Missing', short: 'Missing', variant: 'outline', icon: 'dot' },
}

export const SKIP_CODE_LABEL: Record<SkippedContractEntry['code'], string> = {
  'path-scope-mismatch': 'Path scope does not match',
  'glob-not-matched': 'Glob did not match',
  'activation-unsupported': 'Activation unsupported by target',
  'target-not-selected': 'Target not selected',
  deleted: 'Deleted contract',
  'model-decision': 'Model decision, not automatic',
  'manual-only': 'Manual reference only',
}


export function folderLabel(folder: string): string {
  return folder.trim() || 'Uncategorized'
}

export function contractVersionLabel(version: number): string {
  return `v${version}`
}

export function contractRepositoryPath(folder: string, slug: string): string {
  const normalized = folder
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  return normalized
    ? `instructions/${normalized}/${slug}.contract.md`
    : `instructions/${slug}.contract.md`
}

export function projectTargetPath(target: ContractTarget, slug: string): string {
  return target.pathTemplate.replace('{slug}', slug)
}

export function activationSummary(activation: ContractActivation): string {
  switch (activation.mode) {
    case 'always':
      return 'Always on'
    case 'glob':
      return activation.globs.length ? `Glob: ${activation.globs.join(', ')}` : 'Glob: no patterns yet'
    case 'model':
      return activation.description?.trim()
        ? `Model decision: ${activation.description.trim()}`
        : 'Model decision: no applicability description yet'
    case 'manual':
      return 'Manual reference only'
  }
}

export function targetSupportsActivation(
  target: Pick<ContractTarget, 'supports'>,
  mode: ContractActivationMode,
): boolean {  switch (mode) {
    case 'always':
      return true
    case 'glob':
      return target.supports.globs
    case 'model':
      return target.supports.modelDecision
    case 'manual':
      return target.supports.manual
  }
}

/** Compute warnings locally so the editor never silently downgrades an incompatible target. */
export function compatibilityFor(
  activation: ContractActivation,
  imports: string[],
  target: ContractTarget,
): TargetCompatibility {
  const unsupportedFeatures: TargetCompatibility['unsupportedFeatures'] = []
  const warnings: string[] = []
  let blocking = false

  if (!targetSupportsActivation(target, activation.mode)) {
    blocking = true
    const feature =
      activation.mode === 'glob' ? 'globs' : activation.mode === 'model' ? 'modelDecision' : 'manual'
    unsupportedFeatures.push(feature)
    warnings.push(
      `${target.label} cannot represent "${activation.mode}" activation; this contract is skipped during projection to that target.`,
    )
  }

  if (imports.length > 0 && !target.supports.imports) {
    unsupportedFeatures.push('imports')
    warnings.push(`${target.label} does not support @import; import paths are written as plain text there.`)
  }

  return {
    targetId: target.id,
    compatible: !blocking,
    blocking,
    unsupportedFeatures,
    warnings,
  }
}

export function compatibilityForTarget(
  targets: ContractTarget[],
  targetId: string,
  activation: ContractActivation,
  imports: string[],
): TargetCompatibility | null {
  const target = targets.find((item) => item.id === targetId)
  return target ? compatibilityFor(activation, imports, target) : null
}

export function compatibilityMap(
  compatibilities: TargetCompatibility[],
): Map<string, TargetCompatibility> {
  return new Map(compatibilities.map((item) => [item.targetId, item]))
}


export function isAbsolutePath(value: string): boolean {
  const path = value.trim()
  if (!path) return false
  if (path.startsWith('~/') || path === '~') return true
  if (path.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(path)) return true
  return /^\\\\[^\\]/.test(path)
}

const BAD_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/

/** Global paths may be absolute or start with ~; they are local-only and never written to Git. */
export function validateGlobalPath(value: string): string | null {
  const path = value.trim()
  if (!path) return 'A target path is required.'
  if (/[\n\r\u0000]/.test(path)) return 'The path must not contain newlines or NUL characters.'
  if (!isAbsolutePath(path)) return 'Use an absolute path or a path that starts with ~.'
  if (BAD_SEGMENT.test(path)) return 'The path must not contain ".." segments.'
  return null
}

/** Project roots must be native absolute paths; `~` is intentionally rejected. */
export function validateProjectRoot(value: string): string | null {
  const path = value.trim()
  if (!path) return 'A project root path is required.'
  if (/[\n\r\u0000]/.test(path)) return 'The path must not contain newlines or NUL characters.'
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) {
    return 'Enter an absolute path instead of ~; the main process resolves project roots literally.'
  }
  if (!isAbsolutePath(path)) return 'Enter an absolute path such as /Users/you/code/app.'
  if (BAD_SEGMENT.test(path)) return 'The path must not contain ".." segments.'
  return null
}

export function globalPathHint(target: GlobalTargetDetail): string {
  if (target.pathMode === 'dir') {
    return `Directory target. Prompt Keeper writes one ${target.fileExt ?? '.md'} file per contract inside this directory.`
  }
  return 'Single-file target. Contracts merge into managed blocks inside this file.'
}

export function contractSyncStateMeta(asset: {
  syncPolicy: SyncPolicy
  effectiveSync: boolean
  syncState: AssetSyncState
}): { label: string; variant: BadgeTone } {
  if (asset.syncState === 'not-connected' && !asset.effectiveSync) {
    return { label: SYNC_POLICY_META[asset.syncPolicy].short, variant: 'outline' }
  }
  const meta = syncStateMeta(asset.syncState)
  return { label: meta.label, variant: meta.tone }
}

