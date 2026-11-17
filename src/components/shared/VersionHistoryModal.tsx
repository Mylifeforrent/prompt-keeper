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
 * 通用版本历史弹窗（Prompt / Skill / MCP 共用）。
 * versions 按「最新在前」传入；versions[0] 视为当前版本，禁删。
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
      <Modal open={open} onClose={onClose} title={title} subtitle="每次保存自动生成版本；恢复会生成新版本，不影响标签与备注" width="max-w-3xl">
        <div className="flex h-[460px] gap-4">
          {/* 时间线 */}
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
                      当前
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(v.createdAt)}</div>
                {v.note && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{v.note}</div>}
              </button>
            ))}
          </div>

          {/* 右侧预览 / 对比 */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {selected && (
              <>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg bg-muted p-0.5">
                    {(
                      [
                        { v: 'preview', label: '版本预览' },
                        { v: 'diff', label: '与当前对比' },
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
                    {selected.note ? `备注：${selected.note}` : null}
                  </span>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                  {fields.map((f) =>
                    mode === 'preview' ? (
                      <div key={f.key}>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{f.label}</div>
                        <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-5">
                          {selected.data[f.key] || '（空）'}
                        </pre>
                      </div>
                    ) : (
                      <div key={f.key}>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{f.label} 变更</div>
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
                      删除此版本
                    </Button>
                  )}
                  {selected.id !== versions[0]?.id && (
                    <Button size="sm" onClick={() => setConfirmRestore(selected)}>
                      <Icon name="history" className="h-3.5 w-3.5" />
                      恢复此版本
                    </Button>
                  )}
                  {selected.id === versions[0]?.id && (
                    <span className="text-[11px] text-muted-foreground">当前版本不可删除；恢复其他版本会生成新版本号</span>
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
        title="恢复此版本？"
        confirmText="恢复"
        danger={false}
        message={
          <>
            将用 <b className="text-foreground">v{confirmRestore?.version}</b> 的内容覆盖当前内容；当前内容会先自动保存为一个新版本，不会丢失。
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
        title="删除此历史版本？"
        message={`将永久删除 v${confirmDelete?.version} 的快照，删除后版本号不复用。`}
      />
    </>
  )
}
