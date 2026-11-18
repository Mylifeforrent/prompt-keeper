import { useMemo, useState } from 'react'
import { Badge, Button, Input, Select } from '../ui/core'
import { Icon } from '../../lib/icons'
import { useStore } from '../../store/store'
import { CONTRACT_TARGETS, TARGET_BY_ID } from '../../data/contractTargets'
import { compileTargetFile, resolveContracts, targetSummary } from '../../lib/contracts'
import { cn } from '../../lib/utils'

const SAMPLE_PATHS = [
  'src/components/PromptDetail.tsx',
  'src/lib/contracts.ts',
  'docs/interaction-design.md',
  'README.md',
  'scripts/build.sh',
]

const PRECEDENCE_LABEL = {
  nearest: 'Nearest wins',
  concat: 'Concatenated (root to leaf)',
  override: 'Nearest overrides',
}

export function ResolvedPreview() {
  const { state } = useStore()
  const [targetId, setTargetId] = useState('agents-md')
  const [filePath, setFilePath] = useState(SAMPLE_PATHS[0])

  const target = TARGET_BY_ID[targetId]
  const preview = useMemo(
    () => resolveContracts(state.contracts, targetId, filePath),
    [state.contracts, targetId, filePath],
  )
  const files = useMemo(
    () => compileTargetFile(state.contracts, targetId, filePath),
    [state.contracts, targetId, filePath],
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="eye" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This is a static simulation: it computes what the target tool would actually read for the current path,
            using known discovery paths, activation modes, and merge rules. No tool CLI is invoked. Priority and context budget are approximations; actual tool behavior wins.
          </span>
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Target format</label>
              <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {CONTRACT_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} · {t.agentName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">File path being handled</label>
              <Input
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="font-mono text-xs"
                list="contract-preview-paths"
              />
              <datalist id="contract-preview-paths">
                {SAMPLE_PATHS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-wrap gap-1">
              {SAMPLE_PATHS.slice(0, 3).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={filePath === p ? 'secondary' : 'outline'}
                  onClick={() => setFilePath(p)}
                >
                  {p.split('/').slice(-1)[0]}
                </Button>
              ))}
            </div>
          </div>

          {target && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <Badge variant="primary">{target.label}</Badge>
              <Badge variant="outline">{targetSummary(targetId)}</Badge>
              <span className="text-[11px] text-muted-foreground">{target.note}</span>
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <SummaryCard label="Matched always-on contracts" value={String(preview.included.length)} tone="primary" />
          <SummaryCard
            label="Total content"
            value={`${formatBytes(preview.totalBytes)}${preview.maxBytes ? ` / ${formatBytes(preview.maxBytes)}` : ''}`}
            tone={preview.maxBytes && preview.totalBytes > preview.maxBytes ? 'danger' : 'info'}
          />
        </section>

        {preview.warnings.length > 0 && (
          <section className="space-y-1.5 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3">
            {preview.warnings.map((w) => (
              <div key={w} className="flex items-start gap-2 text-xs leading-5 text-warning">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {w}
              </div>
            ))}
          </section>
        )}

        <div className="grid grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Merged in resolution order</h3>
                <Badge variant="outline">
                  {target ? PRECEDENCE_LABEL[target.precedence] : '—'}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Only rules that enter context automatically are counted; model decision and manual activation are listed below.
              </p>
            </div>
            <div className="max-h-[460px] space-y-1.5 overflow-y-auto p-2.5">
              {preview.included.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No always-on contracts match the current path.
                </div>
              ) : (
                preview.included.map((entry, index) => (
                  <div key={entry.contractId} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[10px] font-semibold text-primary">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{entry.title}</div>
                        <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{entry.reason}</div>
                        <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                          {entry.sourcePath}
                        </code>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(entry.bytes)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {preview.skipped.length > 0 && (
              <div className="border-t border-border px-2.5 py-2">
                <div className="px-1 text-[11px] font-medium text-muted-foreground">
                  Excluded from always-on context ({preview.skipped.length})
                </div>
                <div className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {preview.skipped.map((entry) => (
                    <div key={entry.contractId} className="rounded-md bg-muted/50 px-2 py-1.5">
                      <div className="text-[11px] font-medium">{entry.title}</div>
                      <div className="text-[10px] leading-4 text-muted-foreground">{entry.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <h3 className="text-sm font-semibold">Compiled target files</h3>
              <Badge variant="outline">{files.length} files</Badge>
              <span className="ml-auto text-[11px] text-muted-foreground">
                Generated markers enable drift detection; manual edits are never silently overwritten
              </span>
            </div>
            <div className="max-h-[540px] space-y-3 overflow-y-auto p-3">
              {files.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                  No files need to be written for the current path.
                </p>
              ) : (
                files.map((file) => (
                  <div key={file.path} className="overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                      <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />
                      <code className="truncate font-mono text-[11px]">{file.path}</code>
                    </div>
                    <pre className="max-h-72 overflow-auto bg-muted/20 p-3 font-mono text-[11px] leading-5">
                      {file.content}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'primary' | 'info' | 'danger' }) {
  const cls = {
    primary: 'text-primary bg-primary-soft',
    info: 'text-info bg-info-soft',
    danger: 'text-danger bg-danger-soft',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className={cn('flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold', cls)}>
        {value}
      </span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
