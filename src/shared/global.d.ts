import type { PromptKeeperBridge } from './bridge'

declare global {
  interface Window {
    promptKeeper: PromptKeeperBridge
  }
}

export {}
