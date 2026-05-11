# Model Accuracy Deep Dive - May 9, 2026

This note documents the current model-accuracy work after the tournament data repair and `--global-only` retrains. The goal is a realistic prediction product: provider-backed data only, probabilistic outputs, conservative confidence, and measurable promotion gates before any architecture change is trusted in production.

## May 11 Update

- Backfilled UEFA Euro 2000 with a curated 31-match archive because ESPN's current Euro range endpoint returns no 2000 rows.
- Added `backend/scripts/validate_data_quality.py` and `.github/workflows/data_quality.yml`; the validator now fails if required Euro, Copa America, Champions League, or Europa League source files disappear or lose score/result fields.
- Added model quality gates to the Accuracy dashboard via `/api/v1/tracking/model-info`: global coverage, accuracy, macro F1, log-loss, Brier, league attention queue, and explicit no-guarantee guardrails.
- Added guarded live win probability to `/api/match/[id]`; it is withheld unless the match is live and score, clock, pre-match model probability, and provider live stats are present.
- Added `/api/market-intelligence` for audit-only no-vig market probability comparison from user-supplied decimal odds. It returns `guarantee: false` and `betting_advice: false`.
- Re-ran `python -m backend.scripts.train_models --min-season 1998 --global-only`: 63,226 candidate matches, 61,085 feature-ready global samples, 49.6% test accuracy, 49.7% macro precision, 49.0% macro recall, 48.6% macro F1, 1.003 log loss.

## What Changed Now

- Added ESPN range-window fetching for sparse competitions, replacing weekly date probes that missed midweek UEFA knockout fixtures.
- Added historical tournament seasons for UEFA Euro and Copa America.
- Refreshed and retrained tournament artifacts:
  - UEFA Euro: 277 sourced matches after the May 11 Euro 2000 archive backfill; the current per-league artifact still has 169 feature-ready samples from the May 9 full retrain and should be retrained in the next full model run.
  - Copa America: 248 sourced matches, 206 feature-ready samples.
  - Champions League: 3,358 sourced matches, 2,944 feature-ready samples.
  - Europa League: 4,582 sourced matches, 3,631 feature-ready samples.
- Fixed current UEFA coverage: 2025-26 UCL and UEL now each collect 188 completed matches instead of 0.
- Added ESPN tactical stat extraction where available: shots, shots on target, corners, fouls, yellow cards, red cards, attendance, phase, and status detail.
- Regenerated the global model and fail-closed league/global/hybrid policy.

## Latest Performance Snapshot

The May 11 global-only pass trained the global challenger on 63,226 candidate matches, producing 61,085 feature-ready samples. The chronological split is 70% train, 15% calibration, and 15% test.

| Model | Samples | Test Accuracy | Macro Precision | Macro Recall | Macro F1 | Log Loss |
|-------|---------|---------------|-----------------|--------------|----------|----------|
| Global | 61,085 | 49.6% | 49.7% | 49.0% | 48.6% | 1.003 |
| Champions League | 2,944 | 53.4% | 45.6% | 46.1% | 45.6% | 0.993 |
| Europa League | 3,631 | 48.3% | 42.5% | 42.2% | 42.2% | 1.036 |
| UEFA Euro | 169 | 34.6% | 35.0% | 34.2% | 34.1% | 1.089 |
| Copa America | 206 | 61.3% | 68.9% | 70.2% | 62.0% | 0.945 |

Policy decisions from the same-fixture benchmark:

- Use global: Copa America, La Liga, Bundesliga, Primeira Liga.
- Use hybrid: Premier League, Ligue 1, Serie A, Eredivisie, Champions League, Europa League.
- Keep league-specific: MLS, World Cup, UEFA Euro.

## Why A Single Global Model Helps, But Should Not Be Unconditional

A global model is useful because it learns from many more tactical, form, ELO, and contextual examples than a small per-league model can. That is especially helpful for competitions with limited samples, promoted teams, and cross-league teams in UEFA competitions.

It should not automatically replace every per-league model because league-specific calibration still matters. Draw rates, home advantage, travel, fixture congestion, and match tempo differ by competition. The current policy is therefore correct: train a global challenger, compare it against each league artifact on the same recent fixtures, and only use global or a global/league blend when accuracy, log-loss, Brier score, and objective gates pass.

## Highest-Leverage Accuracy Improvements

1. **Provider Coverage Contracts**
   Make every competition declare which source fields are guaranteed, optional, or unavailable. Match cards and training should both use that contract so missing data never becomes invented data.

2. **Walk-Forward Season Backtesting**
   Add per-season walk-forward reports: train through season N, validate on season N+1, and track accuracy, macro F1, log-loss, Brier, and calibration error. This catches models that look good on a random holdout but fail in realistic future prediction.

3. **Calibration Dashboard**
   Add expected calibration error, reliability buckets, and confidence-vs-hit-rate curves per league. Accuracy alone is not enough; a paid prediction product must know whether 62% confidence actually wins about 62% of the time.

4. **Tournament State Features**
   Add features for knockout leg, aggregate score, neutral venue, extra-time/penalty rules, group-stage incentives, clinched qualification, and rest after domestic matches. These are especially important for Champions League, Europa League, Euros, Copa America, and World Cup simulations.

5. **Player Availability and Lineup Strength**
   Add a provider-backed lineup/injury/suspension layer when licensing allows it. Missing lineup data should be absent, not guessed. This is one of the biggest real-world accuracy gaps before kickoff.

6. **Market-Implied Probability Layer**
   The first audit-only endpoint now normalizes user-supplied decimal odds into no-vig probabilities and measures model-vs-market edge. The next production step is licensed odds ingestion and responsible UX review; it should remain market comparison, not betting advice.

7. **xG and Shot Quality**
   Current tactical features use shot volume where ESPN provides it. The next jump is provider-backed xG, big chances, shot location, and post-shot xG. These help distinguish teams generating repeatable quality from teams riding finishing variance.

8. **Team Identity Resolution**
   Maintain stable team IDs across providers and seasons. Name-only matching creates avoidable errors, especially with accented names, national teams, renamed clubs, and promoted/relegated clubs.

9. **90-Minute vs AET/Penalty Target Policy**
   Decide and document whether tournament predictions target 90-minute result, after-extra-time result, or qualification winner. Train separate targets if the UI needs both.

10. **Champion-Challenger Automation**
   Keep the current fail-closed model-selection policy, but run it automatically after retraining and block promotion when sample size, calibration, or drift checks fail.

## Immediate Next Implementation Targets

- Add per-league calibration and walk-forward charts to the Accuracy dashboard.
- Add tournament-state features for UEFA and international knockout matches.
- Extend the new data-quality CI from target tournament files to provider freshness checks and team-identity drift checks.
- Add a provider-source contract file used by match cards, training, and API responses.
- Separate 90-minute result prediction from knockout qualification prediction before World Cup bracket scoring becomes user-facing.
