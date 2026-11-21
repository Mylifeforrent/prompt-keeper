import { spawn } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../shared/domain/errors'
import { isSafeRelativePath } from '../../shared/domain/folders'
import type { Platform } from '../../shared/domain/targets'
import type { AppContext } from '../context'
import type { OperationSignal } from '../operations'
import { sha256Hex } from './hash'

/**
 * System Git CLI adapter.
 *
 * Every command is spawned with an argument array and `shell: false`; this
 * module never builds a shell string from user input. Interactive prompts are
 * disabled, optional locks stay off so read-only polling cannot block the
 * user's own Git commands, and network commands carry a timeout.
 */

export const GIT_LOCAL_TIMEOUT_MS = 20_000
export const GIT_STATUS_TIMEOUT_MS = 15_000
export const GIT_NETWORK_TIMEOUT_MS = 180_000
export const GIT_CLONE_TIMEOUT_MS = 300_000
export const GIT_SHORT_TIMEOUT_MS = 2_500
export const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export type GitAuthMode = 'credential' | 'ssh' | 'token'

export interface GitAuth {
  mode: GitAuthMode
  /** Plain token. Never passed on the command line; only through the askpass environment. */
  token?: string | null
  /** Optional SSH identity. When absent the system configuration and agent are used. */
  sshKeyPath?: string | null
}

export interface GitRunOptions {
  cwd?: string
  timeoutMs?: number
  network?: boolean
  auth?: GitAuth
  signal?: OperationSignal
  maxOutputBytes?: number
  allowFailure?: boolean
}

export interface GitCommandResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

export interface GitTreeEntry {
  mode: string
  type: 'blob' | 'tree' | 'commit'
  hash: string
  path: string
  /** Blob size from `ls-tree -l`; null for trees or when Git reports `-`. */
  size: number | null
}

export interface GitBlobReadResult {
  size: number
  missing: boolean
}

/**
 * Sequential reader over `git cat-file --batch`. Content is streamed to the
 * callback so callers can hash or stage large blobs without buffering them.
 */
export interface GitBlobReader {
  read(oid: string, onChunk: (chunk: Buffer) => void): Promise<GitBlobReadResult>
  close(): Promise<void>
}

export interface GitStatusEntry {
  code: string
  path: string
  originalPath?: string
}

export interface GitCloneInput {
  url: string
  directory: string
  branch?: string
  shallow?: boolean
  auth?: GitAuth
  signal?: OperationSignal
}

export interface GitAheadBehind {
  ahead: number
  behind: number
}

export interface GitNetworkOptions {
  auth?: GitAuth
  signal?: OperationSignal
  timeoutMs?: number
}

export interface GitPushOptions extends GitNetworkOptions {
  /** Defaults to the branch name. `branch` pushes use `HEAD:refs/heads/<name>`. */
  refspec?: string
}

export interface GitClient {
  version(): Promise<string>
  isGitRepo(repoPath: string): Promise<boolean>
  isGitWorktree(repoPath: string): Promise<boolean>
  topLevelPath(repoPath: string): Promise<string | null>
  clone(input: GitCloneInput): Promise<void>
  fetch(repoPath: string, remote: string, options?: GitNetworkOptions): Promise<void>
  revParse(repoPath: string, ref: string): Promise<string | null>
  lsTree(repoPath: string, ref: string, paths?: string[], options?: GitRunOptions): Promise<GitTreeEntry[]>
  show(repoPath: string, ref: string, path: string, options?: GitRunOptions): Promise<Buffer | null>
  openBlobReader(
    repoPath: string,
    options?: { signal?: OperationSignal; timeoutMs?: number },
  ): Promise<GitBlobReader>
  statusPorcelain(repoPath: string, paths?: string[]): Promise<GitStatusEntry[]>
  add(repoPath: string, paths: string[]): Promise<void>
  commit(repoPath: string, message: string, paths?: string[]): Promise<string>
  push(repoPath: string, remote: string, branch: string, options?: GitPushOptions): Promise<void>
  currentHead(repoPath: string): Promise<string | null>
  remoteHead(repoPath: string, remote: string, branch: string): Promise<string | null>
  currentBranch(repoPath: string): Promise<string | null>
  ensureUnbornBranch(repoPath: string, branch: string): Promise<void>
  aheadBehind(repoPath: string, leftRef: string, rightRef: string, timeoutMs?: number): Promise<GitAheadBehind>
  isAncestor(repoPath: string, ancestorRef: string, descendantRef: string): Promise<boolean>
  fastForward(repoPath: string, ref: string, signal?: OperationSignal): Promise<void>
  restore(repoPath: string, paths: string[]): Promise<void>
  remoteUrl(repoPath: string, remote: string): Promise<string | null>
  initRepo(directory: string): Promise<void>
  initBare(directory: string): Promise<void>
}

interface GitAdapterOptions {
  tempDir: string
  platform: Platform
}

const ASKPASS_ENV = 'PROMPT_KEEPER_GIT_TOKEN'
const ASKPASS_USERNAME = 'x-access-token'

const AUTH_HINTS: RegExp[] = [
  /authentication failed/i,
  /could not read (?:username|password)/i,
  /terminal prompts disabled/i,
  /permission denied \(publickey/i,
  /support for password authentication was removed/i,
  /invalid username or password/i,
  /http basic: access denied/i,
  /access denied/i,
  /repository not found/i,
  /the requested repository either does not exist/i,
  /no such identity/i,
  /requested url returned error: 40[134]/i,
  /\b40[13]\b/,
]

const CONFLICT_HINTS: RegExp[] = [
  /\[rejected\]/i,
  /non-fast-forward/i,
  /fetch first/i,
  /failed to push some refs/i,
  /would be overwritten by (?:merge|checkout)/i,
  /not possible to fast-forward/i,
  /diverging branches/i,
  /need to specify how to reconcile divergent branches/i,
  /conflict \(content\)/i,
  /your local changes to the following files would be overwritten/i,
  /cannot merge/i,
  /already exists and is not an empty directory/i,
]

const NETWORK_HINTS: RegExp[] = [
  /could not resolve host/i,
  /could not resolve hostname/i,
  /unable to access/i,
  /connection timed out/i,
  /connection refused/i,
  /network is unreachable/i,
  /network is down/i,
  /temporary failure in name resolution/i,
  /rpc failed/i,
  /early eof/i,
  /remote end hung up/i,
  /connection reset/i,
  /software caused connection abort/i,
  /gnutls/i,
  /\bssl\b/i,
  /\btls\b/i,
  /operation timed out/i,
  /the remote repository is empty/i,
]

const BRANCH_HINTS: RegExp[] = [
  /remote branch .* not found in upstream origin/i,
  /not a valid object name/i,
  /invalid refspec/i,
]

const NOT_FOUND_HINTS: RegExp[] = [
  /does not exist in/i,
  /exists on disk, but not in/i,
  /not in the working tree/i,
  /path .* does not exist/i,
  /invalid object name/i,
  /bad revision/i,
  /unknown revision or path/i,
]

const SAFE_REF = /^(?!-)[A-Za-z0-9._/@]+$/
const SAFE_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const GIT_BLOB_TIMEOUT_MS = 120_000
const GIT_BATCH_STDERR_BYTES = 64 * 1024
const SAFE_REMOTE = /^(?!-)[A-Za-z0-9._-]+$/
const SAFE_BRANCH = /^(?![-/.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/
const SAFE_REFSPEC = /^(?:HEAD|[A-Za-z0-9._/-]+):refs\/heads\/[A-Za-z0-9._/-]+$/

function redactUrls(text: string): string {
  return text.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@]+)@/g, '$1[REDACTED]@')
}

function excerpt(text: string, limit = 400): string {
  const cleaned = redactUrls(text).replace(/\r/g, '').trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit)}...`
}

function messageWithContext(message: string, stderr: string): string {
  const detail = excerpt(stderr)
  return detail ? `${message} ${detail}` : message
}

function mapGitFailure(stderr: string, options: GitRunOptions): AppError {
  if (AUTH_HINTS.some((pattern) => pattern.test(stderr))) {
    return new AppError(
      'GIT_AUTH',
      messageWithContext(
        'Git authentication failed. Check your system Git credentials, SSH agent, or repository token.',
        stderr,
      ),
    )
  }
  if (CONFLICT_HINTS.some((pattern) => pattern.test(stderr))) {
    return new AppError(
      'GIT_CONFLICT',
      messageWithContext(
        'Git stopped because the repository or worktree changed. Fetch the latest changes and resolve the difference.',
        stderr,
      ),
    )
  }
  if (options.network === true || NETWORK_HINTS.some((pattern) => pattern.test(stderr))) {
    return new AppError(
      'NETWORK',
      messageWithContext('The Git remote could not be reached. Check the network connection and retry.', stderr),
    )
  }
  if (BRANCH_HINTS.some((pattern) => pattern.test(stderr))) {
    return new AppError(
      'VALIDATION',
      messageWithContext('The configured branch does not exist on the remote repository.', stderr),
    )
  }
  return new AppError('INTERNAL', messageWithContext('The Git command failed.', stderr))
}

function quoteSshPath(path: string): string {
  // GIT_SSH_COMMAND is parsed by Git's own shell-like splitter; quote only the
  // identity path and reject characters that could escape the quoted value.
  const escaped = path.replace(/["\\]/g, '')
  return `"${escaped}"`
}

function validatePaths(paths: string[]): string[] {
  for (const path of paths) {
    if (!isSafeRelativePath(path)) {
      throw new AppError('VALIDATION', `The repository path "${path}" is not a safe relative path.`)
    }
  }
  return paths
}

function decodePath(value: string): string {
  return value.replace(/\\/g, '/')
}

type BatchPhase = 'idle' | 'header' | 'content' | 'trailing'

interface BatchRequest {
  resolve: (result: GitBlobReadResult) => void
  reject: (error: Error) => void
  onChunk: (chunk: Buffer) => void
  onData: () => void
}

/**
 * Line-and-payload parser for `git cat-file --batch`. One request is read at a
 * time; the state machine consumes exactly the announced byte count so binary
 * content cannot desynchronize the stream.
 */
class CatFileBatchReader implements GitBlobReader {
  private phase: BatchPhase = 'idle'
  private header = ''
  private remaining = 0
  private total = 0
  private request: BatchRequest | null = null
  private closed = false
  private exitError: AppError | null = null
  private stderr = ''
  private timer: NodeJS.Timeout | null = null
  private readonly cancelTimer: NodeJS.Timeout
  private readonly timeoutMs: number
  private readonly signal?: OperationSignal

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    options: { signal?: OperationSignal; timeoutMs?: number },
  ) {
    this.signal = options.signal
    this.timeoutMs = options.timeoutMs ?? GIT_BLOB_TIMEOUT_MS
    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.stderr?.on('data', (chunk: Buffer) => {
      if (this.stderr.length < GIT_BATCH_STDERR_BYTES) {
        this.stderr += chunk.toString('utf8')
      }
    })
    this.child.on('error', (error: NodeJS.ErrnoException) => {
      const appError =
        error.code === 'ENOENT'
          ? new AppError(
              'GIT_NOT_FOUND',
              'Git was not found. Install Git and make sure the git executable is on PATH.',
            )
          : new AppError('INTERNAL', `Git could not start: ${error.message}`)
      this.fail(appError)
    })
    this.child.stdin?.on('error', (error) => {
      this.fail(new AppError('INTERNAL', `The Git object reader stdin failed: ${error.message}`))
    })
    this.child.on('close', (code: number | null) => {
      if (this.closed) return
      if (this.exitError) return
      if (code === 0) {
        this.fail(new AppError('INTERNAL', 'The Git object reader closed before the request completed.'))
        return
      }
      this.fail(mapGitFailure(this.stderr, {}))
    })
    this.cancelTimer = setInterval(() => {
      if (this.signal?.cancelled && !this.closed) {
        this.fail(new AppError('INTERNAL', 'The operation was cancelled.'))
      }
    }, 100)
    this.cancelTimer.unref?.()
  }

  async read(oid: string, onChunk: (chunk: Buffer) => void): Promise<GitBlobReadResult> {
    if (!SAFE_OID.test(oid)) {
      throw new AppError('VALIDATION', 'The Git object name is not valid.')
    }
    if (this.exitError) {
      throw this.exitError
    }
    if (this.closed) {
      throw new AppError('INTERNAL', 'The Git object reader is closed.')
    }
    if (this.request) {
      throw new AppError('INTERNAL', 'The Git object reader is busy.')
    }
    const stdin = this.child.stdin
    if (!stdin || stdin.destroyed) {
      throw new AppError('INTERNAL', 'The Git object reader stdin is closed.')
    }
    return new Promise<GitBlobReadResult>((resolve, reject) => {
      this.phase = 'header'
      this.header = ''
      this.remaining = 0
      this.total = 0
      this.request = {
        resolve,
        reject,
        onChunk,
        onData: () => this.touch(),
      }
      this.touch()
      stdin.write(`${oid}\n`)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.fail(new AppError('INTERNAL', 'The Git object reader was closed.'))
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    clearInterval(this.cancelTimer)
    this.child.stdin?.end()
    if (!this.child.killed) {
      this.child.kill('SIGTERM')
    }
  }

  private touch(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.fail(
        new AppError('INTERNAL', `The Git object reader did not respond within ${Math.round(this.timeoutMs / 1000)} seconds.`),
      )
    }, this.timeoutMs)
    this.timer.unref?.()
  }

  private fail(error: AppError): void {
    if (this.exitError) return
    this.exitError = error
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const request = this.request
    this.request = null
    this.phase = 'idle'
    request?.reject(error)
    if (!this.child.killed) this.child.kill('SIGTERM')
  }

  private settle(): void {
    const request = this.request
    if (!request) return
    this.request = null
    this.phase = 'idle'
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    request.resolve({ size: this.total, missing: false })
  }

  private onData(chunk: Buffer): void {
    if (this.exitError || !this.request) return
    const request = this.request
    request.onData()
    let offset = 0
    try {
      while (offset < chunk.length) {
        if (this.phase === 'header') {
          const newline = chunk.indexOf(0x0a, offset)
          if (newline === -1) {
            this.header += chunk.subarray(offset).toString('utf8')
            offset = chunk.length
            break
          }
          this.header += chunk.subarray(offset, newline).toString('utf8')
          offset = newline + 1
          const header = this.header.trim()
          this.header = ''
          const parts = header.split(' ')
          if (parts.length === 2 && parts[1] === 'missing') {
            this.request = null
            this.phase = 'idle'
            if (this.timer) {
              clearTimeout(this.timer)
              this.timer = null
            }
            request.resolve({ size: 0, missing: true })
            return
          }
          if (parts.length !== 3 || parts[1] !== 'blob') {
            throw new AppError('CORRUPT', `Git returned an unexpected object header for ${parts[0] ?? 'unknown'}.`)
          }
          const size = Number.parseInt(parts[2], 10)
          if (!Number.isFinite(size) || size < 0) {
            throw new AppError('CORRUPT', 'Git returned an invalid object size.')
          }
          this.total = 0
          this.remaining = size
          this.phase = size === 0 ? 'trailing' : 'content'
          continue
        }
        if (this.phase === 'content') {
          const take = Math.min(this.remaining, chunk.length - offset)
          if (take > 0) {
            request.onChunk(chunk.subarray(offset, offset + take))
            offset += take
            this.remaining -= take
            this.total += take
          }
          if (this.remaining === 0) this.phase = 'trailing'
          continue
        }
        if (this.phase === 'trailing') {
          const newline = chunk.indexOf(0x0a, offset)
          if (newline === -1) {
            offset = chunk.length
            break
          }
          offset = newline + 1
          this.settle()
        }
      }
    } catch (error) {
      this.fail(error instanceof AppError ? error : new AppError('INTERNAL', 'The Git object stream could not be read.'))
    }
  }
}

export class GitAdapter implements GitClient {
  private askpassScript: Promise<string> | null = null

  constructor(private readonly options: GitAdapterOptions) {}

  private async run(args: string[], options: GitRunOptions = {}): Promise<GitCommandResult> {
    const timeoutMs = options.timeoutMs ?? (options.network ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS)
    const maxBytes = options.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES
    const env = await this.buildEnv(options.auth)
    const fullArgs = ['--no-pager', '--no-optional-locks', ...args]

    return new Promise<GitCommandResult>((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn('git', fullArgs, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(
          new AppError(
            'INTERNAL',
            error instanceof Error ? `Git could not start: ${error.message}` : 'Git could not start.',
          ),
        )
        return
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false
      let timedOut = false
      let cancelled = false
      let killed = false
      let killTimer: NodeJS.Timeout | null = null

      const killChild = (): void => {
        if (killed) return
        killed = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2_000)
        killTimer.unref?.()
      }

      const finish = (error: AppError | null, result?: GitCommandResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeoutTimer)
        clearInterval(cancelTimer)
        if (killTimer) clearTimeout(killTimer)
        if (error) reject(error)
        else if (result) resolve(result)
      }

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        killChild()
      }, timeoutMs)
      timeoutTimer.unref?.()

      const cancelTimer = setInterval(() => {
        if (options.signal?.cancelled && !settled) {
          cancelled = true
          killChild()
        }
      }, 100)
      cancelTimer.unref?.()

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > maxBytes) {
          killChild()
          finish(
            new AppError('VALIDATION', 'Git returned more output than this operation can handle.', {
              kind: 'limit-exceeded',
              limitBytes: maxBytes,
            }),
          )
          return
        }
        stdoutChunks.push(chunk)
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        // Keep only the last part; error mapping only needs the tail.
        if (stderrBytes <= maxBytes) stderrChunks.push(chunk)
      })

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          finish(
            new AppError(
              'GIT_NOT_FOUND',
              'Git was not found. Install Git and make sure the git executable is on PATH.',
            ),
          )
          return
        }
        finish(new AppError('INTERNAL', `Git could not start: ${error.message}`))
      })

      child.on('close', (code: number | null) => {
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        const stdout = Buffer.concat(stdoutChunks)
        if (cancelled) {
          finish(new AppError('INTERNAL', 'The operation was cancelled.'))
          return
        }
        if (timedOut) {
          const seconds = Math.round(timeoutMs / 1000)
          finish(
            options.network
              ? new AppError('NETWORK', `The Git remote did not respond within ${seconds} seconds. Retry when the network is available.`)
              : new AppError('INTERNAL', `The Git command did not finish within ${seconds} seconds.`, undefined, true),
          )
          return
        }
        if (code === 0) {
          finish(null, { stdout, stderr, exitCode: 0 })
          return
        }
        if (options.allowFailure) {
          finish(null, { stdout, stderr, exitCode: code ?? 1 })
          return
        }
        finish(mapGitFailure(stderr, options))
      })
    })
  }

  private async buildEnv(auth?: GitAuth): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      LC_ALL: 'C',
    }
    delete env.GIT_DIR
    delete env.GIT_WORK_TREE
    delete env.GIT_INDEX_FILE
    delete env.GIT_ASKPASS
    delete env.SSH_ASKPASS
    delete env.GIT_SSH_COMMAND
    delete env[ASKPASS_ENV]

    if (auth?.mode === 'token' && auth.token) {
      env.GIT_ASKPASS = await this.ensureAskpassScript()
      env.GIT_ASKPASS_REQUIRE = 'force'
      env[ASKPASS_ENV] = auth.token
    } else if (auth?.mode === 'ssh' && auth.sshKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${quoteSshPath(auth.sshKeyPath)} -o IdentitiesOnly=yes -o BatchMode=yes`
    }
    return env
  }

  private ensureAskpassScript(): Promise<string> {
    if (!this.askpassScript) {
      this.askpassScript = this.writeAskpassScript().catch((error: unknown) => {
        this.askpassScript = null
        throw error instanceof AppError
          ? error
          : new AppError(
              'INTERNAL',
              error instanceof Error ? `The Git credential helper could not be created: ${error.message}` : 'The Git credential helper could not be created.',
            )
      })
    }
    return this.askpassScript
  }

  /**
   * The helper prints the username or the token from an environment variable,
   * so the token never appears in argv, a file, or a log line. The script
   * itself contains no secret and is safe to reuse across repositories.
   */
  private async writeAskpassScript(): Promise<string> {
    const dir = this.options.tempDir
    await mkdir(dir, { recursive: true })
    const suffix = `${process.pid}-${sha256Hex(dir).slice(0, 8)}`
    if (this.options.platform === 'win32') {
      const scriptPath = join(dir, `pk-git-askpass-${suffix}.ps1`)
      const wrapperPath = join(dir, `pk-git-askpass-${suffix}.cmd`)
      await writeFile(
        scriptPath,
        [
          'param([string]$Prompt)',
          "if ($Prompt -match '(?i)username|user') {",
          `  '${ASKPASS_USERNAME}'`,
          '} else {',
          `  $env:${ASKPASS_ENV}`,
          '}',
          '',
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        wrapperPath,
        [
          '@echo off',
          `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0pk-git-askpass-${suffix}.ps1" "%~1"`,
          '',
        ].join('\r\n'),
        'utf8',
      )
      return wrapperPath
    }
    const scriptPath = join(dir, `pk-git-askpass-${suffix}.sh`)
    await writeFile(
      scriptPath,
      [
        '#!/bin/sh',
        'case "$1" in',
        `  *Username*|*username*|*User*) printf '%s\\n' '${ASKPASS_USERNAME}' ;;`,
        '  *) printf \'%s\\n\' "$' + ASKPASS_ENV + '" ;;',
        'esac',
        '',
      ].join('\n'),
      'utf8',
    )
    await chmod(scriptPath, 0o700)
    return scriptPath
  }

  async version(): Promise<string> {
    const result = await this.run(['--version'], { timeoutMs: 5_000 })
    const match = /git version (\S+)/.exec(result.stdout.toString('utf8'))
    return match ? match[1] : result.stdout.toString('utf8').trim()
  }

  async isGitRepo(repoPath: string): Promise<boolean> {
    const result = await this.run(['rev-parse', '--git-dir'], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    return result.exitCode === 0
  }

  async isGitWorktree(repoPath: string): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree'], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    return result.exitCode === 0 && result.stdout.toString('utf8').trim() === 'true'
  }

  async topLevelPath(repoPath: string): Promise<string | null> {
    const result = await this.run(['rev-parse', '--show-toplevel'], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    const value = result.stdout.toString('utf8').trim()
    return result.exitCode === 0 && value ? decodePath(value) : null
  }

  async clone(input: GitCloneInput): Promise<void> {
    const args = ['clone', '--no-tags', '--single-branch']
    if (input.shallow) args.push('--depth', '1')
    if (input.branch) {
      if (!SAFE_BRANCH.test(input.branch)) {
        throw new AppError('VALIDATION', 'The repository branch name is not valid.')
      }
      args.push('--branch', input.branch)
    }
    args.push('--', input.url, input.directory)
    await this.run(args, {
      network: true,
      timeoutMs: GIT_CLONE_TIMEOUT_MS,
      auth: input.auth,
      signal: input.signal,
    })
  }

  async fetch(repoPath: string, remote: string, options: GitNetworkOptions = {}): Promise<void> {
    if (!SAFE_REMOTE.test(remote)) {
      throw new AppError('VALIDATION', 'The Git remote name is not valid.')
    }
    await this.run(['fetch', '--prune', '--no-tags', remote], {
      cwd: repoPath,
      network: true,
      timeoutMs: options.timeoutMs ?? GIT_NETWORK_TIMEOUT_MS,
      auth: options.auth,
      signal: options.signal,
    })
  }

  async revParse(repoPath: string, ref: string): Promise<string | null> {
    if (!SAFE_REF.test(ref)) return null
    const result = await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: repoPath,
      timeoutMs: 5_000,
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null
    const value = result.stdout.toString('utf8').trim()
    return value || null
  }

  async lsTree(
    repoPath: string,
    ref: string,
    paths: string[] = [],
    options: GitRunOptions = {},
  ): Promise<GitTreeEntry[]> {
    if (!SAFE_REF.test(ref)) throw new AppError('VALIDATION', 'The Git revision is not valid.')
    if (paths.length) validatePaths(paths)
    const args = ['ls-tree', '-r', '-l', '-z', '--full-tree', ref]
    if (paths.length) args.push('--', ...paths)
    const result = await this.run(args, {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      signal: options.signal,
      maxOutputBytes: options.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES,
    })
    const entries: GitTreeEntry[] = []
    for (const record of result.stdout.toString('utf8').split('\0')) {
      if (!record) continue
      const tab = record.indexOf('\t')
      if (tab === -1) continue
      const meta = record
        .slice(0, tab)
        .trim()
        .split(/\s+/)
      if (meta.length < 3) continue
      const type = meta[1] === 'blob' || meta[1] === 'tree' || meta[1] === 'commit' ? meta[1] : null
      if (!type) continue
      const sizeToken = meta[3]
      const size =
        sizeToken && sizeToken !== '-' && /^\d+$/.test(sizeToken)
          ? Number.parseInt(sizeToken, 10)
          : null
      entries.push({
        mode: meta[0],
        type,
        hash: meta[2],
        path: decodePath(record.slice(tab + 1)),
        size,
      })
    }
    return entries
  }

  async show(
    repoPath: string,
    ref: string,
    path: string,
    options: GitRunOptions = {},
  ): Promise<Buffer | null> {
    if (!SAFE_REF.test(ref)) throw new AppError('VALIDATION', 'The Git revision is not valid.')
    validatePaths([path])
    const result = await this.run(['show', `${ref}:${path}`], {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      signal: options.signal,
      maxOutputBytes: options.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES,
      allowFailure: true,
    })
    if (result.exitCode !== 0) {
      if (NOT_FOUND_HINTS.some((pattern) => pattern.test(result.stderr))) return null
      throw mapGitFailure(result.stderr, { network: false })
    }
    return result.stdout
  }

  async openBlobReader(
    repoPath: string,
    options: { signal?: OperationSignal; timeoutMs?: number } = {},
  ): Promise<GitBlobReader> {
    const env = await this.buildEnv()
    const child = spawn('git', ['--no-pager', '--no-optional-locks', 'cat-file', '--batch'], {
      cwd: repoPath,
      shell: false,
      windowsHide: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return new CatFileBatchReader(child, options)
  }

  async statusPorcelain(repoPath: string, paths: string[] = []): Promise<GitStatusEntry[]> {
    if (paths.length) validatePaths(paths)
    const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all']
    if (paths.length) args.push('--', ...paths)
    const result = await this.run(args, {
      cwd: repoPath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
    })
    const tokens = result.stdout.toString('utf8').split('\0')
    const entries: GitStatusEntry[] = []
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (!token) continue
      const code = token.slice(0, 2)
      const path = decodePath(token.slice(3))
      if (!path) continue
      const staged = code[0]
      const unstaged = code[1]
      if (staged === 'R' || staged === 'C' || unstaged === 'R' || unstaged === 'C') {
        const original = tokens[index + 1]
        if (original) index++
        entries.push({
          code,
          path,
          ...(original ? { originalPath: decodePath(original) } : {}),
        })
        continue
      }
      entries.push({ code, path })
    }
    return entries
  }

  async add(repoPath: string, paths: string[]): Promise<void> {
    if (!paths.length) return
    validatePaths(paths)
    for (let index = 0; index < paths.length; index += 100) {
      const chunk = paths.slice(index, index + 100)
      await this.run(['add', '-A', '--', ...chunk], {
        cwd: repoPath,
        timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      })
    }
  }

  async commit(repoPath: string, message: string, paths: string[] = []): Promise<string> {
    const trimmed = message.trim()
    if (!trimmed) throw new AppError('VALIDATION', 'A commit message is required.')
    if (paths.length) validatePaths(paths)
    const commitArgs = (extra: string[]): string[] => [
      ...extra,
      'commit',
      '--only',
      '-m',
      trimmed,
      ...(paths.length ? ['--', ...paths] : []),
    ]

    let result: GitCommandResult
    try {
      result = await this.run(commitArgs([]), {
        cwd: repoPath,
        timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      })
    } catch (error) {
      const missingIdentity =
        error instanceof AppError &&
        error.code === 'INTERNAL' &&
        /(?:please tell me who you are|empty ident name|unable to auto-detect email address|user\.email)/i.test(
          error.message,
        )
      if (!missingIdentity) throw error
      // Test fixtures and fresh machines may not have a global identity.
      result = await this.run(
        commitArgs([
          '-c',
          'user.name=Prompt Keeper',
          '-c',
          'user.email=prompt-keeper@localhost',
        ]),
        { cwd: repoPath, timeoutMs: GIT_LOCAL_TIMEOUT_MS },
      )
    }
    void result
    const head = await this.currentHead(repoPath)
    if (!head) throw new AppError('INTERNAL', 'The commit was created but HEAD could not be read.')
    return head
  }

  async push(repoPath: string, remote: string, branch: string, options: GitPushOptions = {}): Promise<void> {
    if (!SAFE_REMOTE.test(remote)) {
      throw new AppError('VALIDATION', 'The Git remote name is not valid.')
    }
    const refspec = options.refspec ?? branch
    const valid = options.refspec ? SAFE_REFSPEC.test(options.refspec) : SAFE_BRANCH.test(branch)
    if (!valid) throw new AppError('VALIDATION', 'The Git branch or refspec is not valid.')
    await this.run(['push', remote, refspec], {
      cwd: repoPath,
      network: true,
      timeoutMs: options.timeoutMs ?? GIT_NETWORK_TIMEOUT_MS,
      auth: options.auth,
      signal: options.signal,
    })
  }

  async currentHead(repoPath: string): Promise<string | null> {
    return this.revParse(repoPath, 'HEAD')
  }

  async remoteHead(repoPath: string, remote: string, branch: string): Promise<string | null> {
    if (!SAFE_REMOTE.test(remote) || !SAFE_BRANCH.test(branch)) return null
    return this.revParse(repoPath, `refs/remotes/${remote}/${branch}`)
  }

  /** Current branch name, or null when HEAD is detached or unborn without a symbolic ref. */
  async currentBranch(repoPath: string): Promise<string | null> {
    const result = await this.run(['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null
    const value = result.stdout.toString('utf8').trim()
    return value || null
  }

  /** Empty clones can start on a different default branch; align before the first commit. */
  async ensureUnbornBranch(repoPath: string, branch: string): Promise<void> {
    if (!SAFE_BRANCH.test(branch)) throw new AppError('VALIDATION', 'The Git branch name is not valid.')
    if (await this.currentHead(repoPath)) return
    const current = await this.run(['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    const name = current.stdout.toString('utf8').trim()
    if (!name || name === branch) return
    await this.run(['checkout', '-b', branch], {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
    })
  }

  async aheadBehind(
    repoPath: string,
    leftRef: string,
    rightRef: string,
    timeoutMs = GIT_SHORT_TIMEOUT_MS,
  ): Promise<GitAheadBehind> {
    if (!SAFE_REF.test(leftRef) || !SAFE_REF.test(rightRef)) return { ahead: 0, behind: 0 }
    const result = await this.run(['rev-list', '--left-right', '--count', `${leftRef}...${rightRef}`], {
      cwd: repoPath,
      timeoutMs,
      allowFailure: true,
    })
    if (result.exitCode !== 0) return { ahead: 0, behind: 0 }
    const parts = result.stdout.toString('utf8').trim().split(/\s+/)
    const ahead = Number.parseInt(parts[0] ?? '0', 10)
    const behind = Number.parseInt(parts[1] ?? '0', 10)
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    }
  }

  async isAncestor(repoPath: string, ancestorRef: string, descendantRef: string): Promise<boolean> {
    if (!SAFE_REF.test(ancestorRef) || !SAFE_REF.test(descendantRef)) return false
    const result = await this.run(['merge-base', '--is-ancestor', ancestorRef, descendantRef], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    return result.exitCode === 0
  }

  async fastForward(repoPath: string, ref: string, signal?: OperationSignal): Promise<void> {
    if (!SAFE_REF.test(ref)) throw new AppError('VALIDATION', 'The Git revision is not valid.')
    const head = await this.currentHead(repoPath)
    if (head && head === (await this.revParse(repoPath, ref))) return
    if (head && !(await this.isAncestor(repoPath, head, ref))) {
      throw new AppError(
        'GIT_CONFLICT',
        'The local clone and the remote branch have diverged. Fetch and resolve incoming changes before pushing.',
      )
    }
    await this.run(['merge', '--ff-only', '--no-edit', ref], {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      signal,
    })
  }

  async restore(repoPath: string, paths: string[]): Promise<void> {
    if (!paths.length) return
    validatePaths(paths)
    const restored = await this.run(
      ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths],
      { cwd: repoPath, timeoutMs: GIT_LOCAL_TIMEOUT_MS, allowFailure: true },
    )
    if (restored.exitCode === 0) return
    await this.run(['reset', '-q', 'HEAD', '--', ...paths], {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      allowFailure: true,
    })
    await this.run(['checkout', '--', ...paths], {
      cwd: repoPath,
      timeoutMs: GIT_LOCAL_TIMEOUT_MS,
      allowFailure: true,
    })
  }

  async remoteUrl(repoPath: string, remote: string): Promise<string | null> {
    if (!SAFE_REMOTE.test(remote)) return null
    const result = await this.run(['remote', 'get-url', remote], {
      cwd: repoPath,
      timeoutMs: GIT_SHORT_TIMEOUT_MS,
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null
    return result.stdout.toString('utf8').trim() || null
  }

  async initRepo(directory: string): Promise<void> {
    await this.run(['init', directory], { timeoutMs: GIT_LOCAL_TIMEOUT_MS })
  }

  async initBare(directory: string): Promise<void> {
    await this.run(['init', '--bare', directory], { timeoutMs: GIT_LOCAL_TIMEOUT_MS })
  }
}

export function createGitClient(ctx: AppContext): GitClient {
  return new GitAdapter({ tempDir: ctx.paths.temp, platform: ctx.platform })
}
