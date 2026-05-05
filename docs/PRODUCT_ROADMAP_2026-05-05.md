# FotPredict AI Product Roadmap - May 5, 2026

This roadmap triages the next 10 product ideas by a combined score of user impact, implementation effort, model integrity, and monetization potential. The intent is to build FotPredict like a startup-quality sports intelligence app: trustworthy data first, then deeper prediction tooling, then premium-grade personalization and market intelligence.

## Triage Order

| Rank | Idea | Strength | Effort | Why This Order | Current Status |
|------|------|----------|--------|----------------|----------------|
| 1 | Data Trust Layer | Very high | Low | Users must know which fields are real provider data, model output, or unavailable. This protects credibility across every screen. | Started: source badges now appear on home match rows and match detail pages. Match detail API returns ESPN/FotMob provenance. |
| 2 | Prediction Explainability | Very high | Medium | Probabilities become more valuable when users can understand the drivers behind them. This is core to a paid analytics product. | Started: match detail pages now show a model explainability panel using probability separation, standings, H2H, goal profile, confidence, and in-match stats. |
| 3 | Mobile Matchday Polish | High | Low | The first paid-app impression comes from fast, scannable, FotMob-style match cards and match detail headers. | Started: provider-backed badges and direct team-tracking actions improve match browsing. |
| 4 | Personal Watchlist Expansion | High | Low-Medium | Retention improves when users can follow teams, matches, and model picks from natural entry points. | Started: match detail pages can add either team to the local team watchlist. |
| 5 | Match Center Upgrades | High | Medium | A richer match center can combine live stats, events, model state, H2H, weather, and highlights into one professional workflow. | In progress: match detail page now has source attribution and model reasoning. |
| 6 | World Cup Command Center | Very high | Medium-High | World Cup 2026 is a major acquisition moment. The app needs countdown, readiness, groups, knockout paths, and global-model validation. | Started: World Cup hub now has a command-center board for data coverage, fixtures, scorer readiness, model source badges, and jump actions into groups/fixtures/knockout/simulator. |
| 7 | Scenario Simulator | High | High | Premium users should be able to test title/top-4/relegation and tournament paths from live standings. | Started: tournament simulator now supports focus-team, favorable/adverse path, and volatility scenario controls where provider team data is available. |
| 8 | Live Prediction Updates | High | High | Live win probability and momentum shifts would make the app feel elite, but it requires careful calibration and data freshness controls. | Planned. |
| 9 | Unified Model Evolution | Very high | Very high | A single cross-league model with per-league calibration is the long-term architecture, but it must not regress current trained leagues. | Existing global challenger support. Next: promote only after benchmark gates pass. |
| 10 | Model-vs-Market Intelligence | High | Very high | Comparing model probabilities with market-implied odds can be powerful, but betting-adjacent UX and data licensing require extra care. | Planned with compliance constraints. |

## Implementation Principles

- Provider-backed fields should be visible as provider-backed. Missing data should stay blank or show a neutral unavailable state.
- Model outputs must be labeled as probabilistic and should preserve model version/source where available.
- New premium-style features should be useful without encouraging reckless betting behavior.
- The global model should be treated as a challenger until it beats per-league models on accuracy, Brier score, calibration, and recent-season holdout tests.
- World Cup predictions should be validated against both international match history and the global model because tournament samples are smaller and noisier.

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
2. Add saved World Cup scenario cards so users can compare baseline, favorable, adverse, and high-volatility paths.
3. Connect scenario controls to true fixture-level "what if Team A wins/draws/loses next match" inputs for domestic leagues.
4. Build live win-probability curves only when enough live event data is available.
5. Create benchmark gates for promoting the cross-league global model over per-league artifacts.
