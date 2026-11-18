import { useEffect, useRef, useState } from 'react'
import type { ModelOption, Prompt } from '../../types'
import { AI_MODELS } from '../../data/seed'
import { Badge, Button, Select, Spinner } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn, formatDate, uid } from '../../lib/utils'
import { loadVarCache, saveVarCache } from '../shared/VariableForm'
import { VariableFields } from '../shared/VariableForm'
import { Markdown } from '../shared/Markdown'

interface TestRun {
  id: string
  model: string
  output: string
  durationMs: number
  at: string
}

function mockResponse(prompt: Prompt, model: ModelOption, values: Record<string, string>): string {
  const varSummary =
    Object.entries(values)
      .map(([k, v]) => `- \`${k}\`: ${(v || '(empty)').slice(0, 40)}`)
      .join('\n') || 'None'
  return `(Simulated response · ${model.name})

Test run for "${prompt.title}" completed. The simulated output is below.

**Input Summary**
${varSummary}
- System Prompt: ${prompt.systemPrompt.length} characters

**Takeaways**
1. The output structure matches expectations and covers every input point.
2. Variables like "focus areas" benefit from more specific descriptions, which improves output stability.
3. The current System Prompt length is reasonable; no trimming needed.

> This response is a simulated stream from the prototype; the real product calls the model endpoint configured in Settings (OpenAI / Anthropic / Gemini / custom endpoint).`
}

export function AiTestDrawer({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const [model, setModel] = useState(AI_MODELS[0])
  const [tab, setTab] = useState<'run' | 'history'>('run')
  const [values, setValues] = useState<Record<string, string>>(() => loadVarCache(prompt.id))
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [history, setHistory] = useState<TestRun[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setValues(loadVarCache(prompt.id))
  }, [prompt.id])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', handler)
    }
  }, [onClose])

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  const run = () => {
    if (running) {
      if (timer.current) clearInterval(timer.current)
      setRunning(false)
      return
    }
    saveVarCache(prompt.id, values)
    const full = mockResponse(prompt, model, values)
    const started = performance.now()
    setRunning(true)
    setOutput('')
    let i = 0
    timer.current = setInterval(() => {
      i += 3 + Math.floor(Math.random() * 4)
      setOutput(full.slice(0, i))
      if (i >= full.length) {
        if (timer.current) clearInterval(timer.current)
        setRunning(false)
        setHistory((prev) => [
          {
            id: uid(),
            model: model.name,
            output: full,
            durationMs: Math.round(performance.now() - started),
            at: new Date().toISOString(),
          },
          ...prev,
        ])
      }
    }, 24)
  }

  const missingRequired = prompt.variables.filter((v) => v.required && !(values[v.name] ?? '').trim())

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)] backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`AI Test — ${prompt.title}`}
        className="animate-slide-in-right absolute inset-y-0 right-0 flex w-[460px] max-w-[100vw] flex-col border-l border-border bg-card shadow-[var(--shadow-float)]"
      >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon name="flask" className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">AI Test</h2>
        <span className="truncate text-[11px] text-muted-foreground">· {prompt.title}</span>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-8 w-8"
          onClick={onClose}
          aria-label="Close AI test"
          title="Close (Esc)"
        >
          <Icon name="x" />
        </Button>
      </div>

      <div className="flex items-center gap-2 px-4 pt-3">
        <div className="flex-1">
          <Select value={model.id} onChange={(e) => setModel(AI_MODELS.find((m) => m.id === e.target.value) ?? AI_MODELS[0])}>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={run} disabled={!running && missingRequired.length > 0} className="min-w-24">
          {running ? (
            <>
              <Spinner /> Stop
            </>
          ) : (
            <>
              <Icon name="play" />
              Run
            </>
          )}
        </Button>
      </div>
      {missingRequired.length > 0 && (
        <p className="px-4 pt-2 text-[11px] text-danger">{missingRequired.length} required variable(s) missing</p>
      )}

      {prompt.variables.length > 0 && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Variable values (remembered for 30 days)</div>
          <VariableFields
            vars={prompt.variables}
            values={values}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          />
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border px-4 pt-2.5">
        {(
          [
            { v: 'run', label: `Response${output ? '' : ' (empty)'}` },
            { v: 'history', label: `Test history (${history.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setTab(t.v)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-2 pb-2 text-xs font-medium',
              tab === t.v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'run' ? (
          output ? (
            <Markdown text={output} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {running ? 'Generating…' : 'Click "Run" to start a test; the rendered final Prompt is sent to the selected model.'}
            </p>
          )
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No test runs yet. The real product persists each run to SQLite (prompt_test_runs).</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <details key={h.id} className="rounded-lg border border-border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                  <Badge>{h.model}</Badge>
                  <span className="text-muted-foreground">{formatDate(h.at)}</span>
                  <span className="ml-auto text-muted-foreground">{(h.durationMs / 1000).toFixed(1)}s</span>
                </summary>
                <div className="border-t border-border px-3 py-2">
                  <Markdown text={h.output} />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {tab === 'run' && output && (
        <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          This response is simulated by the prototype; the real product persists each run (model / duration / rendered prompt) to SQLite.
        </div>
      )}
      </div>
    </div>
  )
}
