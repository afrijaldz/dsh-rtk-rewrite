import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Locate the RTK executable.
 *
 * Order: explicit `rtkPath`, then `RTK_BIN`, then PATH. Only real executables
 * are returned on Windows: a `.cmd` shim cannot be spawned with piped stdio
 * without a shell, so callers should point at `rtk.exe` when both exist.
 *
 * @param {{ rtkPath?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {string | undefined}
 */
export function resolveRtkPath({ rtkPath, env = process.env, platform = process.platform } = {}) {
  if (typeof rtkPath === 'string' && rtkPath !== '') {
    return existsSync(rtkPath) ? rtkPath : undefined
  }
  if (typeof env.RTK_BIN === 'string' && env.RTK_BIN !== '') {
    return existsSync(env.RTK_BIN) ? env.RTK_BIN : undefined
  }
  const names = platform === 'win32' ? ['rtk.exe'] : ['rtk']
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Environment for RTK child processes.
 *
 * Without `dataDir` the child inherits RTK's normal per-user state location.
 * With it, every path RTK writes is redirected there, which is required inside
 * sandboxes that only allow writes under one directory.
 *
 * @param {string | undefined} dataDir
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function rtkEnvironment(dataDir, base = process.env) {
  if (dataDir === undefined || dataDir === '') return { ...base }
  const root = String(dataDir).replace(/[\\/]+$/, '')
  return {
    ...base,
    RTK_DB_PATH: join(root, 'history.db'),
    RTK_CONFIG_DIR: join(root, 'config'),
    RTK_RECALL_DB: join(root, 'recall.db'),
    RTK_TEE_DIR: join(root, 'tee'),
    RTK_SUPPRESS_HOOK_WARNING: '1',
  }
}

const RTK_HEAD = /^rtk(?:\.cmd|\.exe)?(?=\s)/i

/**
 * Route a rewrite through a named executable instead of bare `rtk`.
 *
 * `rtk rewrite` echoes `rtk <args>`, which only runs when `rtk` is on `PATH`.
 * A configured `rtkPath` does not put it there, so the emitted command has to
 * name the executable itself. The path is quoted (it may contain spaces) and
 * given forward slashes, which both PowerShell and bash accept.
 *
 * @param {string} command - output of `rtk rewrite`
 * @param {string | undefined} executable - path the shell should invoke
 * @returns {string} the command unchanged when it is not an RTK invocation
 */
export function routeThroughRtk(command, executable) {
  if (typeof command !== 'string' || typeof executable !== 'string' || executable === '') return command
  if (!RTK_HEAD.test(command)) return command
  const path = executable.replace(/\\/g, '/').replace(/"/g, '')
  return command.replace(RTK_HEAD, `"${path}"`)
}

/**
 * Build a cached `rtk rewrite` runner.
 *
 * Exit codes 0 and 3 with stdout are rewrites; anything else means "leave the
 * command alone". Failures resolve to '' so callers pass the command through.
 *
 * @param {object} options
 * @param {string | undefined} options.rtkPath
 * @param {string} [options.dataDir]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.cacheSize]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof execFile} [options.execFileImpl] - injection point for tests
 * @returns {(command: string) => Promise<string>}
 */
export function createRewriter({
  rtkPath,
  dataDir,
  timeoutMs = 1500,
  cacheSize = 500,
  env = process.env,
  execFileImpl = execFile,
} = {}) {
  const cache = new Map()

  return function rewrite(command) {
    if (rtkPath === undefined || rtkPath === '') return Promise.resolve('')
    const cached = cache.get(command)
    if (cached !== undefined) return Promise.resolve(cached)

    return new Promise((resolve) => {
      execFileImpl(
        rtkPath,
        ['rewrite', command],
        {
          env: rtkEnvironment(dataDir, env),
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1 << 20,
          encoding: 'utf8',
        },
        (error, stdout) => {
          const text = typeof stdout === 'string' ? stdout.trim() : ''
          const code = error === null ? 0 : error.code
          const ok = text !== '' && (error === null || code === 0 || code === 3)
          const value = ok ? text : ''
          if (cache.size >= cacheSize) cache.clear()
          cache.set(command, value)
          resolve(value)
        },
      )
    })
  }
}
