import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppState,
  Deployment,
  InstallMode,
  McpServer,
  Prompt,
  RepoConfig,
  Skill,
  SyncEvent,
  ThemeMode,
} from '../types'
import { SEED_MCPS, SEED_PROMPTS, SEED_SKILLS } from '../data/seed'
import {
  SEED_DEPLOYMENTS,
  SEED_DETECTED_AGENTS,
  SEED_REPO,
  SEED_SYNC_CHANGES,
  SEED_SYNC_EVENTS,
} from '../data/syncSeed'
import { nowIso, uid } from '../lib/utils'

const STORAGE_KEY = 'pk_state_v1'

function initialState(): AppState {
  return {
    prompts: SEED_PROMPTS,
    skills: SEED_SKILLS,
    mcps: SEED_MCPS,
    settings: { theme: 'system' },
    repo: SEED_REPO,
    syncChanges: SEED_SYNC_CHANGES,
    deployments: SEED_DEPLOYMENTS,
    syncEvents: SEED_SYNC_EVENTS,
    detectedAgents: SEED_DETECTED_AGENTS,
  }
}

function load(): AppState {
  const base = initialState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>
      const repo = parsed.repo
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        repo: {
          ...base.repo,
          ...(repo ?? {}),
          layout: { ...base.repo.layout, ...(repo?.layout ?? {}) },
          policies: { ...base.repo.policies, ...(repo?.policies ?? {}) },
        },
        syncChanges: parsed.syncChanges ?? base.syncChanges,
        deployments: parsed.deployments ?? base.deployments,
        syncEvents: parsed.syncEvents ?? base.syncEvents,
        detectedAgents: parsed.detectedAgents ?? base.detectedAgents,
      }
    }
  } catch {
    /* 损坏或旧版本数据结构则回退种子，避免原型白屏 */
  }
  return base
}

const syncEvent = (
  type: SyncEvent['type'],
  title: string,
  detail: string | undefined,
  result: SyncEvent['result'] = 'success',
): SyncEvent => ({ id: uid(), at: nowIso(), type, title, detail, result })

const shortHash = () => Math.random().toString(16).slice(2, 9)

interface StoreApi {
  state: AppState
  setTheme: (mode: ThemeMode) => void
  resetAll: () => void

  savePrompt: (next: Prompt) => void
  deletePrompt: (id: string) => void
  togglePromptFavorite: (id: string) => void
  togglePromptPin: (id: string) => void
  markPromptUsed: (id: string) => void
  restorePromptVersion: (promptId: string, versionId: string) => void
  deletePromptVersion: (promptId: string, versionId: string) => void

  addSkillFromStore: (skill: Skill) => void
  setSkillInstall: (skillId: string, platformId: string, mode: InstallMode | null) => void
  restoreSkillVersion: (skillId: string, versionId: string) => void
  deleteSkillVersion: (skillId: string, versionId: string) => void

  saveMcp: (next: McpServer) => void
  deleteMcp: (id: string) => void
  toggleMcpEnabled: (id: string) => void
  toggleMcpFavorite: (id: string) => void
  applyMcp: (mcpId: string, platformId: string) => void
  removeMcpFromPlatform: (mcpId: string, platformId: string) => void
  restoreMcpVersion: (mcpId: string, versionId: string) => void
  deleteMcpVersion: (mcpId: string, versionId: string) => void
  importAgentMcp: (server: McpServer) => void

  connectRepo: (config: RepoConfig) => void
  disconnectRepo: () => void
  fetchRepo: () => void
  pullIncoming: (ids: string[]) => void
  pushOutgoing: (ids: string[], message: string, createPr: boolean) => void
  resolveConflict: (id: string, strategy: 'remote' | 'local' | 'manual', merged?: string) => void
  convertSecretToVar: (id: string) => void
  deployAsset: (kind: 'skill' | 'mcp', assetId: string, agentId: string, mode: InstallMode) => void
  syncDeployment: (id: string) => void
  syncAllStale: () => void
  setDeploymentMode: (id: string, mode: InstallMode) => void
  removeDeployment: (id: string) => void
  rollbackDeployment: (id: string) => void
  redetectAgents: () => string[]
}

const StoreCtx = createContext<StoreApi | null>(null)

const promptContent = (p: Prompt) => JSON.stringify([p.title, p.description, p.systemPrompt, p.userPrompt])
const mcpConfig = (m: McpServer) =>
  JSON.stringify([m.transport, m.command, m.args, m.env, m.url, m.headers])

function pushVersion(versions: Prompt['versions'], data: Record<string, string>, note?: string) {
  const max = versions.reduce((acc, v) => Math.max(acc, v.version), 0)
  return [{ id: uid(), version: max + 1, note, createdAt: nowIso(), data }, ...versions]
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* 原型忽略配额错误 */
    }
  }, [state])

  useEffect(() => {
    const apply = () => {
      const root = document.documentElement
      const mode = state.settings.theme
      const dark =
        mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [state.settings.theme])

  const api: StoreApi = {
    state,
    setTheme: (theme) => setState((s) => ({ ...s, settings: { ...s.settings, theme } })),
    resetAll: () => {
      localStorage.removeItem(STORAGE_KEY)
      setState(initialState())
    },

    savePrompt: (next) =>
      setState((s) => {
        const prev = s.prompts.find((p) => p.id === next.id)
        if (!prev) {
          return { ...s, prompts: [{ ...next, versions: next.versions.length ? next.versions : pushVersion([], promptContentOf(next)) }] }
        }
        if (promptContent(prev) === promptContent(next)) {
          return { ...s, prompts: s.prompts.map((p) => (p.id === next.id ? next : p)) }
        }
        const versions = pushVersion(prev.versions, promptContentOf(next))
        return { ...s, prompts: s.prompts.map((p) => (p.id === next.id ? { ...next, versions } : p)) }
      }),
    deletePrompt: (id) => setState((s) => ({ ...s, prompts: s.prompts.filter((p) => p.id !== id) })),
    togglePromptFavorite: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)) })),
    togglePromptPin: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, isPinned: !p.isPinned } : p)) })),
    markPromptUsed: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, usageCount: p.usageCount + 1 } : p)) })),
    restorePromptVersion: (promptId, versionId) =>
      setState((s) => ({
        ...s,
        prompts: s.prompts.map((p) => {
          if (p.id !== promptId) return p
          const target = p.versions.find((v) => v.id === versionId)
          if (!target) return p
          return {
            ...p,
            title: target.data.title ?? p.title,
            description: target.data.description ?? p.description,
            systemPrompt: target.data.systemPrompt ?? p.systemPrompt,
            userPrompt: target.data.userPrompt ?? p.userPrompt,
            updatedAt: nowIso(),
            versions: pushVersion(p.versions, target.data, `恢复自 v${target.version}`),
          }
        }),
      })),
    deletePromptVersion: (promptId, versionId) =>
      setState((s) => ({
        ...s,
        prompts: s.prompts.map((p) =>
          p.id === promptId ? { ...p, versions: p.versions.filter((v) => v.id !== versionId) } : p,
        ),
      })),

    addSkillFromStore: (skill) => setState((s) => ({ ...s, skills: [skill, ...s.skills] })),
    setSkillInstall: (skillId, platformId, mode) =>
      setState((s) => ({
        ...s,
        skills: s.skills.map((sk) => {
          if (sk.id !== skillId) return sk
          const installs = { ...sk.installs }
          if (mode === null) delete installs[platformId]
          else installs[platformId] = mode
          return { ...sk, installs }
        }),
      })),
    restoreSkillVersion: (skillId, versionId) =>
      setState((s) => ({
        ...s,
        skills: s.skills.map((sk) => {
          if (sk.id !== skillId) return sk
          const target = sk.versions.find((v) => v.id === versionId)
          if (!target) return sk
          return {
            ...sk,
            instructions: target.data.instructions ?? sk.instructions,
            versions: pushVersion(sk.versions, target.data, `恢复自 v${target.version}`),
          }
        }),
      })),
    deleteSkillVersion: (skillId, versionId) =>
      setState((s) => ({
        ...s,
        skills: s.skills.map((sk) =>
          sk.id === skillId ? { ...sk, versions: sk.versions.filter((v) => v.id !== versionId) } : sk,
        ),
      })),

    saveMcp: (next) =>
      setState((s) => {
        const prev = s.mcps.find((m) => m.id === next.id)
        if (!prev) {
          return { ...s, mcps: [{ ...next, versions: next.versions.length ? next.versions : pushVersion([], mcpConfigOf(next)) }] }
        }
        if (mcpConfig(prev) === mcpConfig(next)) {
          return { ...s, mcps: s.mcps.map((m) => (m.id === next.id ? next : m)) }
        }
        const versions = pushVersion(prev.versions, mcpConfigOf(next))
        return { ...s, mcps: s.mcps.map((m) => (m.id === next.id ? { ...next, versions } : m)) }
      }),
    deleteMcp: (id) => setState((s) => ({ ...s, mcps: s.mcps.filter((m) => m.id !== id) })),
    toggleMcpEnabled: (id) =>
      setState((s) => ({ ...s, mcps: s.mcps.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)) })),
    toggleMcpFavorite: (id) =>
      setState((s) => ({ ...s, mcps: s.mcps.map((m) => (m.id === id ? { ...m, isFavorite: !m.isFavorite } : m)) })),
    applyMcp: (mcpId, platformId) =>
      setState((s) => ({
        ...s,
        mcps: s.mcps.map((m) => (m.id === mcpId ? { ...m, installs: { ...m.installs, [platformId]: true } } : m)),
      })),
    removeMcpFromPlatform: (mcpId, platformId) =>
      setState((s) => ({
        ...s,
        mcps: s.mcps.map((m) => {
          if (m.id !== mcpId) return m
          const installs = { ...m.installs }
          delete installs[platformId]
          return { ...m, installs }
        }),
      })),
    restoreMcpVersion: (mcpId, versionId) =>
      setState((s) => ({
        ...s,
        mcps: s.mcps.map((m) => {
          if (m.id !== mcpId) return m
          const target = m.versions.find((v) => v.id === versionId)
          if (!target) return m
          let parsed: Partial<McpServer> = {}
          try {
            parsed = JSON.parse(target.data.config ?? '{}')
          } catch {
            parsed = {}
          }
          return {
            ...m,
            ...(parsed as Partial<McpServer>),
            updatedAt: nowIso(),
            versions: pushVersion(m.versions, target.data, `恢复自 v${target.version}`),
          }
        }),
      })),
    deleteMcpVersion: (mcpId, versionId) =>
      setState((s) => ({
        ...s,
        mcps: s.mcps.map((m) =>
          m.id === mcpId ? { ...m, versions: m.versions.filter((v) => v.id !== versionId) } : m,
        ),
      })),
    importAgentMcp: (server) => setState((s) => ({ ...s, mcps: [server, ...s.mcps] })),

    connectRepo: (config) =>
      setState((s) => {
        const same = s.repo.connected && s.repo.url === config.url
        return {
          ...s,
          repo: {
            ...config,
            connected: true,
            ahead: same ? s.repo.ahead : 0,
            behind: same ? s.repo.behind : 0,
            lastFetchedAt: same ? s.repo.lastFetchedAt : nowIso(),
            lastSyncedAt: same ? s.repo.lastSyncedAt : nowIso(),
          },
          syncChanges: same ? s.syncChanges : [],
          syncEvents: [
            syncEvent(
              'connect',
              same ? `仓库设置已更新 ${config.url}` : `连接仓库 ${config.url}`,
              `${config.branch} · ${config.auth === 'credential' ? '系统 Git 凭据' : config.auth === 'ssh' ? 'SSH Key' : '访问令牌'} · 目录映射已确认`,
            ),
            ...s.syncEvents,
          ],
        }
      }),
    disconnectRepo: () =>
      setState((s) => ({
        ...s,
        repo: { ...s.repo, connected: false, ahead: 0, behind: 0 },
        syncChanges: [],
        syncEvents: [syncEvent('connect', '已断开仓库连接', '本地资产库与分发状态保持不变', 'warning'), ...s.syncEvents],
      })),
    fetchRepo: () =>
      setState((s) => ({
        ...s,
        repo: { ...s.repo, lastFetchedAt: nowIso() },
        syncEvents: [
          syncEvent(
            'fetch',
            'fetch 完成 · 未自动合并',
            s.repo.behind > 0 ? `${s.repo.url} · 领先 ${s.repo.ahead} / 落后 ${s.repo.behind}，等待确认` : `${s.repo.url} · 已是最新`,
          ),
          ...s.syncEvents,
        ],
      })),

    pullIncoming: (ids) =>
      setState((s) => {
        const targets = s.syncChanges.filter((c) => ids.includes(c.id) && c.direction === 'incoming' && !c.resolved)
        if (targets.length === 0) return s
        let skills = s.skills
        let mcps = s.mcps
        for (const ch of targets) {
          if (ch.kind === 'skill') {
            const existing = skills.find((sk) => sk.name === ch.assetName)
            const content = ch.remoteContent
            if (existing) {
              const nextContent = content ?? existing.instructions
              const nextVersion = (ch.remoteVersion ?? `v${existing.version}`).replace(/^v/, '')
              skills = skills.map((sk) =>
                sk.id === existing.id
                  ? {
                      ...sk,
                      version: nextVersion,
                      instructions: nextContent,
                      updatedAt: nowIso(),
                      versions: pushVersion(sk.versions, { instructions: nextContent }, `仓库更新 ${ch.remoteVersion ?? ''}`.trim()),
                    }
                  : sk,
              )
            } else {
              const nextContent =
                content ?? `# ${ch.assetName}\n\n${ch.summary}\n\n> 来自仓库 ${ch.path}\n`
              const version = (ch.remoteVersion ?? ch.versionLabel ?? 'v1.0.0').replace(/^v/, '')
              skills = [
                {
                  id: uid(),
                  name: ch.assetName,
                  emoji: '📦',
                  description: ch.summary,
                  author: 'repo',
                  version,
                  source: 'import',
                  category: '仓库同步',
                  tags: ['仓库'],
                  instructions: nextContent,
                  installs: {},
                  versions: [
                    {
                      id: uid(),
                      version: 1,
                      note: `来自仓库 ${ch.versionLabel ?? ''}`.trim(),
                      createdAt: nowIso(),
                      data: { instructions: nextContent },
                    },
                  ],
                  installedAt: nowIso(),
                },
                ...skills,
              ]
            }
          }
          if (ch.kind === 'mcp') {
            mcps = mcps.map((m) => {
              if (m.name !== ch.assetName) return m
              const args =
                m.name === 'github' && !(m.args ?? []).includes('--toolsets')
                  ? [...(m.args ?? []), '--toolsets', 'repos,issues,pull_requests']
                  : m.args
              const next = { ...m, args, updatedAt: nowIso() }
              return { ...next, versions: pushVersion(m.versions, mcpConfigOf(next), '仓库模板更新') }
            })
          }
        }
        return {
          ...s,
          skills,
          mcps,
          repo: {
            ...s.repo,
            behind: Math.max(0, s.repo.behind - targets.length),
            lastSyncedAt: nowIso(),
          },
          syncChanges: s.syncChanges.map((c) => (targets.some((t) => t.id === c.id) ? { ...c, resolved: true } : c)),
          syncEvents: [
            syncEvent(
              'pull',
              `拉取 ${targets.length} 项变更到本地库`,
              targets.map((t) => `${t.kind}:${t.assetName}`).join(' · '),
            ),
            ...s.syncEvents,
          ],
        }
      }),

    pushOutgoing: (ids, message, createPr) =>
      setState((s) => {
        const targets = s.syncChanges.filter(
          (c) => ids.includes(c.id) && c.direction === 'outgoing' && !c.resolved && !c.blocked,
        )
        if (targets.length === 0) return s
        const hash = shortHash()
        const detail = createPr
          ? `分支 prompt-keeper/sync-${hash.slice(0, 4)} · 已创建 PR（${message}）`
          : `直接推送到 ${s.repo.branch} · commit ${hash}（${message}）`
        return {
          ...s,
          repo: { ...s.repo, ahead: Math.max(0, s.repo.ahead - targets.length), lastSyncedAt: nowIso() },
          syncChanges: s.syncChanges.map((c) => (targets.some((t) => t.id === c.id) ? { ...c, resolved: true } : c)),
          syncEvents: [
            syncEvent('push', `推送 ${targets.length} 个变更 · commit ${hash}`, detail),
            ...s.syncEvents,
          ],
        }
      }),

    resolveConflict: (id, strategy, merged) =>
      setState((s) => {
        const ch = s.syncChanges.find((c) => c.id === id)
        if (!ch) return s
        let skills = s.skills
        if (ch.kind === 'skill') {
          const content = strategy === 'remote' ? ch.remoteContent : strategy === 'manual' ? merged : undefined
          if (content !== undefined) {
            skills = s.skills.map((sk) => {
              if (sk.name !== ch.assetName) return sk
              const nextVersion =
                strategy === 'remote' && ch.remoteVersion ? ch.remoteVersion.replace(/^v/, '') : sk.version
              return {
                ...sk,
                version: nextVersion,
                instructions: content,
                updatedAt: nowIso(),
                versions: pushVersion(sk.versions, { instructions: content }, `解决同步冲突（${strategy === 'remote' ? '采用仓库' : '手动合并'}）`),
              }
            })
          }
        }
        const followUp =
          strategy !== 'remote'
            ? [
                {
                  id: uid(),
                  kind: ch.kind,
                  assetName: ch.assetName,
                  path: ch.path,
                  change: 'modified' as const,
                  direction: 'outgoing' as const,
                  summary:
                    strategy === 'manual'
                      ? '冲突手动合并结果待推送'
                      : '冲突已按本地版本解决，合并结果待推送',
                  additions: 0,
                  deletions: 0,
                  risk: 'none' as const,
                  localVersion: ch.localVersion,
                  baseVersion: ch.remoteVersion,
                },
              ]
            : []
        return {
          ...s,
          skills,
          repo: {
            ...s.repo,
            ahead: strategy === 'remote' ? Math.max(0, s.repo.ahead - 1) : s.repo.ahead,
            behind: Math.max(0, s.repo.behind - 1),
            lastSyncedAt: nowIso(),
          },
          syncChanges: [
            ...followUp,
            ...s.syncChanges.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
          ],
          syncEvents: [
            syncEvent(
              'conflict',
              `已解决冲突：${ch.kind}:${ch.assetName}`,
              strategy === 'remote' ? '采用仓库版本' : strategy === 'local' ? '保留本地版本' : '手动合并后写入本地库',
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    convertSecretToVar: (id) =>
      setState((s) => {
        const ch = s.syncChanges.find((c) => c.id === id)
        if (!ch) return s
        return {
          ...s,
          syncChanges: s.syncChanges.map((c) =>
            c.id === id
              ? {
                  ...c,
                  blocked: false,
                  risk: 'none',
                  summary: '已把明文密钥替换为 ${AMAP_API_KEY} 占位，真实值仅存于本机钥匙串',
                }
              : c,
          ),
          syncEvents: [
            syncEvent(
              'blocked',
              `已解除推送阻断：mcp:${ch.assetName}`,
              '明文密钥已转为 ${VAR} 占位；本机值不会进入仓库',
              'success',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    deployAsset: (kind, assetId, agentId, mode) =>
      setState((s) => {
        const skill = kind === 'skill' ? s.skills.find((x) => x.id === assetId) : undefined
        const mcp = kind === 'mcp' ? s.mcps.find((x) => x.id === assetId) : undefined
        const asset = skill ?? mcp
        if (!asset) return s
        if (mcp && !mcp.enabled) return s
        const version = skill ? `v${skill.version}` : `v${mcp?.versions[0]?.version ?? 1}`
        const existing = s.deployments.find(
          (d) => d.kind === kind && d.assetId === assetId && d.agentId === agentId,
        )
        const deployments = existing
          ? s.deployments.map((d) =>
              d.id === existing.id
                ? {
                    ...d,
                    mode,
                    status: 'synced' as const,
                    previousVersion: d.deployedVersion,
                    deployedVersion: version,
                    deployedAt: nowIso(),
                    note: undefined,
                  }
                : d,
            )
          : [
              {
                id: uid(),
                kind,
                assetId,
                assetName: asset.name,
                agentId,
                mode,
                status: 'synced' as const,
                deployedVersion: version,
                deployedAt: nowIso(),
              },
              ...s.deployments,
            ]
        const skills = skill
          ? s.skills.map((x) => (x.id === assetId ? { ...x, installs: { ...x.installs, [agentId]: mode } } : x))
          : s.skills
        const mcps = mcp
          ? s.mcps.map((x) => (x.id === assetId ? { ...x, installs: { ...x.installs, [agentId]: true } } : x))
          : s.mcps
        return {
          ...s,
          deployments,
          skills,
          mcps,
          syncEvents: [
            syncEvent('deploy', `分发 ${kind}:${asset.name} → ${agentId}`, `${mode} · ${version}`),
            ...s.syncEvents,
          ],
        }
      }),

    syncDeployment: (id) =>
      setState((s) => {
        const target = s.deployments.find((d) => d.id === id)
        if (!target) return s
        const targetMcp = target.kind === 'mcp' ? s.mcps.find((m) => m.id === target.assetId) : undefined
        if (targetMcp && !targetMcp.enabled) return s
        const version =
          target.kind === 'skill'
            ? `v${s.skills.find((sk) => sk.id === target.assetId)?.version ?? target.deployedVersion.replace(/^v/, '')}`
            : `v${s.mcps.find((m) => m.id === target.assetId)?.versions[0]?.version ?? 1}`
        return {
          ...s,
          deployments: s.deployments.map((d) =>
            d.id === id
              ? {
                  ...d,
                  status: 'synced',
                  previousVersion: d.deployedVersion,
                  deployedVersion: version,
                  deployedAt: nowIso(),
                  note: undefined,
                }
              : d,
          ),
          syncEvents: [
            syncEvent('deploy', `分发 ${target.kind}:${target.assetName} → ${target.agentId}`, `${target.mode} · ${version}`),
            ...s.syncEvents,
          ],
        }
      }),

    syncAllStale: () =>
      setState((s) => {
        const targets = s.deployments.filter(
          (d) => d.status === 'stale' && !(d.kind === 'mcp' && s.mcps.find((m) => m.id === d.assetId)?.enabled === false),
        )
        if (targets.length === 0) return s
        const deployments = s.deployments.map((d) => {
          if (!targets.some((t) => t.id === d.id)) return d
          const version =
            d.kind === 'skill'
              ? `v${s.skills.find((sk) => sk.id === d.assetId)?.version ?? d.deployedVersion.replace(/^v/, '')}`
              : `v${s.mcps.find((m) => m.id === d.assetId)?.versions[0]?.version ?? 1}`
          return { ...d, status: 'synced' as const, previousVersion: d.deployedVersion, deployedVersion: version, deployedAt: nowIso(), note: undefined }
        })
        return {
          ...s,
          deployments,
          syncEvents: [
            syncEvent('deploy', `批量分发 ${targets.length} 项过时资产`, '仅同步 stale；drifted（Agent 内被改过）不自动覆盖'),
            ...s.syncEvents,
          ],
        }
      }),

    setDeploymentMode: (id, mode) =>
      setState((s) => ({
        ...s,
        deployments: s.deployments.map((d) => (d.id === id ? { ...d, mode } : d)),
      })),

    removeDeployment: (id) =>
      setState((s) => {
        const target = s.deployments.find((d) => d.id === id)
        return {
          ...s,
          deployments: s.deployments.filter((d) => d.id !== id),
          syncEvents: target
            ? [syncEvent('deploy', `已移除分发 ${target.kind}:${target.assetName}`, `目标 ${target.agentId}，不影响本地库与仓库`, 'warning'), ...s.syncEvents]
            : s.syncEvents,
        }
      }),

    rollbackDeployment: (id) =>
      setState((s) => {
        const target = s.deployments.find((d) => d.id === id)
        if (!target?.previousVersion) return s
        return {
          ...s,
          deployments: s.deployments.map((d) =>
            d.id === id
              ? { ...d, status: 'stale', deployedVersion: d.previousVersion!, previousVersion: d.deployedVersion, deployedAt: nowIso(), note: '已回滚到上一版本' }
              : d,
          ),
          syncEvents: [
            syncEvent(
              'rollback',
              `回滚分发 ${target.kind}:${target.assetName} → ${target.agentId}`,
              `恢复 ${target.previousVersion}，本地库与仓库未变`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    redetectAgents: () => {
      const next = [...new Set([...state.detectedAgents, 'cline'])]
      setState((s) => ({
        ...s,
        detectedAgents: next,
        syncEvents: [
          syncEvent('deploy', `重新检测本机 Agent · 发现 ${next.length} 个`, '扫描各工具默认目录与配置文件，未安装的工具不写入'),
          ...s.syncEvents,
        ],
      }))
      return next
    },
  }

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

// 内容快照辅助（避免把版本数组写进 data）
function promptContentOf(p: Prompt): Record<string, string> {
  return { title: p.title, description: p.description, systemPrompt: p.systemPrompt, userPrompt: p.userPrompt }
}
function mcpConfigOf(m: McpServer): Record<string, string> {
  return {
    config: JSON.stringify(
      { transport: m.transport, command: m.command, args: m.args, env: m.env, url: m.url, headers: m.headers },
      null,
      2,
    ),
  }
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用')
  return ctx
}
