# Folder tree (post-Phase-0 snapshot)

A read of the repo shape on `feat/fotmob-redesign-2026` **as of Phase 0**, before any visual changes have landed. Generated as one of the five Phase-0 documentation artifacts.

## Frontend — `src/`

```
src/
├── app/                              # Next.js 15 App Router
│   ├── layout.tsx                    # Root layout: ThemeProvider, AppShell, fonts (Inter)
│   ├── page.tsx                      # Home — Match Centre
│   ├── about/page.tsx
│   ├── accuracy/page.tsx             # Public model audit (CalibrationPlot + ConfusionHeatmap)
│   ├── diagnostics/page.tsx          # Engineer-facing model quality gates
│   ├── leagues/[leagueId]/page.tsx
│   ├── matches/page.tsx              # League browser w/ standings + fixtures tabs
│   ├── matches/[id]/page.tsx         # ⚠ 1943 lines — Phase 2 decomposition target
│   ├── news/page.tsx
│   ├── players/[id]/page.tsx         # Player detail (NEW since Explore — not in original survey)
│   ├── predict/page.tsx              # AI prediction tool
│   ├── simulator/page.tsx            # Monte Carlo league simulator + KO tournaments
│   ├── tracking/page.tsx             # Legacy redirect → /accuracy
│   ├── upcoming/page.tsx             # Next-7-day predictions feed
│   └── api/                          # Node-runtime route handlers
│       ├── v1/                       # Mirrors backend/api/v1/ for Vercel-deployable surfaces
│       ├── analytics/, bracket-rooms/, calendar/, fixtures/, injuries/, launch-readiness/,
│       │   live_scores/, market-intelligence/, match/, matches_by_date/, news/, og/,
│       │   predict/, recent_results/, search-teams/, simulation/, standings/, team_form/,
│       │   team_stats/, teams/, todays_matches/, top-scorers/, tournament/,
│       │   upcoming_matches/, visualizations/, watchlist-alerts/, weather/, world-cup/
│       └── (~30 route folders total)
│
├── components/
│   ├── ui/                           # shadcn primitives (16) — keep as-is
│   ├── magicui/                      # ✅ 15 polish primitives already ported
│   ├── primitives/                   # FotMob-style small atoms
│   │   ├── ConfidencePill.tsx
│   │   ├── LiveBadge.tsx
│   │   ├── PlayerAvatar.tsx          # Reads headshot manifest, falls back to monogram
│   │   ├── TeamBadge.tsx
│   │   └── index.ts
│   ├── shell/                        # AppShell, SidebarNav, TopBar, MobileBottomNav, CommandPalette
│   ├── match/  (18)                  # Largest feature cluster; ~22 import sites across app
│   ├── charts/ (9)                   # MomentumChart, WinProbabilityChart, XGShotMap, XGTimelineChart,
│   │                                 # ScorelineHeatmap, SimulationDistributionChart, FormSparkline + theme.ts
│   ├── cards/ (6)                    # BentoStatCard, MatchCard, PlayerCard, StatCard, TeamCard
│   ├── prediction/ (4)               # PredictionResult is the flagship viz
│   ├── accuracy/ (5)                 # AccuracyHero, CalibrationPlot, ConfusionHeatmap, RecentPicksFeed, ModelExplainer
│   ├── home/ (4)                     # HeroSpotlight, LiveTickerBar, NewsStrip, ...
│   ├── league/ (3)                   # LeagueHeader, LeagueStandings, LeagueFixtures
│   ├── lineup/ (2)                   # FormationDisplay, PitchBackground — Phase 2 v2 target
│   ├── knockout/ (3)                 # KnockoutBracket, KnockoutSimulator
│   ├── tournament/ (3)
│   ├── worldcup/ (3)
│   ├── weather/ (2)
│   ├── referee/ (2)
│   ├── skeletons/ (6)                # Loading state primitives
│   ├── team/ (1)
│   ├── tracking/ (6)
│   └── (root)                        # GenderToggle, ThemeToggle, EmptyState, Footer, DataSourceBadge,
│                                     # PageLoader, AuthModal, LeagueStats, MLMetricsVisualizations,
│                                     # GoalsDistributionChart, ResultDistributionChart, ...
│
├── hooks/                            # 12 SWR + state hooks
│   ├── useGenderPreference.ts        # localStorage 'fotpredict.gender'
│   ├── useGenderQuery.ts             # Canonical wrapper — appends ?gender= to every fetch
│   ├── useHeadshotManifest.ts        # ✅ wired to consume /headshots-manifest.json (data not populated yet)
│   ├── useMatchSubscription.ts
│   ├── useMatches.ts
│   ├── useMomentum.ts                # ✅ wired to /api/v1/matches/{id}/momentum (endpoint not populated yet)
│   ├── usePlayer.ts
│   ├── usePredictionHistory.ts
│   ├── usePredictions.ts
│   ├── useSimulation.ts
│   ├── useTeam.ts
│   └── useTournament.ts
│
├── lib/                              # API + cross-cutting helpers
│   ├── api.ts
│   ├── utils.ts                      # cn() — imported by 72 sites
│   ├── leagueAccents.ts              # competition_id → { displayName, country, gender, accent }
│   ├── liveWinProbability.ts
│   ├── marketIntelligence.ts
│   ├── predictionService.ts
│   ├── serverJsonStore.ts
│   ├── serverSyncStore.ts
│   ├── dataService.ts
│   └── watchlist.ts
│
├── contexts/, providers/, store/     # ThemeProvider, AuthProvider, Zustand stores
├── data/                             # Static seed data
├── types/api.ts                      # TypeScript contracts (Match, Prediction, League, …)
└── __tests__/                        # Jest + RTL
```

## Backend — `backend/`

```
backend/
├── main.py                           # FastAPI app entrypoint (uvicorn on :8000)
├── api/v1/                           # FastAPI routes — predictions, tracking, matches, leagues, teams, …
├── services/
│   ├── prediction/                   # Unified PyTorch + ELO-Poisson + tracker
│   ├── data/                         # SQLite warehouse + 7 ingestion loaders
│   ├── espn/                         # ESPN API client (rate-limited 30/min)
│   └── fotmob/                       # FotMob API client
├── models/                           # Pydantic schemas mirrored from src/types/api.ts
├── scripts/                          # CLI entrypoints (train_unified, predict_upcoming, fetch_outcomes, …)
├── data/
│   ├── warehouse.sqlite              # (gitignored) main warehouse
│   ├── predictions/                  # ✅ COMMITTED: predictions_YYYY-MM.json (Dec 2025 → Apr 2026)
│   ├── league_params.json            # ✅ COMMITTED: per-league calibration
│   ├── models/                       # (gitignored) unified_men.pt, unified_women.pt, scalers, calibrators
│   ├── historical/                   # (gitignored)
│   ├── momentum/                     # ⚠ EMPTY — Phase 1.B pipeline produces this
│   └── understat/                    # ⚠ EMPTY — Phase 1.C pipeline produces this
└── tests/
```

## Repo root additions in Phase 0

```
.
├── scripts/screenshot.ts             # ✅ NEW: Playwright shoot harness, port 3002
├── scripts/screenshots/              # ✅ NEW (gitignored): per-phase PNG output
├── public/headshots/                 # ⚠ EMPTY — Phase 1.A pipeline produces WebPs + manifest.json
└── docs/                             # ✅ NEW: five redesign-foundation artifacts
    ├── folder-tree.md
    ├── component-dependency-map.md
    ├── route-architecture.md
    ├── design-tokens.md
    └── screenshot-comparison.md
```

## Counts at a glance

| Surface | Count |
|---|---|
| App routes (`page.tsx`) | 13 |
| API route folders | ~30 |
| React components (`.tsx`) | ~105 |
| Component clusters | 20 |
| Hooks | 12 |
| `lib/` helpers | 10 |
| Magic-ui primitives | 15 |
| Shadcn primitives | 16 |
| FotMob-style primitives | 4 |
| Months of predictions committed | 5 (2025-12 → 2026-04) |
