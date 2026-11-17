import { useEffect, useState } from 'react'
import type { SyncChange } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Input, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Tabs } from '../ui/tabs'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { ASSET_META, CHANGE_META, RISK_META, activeChanges } from '../../lib/sync'
import { Markdown } from '../shared/Markdown'
import { DiffView } from '../shared/DiffView'

type ChangeTab = 'incoming' | 'outgoing' | 'conflict'

export function SyncChanges() {
  const { state, pullIncoming } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<ChangeTab>('incoming')
  const [selected, setSelected] = useState<string[]>([])
  const [reviewOf, setReviewOf] = useState<SyncChange | null>(null)
  const [conflictOf, setConflictOf] = useState<SyncChange | null>(null)
  const [secretOf, setSecretOf] = useState<SyncChange | null>(null)
  const [pushIds, setPushIds] = useState<string[] | null>(null)

  const incoming = activeChanges(state.syncChanges, 'incoming')
  const outgoing = activeChanges(state.syncChanges, 'outgoing')
  const conflicts = activeChanges(state.syncChanges, 'conflict')
  const rows = tab === 'incoming' ? incoming : tab === 'outgoing' ? outgoing : conflicts

  useEffect(() => setSelected([]), [tab])

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const accept = (change: SyncChange) => {
    if (change.risk !== 'none') {
      setReviewOf(change)
      return
    }
    pullIncoming([change.id])
    toast.success(`已接受 ${change.kind}:${change.assetName}，本地库已生成新版本`)
  }

  const batchAccept = () => {
    const ids = selected.filter((id) => incoming.some((c) => c.id === id && c.risk === 'none'))
    if (ids.length === 0) return
    pullIncoming(ids)
    toast.success(`已接受 ${ids.length} 项低风险变更并生成版本`)
    setSelected([])
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          仓库与本地库之间是三方合并：<b>远端（仓库）</b>、<b>本地（本机库）</b>、<b>基线（上次同步）</b>。
          任何一方单独修改都能自动前进；双方都改时进入「冲突」，禁止静默覆盖。
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Tabs
          tabs={[
            { value: 'incoming', label: '待拉取', count: incoming.length },
            { value: 'outgoing', label: '待推送', count: outgoing.length },
            { value: 'conflict', label: '冲突', count: conflicts.length },
          ]}
          value={tab}
          onChange={(v) => setTab(v as ChangeTab)}
        />
        <span className="text-[11px] text-muted-foreground">
          {tab === 'incoming' && '含脚本 / 新增技能的条目必须逐项审核后才能写入本地库'}
          {tab === 'outgoing' && '推送前会再次扫描明文密钥；被阻断的条目不会进入提交'}
          {tab === 'conflict' && '可以选择采用仓库、保留本地，或手动合并后写入'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'incoming' && (
            <Button size="sm" disabled={selected.length === 0} onClick={batchAccept}>
              <Icon name="check" className="h-3.5 w-3.5" />
              接受所选（{selected.length}）
            </Button>
          )}
          {tab === 'outgoing' && (
            <Button
              size="sm"
              disabled={selected.length === 0}
              onClick={() => setPushIds(selected)}
            >
              <Icon name="arrowUp" className="h-3.5 w-3.5" />
              推送所选（{selected.length}）
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name={tab === 'conflict' ? 'check' : tab === 'incoming' ? 'arrowDown' : 'arrowUp'} className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">
            {tab === 'incoming' ? '没有待拉取的变更' : tab === 'outgoing' ? '没有待推送的本地改动' : '没有冲突'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === 'conflict' ? '同步状态良好；下次双方改动同一文件时会在这里提示。' : 'fetch 后新的远端差异会出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              selected={selected.includes(c.id)}
              onToggle={() => toggle(c.id)}
              onAccept={() => accept(c)}
              onReview={() => setReviewOf(c)}
              onPush={() => setPushIds([c.id])}
              onConflict={() => setConflictOf(c)}
              onSecret={() => setSecretOf(c)}
            />
          ))}
        </div>
      )}

      {reviewOf && (
        <ReviewIncomingModal
          change={reviewOf}
          onClose={() => setReviewOf(null)}
          onAccepted={() => {
            pullIncoming([reviewOf.id])
            toast.success(`已审核并接受 ${reviewOf.assetName}，脚本将随技能一起写入`)
            setReviewOf(null)
            setSelected([])
          }}
        />
      )}

      {pushIds && <PushModal ids={pushIds} onClose={() => setPushIds(null)} onDone={() => setSelected([])} />}

      {secretOf && (
        <SecretFixModal
          change={secretOf}
          onClose={() => setSecretOf(null)}
        />
      )}

      {conflictOf && <ConflictModal change={conflictOf} onClose={() => setConflictOf(null)} />}
    </div>
  )
}

function ChangeRow({
  change,
  selected,
  onToggle,
  onAccept,
  onReview,
  onPush,
  onConflict,
  onSecret,
}: {
  change: SyncChange
  selected: boolean
  onToggle: () => void
  onAccept: () => void
  onReview: () => void
  onPush: () => void
  onConflict: () => void
  onSecret: () => void
}) {
  const asset = ASSET_META[change.kind]
  const changeMeta = CHANGE_META[change.change]
  const risk = RISK_META[change.risk]
  const selectable = change.direction !== 'conflict' && !change.blocked && change.risk === 'none'

  const versionLine =
    change.direction === 'conflict'
      ? `仓库 ${change.remoteVersion ?? '—'} / 本地 ${change.localVersion ?? '—'} / 基线 ${change.baseVersion ?? '—'}`
      : change.direction === 'incoming'
        ? change.localVersion && change.remoteVersion
          ? `${change.localVersion} → ${change.remoteVersion}`
          : change.versionLabel
        : change.baseVersion && change.localVersion
          ? `${change.baseVersion} → ${change.localVersion}`
          : change.localVersion

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-colors',
        change.direction === 'conflict'
          ? 'border-danger/30'
          : change.blocked
            ? 'border-danger/30 bg-danger-soft/30'
            : selected
              ? 'border-primary ring-2 ring-ring/15'
              : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-4 shrink-0">
          {selectable ? (
            <Checkbox checked={selected} onChange={onToggle} />
          ) : change.direction === 'conflict' ? (
            <Icon name="alert" className="h-4 w-4 text-danger" />
          ) : change.blocked ? (
            <Icon name="lock" className="h-4 w-4 text-danger" />
          ) : (
            <Icon name="shield" className="h-4 w-4 text-warning" />
          )}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name={asset.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{change.assetName}</span>
            <Badge variant="secondary">{asset.label}</Badge>
            <Badge variant={changeMeta.variant}>{changeMeta.label}</Badge>
            {versionLine && <span className="text-[11px] text-muted-foreground">{versionLine}</span>}
            {change.risk !== 'none' && (
              <Badge variant={risk.variant}>
                <Icon name={risk.icon} className="h-3 w-3" />
                {risk.label}
              </Badge>
            )}
            {change.blocked && <Badge variant="danger">已阻止推送</Badge>}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{change.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{change.path}</code>
            <span className="text-success">+{change.additions}</span>
            <span className="text-danger">−{change.deletions}</span>
            {change.files && <span>· {change.files.length} 个文件</span>}
          </div>
        </div>
        <div className="ml-2 shrink-0">
          {change.direction === 'incoming' && (
            <Button size="sm" variant={change.risk === 'none' ? 'default' : 'outline'} onClick={change.risk === 'none' ? onAccept : onReview}>
              {change.risk === 'none' ? '接受' : '审核并接受'}
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          )}
          {change.direction === 'outgoing' &&
            (change.blocked ? (
              <Button size="sm" variant="danger" onClick={onSecret}>
                <Icon name="lock" className="h-3.5 w-3.5" />
                处理密钥
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onPush}>
                <Icon name="arrowUp" className="h-3.5 w-3.5" />
                推送
              </Button>
            ))}
          {change.direction === 'conflict' && (
            <Button size="sm" variant="danger" onClick={onConflict}>
              <Icon name="alert" className="h-3.5 w-3.5" />
              解决冲突
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- 审核新技能 ---------------- */

function ReviewIncomingModal({
  change,
  onClose,
  onAccepted,
}: {
  change: SyncChange
  onClose: () => void
  onAccepted: () => void
}) {
  const [trusted, setTrusted] = useState(false)
  const risk = RISK_META[change.risk]

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`审核并接受 — ${ASSET_META[change.kind].label} ${change.assetName}`}
      subtitle="仓库内容会原样写入本机库；技能中的脚本可能被执行，请先读完"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            拒绝
          </Button>
          <Button disabled={!trusted} onClick={onAccepted}>
            信任并接受
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <Icon name={risk.icon} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>{risk.label}</b>
            <p className="mt-0.5 leading-5">
              该条目包含可执行内容。接受后只会写入本机资产库，不会自动分发到 Agent；分发时还会再次确认目标路径与模式。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{change.versionLabel ?? change.remoteVersion ?? '—'}</Badge>
          <Badge variant="outline">{change.files?.length ?? 1} 个文件</Badge>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{change.path}</code>
        </div>

        {change.files && (
          <div className="rounded-lg border border-border">
            {change.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs last:border-0">
                <Icon name="file" className="text-muted-foreground" />
                <span className="font-mono">{f.path}</span>
                <span className="ml-auto text-muted-foreground">{f.size}</span>
              </div>
            ))}
          </div>
        )}

        {change.remoteContent ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border p-3">
            <Markdown text={change.remoteContent} />
          </div>
        ) : (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            该条目没有可预览的正文；接受前请先在仓库中查看完整文件。
          </p>
        )}

        <Checkbox
          checked={trusted}
          onChange={setTrusted}
          label={<span className="text-xs">我已阅读上述内容，并确认来源可信</span>}
        />
      </div>
    </Modal>
  )
}

/* ---------------- 推送 ---------------- */

function PushModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { state, pushOutgoing } = useStore()
  const toast = useToast()
  const rows = state.syncChanges.filter((c) => ids.includes(c.id) && c.direction === 'outgoing' && !c.blocked && !c.resolved)
  const [message, setMessage] = useState('chore: sync skills and MCP templates from Prompt Keeper')
  const [createPr, setCreatePr] = useState(state.repo.pushMode === 'branch-pr')

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title={`推送到仓库 — ${rows.length} 项`}
      subtitle={`${state.repo.url} · ${state.repo.branch}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!message.trim() || rows.length === 0}
            onClick={() => {
              pushOutgoing(
                rows.map((r) => r.id),
                message.trim(),
                createPr,
              )
              toast.success(
                createPr
                  ? `已推送 ${rows.length} 项到独立分支并创建 PR（原型模拟）`
                  : `已推送 ${rows.length} 项到 ${state.repo.branch}（原型模拟）`,
              )
              onDone()
              onClose()
            }}
          >
            <Icon name="arrowUp" />
            推送
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <Icon name={ASSET_META[r.kind].icon} className="text-muted-foreground" />
              <span className="font-medium">{r.assetName}</span>
              <Badge variant="secondary">{ASSET_META[r.kind].label}</Badge>
              <code className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{r.path}</code>
            </div>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">提交信息 *</label>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">推送方式</div>
          {(
            [
              { v: true, title: '独立分支 + PR（推荐）', desc: '可评审、可回滚；不会直接改动主分支' },
              { v: false, title: '直接推送到当前分支', desc: '适合个人仓库；失败不会改写远端' },
            ] as const
          ).map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setCreatePr(o.v)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                createPr === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
              )}
            >
              <Icon name={o.v ? 'gitBranch' : 'arrowUp'} className={cn('mt-0.5 h-4 w-4', createPr === o.v ? 'text-primary' : 'text-muted-foreground')} />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          推送前会再次扫描 env / headers；发现明文密钥会阻断整个提交。凭据只以 ${'{'}VAR{'}'} 形式进入仓库。
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- 明文密钥处理 ---------------- */

function SecretFixModal({ change, onClose }: { change: SyncChange; onClose: () => void }) {
  const { convertSecretToVar } = useStore()
  const toast = useToast()

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-lg"
      title="明文密钥阻断推送"
      subtitle={`${ASSET_META[change.kind].label} · ${change.assetName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              convertSecretToVar(change.id)
              toast.success('已转换为 ${AMAP_API_KEY} 占位；真实值仍只在本机钥匙串')
              onClose()
            }}
          >
            <Icon name="lock" />
            转换为变量引用
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          检测到 env 字段中的明文凭据。提交会把密钥永久写入 Git 历史，即使后续删除也能被检出。
        </div>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
{`"env": {
  "AMAP_API_KEY": "***"   ← 将替换为 "\${AMAP_API_KEY}"
}`}
        </pre>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>仓库中的配置只保留变量名，任何机器拉取时都不会拿到真实值。</li>
          <li>真实值继续存在本机钥匙串；分发到 Agent 时按目标工具注入。</li>
          <li>转换后可正常推送，但本次提交仍会记录「曾发现明文」的审计事件。</li>
        </ul>
      </div>
    </Modal>
  )
}

/* ---------------- 冲突解决 ---------------- */

function ConflictModal({ change, onClose }: { change: SyncChange; onClose: () => void }) {
  const { resolveConflict } = useStore()
  const toast = useToast()
  const [strategy, setStrategy] = useState<'remote' | 'local' | 'manual'>('remote')
  const [merged, setMerged] = useState(change.localContent ?? '')

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title={`解决冲突 — ${change.assetName}`}
      subtitle={`${ASSET_META[change.kind].label} · 仓库与本地都修改了同一个文件`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            稍后处理
          </Button>
          <Button
            disabled={strategy === 'manual' && !merged.trim()}
            onClick={() => {
              resolveConflict(change.id, strategy, merged)
              toast.success(
                strategy === 'remote'
                  ? '已采用仓库版本；本地库已更新'
                  : strategy === 'local'
                    ? '已保留本地版本；合并结果已加入待推送'
                    : '已写入手动合并结果，并加入待推送',
              )
              onClose()
            }}
          >
            <Icon name="check" />
            应用并标记已解决
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { label: '基线（上次同步）', value: change.baseVersion ?? '—', tone: 'text-muted-foreground' },
              { label: '仓库版本', value: change.remoteVersion ?? '—', tone: 'text-info' },
              { label: '本地版本', value: change.localVersion ?? '—', tone: 'text-warning' },
            ] as const
          ).map((v) => (
            <div key={v.label} className="rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{v.label}</div>
              <div className={cn('mt-0.5 text-sm font-semibold', v.tone)}>{v.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: 'remote', title: '采用仓库', desc: '丢弃本地改动，仓库成为新基线' },
              { v: 'local', title: '保留本地', desc: '保留本地内容，合并结果进入待推送' },
              { v: 'manual', title: '手动合并', desc: '逐段编辑，最安全但耗时' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setStrategy(o.v)}
              className={cn(
                'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                strategy === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
              )}
            >
              <div className="text-xs font-medium">{o.title}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{o.desc}</div>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border p-3">
          {strategy === 'remote' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">仓库相对基线的改动</div>
              <DiffView before={change.baseContent ?? ''} after={change.remoteContent ?? ''} />
            </>
          )}
          {strategy === 'local' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">本地相对基线的改动</div>
              <DiffView before={change.baseContent ?? ''} after={change.localContent ?? ''} />
            </>
          )}
          {strategy === 'manual' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">合并结果（可编辑）</div>
              <Textarea rows={14} value={merged} onChange={(e) => setMerged(e.target.value)} className="font-mono text-xs leading-5" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                以本地版本为起点。应用后写入本地库并生成新版本，随后可在「待推送」把结果推回仓库。
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
