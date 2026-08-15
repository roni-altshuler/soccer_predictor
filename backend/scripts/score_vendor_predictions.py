"""Score a vendor's pre-match probabilities against ours, on the same fixtures.

WHY THIS EXISTS
---------------
`capture_vendor_predictions.py` buys the answer; this decides whether it is
better. The question — "if theirs is better, use theirs" — is only answerable
as a PAIRED comparison: same fixtures, same outcomes, same scoring rule, both
forecasts fixed before kickoff.

THE DECISION RULE IS PRE-REGISTERED, HERE, BEFORE THE DATA LANDS
----------------------------------------------------------------
Written down in advance so neither side of the argument can move the goalposts
once the numbers arrive. The vendor's triple replaces ours only if ALL of:

1. it beats the served model on paired Brier over the scored fixtures,
2. the paired bootstrap CI on that difference excludes zero, and
3. it closes more of the gap to the market price than ours does, on the
   fixtures where a pre-kickoff price exists.

Beating us but not the market makes it a candidate FEATURE, not a replacement:
this repo's landmine list already records that a forecaster beating the closing
line is the signature of a harness bug, and `benchmark_market_blend.py` is where
a new information source earns its place.

Falling short of (1) or (2) means keep ours. That is the default and it needs no
further argument — the burden is on the challenger.

WHERE THE NUMBERS COME FROM (all local; this script makes no network calls)
--------------------------------------------------------------------------
* theirs    `backend/data/predictions/vendor_predictions.jsonl`
* ours      `backend/data/predictions/predictions_*.json` — the durable record,
            which keeps a fixture after it is played and carries a
            `prediction_timestamp`. `season_fixtures.json` cannot be used: it is
            the REMAINING set, so a fixture's forecast is gone by the time its
            result exists. Retrofitting one afterwards would be exactly the sin
            this whole exercise is set up to avoid.
* outcomes  the `actual_winner` that `fetch_outcomes.py` writes back into the
            same record.
* market    `backend/data/odds/snapshots-*.jsonl`, joined on the ESPN match id,
            taking the latest snapshot captured strictly before kickoff. That is
            NOT the closing line the warehouse benchmarks quote (.5757); it is
            the last price this repo happened to sample. Labelled accordingly
            everywhere it is printed.

BOTH SIDES MUST HAVE BEATEN KICKOFF, NOT JUST THEIRS
----------------------------------------------------
The vendor row carries `before_kickoff` and the exact kickoff instant; our
record carries `prediction_timestamp`. A pair is scored only when both stamps
precede that kickoff. Holding the challenger to a rule we exempt ourselves from
would flatter us, and the answer would be worthless.

    python3 -m backend.scripts.score_vendor_predictions
    python3 -m backend.scripts.score_vendor_predictions --json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PRED_DIR = ROOT / "backend" / "data" / "predictions"
VENDOR_FILE = PRED_DIR / "vendor_predictions.jsonl"
ODDS_DIR = ROOT / "backend" / "data" / "odds"
OUT = ROOT / "backend" / "data" / "diagnostics" / "vendor_vs_ours.json"

OUTCOMES = ("home", "draw", "away")

# Our monthly record stores a display name; the vendor capture stores our
# competition id. Duplicated from `fetch_outcomes.LEAGUE_TO_ESPN` rather than
# imported because that module pulls in httpx, which the capture path
# deliberately does without. `test_score_vendor_predictions.py` parses the
# other file and fails if the two ever disagree.
LEAGUE_TO_ESPN: Dict[str, str] = {
    "Premier League": "eng.1",
    "La Liga": "esp.1",
    "Bundesliga": "ger.1",
    "Serie A": "ita.1",
    "Ligue 1": "fra.1",
    "MLS": "usa.1",
    "Eredivisie": "ned.1",
    "Primeira Liga": "por.1",
}

# A floor, NOT a power calculation — it just stops the script pronouncing on a
# handful of matchday-one fixtures. The honest sample size is computed from the
# observed paired variance and printed next to it.
MIN_PAIRED = 200
TARGET_EFFECT = 0.01  # Brier difference worth caring about
# (z_0.975 + z_0.80)^2, the usual two-sided 80%-power constant.
POWER_CONST = 7.849


# --------------------------------------------------------------------------
# scoring — identical definitions to benchmark_unified_vs_dc.py, on purpose
# --------------------------------------------------------------------------
def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def log_loss(p: Sequence[float], idx: int) -> float:
    """Clamped at 1e-15, as everywhere else in this repo.

    A vendor that says 0% and is wrong about it earns ~34.5 here rather than
    infinity. The clamp keeps a mean printable; `impossible_calls` in the
    summary is what stops it being quietly forgiven.
    """
    return -math.log(max(1e-15, p[idx]))


def paired_bootstrap(
    a: Sequence[float], b: Sequence[float], *, iters: int = 10000, seed: int = 12345
) -> Dict[str, float]:
    """95% CI on mean(a) - mean(b), resampling fixtures (not forecasters)."""
    assert len(a) == len(b)
    n = len(a)
    if n == 0:
        return {}
    rng = np.random.default_rng(seed)
    diff = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    idx = rng.integers(0, n, size=(iters, n))
    means = diff[idx].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return {
        "mean_diff": round(float(diff.mean()), 5),
        "ci95_low": round(float(lo), 5),
        "ci95_high": round(float(hi), 5),
        "p_a_better": round(float((means < 0).mean()), 4),
        "significant": bool(hi < 0 or lo > 0),
    }


def required_n(a: Sequence[float], b: Sequence[float], effect: float = TARGET_EFFECT) -> Optional[int]:
    """Fixtures needed to resolve `effect` at 80% power, from the observed spread.

    Paired differences are far less variable than either series, which is the
    whole reason to pair them — quoting a sample size off the raw Brier spread
    would overstate the wait by an order of magnitude.
    """
    if len(a) < 2 or effect <= 0:
        return None
    diff = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    sd = float(diff.std(ddof=1))
    # Not `sd <= 0`: subtracting two constant series leaves float dust around
    # 1e-17 rather than a clean zero, and that dust divides through to "you
    # need 1 more fixture" — the most dangerous answer this function could
    # give. A pair that never disagrees carries no information about how long
    # the wait is, so it says so.
    if not math.isfinite(sd) or sd < 1e-9:
        return None
    return int(math.ceil(POWER_CONST * (sd / effect) ** 2))


# --------------------------------------------------------------------------
# joining
# --------------------------------------------------------------------------
_NOISE_SUFFIXES = (
    "fc", "cf", "sc", "ac", "afc", "sv", "sk", "ks", "as", "rc", "cd", "ud",
    "u-19", "ii", "b", "(w)", "women", "femenil", "femenino", "feminino",
    "feminine",
)
_NOISE_PREFIXES = ("fc ", "ac ", "ss ", "as ", "rc ", "sv ", "1.", "1. ", "vfl ", "vfb ", "tsg ")


def norm_team(name: str) -> str:
    """Lowercase, strip diacritics + common club-name noise.

    Kept byte-identical to `team_resolver._normalise` (which cannot be imported
    here: its package `__init__` pulls in httpx). A test pins the two together,
    because two normalisers that drift apart join 96% of the time and lose the
    other 4% in silence.
    """
    import re
    import unicodedata

    if not name:
        return ""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))
    lower = ascii_only.lower().strip()
    lower = re.sub(r"[._\-]+", " ", lower)
    lower = re.sub(r"\s+", " ", lower).strip()
    for prefix in _NOISE_PREFIXES:
        if lower.startswith(prefix):
            lower = lower[len(prefix):].strip()
            break
    parts = lower.split()
    while parts and parts[-1] in _NOISE_SUFFIXES:
        parts.pop()
    return " ".join(parts)


def fixture_key(competition_id: str, date: str, home: str, away: str) -> Tuple[str, str, str, str]:
    return (competition_id, date, norm_team(home), norm_team(away))


# Structural words that carry no identity. The shared normaliser only strips
# these at the ends of a name; the vendor drops them from the middle too.
_JOIN_NOISE = set(_NOISE_SUFFIXES) | {"de", "da", "do", "del", "of", "the", "club"}


def relaxed_key(name: str) -> frozenset:
    """An order-free, punctuation-free, singular token set for a club name.

    Measured against the first capture, the exact key missed four of fourteen
    joinable fixtures, and each miss was cosmetic:

        academico viseu   / academico de viseu    a connector word
        cambuur           / sc cambuur            a tag in front, not behind
        dc united         / d c united            "D.C." split on its dots
        new york red bulls / red bull new york    reordered, and pluralised

    So: drop noise tokens wherever they appear, glue runs of single letters
    back together, singularise, and compare as a SET. That is a deliberately
    loose comparison, which is why it is only ever used behind the uniqueness
    gate in `pair_rows` — loose enough to join, never trusted to disambiguate.
    """
    tokens = [t for t in norm_team(name).split() if t not in _JOIN_NOISE]
    glued: List[str] = []
    for token in tokens:
        if len(token) == 1 and glued and len(glued[-1]) <= 2 and glued[-1].isalpha():
            glued[-1] += token
        else:
            glued.append(token)
    return frozenset(t[:-1] if len(t) > 3 and t.endswith("s") else t for t in glued)


def parse_ts(value: object) -> Optional[datetime]:
    """ISO-8601 in, aware datetime out. A naive stamp is read as UTC."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def outcome_index(winner: object) -> Optional[int]:
    try:
        return OUTCOMES.index(winner)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def load_vendor(path: Path) -> List[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def load_ours(pred_dir: Path) -> Dict[Tuple[str, str, str, str], dict]:
    """Every fixture we have ever published a forecast for, keyed for the join."""
    out: Dict[Tuple[str, str, str, str], dict] = {}
    for path in sorted(pred_dir.glob("predictions_*.json")):
        try:
            blob = json.loads(path.read_text(encoding="utf8"))
        except json.JSONDecodeError:
            continue
        for p in blob.get("predictions") or []:
            cid = LEAGUE_TO_ESPN.get(p.get("league"))
            if not cid or not p.get("match_date"):
                continue
            out[fixture_key(cid, p["match_date"], p.get("home_team") or "", p.get("away_team") or "")] = p
    return out


def devig(oh: float, od: float, oa: float) -> Optional[List[float]]:
    """Decimal odds -> probabilities by inverse normalisation."""
    if min(oh, od, oa) <= 0:
        return None
    inv = [1.0 / oh, 1.0 / od, 1.0 / oa]
    s = sum(inv)
    return [x / s for x in inv] if s > 0 else None


def load_prices(odds_dir: Path) -> Dict[str, List[dict]]:
    """ESPN event id -> every snapshot we hold, unsorted."""
    prices: Dict[str, List[dict]] = {}
    if not odds_dir.exists():
        return prices
    for path in sorted(odds_dir.glob("snapshots-*.jsonl")):
        for line in path.read_text(encoding="utf8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            mid = str(row.get("match_id") or "")
            # "espn_eng.1_401879301" -> "401879301"
            event_id = mid.rsplit("_", 1)[-1]
            if event_id:
                prices.setdefault(event_id, []).append(row)
    return prices


def latest_price_before(snapshots: List[dict], kickoff: datetime) -> Optional[List[float]]:
    """The last price sampled strictly before kickoff, de-vigged.

    Not the closing line — the last one this repo happened to take. Every
    caller labels it as such.
    """
    best: Optional[Tuple[datetime, dict]] = None
    for snap in snapshots:
        at = parse_ts(snap.get("captured_at"))
        if at is None or at >= kickoff:
            continue
        if best is None or at > best[0]:
            best = (at, snap)
    if best is None:
        return None
    row = best[1]
    try:
        return devig(float(row["odds_home"]), float(row["odds_draw"]), float(row["odds_away"]))
    except (KeyError, TypeError, ValueError):
        return None


def relaxed_lookup(
    key: Tuple[str, str, str, str],
    same_day: List[Tuple[Tuple[str, str, str, str], dict]],
) -> Tuple[Optional[dict], str]:
    """The one fixture on this day whose two sides both match loosely, or none.

    The gate is the point. Relaxing a name comparison until it matches will
    always find something; requiring that it match EXACTLY ONE fixture on the
    day is what stops it finding the wrong one. Two candidates is a refusal,
    not a coin toss.
    """
    home, away = relaxed_key(key[2]), relaxed_key(key[3])
    if not home or not away:
        return None, "name_join_failed"
    hits = [
        pred
        for cand, pred in same_day
        if relaxed_key(cand[2]) == home and relaxed_key(cand[3]) == away
    ]
    if len(hits) == 1:
        return hits[0], "relaxed"
    return None, "name_join_ambiguous" if hits else "name_join_failed"


def pair_rows(
    vendor: List[dict],
    ours: Dict[Tuple[str, str, str, str], dict],
    prices: Dict[str, List[dict]],
) -> Tuple[List[dict], Counter]:
    """Every vendor row lands in exactly one bucket. Nothing is dropped quietly."""
    dropped: Counter = Counter()
    paired: List[dict] = []

    by_day: Dict[Tuple[str, str], List[Tuple[Tuple[str, str, str, str], dict]]] = {}
    for cand, pred in ours.items():
        by_day.setdefault((cand[0], cand[1]), []).append((cand, pred))

    for row in vendor:
        kickoff = parse_ts(row.get("kickoff"))
        triple = [row.get("p_home"), row.get("p_draw"), row.get("p_away")]

        if any(v is None for v in triple):
            dropped["vendor_gave_no_triple"] += 1
            continue
        if row.get("before_kickoff") is not True:
            dropped["vendor_captured_after_kickoff"] += 1
            continue
        if kickoff is None:
            dropped["vendor_kickoff_unreadable"] += 1
            continue

        date = kickoff.astimezone(timezone.utc).strftime("%Y-%m-%d")
        key = fixture_key(
            row.get("competition_id") or "", date, row.get("home") or "", row.get("away") or ""
        )
        mine = ours.get(key)
        joined_by = "exact"
        if mine is None:
            # Either a competition we do not forecast, or a spelling the shared
            # normaliser did not reconcile. Separating the two matters: the
            # first is a scope decision, the second is a bug.
            if not any(k[0] == key[0] for k in ours):
                dropped["ours_never_forecast_this_competition"] += 1
                continue
            same_day = by_day.get((key[0], key[1]))
            if not same_day:
                dropped["ours_never_forecast_this_fixture"] += 1
                continue
            mine, joined_by = relaxed_lookup(key, same_day)
            if mine is None:
                dropped[joined_by] += 1
                continue

        made_at = parse_ts(mine.get("prediction_timestamp"))
        if made_at is None or made_at >= kickoff:
            dropped["ours_not_stamped_before_kickoff"] += 1
            continue

        idx = outcome_index(mine.get("actual_winner"))
        if idx is None:
            dropped["no_result_yet"] += 1
            continue

        mine_triple = [
            mine.get("predicted_home_win"),
            mine.get("predicted_draw"),
            mine.get("predicted_away_win"),
        ]
        if any(v is None for v in mine_triple):
            dropped["ours_gave_no_triple"] += 1
            continue

        paired.append(
            {
                "competition_id": key[0],
                "date": date,
                "home": row.get("home"),
                "away": row.get("away"),
                "outcome": OUTCOMES[idx],
                "outcome_index": idx,
                "joined_by": joined_by,
                "vendor": [float(v) for v in triple],
                "ours": [float(v) for v in mine_triple],
                "market": latest_price_before(prices.get(str(mine.get("match_id")), []), kickoff),
            }
        )

    return paired, dropped


# --------------------------------------------------------------------------
# summarising
# --------------------------------------------------------------------------
def degeneracy(vendor: List[dict]) -> Dict[str, object]:
    """How often the vendor's triple has two identical legs.

    The first 18 captures were 18/18 — P(draw) landing exactly on P(home) every
    time is a two-way strength comparison wearing three numbers, not an
    estimated distribution. Tracked as a running statistic so that if their
    model warms up once the season gives it data to run on, we see it happen
    rather than assume it either way.
    """
    triples = [
        (r["p_home"], r["p_draw"], r["p_away"])
        for r in vendor
        if None not in (r.get("p_home"), r.get("p_draw"), r.get("p_away"))
    ]
    if not triples:
        return {"n": 0}
    tied = sum(1 for t in triples if len(set(t)) < 3)
    return {
        "n": len(triples),
        "two_legs_identical": tied,
        "share": round(tied / len(triples), 4),
        "distinct_triples": len(set(triples)),
    }


def score_set(rows: List[dict], who: str) -> Dict[str, object]:
    briers = [brier(r[who], r["outcome_index"]) for r in rows]
    losses = [log_loss(r[who], r["outcome_index"]) for r in rows]
    hits = sum(1 for r in rows if max(range(3), key=lambda i: r[who][i]) == r["outcome_index"])
    impossible = sum(1 for r in rows if r[who][r["outcome_index"]] <= 0.0)
    return {
        "n": len(rows),
        "brier": round(float(np.mean(briers)), 5) if briers else None,
        "log_loss": round(float(np.mean(losses)), 5) if losses else None,
        "accuracy": round(hits / len(rows), 4) if rows else None,
        # Rows where this forecaster said an outcome could not happen and it
        # did. Infinite log loss in truth; clamped above, counted here.
        "impossible_calls": impossible,
        "_brier": briers,
    }


def summarise(paired: List[dict], dropped: Counter, vendor: List[dict]) -> Dict[str, object]:
    ours = score_set(paired, "ours")
    theirs = score_set(paired, "vendor")
    boot = paired_bootstrap(theirs["_brier"], ours["_brier"])

    with_price = [r for r in paired if r.get("market")]
    market = score_set(with_price, "market") if with_price else None
    market_block: Optional[Dict[str, object]] = None
    if market:
        market_block = {
            "note": "latest price sampled before kickoff, NOT the closing line",
            "market": {k: v for k, v in market.items() if not k.startswith("_")},
            "ours": {k: v for k, v in score_set(with_price, "ours").items() if not k.startswith("_")},
            "vendor": {k: v for k, v in score_set(with_price, "vendor").items() if not k.startswith("_")},
        }

    summary: Dict[str, object] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "captured_rows": len(vendor),
        "scored_fixtures": len(paired),
        # A rising share of relaxed joins means the loose comparison is carrying
        # weight it was not meant to carry. Worth seeing, not worth hiding.
        "joined_by": dict(Counter(r["joined_by"] for r in paired)),
        "not_scored": dict(sorted(dropped.items(), key=lambda kv: -kv[1])),
        "vendor_degeneracy": degeneracy(vendor),
        "ours": {k: v for k, v in ours.items() if not k.startswith("_")},
        "vendor": {k: v for k, v in theirs.items() if not k.startswith("_")},
        "paired_brier_bootstrap_vendor_minus_ours": boot,
        "on_fixtures_with_a_price": market_block,
        "sample": {
            "floor": MIN_PAIRED,
            "needed_for_a_0.01_gap_at_80pct_power": required_n(theirs["_brier"], ours["_brier"]),
        },
    }
    summary["verdict"] = verdict(summary)
    return summary


def verdict(summary: Dict[str, object]) -> Dict[str, object]:
    """The pre-registered rule, applied without discretion."""
    n = int(summary["scored_fixtures"])  # type: ignore[arg-type]
    boot = summary["paired_brier_bootstrap_vendor_minus_ours"] or {}
    if n < MIN_PAIRED:
        return {
            "decision": "keep ours",
            "because": (
                f"{n} scored fixture(s), below the {MIN_PAIRED} floor. Not evidence "
                "of a tie — evidence of nothing yet."
            ),
            "final": False,
        }
    beats = bool(boot.get("mean_diff", 0.0) < 0)
    significant = bool(boot.get("significant"))
    if not (beats and significant):
        return {
            "decision": "keep ours",
            "because": "the vendor does not beat the served model on paired Brier with a CI excluding zero",
            "final": True,
        }
    block = summary.get("on_fixtures_with_a_price")
    if not block:
        return {
            "decision": "keep ours, and get prices for these fixtures",
            "because": (
                "the vendor beats us, but clause 3 cannot be evaluated without a "
                "pre-kickoff price on the same fixtures"
            ),
            "final": False,
        }
    m = block["market"]["brier"]  # type: ignore[index]
    v = block["vendor"]["brier"]  # type: ignore[index]
    o = block["ours"]["brier"]  # type: ignore[index]
    if None in (m, v, o):
        return {"decision": "keep ours", "because": "market comparison incomplete", "final": False}
    if v < m:
        # A vendor forecast that beats the price is the signature this repo
        # already has a rule about: "whenever a challenger beats the closing
        # line, suspect the harness first." Adopting on it would be adopting
        # a bug. Note the price here is the last one sampled, which is softer
        # than a true close and therefore easier to beat honestly — which is
        # itself a reason to go and look rather than to celebrate.
        return {
            "decision": "do not adopt yet — audit the harness",
            "because": (
                f"the vendor ({v:.5f}) beats the pre-kickoff price ({m:.5f}); per the "
                "landmine list that is a bug signature before it is an edge"
            ),
            "final": False,
        }
    if v < o:
        return {
            "decision": "adopt the vendor's triple",
            "because": "it beats ours significantly and sits closer to the market than ours does",
            "final": True,
        }
    return {
        "decision": "treat the vendor as a candidate feature, not a replacement",
        "because": (
            "it beats ours across the scored set but not on the fixtures with a price — "
            "route it through benchmark_market_blend.py"
        ),
        "final": True,
    }


# --------------------------------------------------------------------------
def report(summary: Dict[str, object]) -> str:
    lines = []
    n = summary["scored_fixtures"]
    lines.append(f"captured {summary['captured_rows']} vendor row(s); scored {n}")
    if summary["not_scored"]:
        lines.append("not scored:")
        for reason, count in summary["not_scored"].items():  # type: ignore[union-attr]
            lines.append(f"  {count:5d}  {reason}")

    deg = summary["vendor_degeneracy"]
    if deg.get("n"):  # type: ignore[union-attr]
        lines.append(
            f"vendor triples with two identical legs: "
            f"{deg['two_legs_identical']}/{deg['n']} "  # type: ignore[index]
            f"({deg['share']:.0%}), {deg['distinct_triples']} distinct triple(s)"  # type: ignore[index]
        )

    if n:
        lines.append("")
        lines.append(f"{'forecaster':<12} {'Brier':>8} {'log loss':>9} {'acc':>7} {'0% calls':>9}")
        for label, block in (("ours", summary["ours"]), ("vendor", summary["vendor"])):
            lines.append(
                f"{label:<12} {block['brier']:>8.5f} {block['log_loss']:>9.5f} "  # type: ignore[index]
                f"{block['accuracy']:>7.3f} {block['impossible_calls']:>9d}"  # type: ignore[index]
            )
        boot = summary["paired_brier_bootstrap_vendor_minus_ours"]
        if boot:
            lines.append(
                f"vendor - ours: {boot['mean_diff']:+.5f} "  # type: ignore[index]
                f"[{boot['ci95_low']:+.5f}, {boot['ci95_high']:+.5f}], "  # type: ignore[index]
                f"p(vendor better) = {boot['p_a_better']:.3f}"  # type: ignore[index]
            )
        need = summary["sample"]["needed_for_a_0.01_gap_at_80pct_power"]  # type: ignore[index]
        if need:
            lines.append(f"fixtures needed to resolve a .01 Brier gap at 80% power: ~{need}")

    block = summary.get("on_fixtures_with_a_price")
    if block:
        lines.append("")
        lines.append(f"on {block['market']['n']} fixture(s) with a price ({block['note']}):")  # type: ignore[index]
        for label in ("market", "ours", "vendor"):
            lines.append(f"  {label:<8} Brier {block[label]['brier']:.5f}")  # type: ignore[index]

    v = summary["verdict"]
    lines.append("")
    lines.append(f"VERDICT: {v['decision']} — {v['because']}")  # type: ignore[index]
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Score a vendor's forecasts against ours.")
    ap.add_argument("--vendor", type=Path, default=VENDOR_FILE)
    ap.add_argument("--predictions", type=Path, default=PRED_DIR)
    ap.add_argument("--odds", type=Path, default=ODDS_DIR)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = ap.parse_args(argv)

    vendor = load_vendor(args.vendor)
    if not vendor:
        print(f"no vendor rows at {args.vendor} — nothing to score.")
        return 0

    paired, dropped = pair_rows(vendor, load_ours(args.predictions), load_prices(args.odds))
    summary = summarise(paired, dropped, vendor)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

    print(json.dumps(summary, indent=2, ensure_ascii=False) if args.json else report(summary))
    print(f"\nwrote {args.out.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
