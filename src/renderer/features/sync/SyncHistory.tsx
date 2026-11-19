import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuditEventType } from '../../../shared/contracts'
import { Badge, Button, Input, Select, Spinner } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { formatDate, relativeTime } from '../../lib/format'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { AUDIT_META, AUDIT_TYPES } from '../../lib/viewModels/sync'

const PAGE_SIZE = 25

const RESULT_META = {
  success: { label: 'Success', tone: 'success' as const },
  warning: { label: 'Attention', tone: 'warning' as const },
  error: { label: 'Failed', tone: 'danger' as const },
}

function startOfDay(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function endOfDay(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T23:59:59.999`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function SyncHistory() {
  const [type, setType] = useState<'all' | AuditEventType>('all')
  const [result, setResult] = useState<'all' | 'success' | 'warning' | 'error'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [type, result, from, to])

  const query = useMemo(
    () => ({
      ...(type === 'all' ? {} : { type }),
      ...(result === 'all' ? {} : { result }),
      ...(startOfDay(from) ? { from: startOfDay(from) } : {}),
      ...(endOfDay(to) ? { to: endOfDay(to) } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [from, page, result, to, type],
  )

  const history = useQuery({
    queryKey: queryKeys.sync.history(query),
    queryFn: () => ipc.sync.history(query),
  })

  const events = history.data?.items ?? []
  const total = history.data?.total ?? 0
  const hasFilters = type !== 'all' || result !== 'all' || !!from || !!to

  function resetFilters(): void {
    setType('all')
    setResult('all')
    setFrom('')
    setTo('')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="history" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          History is stored only on this machine. It records which version went to which Agent and when, plus fetches,
          reviews, pushes, conflicts, security blocks, backups, and resets. Git commit history remains the source of
          truth in the repository. Details are redacted; no secrets appear here.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <div className="w-40">
          <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="history-type">
            Event type
          </label>
          <Select
            id="history-type"
            className="h-8 text-xs"
            value={type}
            onChange={(event) => setType(event.target.value as 'all' | AuditEventType)}
          >
            <option value="all">All types</option>
            {AUDIT_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {AUDIT_META[entry].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="history-result">
            Result
          </label>
          <Select
            id="history-result"
            className="h-8 text-xs"
            value={result}
            onChange={(event) => setResult(event.target.value as 'all' | 'success' | 'warning' | 'error')}
          >
            <option value="all">All results</option>
            <option value="success">Success</option>
            <option value="warning">Attention</option>
            <option value="error">Failed</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="history-from">
            From
          </label>
          <Input
            id="history-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="history-to">
            To
          </label>
          <Input
            id="history-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            <Icon name="x" className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {history.isFetching ? 'Refreshing…' : `${total} record${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {history.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Loading history…
        </div>
      ) : history.isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-6 text-center text-xs text-danger">
          <p className="font-medium">{errorMessage(history.error)}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name={hasFilters ? 'filter' : 'history'} className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">
            {hasFilters ? 'No history records match these filters' : 'No history yet'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            {hasFilters
              ? 'Relax the event type, result, or date filters.'
              : 'Connect a repository, fetch, review, push, or dispatch an asset and the audit trail appears here.'}
          </p>
          {hasFilters && (
            <Button className="mt-4" size="sm" variant="outline" onClick={resetFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card px-4 py-2">
          {events.map((event, index) => {
            const meta = AUDIT_META[event.type]
            const resultMeta = RESULT_META[event.result]
            return (
              <div key={event.id} className="relative flex gap-3 py-3">
                {index < events.length - 1 && (
                  <span className="absolute left-[13px] top-9 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden />
                )}
                <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                  <Icon name={meta.icon} className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{event.title}</span>
                    <Badge variant="outline">{meta.label}</Badge>
                    <Badge variant={resultMeta.tone}>{resultMeta.label}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDate(event.at)} · {relativeTime(event.at)}
                    {event.assetId ? ` · asset ${event.assetId}` : ''}
                    {event.operationId ? ` · operation ${event.operationId}` : ''}
                  </p>
                  {event.detail && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                        Redacted details
                      </summary>
                      <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[10.5px] leading-5">
                        {JSON.stringify(event.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {history.data && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE + events.length)} of{' '}
            {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              <Icon name="chevronLeft" className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => current + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
            >
              Next
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        History export is not a sync channel. For a redacted support bundle, use Settings → Data &amp; backup → Export
        diagnostics.
      </p>
    </div>
  )
}
