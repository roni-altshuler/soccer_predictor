import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { installHydrationDiagnostics, productionMismatchTarget } from './hydration_ci_diagnostics.mjs'

const fixture = 'var parent=null,cursor=null,hydrating=!1,pending=null,root=!1,sentinel=Error(code(519));function mismatch(fiber){var error=Error(code(418,1));throw error}'

for (const failureStage of ['init-script', 'cdp-session']) for (const failedPage of [1, 2]) {
  test(`${failureStage} failure on page ${failedPage} survives the other page succeeding`, async () => {
    const directory = await mkdtemp(`${tmpdir()}/hydration-coverage-`), previous = process.cwd()
    try {
      await mkdir(`${directory}/.next/static/chunks`, { recursive: true })
      await writeFile(`${directory}/.next/static/chunks/renderer-fixture.js`, fixture)
      process.chdir(directory)
      let created = 0, installed = 0
      const context = {
        async newPage() {
          const id = ++created
          return { id, on() {}, async addInitScript() {
            if (id === failedPage && failureStage === 'init-script') throw Error('private-fixture-token')
          } }
        },
        async newCDPSession(page) {
          if (page.id === failedPage && failureStage === 'cdp-session') throw Error('private-fixture-token')
          return { on() {}, async send(method) { if (method === 'Debugger.setBreakpointByUrl') installed++ } }
        },
      }
      const browser = { version: () => '148.0.7778.96', async newContext() { return context } }
      const observer = await installHydrationDiagnostics(browser, { out: directory, base: 'http://localhost' })
      const observed = await browser.newContext()
      await observed.newPage()
      await observed.newPage()
      const data = await observer.flush(), saved = await readFile(`${directory}/ci-hydration-browser.json`, 'utf8')
      assert.equal(installed, 1)
      assert.equal(data.capture, 'unavailable')
      assert.equal(data.failedPageCount, 1)
      assert.deepEqual(data.failedPages, [{ page: failedPage, document: 0, stage: failureStage }])
      assert.deepEqual(JSON.parse(saved), data)
      assert(!saved.includes('private-fixture-token'))
    } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }) }
  })
}

for (const cyclic of [false, true]) {
  test(`ancestry traversal stops after 64 steps through ${cyclic ? 'cyclic' : 'deep'} non-host fibers`, () => {
    let traversals = 0, captured
    const nonHost = { type: () => null }
    Object.defineProperty(nonHost, 'return', { get() { traversals++; return cyclic || traversals < 1000 ? nonHost : null } })
    const target = productionMismatchTarget(fixture, 'renderer-fixture.js')
    const verdict = runInNewContext(target.condition, {
      __pitchverseHydrationMismatch(value) { captured = JSON.parse(value) },
      cursor: { nodeName: 'SPAN', parentNode: { nodeName: 'BODY' } },
      fiber: { type: 'a', tag: 5, return: nonHost }, location: { href: 'http://localhost/evaluation' },
      innerWidth: 390, innerHeight: 960, performance: { now: () => 1 }, window: {},
    }, { timeout: 100 })
    assert.equal(verdict, false)
    assert.equal(traversals, 64)
    assert.deepEqual(captured.ancestry, [])
  })
}

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
