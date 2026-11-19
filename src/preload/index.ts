import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '../shared/channels'
import type { PromptKeeperBridge } from '../shared/bridge'

type Listener = (payload: unknown) => void

function subscribe(channel: string, listener: Listener): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

function buildBridge(): PromptKeeperBridge {
  const bridge: Record<string, unknown> = {}
  for (const [group, methods] of Object.entries(CHANNELS)) {
    const namespace: Record<string, (payload?: unknown) => Promise<unknown>> = {}
    for (const [method, channel] of Object.entries(methods)) {
      namespace[method] = (payload?: unknown) => ipcRenderer.invoke(channel, payload)
    }
    bridge[group] = namespace
  }
  bridge.events = {
    onDomainChanged: (listener: Listener) => subscribe(EVENT_CHANNELS.domainChanged, listener),
    onOperationProgress: (listener: Listener) => subscribe(EVENT_CHANNELS.operationProgress, listener),
    onOperationCompleted: (listener: Listener) => subscribe(EVENT_CHANNELS.operationCompleted, listener),
    onSyncProgress: (listener: Listener) => subscribe(EVENT_CHANNELS.syncProgress, listener),
    onUpdateAvailable: (listener: Listener) => subscribe(EVENT_CHANNELS.updateAvailable, listener),
    onAiStream: (listener: Listener) => subscribe(EVENT_CHANNELS.aiStream, listener),
  }
  return bridge as unknown as PromptKeeperBridge
}

contextBridge.exposeInMainWorld('promptKeeper', buildBridge())
