import { cn } from '../../lib/utils'

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: string; count?: number }[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg bg-muted p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            value === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-[11px] text-muted-foreground">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SubTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px cursor-pointer border-b-2 px-1 pb-2 pt-1 text-sm transition-colors',
            value === t.value
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
