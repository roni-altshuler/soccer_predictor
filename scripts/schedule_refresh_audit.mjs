import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { checkScheduleRefresh } from './lib/schedule_refresh_checks.mjs'

const port = process.env.QA_PORT || '3110'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-schedule-refresh'
let server, browser
try {
  await mkdir(out, { recursive: true })
  if (!process.env.QA_BASE) {
    assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port occupied')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
    const deadline = Date.now() + 60000
    while (true) {
      if (await fetch(base).then((r) => r.ok, () => false)) break
      assert(Date.now() < deadline && server.exitCode === null, 'Production server did not start')
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  const report = await checkScheduleRefresh({ browser, base, out, before: process.env.QA_SCHEDULE_BEFORE === '1' })
  console.log(`Schedule refresh replay passed: ${report.states.length} states; forecasts unchanged`)
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
