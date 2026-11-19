import type { OperationCompletedEvent, OperationProgressEvent, OperationRef } from '../../shared/contracts'
import { Button } from '../components/ui/primitives'
import { Icon } from '../lib/icons'
import { cn } from '../lib/cn'

const TYPE_LABEL: Record<string, string> = {
  sync_fetch: 'Fetching repository',
  sync_pull: 'Pulling changes',
  sync_push: 'Pushing changes',
  dispatch: 'Dispatching assets',
  projection: 'Projecting contracts',
  mcp_apply: 'Applying MCP servers',
  mcp_remove: 'Removing MCP servers',
  backup: 'Creating backup',
  restore: 'Restoring backup',
  search_rebuild: 'Rebuilding search index',
  update_download: 'Downloading update',
  update_install: 'Installing update',
  reset: 'Resetting local data',
}

export function OperationPanel({
  operations,
  progress,
  completed,
  onDismiss,
}: {
  operations: OperationRef[]
  progress: Record<string, OperationProgressEvent>
  completed: OperationCompletedEvent[]
  onDismiss: (operationId: string) => void
}) {
  if (!operations.length && !completed.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[320px] flex-col gap-2">
      {operations.map((operation) => {
        const event = progress[operation.operationId]
        const percent = event && event.total > 0 ? Math.round((event.completed / event.total) * 100) : null
        return (
          <div
            key={operation.operationId}
            className="pointer-events-auto rounded-xl border border-border bg-card p-3 shadow-popover"
          >
            <div className="flex items-center gap-2">
              <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-xs font-medium">{TYPE_LABEL[operation.type] ?? operation.type}</span>
              <span className="tabular ml-auto text-[10px] text-muted-foreground">
                {event ? `${event.phase}${percent !== null ? ` · ${percent}%` : ''}` : 'Starting…'}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full bg-primary transition-all', percent === null && 'animate-pulse')}
                style={{ width: percent === null ? '35%' : `${Math.max(4, percent)}%` }}
              />
            </div>
            {event?.message && <p className="mt-1.5 text-[10px] text-muted-foreground">{event.message}</p>}
          </div>
        )
      })}
      {completed.map((event) => (
        <div
          key={event.operationId}
          className="pointer-events-auto flex items-start gap-2 rounded-xl border border-border bg-card p-3 shadow-popover"
        >
          <Icon
            name={event.state === 'committed' ? 'check' : 'alert'}
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0',
              event.state === 'committed' ? 'text-success' : 'text-danger',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">
              {TYPE_LABEL[event.type] ?? event.type}{' '}
              {event.state === 'committed' ? 'completed' : event.state === 'cancelled' ? 'cancelled' : 'failed'}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {event.error?.message ?? 'Open the affected workspace to review the result.'}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={() => onDismiss(event.operationId)}>
            <Icon name="x" className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
