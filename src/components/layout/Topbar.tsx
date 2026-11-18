import { forwardRef } from 'react'
import { Badge, Input, Kbd } from '../ui/core'
import { Icon } from '../../lib/icons'
import type { ThemeMode } from '../../types'
import { useStore } from '../../store/store'
import { syncCounts } from '../../lib/sync'
import type { Page } from './Sidebar'

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
  skills: 'SKILL.md · multi-platform dispatch',
  mcp: 'Server templates · secrets stay local',
  sync: 'Pull · Push · Conflicts · Dispatch',
  settings: 'Appearance · sync policy · data',
}

const CURRENT_THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const NEXT_THEME: Record<ThemeMode, { mode: ThemeMode; label: string; icon: 'sun' | 'moon' | 'refresh' }> = {
  system: { mode: 'light', label: 'Switch to light theme', icon: 'refresh' },
  light: { mode: 'dark', label: 'Switch to dark theme', icon: 'sun' },
  dark: { mode: 'system', label: 'Switch to system theme', icon: 'moon' },
}

export const Topbar = forwardRef<
  HTMLInputElement,
  { page: Page; query: string; onQueryChange: (q: string) => void; onNavigate: (p: Page) => void }
>(function Topbar({ page, query, onQueryChange, onNavigate }, ref) {
  const { state, setTheme } = useStore()
  const pending = syncCounts(state.syncChanges, state.deployments, state.mcps).pending
  const nextTheme = NEXT_THEME[state.settings.theme]
  const themeIcon = nextTheme.icon

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-4 backdrop-blur-sm lg:gap-3 lg:px-5">
      <div className="min-w-0 shrink-0">
        <h1 className="truncate text-[15px] font-semibold leading-5 tracking-tight">{TITLES[page]}</h1>
        <p className="hidden text-[11px] leading-4 text-muted-foreground xl:block">{SUBTITLES[page]}</p>
      </div>

      <div className="group relative ml-auto w-full max-w-[300px] md:max-w-[340px] xl:max-w-[380px]">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={ref}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Global search"
          placeholder="Search the current workspace…"
          className="h-9 bg-muted/50 pl-9 pr-11 hover:bg-card focus:bg-card"
        />
        <Kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 md:inline-flex">
          /
        </Kbd>
      </div>

      <button
        type="button"
        onClick={() => setTheme(nextTheme.mode)}
        aria-label={nextTheme.label}
        title={`Theme: ${CURRENT_THEME_LABEL[state.settings.theme]} · ${nextTheme.label}`}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name={themeIcon} className="h-[17px] w-[17px]" />
      </button>

      <button
        type="button"
        onClick={() => onNavigate('sync')}
        title={state.repo.connected ? `Repo ${state.repo.url} · open Sync Center` : 'No repo connected · connect'}
        className="hidden h-9 max-w-[260px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/60 hover:text-foreground xl:flex"
      >
        <span
          className={
            state.repo.connected
              ? pending > 0
                ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-warning'
                : 'h-1.5 w-1.5 shrink-0 rounded-full bg-success'
              : 'h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50'
          }
        />
        <Icon name="gitBranch" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-mono text-[11px]">
          {state.repo.connected ? state.repo.url : 'No repo connected'}
        </span>
        {state.repo.connected ? (
          pending > 0 ? (
            <Badge variant="warning" className="shrink-0">
              {pending} pending
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
