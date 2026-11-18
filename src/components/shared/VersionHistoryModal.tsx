import { useState } from 'react'
import type { VersionSnapshot } from '../../types'
import { Badge, Button } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { DiffView } from './DiffView'
import { formatDate } from '../../lib/utils'
import { Icon } from '../../lib/icons'

export interface VersionField {
  key: string
  label: string
}

/**
 * Shared version history modal (used by Prompt / Skill / MCP).
 * Versions are passed newest-first; versions[0] is treated as the current version and cannot be deleted.
 */
export function VersionHistoryModal({
  open,
  onClose,
  title,
  versions,
  fields,
  onRestore,
  onDeleteVersion,
  restoreHint,
}: {
  open: boolean
  onClose: () => void
  title: string
  versions: VersionSnapshot[]
  fields: VersionField[]
  onRestore: (version: VersionSnapshot) => void
  onDeleteVersion: (versionId: string) => void
  restoreHint?: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'diff'>('preview')
  const [confirmDelete, setConfirmDelete] = useState<VersionSnapshot | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<VersionSnapshot | null>(null)

  const selected = versions.find((v) => v.id === (selectedId ?? versions[0]?.id)) ?? versions[0]

  return (
    <>
      <Modal open={open} onClose={onClose} title={title} subtitle="Every save creates a version; restoring creates a new version and leaves tags and notes untouched" width="max-w-3xl">
        <div className="flex h-[460px] gap-4">
          {/* Timeline */}
          <div className="w-52 shrink-0 space-y-1 overflow-y-auto pr-1">
            {versions.map((v, idx) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedId(v.id)
                  setMode('preview')
                }}
                className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                  v.id === selected?.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  v{v.version}
                  {idx === 0 && (
                    <Badge variant="primary">
                      <Icon name="check" className="h-3 w-3" />
                      Current
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(v.createdAt)}</div>
                {v.note && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{v.note}</div>}
              </button>
            ))}
          </div>

          {/* Right side: preview / diff */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {selected && (
              <>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg bg-muted p-0.5">
                    {(
                      [
                        { v: 'preview', label: 'Version preview' },
                        { v: 'diff', label: 'Compare with current' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.v}
                        type="button"
                        onClick={() => setMode(t.v)}
                        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium ${
                          mode === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {selected.note ? `Note: ${selected.note}` : null}
                  </span>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                  {fields.map((f) =>
                    mode === 'preview' ? (
                      <div key={f.key}>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{f.label}</div>
                        <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-5">
                          {selected.data[f.key] || '(empty)'}
                        </pre>
                      </div>
                    ) : (
                      <div key={f.key}>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{f.label} changes</div>
                        <DiffView before={selected.data[f.key] ?? ''} after={versions[0]?.data[f.key] ?? ''} />
                      </div>
                    ),
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  {selected.id !== versions[0]?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setConfirmDelete(selected)}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                      Delete this version
                    </Button>
                  )}
                  {selected.id !== versions[0]?.id && (
                    <Button size="sm" onClick={() => setConfirmRestore(selected)}>
                      <Icon name="history" className="h-3.5 w-3.5" />
                      Restore this version
                    </Button>
                  )}
                  {selected.id === versions[0]?.id && (
                    <span className="text-[11px] text-muted-foreground">The current version cannot be deleted; restoring another version creates a new version</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => {
          if (confirmRestore) onRestore(confirmRestore)
        }}
        title="Restore this version?"
        confirmText="Restore"
        danger={false}
        message={
          <>
            This replaces the current content with <b className="text-foreground">v{confirmRestore?.version}</b>; the current content is first saved as a new version, so nothing is lost.
            {restoreHint && <div className="mt-2">{restoreHint}</div>}
          </>
        }
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) onDeleteVersion(confirmDelete.id)
        }}
        title="Delete this version?"
        message={`Permanently deletes the v${confirmDelete?.version} snapshot; version numbers are never reused.`}
      />
    </>
  )
}
