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
    toast[ok ? 'success' : 'error'](ok ? `Copied "${item.title}" to clipboard` : 'Copy failed; check clipboard permissions')
  }

  const saveLocal = (item: PromptPlatformItem) => {
    if (localTitles.has(item.title)) {
      toast.warning('A local Prompt with this title exists; rename the local one first, or just copy and use it')
      return
    }
    savePrompt({
      id: uid(),
      title: item.title,
      description: item.description,
      systemPrompt: item.systemPrompt,
      userPrompt: item.userPrompt,
      folder: `platform/${item.category}`,
      tags: item.tags,
      isFavorite: false,
      isPinned: false,
      usageCount: 0,
      variables: item.variables,
      syncPolicy: 'inherit',
      inRepo: false,
      versions: [
        {
          id: uid(),
          version: 1,
          note: `From platform · ${item.author}`,
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
    toast.success('Saved to My Prompts; follows repo policy by default — switch to local only on the detail page')
    setDetailOf(null)
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>Platform Discovery</b> is the main entry point for reusing Prompts: search, preview, fill in variables, and copy.
          After saving locally, whether a Prompt joins Git sync depends on its sync scope; platform sources themselves never enter your repo or the Agent directories.
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCategory('')}
          aria-pressed={!category}
          className={`cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors ${
            !category
              ? 'border-primary/40 bg-primary-soft font-medium text-primary'
              : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted'
          }`}
        >
          All categories
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={`cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors ${
              category === c
                ? 'border-primary/40 bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted'
            }`}
          >
            {c}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {SEED_PLATFORM_PROMPTS.length} platform prompts · {localTitles.size} saved locally
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="search" title="No matching prompts" description="Try another keyword or category; platform search matches titles, descriptions, and tags only" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDetailOf(p)}
              className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft text-primary">
                  <Icon name="message" className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium leading-5">{p.title}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {p.author} · {p.category}
                  </div>
                </div>
                {localTitles.has(p.title) && (
                  <Badge variant="success" className="ml-auto shrink-0">
                    In library
                  </Badge>
                )}
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">{p.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                {p.tags.slice(0, 2).map((t) => (
                  <Badge key={t} variant="primary">
                    {t}
                  </Badge>
                ))}
                {p.variables.length > 0 && <Badge variant="info">{`{{}} × ${p.variables.length}`}</Badge>}
                <span className="tabular ml-auto text-[10.5px] text-muted-foreground">{p.uses.toLocaleString('en-US')} uses</span>
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
          subtitle={`${detailOf.author} · ${detailOf.category} · Updated ${formatDate(detailOf.updatedAt, false)} · ${detailOf.uses.toLocaleString('en-US')} uses`}
          footer={
            <>
              <span className="mr-auto text-[11px] text-muted-foreground">Platform items are ready to use; saving is optional</span>
              <Button variant="outline" onClick={() => setDetailOf(null)}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (detailOf.variables.length) setCopyOf(detailOf)
                  else void doCopy(detailOf)
                }}
              >
                <Icon name="copy" />
                Copy to use
              </Button>
              <Button disabled={localTitles.has(detailOf.title)} onClick={() => saveLocal(detailOf)}>
                <Icon name="download" />
                {localTitles.has(detailOf.title) ? 'Already saved locally' : 'Save locally'}
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
                <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">System Prompt<span className="h-px flex-1 bg-border/70" /></h3>
                <Markdown text={detailOf.systemPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm" />
              </section>
            )}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">User Prompt<span className="h-px flex-1 bg-border/70" /></h3>
              <Markdown text={detailOf.userPrompt} className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm" />
            </section>
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              Platform prompts never write to your Git repo; once saved locally they appear only in My Prompts on this machine and are not dispatched to Agents automatically.
            </p>
          </div>
        </Modal>
      )}

      {copyOf && (
        <VariableFormModal
          open
          title={`Copy "${copyOf.title}" — Fill variables`}
          vars={copyOf.variables}
          promptId={`platform-${copyOf.id}`}
          submitText="Copy to clipboard"
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
