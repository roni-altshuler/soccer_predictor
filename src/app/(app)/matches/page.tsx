'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, BrainCircuit, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';

import { AsyncSection, LeagueChip, SectionHeader, StatCard } from '@/components/primitives';
import { EmptyState } from '@/components/EmptyState';
import { MatchRow, MatchRowList, type MatchRowMatch } from '@/components/match/MatchRow';
import { leagueFlagUrls } from '@/data/leagues';
import { useGenderQuery } from '@/hooks/useGenderQuery';

const MENS_LEAGUES = [
  { id: 'eng.1', name: 'Premier League', country: 'England', flagCode: 'ENG' },
  { id: 'esp.1', name: 'La Liga', country: 'Spain', flagCode: 'ES' },
  { id: 'ita.1', name: 'Serie A', country: 'Italy', flagCode: 'IT' },
  { id: 'ger.1', name: 'Bundesliga', country: 'Germany', flagCode: 'DE' },
  { id: 'fra.1', name: 'Ligue 1', country: 'France', flagCode: 'FR' },
  { id: 'ned.1', name: 'Eredivisie', country: 'Netherlands', flagCode: 'NL' },
  { id: 'por.1', name: 'Primeira Liga', country: 'Portugal', flagCode: 'PT' },
  { id: 'usa.1', name: 'MLS', country: 'USA', flagCode: 'US' },
  { id: 'uefa.champions', name: 'Champions League', country: 'Europe', flagCode: 'EU' },
  { id: 'uefa.europa', name: 'Europa League', country: 'Europe', flagCode: 'EU' },
  { id: 'uefa.europa.conf', name: 'Conference League', country: 'Europe', flagCode: 'EU' },
  { id: 'fifa.world', name: 'World Cup 2026', country: 'USA/MEX/CAN', flagCode: 'WORLD' },
  { id: 'uefa.euro', name: 'UEFA European Championship', country: 'Europe', flagCode: 'EU' },
  { id: 'conmebol.america', name: 'Copa America', country: 'South America', flagCode: 'SA' },
];

// Women's universe — mirrors backend/services/data/espn_loader.py WOMEN_COMPETITIONS.
// IDs route directly to ESPN's women's scoreboard / standings endpoints.
const WOMENS_LEAGUES = [
  { id: 'eng.w.1',        name: "FA Women's Super League", country: 'England', flagCode: 'ENG' },
  { id: 'usa.nwsl',       name: 'NWSL', country: 'USA', flagCode: 'US' },
  { id: 'uefa.wchampions',name: "UEFA Women's Champions League", country: 'Europe', flagCode: 'EU' },
  { id: 'uefa.weuro',     name: "UEFA Women's European Championship", country: 'Europe', flagCode: 'EU' },
  { id: 'fifa.wwc',       name: "FIFA Women's World Cup", country: 'World', flagCode: 'WORLD' },
];

const REGIONS = [
  { label: 'All', filter: () => true },
  { label: 'England', filter: (l: typeof MENS_LEAGUES[0]) => l.id === 'eng.1' },
  { label: 'Europe', filter: (l: typeof MENS_LEAGUES[0]) => ['esp.1','ita.1','ger.1','fra.1','ned.1','por.1'].includes(l.id) },
  { label: 'UEFA', filter: (l: typeof MENS_LEAGUES[0]) => l.id.startsWith('uefa.') },
  { label: 'Americas', filter: (l: typeof MENS_LEAGUES[0]) => ['usa.1','fifa.world','conmebol.america'].includes(l.id) },
];

/** Competitions contested by national teams — rows resolve to country flags. */
const NATIONAL_TEAM_COMPETITIONS = new Set([
  'fifa.world', 'fifa.wwc', 'fifa.friendly', 'fifa.friendly.w',
  'uefa.euro', 'uefa.weuro', 'uefa.nations',
  'conmebol.america', 'concacaf.gold', 'caf.nations', 'afc.asian.cup',
]);

interface Standing {
  position: number; team: string; played: number; won: number; drawn: number;
  lost: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number;
}
interface GroupStanding { groupName: string; teams: Standing[] }

interface EspnStandingStat { name?: string; value?: number }
interface EspnStandingEntry { team?: { displayName?: string }; stats?: EspnStandingStat[] }
interface EspnStandingsChild { name?: string; standings?: { entries?: EspnStandingEntry[] } }

function espnStat(entry: EspnStandingEntry, name: string): number {
  const value = entry.stats?.find((s) => s.name === name)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function espnStandingEntry(entry: EspnStandingEntry, idx: number): Standing {
  return {
    position: espnStat(entry, 'rank') || idx + 1,
    team: entry.team?.displayName || '',
    played: espnStat(entry, 'gamesPlayed'),
    won: espnStat(entry, 'wins'),
    drawn: espnStat(entry, 'ties'),
    lost: espnStat(entry, 'losses'),
    goalsFor: espnStat(entry, 'pointsFor'),
    goalsAgainst: espnStat(entry, 'pointsAgainst'),
    goalDifference: espnStat(entry, 'pointDifferential'),
    points: espnStat(entry, 'points'),
  };
}

interface TodayApiMatch {
  id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  time?: string;
  status: string;
  minute?: number | string | null;
  league?: string;
  leagueId?: string;
  venue?: string;
  home_crest_url?: string | null;
  away_crest_url?: string | null;
  ai_home_prob?: number | null;
  ai_draw_prob?: number | null;
  ai_away_prob?: number | null;
  ai_confidence?: number | null;
  predicted_scoreline?: string | null;
}

interface TodayLeagueGroup {
  name: string;
  leagueId?: string;
  matches: TodayApiMatch[];
}

function toMatchRow(m: TodayApiMatch): MatchRowMatch {
  return {
    id: m.id,
    home_team: m.home_team,
    away_team: m.away_team,
    home_score: m.home_score,
    away_score: m.away_score,
    time: m.time,
    status: m.status,
    minute: m.minute ?? null,
    venue: m.venue ?? null,
    home_crest_url: m.home_crest_url ?? null,
    away_crest_url: m.away_crest_url ?? null,
    is_national: m.leagueId ? NATIONAL_TEAM_COMPETITIONS.has(m.leagueId) : false,
    ai_home_prob: m.ai_home_prob ?? null,
    ai_draw_prob: m.ai_draw_prob ?? null,
    ai_away_prob: m.ai_away_prob ?? null,
    ai_confidence: m.ai_confidence ?? null,
    predicted_scoreline: m.predicted_scoreline ?? null,
  };
}

/* ── Today's fixtures, grouped by league ─────────────────────────────── */

function TodaySection({ groups, loading, error, onRetry }: {
  groups: TodayLeagueGroup[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <section className="space-y-4">
      <SectionHeader
        kicker="Fixtures"
        title="Today"
        description={todayLabel}
      />
      <AsyncSection
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={groups.length === 0}
        section="today's fixtures"
        emptyState={
          <EmptyState
            illustration="no-matches"
            title="No fixtures today"
            description="None of the covered competitions play today. Browse a competition below for its full schedule."
          />
        }
      >
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.name}
              className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-3 py-2">
                <LeagueChip
                  leagueId={group.leagueId}
                  name={group.name}
                  size="sm"
                  href={group.leagueId ? `/leagues/${group.leagueId}` : undefined}
                  className="border-transparent bg-transparent"
                />
                <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
                  {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
                </span>
              </div>
              <MatchRowList className="px-1 py-1">
                {group.matches.map((m) => (
                  <MatchRow
                    key={m.id}
                    match={toMatchRow(m)}
                    href={`/matches/${m.id}${m.leagueId ? `?league=${m.leagueId}` : ''}`}
                  />
                ))}
              </MatchRowList>
            </div>
          ))}
        </div>
      </AsyncSection>
    </section>
  );
}

/* ── ESPN-backed fixtures & results for one league (day-grouped) ─────── */

interface LeagueFixture extends MatchRowMatch {
  id: string;
  dateKey: string;
}

function formatEspnDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function dayDividerLabel(dateKey: string): string {
  try {
    const todayKey = new Date().toISOString().split('T')[0];
    const label = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return dateKey === todayKey ? `Today · ${label}` : label;
  } catch {
    return dateKey;
  }
}

function LeagueFixtures({ leagueId }: { leagueId: string }) {
  const [fixtures, setFixtures] = useState<LeagueFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showAllResults, setShowAllResults] = useState(false);
  const isNational = NATIONAL_TEAM_COMPETITIONS.has(leagueId);

  useEffect(() => {
    let cancelled = false;
    const fetchWindow = async () => {
      setLoading(true);
      setError(null);
      try {
        const start = new Date();
        start.setDate(start.getDate() - 10);
        const end = new Date();
        end.setDate(end.getDate() + 21);
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/scoreboard?dates=${formatEspnDate(start)}-${formatEspnDate(end)}`
        );
        if (!res.ok) throw new Error(`Provider returned ${res.status}`);
        const data = await res.json();
        const rows: LeagueFixture[] = [];
        for (const event of data.events || []) {
          const competition = event.competitions?.[0];
          const home = competition?.competitors?.find((c: { homeAway?: string }) => c.homeAway === 'home');
          const away = competition?.competitors?.find((c: { homeAway?: string }) => c.homeAway === 'away');
          if (!home || !away) continue;
          const statusType: string = competition?.status?.type?.name || 'STATUS_SCHEDULED';
          let status: MatchRowMatch['status'] = 'scheduled';
          let minute: number | undefined;
          if (statusType === 'STATUS_FINAL' || statusType === 'STATUS_FULL_TIME') {
            status = 'finished';
          } else if (statusType === 'STATUS_IN_PROGRESS' || statusType.includes('HALF')) {
            status = 'live';
            const clock = parseInt(competition?.status?.displayClock ?? '', 10);
            if (Number.isFinite(clock)) minute = clock;
          }
          const started = status !== 'scheduled';
          const dateKey = event.date ? new Date(event.date).toISOString().split('T')[0] : '';
          if (!dateKey) continue;
          rows.push({
            id: String(event.id),
            dateKey,
            home_team: home.team?.displayName || home.team?.shortDisplayName || '',
            away_team: away.team?.displayName || away.team?.shortDisplayName || '',
            home_score: started ? parseInt(home.score ?? '0', 10) : null,
            away_score: started ? parseInt(away.score ?? '0', 10) : null,
            time: event.date,
            status,
            minute: minute ?? null,
            venue: competition?.venue?.fullName ?? null,
            home_crest_url: home.team?.logo ?? null,
            away_crest_url: away.team?.logo ?? null,
            is_national: isNational,
          });
        }
        if (!cancelled) setFixtures(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load fixtures');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchWindow();
    return () => { cancelled = true; };
  }, [leagueId, retry, isNational]);

  const todayKey = new Date().toISOString().split('T')[0];
  const upcomingDays = useMemo(() => {
    const days = new Map<string, LeagueFixture[]>();
    for (const f of fixtures) {
      if (f.dateKey < todayKey) continue;
      if (!days.has(f.dateKey)) days.set(f.dateKey, []);
      days.get(f.dateKey)!.push(f);
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [fixtures, todayKey]);

  const resultDays = useMemo(() => {
    const days = new Map<string, LeagueFixture[]>();
    for (const f of fixtures) {
      if (f.dateKey >= todayKey || f.status !== 'finished') continue;
      if (!days.has(f.dateKey)) days.set(f.dateKey, []);
      days.get(f.dateKey)!.push(f);
    }
    return [...days.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [fixtures, todayKey]);

  const visibleResultDays = showAllResults ? resultDays : resultDays.slice(0, 3);

  const renderDayGroup = ([dateKey, dayMatches]: [string, LeagueFixture[]]) => (
    <div key={dateKey}>
      <div className="flex items-center gap-3 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {dayDividerLabel(dateKey)}
        </span>
        <span className="h-px flex-1 bg-[var(--border-color)]" aria-hidden />
      </div>
      <MatchRowList>
        {dayMatches.map((m) => (
          <MatchRow key={m.id} match={m} href={`/matches/${m.id}?league=${leagueId}`} />
        ))}
      </MatchRowList>
    </div>
  );

  return (
    <AsyncSection
      loading={loading}
      error={error}
      onRetry={() => setRetry((r) => r + 1)}
      empty={upcomingDays.length === 0 && resultDays.length === 0}
      section="fixtures"
      emptyState={
        <EmptyState
          illustration="no-matches"
          title="No fixtures in this window"
          description="Nothing scheduled in the three weeks ahead and no results in the ten days behind."
        />
      }
    >
      <div className="space-y-8">
        {upcomingDays.length > 0 && (
          <section className="space-y-2">
            <SectionHeader title="Fixtures" description="Next three weeks" />
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] py-1">
              {upcomingDays.map(renderDayGroup)}
            </div>
          </section>
        )}
        {resultDays.length > 0 && (
          <section className="space-y-2">
            <SectionHeader title="Results" description="Last ten days" />
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] py-1">
              {visibleResultDays.map(renderDayGroup)}
            </div>
            {resultDays.length > 3 && !showAllResults && (
              <button
                onClick={() => setShowAllResults(true)}
                className="w-full min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              >
                Load more results
              </button>
            )}
          </section>
        )}
      </div>
    </AsyncSection>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function MatchesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const leagueParam = searchParams.get('league');
  const { gender, withParam } = useGenderQuery();
  const LEAGUES = useMemo(() => (gender === 'women' ? WOMENS_LEAGUES : MENS_LEAGUES), [gender]);
  const initialLeague = leagueParam ? LEAGUES.find((l) => l.id === leagueParam) : null;

  const [selectedLeague, setSelectedLeague] = useState<typeof MENS_LEAGUES[0] | null>(initialLeague);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [groupStandings, setGroupStandings] = useState<GroupStanding[]>([]);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [activeTab, setActiveTab] = useState<'fixtures' | 'standings'>('fixtures');
  const [regionFilter, setRegionFilter] = useState('All');

  const [todayGroups, setTodayGroups] = useState<TodayLeagueGroup[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayRetry, setTodayRetry] = useState(0);

  const handleSelectLeague = (league: typeof MENS_LEAGUES[0]) => {
    router.push(`/leagues/${league.id}`);
  };

  // Today's fixtures across all covered competitions — one source of truth
  // shared with the Match Centre home (`/api/todays_matches`).
  useEffect(() => {
    let cancelled = false;
    const fetchToday = async () => {
      setTodayLoading(true);
      setTodayError(null);
      try {
        const res = await fetch(withParam('/api/todays_matches'), { cache: 'no-store' });
        if (!res.ok) throw new Error(`Fixtures feed returned ${res.status}`);
        const data = await res.json();
        const rawGroups: Array<{ name: string; matches: TodayApiMatch[] }> = data.leagues || [];
        const groups: TodayLeagueGroup[] = rawGroups
          .filter((g) => Array.isArray(g.matches) && g.matches.length > 0)
          .map((g) => ({
            name: g.name,
            leagueId: g.matches[0]?.leagueId,
            matches: g.matches,
          }));
        if (!cancelled) setTodayGroups(groups);
      } catch (e) {
        if (!cancelled) setTodayError(e instanceof Error ? e.message : 'Failed to load fixtures');
      } finally {
        if (!cancelled) setTodayLoading(false);
      }
    };
    fetchToday();
    return () => { cancelled = true; };
  }, [withParam, todayRetry]);

  const todayCount = useMemo(
    () => todayGroups.reduce((n, g) => n + g.matches.length, 0),
    [todayGroups]
  );

  const retryToday = useCallback(() => setTodayRetry((r) => r + 1), []);

  // Fetch standings
  useEffect(() => {
    if (!selectedLeague) return;
    const fetchStandings = async () => {
      setLoadingStandings(true);
      try {
        const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${selectedLeague.id}/standings`);
        if (res.ok) {
          const data = await res.json();
          const children: EspnStandingsChild[] = data.children || [];
          if (children.length > 1 || (children.length === 1 && children[0].name?.toLowerCase().includes('group'))) {
            const groups: GroupStanding[] = children.map((child) => ({
              groupName: child.name || 'Group',
              teams: (child.standings?.entries || [])
                .map(espnStandingEntry)
                .sort((a, b) => a.position - b.position),
            }));
            setGroupStandings(groups);
            setStandings([]);
          } else {
            const entries = children[0]?.standings?.entries || [];
            setStandings(
              entries.map(espnStandingEntry).sort((a, b) => a.position - b.position)
            );
            setGroupStandings([]);
          }
        }
      } catch (e) { console.error('Error fetching standings:', e); }
      finally { setLoadingStandings(false); }
    };
    fetchStandings();
  }, [selectedLeague]);

  const region = REGIONS.find(r => r.label === regionFilter) || REGIONS[0];
  const filteredLeagues = LEAGUES.filter(region.filter);

  /* ── League Selector View ── */
  if (!selectedLeague) {
    return (
      <div className="min-h-screen bg-[var(--background)]">
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-12 space-y-10">
          {/* Hero band — compact page lead-in per the Broadcast anatomy */}
          <section className="hero-band surface-elevated px-5 py-5 md:px-7 md:py-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  {gender === 'women' ? "Women's football" : "Men's football"}
                </p>
                <h1 className="mt-1 text-h2 font-bold text-[var(--text-primary)]">Matches</h1>
                <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">
                  Fixtures, results and model leans across every competition Pitchwise covers.
                </p>
              </div>
              <StatCard
                label="Fixtures today"
                value={todayLoading ? '…' : todayCount}
                accent="primary"
                size="sm"
                className="w-36"
              />
            </div>
          </section>

          {/* Today's fixtures, grouped by league */}
          <TodaySection
            groups={todayGroups}
            loading={todayLoading}
            error={todayError}
            onRetry={retryToday}
          />

          {/* All competitions directory */}
          <section className="space-y-4">
            <SectionHeader
              kicker="Browse"
              title="All competitions"
              description="Open a competition for fixtures, standings and model coverage."
            />

            {/* Region filter — segmented control */}
            <div
              className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-0.5"
              role="group"
              aria-label="Filter competitions by region"
              style={{ scrollbarWidth: 'none' }}
            >
              {REGIONS.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRegionFilter(r.label)}
                  aria-pressed={regionFilter === r.label}
                  className={`flex-shrink-0 min-h-[40px] rounded-md px-3.5 text-xs font-semibold transition-colors ${
                    regionFilter === r.label
                      ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* League directory */}
            <div className="space-y-1.5">
              {filteredLeagues.map((league) => (
                <button
                  key={league.id}
                  onClick={() => handleSelectLeague(league)}
                  className="w-full flex items-center gap-3 px-4 min-h-[52px] py-2.5 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] hover:bg-[var(--card-hover)] hover:border-[var(--border-hover)] transition-colors text-left group"
                >
                  {leagueFlagUrls[league.flagCode] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={leagueFlagUrls[league.flagCode]} alt="" width={24} height={18} className="w-6 h-auto rounded-sm" />
                  ) : (
                    <Trophy className="h-5 w-5 text-[var(--text-tertiary)]" aria-hidden />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">{league.name}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{league.country}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent-primary)] group-hover:translate-x-0.5 transition-all" aria-hidden />
                </button>
              ))}
            </div>

            {/* AI Predict CTA */}
            <Link href="/predict" className="block">
              <div className="flex items-center gap-3 px-4 min-h-[52px] py-2.5 rounded-xl bg-[var(--accent-ai)]/10 border border-[var(--accent-ai)]/30 hover:border-[var(--accent-ai)] transition-colors">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-ai)]/20 flex items-center justify-center">
                  <BrainCircuit className="h-4 w-4 text-[var(--accent-ai)]" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--accent-ai)]">AI Match Predictor</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">Predict any matchup with our 66-feature neural ensemble</p>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--accent-ai)]" aria-hidden />
              </div>
            </Link>
          </section>
        </div>
      </div>
    );
  }

  /* ── League Detail View ── */
  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* League Header */}
      <div className="bg-[var(--card-bg)] border-b border-[var(--border-color)]">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <button
            onClick={() => { setSelectedLeague(null); router.push('/matches'); }}
            className="flex items-center gap-1.5 min-h-[40px] -ml-2 px-2 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-hover)] mb-1 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            All leagues
          </button>
          <div className="flex items-center gap-3">
            <LeagueChip leagueId={selectedLeague.id} name={selectedLeague.name} active size="md" />
            <p className="flex-1 text-xs text-[var(--text-tertiary)]">{selectedLeague.country}</p>
            <Link
              href={`/leagues/${selectedLeague.id}`}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-[var(--accent-primary)] px-3.5 text-xs font-semibold text-[var(--accent-on-primary)] transition-opacity hover:opacity-90"
            >
              Full page
            </Link>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-4 -mb-px">
            {(['fixtures', 'standings'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 min-h-[44px] text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  activeTab === t
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t === 'fixtures' ? 'Fixtures & Results' : 'Standings'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {activeTab === 'fixtures' ? (
          <LeagueFixtures leagueId={selectedLeague.id} />
        ) : loadingStandings ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : groupStandings.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groupStandings.map((group) => (
              <div key={group.groupName} className="bg-[var(--card-bg)] rounded-lg overflow-hidden border border-[var(--border-color)]">
                <div className="px-3 py-2 bg-[var(--muted-bg)] border-b border-[var(--border-color)]">
                  <span className="text-xs font-bold text-[var(--text-primary)]">{group.groupName}</span>
                </div>
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                      <th className="text-left py-1.5 px-2">#</th>
                      <th className="text-left py-1.5 px-2">Team</th>
                      <th className="text-center py-1.5 px-1">P</th>
                      <th className="text-center py-1.5 px-1">GD</th>
                      <th className="text-center py-1.5 px-1.5 font-bold">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.teams.map((team, idx) => (
                      <tr key={team.team} className={`border-b border-[var(--border-color)] hover:bg-[var(--card-hover)] ${idx < 2 ? 'border-l-2 border-l-[var(--accent-primary)]' : ''}`}>
                        <td className="py-1.5 px-2 text-[var(--text-tertiary)]">{idx + 1}</td>
                        <td className="py-1.5 px-2 text-[var(--text-primary)] font-medium truncate max-w-[100px]">{team.team}</td>
                        <td className="py-1.5 px-1 text-center text-[var(--text-secondary)]">{team.played}</td>
                        <td className="py-1.5 px-1 text-center text-[var(--text-secondary)]">{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</td>
                        <td className="py-1.5 px-1.5 text-center text-[var(--text-primary)] font-bold">{team.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : standings.length > 0 ? (
          <div className="bg-[var(--card-bg)] rounded-lg overflow-hidden border border-[var(--border-color)]">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-[var(--text-tertiary)] border-b border-[var(--border-color)] bg-[var(--muted-bg)]">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Team</th>
                  <th className="text-center py-2 px-1">P</th>
                  <th className="text-center py-2 px-1">W</th>
                  <th className="text-center py-2 px-1">D</th>
                  <th className="text-center py-2 px-1">L</th>
                  <th className="text-center py-2 px-1">GD</th>
                  <th className="text-center py-2 px-1.5 font-bold">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((team, idx) => (
                  <tr key={team.team} className={`border-b border-[var(--border-color)] hover:bg-[var(--card-hover)] transition-colors ${idx < 4 ? 'border-l-2 border-l-[var(--accent-primary)]' : idx >= standings.length - 3 ? 'border-l-2 border-l-[var(--accent-loss)]' : ''}`}>
                    <td className="py-2 px-2 text-[var(--text-tertiary)]">{team.position}</td>
                    <td className="py-2 px-2 text-[var(--text-primary)] font-medium">{team.team}</td>
                    <td className="py-2 px-1 text-center text-[var(--text-secondary)]">{team.played}</td>
                    <td className="py-2 px-1 text-center text-[var(--text-secondary)]">{team.won}</td>
                    <td className="py-2 px-1 text-center text-[var(--text-secondary)]">{team.drawn}</td>
                    <td className="py-2 px-1 text-center text-[var(--text-secondary)]">{team.lost}</td>
                    <td className="py-2 px-1 text-center text-[var(--text-secondary)]">{team.goalDifference > 0 ? '+' : ''}{team.goalDifference}</td>
                    <td className="py-2 px-1.5 text-center text-[var(--text-primary)] font-bold">{team.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 flex gap-4 text-[10px] text-[var(--text-tertiary)] bg-[var(--muted-bg)] border-t border-[var(--border-color)]">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[var(--accent-primary)] rounded-sm" /><span>Champions League</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[var(--accent-loss)] rounded-sm" /><span>Relegation</span></div>
            </div>
          </div>
        ) : (
          <EmptyState
            illustration="data-error"
            title="No standings available"
            description="The provider has no table for this competition right now."
          />
        )}
      </div>
    </div>
  );
}

export default function MatchesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <MatchesContent />
    </Suspense>
  );
}
