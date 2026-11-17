import type { Prompt } from '../../types'
import { formatDate, cn } from '../../lib/utils'
import { Icon } from '../../lib/icons'
import { Badge, Button, EmptyState } from '../ui/core'

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
      <div className="px-4 pb-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">标题</th>
              <th className="py-2 pr-3 font-medium">标签</th>
              <th className="py-2 pr-3 font-medium">变量</th>
              <th className="py-2 pr-3 font-medium">使用次数</th>
              <th className="py-2 font-medium">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((p) => (
              <tr
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/60',
                  selectedId === p.id && 'bg-primary-soft',
                )}
              >
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-1.5 font-medium">
                    {p.isPinned && <Icon name="pin" className="h-3 w-3 text-primary" />}
                    {p.isFavorite && <Icon name="star" className="h-3.5 w-3.5 text-warning" />}
                    {p.title}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{p.variables.length}</td>
                <td className="py-2 pr-3 text-muted-foreground">{p.usageCount}</td>
                <td className="py-2 text-muted-foreground">{formatDate(p.updatedAt, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 px-4 pb-4">
      {prompts.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className={cn(
            'flex cursor-pointer flex-col rounded-xl border bg-card p-3.5 text-left transition-all hover:border-primary/40 hover:shadow-md',
            selectedId === p.id ? 'border-primary ring-2 ring-ring/20' : 'border-border',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{p.title}</span>
            {p.isPinned && <Icon name="pin" className="h-3.5 w-3.5 text-primary" />}
            {p.isFavorite && <Icon name="star" className="h-3.5 w-3.5 text-warning" />}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatDate(p.updatedAt, false)}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.description || '（无描述）'}</p>
          <p className="mt-2 line-clamp-2 min-h-8 flex-1 whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-4 text-muted-foreground">
            {(p.systemPrompt || p.userPrompt).slice(0, 120)}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {p.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="primary">
                {t}
              </Badge>
            ))}
            {p.variables.length > 0 && <Badge variant="info">{`{{}} × ${p.variables.length}`}</Badge>}
            <span className="ml-auto text-[11px] text-muted-foreground">用 {p.usageCount} 次 · {p.versions.length} 版本</span>
          </div>
        </button>
      ))}
    </div>
  )
}
