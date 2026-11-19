import type { AssetKind, Page, PageRequest } from './common'

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface SearchQuery extends PageRequest {
  q: string
  kinds?: AssetKind[]
  folder?: string
  includeDescendants?: boolean
}

export interface SearchResultItem {
  assetId: string
  kind: AssetKind
  title: string
  path: string
  folder: string
  snippet: string
  rank: number
}

export interface SearchResultPage extends Page<SearchResultItem> {
  rebuilding: boolean
}
