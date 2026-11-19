import type {
  AiStreamEvent,
  DomainChangedEvent,
  DomainChangeReason,
  DomainName,
  OperationCompletedEvent,
  OperationProgressEvent,
  SyncProgressEvent,
  UpdateAvailableEvent,
} from '../shared/contracts'

type Sender = (channel: string, payload: unknown) => void

export class EventBus {
  private sender: Sender | null = null
  private pending = new Map<string, DomainChangedEvent>()
  private timer: NodeJS.Timeout | null = null

  attach(sender: Sender): void {
    this.sender = sender
  }

  emit(channel: string, payload: unknown): void {
    this.sender?.(channel, payload)
  }

  domainChanged(
    domain: DomainName,
    reason: DomainChangeReason,
    ids: string[] = [],
    operationId?: string,
  ): void {
    const key = `${domain}:${reason}`
    const existing = this.pending.get(key)
    if (existing) {
      for (const id of ids) if (!existing.ids.includes(id)) existing.ids.push(id)
      if (operationId) existing.operationId = operationId
    } else {
      this.pending.set(key, {
        domain,
        reason,
        ids: [...ids],
        ...(operationId ? { operationId } : {}),
        at: new Date().toISOString(),
      })
    }
    if (this.timer) return
    this.timer = setTimeout(() => this.flushDomainEvents(), 40)
  }

  flushDomainEvents(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const event of this.pending.values()) this.emit('domain:changed', event)
    this.pending.clear()
  }

  operationProgress(event: OperationProgressEvent): void {
    this.emit('operation:progress', event)
  }

  operationCompleted(event: OperationCompletedEvent): void {
    this.emit('operation:completed', event)
  }

  syncProgress(event: SyncProgressEvent): void {
    this.emit('sync:progress', event)
  }

  updateAvailable(event: UpdateAvailableEvent): void {
    this.emit('update:available', event)
  }

  aiStream(event: AiStreamEvent): void {
    this.emit('ai:stream', event)
  }
}
