# ADR 0001 — NVIDIA Triton over Ray Serve / BentoML for ML inference

**Status:** Accepted (2026-05-24)
**Owners:** `prediction-svc` team
**Supersedes:** v1 in-process PyTorch load in FastAPI lifespan

## Context

`prediction-svc` serves two parallel models (`unified_M`, `unified_F`) plus their scalers and isotonic calibrators. The hottest workload is matchday: 60+ simultaneous matches, each triggering pre-match prediction (cacheable) plus in-play re-predictions after every goal/red/sub-on event. We also burst predict during Monte Carlo simulation jobs (10k–100k iterations per request, see ADR-0005). The v1 approach — `torch.load(...)` in the FastAPI process — does not survive any of these requirements: no batching, no canary, no multi-model isolation, no GPU/CPU mix.

## Decision

Adopt **NVIDIA Triton Inference Server 24.x** as the inference layer. The Python pre/post backends ship with each model so the scaler and the isotonic calibrator live inside the Triton ensemble — no calibrator-next-to-`.pt` split-brain.

## Alternatives considered

| Requirement | Triton | Ray Serve | BentoML |
|---|---|---|---|
| Concurrent men + women models, low-latency | Native model repository + per-model `instance_group` | Possible but more wiring | Possible but heavier |
| Dynamic batching for matchday spikes | First class | Yes (request batching) | Limited |
| GPU/CPU mix on same server | Yes (`instance_group` with KIND_GPU/KIND_CPU) | Yes via Ray | Limited |
| Multi-model versioning + canary | Built in | Manual | Manual |
| Python custom logic (bivariate Poisson grid decode) | Python backend | Native Python | Native Python |
| Maturity / ops tooling | Most mature; `perf_analyzer`, Prometheus metrics | Newer | Newer |

## Consequences

**Positive**
- Dynamic batching (`max_queue_delay_microseconds: 5000`) → 4–6× throughput on matchday refresh.
- Same Triton pod serves men + women + canary versions, with traffic split decided by `prediction-svc` selector reading `prediction_models.status`.
- Model promotion = atomic transaction on the registry row + Triton repo reload via `POST /v2/repository/models/<name>/load`.

**Negative**
- Adds a Triton operational surface (model repo layout, `config.pbtxt`, ensemble schema). Mitigated by templating `config.pbtxt` from MLflow run metadata in `apps/training-jobs/src/training/promote.py`.
- Cold-start latency on first request to a freshly loaded model; mitigated by pinning `unified_M` and `unified_F` to `instance_group.count ≥ 1` permanently.
- GPU egress cost on training nodes; mitigated by using spot g5.xlarge for routine retrains and on-demand only for promotion runs (see ADR-0005 for cost framing).

## Implementation notes

- Triton model repo lives in `s3://fotpredict-models/triton/<family>/<gender>/<version>/` and is mounted via the s3fs CSI driver on the Triton pods.
- Ensemble layout per gender (preprocess → torch → postprocess): see blueprint §7.3.
- `prediction-svc` falls back to a pure-Python ELO-Poisson model (ported from v1 `backend/services/prediction/model.py`) for >2s of Triton 5xx — flagged by `prediction.fallback_to_elo`. The UI surfaces this as `confidence_source: 'fallback'`.

## References

- Blueprint §7 — ML Serving Architecture (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`)
- v1 inference adapter: [`../../../backend/services/prediction/unified_inference.py`](../../../backend/services/prediction/unified_inference.py)
