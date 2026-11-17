import { useState } from 'react'
import type { Prompt } from '../../types'
import { Badge, Button, Textarea } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { Markdown } from '../shared/Markdown'
import { useStore } from '../../store/store'

type InlineField = 'title' | 'description' | 'systemPrompt' | 'userPrompt'

function InlineEditable({
  field,
  prompt,
  multiline,
  className,
  children,
}: {
  field: InlineField
  prompt: Prompt
  multiline: boolean
  className?: string
  children: React.ReactNode
}) {
  const { savePrompt } = useStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <div className={cn('rounded-lg border border-ring/50 bg-card p-2', className)}>
        <Textarea
          autoFocus
          rows={multiline ? 8 : 2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              savePrompt({ ...prompt, [field]: draft, updatedAt: new Date().toISOString() })
              setEditing(false)
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>⌘Enter 保存 · Esc 取消</span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              savePrompt({ ...prompt, [field]: draft, updatedAt: new Date().toISOString() })
              setEditing(false)
            }}
          >
            保存
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('group relative cursor-text rounded-lg', className)}
      onDoubleClick={() => {
        setDraft(prompt[field])
        setEditing(true)
      }}
      title="双击进入 inline 编辑"
    >
      {children}
      <span className="absolute right-1.5 top-1.5 hidden items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:flex">
        <Icon name="pencil" className="h-3 w-3" />
        双击编辑
      </span>
    </div>
  )
}

export function PromptDetail({
  prompt,
  onEdit,
  onTest,
  onCopy,
  onDelete,
  onShowVersions,
}: {
  prompt: Prompt
  onEdit: () => void
  onTest: () => void
  onCopy: () => void
  onDelete: () => void
  onShowVersions: () => void
}) {
  const { togglePromptFavorite, togglePromptPin } = useStore()
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start gap-2">
          <h2 className="text-base font-semibold">{prompt.title}</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              title={prompt.isFavorite ? '取消收藏' : '收藏'}
              onClick={() => togglePromptFavorite(prompt.id)}
            >
              <Icon name="star" className={prompt.isFavorite ? 'text-warning' : ''} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title={prompt.isPinned ? '取消置顶' : '置顶'}
              onClick={() => togglePromptPin(prompt.id)}
            >
              <Icon name="pin" className={prompt.isPinned ? 'text-primary' : ''} />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{prompt.description || '（无描述）'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {prompt.folder && (
            <Badge variant="secondary">
              <Icon name="folder" className="h-3 w-3" />
              {prompt.folder}
            </Badge>
          )}
          {prompt.tags.map((t) => (
            <Badge key={t} variant="primary">
              <Icon name="tag" className="h-3 w-3" />
              {t}
            </Badge>
          ))}
          <Badge variant="outline">v{prompt.versions[0]?.version ?? 1}</Badge>
          <Badge variant="outline">用 {prompt.usageCount} 次</Badge>
          <span className="ml-auto text-[11px] text-muted-foreground">更新于 {formatDate(prompt.updatedAt)}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={onCopy}>
            <Icon name="copy" />
            复制 Prompt
          </Button>
          <Button variant="outline" onClick={onTest}>
            <Icon name="flask" />
            AI 测试
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Icon name="pencil" />
            编辑
          </Button>
          <Button variant="outline" onClick={onShowVersions}>
            <Icon name="history" />
            版本
          </Button>
          <Button variant="ghost" className="ml-auto text-danger" onClick={onDelete}>
            <Icon name="trash" />
            删除
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {prompt.systemPrompt && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Prompt</h3>
            <InlineEditable field="systemPrompt" prompt={prompt} multiline>
              <Markdown text={prompt.systemPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3" />
            </InlineEditable>
          </section>
        )}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">User Prompt</h3>
          <InlineEditable field="userPrompt" prompt={prompt} multiline>
            <Markdown text={prompt.userPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3" />
          </InlineEditable>
        </section>
        {prompt.variables.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              模板变量（{prompt.variables.length}）
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {prompt.variables.map((v) => (
                <Badge key={v.name} variant="info">
                  {`{{${v.name}}}`}
                  {v.type !== 'text' && ` · ${v.type}`}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">复制或测试时会弹表单填值，值保留 30 天自动记忆。</p>
          </section>
        )}
      </div>
    </div>
  )
}
