# Component dependency map

Cluster-level import graph for `src/components/`, derived from `grep -rE "from '@/components/..."`. Read top→bottom: lower layers don't import upper ones.

## Layer 0 — Atoms (no internal deps)

```
ui/                  shadcn primitives — Button, Card, Tabs, Dialog, Sheet, Tooltip, Badge,
                     Progress, Avatar, Skeleton, ScrollArea, Separator, DropdownMenu, Toast,
                     Command, AnimatedCounter
                     ↳ depends only on @radix-ui/*, lib/utils (cn)

magicui/             15 polish primitives — BorderBeam, Marquee, NumberTicker, ShimmerButton,
                     MagicCard, AnimatedGradientText, PulsatingButton, AvatarCircles, Spotlight,
                     OrbitingCircles, AnimatedBeam, NeonGradientCard, BentoGrid+BentoCard,
                     DotPattern, GridPattern
                     ↳ depends on framer-motion, lib/utils

primitives/          ConfidencePill, LiveBadge, PlayerAvatar, TeamBadge
                     ↳ depends on ui/, lucide-react, useHeadshotManifest (PlayerAvatar only)

skeletons/           Loading state shells
                     ↳ depends on ui/Skeleton
```

## Layer 1 — Feature primitives

```
charts/              MomentumChart, WinProbabilityChart, XGShotMap, XGTimelineChart,
                     ScorelineHeatmap, SimulationDistributionChart, FormSparkline + theme.ts
                     ↳ depends on recharts, theme.ts (useChartTheme reads CSS vars), ui/

cards/               BentoStatCard, MatchCard, PlayerCard, StatCard, TeamCard
                     ↳ depends on ui/Card, primitives/, lib/leagueAccents

shell/               AppShell, SidebarNav, TopBar, MobileBottomNav, CommandPalette + Footer
                     ↳ depends on ui/, magicui/Marquee, cmdk, lucide-react

home/                HeroSpotlight, LiveTickerBar, NewsStrip + ...
                     ↳ depends on ui/, magicui/, primitives/, cards/MatchCard,
                       hooks/useGenderQuery
```

## Layer 2 — Feature surfaces

```
match/               (18 files — largest cluster, imported in 22 sites)
                     MatchRow, LeagueSection, MatchCenterHeader, MatchCard, MatchDetail*,
                     ConfidenceIndicator, TeamFormPill, LeagueBadge, SplitStatBar,
                     MatchMomentum (legacy SVG — Phase 2 will defer to charts/MomentumChart),
                     MatchEventHeatmap, KeyMatchFactors, AIPredictionTab, HighlightsLink,
                     HeadToHeadDisplay, LiveScoreTicker, LiveMatchTracker
                     ↳ depends on ui/, primitives/, charts/, lib/leagueAccents, hooks/useMatches,
                       hooks/useMomentum

lineup/              FormationDisplay, PitchBackground
                     ↳ depends on ui/, primitives/PlayerAvatar
                     ⚠ Phase 2.C: team-tint props + pitch-line CSS vars + RatingPill overlay

prediction/          PredictionResult (flagship), PredictionCard, PredictHero, SeasonSimulator
                     ↳ depends on ui/, charts/, primitives/ConfidencePill, hooks/usePredictions

accuracy/            AccuracyHero, CalibrationPlot (custom SVG), ConfusionHeatmap (custom SVG),
                     RecentPicksFeed, ModelExplainer
                     ↳ depends on ui/, magicui/NumberTicker, framer-motion, theme.ts

league/              LeagueHeader, LeagueStandings, LeagueFixtures
                     ↳ depends on ui/, primitives/TeamBadge, hooks/useGenderQuery

knockout/            KnockoutBracket, KnockoutSimulator
tournament/, worldcup/   bracket variants
                     ↳ depends on ui/, charts/SimulationDistributionChart, hooks/useTournament

weather/, referee/, tracking/   leaf surfaces
                     ↳ depend on ui/, primitives/

(root)               GenderToggle, ThemeToggle, EmptyState, DataSourceBadge, PageLoader,
                     AuthModal, LeagueStats, MLMetricsVisualizations,
                     GoalsDistributionChart, ResultDistributionChart
                     ↳ depends on ui/, lib/utils, hooks/useGenderPreference
                     ⚠ Phase 0.C: emoji cleanup targets in Footer, LeagueStats,
                       MLMetricsVisualizations
                     ⚠ Phase 4: GoalsDistributionChart + ResultDistributionChart
                       still use hardcoded hex — migrate to charts/theme.ts useChartTheme
```

## Hooks → Library

```
hooks/useGenderQuery       — 16 sites — appends ?gender= to every fetch
hooks/useGenderPreference  —  5 sites — localStorage 'fotpredict.gender'
hooks/useHeadshotManifest  —  2 sites — primitives/PlayerAvatar + future ShotMap labels
hooks/useMomentum          —  1 site  — charts/MomentumChart
hooks/usePredictions       —  N       — match detail, predict, accuracy
hooks/useMatches, useTeam, usePlayer, useSimulation, useTournament

lib/utils (cn)             — 72 sites (the most imported module in the repo)
lib/api                    —  4 sites — typed fetch clients
lib/leagueAccents          —  3 sites — competition_id → brand color
lib/serverSyncStore        —  4 sites — server-side persistence helpers
```

## Key cross-cluster patterns

1. **Bottom-up token flow.** Every visual cluster reads CSS variables via `charts/theme.ts` (`useChartTheme()` re-evaluates on `class` mutation) or inline `var(--…)` references. No cluster hard-codes a brand color — except the two legacy Recharts wrappers flagged above.

2. **Gender-aware fetch boundary.** Anything that fetches data MUST go through `useGenderQuery().withParam(url)`. Missing the wrapper is the most common reason "women's universe looks broken on this page." When auditing for Phase 4, grep for fetch() / SWR keys that don't pass through useGenderQuery.

3. **Magic-ui is opt-in polish, not load-bearing.** Removing all magicui imports would still leave a functional (if duller) site. Use them for hero/scoreboard moments, not for routine surfaces.

4. **shadcn/ui is the canonical primitive layer.** New components should compose ui/* rather than re-invent buttons/cards/tabs. The 39 import sites prove the discipline is holding.

5. **The match/ cluster is the highest-risk decomposition target.** 18 files + 22 import sites + the 1943-line `matches/[id]/page.tsx` consumer. Phase 2 extracts FotmobStatsCard / DuelStatRow / PredictionInsightPanel / LiveWinProbabilityPanel from the page into the cluster, then introduces MatchHeader / StickyScoreBar / MetaChipRow / EventTimeline.
