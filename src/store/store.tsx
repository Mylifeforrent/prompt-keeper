import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState, InstallMode, McpServer, Prompt, Skill, ThemeMode } from '../types'
import { SEED_MCPS, SEED_PROMPTS, SEED_SKILLS } from '../data/seed'
import { nowIso, uid } from '../lib/utils'

const STORAGE_KEY = 'pk_state_v1'

function initialState(): AppState {
  return {
    prompts: SEED_PROMPTS,
    skills: SEED_SKILLS,
    mcps: SEED_MCPS,
    settings: { theme: 'system' },
  }
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as AppState
  } catch {
    /* 损坏则回退种子 */
  }
  return initialState()
}

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
