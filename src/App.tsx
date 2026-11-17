import { useEffect, useRef, useState } from 'react'
import { Sidebar, type Page } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { PromptsWorkspace } from './components/prompts/PromptsWorkspace'
import { SkillsTabs } from './components/skills/SkillsTabs'
import { McpTabs } from './components/mcp/McpTabs'
import { SettingsView } from './components/settings/SettingsView'
import { useStore } from './store/store'

export default function App() {
  const { state } = useStore()
  const [page, setPage] = useState<Page>('prompts')
  const [query, setQuery] = useState('')
  const [createSignal, setCreateSignal] = useState({ n: 0, page: 'prompts' as Page })
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'n' || e.key === 'N') {
        if (page !== 'settings') setCreateSignal((s) => ({ n: s.n + 1, page }))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [page])

  return (
    <div className="flex h-full">
      <Sidebar
        page={page}
        onNavigate={(p) => {
          setPage(p)
          setQuery('')
        }}
        counts={{
          prompts: state.prompts.length,
          skills: state.skills.length,
          mcps: state.mcps.length,
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar ref={searchRef} page={page} query={query} onQueryChange={setQuery} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {page === 'prompts' && <PromptsWorkspace query={query} createSignal={createSignal} />}
          {page === 'skills' && <SkillsTabs query={query} />}
          {page === 'mcp' && <McpTabs query={query} createSignal={{ n: createSignal.n, page: createSignal.page }} />}
          {page === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  )
}
