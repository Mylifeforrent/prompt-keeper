/**
 * Canonical channel catalog. Every preload method and main handler is derived
 * from this map, so a channel cannot exist on one side only.
 */
export const CHANNELS = {
  app: {
    bootstrap: 'app:bootstrap',
    theme: 'app:theme',
    openExternal: 'app:openExternal',
    revealPath: 'app:revealPath',
  },
  projects: {
    list: 'projects:list',
    register: 'projects:register',
    remove: 'projects:remove',
  },
  prompts: {
    list: 'prompts:list',
    get: 'prompts:get',
    versions: 'prompts:versions',
    create: 'prompts:create',
    update: 'prompts:update',
    delete: 'prompts:delete',
    restore: 'prompts:restore',
    restoreVersion: 'prompts:restoreVersion',
    copyRender: 'prompts:copyRender',
    setSyncPolicy: 'prompts:setSyncPolicy',
    setFavorite: 'prompts:setFavorite',
    setPinned: 'prompts:setPinned',
    folders: 'prompts:folders',
    storeList: 'prompts:storeList',
  },
  targets: {
    list: 'targets:list',
  },
  contracts: {
    list: 'contracts:list',
    get: 'contracts:get',
    versions: 'contracts:versions',
    create: 'contracts:create',
    update: 'contracts:update',
    delete: 'contracts:delete',
    restore: 'contracts:restore',
    restoreVersion: 'contracts:restoreVersion',
    resolve: 'contracts:resolve',
    compile: 'contracts:compile',
    setSyncPolicy: 'contracts:setSyncPolicy',
  },
  projections: {
    list: 'projections:list',
    project: 'projections:project',
    reproject: 'projections:reproject',
    remove: 'projections:remove',
    rollback: 'projections:rollback',
    overwriteDrift: 'projections:overwriteDrift',
  },
  globalProjections: {
    list: 'globalProjections:list',
    project: 'globalProjections:project',
    reproject: 'globalProjections:reproject',
    remove: 'globalProjections:remove',
    rollback: 'globalProjections:rollback',
    overwriteDrift: 'globalProjections:overwriteDrift',
  },
  globalTargets: {
    list: 'globalTargets:list',
    updatePath: 'globalTargets:updatePath',
    restoreDefault: 'globalTargets:restoreDefault',
  },
  skills: {
    list: 'skills:list',
    get: 'skills:get',
    versions: 'skills:versions',
    files: 'skills:files',
    create: 'skills:create',
    update: 'skills:update',
    delete: 'skills:delete',
    restore: 'skills:restore',
    restoreVersion: 'skills:restoreVersion',
    import: 'skills:import',
    storeList: 'skills:storeList',
  },
  mcp: {
    list: 'mcp:list',
    get: 'mcp:get',
    versions: 'mcp:versions',
    create: 'mcp:create',
    update: 'mcp:update',
    delete: 'mcp:delete',
    restore: 'mcp:restore',
    restoreVersion: 'mcp:restoreVersion',
    health: 'mcp:health',
    setEnabled: 'mcp:setEnabled',
    setFavorite: 'mcp:setFavorite',
    agentState: 'mcp:agentState',
    importExternal: 'mcp:importExternal',
    apply: 'mcp:apply',
    remove: 'mcp:remove',
    storeList: 'mcp:storeList',
  },
  sync: {
    repoGet: 'sync:repoGet',
    repoConnect: 'sync:repoConnect',
    repoDisconnect: 'sync:repoDisconnect',
    repoUpdate: 'sync:repoUpdate',
    fetch: 'sync:fetch',
    changes: 'sync:changes',
    changeDetail: 'sync:changeDetail',
    review: 'sync:review',
    pull: 'sync:pull',
    push: 'sync:push',
    conflictResolve: 'sync:conflictResolve',
    history: 'sync:history',
    cancel: 'sync:cancel',
  },
  dispatch: {
    matrix: 'dispatch:matrix',
    detail: 'dispatch:detail',
    install: 'dispatch:install',
    remove: 'dispatch:remove',
    rollback: 'dispatch:rollback',
    syncStale: 'dispatch:syncStale',
  },
  search: {
    query: 'search:query',
    rebuild: 'search:rebuild',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    backup: 'settings:backup',
    restore: 'settings:restore',
    reset: 'settings:reset',
    diagnostics: 'settings:diagnostics',
  },
  updates: {
    check: 'updates:check',
    download: 'updates:download',
    install: 'updates:install',
    status: 'updates:status',
  },
  ai: {
    providers: 'ai:providers',
    providerSave: 'ai:providerSave',
    test: 'ai:test',
    cancel: 'ai:cancel',
    history: 'ai:history',
  },
} as const

export const EVENT_CHANNELS = {
  domainChanged: 'domain:changed',
  operationProgress: 'operation:progress',
  operationCompleted: 'operation:completed',
  syncProgress: 'sync:progress',
  updateAvailable: 'update:available',
  aiStream: 'ai:stream',
} as const

/** Flattened method paths, for example `prompts.list` and `app.bootstrap`. */
export type ChannelMethodPath =
  | `app.${keyof typeof CHANNELS.app}`
  | `projects.${keyof typeof CHANNELS.projects}`
  | `prompts.${keyof typeof CHANNELS.prompts}`
  | `targets.${keyof typeof CHANNELS.targets}`
  | `contracts.${keyof typeof CHANNELS.contracts}`
  | `projections.${keyof typeof CHANNELS.projections}`
  | `globalProjections.${keyof typeof CHANNELS.globalProjections}`
  | `globalTargets.${keyof typeof CHANNELS.globalTargets}`
  | `skills.${keyof typeof CHANNELS.skills}`
  | `mcp.${keyof typeof CHANNELS.mcp}`
  | `sync.${keyof typeof CHANNELS.sync}`
  | `dispatch.${keyof typeof CHANNELS.dispatch}`
  | `search.${keyof typeof CHANNELS.search}`
  | `settings.${keyof typeof CHANNELS.settings}`
  | `updates.${keyof typeof CHANNELS.updates}`
  | `ai.${keyof typeof CHANNELS.ai}`

export const CHANNEL_NAMES: string[] = Object.values(CHANNELS).flatMap((group) =>
  Object.values(group),
)

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS][keyof (typeof CHANNELS)[keyof typeof CHANNELS]]
