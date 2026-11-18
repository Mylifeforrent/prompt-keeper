import { useState } from 'react'
import type { Prompt } from '../../types'
import { Badge, Button, Textarea } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { Markdown } from '../shared/Markdown'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { useStore } from '../../store/store'
import { promptFilePath } from '../../lib/promptSync'

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
  const label = field === 'systemPrompt' ? 'System Prompt' : 'User Prompt'

  if (editing) {
    return (
      <div className={cn('rounded-lg border border-ring/50 bg-card p-2 shadow-sm', className)}>
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
            className="ml-auto h-7"
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
      className={cn(
        'group relative cursor-text rounded-lg transition-[box-shadow,background-color]',
        'hover:bg-muted/25 hover:ring-1 hover:ring-border',
        className,
      )}
      onDoubleClick={() => {
        setDraft(prompt[field])
        setEditing(true)
      }}
      title="双击进入 inline 编辑"
    >
      {children}
      <button
        type="button"
        onClick={() => {
          setDraft(prompt[field])
          setEditing(true)
        }}
        aria-label={`编辑 ${label}`}
        className="absolute right-2 top-2 hidden h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[10px] text-muted-foreground shadow-sm transition-colors hover:text-foreground group-focus-within:flex group-hover:flex"
      >
        <Icon name="pencil" className="h-3 w-3" />
        编辑
      </button>
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
  onSync,
}: {
  prompt: Prompt
  onEdit: () => void
  onTest: () => void
  onCopy: () => void
  onDelete: () => void
  onShowVersions: () => void
  onSync: () => void
}) {
  const { state, togglePromptFavorite, togglePromptPin } = useStore()
  return (
    <div className="flex h-full min-h-0 flex-col bg-background/30">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-[17px] font-semibold leading-6 tracking-tight">{prompt.title}</h2>
              {prompt.isPinned && <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {prompt.description || '（无描述）'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={prompt.isFavorite ? '取消收藏' : '收藏'}
              aria-pressed={prompt.isFavorite}
              title={prompt.isFavorite ? '取消收藏' : '收藏'}
              onClick={() => togglePromptFavorite(prompt.id)}
            >
              <Icon
                name="star"
                className={cn('h-4 w-4', prompt.isFavorite ? 'fill-warning/20 text-warning' : '')}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={prompt.isPinned ? '取消置顶' : '置顶'}
              aria-pressed={prompt.isPinned}
              title={prompt.isPinned ? '取消置顶' : '置顶'}
              onClick={() => togglePromptPin(prompt.id)}
            >
              <Icon name="pin" className={cn('h-4 w-4', prompt.isPinned ? 'text-primary' : '')} />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border/80" />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="删除 Prompt"
              title="删除"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {prompt.folder && (
            <Badge variant="secondary" className="font-normal">
              <Icon name="folder" className="h-3 w-3" />
              {prompt.folder}
            </Badge>
          )}
          {prompt.tags.map((t) => (
            <Badge key={t} variant="primary" className="font-normal">
              #{t}
            </Badge>
          ))}
          <Badge variant="outline" className="tabular">
            v{prompt.versions[0]?.version ?? 1}
          </Badge>
          <Badge variant="outline" className="tabular">
            用 {prompt.usageCount} 次
          </Badge>
          <AssetSyncBadge
            kind="prompt"
            name={prompt.title}
            assetId={prompt.id}
            policy={prompt.syncPolicy}
          />
          <span className="tabular ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">
            更新于 {formatDate(prompt.updatedAt)}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Icon name="gitBranch" className="h-3 w-3 shrink-0" />
          <span className="shrink-0">仓库文件</span>
          <code className="truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
            {promptFilePath(prompt, state.repo.layout.prompts)}
          </code>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={onCopy} className="shadow-sm">
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
          <Button variant="outline" onClick={onSync}>
            <Icon name="gitBranch" />
            同步
          </Button>
          <Button variant="outline" onClick={onShowVersions}>
            <Icon name="history" />
            版本
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {prompt.systemPrompt && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              System Prompt
              <span className="h-px flex-1 bg-border/70" />
            </h3>
            <InlineEditable field="systemPrompt" prompt={prompt} multiline>
              <Markdown
                text={prompt.systemPrompt}
                className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
              />
            </InlineEditable>
          </section>
        )}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            User Prompt
            <span className="h-px flex-1 bg-border/70" />
          </h3>
          <InlineEditable field="userPrompt" prompt={prompt} multiline>
            <Markdown
              text={prompt.userPrompt}
              className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
            />
          </InlineEditable>
        </section>
        {prompt.variables.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              模板变量（{prompt.variables.length}）
              <span className="h-px flex-1 bg-border/70" />
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {prompt.variables.map((v) => (
                <Badge key={v.name} variant="info" className="gap-1.5 px-2 py-1 font-mono text-[11px] font-normal">
                  {`{{${v.name}}}`}
                  {v.type !== 'text' && (
                    <span className="text-[9.5px] uppercase tracking-wide opacity-70">{v.type}</span>
                  )}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              复制或测试时会弹表单填值，值保留 30 天自动记忆。
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
