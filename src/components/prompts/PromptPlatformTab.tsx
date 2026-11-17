import { useMemo, useState } from 'react'
import type { PromptPlatformItem } from '../../types'
import { useStore } from '../../store/store'
import { SEED_PLATFORM_PROMPTS } from '../../data/syncSeed'
import { Badge, Button, EmptyState } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { useToast } from '../ui/toast'
import { copyToClipboard, formatDate, nowIso, uid } from '../../lib/utils'
import { renderTemplate } from '../../lib/variables'
import { Markdown } from '../shared/Markdown'
import { VariableFormModal } from '../shared/VariableForm'

export function PromptPlatformTab({ query }: { query: string }) {
  const { state, savePrompt } = useStore()
  const toast = useToast()
  const [category, setCategory] = useState('')
  const [detailOf, setDetailOf] = useState<PromptPlatformItem | null>(null)
  const [copyOf, setCopyOf] = useState<PromptPlatformItem | null>(null)

  const categories = useMemo(() => [...new Set(SEED_PLATFORM_PROMPTS.map((p) => p.category))], [])
  const localTitles = new Set(state.prompts.map((p) => p.title))
  const q = query.trim().toLowerCase()
  const list = SEED_PLATFORM_PROMPTS.filter((p) => {
    if (category && p.category !== category) return false
    if (q && ![p.title, p.description, p.tags.join(' '), p.author].join(' ').toLowerCase().includes(q)) return false
    return true
  })

  const doCopy = async (item: PromptPlatformItem, values?: Record<string, string>) => {
    const system = values ? renderTemplate(item.systemPrompt, values) : item.systemPrompt
    const user = values ? renderTemplate(item.userPrompt, values) : item.userPrompt
    const ok = await copyToClipboard(`${system}\n\n${user}`.trim())
    toast[ok ? 'success' : 'error'](ok ? `已复制「${item.title}」到剪贴板` : '复制失败，请检查剪贴板权限')
  }

  const saveLocal = (item: PromptPlatformItem) => {
    if (localTitles.has(item.title)) {
      toast.warning('本地已有同名 Prompt；请先在本地重命名，或直接复制使用')
      return
    }
    savePrompt({
      id: uid(),
      title: item.title,
      description: item.description,
      systemPrompt: item.systemPrompt,
      userPrompt: item.userPrompt,
      folder: '默认',
      tags: item.tags,
      isFavorite: false,
      isPinned: false,
      usageCount: 0,
      variables: item.variables,
      versions: [
        {
          id: uid(),
          version: 1,
          note: `来自平台 · ${item.author}`,
          createdAt: nowIso(),
          data: {
            title: item.title,
            description: item.description,
            systemPrompt: item.systemPrompt,
            userPrompt: item.userPrompt,
          },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    toast.success('已保存到我的 Prompt；它只在本机，不参与 Git 同步')
    setDetailOf(null)
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>平台发现</b>是 Prompt 的主要复用入口：搜索、预览、填变量后直接复制。
          Prompt 默认<b>不进入 Git 仓库、也不分发到 Agent</b>，避免把复制粘贴型资产变成仓库噪音。
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCategory('')}
          className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${
            !category ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground'
          }`}
        >
          全部分类
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${
              category === c ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground'
            }`}
          >
            {c}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          平台收录 {SEED_PLATFORM_PROMPTS.length} 条 · 本地已存 {localTitles.size} 条
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="search" title="未找到匹配 Prompt" description="换个关键词或分类；平台搜索只匹配标题、描述与标签" />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDetailOf(p)}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon name="message" className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.author} · {p.category}
                  </div>
                </div>
                {localTitles.has(p.title) && (
                  <Badge variant="success" className="ml-auto shrink-0">
                    已在本地
                  </Badge>
                )}
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-xs leading-5 text-muted-foreground">{p.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {p.tags.slice(0, 2).map((t) => (
                  <Badge key={t} variant="primary">
                    {t}
                  </Badge>
                ))}
                {p.variables.length > 0 && <Badge variant="info">{`{{}} × ${p.variables.length}`}</Badge>}
                <span className="ml-auto text-[11px] text-muted-foreground">用 {p.uses.toLocaleString()} 次</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detailOf && (
        <Modal
          open
          onClose={() => setDetailOf(null)}
          width="max-w-3xl"
          title={detailOf.title}
          subtitle={`${detailOf.author} · ${detailOf.category} · 更新于 ${formatDate(detailOf.updatedAt, false)} · ${detailOf.uses.toLocaleString()} 次使用`}
          footer={
            <>
              <span className="mr-auto text-[11px] text-muted-foreground">平台来源可直接用，不必先保存</span>
              <Button variant="outline" onClick={() => setDetailOf(null)}>
                关闭
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (detailOf.variables.length) setCopyOf(detailOf)
                  else void doCopy(detailOf)
                }}
              >
                <Icon name="copy" />
                复制使用
              </Button>
              <Button disabled={localTitles.has(detailOf.title)} onClick={() => saveLocal(detailOf)}>
                <Icon name="download" />
                {localTitles.has(detailOf.title) ? '本地已存在' : '保存到本地'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {detailOf.tags.map((t) => (
                <Badge key={t} variant="primary">
                  {t}
                </Badge>
              ))}
              {detailOf.variables.map((v) => (
                <Badge key={v.name} variant="info">{`{{${v.name}}}`}</Badge>
              ))}
            </div>
            {detailOf.systemPrompt && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Prompt</h3>
                <Markdown text={detailOf.systemPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3" />
              </section>
            )}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">User Prompt</h3>
              <Markdown text={detailOf.userPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3" />
            </section>
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              平台 Prompt 不会写入你的 Git 仓库；保存到本地后仅在本机「我的 Prompt」可见，也不会自动分发到 Agent。
            </p>
          </div>
        </Modal>
      )}

      {copyOf && (
        <VariableFormModal
          open
          title={`复制「${copyOf.title}」— 填写变量`}
          vars={copyOf.variables}
          promptId={`platform-${copyOf.id}`}
          submitText="复制到剪贴板"
          onClose={() => setCopyOf(null)}
          onSubmit={(values) => {
            void doCopy(copyOf, values)
            setCopyOf(null)
          }}
        />
      )}
    </div>
  )
}
