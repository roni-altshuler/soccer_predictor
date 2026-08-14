/**
 * The port of `norm_team` in build_canonical.py, which produced the crest keys.
 *
 * It has to agree with the Python character for character or a club silently
 * loses its badge, so it mirrors the same four steps: NFKD, drop combining
 * marks, lowercase, punctuation to spaces, then drop the structural tokens in
 * `NOISE` — the same frozenset, in the same order.
 *
 * The punctuation class is Unicode-aware (`\p{L}`) rather than `[^a-z]`, which
 * is not a detail: `[^a-z]` deletes the Turkish dotless i, so `Kasımpaşa`
 * normalises to `kas mpasa` here and `kasimpasa` in Python, and Kasımpaşa
 * loses its badge. Every such club is Turkish, which is exactly the kind of
 * bug that survives a review done in English.
 *
 * It lives in its own module rather than inside `TeamCrest` because the server
 * needs it too: joining a bracket tie to an ESPN fixture is a name join, and it
 * is only survivable through this normalisation — see `tieFixtures.ts`.
 */

const NOISE = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'us', 'ud', 'cd', 'rc', 'rcd',
  'sv', 'tsv', 'vfl', 'vfb', 'fsv', 'bsc', 'sd', 'ca', 'club', 'de', 'the',
  'calcio', 'futbol', 'football', 'futebol', 'kv', 'rsc', 'kaa', 'sk', 'if',
])

export function normTeam(name: string): string {
  if (!name) return ''
  const stripped = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = stripped.split(' ').filter((t) => t && !NOISE.has(t))
  return (tokens.length ? tokens : stripped.split(' ')).join(' ')
}
