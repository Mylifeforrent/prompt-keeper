import { cn } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

export type Page = 'prompts' | 'skills' | 'mcp' | 'settings'

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: 'prompts', label: 'Prompts', icon: 'message' },
  { id: 'skills', label: 'Skills', icon: 'grid' },
  { id: 'mcp', label: 'MCP', icon: 'zap' },
  { id: 'settings', label: '设置', icon: 'sliders' },
]

export function Sidebar({
  page,
  onNavigate,
  counts,
}: {
  page: Page
  onNavigate: (p: Page) => void
  counts: { prompts: number; skills: number; mcps: number }
}) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon name="sparkles" className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold">Prompt Keeper</span>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 px-2">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onNavigate(n.id)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              page === n.id ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon name={n.icon} className="h-4 w-4" />
            {n.label}
            {n.id !== 'settings' && (
              <span className="ml-auto rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">
                {counts[n.id as keyof typeof counts]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-3 text-[11px] leading-5 text-muted-foreground">
        本地优先 · 数据存本机
        <br />
        原型 v0.1.0
      </div>
    </aside>
  )
}
