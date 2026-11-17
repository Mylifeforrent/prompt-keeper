import { diffLines } from '../../lib/diff'

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after)
  const hasChange = lines.some((l) => l.type !== 'same')
  if (!hasChange) return <p className="text-xs text-muted-foreground">两个版本内容完全一致。</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border font-mono text-xs leading-5">
      {lines.map((l, idx) => (
        <div
          key={idx}
          className={
            l.type === 'add'
              ? 'bg-success-soft text-success'
              : l.type === 'del'
                ? 'bg-danger-soft text-danger'
                : 'text-muted-foreground'
          }
        >
          <span className="inline-block w-6 select-none pl-1.5 text-[10px] opacity-60">
            {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}
          </span>
          <span className="whitespace-pre-wrap">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
