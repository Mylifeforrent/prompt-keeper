import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AgentContract,
  AgentGlobalTarget,
  AppState,
  Deployment,
  GlobalProjection,
  InstallMode,
  McpServer,
  Prompt,
  PromptSyncPolicy,
  RepoConfig,
  Skill,
  SyncChange,
  SyncEvent,
  SyncRisk,
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
import { SEED_CONTRACT_PROJECTIONS, SEED_CONTRACTS } from '../data/contractSeed'
import { TARGET_BY_ID } from '../data/contractTargets'
import { DEFAULT_GLOBAL_TARGETS, SEED_GLOBAL_PROJECTIONS } from '../data/globalTargets'
import { nowIso, uid } from '../lib/utils'
import { folderFromRepoPath, normalizeFolder } from '../lib/folders'
import { isSecretKey, mcpFilePath, parseMcpRepoFile, serializeMcpRepoFile } from '../lib/mcp'
import { skillFilePath, skillHasScripts } from '../lib/skills'
import { globalTargetSupports } from '../lib/globalTargets'
import {
  containsLikelySecret,
  maskSecretsInPrompt,
  parsePromptFile,
  promptEffectiveSync,
  promptFilePath,
  serializePromptFile,
} from '../lib/promptSync'
import {
  contractFilePath,
  contractSlug,
  contractSyncEnabled,
  contractTargetSupports,
  contractVersionLabel,
  parseContractFile,
  serializeContractFile,
} from '../lib/contracts'
import { mergeVariableDefs } from '../lib/variables'

const STORAGE_KEY = 'pk_state_v1'
const SCHEMA_VERSION = 4

function initialState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    prompts: SEED_PROMPTS,
    contracts: SEED_CONTRACTS,
    skills: SEED_SKILLS,
    mcps: SEED_MCPS,
    settings: { theme: 'system' },
    repo: SEED_REPO,
    syncChanges: SEED_SYNC_CHANGES,
    deployments: SEED_DEPLOYMENTS,
    contractProjections: SEED_CONTRACT_PROJECTIONS,
    globalTargets: DEFAULT_GLOBAL_TARGETS,
    globalProjections: SEED_GLOBAL_PROJECTIONS,
    syncEvents: SEED_SYNC_EVENTS,
    detectedAgents: SEED_DETECTED_AGENTS,
  }
}

/** Keep user-modified global paths while backfilling newly added target definitions */
function mergeGlobalTargets(saved: AgentGlobalTarget[] | undefined): AgentGlobalTarget[] {
  return DEFAULT_GLOBAL_TARGETS.map((def) => {
    const hit = saved?.find((target) => target.id === def.id)
    return hit
      ? { ...def, path: hit.path || def.defaultPath, defaultPath: def.defaultPath }
      : { ...def }
  })
}

function load(): AppState {
  const base = initialState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>
      const repo = parsed.repo
      const legacy = parsed.schemaVersion !== SCHEMA_VERSION
      const seedPrompt = new Map(base.prompts.map((p) => [p.id, p]))

      let prompts = (parsed.prompts ?? base.prompts).map((p) => {
        const seed = seedPrompt.get(p.id)
        return {
          ...p,
          folder: normalizeFolder(p.folder) ?? seed?.folder ?? null,
          syncPolicy: (p as Partial<Prompt>).syncPolicy ?? 'inherit',
        }
      })
      let contracts = (parsed.contracts ?? base.contracts).map((c) => {
        const seed = base.contracts.find((item) => item.id === c.id)
        return { ...c, folder: normalizeFolder(c.folder) ?? seed?.folder ?? null }
      })
      let skills = (parsed.skills ?? base.skills).map((s) => {
        const seed = base.skills.find((item) => item.id === s.id || item.name === s.name)
        return {
          ...s,
          folder: normalizeFolder(s.folder) ?? seed?.folder ?? normalizeFolder(s.category) ?? null,
        }
      })
      let mcps = (parsed.mcps ?? base.mcps).map((m) => {
        const seed = base.mcps.find((item) => item.id === m.id || item.name === m.name)
        return { ...m, folder: normalizeFolder(m.folder) ?? seed?.folder ?? null }
      })

      let contractProjections = parsed.contractProjections ?? base.contractProjections
      const globalTargets = mergeGlobalTargets(parsed.globalTargets)
      const globalProjections = parsed.globalProjections ?? base.globalProjections
      let syncChanges = parsed.syncChanges ?? base.syncChanges

      if (legacy) {
        // Upgrading from an older version: backfill Prompt / instruction / global directory demo data and enable Prompt and instruction sync by default
        const ids = new Set(prompts.map((p) => p.id))
        prompts = [...prompts, ...base.prompts.filter((p) => !ids.has(p.id))]
        const promptSeeds = base.syncChanges.filter((c) => c.kind === 'prompt')
        syncChanges = [...syncChanges.filter((c) => c.kind !== 'prompt'), ...promptSeeds]

        const contractIds = new Set(contracts.map((c) => c.id))
        contracts = [...contracts, ...base.contracts.filter((c) => !contractIds.has(c.id))]
        const projectionIds = new Set(contractProjections.map((p) => p.id))
        contractProjections = [
          ...contractProjections,
          ...base.contractProjections.filter((p) => !projectionIds.has(p.id)),
        ]
        const contractSeeds = base.syncChanges.filter((c) => c.kind === 'contract')
        syncChanges = [...syncChanges.filter((c) => c.kind !== 'contract'), ...contractSeeds]
      }

      const layout = {
        ...base.repo.layout,
        ...(repo?.layout ?? {}),
      }
      // Before v0.4, MCP was a single servers.json file; v0.5 switched to one file per server per folder
      if (layout.mcp === 'mcp/servers.json') layout.mcp = 'mcp'

      // After an asset moves to another folder, the repo path of pending sync items must move with it
      syncChanges = syncChanges.map((change) => {
        if (change.kind === 'prompt') {
          const prompt =
            prompts.find((p) => (change.assetId ? p.id === change.assetId : p.title === change.assetName)) ??
            prompts.find((p) => p.title === change.assetName)
          return prompt ? { ...change, path: promptFilePath(prompt, layout.prompts) } : change
        }
        if (change.kind === 'contract') {
          const contract =
            contracts.find((c) => (change.assetId ? c.id === change.assetId : c.title === change.assetName)) ??
            contracts.find((c) => c.title === change.assetName)
          return contract ? { ...change, path: contractFilePath(contract, layout.contracts) } : change
        }
        if (change.kind === 'skill') {
          const skill = skills.find((s) => s.name === change.assetName)
          return skill ? { ...change, path: skillFilePath(skill, layout.skills) } : change
        }
        if (change.kind === 'mcp') {
          const mcp = mcps.find((m) => m.name === change.assetName)
          return mcp ? { ...change, path: mcpFilePath(mcp, layout.mcp) } : change
        }
        return change
      })

      return {
        ...base,
        ...parsed,
        schemaVersion: SCHEMA_VERSION,
        prompts,
        contracts,
        skills,
        mcps,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        repo: {
          ...base.repo,
          ...(repo ?? {}),
          layout,
          policies: {
            ...base.repo.policies,
            ...(repo?.policies ?? {}),
            ...(legacy ? { prompts: true, contracts: true } : {}),
          },
        },
        syncChanges,
        deployments: parsed.deployments ?? base.deployments,
        contractProjections,
        globalTargets,
        globalProjections,
        syncEvents: parsed.syncEvents ?? base.syncEvents,
        detectedAgents: parsed.detectedAgents ?? base.detectedAgents,
      }
    }
  } catch {
    /* Fall back to seed data when the stored structure is corrupt or from an older version, to avoid a blank prototype screen */
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
  setPromptSyncPolicy: (id: string, policy: PromptSyncPolicy) => void
  restorePromptVersion: (promptId: string, versionId: string) => void
  deletePromptVersion: (promptId: string, versionId: string) => void

  saveContract: (next: AgentContract) => void
  deleteContract: (id: string) => void
  setContractSyncPolicy: (id: string, policy: PromptSyncPolicy) => void
  restoreContractVersion: (contractId: string, versionId: string) => void
  deleteContractVersion: (contractId: string, versionId: string) => void
  deployContract: (contractId: string, targetId: string) => void
  syncContractProjection: (id: string) => void
  removeContractProjection: (id: string) => void
  rollbackContractProjection: (id: string) => void

  updateGlobalTargetPath: (targetId: string, path: string) => void
  resetGlobalTargetPath: (targetId: string) => void
  deployGlobal: (contractIds: string[], targetIds: string[]) => void
  syncGlobalProjection: (id: string) => void
  removeGlobalProjection: (id: string) => void
  rollbackGlobalProjection: (id: string) => void

  addSkillFromStore: (skill: Skill) => void
  saveSkill: (next: Skill) => void
  deleteSkill: (id: string) => void
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

function promptVersionLabel(prompt: Prompt): string {
  return `v${prompt.versions[0]?.version ?? 1}`
}

function matchesPromptChange(change: SyncChange, prompt: Prompt): boolean {
  if (change.kind !== 'prompt') return false
  return change.assetId ? change.assetId === prompt.id : change.assetName === prompt.title
}

/**
 * Prompt sync scope change:
 * - Entering sync → create a pending push (if there is no unresolved change)
 * - Leaving sync → withdraw unresolved changes, but leave repo files untouched
 */
function transitionPromptSyncPolicy(state: AppState, before: Prompt, after: Prompt): AppState {
  if (before.syncPolicy === after.syncPolicy) return state
  const wasEffective = promptEffectiveSync(state.repo, before)
  const willEffective = promptEffectiveSync(state.repo, after)
  let nextState = state
  let title: string
  let detail: string
  let result: SyncEvent['result'] = 'success'

  if (willEffective && !wasEffective) {
    const existing = state.syncChanges.find((c) => matchesPromptChange(c, after) && !c.resolved)
    if (!existing) {
      nextState = withPromptLocalChange(
        nextState,
        after,
        after.inRepo ? 'modified' : 'added',
        after.inRepo ? 'Rejoined repository sync, pending push' : 'Added to repository sync, pending push',
      )
    }
    title = `Added to repository sync: prompt:${after.title}`
    detail = existing ? 'A pending change already exists; pushing still needs confirmation in Sync Center' : 'Created a pending push change; nothing is committed automatically'
  } else if (!willEffective && wasEffective) {
    let withdrawn = 0
    nextState = {
      ...state,
      syncChanges: state.syncChanges.map((c) => {
        if (matchesPromptChange(c, after) && !c.resolved) {
          withdrawn++
          return { ...c, resolved: true }
        }
        return c
      }),
    }
    title = `Set to local only: prompt:${after.title}`
    detail = withdrawn
      ? `Withdrew ${withdrawn} pending sync changes; existing repository files will not be deleted`
      : 'Existing repository files will not be deleted'
    result = 'warning'
  } else if (after.syncPolicy === 'sync' && !state.repo.policies.prompts) {
    title = `Prompt sync is off: ${after.title}`
    detail = 'Enable Prompt sync in Sync Center first; for now only the preference is saved and no pending push is created'
    result = 'warning'
  } else {
    title = `Prompt sync scope updated: ${after.title}`
    detail = 'Still in the local library; the policy takes effect once a repository is connected'
  }

  return {
    ...nextState,
    syncEvents: [syncEvent('review', title, detail, result), ...nextState.syncEvents],
  }
}


/**
 * Update pending-push / conflict state when a sync-enabled Prompt is edited locally:
 * - A remote change already exists → upgrade to a conflict (keep the remote content for three-way comparison)
 * - A pending push already exists → update content and version
 * - Otherwise create a new pending push
 */
function withPromptLocalChange(
  state: AppState,
  prompt: Prompt,
  changeKind: SyncChange['change'],
  summary?: string,
): AppState {
  if (!promptEffectiveSync(state.repo, prompt)) return state
  const file = serializePromptFile(prompt)
  const risk = containsLikelySecret(file) ? 'secrets' : 'none'
  const existing = state.syncChanges.find((c) => matchesPromptChange(c, prompt) && !c.resolved)
  const version = promptVersionLabel(prompt)
  const nextPath = promptFilePath(prompt, state.repo.layout.prompts)

  if (existing) {
    if (existing.direction === 'incoming') {
      const conflict: SyncChange = {
        ...existing,
        direction: 'conflict',
        summary: summary ?? 'Local edits conflict with repository updates: both sides changed the same Prompt',
        localContent: file,
        baseContent: existing.baseContent ?? existing.remoteContent ?? '',
        localVersion: version,
        risk,
        blocked: false,
      }
      return {
        ...state,
        syncChanges: state.syncChanges.map((c) => (c.id === existing.id ? conflict : c)),
      }
    }
    const next: SyncChange = {
      ...existing,
      assetName: prompt.title,
      path: nextPath,
      change: existing.change === 'added' ? 'added' : changeKind,
      summary: summary ?? existing.summary,
      localContent: file,
      localVersion: version,
      risk,
      blocked: risk === 'secrets',
    }
    return {
      ...state,
      syncChanges: state.syncChanges.map((c) => (c.id === existing.id ? next : c)),
    }
  }

  const change: SyncChange = {
    id: uid(),
    kind: 'prompt',
    assetId: prompt.id,
    assetName: prompt.title,
    path: nextPath,
    change: changeKind,
    direction: 'outgoing',
    summary: summary ?? (changeKind === 'added' ? 'New Prompt, pending push' : 'Prompt edited locally, pending push'),
    additions: file.split('\n').length,
    deletions: 0,
    risk,
    blocked: risk === 'secrets',
    localVersion: version,
    localContent: file,
  }
  return { ...state, syncChanges: [change, ...state.syncChanges] }
}

/* ---------------- Agent Instructions / contract sync ---------------- */

const contractContent = (c: AgentContract) =>
  JSON.stringify({
    title: c.title,
    description: c.description,
    folder: c.folder,
    body: c.body,
    scope: c.scope,
    path: c.path ?? '',
    priority: c.priority,
    activation: c.activation,
    imports: c.imports,
    targets: c.targets,
    tags: c.tags,
  })

const contractVersionData = (c: AgentContract): Record<string, string> => ({
  content: contractContent(c),
})

function matchesContractChange(change: SyncChange, contract: AgentContract): boolean {
  if (change.kind !== 'contract') return false
  return change.assetId ? change.assetId === contract.id : change.assetName === contract.title
}

function markContractProjectionsStale(
  state: AppState,
  contractId: string,
  note = 'Contract content updated, pending re-projection',
): AppState {
  return {
    ...state,
    contractProjections: state.contractProjections.map((p) =>
      p.contractId === contractId
        ? p.status === 'drifted'
          ? p
          : { ...p, status: 'stale', note }
        : p,
    ),
    globalProjections: state.globalProjections.map((p) =>
      p.contractId === contractId
        ? p.status === 'drifted'
          ? p
          : { ...p, status: 'stale', note: `${note} (global directory)` }
        : p,
    ),
  }
}

/**
 * Update pending-push / conflict state when a sync-enabled contract is edited locally:
 * - A remote change already exists → upgrade to a conflict (keep the remote content for three-way comparison)
 * - A pending push already exists → update content and version
 * - Otherwise create a new pending push
 */
function withContractLocalChange(
  state: AppState,
  contract: AgentContract,
  changeKind: SyncChange['change'],
  summary?: string,
): AppState {
  if (!contractSyncEnabled(state.repo, contract)) return state
  const file = serializeContractFile(contract)
  const risk = containsLikelySecret(file) ? 'secrets' : 'none'
  const existing = state.syncChanges.find((c) => matchesContractChange(c, contract) && !c.resolved)
  const version = contractVersionLabel(contract)
  const nextPath = contractFilePath(contract, state.repo.layout.contracts)

  if (existing) {
    if (existing.direction === 'incoming') {
      const conflict: SyncChange = {
        ...existing,
        direction: 'conflict',
        summary: summary ?? 'Local edits conflict with repository updates: both sides changed the same instruction contract',
        localContent: file,
        baseContent: existing.baseContent ?? existing.remoteContent ?? '',
        localVersion: version,
        risk,
        blocked: false,
      }
      return {
        ...state,
        syncChanges: state.syncChanges.map((c) => (c.id === existing.id ? conflict : c)),
      }
    }
    const next: SyncChange = {
      ...existing,
      assetName: contract.title,
      path: nextPath,
      change: existing.change === 'added' ? 'added' : changeKind,
      summary: summary ?? existing.summary,
      localContent: file,
      localVersion: version,
      risk,
      blocked: risk === 'secrets',
    }
    return {
      ...state,
      syncChanges: state.syncChanges.map((c) => (c.id === existing.id ? next : c)),
    }
  }

  const change: SyncChange = {
    id: uid(),
    kind: 'contract',
    assetId: contract.id,
    assetName: contract.title,
    path: nextPath,
    change: changeKind,
    direction: 'outgoing',
    summary: summary ?? (changeKind === 'added' ? 'New instruction contract, pending push' : 'Instruction contract edited locally, pending push'),
    additions: file.split('\n').length,
    deletions: 0,
    risk,
    blocked: risk === 'secrets',
    localVersion: version,
    localContent: file,
  }
  return { ...state, syncChanges: [change, ...state.syncChanges] }
}

function transitionContractSyncPolicy(state: AppState, before: AgentContract, after: AgentContract): AppState {
  if (before.syncPolicy === after.syncPolicy) return state
  const wasEffective = contractSyncEnabled(state.repo, before)
  const willEffective = contractSyncEnabled(state.repo, after)
  let nextState = state
  let title: string
  let detail: string
  let result: SyncEvent['result'] = 'success'

  if (willEffective && !wasEffective) {
    const existing = state.syncChanges.find((c) => matchesContractChange(c, after) && !c.resolved)
    if (!existing) {
      nextState = withContractLocalChange(
        nextState,
        after,
        after.inRepo ? 'modified' : 'added',
        after.inRepo ? 'Rejoined repository sync, pending push' : 'Added to repository sync, pending push',
      )
    }
    title = `Added to repository sync: instruction:${after.title}`
    detail = existing ? 'A pending change already exists; pushing still needs confirmation in Sync Center' : 'Created a pending push change; nothing is committed automatically'
  } else if (!willEffective && wasEffective) {
    let withdrawn = 0
    nextState = {
      ...state,
      syncChanges: state.syncChanges.map((c) => {
        if (matchesContractChange(c, after) && !c.resolved) {
          withdrawn++
          return { ...c, resolved: true }
        }
        return c
      }),
    }
    title = `Set to local only: instruction:${after.title}`
    detail = withdrawn
      ? `Withdrew ${withdrawn} pending sync changes; existing repository files will not be deleted`
      : 'Existing repository files will not be deleted'
    result = 'warning'
  } else if (after.syncPolicy === 'sync' && !state.repo.policies.contracts) {
    title = `Instruction sync is off: ${after.title}`
    detail = 'Enable Agent Instructions sync in Sync Center first; for now only the preference is saved and no pending push is created'
    result = 'warning'
  } else {
    title = `Instruction sync scope updated: ${after.title}`
    detail = 'Still in the local library; the policy takes effect once a repository is connected'
  }

  return {
    ...nextState,
    syncEvents: [syncEvent('review', title, detail, result), ...nextState.syncEvents],
  }
}

/* ---------------- Skill / MCP two-way sync ---------------- */

function matchesSkillChange(change: SyncChange, skill: Skill): boolean {
  if (change.kind !== 'skill') return false
  return change.assetId ? change.assetId === skill.id : change.assetName === skill.name
}

function withSkillLocalChange(
  state: AppState,
  skill: Skill,
  changeKind: SyncChange['change'],
  summary?: string,
): AppState {
  if (!state.repo.connected || !state.repo.policies.skills) return state
  const content = skill.instructions
  const risk: SyncRisk = skillHasScripts(content) ? 'scripts' : 'none'
  const path = skillFilePath(skill, state.repo.layout.skills)
  const version = `v${skill.version}`
  const existing = state.syncChanges.find((c) => matchesSkillChange(c, skill) && !c.resolved)

  if (existing) {
    if (existing.direction === 'incoming') {
      return {
        ...state,
        syncChanges: state.syncChanges.map((c) =>
          c.id === existing.id
            ? {
                ...existing,
                direction: 'conflict',
                summary: summary ?? 'Local edits conflict with repository updates: both sides changed the same Skill',
                localContent: content,
                baseContent: existing.baseContent ?? existing.remoteContent ?? '',
                localVersion: version,
                risk,
                blocked: false,
              }
            : c,
        ),
      }
    }
    return {
      ...state,
      syncChanges: state.syncChanges.map((c) =>
        c.id === existing.id
          ? {
              ...existing,
              assetName: skill.name,
              path,
              change: existing.change === 'added' ? 'added' : changeKind,
              summary: summary ?? existing.summary,
              localContent: content,
              localVersion: version,
              risk,
              blocked: false,
            }
          : c,
      ),
    }
  }

  return {
    ...state,
    syncChanges: [
      {
        id: uid(),
        kind: 'skill',
        assetId: skill.id,
        assetName: skill.name,
        path,
        change: changeKind,
        direction: 'outgoing',
        summary: summary ?? (changeKind === 'added' ? 'New local Skill, pending push' : 'Skill edited locally, pending push'),
        additions: content.split('\n').length,
        deletions: 0,
        risk,
        blocked: false,
        localVersion: version,
        localContent: content,
      },
      ...state.syncChanges,
    ],
  }
}

function matchesMcpChange(change: SyncChange, mcp: McpServer): boolean {
  if (change.kind !== 'mcp') return false
  return change.assetId ? change.assetId === mcp.id : change.assetName === mcp.name
}

function withMcpLocalChange(
  state: AppState,
  mcp: McpServer,
  changeKind: SyncChange['change'],
  summary?: string,
): AppState {
  if (!state.repo.connected || !state.repo.policies.mcp) return state
  const content = serializeMcpRepoFile(mcp)
  const risk = containsLikelySecret(content) ? 'secrets' : 'none'
  const path = mcpFilePath(mcp, state.repo.layout.mcp)
  const version = `v${mcp.versions[0]?.version ?? 1}`
  const existing = state.syncChanges.find((c) => matchesMcpChange(c, mcp) && !c.resolved)

  if (existing) {
    if (existing.direction === 'incoming') {
      return {
        ...state,
        syncChanges: state.syncChanges.map((c) =>
          c.id === existing.id
            ? {
                ...existing,
                direction: 'conflict',
                summary: summary ?? 'Local edits conflict with repository updates: both sides changed the same MCP template',
                localContent: content,
                baseContent: existing.baseContent ?? existing.remoteContent ?? '',
                localVersion: version,
                risk,
                blocked: false,
              }
            : c,
        ),
      }
    }
    return {
      ...state,
      syncChanges: state.syncChanges.map((c) =>
        c.id === existing.id
          ? {
              ...existing,
              assetName: mcp.name,
              path,
              change: existing.change === 'added' ? 'added' : changeKind,
              summary: summary ?? existing.summary,
              localContent: content,
              localVersion: version,
              risk,
              blocked: risk === 'secrets',
            }
          : c,
      ),
    }
  }

  return {
    ...state,
    syncChanges: [
      {
        id: uid(),
        kind: 'mcp',
        assetId: mcp.id,
        assetName: mcp.name,
        path,
        change: changeKind,
        direction: 'outgoing',
        summary: summary ?? (changeKind === 'added' ? 'New local MCP template, pending push' : 'MCP template edited locally, pending push'),
        additions: content.split('\n').length,
        deletions: 0,
        risk,
        blocked: risk === 'secrets',
        localVersion: version,
        localContent: content,
      },
      ...state.syncChanges,
    ],
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* Prototype ignores quota errors */
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
          const created: Prompt = {
            ...next,
            versions: next.versions.length ? next.versions : pushVersion([], promptContentOf(next)),
          }
          const state: AppState = { ...s, prompts: [created, ...s.prompts] }
          return withPromptLocalChange(state, created, 'added', 'New local Prompt, pending push')
        }
        const contentChanged = promptContent(prev) !== promptContent(next)
        const metaChanged = serializePromptFile(prev) !== serializePromptFile(next)
        const policyChanged = prev.syncPolicy !== next.syncPolicy
        if (!contentChanged) {
          let state: AppState = {
            ...s,
            prompts: s.prompts.map((p) => (p.id === next.id ? next : p)),
          }
          if (metaChanged && !policyChanged) {
            state = withPromptLocalChange(state, next, 'modified', 'Prompt metadata updated locally, pending push')
          }
          return policyChanged ? transitionPromptSyncPolicy(state, prev, next) : state
        }
        const versions = pushVersion(prev.versions, promptContentOf(next))
        const saved: Prompt = { ...next, versions }
        let state: AppState = {
          ...s,
          prompts: s.prompts.map((p) => (p.id === next.id ? saved : p)),
        }
        const wasEffective = promptEffectiveSync(s.repo, prev)
        const nowEffective = promptEffectiveSync(s.repo, saved)
        if (policyChanged && !wasEffective && nowEffective) {
          state = transitionPromptSyncPolicy(state, prev, saved)
          state = withPromptLocalChange(
            state,
            saved,
            saved.inRepo ? 'modified' : 'added',
            saved.inRepo ? 'Rejoined repository sync, pending push' : 'Added to repository sync, pending push',
          )
          return state
        }
        state = withPromptLocalChange(state, saved, 'modified', 'Prompt edited locally, pending push')
        return policyChanged ? transitionPromptSyncPolicy(state, prev, saved) : state
      }),
    deletePrompt: (id) =>
      setState((s) => {
        const prompt = s.prompts.find((p) => p.id === id)
        if (!prompt) return s
        const affected = s.syncChanges.filter((c) => matchesPromptChange(c, prompt) && !c.resolved)
        return {
          ...s,
          prompts: s.prompts.filter((p) => p.id !== id),
          syncChanges: affected.length
            ? s.syncChanges.map((c) => (matchesPromptChange(c, prompt) ? { ...c, resolved: true } : c))
            : s.syncChanges,
          syncEvents: affected.length
            ? [
                syncEvent(
                  'review',
                  `Deleted local Prompt: ${prompt.title}`,
                  'Repository files were not changed; if the remote still has this file, it will reappear as incoming after the next fetch',
                  'warning',
                ),
                ...s.syncEvents,
              ]
            : s.syncEvents,
        }
      }),
    togglePromptFavorite: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)) })),
    togglePromptPin: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, isPinned: !p.isPinned } : p)) })),
    markPromptUsed: (id) =>
      setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, usageCount: p.usageCount + 1 } : p)) })),
    setPromptSyncPolicy: (id, policy) =>
      setState((s) => {
        const prompt = s.prompts.find((p) => p.id === id)
        if (!prompt || prompt.syncPolicy === policy) return s
        const next: Prompt = { ...prompt, syncPolicy: policy }
        const state: AppState = {
          ...s,
          prompts: s.prompts.map((p) => (p.id === id ? next : p)),
        }
        return transitionPromptSyncPolicy(state, prompt, next)
      }),
    restorePromptVersion: (promptId, versionId) =>
      setState((s) => {
        const prompt = s.prompts.find((p) => p.id === promptId)
        if (!prompt) return s
        const target = prompt.versions.find((v) => v.id === versionId)
        if (!target) return s
        const restored: Prompt = {
          ...prompt,
          title: target.data.title ?? prompt.title,
          description: target.data.description ?? prompt.description,
          systemPrompt: target.data.systemPrompt ?? prompt.systemPrompt,
          userPrompt: target.data.userPrompt ?? prompt.userPrompt,
          updatedAt: nowIso(),
          versions: pushVersion(prompt.versions, target.data, `Restored from v${target.version}`),
        }
        const state: AppState = {
          ...s,
          prompts: s.prompts.map((p) => (p.id === promptId ? restored : p)),
        }
        return withPromptLocalChange(state, restored, 'modified', `Restored from v${target.version}, pending push`)
      }),
    deletePromptVersion: (promptId, versionId) =>
      setState((s) => ({
        ...s,
        prompts: s.prompts.map((p) =>
          p.id === promptId ? { ...p, versions: p.versions.filter((v) => v.id !== versionId) } : p,
        ),
      })),

    saveContract: (next) =>
      setState((s) => {
        const prev = s.contracts.find((c) => c.id === next.id)
        if (!prev) {
          const created: AgentContract = {
            ...next,
            versions: next.versions.length ? next.versions : pushVersion([], contractVersionData(next), 'Initial version'),
          }
          const state: AppState = { ...s, contracts: [created, ...s.contracts] }
          return withContractLocalChange(state, created, 'added', 'New local instruction contract, pending push')
        }
        const contentChanged = contractContent(prev) !== contractContent(next)
        const fileChanged = serializeContractFile(prev) !== serializeContractFile(next)
        const policyChanged = prev.syncPolicy !== next.syncPolicy
        if (!contentChanged) {
          let state: AppState = {
            ...s,
            contracts: s.contracts.map((c) => (c.id === next.id ? next : c)),
          }
          if (fileChanged && !policyChanged) {
            state = markContractProjectionsStale(state, next.id)
            state = withContractLocalChange(state, next, 'modified', 'Instruction metadata updated locally, pending push')
          }
          return policyChanged ? transitionContractSyncPolicy(state, prev, next) : state
        }
        const versions = pushVersion(prev.versions, contractVersionData(next))
        const saved: AgentContract = { ...next, versions }
        let state: AppState = {
          ...s,
          contracts: s.contracts.map((c) => (c.id === next.id ? saved : c)),
        }
        state = markContractProjectionsStale(state, saved.id)
        const wasEffective = contractSyncEnabled(s.repo, prev)
        const nowEffective = contractSyncEnabled(s.repo, saved)
        if (policyChanged && !wasEffective && nowEffective) {
          state = transitionContractSyncPolicy(state, prev, saved)
          state = withContractLocalChange(
            state,
            saved,
            saved.inRepo ? 'modified' : 'added',
            saved.inRepo ? 'Rejoined repository sync, pending push' : 'Added to repository sync, pending push',
          )
          return state
        }
        state = withContractLocalChange(state, saved, 'modified', 'Instruction contract edited locally, pending push')
        return policyChanged ? transitionContractSyncPolicy(state, prev, saved) : state
      }),
    deleteContract: (id) =>
      setState((s) => {
        const contract = s.contracts.find((c) => c.id === id)
        if (!contract) return s
        const affected = s.syncChanges.filter((c) => matchesContractChange(c, contract) && !c.resolved)
        return {
          ...s,
          contracts: s.contracts.filter((c) => c.id !== id),
          contractProjections: s.contractProjections.map((p) =>
            p.contractId === id
              ? { ...p, contractTitle: contract.title, contractSlug: contractSlug(contract) }
              : p,
          ),
          globalProjections: s.globalProjections.map((p) =>
            p.contractId === id
              ? { ...p, contractTitle: contract.title, contractSlug: contractSlug(contract) }
              : p,
          ),
          syncChanges: affected.length
            ? s.syncChanges.map((c) => (matchesContractChange(c, contract) ? { ...c, resolved: true } : c))
            : s.syncChanges,
          syncEvents: affected.length
            ? [
                syncEvent(
                  'review',
                  `Deleted local instruction contract: ${contract.title}`,
                  'Repository files were not changed; if the remote still has this file, it will reappear as incoming after the next fetch; already projected target files are not deleted automatically',
                  'warning',
                ),
                ...s.syncEvents,
              ]
            : s.syncEvents,
        }
      }),
    setContractSyncPolicy: (id, policy) =>
      setState((s) => {
        const contract = s.contracts.find((c) => c.id === id)
        if (!contract || contract.syncPolicy === policy) return s
        const next: AgentContract = { ...contract, syncPolicy: policy }
        const state: AppState = {
          ...s,
          contracts: s.contracts.map((c) => (c.id === id ? next : c)),
        }
        return transitionContractSyncPolicy(state, contract, next)
      }),
    restoreContractVersion: (contractId, versionId) =>
      setState((s) => {
        const contract = s.contracts.find((c) => c.id === contractId)
        if (!contract) return s
        const target = contract.versions.find((v) => v.id === versionId)
        if (!target) return s
        let data: Partial<AgentContract> = {}
        try {
          data = JSON.parse(target.data.content ?? '{}') as Partial<AgentContract>
        } catch {
          data = {}
        }
        const restored: AgentContract = {
          ...contract,
          title: data.title ?? contract.title,
          description: data.description ?? contract.description,
          folder: normalizeFolder(data.folder) ?? contract.folder,
          body: data.body ?? contract.body,
          scope: data.scope ?? contract.scope,
          path: data.path || undefined,
          activation: data.activation ?? contract.activation,
          priority: data.priority ?? contract.priority,
          imports: data.imports ?? contract.imports,
          targets: data.targets ?? contract.targets,
          tags: data.tags ?? contract.tags,
          updatedAt: nowIso(),
          versions: pushVersion(
            contract.versions,
            contractVersionData({ ...contract, ...data }),
            `Restored from v${target.version}`,
          ),
        }
        let state: AppState = {
          ...s,
          contracts: s.contracts.map((c) => (c.id === contractId ? restored : c)),
        }
        state = markContractProjectionsStale(state, contractId, `Restored to v${target.version}, pending re-projection`)
        return withContractLocalChange(state, restored, 'modified', `Restored from v${target.version}, pending push`)
      }),
    deleteContractVersion: (contractId, versionId) =>
      setState((s) => ({
        ...s,
        contracts: s.contracts.map((c) =>
          c.id === contractId ? { ...c, versions: c.versions.filter((v) => v.id !== versionId) } : c,
        ),
      })),

    deployContract: (contractId, targetId) =>
      setState((s) => {
        const contract = s.contracts.find((c) => c.id === contractId)
        const target = TARGET_BY_ID[targetId]
        if (!contract || !target || !contract.targets.includes(targetId)) return s
        if (!contractTargetSupports(contract, target)) return s
        const nextIds =
          target.merge === 'single-file'
            ? s.contracts.filter((c) => c.targets.includes(targetId)).map((c) => c.id)
            : [contractId]
        let projections = [...s.contractProjections]
        for (const id of nextIds) {
          const item = s.contracts.find((c) => c.id === id)
          if (!item) continue
          if (!contractTargetSupports(item, target)) continue
          const version = contractVersionLabel(item)
          const existing = projections.find((p) => p.contractId === id && p.targetId === targetId)
          projections = existing
            ? projections.map((p) =>
                p.id === existing.id
                  ? {
                      ...p,
                      status: 'synced',
                      previousVersion: p.deployedVersion,
                      deployedVersion: version,
                      deployedAt: nowIso(),
                      note: undefined,
                    }
                  : p,
              )
            : [
                {
                  id: `proj-${id}-${targetId}`,
                  contractId: id,
                  targetId,
                  status: 'synced' as const,
                  deployedVersion: version,
                  deployedAt: nowIso(),
                },
                ...projections,
              ]
        }
        return {
          ...s,
          contractProjections: projections,
          syncEvents: [
            syncEvent(
              'deploy',
              `Projected instruction ${contract.title} → ${target.label}`,
              `${target.pathTemplate} · ${contractVersionLabel(contract)}${target.merge === 'single-file' ? ' · merged file rewritten' : ''}`,
            ),
            ...s.syncEvents,
          ],
        }
      }),

    syncContractProjection: (id) =>
      setState((s) => {
        const projection = s.contractProjections.find((p) => p.id === id)
        if (!projection) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        if (!contract) return s
        const target = TARGET_BY_ID[projection.targetId]
        if (!target) return s
        if (!contractTargetSupports(contract, target)) return s
        const ids =
          target.merge === 'single-file'
            ? s.contractProjections
                .filter((p) => {
                  if (p.targetId !== projection.targetId) return false
                  const item = s.contracts.find((c) => c.id === p.contractId)
                  return !!item && contractTargetSupports(item, target)
                })
                .map((p) => p.id)
            : [projection.id]
        const wasDrifted = projection.status === 'drifted'
        return {
          ...s,
          contractProjections: s.contractProjections.map((p) =>
            ids.includes(p.id)
              ? {
                  ...p,
                  status: 'synced',
                  previousVersion: p.deployedVersion,
                  deployedVersion: contractVersionLabel(
                    s.contracts.find((c) => c.id === p.contractId) ?? contract,
                  ),
                  deployedAt: nowIso(),
                  note: undefined,
                }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'deploy',
              `Re-projected instruction ${contract.title} → ${target.label}`,
              wasDrifted ? 'Explicitly overwrote manual edits on the Agent side; this operation can be rolled back' : `${target.pathTemplate} updated`,
              wasDrifted ? 'warning' : 'success',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    removeContractProjection: (id) =>
      setState((s) => {
        const projection = s.contractProjections.find((p) => p.id === id)
        if (!projection) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        const target = TARGET_BY_ID[projection.targetId]
        return {
          ...s,
          contractProjections: s.contractProjections.filter((p) => p.id !== id),
          syncEvents: [
            syncEvent(
              'deploy',
              `Removed instruction projection ${contract?.title ?? projection.contractTitle ?? projection.contractId}`,
              target?.merge === 'single-file'
                ? `Removed only from the managed block in ${target.pathTemplate}; the local library and repository are unaffected`
                : `Target ${target?.pathTemplate ?? projection.targetId}; the local library and repository are unaffected`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    rollbackContractProjection: (id) =>
      setState((s) => {
        const projection = s.contractProjections.find((p) => p.id === id)
        if (!projection?.previousVersion) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        const target = TARGET_BY_ID[projection.targetId]
        return {
          ...s,
          contractProjections: s.contractProjections.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'stale',
                  deployedVersion: p.previousVersion!,
                  previousVersion: p.deployedVersion,
                  deployedAt: nowIso(),
                  note: 'Rolled back to the previous version',
                }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'rollback',
              `Rolled back instruction projection ${contract?.title ?? projection.contractTitle ?? projection.contractId} → ${target?.label ?? projection.targetId}`,
              `Restored ${projection.previousVersion}; the local library and repository are unchanged`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    updateGlobalTargetPath: (targetId, path) =>
      setState((s) => {
        const target = s.globalTargets.find((t) => t.id === targetId)
        if (!target || !path.trim() || target.path === path.trim()) return s
        return {
          ...s,
          globalTargets: s.globalTargets.map((t) =>
            t.id === targetId ? { ...t, path: path.trim() } : t,
          ),
          globalProjections: s.globalProjections.map((p) =>
            p.targetId === targetId && p.status !== 'drifted'
              ? { ...p, status: 'stale', note: 'Global directory path changed, pending re-projection' }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'deploy',
              `Updated global directory: ${target.label}`,
              `${target.path} → ${path.trim()} · projected files marked as stale`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    resetGlobalTargetPath: (targetId) =>
      setState((s) => {
        const target = s.globalTargets.find((t) => t.id === targetId)
        if (!target || target.path === target.defaultPath) return s
        return {
          ...s,
          globalTargets: s.globalTargets.map((t) =>
            t.id === targetId ? { ...t, path: t.defaultPath } : t,
          ),
          globalProjections: s.globalProjections.map((p) =>
            p.targetId === targetId && p.status !== 'drifted'
              ? { ...p, status: 'stale', note: 'Global directory restored to the default path, pending re-projection' }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'deploy',
              `Restored default global directory: ${target.label}`,
              target.defaultPath,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    deployGlobal: (contractIds, targetIds) =>
      setState((s) => {
        const contracts = s.contracts.filter((c) => contractIds.includes(c.id))
        const targets = s.globalTargets.filter((t) => targetIds.includes(t.id))
        if (contracts.length === 0 || targets.length === 0) return s
        let projections = [...s.globalProjections]
        let deployed = 0
        let drifted = 0
        let unsupported = 0

        for (const target of targets) {
          // Single-file targets rewrite the whole file, so besides the contracts selected now, existing projections under that target must be included as well
          const targetContracts =
            target.merge === 'single-file'
              ? s.contracts.filter(
                  (contract) =>
                    contracts.some((selected) => selected.id === contract.id) ||
                    s.globalProjections.some(
                      (p) => p.targetId === target.id && p.contractId === contract.id,
                    ),
                )
              : contracts
          const eligible = targetContracts.filter((contract) => {
            const ok = globalTargetSupports(contract, target)
            if (!ok) unsupported++
            return ok
          })
          for (const contract of eligible) {
            const existing = projections.find(
              (p) => p.contractId === contract.id && p.targetId === target.id,
            )
            if (existing?.status === 'drifted') {
              drifted++
              continue
            }
            const version = contractVersionLabel(contract)
            if (existing) {
              projections = projections.map((p) =>
                p.id === existing.id
                  ? {
                      ...p,
                      status: 'synced',
                      previousVersion: p.deployedVersion,
                      deployedVersion: version,
                      deployedAt: nowIso(),
                      note: undefined,
                    }
                  : p,
              )
            } else {
              projections = [
                {
                  id: `gp-${contract.id}-${target.id}`,
                  contractId: contract.id,
                  targetId: target.id,
                  status: 'synced' as const,
                  deployedVersion: version,
                  deployedAt: nowIso(),
                },
                ...projections,
              ]
            }
            deployed++
          }
        }

        return {
          ...s,
          globalProjections: projections,
          syncEvents: [
            syncEvent(
              'deploy',
              `Globally projected ${deployed} combinations`,
              [
                `${contracts.length} instructions × ${targets.length} global directories`,
                drifted ? `${drifted} drifted items not overwritten` : '',
                unsupported ? `${unsupported} combinations skipped due to incompatible activation mode` : '',
              ]
                .filter(Boolean)
                .join(' · '),
              drifted ? 'warning' : 'success',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    syncGlobalProjection: (id) =>
      setState((s) => {
        const projection = s.globalProjections.find((p) => p.id === id)
        if (!projection) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        if (!contract) return s
        const target = s.globalTargets.find((t) => t.id === projection.targetId)
        const wasDrifted = projection.status === 'drifted'
        return {
          ...s,
          globalProjections: s.globalProjections.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'synced',
                  previousVersion: p.deployedVersion,
                  deployedVersion: contractVersionLabel(contract),
                  deployedAt: nowIso(),
                  note: undefined,
                }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'deploy',
              `Re-projected global instruction ${contract.title} → ${target?.label ?? projection.targetId}`,
              wasDrifted
                ? 'Explicitly overwrote manual edits in the Agent global directory; this operation can be rolled back'
                : 'Global directory file updated',
              wasDrifted ? 'warning' : 'success',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    removeGlobalProjection: (id) =>
      setState((s) => {
        const projection = s.globalProjections.find((p) => p.id === id)
        if (!projection) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        const target = s.globalTargets.find((t) => t.id === projection.targetId)
        return {
          ...s,
          globalProjections: s.globalProjections.filter((p) => p.id !== id),
          syncEvents: [
            syncEvent(
              'deploy',
              `Removed global projection ${contract?.title ?? projection.contractTitle ?? projection.contractId}`,
              `${target?.label ?? projection.targetId} · the local library and repository are unaffected`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    rollbackGlobalProjection: (id) =>
      setState((s) => {
        const projection = s.globalProjections.find((p) => p.id === id)
        if (!projection?.previousVersion) return s
        const contract = s.contracts.find((c) => c.id === projection.contractId)
        const target = s.globalTargets.find((t) => t.id === projection.targetId)
        return {
          ...s,
          globalProjections: s.globalProjections.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'stale',
                  deployedVersion: p.previousVersion!,
                  previousVersion: p.deployedVersion,
                  deployedAt: nowIso(),
                  note: 'Rolled back to the previous version',
                }
              : p,
          ),
          syncEvents: [
            syncEvent(
              'rollback',
              `Rolled back global projection ${contract?.title ?? projection.contractTitle ?? projection.contractId} → ${target?.label ?? projection.targetId}`,
              `Restored ${projection.previousVersion}; the local library and repository are unchanged`,
              'warning',
            ),
            ...s.syncEvents,
          ],
        }
      }),

    addSkillFromStore: (skill) =>
      setState((s) =>
        withSkillLocalChange(
          { ...s, skills: [skill, ...s.skills] },
          skill,
          'added',
          'Installed from Skill Store, added to the local library, pending push',
        ),
      ),
    saveSkill: (next) =>
      setState((s) => {
        const prev = s.skills.find((sk) => sk.id === next.id)
        if (!prev) {
          const created: Skill = {
            ...next,
            versions: next.versions.length
              ? next.versions
              : pushVersion([], { instructions: next.instructions }, 'Initial version'),
          }
          return withSkillLocalChange(
            { ...s, skills: [created, ...s.skills] },
            created,
            'added',
            'New local Skill, pending push',
          )
        }
        const contentChanged = prev.instructions !== next.instructions
        const metaChanged =
          prev.name !== next.name ||
          prev.description !== next.description ||
          prev.folder !== next.folder ||
          prev.emoji !== next.emoji ||
          prev.tags.join('|') !== next.tags.join('|')
        const versions = contentChanged
          ? pushVersion(prev.versions, { instructions: next.instructions })
          : prev.versions
        const saved: Skill = { ...next, versions, updatedAt: nowIso() }
        let state: AppState = {
          ...s,
          skills: s.skills.map((sk) => (sk.id === next.id ? saved : sk)),
        }
        if (contentChanged || metaChanged) {
          const moved = prev.folder !== next.folder || prev.name !== next.name
          state = withSkillLocalChange(
            state,
            saved,
            'modified',
            moved
              ? `Moved to "${next.folder || 'Uncategorized'}"; repository path updated, pending push`
              : 'Skill edited locally, pending push',
          )
        }
        return state
      }),
    deleteSkill: (id) =>
      setState((s) => {
        const skill = s.skills.find((sk) => sk.id === id)
        if (!skill) return s
        const affected = s.syncChanges.filter((c) => matchesSkillChange(c, skill) && !c.resolved)
        return {
          ...s,
          skills: s.skills.filter((sk) => sk.id !== id),
          syncChanges: affected.length
            ? s.syncChanges.map((c) =>
                matchesSkillChange(c, skill) ? { ...c, resolved: true } : c,
              )
            : s.syncChanges,
          syncEvents: affected.length
            ? [
                syncEvent(
                  'review',
                  `Deleted local Skill: ${skill.name}`,
                  'Repository files were not changed; if the remote still has this Skill, it will reappear as incoming after the next fetch',
                  'warning',
                ),
                ...s.syncEvents,
              ]
            : s.syncEvents,
        }
      }),
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
            versions: pushVersion(sk.versions, target.data, `Restored from v${target.version}`),
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
          const created: McpServer = {
            ...next,
            versions: next.versions.length ? next.versions : pushVersion([], mcpConfigOf(next)),
          }
          return withMcpLocalChange(
            { ...s, mcps: [created, ...s.mcps] },
            created,
            'added',
            'New local MCP template, pending push',
          )
        }
        const changed = mcpConfig(prev) !== mcpConfig(next)
        const metaChanged =
          prev.name !== next.name ||
          prev.description !== next.description ||
          prev.folder !== next.folder ||
          prev.tags.join('|') !== next.tags.join('|')
        if (!changed && !metaChanged) {
          return { ...s, mcps: s.mcps.map((m) => (m.id === next.id ? next : m)) }
        }
        const versions = changed ? pushVersion(prev.versions, mcpConfigOf(next)) : prev.versions
        const saved: McpServer = { ...next, versions }
        let state: AppState = {
          ...s,
          mcps: s.mcps.map((m) => (m.id === next.id ? saved : m)),
        }
        state = withMcpLocalChange(
          state,
          saved,
          'modified',
          prev.folder !== next.folder || prev.name !== next.name
            ? `Moved to "${next.folder || 'Uncategorized'}"; repository path updated, pending push`
            : 'MCP template edited locally, pending push',
        )
        return state
      }),
    deleteMcp: (id) =>
      setState((s) => {
        const mcp = s.mcps.find((m) => m.id === id)
        if (!mcp) return s
        const affected = s.syncChanges.filter((c) => matchesMcpChange(c, mcp) && !c.resolved)
        return {
          ...s,
          mcps: s.mcps.filter((m) => m.id !== id),
          syncChanges: affected.length
            ? s.syncChanges.map((c) => (matchesMcpChange(c, mcp) ? { ...c, resolved: true } : c))
            : s.syncChanges,
          syncEvents: affected.length
            ? [
                syncEvent(
                  'review',
                  `Deleted local MCP: ${mcp.name}`,
                  'Repository files were not changed; if the remote still has this template, it will reappear as incoming after the next fetch',
                  'warning',
                ),
                ...s.syncEvents,
              ]
            : s.syncEvents,
        }
      }),
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
            versions: pushVersion(m.versions, target.data, `Restored from v${target.version}`),
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
    importAgentMcp: (server) =>
      setState((s) =>
        withMcpLocalChange(
          { ...s, mcps: [server, ...s.mcps] },
          server,
          'added',
          'Imported from the Agent configuration, added to the local library, pending push',
        ),
      ),

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
              same ? `Repository settings updated ${config.url}` : `Connected repository ${config.url}`,
              `${config.branch} · ${config.auth === 'credential' ? 'system Git credentials' : config.auth === 'ssh' ? 'SSH Key' : 'access token'} · directory mapping confirmed`,
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
        syncEvents: [syncEvent('connect', 'Disconnected repository', 'The local asset library and dispatch state are unchanged', 'warning'), ...s.syncEvents],
      })),
    fetchRepo: () =>
      setState((s) => ({
        ...s,
        repo: { ...s.repo, lastFetchedAt: nowIso() },
        syncEvents: [
          syncEvent(
            'fetch',
            'Fetch complete · not merged automatically',
            s.repo.behind > 0 ? `${s.repo.url} · ${s.repo.ahead} ahead / ${s.repo.behind} behind, awaiting confirmation` : `${s.repo.url} · already up to date`,
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
        let prompts = s.prompts
        let contracts = s.contracts
        const pulledContractIds: string[] = []
        for (const ch of targets) {
          if (ch.kind === 'skill') {
            const existing = skills.find((sk) => sk.name === ch.assetName)
            const content = ch.remoteContent
            const folder = folderFromRepoPath(ch.path, s.repo.layout.skills, 2)
            if (existing) {
              const nextContent = content ?? existing.instructions
              const nextVersion = (ch.remoteVersion ?? `v${existing.version}`).replace(/^v/, '')
              skills = skills.map((sk) =>
                sk.id === existing.id
                  ? {
                      ...sk,
                      version: nextVersion,
                      instructions: nextContent,
                      folder,
                      updatedAt: nowIso(),
                      versions: pushVersion(sk.versions, { instructions: nextContent }, `Repository update ${ch.remoteVersion ?? ''}`.trim()),
                    }
                  : sk,
              )
            } else {
              const nextContent =
                content ?? `# ${ch.assetName}\n\n${ch.summary}\n\n> From repository ${ch.path}\n`
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
                  category: folder ?? 'Repository Sync',
                  folder,
                  tags: ['Repository'],
                  instructions: nextContent,
                  installs: {},
                  versions: [
                    {
                      id: uid(),
                      version: 1,
                      note: `From repository ${ch.versionLabel ?? ''}`.trim(),
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
          if (ch.kind === 'prompt') {
            const parsed = ch.remoteContent ? parsePromptFile(ch.remoteContent) : null
            if (parsed) {
              const existing = prompts.find(
                (p) => (parsed.id ? p.id === parsed.id : false) || p.title === parsed.title,
              )
              const data = {
                title: parsed.title,
                description: parsed.description,
                systemPrompt: parsed.systemPrompt,
                userPrompt: parsed.userPrompt,
              }
              if (existing) {
                const updated: Prompt = {
                  ...existing,
                  ...data,
                  folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.prompts, 1),
                  tags: parsed.tags,
                  variables: parsed.variables,
                  inRepo: true,
                  updatedAt: nowIso(),
                  versions: pushVersion(
                    existing.versions,
                    data,
                    `Repository update ${ch.remoteVersion ?? ''}`.trim(),
                  ),
                }
                prompts = prompts.map((p) => (p.id === existing.id ? updated : p))
              } else {
                const created: Prompt = {
                  id: parsed.id ?? uid(),
                  ...data,
                  folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.prompts, 1),
                  tags: parsed.tags,
                  variables: parsed.variables,
                  syncPolicy: 'inherit',
                  inRepo: true,
                  isFavorite: false,
                  isPinned: false,
                  usageCount: 0,
                  versions: pushVersion([], data, `From repository ${ch.versionLabel ?? ''}`.trim()),
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                }
                prompts = [created, ...prompts]
              }
            }
          }
          if (ch.kind === 'contract') {
            const parsed = ch.remoteContent ? parseContractFile(ch.remoteContent) : null
            if (parsed) {
              const existing = contracts.find(
                (c) => (parsed.id ? c.id === parsed.id : false) || c.title === parsed.title,
              )
              const data = {
                title: parsed.title,
                description: parsed.description,
                folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.contracts, 1),
                body: parsed.body,
                scope: parsed.scope,
                path: parsed.path,
                activation: parsed.activation,
                priority: parsed.priority,
                imports: parsed.imports,
                targets: parsed.targets.length ? parsed.targets : ['agents-md'],
                tags: parsed.tags,
              }
              if (existing) {
                const updated: AgentContract = {
                  ...existing,
                  ...data,
                  inRepo: true,
                  updatedAt: nowIso(),
                  versions: pushVersion(
                    existing.versions,
                    contractVersionData({ ...existing, ...data } as AgentContract),
                    `Repository update ${ch.remoteVersion ?? ''}`.trim(),
                  ),
                }
                contracts = contracts.map((c) => (c.id === existing.id ? updated : c))
                pulledContractIds.push(existing.id)
              } else {
                const created: AgentContract = {
                  id: parsed.id ?? uid(),
                  ...data,
                  syncPolicy: 'inherit',
                  inRepo: true,
                  versions: pushVersion(
                    [],
                    contractVersionData({ id: '', ...data } as AgentContract),
                    `From repository ${ch.versionLabel ?? ''}`.trim(),
                  ),
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                }
                contracts = [created, ...contracts]
                pulledContractIds.push(created.id)
              }
            }
          }
          if (ch.kind === 'mcp') {
            const parsed = ch.remoteContent ? parseMcpRepoFile(ch.remoteContent) : null
            const folder = folderFromRepoPath(ch.path, s.repo.layout.mcp, 1)
            const existing = mcps.find((m) => m.name === ch.assetName)
            if (existing) {
              // Remote templates carry only ${VAR} placeholders; real local credentials are kept, and non-secret fields take the new remote values
              const mergedEnv: Record<string, string> = { ...(parsed?.env ?? {}) }
              for (const [key, value] of Object.entries(existing.env ?? {})) {
                if ((isSecretKey(key) && value.trim()) || mergedEnv[key] === undefined) {
                  mergedEnv[key] = value
                }
              }
              const mergedHeaders: Record<string, string> = { ...(parsed?.headers ?? {}) }
              for (const [key, value] of Object.entries(existing.headers ?? {})) {
                const secret = isSecretKey(key) || key.toLowerCase() === 'authorization'
                if ((secret && value.trim()) || mergedHeaders[key] === undefined) {
                  mergedHeaders[key] = value
                }
              }
              const next: McpServer = {
                ...existing,
                ...(parsed ?? {}),
                env: mergedEnv,
                headers: mergedHeaders,
                folder,
                updatedAt: nowIso(),
              }
              mcps = mcps.map((m) =>
                m.id === existing.id
                  ? { ...next, versions: pushVersion(m.versions, mcpConfigOf(next), 'Repository template update') }
                  : m,
              )
            } else if (parsed) {
              const created: McpServer = {
                id: uid(),
                name: parsed.name ?? ch.assetName,
                description: parsed.description ?? ch.summary,
                transport: parsed.transport ?? 'stdio',
                command: parsed.command,
                args: parsed.args ?? [],
                env: parsed.env ?? {},
                requiredEnv: parsed.requiredEnv ?? [],
                url: parsed.url,
                headers: parsed.headers ?? {},
                enabled: true,
                isFavorite: false,
                folder,
                tags: ['Repository'],
                source: 'import',
                installs: {},
                notes: '',
                versions: pushVersion([], mcpConfigOf({
                  ...(parsed as McpServer),
                  id: '',
                  name: parsed.name ?? ch.assetName,
                  versions: [],
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                } as McpServer), `From repository ${ch.versionLabel ?? ''}`.trim()),
                createdAt: nowIso(),
                updatedAt: nowIso(),
              }
              mcps = [created, ...mcps]
            }
          }
        }
        return {
          ...s,
          skills,
          mcps,
          prompts,
          contracts,
          contractProjections: s.contractProjections.map((p) =>
            pulledContractIds.includes(p.contractId)
              ? p.status === 'drifted'
                ? p
                : { ...p, status: 'stale', note: 'Repository update merged in, pending re-projection' }
              : p,
          ),
          repo: {
            ...s.repo,
            behind: Math.max(0, s.repo.behind - targets.length),
            lastSyncedAt: nowIso(),
          },
          syncChanges: s.syncChanges.map((c) => (targets.some((t) => t.id === c.id) ? { ...c, resolved: true } : c)),
          syncEvents: [
            syncEvent(
              'pull',
              `Pulled ${targets.length} changes into the local library`,
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
          ? `Branch prompt-keeper/sync-${hash.slice(0, 4)} · PR created (${message})`
          : `Pushed directly to ${s.repo.branch} · commit ${hash} (${message})`
        let prompts = s.prompts
        let contracts = s.contracts
        for (const target of targets.filter((t) => t.kind === 'prompt')) {
          prompts = prompts.map((p) => (matchesPromptChange(target, p) ? { ...p, inRepo: true } : p))
        }
        for (const target of targets.filter((t) => t.kind === 'contract')) {
          contracts = contracts.map((c) => (matchesContractChange(target, c) ? { ...c, inRepo: true } : c))
        }
        return {
          ...s,
          prompts,
          contracts,
          repo: { ...s.repo, ahead: Math.max(0, s.repo.ahead - targets.length), lastSyncedAt: nowIso() },
          syncChanges: s.syncChanges.map((c) => (targets.some((t) => t.id === c.id) ? { ...c, resolved: true } : c)),
          syncEvents: [
            syncEvent('push', `Pushed ${targets.length} changes · commit ${hash}`, detail),
            ...s.syncEvents,
          ],
        }
      }),

    resolveConflict: (id, strategy, merged) =>
      setState((s) => {
        const ch = s.syncChanges.find((c) => c.id === id)
        if (!ch) return s
        let skills = s.skills
        let prompts = s.prompts
        let contracts = s.contracts
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
                folder: folderFromRepoPath(ch.path, s.repo.layout.skills, 2),
                updatedAt: nowIso(),
                versions: pushVersion(sk.versions, { instructions: content }, `Resolved sync conflict (${strategy === 'remote' ? 'took repository version' : 'manual merge'})`),
              }
            })
          }
        }
        if (ch.kind === 'prompt') {
          const content = strategy === 'remote' ? ch.remoteContent : strategy === 'manual' ? merged : undefined
          const parsed = content ? parsePromptFile(content) : null
          if (parsed) {
            const existing = prompts.find(
              (p) => (ch.assetId ? p.id === ch.assetId : false) || p.title === ch.assetName || p.title === parsed.title,
            )
            const data = {
              title: parsed.title,
              description: parsed.description,
              systemPrompt: parsed.systemPrompt,
              userPrompt: parsed.userPrompt,
            }
            if (existing) {
              const updated: Prompt = {
                ...existing,
                ...data,
                folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.prompts, 1),
                tags: parsed.tags,
                variables: parsed.variables,
                inRepo: true,
                updatedAt: nowIso(),
                versions: pushVersion(
                  existing.versions,
                  data,
                  `Resolved sync conflict (${strategy === 'remote' ? 'took repository version' : 'manual merge'})`,
                ),
              }
              prompts = prompts.map((p) => (p.id === existing.id ? updated : p))
            } else {
              const created: Prompt = {
                id: parsed.id ?? uid(),
                ...data,
                folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.prompts, 1),
                tags: parsed.tags,
                variables: parsed.variables,
                syncPolicy: 'inherit',
                inRepo: true,
                isFavorite: false,
                isPinned: false,
                usageCount: 0,
                versions: pushVersion([], data, `Resolved sync conflict (${strategy === 'remote' ? 'took repository version' : 'manual merge'})`),
                createdAt: nowIso(),
                updatedAt: nowIso(),
              }
              prompts = [created, ...prompts]
            }
          }
        }

        if (ch.kind === 'contract') {
          const content = strategy === 'remote' ? ch.remoteContent : strategy === 'manual' ? merged : undefined
          const parsed = content ? parseContractFile(content) : null
          if (parsed) {
            const existing = contracts.find(
              (c) =>
                (ch.assetId ? c.id === ch.assetId : false) ||
                c.title === ch.assetName ||
                c.title === parsed.title,
            )
            const data = {
              title: parsed.title,
              description: parsed.description,
              folder: parsed.folder ?? folderFromRepoPath(ch.path, s.repo.layout.contracts, 1),
              body: parsed.body,
              scope: parsed.scope,
              path: parsed.path,
              activation: parsed.activation,
              priority: parsed.priority,
              imports: parsed.imports,
              targets: parsed.targets.length ? parsed.targets : ['agents-md'],
              tags: parsed.tags,
            }
            if (existing) {
              const updated: AgentContract = {
                ...existing,
                ...data,
                inRepo: true,
                updatedAt: nowIso(),
                versions: pushVersion(
                  existing.versions,
                  contractVersionData({ ...existing, ...data } as AgentContract),
                  `Resolved sync conflict (${strategy === 'remote' ? 'took repository version' : 'manual merge'})`,
                ),
              }
              contracts = contracts.map((c) => (c.id === existing.id ? updated : c))
            } else {
              const created: AgentContract = {
                id: parsed.id ?? uid(),
                ...data,
                syncPolicy: 'inherit',
                inRepo: true,
                versions: pushVersion(
                  [],
                  contractVersionData({ id: '', ...data } as AgentContract),
                  `Resolved sync conflict (${strategy === 'remote' ? 'took repository version' : 'manual merge'})`,
                ),
                createdAt: nowIso(),
                updatedAt: nowIso(),
              }
              contracts = [created, ...contracts]
            }
          }
        }

        const targetPrompt =
          ch.kind === 'prompt'
            ? prompts.find((p) => (ch.assetId ? p.id === ch.assetId : false) || p.title === ch.assetName)
            : undefined
        const targetContract =
          ch.kind === 'contract'
            ? contracts.find(
                (c) =>
                  (ch.assetId ? c.id === ch.assetId : false) ||
                  c.title === ch.assetName,
              )
            : undefined
        const followUpContent =
          ch.kind === 'prompt'
            ? strategy === 'manual'
              ? merged
              : targetPrompt
                ? serializePromptFile(targetPrompt)
                : ch.localContent
            : ch.kind === 'contract'
              ? strategy === 'manual'
                ? merged
                : targetContract
                  ? serializeContractFile(targetContract)
                  : ch.localContent
              : undefined
        const followUpRisk: SyncChange['risk'] =
          followUpContent && containsLikelySecret(followUpContent) ? 'secrets' : 'none'
        const followUp: SyncChange | null =
          strategy !== 'remote'
            ? {
                id: uid(),
                kind: ch.kind,
                assetId: ch.assetId,
                assetName: ch.assetName,
                path: ch.path,
                change: 'modified',
                direction: 'outgoing',
                summary:
                  strategy === 'manual'
                    ? 'Manual conflict merge result pending push'
                    : 'Conflict resolved with the local version; merge result pending push',
                additions: 0,
                deletions: 0,
                risk: followUpRisk,
                blocked: followUpRisk === 'secrets',
                localContent: followUpContent,
                localVersion: ch.localVersion,
                baseVersion: ch.remoteVersion,
              }
            : null
        return {
          ...s,
          skills,
          prompts,
          contracts,
          contractProjections:
            ch.kind === 'contract' && strategy !== 'local' && targetContract
              ? s.contractProjections.map((p) =>
                  p.contractId === targetContract.id
                    ? p.status === 'drifted'
                      ? p
                      : { ...p, status: 'stale', note: 'Conflict resolution written to the local library, pending re-projection' }
                    : p,
                )
              : s.contractProjections,
          repo: {
            ...s.repo,
            ahead: strategy === 'remote' ? Math.max(0, s.repo.ahead - 1) : s.repo.ahead,
            behind: Math.max(0, s.repo.behind - 1),
            lastSyncedAt: nowIso(),
          },
          syncChanges: [
            ...(followUp ? [followUp] : []),
            ...s.syncChanges.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
          ],
          syncEvents: [
            syncEvent(
              'conflict',
              `Resolved conflict: ${ch.kind}:${ch.assetName}`,
              strategy === 'remote' ? 'Took the repository version' : strategy === 'local' ? 'Kept the local version' : 'Manually merged and written to the local library',
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
        let prompts = s.prompts
        let contracts = s.contracts
        let mcps = s.mcps
        let maskedPrompt: Prompt | null = null
        let maskedContract: AgentContract | null = null
        let maskedMcp: McpServer | null = null
        let summary = 'Replaced the plaintext secret with the ${AMAP_API_KEY} placeholder; the real value lives only in the local keychain'
        if (ch.kind === 'prompt') {
          summary = 'Replaced suspected credentials in the Prompt content with the {{api_key}} template variable; the real value was never written to disk'
          const target = s.prompts.find(
            (p) => (ch.assetId ? p.id === ch.assetId : false) || p.title === ch.assetName,
          )
          if (target) {
            const systemPrompt = maskSecretsInPrompt(target.systemPrompt)
            const userPrompt = maskSecretsInPrompt(target.userPrompt)
            const variables = mergeVariableDefs([systemPrompt, userPrompt], target.variables)
            const data = {
              title: target.title,
              description: target.description,
              systemPrompt,
              userPrompt,
            }
            maskedPrompt = {
              ...target,
              systemPrompt,
              userPrompt,
              variables,
              updatedAt: nowIso(),
              versions: pushVersion(target.versions, data, 'Removed suspected plaintext credentials'),
            }
            prompts = s.prompts.map((p) => (p.id === target.id ? maskedPrompt! : p))
          }
        }
        if (ch.kind === 'mcp') {
          summary = 'Credentials in the repository template were changed to ${VAR} placeholders; real values remain only in the local keychain'
          const target = s.mcps.find(
            (m) => (ch.assetId ? m.id === ch.assetId : false) || m.name === ch.assetName,
          )
          if (target) {
            maskedMcp = { ...target, updatedAt: nowIso() }
            mcps = s.mcps.map((m) => (m.id === target.id ? maskedMcp! : m))
          }
        }
        if (ch.kind === 'contract') {
          summary = 'Replaced suspected credentials in the instruction content with the {{api_key}} template variable; the real value was never written to disk'
          const target = s.contracts.find(
            (c) => (ch.assetId ? c.id === ch.assetId : false) || c.title === ch.assetName,
          )
          if (target) {
            const body = maskSecretsInPrompt(target.body)
            maskedContract = {
              ...target,
              body,
              updatedAt: nowIso(),
              versions: pushVersion(
                target.versions,
                contractVersionData({ ...target, body }),
                'Removed suspected plaintext credentials',
              ),
            }
            contracts = s.contracts.map((c) => (c.id === target.id ? maskedContract! : c))
          }
        }
        return {
          ...s,
          prompts,
          contracts,
          mcps,
          syncChanges: s.syncChanges.map((c) =>
            c.id === id
              ? {
                  ...c,
                  blocked: false,
                  risk: 'none',
                  summary,
                  localContent: maskedPrompt
                    ? serializePromptFile(maskedPrompt)
                    : maskedContract
                      ? serializeContractFile(maskedContract)
                      : maskedMcp
                        ? serializeMcpRepoFile(maskedMcp)
                        : c.localContent,
                }
              : c,
          ),
          syncEvents: [
            syncEvent(
              'blocked',
              `Push block cleared: ${ch.kind}:${ch.assetName}`,
              ch.kind === 'prompt' || ch.kind === 'contract'
                ? 'Credentials in the content were replaced with the {{api_key}} variable; fill in values when copying or dispatching'
                : 'Plaintext secrets were converted to ${VAR} placeholders; local values never enter the repository',
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
            syncEvent('deploy', `Dispatched ${kind}:${asset.name} → ${agentId}`, `${mode} · ${version}`),
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
            syncEvent('deploy', `Dispatched ${target.kind}:${target.assetName} → ${target.agentId}`, `${target.mode} · ${version}`),
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
            syncEvent('deploy', `Bulk dispatched ${targets.length} stale assets`, 'Only stale items are synced; drifted items (edited inside the Agent) are not overwritten automatically'),
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
            ? [syncEvent('deploy', `Removed dispatch ${target.kind}:${target.assetName}`, `Target ${target.agentId}; the local library and repository are unaffected`, 'warning'), ...s.syncEvents]
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
              ? { ...d, status: 'stale', deployedVersion: d.previousVersion!, previousVersion: d.deployedVersion, deployedAt: nowIso(), note: 'Rolled back to the previous version' }
              : d,
          ),
          syncEvents: [
            syncEvent(
              'rollback',
              `Rolled back dispatch ${target.kind}:${target.assetName} → ${target.agentId}`,
              `Restored ${target.previousVersion}; the local library and repository are unchanged`,
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
          syncEvent('deploy', `Re-detected local Agents · found ${next.length}`, 'Scanned each tool\'s default directories and configuration files; tools that are not installed are not written'),
          ...s.syncEvents,
        ],
      }))
      return next
    },
  }

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

// Content snapshot helpers (avoid writing version arrays into data)
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
  if (!ctx) throw new Error('useStore must be used within a StoreProvider')
  return ctx
}
