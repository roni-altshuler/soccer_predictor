# FotPredict AI Product Roadmap - May 5, 2026

This roadmap triages the next 10 product ideas by a combined score of user impact, implementation effort, model integrity, and monetization potential. The intent is to build FotPredict like a startup-quality sports intelligence app: trustworthy data first, then deeper prediction tooling, then premium-grade personalization and market intelligence.

## Triage Order

| Rank | Idea | Strength | Effort | Why This Order | Current Status |
|------|------|----------|--------|----------------|----------------|
| 1 | Data Trust Layer | Very high | Low | Users must know which fields are real provider data, model output, or unavailable. This protects credibility across every screen. | Advanced: source badges appear on home match rows and match detail pages, match detail API returns ESPN/FotMob provenance, and data-quality CI now guards core tournament/current-season source files. |
| 2 | Prediction Explainability | Very high | Medium | Probabilities become more valuable when users can understand the drivers behind them. This is core to a paid analytics product. | Started: match detail pages now show a model explainability panel using probability separation, standings, H2H, goal profile, confidence, and in-match stats. |
| 3 | Mobile Matchday Polish | High | Low | The first paid-app impression comes from fast, scannable, FotMob-style match cards and match detail headers. | Started: provider-backed badges and direct team-tracking actions improve match browsing. More card-level mobile polish still remains. |
| 4 | Personal Watchlist Expansion | High | Low-Medium | Retention improves when users can follow teams, matches, and model picks from natural entry points. | Advanced: match detail pages can add either team to the local team watchlist, and the Fan Tracking workspace now has local kickoff reminder rules, confidence-alert thresholds, browser-notification permission handling, and an active alert queue. Server-side push notifications remain later work. |
| 5 | Match Center Upgrades | High | Medium | A richer match center can combine live stats, events, model state, H2H, weather, and highlights into one professional workflow. | In progress: match detail page now has source attribution, model reasoning, expanded league resolution, guarded live win probability in the API, and the unified prediction endpoint now exposes the tuned decision policy. |
| 6 | World Cup Command Center | Very high | Medium-High | World Cup 2026 is a major acquisition moment. The app needs countdown, readiness, groups, knockout paths, and global-model validation. | In progress: World Cup hub now has a command-center board for data coverage, fixtures, scorer readiness, model source badges, jump actions, and a bracket challenge entry point. |
| 7 | Scenario Simulator | High | High | Premium users should be able to test title/top-4/relegation and tournament paths from live standings. | In progress: tournament simulator now supports focus-team, favorable/adverse path, volatility controls, saved local scenario cards, JSON export, and local-first bracket challenges with invite-link import plus commissioner scoring rules across World Cup, UEFA club tournaments, Euros, and Copa America. |
| 8 | Live Prediction Updates | High | High | Live win probability and momentum shifts would make the app feel elite, but it requires careful calibration and data freshness controls. | Started: match API now returns live win probability only when score, clock, pre-match probabilities, and provider live stats are available. Visual curves remain open. |
| 9 | Unified Model Evolution | Very high | Very high | A single cross-league model with per-league calibration is the long-term architecture, but it must not regress current trained leagues. | Advanced: full 1998+ historical retrain completed May 9, 2026 and global-only refresh completed May 11 after Euro 2000 backfill. Runtime supports league, global, or calibrated hybrid league/global prediction by policy, and scheduled predictions now use the same routing. Current global test metrics: 49.6% accuracy, 49.7% macro precision, 49.0% macro recall, 48.6% macro F1. Decision-policy tuning lifted label-only macro F1 from 41.90% to 43.40%; the May 12 runtime blend search retained only no-accuracy-regression league updates because it did not find a broad global accuracy lift. |
| 10 | Model-vs-Market Intelligence | High | Very high | Comparing model probabilities with market-implied odds can be powerful, but betting-adjacent UX and data licensing require extra care. | Started with compliance constraints: audit-only `/api/market-intelligence` accepts user-supplied decimal odds, removes overround, compares no-vig probabilities with model probabilities, and returns `guarantee: false` plus `betting_advice: false`. |

## Implementation Principles

- Provider-backed fields should be visible as provider-backed. Missing data should stay blank or show a neutral unavailable state.
- Model outputs must be labeled as probabilistic and should preserve model version/source where available.
- New premium-style features should be useful without encouraging reckless betting behavior.
- The global model should be treated as a challenger until it beats per-league models on accuracy, Brier score, calibration, and recent-season holdout tests.
- World Cup predictions should be validated against both international match history and the global model because tournament samples are smaller and noisier.

## Completion Readiness Order

This is the current triage from closest to final implementation to most time-intensive:

1. Data Trust Layer — close to final for match/provider badges; still needs wider coverage across every data card.
2. Prediction Explainability — strong foundation live; next step is tying explanations to model-selection policy and feature importance.
3. Mobile Matchday Polish — started and low-risk; remaining work is visual polish, not architecture.
4. World Cup Command Center — useful already; final polish depends on live 2026 fixture/provider coverage.
5. Scenario Simulator — broad feature base exists; deeper domestic what-if controls remain.
6. Match Center Upgrades — progressing, but needs more live events/stat modules.
7. Personal Watchlist Expansion — started; reminders and alerts need persistence/notification plumbing.
8. Unified Model Evolution — advanced with full retraining, label-normalized global benchmarking, hybrid promotion policy, global-only retrain support, Accuracy dashboard policy status, repaired small-tournament data for Euro/Copa, and May 11 global-policy refresh.
9. Live Prediction Updates — API availability gate started; visual timeline curves and calibration history still need work.
10. Model-vs-Market Intelligence — audit-only no-vig comparison endpoint started; licensed odds feed integration and betting-compliance UX remain later work.

## Checked Off

- [x] Add reusable data-source badges and provenance to core match surfaces.
- [x] Add match-detail prediction explainability.
- [x] Add one-tap team tracking from match detail pages.
- [x] Add tournament bracket challenges across World Cup, UEFA tournaments, Euros, and Copa America.
- [x] Add global-model fail-closed runtime policy.
- [x] Add same-fixture league/global/hybrid benchmark gates for future retraining.
- [x] Run full `--global-model` retraining on all competitions and review generated `model_selection.json`.
- [x] Normalize global-training league labels and add `--global-only` retraining so league/global/hybrid policy can be regenerated without retraining every league artifact.
- [x] Emit precision, recall, F1, and per-class metrics in saved model metadata.
- [x] Expose model-selection decision, benchmark status, and global blend weight in the Accuracy dashboard.
- [x] Add working historical feeds for UEFA Euro and Copa America before enabling serious predictions for those tournament pages.
- [x] Improve UEFA current-season fixture ingestion; the repaired May 9 retrain collected 188 current 2025-26 UCL matches and 188 UEL matches from ESPN range windows.
- [x] Add model accuracy deep-dive with next implementation methods in `docs/MODEL_ACCURACY_DEEP_DIVE_2026-05-09.md`.
- [x] Backfill Euro 2000 with a curated 31-match archive because ESPN's current Euro range endpoint returns no 2000 rows.
- [x] Add historical data-quality CI for required Euro, Copa America, UCL, and UEL source files.
- [x] Add Accuracy dashboard model quality gate with coverage, calibration, holdout, and league attention checks.
- [x] Add audit-only model-vs-market no-vig comparison endpoint.
- [x] Add guarded live win probability to match details API when live data is complete enough.
- [x] Add chronological draw-decision tuning simulation and apply guarded league threshold updates.
- [x] Align scheduled prediction generation with benchmark-gated league/global/hybrid model routing.
- [x] Expand Accuracy dashboard policy rows into detailed per-league drill-downs with accuracy, log-loss, Brier, and F1.
- [x] Add local watchlist kickoff reminders, confidence-alert thresholds, and active alert queue.
- [x] Add runtime neural/ELO blend tuning with strict no-accuracy-regression guards.
- [ ] Build live win-probability curves only where live event data is complete enough.
- [ ] Add synced bracket rooms/auth and cross-device persistence.

## First Tranche

The first implementation pass starts ranks 1-4:

- Add reusable data-source badges.
- Carry source metadata through match detail API responses.
- Normalize H2H score fields so detail cards do not silently drop real scores.
- Add match-detail prediction explainability.
- Add one-tap team tracking from match detail pages.

## Next Tranche

Recommended next work after this pass:

1. Upgrade local watchlist alerts to server-backed push notifications and cross-device alert sync.
2. Upgrade bracket challenge groups from local JSON sharing to true synced rooms with authentication, invite links, and cross-device persistence.
3. Connect scenario controls to true fixture-level "what if Team A wins/draws/loses next match" inputs for domestic leagues.
4. Build visual live win-probability curves on top of the guarded match API.
5. Add calibration trend history to the new per-league model drilldown.
6. Add licensed odds-provider ingestion and responsible product UX around market-intelligence views.
