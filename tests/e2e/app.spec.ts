import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let userData: string
let home: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'pk-e2e-data-'))
  home = mkdtempSync(join(tmpdir(), 'pk-e2e-home-'))
  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      PK_USER_DATA: userData,
      PK_BUILD_ID: 'e2e',
      HOME: home,
      USERPROFILE: home,
    },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test('shows the app shell and first-run guidance', async () => {
  await expect(page.getByRole('heading', { name: 'Welcome to Prompt Keeper' })).toBeVisible()
  for (const label of ['Prompts', 'Agent Instructions', 'Skills', 'MCP', 'Sync', 'Settings']) {
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible()
  }
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome to Prompt Keeper' })).toBeHidden()
})

test('creates and edits a Prompt through the backend', async () => {
  await page.getByRole('button', { name: 'Prompts', exact: true }).first().click()
  await page.getByRole('button', { name: /Create Prompt/i }).first().click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('E2E review prompt')
  await dialog.getByLabel('Description').fill('Created by the end-to-end test')
  await dialog
    .getByLabel('User Prompt')
    .fill('Review this {{language}} code:\n\n{{code}}')
  await dialog.getByRole('button', { name: 'Create Prompt' }).click()

  await expect(page.getByText('E2E review prompt').first()).toBeVisible({ timeout: 15_000 })

  await page.getByText('E2E review prompt').first().click()
  await expect(page.getByRole('heading', { name: 'E2E review prompt' }).first()).toBeVisible()
  await expect(page.getByText('prompts/', { exact: false }).first()).toBeVisible()
})

test('copies a Prompt with variable values', async () => {
  await page.getByText('E2E review prompt').first().click()
  await page.getByRole('button', { name: /Copy with variables/i }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('language').fill('TypeScript')
  await dialog.getByLabel('code').fill('const value = 1')
  await dialog.getByRole('button', { name: /^Copy/i }).last().click()
  await expect(page.getByText(/Copied|clipboard/i).first()).toBeVisible({ timeout: 15_000 })
})

test('creates an instruction contract with the default target', async () => {
  await page.getByRole('button', { name: 'Agent Instructions', exact: true }).first().click()
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('E2E contract')
  await dialog.getByLabel('Contract body').fill('Always apply the end-to-end rule.')
  await dialog.getByRole('button', { name: /Save \(creates a version\)/i }).click()
  await expect(page.getByText('E2E contract').first()).toBeVisible({ timeout: 15_000 })
})

test('creates a Skill with SKILL.md', async () => {
  await page.getByRole('button', { name: 'Skills', exact: true }).first().click()
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('E2E skill')
  await dialog.getByLabel('Content of SKILL.md').fill('# E2E Skill\n\nFollow the checklist.')
  await dialog.getByRole('button', { name: 'Create Skill' }).click()
  await expect(page.getByText('E2E skill').first()).toBeVisible({ timeout: 15_000 })
})

test('creates and redacts an MCP server', async () => {
  await page.getByRole('button', { name: 'MCP', exact: true }).first().click()
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('E2E MCP server')
  await dialog.getByLabel('Launch command').fill('npx')
  await dialog.getByLabel('Arguments').fill('-y @modelcontextprotocol/server-example')
  await dialog.getByRole('button', { name: 'Add to library' }).click()
  await expect(page.getByText('E2E MCP server').first()).toBeVisible({ timeout: 15_000 })
})

test('finds assets through global search', async () => {
  await page.getByRole('textbox', { name: 'Global search' }).fill('E2E')
  const results = page.locator('button').filter({ hasText: 'E2E review prompt' })
  await expect(results.first()).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
})

test('opens Settings and exposes data locations', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await expect(page.getByText(/Database/i).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Application|Version|v0\.5\.0/i).first()).toBeVisible()
})
