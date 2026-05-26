# Route architecture

Every user-facing route under `src/app/`, the dominant components it composes, and the data sources it consumes. API routes under `src/app/api/` are listed at the bottom.

## User-facing pages

### `/` — Home / Match Centre
- **Owns:** today's fixtures grouped by league, hero with live stats, gender toggle.
- **Composes:** [home/HeroSpotlight](../src/components/home/HeroSpotlight.tsx) · [home/LiveTickerBar](../src/components/home/LiveTickerBar.tsx) · [home/NewsStrip](../src/components/home/NewsStrip.tsx) · [match/LeagueSection](../src/components/match/LeagueSection.tsx) · [match/MatchRow](../src/components/match/MatchRow.tsx).
- **Data:** `/api/todays_matches?date=…&gender=…` · `/api/news` · `/api/live_scores`.
- **Phase 3 plan:** replace HeroSpotlight w/ MagicCard + NumberTicker hero, LiveTickerBar → magicui Marquee LiveTicker, add AIInsightsBento (5-card BentoGrid).

### `/matches` — Leagues browser
- **Owns:** 8 men's + 5 women's competitions, standings/fixtures tabs per league, region filter.
- **Composes:** [league/LeagueHeader](../src/components/league/LeagueHeader.tsx) · [league/LeagueStandings](../src/components/league/LeagueStandings.tsx) · [league/LeagueFixtures](../src/components/league/LeagueFixtures.tsx) · ui/Tabs.
- **Data:** `/api/standings?league=…` · `/api/fixtures`.

### `/matches/[id]` — Match detail ⚠
- **Owns:** the FotMob tentpole. 1943 lines today with inlined section components.
- **Composes (today, all inlined):** MatchHeader hero, DuelStatRow, FotmobStatsCard, LiveWinProbabilityPanel, PredictionInsightPanel, ConfidenceIndicator, watchlist actions · [lineup/FormationDisplay](../src/components/lineup/FormationDisplay.tsx) · [match/AIPredictionTab](../src/components/match/AIPredictionTab.tsx) · [match/HeadToHeadDisplay](../src/components/match/HeadToHeadDisplay.tsx) · [match/MatchEventHeatmap](../src/components/match/MatchEventHeatmap.tsx) · [match/MatchMomentum](../src/components/match/MatchMomentum.tsx) (legacy SVG) · [weather/MatchWeather](../src/components/weather/MatchWeather.tsx) · [prediction/PredictionResult](../src/components/prediction/PredictionResult.tsx).
- **Data:** `/api/match/{id}` (lineups + events + stats + H2H) · `/api/v1/matches/{id}/momentum` (Phase 1.B — not yet populated) · `/api/v1/matches/{id}/shotmap` (Phase 1.C — not yet populated) · prediction payload from `predictions_YYYY-MM.json`.
- **Phase 2 plan:** decompose into MatchHeader, StickyScoreBar, MetaChipRow, FotmobStatsCard, DuelStatRow, PredictionInsightPanel, LiveWinProbabilityPanel. Add EventTimeline + ShotMap. Six-tab layout (Overview / Lineups / Stats / Events / AI / H2H). FormationDisplay v2 with team-tint props + PlayerAvatar overlay + RatingPill.

### `/leagues/[leagueId]` — League detail
- **Owns:** league standings + calendar; currently a thin redirect to /matches with league filter.
- **Composes:** [league/*](../src/components/league/) · ui/Tabs.
- **Phase 4 plan:** team-tinted left border on each row, AI lean column.

### `/predict` — AI prediction tool
- **Owns:** custom team pickers (any-teams / cross-league / head-to-head) + full PredictionResult viz.
- **Composes:** [prediction/PredictHero](../src/components/prediction/PredictHero.tsx) · [prediction/PredictionResult](../src/components/prediction/PredictionResult.tsx).
- **Data:** `POST /api/predict/head-to-head`, `POST /api/predict/cross-league`.
- **Phase 4 plan:** wrap PredictionResult in MagicCard.

### `/accuracy` — Public model audit
- **Owns:** 30-day rolling accuracy, calibration plot, confusion heatmap, recent picks feed.
- **Composes:** [accuracy/AccuracyHero](../src/components/accuracy/AccuracyHero.tsx) · [accuracy/CalibrationPlot](../src/components/accuracy/CalibrationPlot.tsx) (custom SVG, theme-aware) · [accuracy/ConfusionHeatmap](../src/components/accuracy/ConfusionHeatmap.tsx) · [accuracy/RecentPicksFeed](../src/components/accuracy/RecentPicksFeed.tsx) · [accuracy/ModelExplainer](../src/components/accuracy/ModelExplainer.tsx).
- **Data:** `/api/v1/tracking/accuracy?gender=…` (Node route, reads committed `predictions_YYYY-MM.json` files) · `/api/v1/tracking/recent`.
- **Phase 4 plan:** NumberTicker + BorderBeam on hero, audit token usage on plots.

### `/diagnostics` — Engineer-facing dashboard
- **Owns:** model quality gates, per-league drift, calibration audit (internal QA).
- **Composes:** [tracking/*](../src/components/tracking/) (DriftChart, TrackingCenter, etc).
- **Phase 4 plan:** AnimatedBeam diagram for model wiring; otherwise hands-off (internal).

### `/news`
- **Owns:** ESPN/FotMob news feed with relative timestamps and thumbnails.
- **Data:** `/api/news?gender=…`.

### `/simulator` — Season simulator + tournament forecasts
- **Owns:** Monte Carlo league standings (title/top4/europa/relegation %), KO simulations (World Cup), confidence bucketing.
- **Composes:** [prediction/SeasonSimulator](../src/components/prediction/SeasonSimulator.tsx) · [knockout/KnockoutBracket](../src/components/knockout/KnockoutBracket.tsx) · [knockout/KnockoutSimulator](../src/components/knockout/KnockoutSimulator.tsx) · [charts/SimulationDistributionChart](../src/components/charts/SimulationDistributionChart.tsx).
- **Data:** `/api/simulation/{leagueId}?n_simulations=1000` · `/api/tournament` · `/api/world-cup`.
- **Phase 4 plan:** BentoGrid mosaic for standings cards w/ RatingPill probabilities.

### `/upcoming` — Next-7-day predictions feed
- **Owns:** read-only forward predictions lighter than /predict.
- **Data:** `/api/upcoming_matches` + committed predictions.
- **Phase 4 plan:** denser FotMob-style schedule grid, team-tinted rows.

### `/players/[id]` — Player detail (recently added)
- **Owns:** per-player profile, recent matches, position context.
- **Data:** `/api/v1/players/{id}` (hooks/usePlayer).

### `/tracking` — Legacy redirect
- Just bounces to `/accuracy` or `/diagnostics?view=…`.

### `/about`
- Static — credits, methodology, gender-universe explainer. Phase 1.A will add an Image Credits subsection enumerating headshot licenses.

### `/design-system` — ⚠ does not exist yet
- Phase 0.E will create a server-rendered (sitemap-noindex) gallery showing every shadcn primitive, every magic-ui primitive, design tokens, typography scale, MetaChip / RatingPill / PlayerAvatar / ConfidencePill specimens.

## API routes (~30 folders under `src/app/api/`)

| Route | Returns | Notes |
|---|---|---|
| `/api/todays_matches?date=&gender=` | ESPN Match[] | Public; gender-aware |
| `/api/match/{id}` | Match detail w/ lineups + events + stats + H2H | ESPN/FotMob proxy |
| `/api/standings?league=&gender=` | TeamStanding[] | Legacy — gender param accepted but routes by league_id |
| `/api/simulation/{leagueId}?n_simulations=` | Monte Carlo standings | Bradley-Terry + 1000 MC samples; ?gender= aware |
| `/api/predict/head-to-head` | HeadToHeadPrediction (POST) | Legacy schema |
| `/api/predict/cross-league` | CrossLeaguePrediction (POST) | |
| `/api/news?gender=` | NewsItem[] | |
| `/api/live_scores` | Live match payloads | |
| `/api/upcoming_matches?gender=` | Predictions for next 7 days | |
| `/api/v1/tracking/accuracy?gender=` | AccuracyStats | Node route — reads `predictions_YYYY-MM.json` |
| `/api/v1/tracking/recent` | RecentPicks[] | Same source |
| `/api/v1/matches/{id}/momentum` | Momentum series | ⚠ Phase 1.B — frontend hook ready, backend not populated |
| `/api/v1/matches/{id}/shotmap` | Shot-level xG | ⚠ Phase 1.C — same |
| `/api/og/*` | Open-Graph PNGs via @vercel/og | |
| `/api/analytics`, `/api/bracket-rooms`, `/api/calendar`, `/api/fixtures`, `/api/injuries`, `/api/launch-readiness`, `/api/market-intelligence`, `/api/matches_by_date`, `/api/recent_results`, `/api/search-teams`, `/api/team_form`, `/api/team_stats`, `/api/teams`, `/api/top-scorers`, `/api/tournament`, `/api/visualizations`, `/api/watchlist-alerts`, `/api/weather`, `/api/world-cup` | Various — see route files | Mix of ESPN proxies, JSON readers, and FastAPI proxies |

## Navigation surfaces

- **Desktop sidebar** ([SidebarNav](../src/components/shell/SidebarNav.tsx), 68→232px hover expand): Match Centre · Leagues · AI Predict · Accuracy · News · Simulator · Diagnostics · About.
- **Topbar** ([TopBar](../src/components/shell/TopBar.tsx), 60px sticky): search trigger (cmd+k), GenderToggle (≥sm), ThemeToggle, user menu.
- **Mobile bottom nav** ([MobileBottomNav](../src/components/shell/MobileBottomNav.tsx)): primary nav icons + search.
- **CommandPalette** ([CommandPalette](../src/components/shell/CommandPalette.tsx), cmdk): cmd+k or "/" — searches leagues, teams, matches.

## Phase 0 navigation refinements (planned, not yet applied)

- Sidebar groupings (Live / Insights / Discover) separated by ui/Separator.
- Topbar utility row collapses on scroll past 80px (F1 precedent).
- Match detail gains a second sticky band (StickyScoreBar) — z-stack: topbar 50, StickyScoreBar 40, tab bar 30.
