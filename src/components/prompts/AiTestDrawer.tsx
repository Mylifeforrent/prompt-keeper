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
      .map(([k, v]) => `- \`${k}\`：${(v || '（空）').slice(0, 40)}`)
      .join('\n') || '无'
  return `（模拟响应 · ${model.name}）

已完成「${prompt.title}」的测试运行，以下是模拟输出。

**输入概要**
${varSummary}
- System Prompt：${prompt.systemPrompt.length} 字符

**结论**
1. 输出结构符合预期，内容覆盖了全部输入要点。
2. 「重点关注」类变量建议给出更具体的描述，可提升输出稳定性。
3. 当前 System Prompt 长度适中，无需裁剪。

> 本响应为原型模拟流式输出；真实产品将调用设置中配置的模型端点（OpenAI / Anthropic / Gemini / 自定义 endpoint）。`
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
    <div className="fixed inset-y-0 right-0 z-40 flex w-[460px] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon name="flask" className="text-primary" />
        <h2 className="text-sm font-semibold">AI 测试</h2>
        <span className="truncate text-xs text-muted-foreground">· {prompt.title}</span>
        <Button size="icon" variant="ghost" className="ml-auto" onClick={onClose}>
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
              <Spinner /> 停止
            </>
          ) : (
            <>
              <Icon name="play" />
              运行
            </>
          )}
        </Button>
      </div>
      {missingRequired.length > 0 && (
        <p className="px-4 pt-2 text-[11px] text-danger">还有 {missingRequired.length} 个必填变量未填写</p>
      )}

      {prompt.variables.length > 0 && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">变量取值（保留 30 天记忆）</div>
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
            { v: 'run', label: `响应${output ? '' : '（空）'}` },
            { v: 'history', label: `测试历史（${history.length}）` },
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
              {running ? '生成中…' : '点击「运行」发起测试；正文将渲染后的最终 Prompt 发送给所选模型。'}
            </p>
          )
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有测试记录。真实产品会将每次运行持久化到 SQLite（prompt_test_runs）。</p>
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
          本响应由原型模拟生成；真实产品会持久化每次运行（模型 / 耗时 / 变量替换后正文）到 SQLite。
        </div>
      )}
    </div>
  )
}
