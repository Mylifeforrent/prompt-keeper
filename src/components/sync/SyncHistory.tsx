import { useState } from 'react'
import { useStore } from '../../store/store'
import { Badge, Button } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { EVENT_META } from '../../lib/sync'
import type { SyncEventType } from '../../types'
import { useToast } from '../ui/toast'

type Filter = 'all' | 'repo' | 'deploy' | 'security'

const FILTERS: { v: Filter; label: string; types: SyncEventType[] }[] = [
  { v: 'all', label: '全部', types: [] },
  { v: 'repo', label: '仓库同步', types: ['fetch', 'pull', 'push', 'connect', 'conflict'] },
  { v: 'deploy', label: 'Agent 分发', types: ['deploy', 'rollback'] },
  { v: 'security', label: '安全与审核', types: ['blocked', 'review'] },
]

export function SyncHistory() {
  const { state } = useStore()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const active = FILTERS.find((f) => f.v === filter)!
  const events = state.syncEvents.filter((e) => filter === 'all' || active.types.includes(e.type))

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="history" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          同步日志只保存在本机，用于追溯「哪个版本、什么时候、分发到了哪个 Agent」。
          Git 的提交历史仍以仓库为准；回滚分发不会回滚仓库。
        </span>
      </div>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            type="button"
            onClick={() => setFilter(f.v)}
            className={cn(
              'cursor-pointer rounded-md border px-2.5 py-1 text-[11px] transition-colors',
              filter === f.v
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{events.length} 条记录</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => toast.info('同步日志导出为 JSON（原型未真的下载文件）')}
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          导出日志
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {events.length === 0 ? (
          <p className="px-4 py-12 text-center text-xs text-muted-foreground">该分类下还没有记录。</p>
        ) : (
          <div className="px-4 py-2">
            {events.map((ev, idx) => {
              const meta = EVENT_META[ev.type]
              return (
                <div key={ev.id} className="relative flex gap-3 py-3">
                  {idx < events.length - 1 && (
                    <span className="absolute left-[13px] top-9 h-[calc(100%-1.5rem)] w-px bg-border" />
                  )}
                  <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                    <Icon name={meta.icon} className={cn('h-3.5 w-3.5', meta.tone)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{ev.title}</span>
                      <Badge variant="outline">{meta.label}</Badge>
                      <Badge
                        variant={
                          ev.result === 'success' ? 'success' : ev.result === 'warning' ? 'warning' : 'danger'
                        }
                      >
                        {ev.result === 'success' ? '成功' : ev.result === 'warning' ? '需关注' : '失败'}
                      </Badge>
                    </div>
                    {ev.detail && <p className="mt-1 text-xs leading-5 text-muted-foreground">{ev.detail}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDate(ev.at)} · {relativeTime(ev.at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
