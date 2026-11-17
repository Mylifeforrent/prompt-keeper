import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../layout/Sidebar'
import type { Prompt } from '../../types'
import { useStore } from '../../store/store'
import { Button, Select } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { copyToClipboard } from '../../lib/utils'
import { PromptList, type PromptViewMode } from './PromptList'
import { PromptDetail } from './PromptDetail'
import { PromptEditModal } from './PromptEditModal'
import { AiTestDrawer } from './AiTestDrawer'
import { VariableFormModal } from '../shared/VariableForm'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { ConfirmDialog } from '../ui/modal'
import { useToast } from '../ui/toast'
import { renderTemplate } from '../../lib/variables'

export function PromptsWorkspace({
  query,
  createSignal,
}: {
  query: string
  createSignal: { n: number; page: Page }
}) {
  const { state, savePrompt, deletePrompt, markPromptUsed, restorePromptVersion, deletePromptVersion } = useStore()
  const toast = useToast()

  const [view, setView] = useState<PromptViewMode>(
    () => (localStorage.getItem('pk_prompt_view') as PromptViewMode) || 'card',
  )
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [favOnly, setFavOnly] = useState(false)
  const [folderFilter, setFolderFilter] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title' | 'usage'>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(state.prompts[0]?.id ?? null)

  const [editing, setEditing] = useState<{ open: boolean; prompt: Prompt | null }>({ open: false, prompt: null })
  const [versionOf, setVersionOf] = useState<Prompt | null>(null)
  const [testOf, setTestOf] = useState<Prompt | null>(null)
  const [varCopy, setVarCopy] = useState<Prompt | null>(null)
  const [deleteOf, setDeleteOf] = useState<Prompt | null>(null)

  useEffect(() => {
    if (createSignal.page === 'prompts' && createSignal.n > 0) {
      setEditing({ open: true, prompt: null })
    }
  }, [createSignal])

  useEffect(() => {
    localStorage.setItem('pk_prompt_view', view)
  }, [view])

  const allTags = useMemo(() => [...new Set(state.prompts.flatMap((p) => p.tags))].sort(), [state.prompts])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = state.prompts.filter((p) => {
      if (favOnly && !p.isFavorite) return false
      if (folderFilter && p.folder !== folderFilter) return false
      if (tagFilter.length && !tagFilter.every((t) => p.tags.includes(t))) return false
      if (q) {
        const hay = [p.title, p.description, p.systemPrompt, p.userPrompt, p.tags.join(' ')].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      switch (sortBy) {
        case 'created':
          return b.createdAt.localeCompare(a.createdAt)
        case 'title':
          return a.title.localeCompare(b.title, 'zh')
        case 'usage':
          return b.usageCount - a.usageCount
        default:
          return b.updatedAt.localeCompare(a.updatedAt)
      }
    })
    return list
  }, [state.prompts, query, favOnly, folderFilter, tagFilter, sortBy])

  const selected = filtered.find((p) => p.id === selectedId) ?? filtered[0] ?? null

  const doCopy = async (prompt: Prompt, values?: Record<string, string>) => {
    const rendered = values
      ? renderTemplate(prompt.systemPrompt, values) + '\n\n' + renderTemplate(prompt.userPrompt, values)
      : prompt.systemPrompt + '\n\n' + prompt.userPrompt
    const ok = await copyToClipboard(rendered.trim())
    markPromptUsed(prompt.id)
    toast[ok ? 'success' : 'error'](ok ? `已复制「${prompt.title}」到剪贴板，用量 +1` : '复制失败，请检查浏览器剪贴板权限')
  }

  const hasFilter = !!query.trim() || favOnly || !!folderFilter || tagFilter.length > 0

  return (
    <div className="flex h-full min-h-0">
      {/* 列表栏 */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Select className="h-8 flex-1 text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="updated">按更新时间</option>
              <option value="created">按创建时间</option>
              <option value="title">按标题</option>
              <option value="usage">按使用次数</option>
            </Select>
            <Select
              className="h-8 w-28 text-xs"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
            >
              <option value="">全部文件夹</option>
              {[...new Set(state.prompts.map((p) => p.folder).filter(Boolean))].map((f) => (
                <option key={f} value={f as string}>
                  {f}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => setFavOnly((f) => !f)}
              className={cn(
                'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                favOnly ? 'border-warning bg-warning-soft text-warning' : 'border-input text-muted-foreground hover:bg-muted',
              )}
              title="只看收藏"
            >
              <Icon name="star" className="h-4 w-4" />
            </button>
            <div className="inline-flex h-8 items-center rounded-lg border border-input p-0.5">
              {(
                [
                  { v: 'card' as const, icon: 'grid' as const },
                  { v: 'table' as const, icon: 'sliders' as const },
                ]
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setView(t.v)}
                  className={cn(
                    'flex h-6 w-7 cursor-pointer items-center justify-center rounded-md',
                    view === t.v ? 'bg-muted text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon name={t.icon} className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {allTags.map((t) => {
              const active = tagFilter.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter((prev) => (active ? prev.filter((x) => x !== t) : [...prev, t]))}
                  className={cn(
                    'cursor-pointer rounded-md border px-1.5 py-0.5 text-[11px] transition-colors',
                    active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  #{t}
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          <PromptList
            prompts={filtered}
            view={view}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            hasFilter={hasFilter}
            onClearFilter={() => {
              setTagFilter([])
              setFavOnly(false)
              setFolderFilter('')
            }}
            onCreate={() => setEditing({ open: true, prompt: null })}
          />
        </div>

        <div className="flex items-center border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {filtered.length} / {state.prompts.length} 条
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ open: true, prompt: null })}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            新建（N）
          </Button>
        </div>
      </div>

      {/* 详情栏 */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <PromptDetail
            prompt={selected}
            onEdit={() => setEditing({ open: true, prompt: selected })}
            onTest={() => setTestOf(selected)}
            onCopy={() => (selected.variables.length ? setVarCopy(selected) : void doCopy(selected))}
            onDelete={() => setDeleteOf(selected)}
            onShowVersions={() => setVersionOf(selected)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            左侧选择一个 Prompt 查看详情
          </div>
        )}
      </div>

      {/* 弹层 */}
      <PromptEditModal open={editing.open} prompt={editing.prompt} onClose={() => setEditing({ open: false, prompt: null })} />

      {varCopy && (
        <VariableFormModal
          open
          title={`复制「${varCopy.title}」— 填写变量`}
          vars={varCopy.variables}
          promptId={varCopy.id}
          submitText="复制到剪贴板"
          onClose={() => setVarCopy(null)}
          onSubmit={(values) => {
            void doCopy(varCopy, values)
            setVarCopy(null)
          }}
        />
      )}

      {versionOf && (
        <VersionHistoryModal
          open
          onClose={() => setVersionOf(null)}
          title={`版本历史 — ${versionOf.title}`}
          versions={versionOf.versions}
          fields={[
            { key: 'title', label: '标题' },
            { key: 'description', label: '描述' },
            { key: 'systemPrompt', label: 'System Prompt' },
            { key: 'userPrompt', label: 'User Prompt' },
          ]}
          onRestore={(v) => {
            restorePromptVersion(versionOf.id, v.id)
            toast.success(`已恢复 v${v.version}，当前内容已另存为新版本`)
          }}
          onDeleteVersion={(vid) => {
            deletePromptVersion(versionOf.id, vid)
            toast.success('已删除该历史版本')
          }}
        />
      )}

      {testOf && <AiTestDrawer prompt={testOf} onClose={() => setTestOf(null)} />}

      <ConfirmDialog
        open={!!deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={() => {
          if (deleteOf) {
            deletePrompt(deleteOf.id)
            setSelectedId(null)
            toast.success(`已删除「${deleteOf.title}」`)
          }
        }}
        title="删除 Prompt？"
        message={
          <>
            将删除「<b className="text-foreground">{deleteOf?.title}</b>」及其全部 {deleteOf?.versions.length ?? 0} 个历史版本，此操作不可撤销。
          </>
        }
      />
    </div>
  )
}
