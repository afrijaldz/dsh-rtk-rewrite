import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRewriter, resolveRtkPath, routeThroughRtk, rtkEnvironment } from '../lib/rtk.js'

function fakeExecFile(behaviour, calls) {
  return (file, args, options, callback) => {
    calls?.push({ file, args, options })
    behaviour(args[1], callback)
  }
}

test('resolveRtkPath prefers an explicit path and rejects missing ones', () => {
  assert.equal(resolveRtkPath({ rtkPath: 'C:\\nope\\rtk.exe', env: {} }), undefined)
  const dir = mkdtempSync(join(tmpdir(), 'rtk-path-'))
  const exe = join(dir, process.platform === 'win32' ? 'rtk.exe' : 'rtk')
  writeFileSync(exe, '')
  assert.equal(resolveRtkPath({ rtkPath: exe, env: {} }), exe)
})

test('resolveRtkPath falls back to RTK_BIN and PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtk-path-'))
  const exe = join(dir, process.platform === 'win32' ? 'rtk.exe' : 'rtk')
  writeFileSync(exe, '')
  assert.equal(resolveRtkPath({ env: { RTK_BIN: exe, PATH: '' } }), exe)
  assert.equal(resolveRtkPath({ env: { PATH: dir } }), exe)
  assert.equal(resolveRtkPath({ env: { PATH: '' } }), undefined)
})

test('rtkEnvironment redirects state only when a data directory is given', () => {
  const inherited = rtkEnvironment(undefined, { PATH: 'x' })
  assert.equal(inherited.RTK_DB_PATH, undefined)
  const redirected = rtkEnvironment('C:\\data', { PATH: 'x' })
  assert.match(redirected.RTK_DB_PATH, /history\.db$/)
  assert.match(redirected.RTK_CONFIG_DIR, /config$/)
  assert.match(redirected.RTK_RECALL_DB, /recall\.db$/)
  assert.match(redirected.RTK_TEE_DIR, /tee$/)
  assert.equal(redirected.RTK_SUPPRESS_HOOK_WARNING, '1')
})

test('rewriter accepts exit codes 0 and 3 and rejects the rest', async () => {
  const cases = [
    [{ code: 3 }, 'rtk git status', 'rtk git status'],
    [null, 'rtk git status\n', 'rtk git status'],
    [{ code: 1 }, '', ''],
    [{ code: 2 }, 'denied', ''],
    [{ code: 'ENOENT' }, 'rtk git status', ''],
  ]
  for (const [error, stdout, expected] of cases) {
    const rewrite = createRewriter({
      rtkPath: 'C:\\rtk.exe',
      execFileImpl: fakeExecFile((_command, callback) => callback(error, stdout)),
    })
    assert.equal(await rewrite('git status'), expected)
  }
})

test('rewriter caches results per command', async () => {
  const calls = []
  const rewrite = createRewriter({
    rtkPath: 'C:\\rtk.exe',
    execFileImpl: fakeExecFile((_command, callback) => callback({ code: 3 }, 'rtk git status'), calls),
  })
  assert.equal(await rewrite('git status'), 'rtk git status')
  assert.equal(await rewrite('git status'), 'rtk git status')
  assert.equal(calls.length, 1)
})

test('rewriter passes the data environment and command through', async () => {
  const calls = []
  const rewrite = createRewriter({
    rtkPath: 'C:\\rtk.exe',
    dataDir: 'C:\\data',
    execFileImpl: fakeExecFile((_command, callback) => callback({ code: 1 }, ''), calls),
  })
  await rewrite('git status')
  assert.equal(calls[0].file, 'C:\\rtk.exe')
  assert.deepEqual(calls[0].args, ['rewrite', 'git status'])
  assert.match(calls[0].options.env.RTK_DB_PATH, /history\.db$/)
})

test('rewriter is a no-op without a resolved binary', async () => {
  const calls = []
  const rewrite = createRewriter({
    rtkPath: undefined,
    execFileImpl: fakeExecFile(() => {}, calls),
  })
  assert.equal(await rewrite('git status'), '')
  assert.equal(calls.length, 0)
})

test('routeThroughRtk names the executable so rtk need not be on PATH', () => {
  assert.equal(
    routeThroughRtk('rtk git status', 'C:\\Program Files\\rtk\\rtk.exe'),
    '"C:/Program Files/rtk/rtk.exe" git status',
  )
  assert.equal(routeThroughRtk('rtk cargo test --all', 'C:\\rtk\\rtk.exe'), '"C:/rtk/rtk.exe" cargo test --all')
})

test('routeThroughRtk only rewrites a leading rtk token', () => {
  assert.equal(routeThroughRtk('rtk.exe git diff rtk', 'C:\\rtk\\rtk.cmd'), '"C:/rtk/rtk.cmd" git diff rtk')
  assert.equal(routeThroughRtk('rtkish git status', 'C:\\rtk\\rtk.exe'), 'rtkish git status')
  assert.equal(routeThroughRtk('git status', 'C:\\rtk\\rtk.exe'), 'git status')
})

test('routeThroughRtk is a no-op without an executable', () => {
  assert.equal(routeThroughRtk('rtk git status', undefined), 'rtk git status')
  assert.equal(routeThroughRtk('rtk git status', ''), 'rtk git status')
})
