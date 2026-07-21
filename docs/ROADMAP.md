# Execution tracker — VISION_2030.md

*Living checklist for the expansion program. Update statuses as work lands;
keep one line per item. Companion to [VISION_2030.md](VISION_2030.md), which
holds the reasoning. Statuses: ☐ not started · ◐ in progress · ☑ shipped ·
✕ dropped (say why).*

## Phase 0 — The Historical Foundation

- ☑ **Goal/red-card minute backfill** — `match_events` + `match_event_coverage`
  (schema v4) + resumable CLI (ESPN keyEvents, Understat shots; openfootball ruled out
  — no minutes in source). Integrity guard: events must reproduce the final score or
  nothing stores; verified-empty 0-0s tracked so denominators stay unbiased.
  *Shipped 2026-07-14; full ESPN run (~20k matches) in progress.*
- ☑ **Rarity Engine v1** — exact-count state queries gated on coverage membership;
  committed artifacts; `/api/v1/rarity`; match-page rarity stamp (n≥50); OG rarity
  card. First real claim: down 2 at 79' → 4 of 252 (1.6%). *Shipped 2026-07-14.*
- ☑ **Universe Browser v1** — reservoir-sampled universes (same seeded PRNG,
  deterministic), browsable tables with divergence deltas, condition search with true
  found-in-N counts, honest never-happened empty state. On both /simulator and league
  pages. *Shipped 2026-07-14. Knockout-bracket universes deferred.*
- ☑ **Story page v1** — finished matches open with "The story": acts + beats weighted
  by exact historical win-rate swings (rarity artifact as the empirical win-prob
  function; n≥50 gates; turning point = largest counted swing ≥15pp; zero LLM calls).
  *Shipped 2026-07-14.*
- ☑ **Full backfill runs** — ESPN + Understat complete: 35,463 covered matches
  (the pre-2014 remainder has no minute-level source anywhere — honest boundary).
  Artifacts regenerated + shipped. *2026-07-15.*
- ☑ **Self-maintaining pipeline** — daily `event_backfill.yml`: ingest new
  finished matches → incremental event backfill → regenerate all artifacts
  (rarity, justice, coverage, params, sim priors) → coverage regression guard →
  warehouse republish to models-latest. Coverage report live at /diagnostics
  (sidebar + palette). No continue-on-error anywhere. *Shipped 2026-07-15.*
- ☑ **Justice Ledger** — xPts vs actual points, ≥90% coverage gates, league-page
  section; validated against the real 2022-23 PL table. *Shipped 2026-07-15.*
- ☑ **Name decision + rebrand** — **Pitchverse**, shipped with the Counterfactual
  Machine per the decided policy (2026-07-15): wordmark, metadata, manifest, OG
  cards, marketing, docs; `fotpredict.*` storage keys preserved. Recon: no
  football/sports product or indexed trademark collides; **pitchverse.app appears
  unregistered** (register it, then flip the domain strings); pitchverse.com is
  parked/aftermarket. Remaining for the user: domain registration.

## Phase 1 — The Engine (months 3–9)

- ◐ Match Engine v0 — built + honestly gated, NOT production. Redesigned for
  the real hardware (no GPU): per-minute state-conditioned intensity model
  nested on the calibrated baseline, trained on our own 35,463 timelines
  (10× StatsBomb), exact-DP scoring, pluggable walk-forward harness that
  reproduces the baseline byte-identically. Gate on 1,866 held-out fixtures:
  pooled ΔBrier +0.0004 (CI straddles zero) → statistically indistinguishable,
  gate not met; baseline stays production, artifact records `passed: false`.
  The `rollout_from_state` kernel is the retained asset — it powers live
  win-prob v2 and the Counterfactual Machine, where state dynamics matter
  (at kickoff they integrate out). v1 path: StatsBomb dense pretraining.
  *2026-07-15.* **In-match gate PASSED later that day**: state-conditional
  predictions beat the exact-count baseline at all five checkpoints (15'–75',
  1,587 held-out fixtures, every CI below zero, leakage-free count table
  rebuilt for the comparison) — the engine is production for in-match
  surfaces; pre-match stays with the baseline. Kernel exported + TS-ported
  (1e-6 parity), anchors validated with hard sanity bounds.
- ☑ Dixon-Coles calibrated baseline — walk-forward backtested (beats uniform by
  0.03–0.09 Brier, trails de-vigged market by 0.005–0.014); params artifact
  committed; NWSL fitted. *Shipped 2026-07-15.*
- ☑ Sim strength priors — multi-season priors blended into league simulations
  (prior worth 12 matches, shrinks as results accumulate); conservative alias
  resolution, unmatched teams keep legacy behavior; pre-season title odds now
  differentiate (eng.1: flat 5% → 40.6/36.0/9.3% top three). *Shipped 2026-07-15.*
  Remaining: knockout brackets need cross-competition-comparable ratings first.
- ☐ Live win probability v2 — engine rollouts + conformal intervals.
- ☑ Match-state embeddings (match2vec) + similar-matches rail — deterministic
  timeline vectors (team-identity-free) over all covered matches, committed
  index, "matches that unfolded like this one" on finished-match pages;
  regenerates daily in the pipeline. *Shipped 2026-07-15.*
- ☑ Boardroom v1 — grounded three-persona debate (Quant/Historian/Skeptic) +
  dissent meter on the prediction tab; verifier rejects any ungrounded number.
  **LIVE in production 2026-07-19** on the free Gemini tier (self-heals to the
  newest Flash model; debate step isolated from the core pipeline). *Shipped.*
- ☑ Almanac v0 — structured query builder → exact counts + precedents at /almanac
  (no LLM). *Shipped 2026-07-15.* v1 (natural-language input) awaits LLM key decision.
- ☑ Momentum river — stacked win/draw/loss probability bands across the match
  timeline, exact counts only (n≥50 gates, steps only at goals + 5' buckets),
  mounted above the story on finished-match pages. *Shipped 2026-07-15.*
- ☐ Artifact store formalization — typed, versioned run outputs ("products talk to
  artifacts, never models").

## Phase 2 — The Multiverse (months 9–18)

- ☑ Counterfactual Machine — "What if" tab on covered finished matches: erase
  real events or fork at any minute, engine plays out the rest; outcome bands,
  projected finals, braid visual (real path splits into an honest probability
  fan — one distribution, never a fabricated path). Pulled forward from
  Phase 2; shipped WITH the Pitchverse rebrand. *Shipped 2026-07-15.*
- ☐ Scorer / cards / corners predictions (engine heads).
- ☐ Pressbox mode — live model-grounded commentary, one league first (incl. Hebrew).
- ☐ Rung-2 data subscription (Sportmonks/API-Football) once live products need it.
- ☐ Personal feed (followed teams → stories); women's leagues first-class.
- ☐ Embeds/API beta — rarity cards + win-prob widgets (B2B wedge).
- ☐ Human calibration lab — users predict, scored with the model's own rigor.
- ☐ Season Time Machine — replay a finished season 10,000×; luck distribution.

## Phase 3 — The Theater (18 months+)

- ◐ **Match Theater v0 — SHIPPED 2026-07-19, pulled far forward.** A Canvas-2D
  3D "win chance landscape" on finished-match Overview tabs: height = exact
  historical win rate per (minute, score-difference) tile (green win / amber
  level / red loss), the bright line traces the real match stepping at each
  goal; drag to orbit, hover/tap for the counted value, reduced-motion = one
  static interactive frame. No 3D dependency, no WebGL. The remaining Phase-3
  theater items below (pressure fields, tracking, 2.5D) are the deeper build.
- ☐ Pressure fields + pass-network constellations (WebGPU/R3F).
- ☐ 2.5D Match Theater (event-driven player positions).
- ☐ Tracking pilot (SkillCorner or video-mined) for one competition.
- ☐ Set-piece intelligence (corners GNN).
- ☐ Manager sandbox experiments (research).
- ☐ Model zoo transparency page (live calibration per subsystem).

## Standing constraints (from VISION_2030 §9)

Educational only, no betting recommendations · exact counts for public rarity
numbers · approximations labeled, unmeasured positions never faked · women's
data parity is a mission, not an afterthought · warehouse is gitignored — the
web reads committed artifacts only.
