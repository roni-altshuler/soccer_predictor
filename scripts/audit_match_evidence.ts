/** Reproduce the UI's archive audit without provider access or model execution. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { matchEvidence, scoreEvidence, validEvidenceDate } from '../src/lib/matchEvidence'
import { SERVED_COMPETITION_IDS } from '../src/lib/leagueAccents'
import { readPredictionArchive } from '../src/lib/server/recordedForecast'

async function main() {
  const args = process.argv.slice(2)
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (!['--as-of', '--from'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: npx tsx scripts/audit_match_evidence.ts --as-of YYYY-MM-DD --from YYYY-MM-DD')
    options.set(args[i], args[i + 1])
  }
  const asOf = options.get('--as-of'), from = options.get('--from')
  if (!validEvidenceDate(asOf) || !validEvidenceDate(from) || from > asOf || asOf > new Date().toISOString().slice(0, 10) || Date.parse(asOf) - Date.parse(from) > 366 * 86400000) throw new Error('Use a valid UTC window through today, at most 366 days.')
  const archive = await readPredictionArchive()
  const files = [...new Set(archive.entries.map((e) => e.source))].sort()
  const hashes = await Promise.all(files.map(async (file) => ({ file, sha256: createHash('sha256').update(await readFile(`backend/data/predictions/${file}`)).digest('hex') })))
  const leagues = SERVED_COMPETITION_IDS.map((leagueId) => {
    const d = matchEvidence(archive.entries, leagueId, 'M', asOf, from, archive.failedFiles)
    return { leagueId, available: d.available, counts: d.counts, matches: d.records.length,
      latestMatchDate: d.records.filter((r) => r.result).map((r) => r.date).sort().at(-1) ?? null,
      models: [...new Set(d.records.map((r) => r.model))].sort(), scores: scoreEvidence(d.records) }
  })
  console.log(JSON.stringify({ basis: 'Descriptive current-file archive audit; no training-cutoff verification, immutable historical reconstruction, paired market comparison or improvement claim.', asOf, from, gender: 'M', sourceFiles: hashes, failedFiles: archive.failedFiles, leagues }, null, 2))
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
