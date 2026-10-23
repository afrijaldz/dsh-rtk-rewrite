import { existsSync } from 'node:fs'
import { DEFAULT_COMMANDS, isRtkCommand, shouldRewrite } from './lib/policy.js'
import { createRewriter, resolveRtkPath, routeThroughRtk } from './lib/rtk.js'

/**
 * Cordis plugin name, used by loader diagnostics.
 */
export const name = 'rtk-rewrite'

/**
 * The tool registry this plugin wraps. Declaring it keeps the plugin inactive
 * (instead of throwing) in compositions without `ctx.tools`.
 */
export const inject = ['tools']

/**
 * Rewrite supported shell commands to their RTK equivalent before dispatch.
 *
 * The tool registry deep-freezes `exec.arguments`, but the property itself is
 * writable, so the command is replaced with a new object. Validation and
 * presentation stay untouched; only what the shell executes changes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 * @param {boolean} [config.enabled] - set false to disable without uninstalling
 * @param {string} [config.rtkPath] - explicit path to the rtk executable
 * @param {string} [config.commandPath] - executable the emitted command names, when that
 *   differs from `rtkPath` (e.g. a launcher that redirects RTK's state directory)
 * @param {string} [config.dataDir] - keep RTK state (db, config, tee) under this directory
 * @param {number} [config.timeoutMs] - per-rewrite limit, default 1500
 * @param {number} [config.cacheSize] - remembered rewrites, default 500
 * @param {string[]} [config.commands] - extra first tokens to rewrite
 * @param {string[]} [config.exclude] - first tokens to never rewrite
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return

  const rtkPath = resolveRtkPath({ rtkPath: config.rtkPath })
  if (rtkPath === undefined) {
    ctx.logger?.warn?.('rtk-rewrite: no rtk executable found (set rtkPath or RTK_BIN, or put rtk on PATH); commands run unchanged')
    return
  }

  const rewrite = createRewriter({
    rtkPath,
    dataDir: config.dataDir,
    timeoutMs: positive(config.timeoutMs, 1500),
    cacheSize: positive(config.cacheSize, 500),
  })

  // What the shell should invoke. Defaults to the resolved binary, so a
  // configured `rtkPath` works without `rtk` ever being on PATH.
  const commandPath =
    typeof config.commandPath === 'string' && config.commandPath !== '' && existsSync(config.commandPath)
      ? config.commandPath
      : rtkPath

  const allowed = new Set([...DEFAULT_COMMANDS, ...(config.commands ?? [])].map(lower))
  const blocked = new Set((config.exclude ?? []).map(lower))

  ctx.on('tools/execute', async (exec, next) => {
    try {
      const args = exec.arguments
      if (
        (exec.name === 'pwsh' || exec.name === 'bash') &&
        args !== null &&
        typeof args === 'object' &&
        typeof args.command === 'string' &&
        // An escalation approval names a specific command; never rewrite it.
        args.sandbox_permissions === undefined &&
        shouldRewrite(args.command, { allowed, blocked })
      ) {
        const rewritten = await rewrite(args.command)
        // bash cannot execute a .cmd launcher, so it gets the real binary.
        const routed =
          rewritten === ''
            ? ''
            : routeThroughRtk(rewritten, exec.name === 'bash' ? rtkPath : commandPath, exec.name)
        if (routed !== '' && routed !== args.command && isRtkCommand(rewritten) && !rewritten.includes('\n')) {
          exec.arguments = { ...args, command: routed }
        }
      }
    } catch {
      // The optimizer must never block or fail a tool call.
    }
    return next()
  })
}

function lower(value) {
  return String(value).toLowerCase()
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
