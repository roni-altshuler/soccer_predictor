// Deliberately corrupt one SSR anchor. This is a diagnostic positive control,
// not a production-gate retry or an application hydration fix.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { installHydrationDiagnostics } from './lib/hydration_ci_diagnostics.mjs'
import { failureSummary } from './lib/hydration_failure_summary.mjs'

const out = process.env.QA_OUT || '/tmp/pitchverse-hydration-control'
const port = process.env.QA_PORT || '3135', base = `http://127.0.0.1:${port}`
assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536)
assert.equal(await fetch(base).then(() => true, () => false), false, 'Control port occupied')
await mkdir(out, { recursive: true })
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
let browser, observer
try {
  const deadline = Date.now() + 30000
  while (!await fetch(base).then((r) => r.ok, () => false)) {
    assert.equal(server.exitCode, null, 'Control server exited')
    assert(Date.now() < deadline, 'Control server startup timeout')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  observer = await installHydrationDiagnostics(browser, { out, base })
  const context = await browser.newContext({ viewport: { width: 390, height: 960 }, serviceWorkers: 'block' })
  await context.addInitScript(() => { delete Object.getPrototypeOf(navigator).serviceWorker })
  const page = await context.newPage(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let corrupted = false
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.fulfill({ body: '' })
    if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false } })
    if (route.request().isNavigationRequest()) {
      const response = await route.fetch(), body = await response.text()
      const changed = body.replace(/<a\b[^>]*href="#main"[^>]*>Skip to main content<\/a>/, '<span>Diagnostic fixture</span>')
      corrupted = changed !== body
      return route.fulfill({ response, body: changed })
    }
    return route.continue()
  })
  await page.goto(`${base}/evaluation`, { waitUntil: 'networkidle' })
  assert(corrupted, 'SSR fixture anchor absent')
  assert(errors.some((error) => error.includes('React error #418')), 'Positive control did not surface #418')
  const data = await observer.flush()
  assert.equal(data.capture, 'supported')
  assert(data.mismatches.some((event) => event.expected === 'a' && event.actual === 'span' && event.cursorParent === 'body'))
  const file = 'ci-hydration-browser.json', bytes = await readFile(`${out}/${file}`)
  console.log(`HYDRATION_POSITIVE_CONTROL ${JSON.stringify(failureSummary({ bytes, diagnostic: data, file }))}`)
  await writeFile(`${out}/control-result.json`, JSON.stringify({ intentionalSsrCorruption: true, capturedExpected: 'a', capturedActual: 'span', browserError418Observed: true }, null, 2))
  await context.close()
} finally {
  await observer?.flush()
  await browser?.close()
  server.kill('SIGTERM')
}
