import { forwardRef, useEffect, useRef, useState } from 'react'
import { Badge, Input, Kbd } from '../ui/core'
import { Icon, type IconName } from '../../lib/icons'
import { ipc } from '../../lib/ipc'
import type { AssetKind, RepoStatus, SearchResultItem, ThemeMode } from '../../../shared/contracts'
import type { Page } from '../../app/types'
import { pageForKind } from '../../app/types'
import { cn } from '../../lib/utils'

const TITLES: Record<Page, string> = {
  prompts: 'Prompts',
  instructions: 'Agent Instructions',
  skills: 'Skills',
  mcp: 'MCP',
  sync: 'Sync Center',
  settings: 'Settings',
}

const SUBTITLES: Record<Page, string> = {
  prompts: 'Local asset library · optional Git sync',
  instructions: 'Repo contracts · project projection · global dispatch',
  skills: 'SKILL.md · multi-agent dispatch',
  mcp: 'Server templates · secrets stay local',
  sync: 'Fetch · Pull · Push · Conflicts · Dispatch',
  settings: 'Appearance · repository · data',
}

const KIND_LABEL: Record<AssetKind, string> = {
  prompt: 'Prompt',
  contract: 'Instructions',
  skill: 'Skill',
  mcp: 'MCP',
}

const CURRENT_THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const NEXT_THEME: Record<ThemeMode, { mode: ThemeMode; label: string; icon: IconName }> = {
  system: { mode: 'light', label: 'Switch to light theme', icon: 'sun' },
  light: { mode: 'dark', label: 'Switch to dark theme', icon: 'moon' },
  dark: { mode: 'system', label: 'Switch to system theme', icon: 'refresh' },
}

export interface TopbarProps {
  page: Page
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (page: Page) => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  repo: RepoStatus | null
  pendingCount: number
  onOpenAsset: (kind: AssetKind, id: string) => void
}

export const Topbar = forwardRef<HTMLInputElement, TopbarProps>(function Topbar(
  {
    page,
    query,
    onQueryChange,
    onNavigate,
    theme,
    onThemeChange,
    repo,
    pendingCount,
    onOpenAsset,
  },
  ref,
) {
  const nextTheme = NEXT_THEME[theme]
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      ipc.search
        .query({ q: trimmed, limit: 12 })
        .then((result) => {
          if (!cancelled) {
            setResults(result.items)
            setOpen(true)
          }
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const grouped = results.reduce<Record<string, SearchResultItem[]>>((acc, item) => {
    const key = KIND_LABEL[item.kind]
    acc[key] = [...(acc[key] ?? []), item]
    return acc
  }, {})

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-4 backdrop-blur-sm lg:gap-3 lg:px-5">
      <div className="min-w-0 shrink-0">
        <h1 className="truncate text-[15px] font-semibold leading-5 tracking-tight">{TITLES[page]}</h1>
        <p className="hidden text-[11px] leading-4 text-muted-foreground xl:block">{SUBTITLES[page]}</p>
      </div>

      <div ref={boxRef} className="relative ml-auto w-full max-w-[300px] md:max-w-[340px] xl:max-w-[380px]">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={ref}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (results.length) setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              onQueryChange('')
            }
          }}
          aria-label="Global search"
          placeholder="Search all assets…"
          className="h-9 bg-muted/50 pl-9 pr-11 hover:bg-card focus:bg-card"
        />
        <Kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 md:inline-flex">
          /
        </Kbd>

        {open && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[400px] overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-popover">
            {searching && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching the local index…</div>
            )}
            {!searching && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No matches. Search covers titles, descriptions, bodies, tags, and repository paths.
              </div>
            )}
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label} className="py-1">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                {items.map((item) => (
                  <button
                    key={item.assetId}
                    type="button"
                    onClick={() => {
                      onNavigate(pageForKind(item.kind))
                      onOpenAsset(item.kind, item.assetId)
                      setOpen(false)
                      onQueryChange('')
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="truncate text-xs font-medium">{item.title}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{item.path}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onThemeChange(nextTheme.mode)}
        aria-label={nextTheme.label}
        title={`Theme: ${CURRENT_THEME_LABEL[theme]} · ${nextTheme.label}`}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name={nextTheme.icon} className="h-[17px] w-[17px]" />
      </button>

      <button
        type="button"
        onClick={() => onNavigate('sync')}
        title={repo ? `Repository ${repo.url} · open Sync Center` : 'No repository connected · open Sync Center'}
        className={cn(
          'hidden h-9 max-w-[260px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/60 hover:text-foreground xl:flex',
        )}
      >
        <span
          className={
            repo
              ? pendingCount > 0
                ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-warning'
                : 'h-1.5 w-1.5 shrink-0 rounded-full bg-success'
              : 'h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50'
          }
        />
        <Icon name="gitBranch" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-mono text-[11px]">{repo ? repo.url : 'No repository connected'}</span>
        {repo ? (
          pendingCount > 0 ? (
            <Badge variant="warning" className="shrink-0">
              {pendingCount} pending
            </Badge>
          ) : (
            <Badge variant="success" className="shrink-0">
              Synced
            </Badge>
          )
        ) : (
          <Badge variant="outline" className="shrink-0">
            Connect
          </Badge>
        )}
      </button>
    </header>
  )
})
