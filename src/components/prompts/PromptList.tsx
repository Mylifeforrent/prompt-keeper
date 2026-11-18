import type { Prompt } from '../../types'
import { formatDate, cn } from '../../lib/utils'
import { Icon } from '../../lib/icons'
import { Badge, Button, EmptyState } from '../ui/core'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { folderLabel, folderToRepoPath } from '../../lib/folders'

export type PromptViewMode = 'card' | 'table'

export function PromptList({
  prompts,
  view,
  selectedId,
  onSelect,
  hasFilter,
  onClearFilter,
  onCreate,
}: {
  prompts: Prompt[]
  view: PromptViewMode
  selectedId: string | null
  onSelect: (id: string) => void
  hasFilter: boolean
  onClearFilter: () => void
  onCreate: () => void
}) {
  if (prompts.length === 0) {
    return hasFilter ? (
      <EmptyState
        icon="search"
        title="未找到匹配结果"
        description="搜索词、标签、收藏或文件夹筛选可能过窄"
        action={
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            清除全部筛选
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon="message"
        title="还没有 Prompt"
        description="新建第一个 Prompt，用 {{变量名}} 定义模板变量"
        action={
          <Button onClick={onCreate}>
            <Icon name="plus" />
            新建 Prompt
          </Button>
        }
      />
    )
  }

  if (view === 'table') {
    return (
      <div className="px-3 pb-4">
        <table className="w-full table-fixed text-left text-[13px]">
          <colgroup>
            <col />
            <col className="w-[88px]" />
            <col className="w-[64px]" />
            <col className="w-[58px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background/95 text-[10.5px] text-muted-foreground backdrop-blur">
            <tr className="border-b border-border">
              <th className="py-2.5 pl-1 pr-2 font-medium">标题</th>
              <th className="py-2.5 pr-2 font-medium">文件夹</th>
              <th className="py-2.5 pr-2 font-medium">同步</th>
              <th className="py-2.5 font-medium">更新</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((p) => (
              <tr
                key={p.id}
                tabIndex={0}
                onClick={() => onSelect(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(p.id)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50',
                  selectedId === p.id && 'bg-primary-soft/50',
                )}
              >
                <td className="py-2.5 pl-1 pr-2">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    {p.isPinned && <Icon name="pin" className="h-3 w-3 shrink-0 text-primary" />}
                    {p.isFavorite && <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-warning" />}
                    <span className="truncate">{p.title}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-2 text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Icon name="folder" className="h-3 w-3 shrink-0" />
                    <span className="truncate">{folderLabel(p.folder)}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-2">
                  <AssetSyncBadge
                    kind="prompt"
                    name={p.title}
                    assetId={p.id}
                    policy={p.syncPolicy}
                    compact
                  />
                </td>
                <td className="tabular whitespace-nowrap py-2.5 text-[10px] text-muted-foreground">
                  {formatDate(p.updatedAt, false).slice(5)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const groups = groupPromptsByFolder(prompts)

  return (
    <div className="space-y-4 px-3 pb-4">
      {groups.map((group) => (
        <section key={group.folder ?? '__unfiled__'}>
          <div className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center gap-1.5 bg-background/90 px-1 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
            <Icon name="folder" className="h-3 w-3" />
            <span className="truncate font-medium text-foreground/80">{folderLabel(group.folder)}</span>
            <span className="tabular rounded bg-muted px-1 text-[10px] leading-4">{group.prompts.length}</span>
            <span className="ml-auto hidden truncate font-mono text-[9.5px] text-muted-foreground/85 sm:block">
              prompts/{folderToRepoPath(group.folder)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5">
            {group.prompts.map((p) => {
              const active = selectedId === p.id
              const more = p.tags.length - 2
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'group flex cursor-pointer flex-col rounded-xl border bg-card p-3.5 text-left transition-all duration-150',
                    'hover:-translate-y-px hover:border-primary/35 hover:shadow-md',
                    active
                      ? 'border-primary/55 bg-primary-soft/25 ring-1 ring-primary/15'
                      : 'border-border',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium leading-5">{p.title}</span>
                        {p.isPinned && <Icon name="pin" className="h-3 w-3 shrink-0 text-primary" />}
                        {p.isFavorite && <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-warning" />}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {p.description || '（无描述）'}
                      </p>
                    </div>
                    <span className="tabular mt-0.5 shrink-0 text-[10px] text-muted-foreground">
                      {formatDate(p.updatedAt, false)}
                    </span>
                  </div>

                  <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 transition-colors group-hover:bg-muted/70">
                    <p className="line-clamp-2 font-mono text-[10.5px] leading-4 text-muted-foreground">
                      {p.systemPrompt || p.userPrompt}
                    </p>
                  </div>

                  <div className="mt-2.5 flex flex-nowrap items-center gap-1.5 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                      {p.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="primary" className="shrink-0 font-normal">
                          {t}
                        </Badge>
                      ))}
                      {more > 0 && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">+{more}</span>
                      )}
                      {p.variables.length > 0 && (
                        <Badge variant="info" className="shrink-0 px-1.5 font-normal">
                          {`{{}}×${p.variables.length}`}
                        </Badge>
                      )}
                      <AssetSyncBadge
                        kind="prompt"
                        name={p.title}
                        assetId={p.id}
                        policy={p.syncPolicy}
                        compact
                      />
                    </div>
                    <span
                      className="tabular ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground"
                      title={`使用 ${p.usageCount} 次 · ${p.versions.length} 个版本`}
                    >
                      用 {p.usageCount} · v{p.versions[0]?.version ?? 1}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function groupPromptsByFolder(prompts: Prompt[]): { folder: string | null; prompts: Prompt[] }[] {
  const groups = new Map<string, { folder: string | null; prompts: Prompt[] }>()
  for (const prompt of prompts) {
    const key = prompt.folder ?? '__unfiled__'
    const group = groups.get(key) ?? { folder: prompt.folder, prompts: [] }
    group.prompts.push(prompt)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.folder === null) return 1
    if (b.folder === null) return -1
    return a.folder.localeCompare(b.folder, 'zh')
  })
}
