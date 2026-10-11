import { lstat, readFile, readdir } from 'node:fs/promises'
import { failureSummary } from './lib/hydration_failure_summary.mjs'

const directories = process.env.QA_OUT ? [process.env.QA_OUT] : ['/tmp/pitchverse-product-quality', '/tmp/pitchverse-evaluation-hydration', '/tmp/pitchverse-match-evidence-hydration']
const artifactSha = /^[a-f0-9]{64}$/.test(process.env.QA_ARTIFACT_SHA ?? '') ? process.env.QA_ARTIFACT_SHA : null
let logged = 0
let remaining = 32768
function emit(line) {
  const size = Buffer.byteLength(`${line}\n`)
  if (size > remaining) return false
  console.log(line)
  remaining -= size
  return true
}
emit(`HYDRATION_DIAGNOSTIC ${JSON.stringify({ artifactSha, basis: 'Allowlisted local fixture diagnostics; no raw page, query, storage, console or stack payload.' })}`)
directories: for (const directory of directories) {
  let files
  try { files = await readdir(directory) } catch { continue }
  for (const file of files.sort()) {
    if (logged >= 12) break
    if (!/^(record|evidence)-(browser|failed)-(light-|dark-)?(390|768|1440)\.json$/.test(file) && file !== 'ci-hydration-browser.json') continue
    const path = `${directory}/${file}`, stat = await lstat(path)
    if (!stat.isFile() || stat.size > 1048576) continue
    const bytes = await readFile(path)
    let diagnostic
    try { diagnostic = JSON.parse(bytes) } catch {
      if (!emit('HYDRATION_DIAGNOSTIC {"capture":"invalid-json"}')) break directories
      logged++
      continue
    }
    const summary = failureSummary({ bytes, diagnostic, file })
    if (file !== 'ci-hydration-browser.json' && !summary.failure && !summary.errors.length) continue
    const line = `HYDRATION_DIAGNOSTIC ${JSON.stringify(summary)}`
    if (!emit(line)) { emit('HYDRATION_DIAGNOSTIC {"limit":"32KiB"}'); break directories }
    logged++
  }
}
