import type { AssetBase, AssetSyncState, PageRequest, ScanFinding } from './common'
import type { SyncRisk } from './sync'

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export type SkillSource = 'local' | 'official' | 'community' | 'import' | 'scan'
export type InstallMode = 'symlink' | 'copy'

export interface SkillFileEntry {
  path: string
  size: number
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

export interface SkillFileWrite {
  path: string
  content: string
}

export interface SkillListItem extends AssetBase {
  kind: 'skill'
  versionLabel: string
  icon: string
  source: SkillSource
  category: string
  fileCount: number
  pendingChangeCount: number
  installSummary: {
    synced: number
    stale: number
    drifted: number
    missing: number
    unsupported: number
  }
}

export interface SkillDetail extends AssetBase {
  kind: 'skill'
  versionLabel: string
  author: string
  category: string
  icon: string
  source: SkillSource
  files: SkillFileEntry[]
  installSummary: SkillListItem['installSummary']
}

export interface SkillQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  source?: SkillSource
  category?: string
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title'
  order?: 'asc' | 'desc'
}

export interface SkillCreateInput {
  requestId?: string
  title: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files: SkillFileWrite[]
}

export interface SkillUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files?: SkillFileWrite[]
}

export interface SkillFilesInput {
  assetId: string
  revisionId?: string
  includeContent?: boolean
}

export interface SkillFilesResult {
  assetId: string
  revisionId: string
  manifestHash: string
  files: SkillFileEntry[]
  contents?: Record<string, string>
  omitted: Array<{ path: string; reason: 'binary' | 'too-large' }>
}

export interface SkillImportInput {
  requestId?: string
  sourcePaths?: string[]
  pickFromDialog?: boolean
  confirm: boolean
  previewToken?: string
  acknowledgeScripts?: boolean
}

export interface SkillImportPreview {
  phase: 'preview'
  sources: Array<{
    sourcePath: string
    name: string
    files: SkillFileEntry[]
    risk: SyncRisk[]
    findings: ScanFinding[]
    warnings: string[]
  }>
  conflicts: Array<{ sourcePath: string; reason: string }>
  previewToken: string
}

export interface SkillImportApplied {
  phase: 'applied'
  imported: SkillDetail[]
  skipped: Array<{ sourcePath: string; reason: string }>
}

export type SkillImportResult = SkillImportPreview | SkillImportApplied

export interface SkillStoreItem {
  id: string
  name: string
  icon: string
  description: string
  author: string
  version: string
  category: string
  downloads: number
  source: 'official' | 'community'
  files: SkillFileEntry[]
}

export interface SkillFileModel {
  id: string
  title: string
  description: string
  folder: string
  tags: string[]
  versionLabel: string
  author: string
  category: string
  icon: string
  files: Array<{ path: string; content: string | null; mediaKind: 'text' | 'binary'; isExecutable: boolean }>
}
