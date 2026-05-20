# Unified Multi-Task Model — May 20, 2026 Release

## Headline

The unified PyTorch multi-task model now **beats every per-league
baseline by a wide margin** on a 11,661-match chronological holdout:

| Metric | May 9 per-league avg | May 9 global challenger | **May 20 unified** | Δ vs global |
|---|---|---|---|---|
| Test accuracy | ~44.6% | 49.6% | **60.56%** | **+10.96pp** |
| Log loss | ~1.05 | 1.003 | **0.865** | −0.138 |
| Brier | ~0.66 | ≈0.66 | **0.505** | −0.155 |
| Draw recall | 0.5–5% | <1% | **21.0%** | **+20pp+** |

## How it works

* **One model per gender universe** (men's + women's), not 14 per-league
  models. League / team / referee / phase are learned embeddings, not
  data partitions.
* **Three heads on a shared 64-dim backbone:** outcome (W/D/L with focal
  loss γ=1.5), bivariate Poisson xG (λ_home, λ_away), and a learned
  correlation rate λ_corr. Scoreline distribution is derived analytically
  from the three heads.
* **80 engineered features** built by a single `FeatureBuilderV2` that
  runs identically at train and inference time (the previous pipeline
  used 66 features at training but only 41 at serving — drift gone).
* **Trained on 77,735 men's matches** across 13 competitions going back
  to 1998 for tournaments and 2003 for the top-5 European leagues.

## Holdout breakdown

```
                       Predicted
                  HOME    DRAW    AWAY
True  HOME       4,120     129     865      (recall 80.6%)
      DRAW      1,479     615     841      (recall 21.0%)
      AWAY      1,142     143   2,327      (recall 64.4%)
                                  Total n = 11,661
```

Confusion matrix shows balanced precision across all three classes for
the first time — the per-league models had draws collapsing to ~0%
recall, which made the previous "high-accuracy" numbers come almost
entirely from picking the favourite.

## Sources of the lift

Compared to the May 9 per-league + global challenger results:

| Change | Estimated contribution |
|---|---|
| 3× more training data (16k → 54k train rows after split) | +5 to +7pp |
| Single backbone learns cross-league transfer | +1 to +2pp |
| Fixed home/away PMF sign bug ([commit 7bfc327](../../commit/7bfc327)) | +25pp on the v1 unified run; not vs baseline |
| Composite early-stopping + focal γ=1.5 + capped class weights | +1 to +2pp + most of the draw-recall recovery |
| Bivariate-Poisson scoreline derivation (replaces hard-coded ρ) | Smaller log-loss; better-calibrated scorelines |

## What's still on the legacy ELO-Poisson default

The live FastAPI route serves the legacy `PredictionService` by default
for safety. To use the new model:

```
GET /api/v1/predictions/match/{id}?engine=unified&gender=M
GET /api/v1/predictions/unified-by-name
    ?home_team=Manchester+City&away_team=Liverpool
    &competition_id=eng.1&gender=M
```

The frontend match detail page already has the "AI Prediction" tab
rendering the new model's output via the unified inference adapter.

## Women's universe

A second `unified_women.pt` artefact was trained on 3,210 women's
matches across NWSL, WSL, Women's Champions League, FIFA Women's World
Cup, and UEFA Women's Euro:

| Metric | Value |
|---|---|
| Test accuracy | 51.45% on 482-match holdout |
| Log loss | 1.023 |
| Brier | 0.607 |
| Draw recall | 2.8% (data-limited) |

Lower draw recall mirrors the smaller dataset — women's leagues
average fewer draws (~17% vs ~26% for men's), so per-class minimum
counts are tight.

## Next planned improvement

The warehouse now plumbs FBref xG, Understat shot-level xG, and
Open-Meteo weather, but they aren't yet populated for most matches.
Running `python -m backend.scripts.build_warehouse --fbref --understat
--weather` and retraining is the obvious next step — projected lift
~+1 to +2pp from contextual features the model hasn't seen yet.
