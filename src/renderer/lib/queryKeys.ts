export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  settings: ['settings'] as const,
  updates: ['settings', 'updates'] as const,
  projects: ['projects'] as const,
  targets: ['targets', 'list'] as const,
  prompts: {
    list: (query: unknown) => ['prompts', 'list', query] as const,
    detail: (id: string) => ['prompts', 'detail', id] as const,
    versions: (id: string) => ['prompts', 'versions', id] as const,
    folders: (query: unknown) => ['prompts', 'folders', query] as const,
  },
  contracts: {
    list: (query: unknown) => ['contracts', 'list', query] as const,
    detail: (id: string) => ['contracts', 'detail', id] as const,
    versions: (id: string) => ['contracts', 'versions', id] as const,
    resolution: (input: unknown) => ['contracts', 'resolution', input] as const,
    compiled: (input: unknown) => ['contracts', 'compiled', input] as const,
  },
  projections: {
    list: (query: unknown) => ['projections', 'list', query] as const,
    globalList: (query: unknown) => ['globalProjections', 'list', query] as const,
    globalTargets: ['globalTargets', 'list'] as const,
  },
  skills: {
    list: (query: unknown) => ['skills', 'list', query] as const,
    detail: (id: string) => ['skills', 'detail', id] as const,
    versions: (id: string) => ['skills', 'versions', id] as const,
    files: (input: unknown) => ['skills', 'files', input] as const,
  },
  mcp: {
    list: (query: unknown) => ['mcp', 'list', query] as const,
    detail: (id: string) => ['mcp', 'detail', id] as const,
    versions: (id: string) => ['mcp', 'versions', id] as const,
    health: (id: string) => ['mcp', 'health', id] as const,
  },
  sync: {
    repo: ['sync', 'repo'] as const,
    changes: (query: unknown) => ['sync', 'changes', query] as const,
    change: (id: string) => ['sync', 'change', id] as const,
    history: (query: unknown) => ['sync', 'history', query] as const,
  },
  dispatch: {
    matrix: (query: unknown) => ['dispatch', 'matrix', query] as const,
    detail: (assetId: string) => ['dispatch', 'detail', assetId] as const,
  },
  search: (query: unknown) => ['search', query] as const,
  ai: {
    providers: ['ai', 'providers'] as const,
    history: (query: unknown) => ['ai', 'history', query] as const,
  },
}
