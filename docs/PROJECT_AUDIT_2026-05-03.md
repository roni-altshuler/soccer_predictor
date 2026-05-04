# Soccer Predictor Audit - 2026-05-03

## Executive Summary

The app is functionally broad and close to the intended FotMob-style product surface: live fixtures, league pages, standings, match prediction, tracking, and automated prediction files all exist. The main model risk is not lack of ambition; it is fragmentation between several prediction paths.

The production prediction pipeline currently has three separate behaviors:

- `backend/scripts/predict_upcoming.py` uses the trained per-league neural ensemble when artifacts exist.
- `backend/main.py` previously served `/api/predict/unified` from ELO only; it now attempts neural first, then ELO-Poisson.
- `src/app/api/predict/any-teams/route.ts` previously ignored backend probabilities and recalculated locally; it now consumes backend neural probabilities when available.

## Current Model Standing

Saved model artifacts exist for 11 league keys plus World Cup:

| League | Samples | Test Samples | Ensemble Accuracy | NN Accuracy | Log Loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| Premier League | 8,748 | 1,313 | 0.484 | 0.515 | 1.009 |
| La Liga | 8,704 | 1,306 | 0.464 | 0.529 | 1.018 |
| Bundesliga | 7,123 | 1,069 | 0.466 | 0.492 | 1.016 |
| Serie A | 8,480 | 1,272 | 0.497 | 0.530 | 1.005 |
| Ligue 1 | 7,964 | 1,195 | 0.508 | 0.523 | 1.000 |
| Eredivisie | 5,979 | 897 | 0.473 | 0.502 | 1.003 |
| Primeira Liga | 4,583 | 688 | 0.536 | 0.548 | 0.917 |
| MLS | 1,112 | 167 | 0.413 | 0.491 | 1.082 |
| Champions League | 313 | 47 | 0.426 | 0.340 | 1.067 |
| Europa League | 488 | 74 | 0.446 | 0.459 | 1.081 |
| World Cup | 198 | 30 | 0.433 | 0.467 | 1.082 |

Completed prediction tracking has 1,398 settled matches. Accuracy by recent tracked predictions ranges from 35.0% to 48.1% by league, with overall calibration varying materially across competitions.

## Critical Findings Fixed

1. `backend/data/league_params.json` had impossible negative `avg_goals` values for Premier League, Serie A, and Europa League. That can distort Poisson scorelines and confidence.
2. `train_feedback.py` could push `avg_goals` below zero because it did not clamp learned updates. It now clamps average goals, home advantage, and draw rate.
3. `backend/data/models/uefa.champions/metadata.json` had malformed JSON, which broke metadata parsing.
4. The frontend "any teams" predictor could label backend output as ML but still use local statistical probabilities. It now consumes backend probabilities and goals when present.

## Global Model Recommendation

Long term, a single cross-league model is worth building, but it should not simply replace all league models at once. The safest architecture is:

- Train one global model across all leagues with explicit league features, recency weighting, and league-balanced sample weights.
- Keep per-league models as fallback and benchmark challengers.
- Promote the global model only when walk-forward log loss, Brier score, and calibration beat the per-league model for most leagues.
- Continue storing real 66-feature vectors for every prediction so future online learning uses exact pre-match inputs rather than synthetic proxies.

This repo now supports that migration via:

```bash
python -m backend.scripts.train_models --global-model
```

When `backend/data/models/global` exists, `/api/predict/unified` prefers it. Otherwise it falls back to the per-league model.

## Remaining Model Risks

- Existing completed predictions have `0` stored 66-feature vectors, so online neural learning cannot update from the current settled history.
- Some tournament models have small samples. Their predictions should lean more heavily on the global model or ELO-Poisson until more outcomes accumulate.
- The training claims in `README.md` still describe the target architecture more confidently than the live serving path historically supported.
- True "always improving" learning should be gated by evaluation, not automatic promotion. Retraining should write challenger metrics first, then promote only if probability quality improves.

## UI Standing

The league pages already contain useful sections, but several cards looked more like generic dashboard panels than professional soccer reporting views. The next UI step is to keep the page compact, data-dense, and match-first:

- tighter hero with leader/scorer/fixtures as scan-friendly facts,
- match strips that resemble sports app rows,
- compact action cards for simulation and model tracking,
- less decorative gradient weight, more table clarity and small visual cues.

