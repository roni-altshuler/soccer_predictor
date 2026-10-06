"""Bounded offline evaluation of season-serving Elo/form adaptation.

An explicit archived schedule/result journal is required: today's result table
cannot prove yesterday's knowledge. No network, source ingestion, model export
or production artifact writes. See docs/SEASON_ADAPTATION_EVALUATION.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import scipy
import sklearn

from backend.scripts.backtest_season_projections import (
    CalibrationAccumulator,
    brier_score,
    build_table,
    multiclass_log_loss,
)
from backend.scripts.baseline_walkforward import IDX, brier, log_loss, reliability
from backend.scripts.forecast_season import (
    KEPT_PREFIXES,
    _seed_for,
    fit_head,
    outcome_probs,
    reconcile,
    score_matrix,
    simulate_season,
)
from backend.scripts.train_layered import replay_features

SCHEMA = "season-adaptation-journal/v1"
ARMS = ("adaptive", "frozen_preseason_strength")
MAX_FIXTURES = 3000
MAX_OBSERVATIONS = 12000
MAX_CUTS = 12
MAX_BYTES = 2_000_000


def timestamp(value: str, *, horizon: bool = False) -> datetime:
    """Explicit UTC only; day horizons conservatively exclude their whole day."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError("Timestamps must have an explicit UTC timezone")
    if horizon and parsed.time().isoformat() != "00:00:00":
        raise ValueError("Forecast/score horizons must be midnight UTC")
    return parsed.astimezone(timezone.utc)


class Journal:
    """Validate, canonicalize exact identities, and select visible revisions.

    Revisions replace results, never append another match to running state.
    Conflicting simultaneous observations fail closed. No fuzzy club joins.
    """

    def __init__(self, payload: dict):
        if payload.get("schema_version") != SCHEMA:
            raise ValueError("Unsupported journal schema")
        if payload.get("basis") not in ("synthetic_fixture", "archived_observations"):
            raise ValueError("Explicit synthetic/archive evidence basis required")
        if (
            not isinstance(payload.get("source_notes"), str)
            or not payload["source_notes"].strip()
        ):
            raise ValueError("Source evidence notes required")
        fixtures, observations = payload["fixtures"], payload["observations"]
        if not 0 < len(fixtures) <= MAX_FIXTURES:
            raise ValueError("Fixture count outside bounded evaluation budget")
        if not 0 < len(observations) <= MAX_OBSERVATIONS:
            raise ValueError("Observation count outside bounded evaluation budget")
        self.score_as_of = timestamp(payload["score_as_of"], horizon=True)
        self.fixtures, aliases, pairs = {}, {}, {}
        for raw in fixtures:
            uid, comp = raw["fixture_id"], raw["competition_id"]
            home, away = raw["home_key"], raw["away_key"]
            if not all(
                isinstance(x, str) and x.strip() for x in (uid, comp, home, away)
            ):
                raise ValueError("Nonempty explicit fixture/club identities required")
            if home == away or not all(x.startswith(comp + "::") for x in (home, away)):
                raise ValueError("Distinct competition-scoped club keys required")
            if type(raw["season"]) is not int:
                raise ValueError("Season must be an integer")
            day, known = date.fromisoformat(raw["local_date"]), timestamp(
                raw["known_at"]
            )
            identity = (comp, raw["season"], day, home, away)
            pair = (comp, raw["season"], home, away)
            if uid in aliases and aliases[uid] != identity:
                raise ValueError("Fixture ID changes identity across observations")
            if pair in pairs and pairs[pair] != identity:
                raise ValueError("Repeated ordered pair or changed fixture date")
            aliases[uid], pairs[pair] = identity, identity
            row = {
                "match_uid": uid,
                "competition_id": comp,
                "season": raw["season"],
                "local_date": day,
                "home_key": home,
                "away_key": away,
                "known_at": known,
            }
            if identity in self.fixtures:
                previous = self.fixtures[identity]
                row["match_uid"] = min(uid, previous["match_uid"])
                row["known_at"] = min(known, previous["known_at"])
            self.fixtures[identity] = row

        self.revisions = defaultdict(dict)
        for raw in observations:
            if raw["fixture_id"] not in aliases:
                raise ValueError("Result references an unknown fixture")
            key = aliases[raw["fixture_id"]]
            observed = timestamp(raw["observed_at"])
            hs, away_score = raw["home_score"], raw["away_score"]
            if any(type(x) is not int or x < 0 for x in (hs, away_score)):
                raise ValueError("Final scores must be nonnegative integers")
            fixture = self.fixtures[key]
            if (
                observed.date() < fixture["local_date"]
                or observed < fixture["known_at"]
            ):
                raise ValueError("Result observed before its fixture date/knowledge")
            scores = (hs, away_score)
            previous = self.revisions[key].get(observed)
            if previous is not None and previous != scores:
                raise ValueError("Conflicting results at the same observation time")
            self.revisions[key][observed] = scores
        self.audit = {
            "input_fixture_rows": len(fixtures),
            "unique_fixtures": len(self.fixtures),
            "input_result_observations": len(observations),
            "unique_result_observations": sum(len(v) for v in self.revisions.values()),
        }

    def results_before(self, cutoff: datetime) -> list[dict]:
        rows = []
        for key, fixture in self.fixtures.items():
            if fixture["known_at"] >= cutoff or fixture["local_date"] >= cutoff.date():
                continue
            visible = [t for t in self.revisions[key] if t < cutoff]
            if not visible:
                continue
            observed = max(visible)
            hs, away_score = self.revisions[key][observed]
            rows.append(
                dict(
                    fixture,
                    home_score=hs,
                    away_score=away_score,
                    result=(
                        "H" if hs > away_score else ("A" if hs < away_score else "D")
                    ),
                    observed_at=observed,
                )
            )
        # Natural identity ordering: adding an identical provider alias cannot
        # change same-day Elo updates, training row order or simulation order.
        return sorted(
            rows,
            key=lambda m: (
                m["local_date"],
                m["competition_id"],
                m["season"],
                m["home_key"],
                m["away_key"],
            ),
        )


def replay_and_fit(played: list[dict]):
    if len(played) < 30 or {m["result"] for m in played} != set(IDX):
        raise ValueError("Need at least 30 earlier results covering H/D/A")
    X, names, y, _, state = replay_features(played)
    cols = [i for i, name in enumerate(names) if name.startswith(KEPT_PREFIXES)]
    return state, fit_head(X, y, cols), names, cols


def standings(matches: list[dict], teams: list[str]) -> dict:
    table = build_table(
        [dict(m, home=m["home_key"], away=m["away_key"]) for m in matches], teams
    )
    return {
        r["team"]: {
            "points": r["points"],
            "gd": r["goal_diff"],
            "gf": r["goals_for"],
            "played": r["played"],
        }
        for r in table
    }


def metrics(p: np.ndarray, y: np.ndarray) -> dict:
    bins, ece = reliability(p, y)
    return {
        "n": len(y),
        "brier": brier(p, y),
        "log_loss": log_loss(p, y),
        "calibration": {"n": 3 * len(y), "ece": ece, "bins": bins},
    }


def run_evaluation(payload: dict, *, sims: int = 1000, seed: int = 17) -> dict:
    if not 100 <= sims <= 5000:
        raise ValueError("Simulation count must be within 100..5000")
    journal = Journal(payload)
    evaluations = payload["evaluations"]
    if not evaluations or sum(len(e["cuts"]) for e in evaluations) > MAX_CUTS:
        raise ValueError("Need 1..12 bounded forecast horizons")
    seen_seasons, points = set(), []
    title_calibration = {a: CalibrationAccumulator() for a in ARMS}
    all_p, all_y = {a: [] for a in ARMS}, []
    score_rows = journal.results_before(journal.score_as_of)
    scored_ids = set()
    for evaluation in sorted(
        evaluations, key=lambda e: (e["season"], e["competition_id"])
    ):
        comp, season = evaluation["competition_id"], evaluation["season"]
        if (comp, season) in seen_seasons:
            raise ValueError("Duplicate evaluation season")
        seen_seasons.add((comp, season))
        preseason = timestamp(evaluation["preseason_as_of"], horizon=True)
        cuts = sorted(timestamp(c, horizon=True) for c in evaluation["cuts"])
        if not cuts or len(cuts) != len(set(cuts)) or cuts[0] != preseason:
            raise ValueError("Unique cuts must begin with the preseason horizon")
        if cuts[-1] >= journal.score_as_of:
            raise ValueError("Scoring horizon must follow every forecast horizon")
        fixtures = sorted(
            (
                f
                for f in journal.fixtures.values()
                if (f["competition_id"], f["season"]) == (comp, season)
            ),
            key=lambda f: (f["local_date"], f["home_key"], f["away_key"]),
        )
        teams = sorted({f[k] for f in fixtures for k in ("home_key", "away_key")})
        if len(teams) < 4 or len(fixtures) != len(teams) * (len(teams) - 1):
            raise ValueError(
                "Evaluation requires a complete double round-robin schedule"
            )
        if any(
            f["known_at"] >= preseason or f["local_date"] < preseason.date()
            for f in fixtures
        ):
            raise ValueError(
                "Full schedule must be known before a genuine preseason cut"
            )
        final = [
            m
            for m in score_rows
            if (m["competition_id"], m["season"]) == (comp, season)
        ]
        if len(final) != len(fixtures):
            raise ValueError(
                "Scoring requires every season result; partial truth refused"
            )
        truth = {m["match_uid"]: m for m in final}
        final_table = build_table(
            [dict(m, home=m["home_key"], away=m["away_key"]) for m in final], teams
        )
        champion = final_table[0]["team"]
        frozen, _, _, _ = replay_and_fit(journal.results_before(preseason))
        for cut in cuts:
            played = journal.results_before(cut)
            adaptive, head, names, cols = replay_and_fit(played)
            done = [
                m
                for m in played
                if (m["competition_id"], m["season"]) == (comp, season)
            ]
            done_ids = {m["match_uid"] for m in done}
            remaining = [f for f in fixtures if f["match_uid"] not in done_ids]
            if not remaining or any(f["local_date"] < cut.date() for f in remaining):
                raise ValueError("Past unresolved fixtures or empty forecast horizon")
            table = standings(done, teams)
            recent = [m for m in played[-40000:] if m["competition_id"] == comp]
            scale = (
                (
                    float(np.mean([m["home_score"] for m in recent])),
                    float(np.mean([m["away_score"] for m in recent])),
                )
                if recent
                else (1.5, 1.2)
            )
            y = np.array([IDX[truth[f["match_uid"]]["result"]] for f in remaining])
            all_y.extend(y.tolist())
            scored_ids.update(f["match_uid"] for f in remaining)
            point = {
                "competition_id": comp,
                "season": season,
                "as_of": cut.isoformat(),
                "preseason_as_of": preseason.isoformat(),
                "train_n": len(played),
                "latest_training_date": str(played[-1]["local_date"]),
                "latest_training_observed_at": max(
                    m["observed_at"] for m in played
                ).isoformat(),
                "played_n": len(done),
                "remaining_n": len(remaining),
                "standings": table,
                "champion": champion,
                "arms": {},
                "forecasts": [],
            }
            probabilities = {}
            for arm, state in zip(ARMS, (adaptive, frozen)):
                # Strip outcomes before emitting; all remaining matches use one
                # state frozen at this cut, exactly as forecast_season serves.
                features = np.array(
                    [[state.emit(f)[name] for name in names] for f in remaining]
                )
                p = head.predict_proba(features[:, cols])
                probabilities[arm] = p
                all_p[arm].extend(p.tolist())
                simulation_fixtures = []
                for fixture, target in zip(remaining, p):
                    lh, la = reconcile(target, *scale)
                    coherent = np.array(outcome_probs(score_matrix(lh, la)))
                    # Match the publisher's home/away guard; draw follows by sum.
                    if np.max(np.abs(coherent[[0, 2]] - target[[0, 2]])) > 1e-3:
                        raise ValueError("Serving scoreline reconciliation failed")
                    simulation_fixtures.append(dict(fixture, _lh=lh, _la=la))
                sim = simulate_season(
                    simulation_fixtures,
                    table,
                    sims=sims,
                    rng=np.random.default_rng(
                        _seed_for(f"{comp}:{season}:{cut.isoformat()}", seed)
                    ),
                )
                title = {t: float((sim[t]["pos"] == 0).mean()) for t in teams}
                title_calibration[arm].add_many(title, {champion})
                point["arms"][arm] = {
                    "match_1x2": metrics(p, y),
                    "title_probabilities": title,
                    "title_brier": brier_score(title, {champion}),
                    "title_log_loss": multiclass_log_loss(title, champion, eps=1e-6),
                }
            point["forecasts"] = [
                {
                    "fixture_id": f["match_uid"],
                    "date": str(f["local_date"]),
                    "result": truth[f["match_uid"]]["result"],
                    **{a: probabilities[a][i].tolist() for a in ARMS},
                }
                for i, f in enumerate(remaining)
            ]
            points.append(point)
    summary = {}
    for arm in ARMS:
        summary[arm] = {
            "match_1x2": metrics(np.array(all_p[arm]), np.array(all_y)),
            "title": {
                "n_forecasts": len(points),
                "n_seasons": len(evaluations),
                "brier": float(
                    np.mean([p["arms"][arm]["title_brier"] for p in points])
                ),
                "log_loss": float(
                    np.mean([p["arms"][arm]["title_log_loss"] for p in points])
                ),
                "calibration": title_calibration[arm].as_dict(),
            },
        }
    delta = {
        surface: {
            metric: summary[ARMS[0]][surface][metric]
            - summary[ARMS[1]][surface][metric]
            for metric in ("brier", "log_loss")
        }
        for surface in ("match_1x2", "title")
    }
    return {
        "schema_version": "season-adaptation-evaluation/v1",
        "basis": payload["basis"],
        "source_notes": payload["source_notes"],
        "score_as_of": journal.score_as_of.isoformat(),
        "input_sha256": hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest(),
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "scikit_learn": sklearn.__version__,
        },
        "config": {"sims": sims, "seed": seed, "title_log_loss_eps": 1e-6},
        "protocol": (
            "Common as-of head and goal scale; frozen arm holds preseason Elo/form; "
            "identical standings, fixtures and simulation RNG seed"
        ),
        "production_eligible": False,
        "limitations": [
            (
                "Synthetic scores only exercise the contract; "
                "they establish no real-world improvement."
                if payload["basis"] == "synthetic_fixture"
                else "Chronology relies on supplied archived observation timestamps "
                "and verified identities; this tool does not certify source truth."
            ),
            "Repeated horizons share fixtures and season outcomes; pooled rows are "
            "not independent samples. No significance or promotion claim.",
            "Frozen strength shares the adaptive as-of head/refit and goal scale: "
            "this isolates feature updates, not all retraining effects.",
            "Requires an unchanged, preseason-known full schedule and complete "
            "final truth; reschedules, cancellations and missing observations "
            "fail closed.",
            "Uses serving points/GD/GF/stable-key tiebreak and finite Monte Carlo; "
            "official head-to-head/playoff rules and live publication are unverified.",
        ],
        "audit": journal.audit,
        "n_unique_scored_fixtures": len(scored_ids),
        "summary": summary,
        "delta_adaptive_minus_frozen": delta,
        "points": points,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sims", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args(argv)
    if args.input.resolve() == args.output.resolve():
        parser.error("Output must not overwrite the input journal")
    production = Path(__file__).resolve().parents[1] / "data"
    if args.output.resolve().is_relative_to(production):
        parser.error("Evaluation output must be outside production backend/data")
    try:
        if args.input.stat().st_size > MAX_BYTES:
            raise ValueError("Input exceeds bounded byte budget")
        payload = json.loads(args.input.read_text())
        report = run_evaluation(payload, sims=args.sims, seed=args.seed)
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as exc:
        parser.exit(2, f"Evaluation refused: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "basis",
                    "n_unique_scored_fixtures",
                    "summary",
                    "delta_adaptive_minus_frozen",
                )
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
