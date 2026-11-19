import type {
  OperationRef,
  UpdateInstallInput,
  UpdateStatus,
} from '../../shared/contracts'
import { AppError, validationError } from '../../shared/domain/errors'
import { nowIso } from '../../shared/domain/ids'
import { setting, setSetting, type AppContext } from '../context'
import type { UpdateService } from './types'

/**
 * Auto-update is not wired in this build: electron-updater is intentionally not
 * a dependency yet. The service still reports channel/version/last check so the
 * Settings surface and the contract stay functional, and download/install fail
 * with an explicit UNSUPPORTED operation instead of pretending to update.
 */
export const UPDATES_SUPPORTED = false

export const UPDATES_UNSUPPORTED_REASON =
  'Automatic updates are not configured in this build. Install a signed build with an update feed to enable them.'

const CHANNEL_SETTING_KEY = 'updates.channel'
const AUTO_CHECK_SETTING_KEY = 'updates.autoCheck'
const LAST_CHECKED_SETTING_KEY = 'updates.lastCheckedAt'

type UpdateChannel = UpdateStatus['channel']

function readChannel(ctx: AppContext): UpdateChannel {
  const stored = setting<unknown>(ctx, CHANNEL_SETTING_KEY, 'stable')
  return stored === 'beta' ? 'beta' : 'stable'
}

function readAutoCheck(ctx: AppContext): boolean {
  const stored = setting<unknown>(ctx, AUTO_CHECK_SETTING_KEY, true)
  return typeof stored === 'boolean' ? stored : true
}

function readLastCheckedAt(ctx: AppContext): string | undefined {
  const stored = setting<unknown>(ctx, LAST_CHECKED_SETTING_KEY, undefined)
  return typeof stored === 'string' && stored ? stored : undefined
}

function unsupportedUpdate(feature: 'updateDownload' | 'updateInstall'): AppError {
  return new AppError('UNSUPPORTED', UPDATES_UNSUPPORTED_REASON, {
    kind: 'unsupported',
    feature,
    reason: 'electron-updater is not installed in this build.',
  })
}

export function createUpdateService(ctx: AppContext): UpdateService {
  const status = (): UpdateStatus => {
    const lastCheckedAt = readLastCheckedAt(ctx)
    return {
      channel: readChannel(ctx),
      currentVersion: ctx.appVersion,
      download: { state: 'idle', progress: 0 },
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
    }
  }

  return {
    async status(): Promise<UpdateStatus> {
      return status()
    },

    async check(): Promise<UpdateStatus> {
      // Development builds never report an update; packaged builds without an
      // update feed behave the same until electron-updater is wired in.
      const at = nowIso()
      setSetting(ctx, LAST_CHECKED_SETTING_KEY, at)
      ctx.events.domainChanged('settings', 'updated', [])
      return { ...status(), lastCheckedAt: at }
    },

    async download(): Promise<OperationRef> {
      return ctx.operations.start('update_download', async () => {
        // Yield once so the renderer receives the operation reference before
        // the failure event; there is no payload to download in this build.
        await new Promise((resolve) => setTimeout(resolve, 0))
        throw unsupportedUpdate('updateDownload')
      })
    },

    async install(input: UpdateInstallInput): Promise<OperationRef> {
      if (typeof input?.version !== 'string' || !input.version.trim()) {
        throw validationError('Choose an update version to install.', [
          { path: 'version', message: 'The version is required.' },
        ])
      }
      if (input?.confirm !== true) {
        throw validationError('Installing an update requires confirmation.', [
          { path: 'confirm', message: 'Set confirm to true to install the update.' },
        ])
      }
      if (ctx.operations.isActive()) {
        throw new AppError(
          'LOCKED',
          'Another operation is running. Wait for it to finish before installing an update.',
          { kind: 'lock' },
        )
      }
      return ctx.operations.start('update_install', async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        throw unsupportedUpdate('updateInstall')
      })
    },
  }
}

export function readUpdatePreferences(ctx: AppContext): {
  channel: UpdateChannel
  autoCheck: boolean
  lastCheckedAt?: string
} {
  const lastCheckedAt = readLastCheckedAt(ctx)
  return {
    channel: readChannel(ctx),
    autoCheck: readAutoCheck(ctx),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
  }
}
