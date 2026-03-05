'use client'

interface HighlightsLinkProps {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  date: string
  league: string
  status: string
}

/** YouTube highlights link button — generates a search URL for extended match highlights */
export default function HighlightsLink({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  date,
  league,
  status,
}: HighlightsLinkProps) {
  const isFinished = status === 'STATUS_FINAL'
  if (!isFinished) return null

  const scoreText = homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : ''
  const searchQuery = encodeURIComponent(
    `${homeTeam} vs ${awayTeam} ${scoreText} highlights ${league} ${new Date(date).getFullYear()}`
  )
  const youtubeUrl = `https://www.youtube.com/results?search_query=${searchQuery}`

  // Also try a direct search with common highlight channel names
  const extendedQuery = encodeURIComponent(
    `${homeTeam} ${homeScore}-${awayScore} ${awayTeam} extended highlights`
  )
  const extendedUrl = `https://www.youtube.com/results?search_query=${extendedQuery}`

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--muted-bg)' }}>
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#FF0000">
          <path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 00.5 6.19 31.56 31.56 0 000 12a31.56 31.56 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.56 31.56 0 0024 12a31.56 31.56 0 00-.5-5.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/>
        </svg>
        Highlights
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.02]"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,0,0,0.1)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000">
              <path d="M9.75 15.02V8.98L15.5 12l-5.75 3.02z"/>
              <path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 00.5 6.19 31.56 31.56 0 000 12a31.56 31.56 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.56 31.56 0 0024 12a31.56 31.56 0 00-.5-5.81z" opacity="0.2"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Match Highlights
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              {homeTeam} {scoreText} {awayTeam}
            </p>
          </div>
          <svg className="flex-shrink-0 ml-auto" width="14" height="14" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
        </a>

        <a
          href={extendedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.02]"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,0,0,0.08)' }}
          >
            <span className="text-base">🎬</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Extended Highlights
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              Full match recap
            </p>
          </div>
          <svg className="flex-shrink-0 ml-auto" width="14" height="14" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
        </a>
      </div>
    </div>
  )
}
