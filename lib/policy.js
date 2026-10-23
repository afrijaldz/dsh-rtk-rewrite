/**
 * Commands with an RTK filter that works on Windows without extra Unix tools.
 *
 * Deliberately absent: ls, cat, grep, rg, tree, wc, head, tail. PowerShell
 * aliases those names (`ls` is Get-ChildItem), so rewriting them to `rtk ls`
 * would replace a working command with one that needs a native `ls` binary.
 */
export const DEFAULT_COMMANDS = Object.freeze([
  'git', 'gh', 'glab', 'gt', 'cargo', 'go', 'dotnet', 'docker', 'kubectl', 'oc',
  'aws', 'pytest', 'mypy', 'ruff', 'pip', 'uv', 'npm', 'pnpm', 'npx', 'bun',
  'bunx', 'vitest', 'jest', 'tsc', 'next', 'prisma', 'playwright', 'mvn', 'mvnd',
  'gradlew', 'rake', 'rspec', 'rubocop', 'php', 'phpunit', 'phpstan', 'pest',
  'paratest', 'ecs', 'pint', 'sqlfluff',
])

const DEFAULT_ALLOWED = new Set(DEFAULT_COMMANDS)
const NONE = new Set()

const RTK_COMMAND = /^rtk(?:\.cmd|\.exe)?\s+/i

/**
 * First word of a command with any directory prefix and quotes removed.
 *
 * A quoted executable path may contain spaces (`"C:\Program Files\Git\cmd\git.exe"`),
 * so quotes are consumed before looking for the first delimiter.
 *
 * @param {string} command
 * @returns {string} lowercase executable name, or '' when none can be read
 */
export function firstToken(command) {
  const trimmed = command.trimStart()
  const quote = trimmed[0]
  let raw
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1)
    raw = end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)
  } else {
    const match = /^[^\s]+/.exec(trimmed)
    raw = match === null ? '' : match[0]
  }
  if (raw === '') return ''
  const token = raw.replace(/\\/g, '/')
  return token.slice(token.lastIndexOf('/') + 1).toLowerCase()
}

/**
 * Whether a command is already an RTK invocation (so rewriting it would nest).
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isRtkCommand(command) {
  return RTK_COMMAND.test(command)
}

/**
 * Decide whether this command is a rewrite candidate.
 *
 * Rejects multi-line scripts, oversized input, commands already routed through
 * RTK, blocked first tokens, and anything outside the allowlist.
 *
 * @param {string} command
 * @param {{ allowed?: Set<string>, blocked?: Set<string> }} [options]
 * @returns {boolean}
 */
export function shouldRewrite(command, { allowed = DEFAULT_ALLOWED, blocked = NONE } = {}) {
  if (typeof command !== 'string') return false
  if (command.length === 0 || command.length > 4000) return false
  if (command.includes('\n') || command.includes('\r')) return false
  if (isRtkCommand(command)) return false
  const head = firstToken(command)
  if (head === '' || blocked.has(head)) return false
  return allowed.has(head)
}
