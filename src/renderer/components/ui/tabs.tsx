import { useRef } from 'react'
import { cn } from '../../lib/cn'

type TabItem = { value: string; label: string; count?: number }

function useTabKeys(tabs: TabItem[], value: string, onChange: (v: string) => void) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const index = Math.max(0, tabs.findIndex((t) => t.value === value))
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    const target = tabs[next]
    onChange(target.value)
    refs.current[target.value]?.focus()
  }
  return { refs, onKeyDown }
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const { refs, onKeyDown } = useTabKeys(tabs, value, onChange)
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-border/70 bg-muted/80 p-1',
        className,
      )}
    >
      {tabs.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[t.value] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              'flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-all duration-150',
              active
                ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded px-1 text-[10px] leading-4',
                  active ? 'bg-muted text-foreground/70' : 'bg-border/50 text-muted-foreground',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function SubTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const { refs, onKeyDown } = useTabKeys(tabs, value, onChange)
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-5 border-b border-border', className)}
    >
      {tabs.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[t.value] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-0.5 pb-2.5 pt-1.5 text-[13px] transition-colors',
              active
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
