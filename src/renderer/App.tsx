import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { PromptsTabs } from './components/prompts/PromptsTabs'
import { InstructionsWorkspace } from './components/instructions/InstructionsWorkspace'
import { SkillsTabs } from './components/skills/SkillsTabs'
import { McpTabs } from './components/mcp/McpTabs'
import { SyncCenter } from './components/sync/SyncCenter'
import { SettingsView } from './components/settings/SettingsView'
import { useToast } from './components/ui/toast'
import { Button } from './components/ui/core'
import { Icon } from './lib/icons'
import { errorMessage, events, ipc } from './lib/ipc'
import { queryKeys } from './lib/queryKeys'
import type {
  AssetKind,
  DomainName,
  OperationCompletedEvent,
  OperationProgressEvent,
  OperationRef,
  ThemeMode,
} from '../shared/contracts'
import { FirstRun } from './app/FirstRun'
import { OperationPanel } from './app/OperationPanel'
import type { CreateSignal, OpenAssetRequest, Page } from './app/types'
import { kindForPage } from './app/types'

const PAGE_KEY = 'pk_active_page'
const FIRST_RUN_KEY = 'pk_first_run_dismissed'

function readPage(): Page {
  const saved = localStorage.getItem(PAGE_KEY)
  const valid: Page[] = ['prompts', 'instructions', 'skills', 'mcp', 'sync', 'settings']
  return valid.includes(saved as Page) ? (saved as Page) : 'prompts'
}

function applyTheme(effective: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.toggle('dark', effective === 'dark')
  root.style.colorScheme = effective
}

export default function App() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState<Page>(readPage)
  const [query, setQuery] = useState('')
  const [createSignal, setCreateSignal] = useState<CreateSignal>({ n: 0, page: 'prompts' })
  const [openAsset, setOpenAsset] = useState<OpenAssetRequest | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [operations, setOperations] = useState<OperationRef[]>([])
  const [progress, setProgress] = useState<Record<string, OperationProgressEvent>>({})
  const [completed, setCompleted] = useState<OperationCompletedEvent[]>([])
  const [firstRunDismissed, setFirstRunDismissed] = useState(
    () => sessionStorage.getItem(FIRST_RUN_KEY) === '1',
  )
  const searchRef = useRef<HTMLInputElement>(null)

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })

  useEffect(() => {
    if (bootstrap.data) {
      setTheme(bootstrap.data.theme)
      applyTheme(bootstrap.data.effectiveTheme)
    }
  }, [bootstrap.data])

  const refreshBootstrap = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
  }, [queryClient])

  const invalidateDomain = useCallback(
    (domain: DomainName) => {
      void queryClient.invalidateQueries({ queryKey: [domain] })
      if (domain === 'prompts' || domain === 'contracts' || domain === 'skills' || domain === 'mcp') {
        void queryClient.invalidateQueries({ queryKey: ['sync'] })
        void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
        void queryClient.invalidateQueries({ queryKey: ['search'] })
      }
      if (domain === 'projections' || domain === 'contracts') {
        void queryClient.invalidateQueries({ queryKey: ['globalTargets'] })
        void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
      }
    },
    [queryClient],
  )

  useEffect(() => {
    const unsubscribers = [
      events.onDomainChanged((event) => {
        invalidateDomain(event.domain)
        refreshBootstrap()
      }),
      events.onOperationProgress((event) => {
        setProgress((current) => ({ ...current, [event.operationId]: event }))
        setOperations((current) =>
          current.some((operation) => operation.operationId === event.operationId)
            ? current
            : [
                ...current,
                {
                  phase: 'started',
                  operationId: event.operationId,
                  type: event.type,
                  startedAt: event.at,
                },
              ],
        )
      }),
      events.onSyncProgress((event) => {
        setProgress((current) => ({ ...current, [event.operationId]: event }))
        setOperations((current) =>
          current.some((operation) => operation.operationId === event.operationId)
            ? current
            : [
                ...current,
                {
                  phase: 'started',
                  operationId: event.operationId,
                  type: event.type,
                  startedAt: event.at,
                },
              ],
        )
      }),
      events.onOperationCompleted((event) => {
        setOperations((current) => current.filter((operation) => operation.operationId !== event.operationId))
        setProgress((current) => {
          const next = { ...current }
          delete next[event.operationId]
          return next
        })
        setCompleted((current) => [event, ...current].slice(0, 4))
        if (event.state === 'committed') {
          toast.success('Operation completed. The affected workspace has been refreshed.')
        } else if (event.error) {
          toast.error(event.error.message)
        }
        void queryClient.invalidateQueries()
        refreshBootstrap()
      }),
      events.onUpdateAvailable((event) => {
        toast.info(`Update ${event.available.version} is available. Open Settings to review and install it.`)
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [invalidateDomain, queryClient, refreshBootstrap, toast])

  useEffect(() => {
    if (bootstrap.data) {
      setOperations((current) => {
        const ids = new Set(current.map((operation) => operation.operationId))
        return [
          ...current,
          ...bootstrap.data!.activeOperations.filter((operation) => !ids.has(operation.operationId)),
        ]
      })
    }
  }, [bootstrap.data])

  useEffect(() => {
    localStorage.setItem(PAGE_KEY, page)
  }, [page])

  const requestCreate = useCallback(
    (target: Page) => {
      setPage(target)
      setQuery('')
      setCreateSignal((signal) => ({ n: signal.n + 1, page: target }))
    },
    [],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'n' || event.key === 'N') {
        const kind = kindForPage(page)
        if (kind) {
          event.preventDefault()
          requestCreate(page)
        }
      } else if (event.key === 'Escape') {
        setOpenAsset(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [page, requestCreate])

  const changeTheme = useCallback(
    async (mode: ThemeMode) => {
      setTheme(mode)
      try {
        const result = await ipc.app.theme({ theme: mode })
        applyTheme(result.effectiveTheme)
        refreshBootstrap()
      } catch (error) {
        toast.error(`Theme not saved: ${errorMessage(error)}`)
      }
    },
    [refreshBootstrap, toast],
  )

  const counts = bootstrap.data?.counts
  const pending = bootstrap.data?.pending

  const sidebarCounts = useMemo(
    () => ({
      prompts: counts?.prompt ?? 0,
      instructions: counts?.contract ?? 0,
      skills: counts?.skill ?? 0,
      mcp: counts?.mcp ?? 0,
      sync:
        (pending?.incoming ?? 0) +
        (pending?.outgoing ?? 0) +
        (pending?.conflicts ?? 0) +
        (pending?.dispatchStale ?? 0) +
        (pending?.dispatchDrifted ?? 0),
    }),
    [counts, pending],
  )

  const workspaceProps = {
    query,
    createSignal,
    openAsset,
    onAssetOpened: () => setOpenAsset(null),
  }

  const firstRun =
    !!bootstrap.data &&
    !firstRunDismissed &&
    !bootstrap.data.repo &&
    Object.values(bootstrap.data.counts).every((count) => count === 0)

  if (bootstrap.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center">
          <Icon name="alert" className="mx-auto h-6 w-6 text-danger" />
          <h1 className="mt-3 text-sm font-semibold">Prompt Keeper could not start</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{errorMessage(bootstrap.error)}</p>
          <Button className="mt-4" onClick={() => void bootstrap.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (bootstrap.isLoading || !bootstrap.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="refresh" className="h-4 w-4 animate-spin" />
          Loading the local library…
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full">
      <Sidebar page={page} onNavigate={(next) => { setPage(next); setQuery(''); setOpenAsset(null) }} counts={sidebarCounts} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar
          ref={searchRef}
          page={page}
          query={query}
          onQueryChange={setQuery}
          onNavigate={(next) => {
            setPage(next)
            setQuery('')
            setOpenAsset(null)
          }}
          theme={theme}
          onThemeChange={(mode) => void changeTheme(mode)}
          repo={bootstrap.data.repo}
          pendingCount={sidebarCounts.sync}
          onOpenAsset={(kind: AssetKind, id: string) => setOpenAsset({ kind, id })}
        />
        <div key={page} className="relative min-h-0 flex-1 overflow-hidden animate-fade-in">
          {page === 'prompts' && <PromptsTabs {...workspaceProps} />}
          {page === 'instructions' && <InstructionsWorkspace {...workspaceProps} />}
          {page === 'skills' && <SkillsTabs {...workspaceProps} />}
          {page === 'mcp' && <McpTabs {...workspaceProps} />}
          {page === 'sync' && <SyncCenter />}
          {page === 'settings' && <SettingsView />}
        </div>
      </main>

      <OperationPanel
        operations={operations}
        progress={progress}
        completed={completed}
        onDismiss={(operationId) =>
          setCompleted((current) => current.filter((event) => event.operationId !== operationId))
        }
      />

      {firstRun && (
        <FirstRun
          onCreate={(kind) => {
            const target = kind === 'contract' ? 'instructions' : kind === 'prompt' ? 'prompts' : kind === 'skill' ? 'skills' : 'mcp'
            requestCreate(target)
            setFirstRunDismissed(true)
            sessionStorage.setItem(FIRST_RUN_KEY, '1')
          }}
          onConnect={() => {
            setPage('sync')
            setFirstRunDismissed(true)
            sessionStorage.setItem(FIRST_RUN_KEY, '1')
          }}
          onOpenSettings={() => {
            setPage('settings')
            setFirstRunDismissed(true)
            sessionStorage.setItem(FIRST_RUN_KEY, '1')
          }}
          onDismiss={() => {
            setFirstRunDismissed(true)
            sessionStorage.setItem(FIRST_RUN_KEY, '1')
          }}
        />
      )}
    </div>
  )
}
