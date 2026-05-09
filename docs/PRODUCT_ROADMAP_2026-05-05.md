# FotPredict AI Product Roadmap - May 5, 2026

This roadmap triages the next 10 product ideas by a combined score of user impact, implementation effort, model integrity, and monetization potential. The intent is to build FotPredict like a startup-quality sports intelligence app: trustworthy data first, then deeper prediction tooling, then premium-grade personalization and market intelligence.

## Triage Order

| Rank | Idea | Strength | Effort | Why This Order | Current Status |
|------|------|----------|--------|----------------|----------------|
| 1 | Data Trust Layer | Very high | Low | Users must know which fields are real provider data, model output, or unavailable. This protects credibility across every screen. | Started: source badges now appear on home match rows and match detail pages. Match detail API returns ESPN/FotMob provenance. |
| 2 | Prediction Explainability | Very high | Medium | Probabilities become more valuable when users can understand the drivers behind them. This is core to a paid analytics product. | Started: match detail pages now show a model explainability panel using probability separation, standings, H2H, goal profile, confidence, and in-match stats. |
| 3 | Mobile Matchday Polish | High | Low | The first paid-app impression comes from fast, scannable, FotMob-style match cards and match detail headers. | Started: provider-backed badges and direct team-tracking actions improve match browsing. More card-level mobile polish still remains. |
| 4 | Personal Watchlist Expansion | High | Low-Medium | Retention improves when users can follow teams, matches, and model picks from natural entry points. | Started: match detail pages can add either team to the local team watchlist. Kickoff reminders and confidence alerts remain open. |
| 5 | Match Center Upgrades | High | Medium | A richer match center can combine live stats, events, model state, H2H, weather, and highlights into one professional workflow. | In progress: match detail page now has source attribution and model reasoning. |
| 6 | World Cup Command Center | Very high | Medium-High | World Cup 2026 is a major acquisition moment. The app needs countdown, readiness, groups, knockout paths, and global-model validation. | In progress: World Cup hub now has a command-center board for data coverage, fixtures, scorer readiness, model source badges, jump actions, and a bracket challenge entry point. |
| 7 | Scenario Simulator | High | High | Premium users should be able to test title/top-4/relegation and tournament paths from live standings. | In progress: tournament simulator now supports focus-team, favorable/adverse path, volatility controls, saved local scenario cards, JSON export, and local-first bracket challenges with invite-link import plus commissioner scoring rules across World Cup, UEFA club tournaments, Euros, and Copa America. |
| 8 | Live Prediction Updates | High | High | Live win probability and momentum shifts would make the app feel elite, but it requires careful calibration and data freshness controls. | Planned. |
| 9 | Unified Model Evolution | Very high | Very high | A single cross-league model with per-league calibration is the long-term architecture, but it must not regress current trained leagues. | Advanced: full 1998+ historical retrain completed May 9, 2026 and regenerated after tournament data repair. Runtime now supports league, global, or calibrated hybrid league/global prediction by policy. Corrected label-normalized benchmark promotes global for Copa America, La Liga, Bundesliga, Serie A, Primeira Liga and hybrid blends for PL, Ligue 1, Eredivisie, UCL, and UEL. |
| 10 | Model-vs-Market Intelligence | High | Very high | Comparing model probabilities with market-implied odds can be powerful, but betting-adjacent UX and data licensing require extra care. | Planned with compliance constraints. |

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
8. Unified Model Evolution — advanced with full retraining, label-normalized global benchmarking, hybrid promotion policy, global-only retrain support, Accuracy dashboard policy status, and repaired small-tournament data for Euro/Copa.
9. Live Prediction Updates — high-value but depends on reliable live event feeds and calibration.
10. Model-vs-Market Intelligence — intentionally last because odds data licensing and betting-compliance UX need more care.

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

1. Add saved match watchlists with kickoff reminders and predicted-confidence alerts.
2. Upgrade bracket challenge groups from local JSON sharing to true synced rooms with authentication, invite links, and cross-device persistence.
3. Connect scenario controls to true fixture-level "what if Team A wins/draws/loses next match" inputs for domestic leagues.
4. Build live win-probability curves only when enough live event data is available.
5. Expand Accuracy dashboard policy rows into detailed per-league drill-downs with accuracy, log-loss, Brier, F1, and calibration trend history.
6. Add data-quality CI checks that fail when supported competitions unexpectedly return 0 current-season matches.
