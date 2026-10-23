import assert from 'node:assert/strict'
import test from 'node:test'
import { firstToken, isRtkCommand, shouldRewrite } from '../lib/policy.js'

test('firstToken reads the executable and strips paths and quotes', () => {
  assert.equal(firstToken('git status'), 'git')
  assert.equal(firstToken('  "C:\\Program Files\\Git\\cmd\\git.exe" status'), 'git.exe')
  assert.equal(firstToken('/usr/bin/cargo test'), 'cargo')
  assert.equal(firstToken('Get-ChildItem'), 'get-childitem')
  assert.equal(firstToken(''), '')
})

test('isRtkCommand detects an existing RTK invocation', () => {
  assert.equal(isRtkCommand('rtk git status'), true)
  assert.equal(isRtkCommand('RTK.CMD git status'), true)
  assert.equal(isRtkCommand('git status'), false)
})

test('shouldRewrite accepts allowlisted CLIs', () => {
  assert.equal(shouldRewrite('git status'), true)
  assert.equal(shouldRewrite('cargo test'), true)
  assert.equal(shouldRewrite('pytest -q'), true)
})

test('shouldRewrite rejects PowerShell aliases and unknown commands', () => {
  assert.equal(shouldRewrite('ls -la'), false)
  assert.equal(shouldRewrite('cat AGENTS.md'), false)
  assert.equal(shouldRewrite('Get-ChildItem'), false)
  assert.equal(shouldRewrite('echo hi'), false)
})

test('shouldRewrite rejects non-candidates', () => {
  assert.equal(shouldRewrite(''), false)
  assert.equal(shouldRewrite('rtk git status'), false)
  assert.equal(shouldRewrite('git status\ngit log'), false)
  assert.equal(shouldRewrite('git ' + 'x'.repeat(4000)), false)
})

test('shouldRewrite honors custom allow and block lists', () => {
  const allowed = new Set(['mycli'])
  assert.equal(shouldRewrite('mycli run', { allowed }), true)
  assert.equal(shouldRewrite('git status', { allowed }), false)
  const blocked = new Set(['git'])
  assert.equal(shouldRewrite('git status', { blocked }), false)
})

test('pipelines pass policy but are left to RTK to decline', () => {
  assert.equal(shouldRewrite('git status | Select-String foo'), true)
})
