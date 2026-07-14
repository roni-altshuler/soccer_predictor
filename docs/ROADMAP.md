# Execution tracker — VISION_2030.md

*Living checklist for the expansion program. Update statuses as work lands;
keep one line per item. Companion to [VISION_2030.md](VISION_2030.md), which
holds the reasoning. Statuses: ☐ not started · ◐ in progress · ☑ shipped ·
✕ dropped (say why).*

## Phase 0 — The Historical Foundation

- ◐ **Goal/red-card minute backfill** — `match_events` table (schema v2) + resumable
  backfill CLI (ESPN scoringPlays, Understat, openfootball); integrity guard: stored
  events must reproduce the final score or the match stores nothing. *Started 2026-07-14.*
- ◐ **Rarity Engine v1** — exact-count state queries over covered matches; committed
  artifacts (`backend/data/rarity/`); `/api/v1/rarity`; match-page rarity stamp
  (n≥50 gate); shareable OG rarity card. *Started 2026-07-14.*
- ◐ **Universe Browser v1** — reservoir-sampled universes from the league Monte Carlo,
  browsable final tables with divergence deltas, "find a universe where…" condition
  search, honest "never happened in 10,000 seasons" empty state. *Started 2026-07-14.*
- ☐ **Story page v1** — post-match acts/beats on match detail: turning points from goal
  timeline + win-prob deltas + rarity stamps. *Blocked on: backfill + rarity landing.*
- ☐ **Full backfill runs** — ESPN (~20k matches), Understat, openfootball; scheduled
  continuation in the pipeline workflow; coverage report on /diagnostics.
- ☐ **Justice Ledger** — luck-adjusted (xG) season tables + "deserved table" artifact
  and league-page section. Data already in warehouse.
- ◐ **Name decision** — **DECIDED 2026-07-14: Pitchverse.** Remaining: trademark +
  domain check, brand assets; the rebrand itself ships WITH the first flagship
  feature (Rarity Engine or Counterfactual Machine), not before.

## Phase 1 — The Engine (months 3–9)

- ☐ Match Engine v0 — event-stream transformer trained on StatsBomb Open Data;
  gate: beat Dixon-Coles baseline on held-out Brier before any production use.
- ☐ Dixon-Coles calibrated baseline (the yardstick; also replaces flat pre-season sims).
- ☐ Live win probability v2 — engine rollouts + conformal intervals.
- ☐ Match-state embeddings (match2vec) + similar-matches rail.
- ☐ Boardroom v1 — Quant/Historian/Skeptic agents over typed artifacts; dissent index.
- ☐ Almanac v1 — NL questions → exact counts with receipts.
- ☐ Momentum river — signature match-page visual.
- ☐ Artifact store formalization — typed, versioned run outputs ("products talk to
  artifacts, never models").

## Phase 2 — The Multiverse (months 9–18)

- ☐ Counterfactual Machine — fork finished matches, braided ghost-timeline viz.
- ☐ Scorer / cards / corners predictions (engine heads).
- ☐ Pressbox mode — live model-grounded commentary, one league first (incl. Hebrew).
- ☐ Rung-2 data subscription (Sportmonks/API-Football) once live products need it.
- ☐ Personal feed (followed teams → stories); women's leagues first-class.
- ☐ Embeds/API beta — rarity cards + win-prob widgets (B2B wedge).
- ☐ Human calibration lab — users predict, scored with the model's own rigor.
- ☐ Season Time Machine — replay a finished season 10,000×; luck distribution.

## Phase 3 — The Theater (18 months+)

- ☐ Pressure fields + pass-network constellations (WebGPU/R3F).
- ☐ 2.5D Match Theater.
- ☐ Tracking pilot (SkillCorner or video-mined) for one competition.
- ☐ Set-piece intelligence (corners GNN).
- ☐ Manager sandbox experiments (research).
- ☐ Model zoo transparency page (live calibration per subsystem).

## Standing constraints (from VISION_2030 §9)

Educational only, no betting recommendations · exact counts for public rarity
numbers · approximations labeled, unmeasured positions never faked · women's
data parity is a mission, not an afterthought · warehouse is gitignored — the
web reads committed artifacts only.
