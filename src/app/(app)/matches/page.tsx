'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MatchCalendar from '@/components/match/MatchCalendar';
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

interface Standing {
  position: number; team: string; played: number; won: number; drawn: number;
  lost: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number;
}
interface GroupStanding { groupName: string; teams: Standing[] }

function MatchesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const leagueParam = searchParams.get('league');
  const { gender } = useGenderQuery();
  const LEAGUES = useMemo(() => (gender === 'women' ? WOMENS_LEAGUES : MENS_LEAGUES), [gender]);
  const initialLeague = leagueParam ? LEAGUES.find((l) => l.id === leagueParam) : null;

  const [selectedLeague, setSelectedLeague] = useState<typeof MENS_LEAGUES[0] | null>(initialLeague);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [groupStandings, setGroupStandings] = useState<GroupStanding[]>([]);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [activeTab, setActiveTab] = useState<'fixtures' | 'standings'>('fixtures');
  const [regionFilter, setRegionFilter] = useState('All');

  const handleSelectLeague = (league: typeof MENS_LEAGUES[0]) => {
    router.push(`/leagues/${league.id}`);
  };

  // Fetch standings
  useEffect(() => {
    if (!selectedLeague) return;
    const fetchStandings = async () => {
      setLoadingStandings(true);
      try {
        const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${selectedLeague.id}/standings`);
        if (res.ok) {
          const data = await res.json();
          const children = data.children || [];
          if (children.length > 1 || (children.length === 1 && children[0].name?.toLowerCase().includes('group'))) {
            const groups: GroupStanding[] = children.map((child: any) => ({
              groupName: child.name || 'Group',
              teams: (child.standings?.entries || []).map((e: any, idx: number) => ({
                position: e.stats?.find((s: any) => s.name === 'rank')?.value || idx + 1,
                team: e.team?.displayName || '',
                played: e.stats?.find((s: any) => s.name === 'gamesPlayed')?.value || 0,
                won: e.stats?.find((s: any) => s.name === 'wins')?.value || 0,
                drawn: e.stats?.find((s: any) => s.name === 'ties')?.value || 0,
                lost: e.stats?.find((s: any) => s.name === 'losses')?.value || 0,
                goalsFor: e.stats?.find((s: any) => s.name === 'pointsFor')?.value || 0,
                goalsAgainst: e.stats?.find((s: any) => s.name === 'pointsAgainst')?.value || 0,
                goalDifference: e.stats?.find((s: any) => s.name === 'pointDifferential')?.value || 0,
                points: e.stats?.find((s: any) => s.name === 'points')?.value || 0,
              })).sort((a: Standing, b: Standing) => a.position - b.position),
            }));
            setGroupStandings(groups);
            setStandings([]);
          } else {
            const entries = children[0]?.standings?.entries || [];
            setStandings(entries.map((e: any) => ({
              position: e.stats?.find((s: any) => s.name === 'rank')?.value || 0,
              team: e.team?.displayName || '',
              played: e.stats?.find((s: any) => s.name === 'gamesPlayed')?.value || 0,
              won: e.stats?.find((s: any) => s.name === 'wins')?.value || 0,
              drawn: e.stats?.find((s: any) => s.name === 'ties')?.value || 0,
              lost: e.stats?.find((s: any) => s.name === 'losses')?.value || 0,
              goalsFor: e.stats?.find((s: any) => s.name === 'pointsFor')?.value || 0,
              goalsAgainst: e.stats?.find((s: any) => s.name === 'pointsAgainst')?.value || 0,
              goalDifference: e.stats?.find((s: any) => s.name === 'pointDifferential')?.value || 0,
              points: e.stats?.find((s: any) => s.name === 'points')?.value || 0,
            })).sort((a: Standing, b: Standing) => a.position - b.position));
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
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
          {/* Region filter chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-3 mb-4" style={{ scrollbarWidth: 'none' }}>
            {REGIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRegionFilter(r.label)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  regionFilter === r.label
                    ? 'bg-[var(--accent-primary)] text-black'
                    : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* League Grid */}
          <div className="space-y-1">
            {filteredLeagues.map((league) => (
              <button
                key={league.id}
                onClick={() => handleSelectLeague(league)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-all text-left group"
              >
                {leagueFlagUrls[league.flagCode] ? (
                  <img src={leagueFlagUrls[league.flagCode]} alt="" className="w-6 h-auto rounded-sm" />
                ) : (
                  <span className="text-lg">🏆</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">{league.name}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">{league.country}</p>
                </div>
                <svg className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent-primary)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>

          {/* AI Predict CTA */}
          <Link href="/predict" className="block mt-6">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--accent-ai)]/10 border border-[var(--accent-ai)]/30 hover:border-[var(--accent-ai)] transition-colors">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-ai)]/20 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ai)" strokeWidth="2">
                  <path d="M12 2v4" /><path d="m15.5 7.5 2.8-2.8" /><path d="M20 12h-4" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--accent-ai)]">AI Match Predictor</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">Predict any matchup with our 66-feature neural ensemble</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ai)" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>
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
            className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] mb-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All leagues
          </button>
          <div className="flex items-center gap-3">
            {leagueFlagUrls[selectedLeague.flagCode] ? (
              <img src={leagueFlagUrls[selectedLeague.flagCode]} alt="" className="w-8 h-auto rounded" />
            ) : (
              <span className="text-2xl">🏆</span>
            )}
            <div className="flex-1">
              <h1 className="text-lg font-bold text-[var(--text-primary)]">{selectedLeague.name}</h1>
              <p className="text-xs text-[var(--text-tertiary)]">{selectedLeague.country}</p>
            </div>
            <Link
              href={`/leagues/${selectedLeague.id}`}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-primary)] text-black hover:opacity-90 transition-opacity"
            >
              Full Page
            </Link>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-4 -mb-px">
            {(['fixtures', 'standings'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
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
      <div className="max-w-3xl mx-auto px-4 py-4">
        {activeTab === 'fixtures' ? (
          <MatchCalendar leagueId={selectedLeague.id} leagueName={selectedLeague.name} />
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
                <table className="w-full text-xs">
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
            <table className="w-full text-xs">
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
          <div className="text-center py-12 text-[var(--text-tertiary)]">
            <span className="text-3xl mb-3 block">📊</span>
            <p className="text-sm">No standings available</p>
          </div>
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
