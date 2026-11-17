import { forwardRef } from 'react'
import { Badge, Input } from '../ui/core'
import { Icon } from '../../lib/icons'
import type { ThemeMode } from '../../types'
import { useStore } from '../../store/store'
import { syncCounts } from '../../lib/sync'
import type { Page } from './Sidebar'

const TITLES: Record<Page, string> = {
  prompts: 'Prompts',
  skills: 'Skills',
  mcp: 'MCP',
  sync: '同步中心',
  settings: '设置',
}

export const Topbar = forwardRef<
  HTMLInputElement,
  { page: Page; query: string; onQueryChange: (q: string) => void; onNavigate: (p: Page) => void }
>(function Topbar({ page, query, onQueryChange, onNavigate }, ref) {
    const { state, setTheme } = useStore()
    const pending = syncCounts(state.syncChanges, state.deployments, state.mcps).pending

    const cycleTheme = () => {
      const order: ThemeMode[] = ['light', 'dark', 'system']
      const next = order[(order.indexOf(state.settings.theme) + 1) % 3]
      setTheme(next)
    }

    const themeIcon = state.settings.theme === 'dark' ? 'moon' : state.settings.theme === 'light' ? 'sun' : 'refresh'

    return (
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-5">
        <h1 className="text-sm font-semibold">{TITLES[page]}</h1>
        <div className="relative ml-auto w-72">
          <Icon name="search" className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={ref}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="全局搜索…  按 / 聚焦"
            className="h-9 pl-8"
          />
        </div>
        <button
          type="button"
          onClick={cycleTheme}
          title={`主题：${state.settings.theme}（点击切换）`}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon name={themeIcon} />
        </button>
        <button
          type="button"
          onClick={() => onNavigate('sync')}
          title="打开同步中心"
          className="hidden h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted lg:flex"
        >
          <Icon name="gitBranch" className="h-3.5 w-3.5" />
          <span className="max-w-36 truncate font-mono text-[11px]">
            {state.repo.connected ? state.repo.url : '未连接仓库'}
          </span>
          {state.repo.connected ? (
            pending > 0 ? (
              <Badge variant="warning">{pending} 待处理</Badge>
            ) : (
              <Badge variant="success">
                <Icon name="check" className="h-3 w-3" />
                已同步
              </Badge>
            )
          ) : (
            <Badge variant="warning">去连接</Badge>
          )}
        </button>
      </header>
    )
  },
)
