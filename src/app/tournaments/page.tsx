'use client'

import Link from 'next/link'
import { ChevronRight, Medal } from 'lucide-react'

import { BorderBeam } from '@/components/magicui/border-beam'
import { MagicCard } from '@/components/magicui/magic-card'
import { Spotlight } from '@/components/magicui/spotlight'
import { Card } from '@/components/ui/card'
import { useGenderPreference } from '@/hooks/useGenderPreference'

interface TournamentTile {
  id: string
  name: string
  region: string
  gender: 'M' | 'F' | 'both'
  /** True when the bracket route should be shown (otherwise we point at the league standings). */
  hasBracket: boolean
  featured?: boolean
}

const TOURNAMENTS: TournamentTile[] = [
  { id: 'uefa.champions', name: 'UEFA Champions League', region: 'Europe', gender: 'M', hasBracket: true, featured: true },
  { id: 'uefa.europa', name: 'UEFA Europa League', region: 'Europe', gender: 'M', hasBracket: true },
  { id: 'uefa.conference', name: 'UEFA Conference League', region: 'Europe', gender: 'M', hasBracket: true },
  { id: 'uefa.euro', name: 'UEFA European Championship', region: 'Europe', gender: 'M', hasBracket: true },
  { id: 'fifa.world', name: 'FIFA World Cup', region: 'World', gender: 'M', hasBracket: true, featured: true },
  { id: 'conmebol.america', name: 'Copa América', region: 'South America', gender: 'M', hasBracket: true },
  { id: 'fifa.world.w', name: 'FIFA Women’s World Cup', region: 'World', gender: 'F', hasBracket: true, featured: true },
  { id: 'uefa.wchampions', name: 'UEFA Women’s Champions League', region: 'Europe', gender: 'F', hasBracket: true },
  { id: 'uefa.weuro', name: 'UEFA Women’s Euro', region: 'Europe', gender: 'F', hasBracket: true },
]

export default function TournamentsIndexPage() {
  const { gender } = useGenderPreference()
  const filter = gender === 'women' ? 'F' : 'M'
  const visible = TOURNAMENTS.filter((t) => t.gender === filter || t.gender === 'both')
  const featured = visible.filter((t) => t.featured)
  const rest = visible.filter((t) => !t.featured)

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      <Spotlight className="block rounded-2xl" size={460} color="color-mix(in srgb, var(--accent-primary) 16%, transparent)">
        <Card className="relative overflow-hidden p-6">
          <BorderBeam size={1} duration={11} borderRadius={16} />
          <div className="relative z-10 flex flex-col items-start gap-2">
            <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              {gender === 'women' ? "Women's" : "Men's"} football
            </p>
            <h1 className="text-display font-extrabold tracking-tight text-[var(--text-primary)]">
              Tournaments
            </h1>
            <p className="max-w-xl text-small text-[var(--text-secondary)]">
              Live brackets, group stages, and AI-projected paths to the final. Tap any tournament for the full picture.
            </p>
          </div>
        </Card>
      </Spotlight>

      {featured.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-3 text-h3 text-[var(--text-primary)]">Featured now</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {featured.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.id}`}>
                <MagicCard className="overflow-hidden">
                  <div className="flex items-center gap-3 p-5">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
                      <Medal className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-h4 text-[var(--text-primary)]">{t.name}</p>
                      <p className="text-caption uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                        {t.region}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
                  </div>
                </MagicCard>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="mb-3 text-h3 text-[var(--text-primary)]">All tournaments</h2>
        <Card className="divide-y divide-[var(--border-color)] overflow-hidden">
          {rest.map((t) => (
            <Link
              key={t.id}
              href={`/tournaments/${t.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted-bg)]/50"
            >
              <Medal className="h-4 w-4 text-[var(--accent-primary)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small text-[var(--text-primary)]">{t.name}</p>
                <p className="text-caption text-[var(--text-tertiary)]">{t.region}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
            </Link>
          ))}
        </Card>
      </section>
    </div>
  )
}
