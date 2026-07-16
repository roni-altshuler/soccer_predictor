"""Tests for Match Engine v0 (match_engine.py + the pluggable backtest core).

Covers the v0 contract:
  * the forward DP produces a proper distribution (sums to 1),
  * DC-NESTING: with zero residual (fresh net / net=None) the DP reproduces
    Dixon-Coles' score matrix to ~1e-6 — the load-bearing de-risker,
  * rollout_from_state sanity (mid-match seeds, monotone score floors),
  * teacher-forced features never peek at the cell's own minute (no leakage
    at the feature level),
  * the walk-forward harness never trains on a fixture it is about to score
    (fixture-level no-leakage assertion),
  * the dataset reconciliation guard excludes non-reconciling grids loudly,
  * smoke overfit: on a synthetic state-deterministic dataset the residual
    net drives the NLL to (near) zero,
  * the engine backtest predictor refuses base weights that post-date a
    scored block (leakage guard).

Run:  python3 -m pytest backend/tests/test_match_engine.py -q
"""

from __future__ import annotations

import math
import sqlite3

import numpy as np
import pytest
import torch

from backend.services.prediction.dixon_coles import DixonColesModel
from backend.services.prediction.match_engine import (
    LOG_MULT_CLAMP,
    MAX_GOALS,
    N_FEATURES,
    N_MINUTES,
    EngineConfig,
    ResidualNet,
    batch_cell_features,
    build_match_cell_features,
    engine_state_dict,
    hazard_nll,
    load_engine,
    multiplier_table,
    outcome_probs,
    rollout_from_state,
    score_matrix,
)

RNG_SEED = 20260715


# ---------------------------------------------------------------------------
# DP is a proper distribution
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "lam,mu,rho",
    [(1.5, 1.1, -0.05), (2.8, 0.6, -0.12), (0.7, 0.9, 0.1), (4.0, 3.5, 0.0)],
)
def test_dp_sums_to_one(lam, mu, rho):
    mat = score_matrix(lam, mu, rho, net=None)
    assert mat.shape == (MAX_GOALS + 1, MAX_GOALS + 1)
    assert np.all(mat >= 0)
    assert mat.sum() == pytest.approx(1.0, abs=1e-12)
    p = outcome_probs(mat)
    assert sum(p) == pytest.approx(1.0, abs=1e-12)


def test_dp_with_trained_net_still_sums_to_one():
    torch.manual_seed(RNG_SEED)
    net = ResidualNet(hidden=16)
    # Perturb all layers so the residual is decidedly non-zero.
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 0.3)
    mat = score_matrix(1.7, 1.2, -0.06, net=net, gender_f=1.0)
    assert mat.sum() == pytest.approx(1.0, abs=1e-12)
    assert not np.allclose(mat, score_matrix(1.7, 1.2, -0.06, net=None))


# ---------------------------------------------------------------------------
# DC-nesting: zero residual == Dixon-Coles exactly (REQUIRED)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "lam,mu,rho",
    [(1.5, 1.1, -0.05), (2.8, 0.6, -0.12), (0.7, 0.9, 0.1), (3.2, 2.4, -0.18)],
)
def test_zero_residual_reproduces_dixon_coles(lam, mu, rho):
    dc = DixonColesModel(teams={}, home_adv=0.0, rho=rho)
    reference = dc._score_matrix_from_lambda(lam, mu, MAX_GOALS)
    engine = score_matrix(lam, mu, rho, net=None)
    assert np.abs(engine - reference).max() < 1e-6


def test_fresh_net_is_exactly_zero_residual():
    """Zero-initialised final layer => multiplier 1 => identical to net=None."""
    net = ResidualNet()
    table = multiplier_table(net, gender_f=0.0)
    assert np.abs(table - 1.0).max() == 0.0
    a = score_matrix(1.9, 0.8, -0.07, net=net)
    b = score_matrix(1.9, 0.8, -0.07, net=None)
    assert np.abs(a - b).max() == 0.0


def test_zero_residual_outcome_probs_match_dc_predict():
    """1X2 through the DP tracks DixonColesModel.predict (wider grid) closely."""
    dc = DixonColesModel(
        teams={"A": {"attack": 0.3, "defence": 0.1},
               "B": {"attack": -0.1, "defence": -0.2}},
        home_adv=0.25,
        rho=-0.05,
    )
    lam, mu = dc.expected_goals("A", "B")
    pred = dc.predict("A", "B")
    mat = score_matrix(lam, mu, dc.rho, net=None)
    p_home, p_draw, p_away = outcome_probs(mat)
    # DC integrates to 12 goals, the engine lattice stops at 10 — the tail
    # mass difference is far below any scoring-relevant tolerance.
    assert p_home == pytest.approx(pred["p_home"], abs=1e-5)
    assert p_draw == pytest.approx(pred["p_draw"], abs=1e-5)
    assert p_away == pytest.approx(pred["p_away"], abs=1e-5)


# ---------------------------------------------------------------------------
# rollout_from_state
# ---------------------------------------------------------------------------
def test_rollout_from_state_respects_score_floor():
    mat = rollout_from_state(
        1.4, 1.1, -0.05, net=None, start_minute=60, score=(2, 0)
    )
    assert mat.sum() == pytest.approx(1.0, abs=1e-12)
    # Goals cannot be un-scored: no mass below the current score.
    assert mat[:2, :].sum() == 0.0
    assert mat[2, 0] > 0  # staying 2-0 is possible
    # Less time left => less chance the away side turns it around.
    late = rollout_from_state(1.4, 1.1, -0.05, None, start_minute=85, score=(2, 0))
    p_away_now = outcome_probs(mat)[2]
    p_away_late = outcome_probs(late)[2]
    assert p_away_late < p_away_now


def test_rollout_from_final_minute_is_degenerate():
    mat = rollout_from_state(1.4, 1.1, 0.0, None, start_minute=90, score=(1, 1))
    assert mat[1, 1] == pytest.approx(1.0, abs=1e-12)


def test_rollout_red_card_state_changes_prediction():
    torch.manual_seed(RNG_SEED)
    net = ResidualNet(hidden=16)
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 0.3)
    even = rollout_from_state(1.5, 1.2, -0.05, net, start_minute=30, reds=(0, 0))
    down = rollout_from_state(1.5, 1.2, -0.05, net, start_minute=30, reds=(1, 0))
    assert not np.allclose(even, down)


# ---------------------------------------------------------------------------
# Teacher-forced features
# ---------------------------------------------------------------------------
def test_cell_features_use_state_strictly_before_minute():
    """The state at minute t must not include minute t's own events."""
    gh = np.zeros(N_MINUTES, dtype=np.uint8)
    ga = np.zeros(N_MINUTES, dtype=np.uint8)
    rh = np.zeros(N_MINUTES, dtype=np.uint8)
    ra = np.zeros(N_MINUTES, dtype=np.uint8)
    gh[10] = 1  # home goal in minute bin 10
    feats, labels = build_match_cell_features(gh, ga, rh, ra, gender_f=0.0)
    assert feats.shape == (2 * N_MINUTES, N_FEATURES)
    # score-diff one-hot block: columns 19..25 (18 buckets + fold flag first).
    diff_cols = slice(19, 26)
    home_rows = feats[:N_MINUTES]
    # At the goal minute itself the diff must still be 0 (index 3 of 7).
    assert home_rows[10, diff_cols][3] == 1.0
    # Strictly after, diff is +1 (index 4).
    assert home_rows[11, diff_cols][4] == 1.0
    assert labels[10] == 1.0 and labels[11] == 0.0


def test_batch_cell_features_matches_single():
    rng = np.random.default_rng(RNG_SEED)
    gh = (rng.random((3, N_MINUTES)) < 0.02).astype(np.uint8)
    ga = (rng.random((3, N_MINUTES)) < 0.02).astype(np.uint8)
    rh = (rng.random((3, N_MINUTES)) < 0.003).astype(np.uint8)
    ra = (rng.random((3, N_MINUTES)) < 0.003).astype(np.uint8)
    gender = np.array([0, 1, 0], dtype=np.uint8)
    lam = np.array([1.5, 1.1, 2.0])
    mu = np.array([1.0, 1.3, 0.7])
    feats, labels, base = batch_cell_features(gh, ga, rh, ra, gender, lam, mu)
    assert feats.shape == (3 * 2 * N_MINUTES, N_FEATURES)
    for i in range(3):
        f_i, l_i = build_match_cell_features(
            gh[i], ga[i], rh[i], ra[i], float(gender[i])
        )
        # Batch layout: all home cells first, then all away cells.
        np.testing.assert_array_equal(
            feats[i * N_MINUTES : (i + 1) * N_MINUTES], f_i[:N_MINUTES]
        )
        np.testing.assert_array_equal(
            feats[(3 + i) * N_MINUTES : (4 + i) * N_MINUTES], f_i[N_MINUTES:]
        )
        np.testing.assert_array_equal(
            labels[i * N_MINUTES : (i + 1) * N_MINUTES], l_i[:N_MINUTES]
        )
    # base rates: home cells carry lam/90, away cells mu/90.
    assert base[0] == pytest.approx(1.5 / 90)
    assert base[3 * N_MINUTES] == pytest.approx(1.0 / 90)


# ---------------------------------------------------------------------------
# Smoke overfit on a state-deterministic synthetic dataset
# ---------------------------------------------------------------------------
def test_smoke_overfit_synthetic():
    """When labels ARE a function of state, the net must drive NLL near 0.

    On real data literal NLL→0 is impossible by design (states are shared
    across matches and carry no match identity), so the honest overfit test
    uses a synthetic dataset whose labels are state-deterministic: home
    scores exactly in the minute bins of one fixed bucket, away never does.
    """
    torch.manual_seed(RNG_SEED)
    b = 16
    gh = np.zeros((b, N_MINUTES), dtype=np.uint8)
    ga = np.zeros((b, N_MINUTES), dtype=np.uint8)
    reds = np.zeros((b, N_MINUTES), dtype=np.uint8)
    gh[:, 0:5] = 1  # home scores every minute of bucket 0 — deterministic
    gender = np.zeros(b, dtype=np.uint8)
    lam = np.full(b, 45.0)  # large base so p→1 is reachable within the clamp
    mu = np.full(b, 45.0)
    feats, labels, base = batch_cell_features(gh, ga, reds, reds, gender, lam, mu)

    net = ResidualNet(hidden=32)
    optim = torch.optim.Adam(net.parameters(), lr=1e-2)
    feats_t = torch.from_numpy(feats)
    base_t = torch.from_numpy(base)
    labels_t = torch.from_numpy(labels)
    first = None
    for step in range(400):
        optim.zero_grad()
        loss = hazard_nll(net(feats_t), base_t, labels_t)
        if first is None:
            first = float(loss.detach())
        loss.backward()
        optim.step()
    final = float(hazard_nll(net(feats_t), base_t, labels_t).detach())
    # Analytic floor of the clamped model class on this dataset: y=1 cells
    # saturate at nu_max = base*e^clamp, y=0 cells at nu_min = base*e^-clamp.
    rate = 45.0 / N_MINUTES
    nu_max = rate * math.exp(LOG_MULT_CLAMP)
    nu_min = rate * math.exp(-LOG_MULT_CLAMP)
    n1 = labels.sum()
    n0 = len(labels) - n1
    floor = (n1 * (-math.log(1 - math.exp(-nu_max))) + n0 * nu_min) / len(labels)
    assert final < first / 10, f"barely moved: {first} -> {final}"
    assert final == pytest.approx(floor, rel=0.05), (
        f"expected convergence to the clamp-constrained floor {floor:.5f}, "
        f"got {final:.5f} (start {first:.5f})"
    )


def test_hazard_nll_matches_manual_bernoulli():
    log_mult = torch.zeros(2)
    base = torch.tensor([0.02, 0.02])
    labels = torch.tensor([1.0, 0.0])
    nll = float(hazard_nll(log_mult, base, labels))
    p1 = 1 - math.exp(-0.02)
    expected = -(math.log(p1) + (-0.02)) / 2
    assert nll == pytest.approx(expected, rel=1e-6)


# ---------------------------------------------------------------------------
# Serialisation round-trip
# ---------------------------------------------------------------------------
def test_engine_state_roundtrip():
    torch.manual_seed(RNG_SEED)
    net = ResidualNet(hidden=16)
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 0.1)
    payload = engine_state_dict(net, EngineConfig(hidden=16))
    net2, cfg = load_engine(payload)
    assert cfg.hidden == 16
    a = score_matrix(1.5, 1.1, -0.05, net=net)
    b = score_matrix(1.5, 1.1, -0.05, net=net2)
    assert np.abs(a - b).max() == 0.0


# ---------------------------------------------------------------------------
# Reconciliation guard (dataset build)
# ---------------------------------------------------------------------------
def test_reconciliation_guard_excludes_mismatched_grid():
    from backend.scripts.build_event_dataset import build_grids

    rows = [
        {
            "match_id": "ok",
            "competition_id": "test.1",
            "season": 2024,
            "home_score": 1,
            "away_score": 0,
        },
        {
            "match_id": "bad",
            "competition_id": "test.1",
            "season": 2024,
            "home_score": 2,  # warehouse says 2-0 but events only carry 1 goal
            "away_score": 0,
        },
    ]
    events = {
        "ok": [("goal", 23, "home")],
        "bad": [("goal", 23, "home")],
    }
    gh, ga, rh, ra, keep_idx, excluded = build_grids(rows, events)
    assert keep_idx == [0]
    assert excluded == ["bad"]
    assert gh[0].sum() == 1 and ga[0].sum() == 0


def test_minute_folding_added_and_extra_time():
    from backend.scripts.build_event_dataset import minute_bin

    assert minute_bin(1) == 0
    assert minute_bin(45) == 44   # added time folds into the 45' bin
    assert minute_bin(90) == 89
    assert minute_bin(97) == 89   # extra time folds into the 90' bin
    assert minute_bin(120) == 89


# ---------------------------------------------------------------------------
# Walk-forward no-leakage (fixture level) through the pluggable core
# ---------------------------------------------------------------------------
def _mini_warehouse() -> sqlite3.Connection:
    """In-memory warehouse with two seasons of a 4-team league."""
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE competitions (
            competition_id TEXT PRIMARY KEY, name TEXT, country TEXT,
            gender TEXT NOT NULL, tier INTEGER, confederation TEXT);
        CREATE TABLE teams (
            team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE matches (
            match_id TEXT PRIMARY KEY, source TEXT, competition_id TEXT,
            season INTEGER, date_utc TEXT, home_team_id INTEGER,
            away_team_id INTEGER, home_score INTEGER, away_score INTEGER,
            odds_home REAL, odds_draw REAL, odds_away REAL);
        INSERT INTO competitions VALUES ('test.1','Test','XX','M',1,NULL);
        """
    )
    for i, name in enumerate(["Alpha", "Beta", "Gamma", "Delta"], start=1):
        con.execute("INSERT INTO teams VALUES (?, ?)", (i, name))
    rng = np.random.default_rng(RNG_SEED)
    mid = 0
    for season, year in ((2023, 2023), (2024, 2024)):
        # ~36 matchdays x 2 games so MIN_FIT_MATCHES(100) is reachable in s2.
        for day in range(36):
            date = f"{year}-{1 + day // 4:02d}-{1 + (day * 7) % 27:02d}T15:00:00"
            for h, a in ((1 + day % 4, 1 + (day + 1) % 4),
                         (1 + (day + 2) % 4, 1 + (day + 3) % 4)):
                if h == a:
                    continue
                mid += 1
                con.execute(
                    "INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        f"m{mid}", "espn", "test.1", season, date, h, a,
                        int(rng.poisson(1.4)), int(rng.poisson(1.1)),
                        2.1, 3.3, 3.6,
                    ),
                )
    con.commit()
    return con


class _SpyPredictor:
    """Records every (training cut, scored fixture) pair the harness feeds it."""

    name = "spy"

    def __init__(self):
        self.observed = []  # (block_start, frozenset(train dates), fixture date)
        self._train_dates = None
        self._block_start = None

    def fit_block(self, ctx):
        self._train_dates = [str(m["date"]) for m in ctx.train]
        self._block_start = ctx.block_start

    def predict(self, home, away, ref_date):
        self.observed.append((self._block_start, tuple(self._train_dates), ref_date))
        return (1 / 3, 1 / 3, 1 / 3)


def test_walkforward_never_trains_on_scored_fixture():
    from backend.scripts._backtest_core import run_backtest

    con = _mini_warehouse()
    spy = _SpyPredictor()
    reports, records = run_backtest(
        con, [spy], ["test.1"], season=2024, n_seasons=5, half_life_days=390.0
    )
    con.close()
    assert reports and records, "harness scored nothing — fixture broken"
    assert len(spy.observed) == len(records)
    for block_start, train_dates, _ in spy.observed:
        assert train_dates, "empty training cut"
        # FIXTURE-LEVEL NO-LEAKAGE: every training match strictly precedes
        # the block containing the scored fixture.
        assert max(train_dates) < block_start
    # And the scored fixtures are exactly the season-2024 matches (paired
    # bookkeeping: every record carries the spy's probabilities).
    for rec in records:
        assert rec.season == 2024
        assert "spy" in rec.probs


def test_core_dc_predictor_agrees_with_direct_fit():
    """The pluggable DC path is the same computation as calling DC directly."""
    from backend.scripts._backtest_core import (
        DixonColesPredictor,
        run_backtest,
    )
    from backend.scripts.train_dixon_coles import load_competition_matches
    from backend.services.prediction.dixon_coles import fit_dixon_coles

    con = _mini_warehouse()
    dc = DixonColesPredictor()
    reports, records = run_backtest(
        con, [dc], ["test.1"], season=2024, n_seasons=5, half_life_days=390.0
    )
    assert records
    # Re-derive the first scored fixture's prediction by hand: same training
    # cut (strictly before the fixture's matchday block), same fit call.
    first = records[0]
    row = con.execute(
        """
        SELECT h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.match_id = ?
        """,
        (first.match_id,),
    ).fetchone()
    # The block start is the date of the block's first fixture; for the very
    # first scored record it is its own date_utc.
    train = load_competition_matches(
        con, "test.1", 5, source="espn", until=first.date_utc
    )
    con.close()
    model = fit_dixon_coles(train, half_life_days=390.0, ref_date=first.date_utc)
    pred = model.predict(row["home"], row["away"])
    expected = (pred["p_home"], pred["p_draw"], pred["p_away"])
    got = first.probs["dixon_coles"]
    assert got == pytest.approx(expected, abs=1e-12)


def test_engine_predictor_leakage_guard(tmp_path):
    """Base weights trained past a block's start must be refused."""
    import torch as _torch

    from backend.scripts.backtest import MatchEnginePredictor

    payload = engine_state_dict(ResidualNet(hidden=16), EngineConfig(hidden=16))
    payload["metadata"] = {"trained_until": "2099-01-01"}
    weights = tmp_path / "leaky.pt"
    _torch.save(payload, weights)

    dataset_dir = tmp_path / "engine"
    dataset_dir.mkdir()
    np.savez_compressed(
        dataset_dir / "grids.npz",
        goal_home=np.zeros((1, N_MINUTES), dtype=np.uint8),
        goal_away=np.zeros((1, N_MINUTES), dtype=np.uint8),
        red_home=np.zeros((1, N_MINUTES), dtype=np.uint8),
        red_away=np.zeros((1, N_MINUTES), dtype=np.uint8),
        lam_dc=np.array([1.4], dtype=np.float32),
        mu_dc=np.array([1.1], dtype=np.float32),
        gender=np.zeros(1, dtype=np.uint8),
    )
    (dataset_dir / "matches.json").write_text(
        '[{"match_id": "x", "competition_id": "test.1", '
        '"date_utc": "2024-01-01T15:00:00", "season": 2024}]',
        encoding="utf-8",
    )
    predictor = MatchEnginePredictor(
        weights_path=weights, dataset_dir=dataset_dir, finetune_epochs=0
    )

    from backend.scripts._backtest_core import BlockContext

    ctx = BlockContext(
        competition_id="test.1",
        season=2024,
        source="espn",
        gender="M",
        block_index=0,
        block_start="2024-05-01T15:00:00",
        train=[],
        n_seasons=5,
        half_life_days=390.0,
    )
    with pytest.raises(RuntimeError, match="refusing to score a leaky backtest"):
        predictor.fit_block(ctx)


def test_multiplier_clamp_bounds_intensity():
    torch.manual_seed(RNG_SEED)
    net = ResidualNet(hidden=16)
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 5.0)  # wild weights
    table = multiplier_table(net, gender_f=0.0)
    # float32 net output vs float64 reference: allow relative epsilon.
    assert table.max() <= math.exp(LOG_MULT_CLAMP) * (1 + 1e-6)
    assert table.min() >= math.exp(-LOG_MULT_CLAMP) * (1 - 1e-6)
