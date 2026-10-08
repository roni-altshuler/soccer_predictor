// Browser QA only. Exercise the real SSR team adapter with the already
// committed sparse ESPN excerpt; prevent server-side provider requests.
const { readFileSync } = require('node:fs')
const excerpt = JSON.parse(readFileSync('backend/tests/fixtures/espn/761660_scheduled_excerpt.json', 'utf8'))
const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return original(input, init)
  const id = url.pathname.match(/\/teams\/(\d+)/)?.[1]
  const team = excerpt.rosters.find((row) => row.team.id === id)?.team
  if (url.pathname.endsWith('/roster')) return Response.json({ athletes: [] })
  if (url.pathname.endsWith('/schedule')) return Response.json({ events: [] })
  if (team) return Response.json({ team })
  return Response.json({}, { status: 404 })
}
