#!/usr/bin/env node
/**
 * Runs Vitest inside Electron's Node runtime so native modules such as
 * better-sqlite3 are loaded with the ABI they were rebuilt for.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
let electron
try {
  electron = require('electron')
} catch (error) {
  console.error('Electron is not installed. Run: npm install && npx electron-rebuild -f -w better-sqlite3')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const args = process.argv.slice(2)
const mode = args.includes('--watch') ? [] : ['run']
const result = spawnSync(electron, [vitest, ...mode, ...args], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})

process.exit(result.status ?? 1)
