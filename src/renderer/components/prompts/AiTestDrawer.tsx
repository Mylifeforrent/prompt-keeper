import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AiStreamEvent, PromptDetail } from '../../../shared/contracts'
import { Badge, Button, Checkbox, EmptyState, Select, Spinner } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { errorDetails, errorMessage, events, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { Markdown } from '../shared/Markdown'
import { VariableFields } from '../shared/VariableForm'

type DrawerTab = 'run' | 'history'

export function AiTestDrawer({
  prompt,
  onClose,
}: {
  prompt: PromptDetail
  onClose: () => void
}) {
  const [tab, setTab] = useState<DrawerTab>('run')
  const [providerId, setProviderId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ inputTokens?: number; outputTokens?: number } | null>(null)
  const streamIdRef = useRef<string | null>(null)

  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: () => ipc.ai.providers(),
    staleTime: 5 * 60_000,
  })
  const providers = providersQuery.data ?? []
  const provider = providers.find((entry) => entry.id === providerId) ?? null

  useEffect(() => {
    if (providerId && providers.some((entry) => entry.id === providerId)) return
    const next = providers.find((entry) => entry.isDefault) ?? providers[0]
    if (next) setProviderId(next.id)
  }, [providers, providerId])

  useEffect(() => {
    setValues({})
    setOutput('')
    setError(null)
    setUsage(null)
    setRunning(false)
    streamIdRef.current = null
  }, [prompt.id])

  useEffect(() => {
    const unsubscribe = events.onAiStream((event: AiStreamEvent) => {
      if (event.streamId !== streamIdRef.current) return
      if (event.type === 'delta') {
        setOutput((current) => current + (event.delta ?? ''))
        return
      }
      streamIdRef.current = null
      setRunning(false)
      if (event.type === 'done') {
        setUsage(event.usage ?? null)
      } else {
        setError(event.error?.message ?? 'The AI provider returned an error.')
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const streamId = streamIdRef.current
      if (streamId) {
        streamIdRef.current = null
        void ipc.ai.cancel({ streamId }).catch(() => undefined)
      }
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handler)
    }
  }, [onClose])

  useEffect(
    () => () => {
      const streamId = streamIdRef.current
      if (streamId) {
        streamIdRef.current = null
        void ipc.ai.cancel({ streamId }).catch(() => undefined)
      }
    },
    [],
  )

  const historyQuery = useQuery({
    queryKey: queryKeys.ai.history({ limit: 20, providerId: provider?.id }),
    queryFn: () => ipc.ai.history({ limit: 20, providerId: provider?.id }),
    enabled: tab === 'history' && !!provider,
    staleTime: 30_000,
  })

  const missingRequired = prompt.variables.filter(
    (variable) => variable.required && !(values[variable.name] ?? '').trim(),
  )
  const ready = !!provider && provider.hasKey && acknowledged && missingRequired.length === 0

  const start = async () => {
    if (!provider || !ready) return
    setError(null)
    setOutput('')
    setUsage(null)
    setRunning(true)
    try {
      const handle = await ipc.ai.test({
        providerId: provider.id,
        model: provider.model,
        promptId: prompt.id,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        values,
        acknowledgeDataDisclosure: true,
      })
      streamIdRef.current = handle.streamId
    } catch (caught) {
      setRunning(false)
      const details = errorDetails(caught)
      if (details?.kind === 'data-disclosure-required') {
        setAcknowledged(false)
        setError('Acknowledge the data disclosure before the first request.')
      } else {
        setError(errorMessage(caught))
      }
    }
  }

  const cancel = async () => {
    const streamId = streamIdRef.current
    if (!streamId) {
      setRunning(false)
      return
    }
    try {
      await ipc.ai.cancel({ streamId })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      streamIdRef.current = null
      setRunning(false)
    }
  }

  const close = () => {
    const streamId = streamIdRef.current
    if (streamId) {
      streamIdRef.current = null
      void ipc.ai.cancel({ streamId }).catch(() => undefined)
    }
    onClose()
  }

  const noProvider = !providersQuery.isLoading && !providersQuery.isError && providers.length === 0

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 animate-fade-in bg-[var(--overlay)] backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`AI test — ${prompt.title}`}
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
            onClick={close}
            aria-label="Close AI test"
            title="Close (Esc)"
          >
            <Icon name="x" />
          </Button>
        </div>

        {providersQuery.isError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <EmptyState
              icon="alert"
              title="AI providers could not be loaded"
              description={errorMessage(providersQuery.error)}
              action={
                <Button variant="outline" size="sm" onClick={() => void providersQuery.refetch()}>
                  <Icon name="refresh" />
                  Retry
                </Button>
              }
            />
          </div>
        ) : providersQuery.isLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
            <Spinner className="mr-2 h-3.5 w-3.5" />
            Loading providers…
          </div>
        ) : noProvider ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon="sparkles"
              title="AI test is not configured"
              description="No AI provider is available. Open Settings → AI, add a provider, base URL, model, and API key, then reopen this drawer. Keys are stored by the main process and are never shown here."
              action={
                <Button variant="outline" size="sm" onClick={close}>
                  Close
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 pt-3">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="AI provider"
                  className="h-8 text-xs"
                  value={provider?.id ?? ''}
                  disabled={running}
                  onChange={(event) => setProviderId(event.target.value)}
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.model}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                onClick={() => (running ? void cancel() : void start())}
                disabled={running ? false : !ready}
                className="min-w-24"
              >
                {running ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    Stop
                  </>
                ) : (
                  <>
                    <Icon name="play" />
                    Run
                  </>
                )}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 text-[10.5px] text-muted-foreground">
              <Badge variant={provider?.hasKey ? 'success' : 'warning'}>
                {provider?.hasKey ? 'Key configured' : 'No API key'}
              </Badge>
              <span className="truncate" title={provider?.baseUrl}>
                {provider?.baseUrl}
              </span>
              {provider?.keyUpdatedAt && (
                <span>Updated {formatDate(provider.keyUpdatedAt, false)}</span>
              )}
            </div>

            {provider && !provider.hasKey && (
              <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
                <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This provider has no saved API key. Add one in Settings → AI. Keys are never displayed
                in this drawer.
              </div>
            )}

            {missingRequired.length > 0 && (
              <p className="px-4 pt-2 text-[11px] text-danger">
                {missingRequired.length} required variable(s) missing: {missingRequired.map((variable) => variable.name).join(', ')}
              </p>
            )}

            {prompt.variables.length > 0 && (
              <div className="max-h-[240px] overflow-y-auto border-b border-border px-4 py-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Variable values · kept in memory only
                </div>
                <VariableFields
                  variables={prompt.variables}
                  values={values}
                  disabled={running}
                  onChange={(name, value) =>
                    setValues((current) => ({ ...current, [name]: value }))
                  }
                />
              </div>
            )}

            <div className="flex items-center gap-1 border-b border-border px-4 pt-2.5">
              {(
                [
                  { value: 'run' as const, label: 'Response' },
                  { value: 'history' as const, label: 'Test history' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setTab(entry.value)}
                  aria-pressed={tab === entry.value}
                  className={cn(
                    '-mb-px cursor-pointer border-b-2 px-2 pb-2 text-xs font-medium transition-colors',
                    tab === entry.value
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {tab === 'run' ? (
                <div className="space-y-3">
                  {!acknowledged && provider && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11px] leading-5 text-warning">
                      <p>
                        Running a test sends the rendered Prompt and these variable values directly
                        to {provider.name} ({provider.baseUrl}). Response content is untrusted and is
                        rendered as sanitized Markdown.
                      </p>
                      <div className="mt-1.5 text-foreground">
                        <Checkbox
                          checked={acknowledged}
                          onChange={setAcknowledged}
                          label="I understand and want to send this Prompt to the provider."
                        />
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
                      <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">The test could not run</p>
                        <p className="mt-0.5 break-words">{error}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7"
                          disabled={!ready}
                          onClick={() => void start()}
                        >
                          <Icon name="refresh" className="h-3.5 w-3.5" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}

                  {output ? (
                    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
                      <Markdown text={output} className="text-[13px]" />
                    </div>
                  ) : running ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="h-3.5 w-3.5" />
                      Waiting for the first token…
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {acknowledged
                        ? 'Run a test to stream the model response. The rendered Prompt is sent to the selected provider; nothing is saved to versions or repository files.'
                        : 'Acknowledge the data disclosure to enable Run.'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {historyQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="h-3.5 w-3.5" />
                      Loading test history…
                    </div>
                  ) : historyQuery.isError ? (
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p>{errorMessage(historyQuery.error)}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void historyQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No test runs recorded yet. Each run stores the model, duration, status, and a
                      response preview; it never stores API keys.
                    </p>
                  ) : (
                    historyQuery.data?.items.map((run) => (
                      <details key={run.id} className="rounded-lg border border-border">
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
                          <Badge
                            variant={
                              run.status === 'completed'
                                ? 'success'
                                : run.status === 'cancelled'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {run.status}
                          </Badge>
                          <span className="truncate">{run.model}</span>
                          <span className="text-muted-foreground">
                            {formatDate(run.startedAt)}
                          </span>
                          <span className="tabular ml-auto text-muted-foreground">
                            {(run.durationMs / 1000).toFixed(1)}s
                          </span>
                        </summary>
                        <pre className="whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                          {run.responsePreview || '(empty response)'}
                        </pre>
                      </details>
                    ))
                  )}
                </div>
              )}
            </div>

            {tab === 'run' && (output || usage) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
                <span>Response content is untrusted; rendering is sanitized.</span>
                {usage?.inputTokens !== undefined && (
                  <span className="tabular">In {usage.inputTokens} tok</span>
                )}
                {usage?.outputTokens !== undefined && (
                  <span className="tabular">Out {usage.outputTokens} tok</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
