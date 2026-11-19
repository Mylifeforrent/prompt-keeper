import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, screen, session, shell } from 'electron'
import { BlobStore } from './adapters/blobStore'
import { ElectronSecretStore } from './adapters/secrets'
import { currentSchemaVersion, openDatabase } from './db/database'
import { EventBus } from './events'
import { registerIpc } from './ipc/register'
import { Logger } from './logger'
import type { AppContext } from './context'
import { resolveAppPaths } from './paths'
import { OperationManager } from './operations'
import { createServices } from './services'
import { AssetStore } from './services/assetStore'
import { AuditService } from './services/auditService'

const APP_NAME = 'Prompt Keeper'
const BUILD_ID = process.env.PK_BUILD_ID ?? 'dev'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

let mainWindow: BrowserWindow | null = null
let db: ReturnType<typeof openDatabase> | null = null

app.setName(APP_NAME)
app.enableSandbox()

// Tests and portable launches can isolate the whole data directory.
if (process.env.PK_USER_DATA) {
  app.setPath('userData', process.env.PK_USER_DATA)
}


const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void app.whenReady().then(start)
}

function windowStateFile(userData: string): string {
  return join(userData, 'window-state.json')
}

function readWindowState(userData: string): WindowState {
  try {
    const parsed = JSON.parse(readFileSync(windowStateFile(userData), 'utf8')) as WindowState
    if (parsed.width >= 1024 && parsed.height >= 700) return parsed
  } catch {
    // Fall through to defaults.
  }
  return { width: 1360, height: 860, maximized: false }
}

function boundsVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      state.x! + state.width > area.x &&
      state.y! + state.height > area.y &&
      state.x! < area.x + area.width &&
      state.y! < area.y + area.height
    )
  })
}

function saveWindowState(window: BrowserWindow, userData: string): void {
  if (window.isDestroyed()) return
  const state: WindowState = {
    width: window.getBounds().width,
    height: window.getBounds().height,
    x: window.getBounds().x,
    y: window.getBounds().y,
    maximized: window.isMaximized(),
  }
  try {
    mkdirSync(userData, { recursive: true })
    writeFileSync(windowStateFile(userData), JSON.stringify(state), 'utf8')
  } catch {
    // Window state is best effort.
  }
}

async function start(): Promise<void> {
  const paths = resolveAppPaths(app.getPath('userData'))
  const logger = new Logger(paths.logs)
  const windowState = readWindowState(paths.userData)

  const database = openDatabase(paths)
  db = database
  const blobs = new BlobStore(paths.blobs)
  const events = new EventBus()
  const operations = new OperationManager(database, events)
  const secrets = new ElectronSecretStore(database)
  const assets = new AssetStore(database, blobs, paths)
  const audit = new AuditService(database)

  const platform = process.platform === 'win32' ? 'win32' : 'darwin'

  const ctx: AppContext = {
    db: database,
    paths,
    blobs,
    assets,
    secrets,
    events,
    operations,
    audit,
    logger,
    platform,
    appVersion: app.getVersion(),
    buildId: BUILD_ID,
    safeStorageAvailable: secrets.available(),
    ...(secrets.reason() ? { safeStorageReason: secrets.reason() } : {}),
  }

  reconcileStartup(ctx)
  const services = createServices(ctx)

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && boundsVisible(windowState) ? { x: windowState.x, y: windowState.y } : {}),
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  if (windowState.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const windowContents = mainWindow.webContents
  events.attach((channel, payload) => {
    if (!windowContents.isDestroyed()) windowContents.send(channel, payload)
  })

  const trustedWebContentsId = windowContents.id
  registerIpc({
    context: ctx,
    services,
    isTrustedSender: (event) => event.sender.id === trustedWebContentsId,
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const allowedOrigin = devUrl ? new URL(devUrl).origin : 'file://'

  windowContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) event.preventDefault()
  })
  windowContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = devUrl
      ? `default-src 'self' ${allowedOrigin}; script-src 'self' 'unsafe-inline' ${allowedOrigin}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${allowedOrigin} ws://localhost:* ws://127.0.0.1:*; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  mainWindow.on('close', () => {
    if (mainWindow) saveWindowState(mainWindow, paths.userData)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (devUrl) await mainWindow.loadURL(devUrl)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  logger.info('bootstrap', 'Application started', {
    version: app.getVersion(),
    schemaVersion: currentSchemaVersion(database),
    platform,
  })
}

function reconcileStartup(ctx: AppContext): void {
  const at = new Date().toISOString()
  const interrupted = ctx.db
    .prepare("SELECT id FROM operations WHERE state IN ('started', 'writing')")
    .all() as Array<{ id: string }>
  for (const row of interrupted) {
    ctx.db
      .prepare("UPDATE operations SET state = 'failed', finished_at = ?, detail_json = ? WHERE id = ?")
      .run(at, JSON.stringify({ error: { code: 'INTERNAL', message: 'Interrupted by an application restart.' } }), row.id)
  }
  if (interrupted.length) {
    ctx.logger.warn('bootstrap', 'Marked interrupted operations as failed', { count: interrupted.length })
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    db?.close()
  } catch {
    // Already closed.
  }
  db = null
})
