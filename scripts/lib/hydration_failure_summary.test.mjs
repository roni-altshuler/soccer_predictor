import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { failureSummary, fixtureRoute, mismatchSummary, runtimeSummary } from './hydration_failure_summary.mjs'

test('summarizes error-time context and hashes the exact retained bytes', () => {
  const diagnostic = { width: 1440, state: 'retained', failure: { message: 'page.waitForFunction: Timeout 30000ms exceeded.' },
    browserEvents: [{ message: 'Minified React error #418', url: 'http://127.0.0.1:3100/evaluation?token=never-log',
      width: 1440, state: 'empty', observedAt: '2026-10-11T10:00:00.250Z',
      documentRequest: { id: 3 }, snapshot: { documentTimeOrigin: Date.parse('2026-10-11T10:00:00Z') } }] }
  const bytes = Buffer.from(JSON.stringify(diagnostic, null, 2))
  const summary = failureSummary({ bytes, diagnostic, file: 'record-failed-light-1440.json' })
  assert.equal(summary.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(summary.failure, 'timeout')
  assert.deepEqual(summary.errors[0], { code: 'react-hydration-mismatch', route: '/evaluation', elapsedMs: 250,
    width: 1440, phase: 'empty', document: 3, nodes: [], components: [] })
  assert(!JSON.stringify(summary).includes('never-log'))
})

test('never prints arbitrary page content, attrs, stack, query, storage or console arguments', () => {
  const secret = 'private-person@example.test bearer-private-value'
  const diagnostic = { runtime: { node: secret, browser: secret, next: secret, bundledReact: secret },
    head: secret, storage: { token: secret }, snapshot: { body: secret },
    browserEvents: [{ message: `Hydration failed because ${secret}\n <ThemeToggle token="${secret}">\n+ <a href="${secret}">\n- <script>${secret}`,
      stack: secret, arguments: [secret], phase: secret, url: `https://private.example/${secret}` }],
    mismatches: [{ route: `http://localhost/evaluation?email=${secret}`, expected: 'a', actual: 'span',
      cursorParent: 'body', fiber: 5, ancestry: ['body', secret], text: secret, innerHTML: secret,
      mutations: [{ kind: 'attribute', target: 'html', attribute: 'class', value: secret },
        { kind: secret, target: secret, node: secret, attribute: secret }] }] }
  const summary = failureSummary({ bytes: Buffer.from('fixture'), diagnostic, file: secret })
  const text = JSON.stringify(summary)
  assert(!text.includes('private')); assert(!text.includes('bearer')); assert(!text.includes('storage'))
  assert.deepEqual(summary.errors[0].nodes, [{ side: 'expected', node: 'a' }, { side: 'actual', node: 'script' }])
  assert.deepEqual(summary.errors[0].components, ['ThemeToggle'])
  assert.equal(summary.file, null)
  assert.equal(summary.mismatches[0].route, '/evaluation')
  assert.deepEqual(summary.mismatches[0].ancestry, ['body'])
})

test('bounds events and mutation history, rejects non-finite timing and unknown node types', () => {
  const diagnostic = { mismatches: Array.from({ length: 100 }, () => ({
    elapsedMs: Infinity, width: -1, height: 999999, expected: '<private-element>', actual: '#text', fiber: 100,
    mutations: Array.from({ length: 100 }, (_, elapsedMs) => ({ elapsedMs, kind: 'added', target: 'head', node: 'script' })),
  })) }
  const summary = failureSummary({ bytes: Buffer.from('bounded'), diagnostic, file: 'ci-hydration-browser.json' })
  assert.equal(summary.mismatches.length, 4)
  const event = summary.mismatches[0]
  assert.equal(event.mutations.length, 16); assert.equal(event.mutations[0].elapsedMs, 84)
  assert.equal(event.elapsedMs, null); assert.equal(event.width, null); assert.equal(event.height, null)
  assert.equal(event.expected, null); assert.equal(event.actual, '#text'); assert.equal(event.fiber, null)
})

test('keeps only known fixture routes and runtime versions', () => {
  assert.equal(fixtureRoute('http://localhost/leagues/eng.1/evidence?team=private&asOf=2026-10-11'), '/leagues/eng.1/evidence')
  assert.equal(fixtureRoute('http://localhost/matches/123456'), '/matches/:fixture')
  for (const url of ['https://external/evaluation', 'http://localhost/private-user', 'http://localhost/auth/token', 'data:secret']) assert.equal(fixtureRoute(url), null)
  assert.deepEqual(runtimeSummary({ node: 'v20.20.2', browser: '148.0.7778.96', next: '15.5.7', bundledReact: '19.2.0-canary-0bdb9206-20250818' }),
    { node: 'v20.20.2', browser: '148.0.7778.96', next: '15.5.7', bundledReact: '19.2.0-canary-0bdb9206-20250818' })
  assert.equal(runtimeSummary({ node: 'v20.1.0-secret' }).node, null)
  assert.equal(mismatchSummary(null).route, null)
  assert.deepEqual(runtimeSummary(null), { node: null, browser: null, next: null, bundledReact: null })
})

test('CLI emits sanitized evidence and digests while refusing symlinks and oversized files', async () => {
  const directory = await mkdtemp(`${tmpdir()}/hydration-log-contract-`)
  try {
    const secret = 'private-person@example.test bearer-do-not-log'
    const diagnostic = { failure: { message: 'Timeout 30000ms exceeded.' }, browserEvents: [{
      message: `Minified React error #418 ${secret}`, url: `http://localhost/evaluation?token=${secret}`, width: 1440,
    }] }
    const bytes = JSON.stringify(diagnostic)
    await writeFile(`${directory}/record-failed-light-1440.json`, bytes)
    await writeFile(`${directory}/private.json`, secret)
    await symlink(`${directory}/private.json`, `${directory}/evidence-failed-390.json`)
    await writeFile(`${directory}/record-failed-dark-390.json`, 'x'.repeat(1048577))
    const sha = 'a'.repeat(64)
    const result = spawnSync(process.execPath, ['scripts/log_hydration_failure.mjs'], {
      env: { ...process.env, QA_OUT: directory, QA_ARTIFACT_SHA: sha }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert(!result.stdout.includes(secret)); assert(!result.stdout.includes('private.json'))
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line.slice('HYDRATION_DIAGNOSTIC '.length)))
    assert.equal(lines.length, 2); assert.equal(lines[0].artifactSha, sha)
    assert.equal(lines[1].sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(lines[1].failure, 'timeout'); assert.equal(lines[1].errors[0].route, '/evaluation')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
