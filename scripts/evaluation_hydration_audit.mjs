// One existing 96-state replay, with the unminified development component stack.
// Production remains the release gate; a development pass does not clear it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { checkRecordReliability } from './lib/record_reliability_checks.mjs'

const port = process.env.QA_PORT || '3133'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-evaluation-hydration'
await mkdir(out, { recursive: true })
let browser, server
try {
  if (!process.env.QA_BASE) {
    assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536, 'Invalid QA_PORT')
    assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port is occupied')
    const log = createWriteStream(`${out}/development-server.log`)
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false })
    server.on('close', () => log.end())
    const deadline = Date.now() + 60_000
    while (!await fetch(`${base}/api/v1/evaluation`).then((response) => response.ok, () => false)) {
      assert.equal(server.exitCode, null, 'Development server exited')
      assert(Date.now() < deadline, 'Development server did not start')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  await checkRecordReliability({ browser, base, out })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
