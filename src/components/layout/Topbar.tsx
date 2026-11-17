import { forwardRef } from 'react'
import { Input } from '../ui/core'
import { Icon } from '../../lib/icons'
import type { ThemeMode } from '../../types'
import { useStore } from '../../store/store'
import type { Page } from './Sidebar'

const TITLES: Record<Page, string> = {
  prompts: 'Prompts',
  skills: 'Skills',
  mcp: 'MCP',
  settings: '设置',
}

export const Topbar = forwardRef<HTMLInputElement, { page: Page; query: string; onQueryChange: (q: string) => void }>(
  function Topbar({ page, query, onQueryChange }, ref) {
    const { state, setTheme } = useStore()

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
        <div className="flex items-center h-9 rounded-lg bg-muted px-3 text-xs text-muted-foreground">
          {state.prompts.length} Prompts · {state.skills.length} Skills · {state.mcps.length} MCP
        </div>
      </header>
    )
  },
)
