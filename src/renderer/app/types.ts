import type { AssetKind } from '../../shared/contracts'

export type Page = 'prompts' | 'instructions' | 'skills' | 'mcp' | 'sync' | 'settings'

export interface CreateSignal {
  n: number
  page: Page
}

export interface OpenAssetRequest {
  kind: AssetKind
  id: string
}

export interface WorkspaceProps {
  query: string
  createSignal: CreateSignal
  openAsset: OpenAssetRequest | null
  onAssetOpened: () => void
}

export function kindForPage(page: Page): AssetKind | null {
  switch (page) {
    case 'prompts':
      return 'prompt'
    case 'instructions':
      return 'contract'
    case 'skills':
      return 'skill'
    case 'mcp':
      return 'mcp'
    default:
      return null
  }
}

export function pageForKind(kind: AssetKind): Page {
  switch (kind) {
    case 'prompt':
      return 'prompts'
    case 'contract':
      return 'instructions'
    case 'skill':
      return 'skills'
    default:
      return 'mcp'
  }
}
