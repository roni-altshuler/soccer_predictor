'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const WORLD_CUP_START_UTC = Date.UTC(2026, 5, 11, 0, 0, 0)
const WORLD_CUP_FINAL_UTC = Date.UTC(2026, 6, 19, 0, 0, 0)

type TimeLeft = {
  days: number
  hours: number
  minutes: number
  seconds: number
  started: boolean
  finished: boolean
}

function getTimeLeft(now = Date.now()): TimeLeft {
  const target = now < WORLD_CUP_START_UTC ? WORLD_CUP_START_UTC : WORLD_CUP_FINAL_UTC
  const diff = Math.max(0, target - now)

  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1_000),
    started: now >= WORLD_CUP_START_UTC,
    finished: now >= WORLD_CUP_FINAL_UTC,
  }
}

function CountdownTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[64px] rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2 text-center">
      <p className="text-xl font-black tabular-nums text-[var(--text-primary)]">{String(value).padStart(2, '0')}</p>
      <p className="text-[9px] uppercase tracking-normal text-[var(--text-tertiary)]">{label}</p>
    </div>
  )
}

export default function WorldCupCountdown({ compact = false }: { compact?: boolean }) {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft())

  useEffect(() => {
    const interval = window.setInterval(() => setTimeLeft(getTimeLeft()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const statusText = timeLeft.finished
    ? 'Tournament complete'
    : timeLeft.started
      ? 'Final countdown'
      : 'Opening day countdown'

  return (
    <section className={`${compact ? '' : 'max-w-3xl mx-auto px-4 pt-3 pb-2'}`}>
      <div className="fm-surface overflow-hidden">
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-normal text-[var(--text-tertiary)] font-semibold">{statusText}</p>
              <h2 className="mt-1 text-lg md:text-xl font-black text-[var(--text-primary)]">FIFA World Cup 2026</h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Opens Jun 11, 2026. Final on Jul 19, 2026.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">USA</span>
              <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">Canada</span>
              <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">Mexico</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="grid grid-cols-4 gap-2">
            <CountdownTile label="Days" value={timeLeft.days} />
            <CountdownTile label="Hours" value={timeLeft.hours} />
            <CountdownTile label="Min" value={timeLeft.minutes} />
            <CountdownTile label="Sec" value={timeLeft.seconds} />
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-[var(--text-tertiary)]">
              World Cup fixtures use the `fifa.world` pipeline and the global fallback when tournament sample size is limited.
            </p>
            <Link
              href="/leagues/fifa.world"
              className="inline-flex items-center justify-center rounded-lg border border-[var(--accent-primary)]/40 px-3 py-2 text-xs font-semibold text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10"
            >
              View World Cup hub
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
