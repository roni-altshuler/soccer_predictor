# Model Decision Policy Tuning - May 11, 2026

## Purpose

The May 9-11 retraining work established a current baseline for the global, league, and hybrid model architecture. This pass focused on a narrower improvement that can be validated without retraining all neural weights: tune the final 1X2 decision rule that converts calibrated probabilities into a home/draw/away pick.

This is not a betting guarantee. It is a calibration and decision-policy improvement intended to make the app's reported picks more honest and more consistent with real soccer draw behavior.

## Research Basis

- Dixon-Coles score modeling remains the right classical baseline for soccer because low-score dependence and time-varying team strength matter in football scorelines: <https://academic.oup.com/jrsssc/article/46/2/265/6990546>
- ELO-derived strength features remain useful, but published work also shows market odds are difficult to beat and evaluation should use statistical loss functions, not only hit rate: <https://www.sciencedirect.com/science/article/pii/S0169207009001708>
- scikit-learn's probability calibration guidance supports auditing probability quality separately from class labels: <https://scikit-learn.org/stable/modules/calibration.html>
- The project should keep chronological splits for soccer because random splits leak future team strength into past predictions. The implementation mirrors the spirit of time-series validation: <https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html>
- Brier score and log loss remain central governance metrics because they judge probability quality, not just whether the top label happened to win: <https://scikit-learn.org/stable/modules/model_evaluation.html#brier-score-loss>

## What Changed

- Added `backend/scripts/tune_decision_policy.py`.
- The script loads sourced historical matches plus completed prediction outcomes, builds the same 66-feature matrix, simulates the current league/global/hybrid routing policy, tunes draw thresholds on the calibration split, and evaluates on the untouched chronological test split.
- Updated `/api/predict/unified` so the interactive prediction endpoint now uses the same tuned draw decision policy as scheduled predictions.
- Updated `predict_upcoming.py` so generated future match cards use the benchmark-gated league/global/hybrid policy, not the older per-league-only neural path.
- Added `backend/data/model_decision_policy_tuning.json` as the full audit artifact.
- Updated `backend/data/model_tuning.json` for leagues whose tuned threshold passed the test-split guard.

## Validation Run

Command:

```bash
python -m backend.scripts.tune_decision_policy --min-season 1998 --apply
```

Data coverage:

- 61,847 historical sourced matches loaded across 13 competition datasets.
- 1,399 settled prediction outcomes included.
- 63,246 total historical/prediction matches considered.
- 42,770 train rows, 9,165 calibration rows, 9,166 untouched test rows.

## Test Results

| Policy | Accuracy | Macro Precision | Macro Recall | Macro F1 | Log Loss | Brier | Predicted Draw Rate | Actual Draw Rate |
|--------|----------|-----------------|--------------|----------|----------|-------|---------------------|------------------|
| Argmax baseline | 54.16% | 44.19% | 47.08% | 41.80% | 0.964 | 0.572 | 2.06% | 24.57% |
| Previous draw policy | 54.16% | 44.35% | 47.10% | 41.90% | 0.964 | 0.572 | 2.20% | 24.57% |
| Tuned guarded policy | 54.17% | 46.25% | 47.48% | 43.40% | 0.964 | 0.572 | 4.24% | 24.57% |

Interpretation:

- Accuracy improved slightly because most overall lift from draw tuning is naturally limited by soccer's class imbalance.
- Macro F1 improved more meaningfully because the new policy reduces draw under-prediction.
- Log loss and Brier score are unchanged because this run tunes the label-selection policy, not the probability estimates.

## Applied League Updates

| League | Runtime Route | Test Samples | Previous Accuracy | Tuned Accuracy | Draw Min | Draw Margin |
|--------|---------------|--------------|-------------------|----------------|----------|-------------|
| Copa America | Global | 32 | 56.25% | 56.25% | 0.14 | 0.07 |
| Serie A | Hybrid | 1,190 | 53.61% | 53.70% | 0.29 | 0.08 |
| Primeira Liga | Global | 946 | 57.72% | 57.72% | 0.34 | 0.03 |
| Champions League | Hybrid | 586 | 59.22% | 59.22% | 0.14 | 0.00 |
| UEFA Euro | League | 48 | 54.17% | 54.17% | 0.14 | 0.00 |

Some league updates are neutral on accuracy but still pass because they improve the guarded decision objective without degrading test performance. Small tournament samples remain volatile and should stay visibly lower-confidence in the UI.

## Next Model Improvements

1. Add rolling walk-forward retraining windows so the model is judged on multiple season-end periods, not just one holdout block.
2. Tune probability calibration by league and route after global/hybrid blending, especially for draw probabilities.
3. Add lineup/injury/news availability as explicit missing-aware features when a licensed or reliable provider is connected.
4. Backtest scoreline/xG calibration separately from 1X2 outcome accuracy.
5. Add odds-provider ingestion only with a licensed feed and responsible UX; use no-vig odds as a calibration benchmark, not a guarantee.
