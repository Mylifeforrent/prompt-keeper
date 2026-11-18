import { cn } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

export type Page = 'prompts' | 'instructions' | 'skills' | 'mcp' | 'sync' | 'settings'

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: 'prompts', label: 'Prompts', icon: 'message' },
  { id: 'instructions', label: 'Agent Instructions', icon: 'file' },
  { id: 'skills', label: 'Skills', icon: 'grid' },
  { id: 'mcp', label: 'MCP', icon: 'zap' },
  { id: 'sync', label: 'Sync', icon: 'gitBranch' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
]

export function Sidebar({
  page,
  onNavigate,
  counts,
}: {
  page: Page
  onNavigate: (p: Page) => void
  counts: { prompts: number; instructions: number; skills: number; mcp: number; sync: number }
}) {
  return (
    <aside className="flex w-[60px] shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-sm xl:w-[212px]">
      <div className="flex items-center gap-2.5 px-3 py-4 xl:px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_2px_10px_-2px_color-mix(in_oklab,var(--primary)_55%,transparent)]">
          <Icon name="sparkles" className="h-4 w-4" strokeWidth={2.1} />
        </div>
        <div className="hidden min-w-0 xl:block">
          <div className="truncate text-[13px] font-semibold leading-4 tracking-tight">
            Prompt Keeper
          </div>
          <div className="mt-0.5 text-[10px] leading-3 text-muted-foreground">Local-first asset library</div>
        </div>
      </div>

      <div className="hidden px-4 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85 xl:block">
        Workspace
      </div>
      <nav className="flex-1 space-y-1 px-2 xl:px-2.5" aria-label="Main navigation">
        {NAV.map((n) => {
          const active = page === n.id
          const count = counts[n.id as keyof typeof counts]
          const warning = n.id === 'sync' && count > 0
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavigate(n.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={n.label}
              title={n.id === 'settings' ? n.label : `${n.label} · ${count}`}
              className={cn(
                'group relative flex h-9 w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors xl:justify-start xl:px-2.5',
                active
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
              <Icon name={n.icon} className="h-[17px] w-[17px]" strokeWidth={active ? 2.15 : 1.9} />
              {warning && (
                <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-warning ring-2 ring-card xl:hidden" />
              )}
              <span className="hidden xl:inline">{n.label}</span>
              {n.id !== 'settings' && (
                <span
                  className={cn(
                    'tabular ml-auto hidden min-w-[20px] justify-center rounded-md px-1 text-[10px] font-medium leading-[18px] xl:inline-flex',
                    warning
                      ? 'bg-warning-soft text-warning'
                      : active
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="hidden border-t border-border/70 p-3 xl:block">
        <div className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <Icon name="layers" className="h-3 w-3" />
            Folders are Git directories
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Four asset types, one structure · review, project, dispatch
          </p>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/85">
            <span>Prototype</span>
            <span className="tabular font-mono">v0.5.0</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
