import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { observeBrowserFailures } from './browser_failure_evidence.mjs'

test('retains the browser stack and console diff when the document has already closed', async () => {
  const page = new EventEmitter()
  page.url = () => 'http://localhost/evaluation'
  page.evaluate = async () => { throw new Error('Page closed') }
  const observer = observeBrowserFailures(page)
  const failure = new Error('Hydration failed')
  page.emit('pageerror', failure)
  page.emit('console', { type: () => 'error', text: () => 'Hydration diff', args: () => [
    { evaluate: async (read) => read(failure) },
    { evaluate: async (read) => read('+ <style>\n- <script>') },
  ] })
  const events = await observer.flush()
  assert.equal(events.length, 2)
  assert.equal(events[0].stack, failure.stack)
  assert.deepEqual(events[1].arguments, [failure.stack, '+ <style>\n- <script>'])
  assert(events.every((event) => event.snapshot === null))
})

test('records intentional HTTP failures too and waits for asynchronous argument reads', async () => {
  const page = new EventEmitter()
  page.url = () => 'http://localhost/evaluation'
  page.evaluate = async () => ({ storage: { current: 'dark', legacy: 'light' }, osDark: false })
  const observer = observeBrowserFailures(page)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  page.emit('console', { type: () => 'error', text: () => 'Failed to load resource: 503', args: () => [
    { evaluate: async () => { await gate; return '503' } },
  ] })
  page.emit('console', { type: () => 'warning', text: () => 'Warning', args: () => [] })
  release()
  const events = await observer.flush()
  assert.equal(events.length, 1)
  assert.equal(events[0].message, 'Failed to load resource: 503')
  assert.deepEqual(events[0].arguments, ['503'])
  assert.deepEqual(events[0].snapshot, { storage: { current: 'dark', legacy: 'light' }, osDark: false })
})

test('preserves error-time state and document identity when a later assertion runs in another state', async () => {
  const page = new EventEmitter(), frame = {}
  page.mainFrame = () => frame
  page.url = () => 'http://localhost/evaluation'
  let release, state = 'loading'
  const gate = new Promise((resolve) => { release = resolve })
  let snapshotStarted = false
  page.evaluate = async () => { snapshotStarted = true; await gate; return { documentTimeOrigin: 123 } }
  const observer = observeBrowserFailures(page, () => ({ state, theme: 'dark', width: 768 }))
  page.emit('request', { isNavigationRequest: () => true, frame: () => frame, url: page.url })
  state = 'empty'
  page.emit('pageerror', new Error('Original hydration mismatch'))
  assert.equal(snapshotStarted, true)
  state = 'error'
  release()
  const [event] = await observer.flush()
  assert.equal(event.state, 'empty')
  assert.equal(event.documentRequest.state, 'loading')
  assert.equal(event.documentRequest.id, 1)
  assert.equal(event.url, page.url())
  assert.equal(event.snapshot.documentTimeOrigin, 123)
  assert(!Number.isNaN(Date.parse(event.observedAt)))
})

test('distinguishes two held hard navigations to the same evidence URL', async () => {
  const page = new EventEmitter(), frame = {}
  page.mainFrame = () => frame
  page.url = () => 'http://localhost/leagues/eng.1/evidence?gender=M'
  let phase = 'held-date', timeOrigin = 100
  page.evaluate = async () => ({ documentTimeOrigin: timeOrigin })
  const observer = observeBrowserFailures(page, () => ({ state: 'ready', hold: true, phase }))
  const navigate = () => page.emit('request', { isNavigationRequest: () => true, frame: () => frame, url: page.url })
  navigate()
  page.emit('pageerror', new Error('First navigation mismatch'))
  phase = 'held-gender'; timeOrigin = 200
  navigate()
  page.emit('pageerror', new Error('Second navigation mismatch'))
  const [first, second] = await observer.flush()
  assert.equal(first.url, second.url)
  assert.equal(first.phase, 'held-date')
  assert.equal(second.phase, 'held-gender')
  assert.equal(first.documentRequest.phase, 'held-date')
  assert.equal(second.documentRequest.phase, 'held-gender')
  assert.deepEqual([first.documentRequest.id, second.documentRequest.id], [1, 2])
  assert.deepEqual([first.snapshot.documentTimeOrigin, second.snapshot.documentTimeOrigin], [100, 200])
})
