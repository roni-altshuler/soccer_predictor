import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { productionMismatchTarget } from './hydration_ci_diagnostics.mjs'

test('derives the locked renderer cursor and exact position without hardcoding its chunk hash', () => {
  const source = '// fixture\nvar parent=null,cursor=null,hydrating=!1,pending=null,root=!1,sentinel=Error(code(519));function mismatch(fiber){var error=Error(code(418,1));throw error}'
  const target = productionMismatchTarget(source, 'renderer-abcdef.js')
  assert.equal(target.lineNumber, 1)
  assert.equal(source.split('\n')[1].slice(target.columnNumber, target.columnNumber + 3), 'var')
  assert(target.condition.includes('cursor?.nodeName'))
  assert(target.condition.includes('fiber.type'))
  assert.equal(target.rendererSha256, createHash('sha256').update(source).digest('hex'))
  assert(!/outerHTML|innerHTML|textContent|localStorage/.test(target.condition))
  assert(target.condition.endsWith(',false)'))
})

test('refuses unsupported renderer layouts instead of guessing scope variables', () => {
  for (const source of ['', 'function mismatch(f){throw Error(418)}', 'var a=null,b=null;function mismatch(f){var error=Error(code(418,1))}']) {
    assert.equal(productionMismatchTarget(source, 'unknown.js'), null)
  }
})
