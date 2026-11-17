import { useEffect, useState } from 'react'
import type { RepoConfig } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Input, Select, Switch } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'

const STEPS = ['连接仓库', '目录映射', '同步策略', '首次预检'] as const

export function RepoConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, connectRepo, disconnectRepo } = useStore()
  const toast = useToast()

  const [step, setStep] = useState(1)
  const [url, setUrl] = useState(state.repo.url)
  const [branch, setBranch] = useState(state.repo.branch)
  const [auth, setAuth] = useState<RepoConfig['auth']>(state.repo.auth)
  const [cloneMode, setCloneMode] = useState<'managed' | 'existing'>('managed')
  const [localPath, setLocalPath] = useState(state.repo.localPath)
  const [skillsDir, setSkillsDir] = useState(state.repo.layout.skills)
  const [mcpFile, setMcpFile] = useState(state.repo.layout.mcp)
  const [promptsDir, setPromptsDir] = useState(state.repo.layout.prompts)
  const [syncPrompts, setSyncPrompts] = useState(state.repo.policies.prompts)
  const [autoFetch, setAutoFetch] = useState(state.repo.autoFetch)
  const [interval, setInterval] = useState(String(state.repo.fetchIntervalMin))
  const [pushMode, setPushMode] = useState<RepoConfig['pushMode']>(state.repo.pushMode)
  const [trusted, setTrusted] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setUrl(state.repo.url)
    setBranch(state.repo.branch)
    setAuth(state.repo.auth)
    setCloneMode('managed')
    setLocalPath(state.repo.localPath)
    setSkillsDir(state.repo.layout.skills)
    setMcpFile(state.repo.layout.mcp)
    setPromptsDir(state.repo.layout.prompts)
    setSyncPrompts(state.repo.policies.prompts)
    setAutoFetch(state.repo.autoFetch)
    setInterval(String(state.repo.fetchIntervalMin))
    setPushMode(state.repo.pushMode)
    setTrusted(false)
    setError(null)
  }, [open, state.repo])

  const next = () => {
    if (step === 1) {
      if (!url.trim() || !branch.trim() || !localPath.trim()) {
        setError('仓库地址、分支与本地克隆路径均必填')
        return
      }
    }
    if (step === 2 && (!skillsDir.trim() || !mcpFile.trim())) {
      setError('技能目录与 MCP 配置文件路径必填')
      return
    }
    setError(null)
    setStep((s) => Math.min(4, s + 1))
  }

  const finish = () => {
    connectRepo({
      ...state.repo,
      connected: true,
      provider: url.includes('gitlab') ? 'gitlab' : url.includes('github') || /^[\w.-]+\/[\w.-]+$/.test(url) ? 'github' : 'generic',
      url: url.trim(),
      branch: branch.trim(),
      auth,
      localPath: localPath.trim(),
      autoFetch,
      fetchIntervalMin: Number(interval),
      pushMode,
      layout: { skills: skillsDir.trim(), mcp: mcpFile.trim(), prompts: promptsDir.trim() },
      policies: { skills: true, mcp: true, prompts: syncPrompts },
    })
    toast.success(
      state.repo.connected
        ? '仓库设置已保存；同步状态与历史保持不变'
        : '仓库已连接。远端变更会先进入「变更」等待你审核，不会自动覆盖本地',
    )
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-2xl"
        title={state.repo.connected ? '仓库设置' : '连接 Git 仓库'}
        subtitle={`第 ${step} 步 / 共 4 步 · ${STEPS[step - 1]}`}
        footer={
          <>
            {state.repo.connected && step === 1 && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDisconnect(true)}>
                断开连接
              </Button>
            )}
            {error && <span className="mr-auto text-xs text-danger">{error}</span>}
            <Button variant="outline" onClick={step === 1 ? onClose : () => setStep((s) => Math.max(1, s - 1))}>
              {step === 1 ? '取消' : '上一步'}
            </Button>
            {step < 4 ? (
              <Button onClick={next}>
                下一步
                <Icon name="chevronRight" />
              </Button>
            ) : (
              <Button disabled={!trusted} onClick={finish}>
                {state.repo.connected ? '保存设置' : '完成连接'}
              </Button>
            )}
          </>
        }
      >
        <div className="mb-4 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  i + 1 <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {i + 1 < step ? <Icon name="check" className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn('text-[11px]', i + 1 === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">仓库地址 *</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="owner/repo 或完整 Git URL" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                支持 GitHub / GitLab / 自建 Git。示例：tony/ai-assets。私有仓库使用本机已有的 Git 凭据或 SSH Key，不在应用中保存 Token。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">分支</label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">认证方式</label>
                <Select value={auth} onChange={(e) => setAuth(e.target.value as RepoConfig['auth'])}>
                  <option value="credential">系统 Git 凭据（推荐）</option>
                  <option value="ssh">SSH Key</option>
                  <option value="token">访问令牌（仅本次会话）</option>
                </Select>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">本地克隆</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'managed', title: '由应用托管（推荐）', desc: '克隆到应用数据目录，不干扰你现有的工作仓库' },
                    { v: 'existing', title: '绑定已有克隆', desc: '复用你已 clone 的目录；有未提交改动时会先提示' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setCloneMode(o.v)}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                      cloneMode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="text-sm font-medium">{o.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">本地路径 *</label>
              <Input
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="font-mono text-xs"
                placeholder="~/Library/Application Support/Prompt Keeper/repos/ai-assets"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              <Icon name="gitBranch" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              已自动识别仓库结构。若你的仓库使用别的目录，可在此改写映射；未匹配到的资产会进入「未归档」并提示你选择。
            </div>
            {(
              [
                { label: '技能目录', value: skillsDir, set: setSkillsDir, hint: '每个技能一个子目录，含 SKILL.md 与可选 scripts/' },
                { label: 'MCP 配置文件', value: mcpFile, set: setMcpFile, hint: 'JSON / TOML；凭据必须以 ${VAR} 占位' },
                { label: 'Prompt 目录（不参与同步）', value: promptsDir, set: setPromptsDir, hint: 'Prompt 默认只在本机与平台之间流转' },
              ] as const
            ).map((f) => (
              <div key={f.label}>
                <div className="mb-1 flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <Badge variant="success">已识别</Badge>
                </div>
                <Input value={f.value} onChange={(e) => f.set(e.target.value)} className="font-mono text-xs" />
                <p className="mt-1 text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">让 Prompt 也参与仓库同步</div>
                <p className="text-[11px] text-muted-foreground">
                  不推荐。Prompt 多以复制粘贴使用，进仓库会让 diff 噪音变大；平台发现与本地保存已覆盖复用需求。
                </p>
              </div>
              <Switch checked={syncPrompts} onChange={setSyncPrompts} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">定时 fetch（只读）</div>
                <p className="text-[11px] text-muted-foreground">只拉取远端元数据并提示差异，不会自动合并或改写本地资产。</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Select className="h-8 w-24 text-xs" value={interval} onChange={(e) => setInterval(e.target.value)}>
                  <option value="5">每 5 分钟</option>
                  <option value="15">每 15 分钟</option>
                  <option value="30">每 30 分钟</option>
                  <option value="60">每小时</option>
                </Select>
                <Switch checked={autoFetch} onChange={setAutoFetch} />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">推送方式</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'branch-pr', title: '推送分支 + PR（推荐）', desc: '团队仓库可评审；个人仓库也可保留最后一次确认' },
                    { v: 'direct', title: '直接推送当前分支', desc: '适合个人仓库；会直接产生提交，失败时不改写远端' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setPushMode(o.v)}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                      pushMode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="text-sm font-medium">{o.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              <div className="flex items-center gap-1.5 font-medium">
                <Icon name="lock" className="h-3.5 w-3.5" />
                MCP 密钥策略（必须）
              </div>
              <p className="mt-1 leading-5">
                仓库里只允许 ${'{'}VAR{'}'} 形式的变量占位。推送前会扫描 env / headers，发现明文 Token 直接阻断；真实值只存本机钥匙串，
                分发到 Agent 时再按目标工具注入。
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-lg border border-border">
              {(
                [
                  { icon: 'download' as const, label: '远端资产', value: '5 个技能 · 3 个 MCP 模板 · 1 个冲突', tone: 'text-foreground' },
                  { icon: 'alert' as const, label: '可执行脚本', value: '1 个新技能含 scripts/collect.sh，需审核后写入', tone: 'text-warning' },
                  { icon: 'shield' as const, label: '凭据扫描', value: '通过：未发现明文密钥；1 个本地 MCP 待转为 ${VAR}', tone: 'text-success' },
                  { icon: 'folder' as const, label: '本地未提交改动', value: '无（应用托管的克隆目录）', tone: 'text-muted-foreground' },
                ] as const
              ).map((r) => (
                <div key={r.label} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0">
                  <Icon name={r.icon} className="text-muted-foreground" />
                  <span className="w-28 shrink-0 text-muted-foreground">{r.label}</span>
                  <span className={r.tone}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
              连接后不会自动写入任何 Agent 目录：先进入「变更」审核并合入本地库，再由你在「分发」里选择目标 Agent。
              首次分发默认 symlink；文件系统不支持时回退 copy 并逐条提示。
            </div>
            <Checkbox
              checked={trusted}
              onChange={setTrusted}
              label={
                <span className="text-xs">
                  我已确认仓库来源，并理解技能中的脚本与 MCP 命令会在本机执行
                </span>
              }
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          disconnectRepo()
          toast.warning('已断开仓库连接；本地资产与 Agent 分发不受影响')
          onClose()
        }}
        title="断开仓库连接？"
        confirmText="断开连接"
        message="只移除同步关系，不删除本地资产、版本历史与已分发文件。重新连接后可继续同步。"
      />
    </>
  )
}
