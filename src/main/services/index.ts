import type { AppContext } from '../context'
import type { Services } from './types'
import { createPromptService } from './prompts'
import { createContractService } from './instructionContracts'
import { createSkillService } from './skills'
import { createMcpService } from './mcp'
import { createProjectionService } from './projections'
import { createSyncService } from './sync'
import { createDispatchService } from './dispatch'
import { createSearchService } from './search'
import { createSettingsService } from './settings'
import { createAiService } from './ai'
import { createUpdateService } from './updates'
import { createAppService } from './app'

export function createServices(ctx: AppContext): Services {
  return {
    app: createAppService(ctx),
    prompts: createPromptService(ctx),
    contracts: createContractService(ctx),
    skills: createSkillService(ctx),
    mcp: createMcpService(ctx),
    projections: createProjectionService(ctx),
    sync: createSyncService(ctx),
    dispatch: createDispatchService(ctx),
    search: createSearchService(ctx),
    settings: createSettingsService(ctx),
    ai: createAiService(ctx),
    updates: createUpdateService(ctx),
  }
}

export type { Services } from './types'
