"""The guard against the bug that cost this project nine months of accuracy.

Market features sat in the served vector, populated for 96.1% of training rows
and zeroed on every live prediction. Brier .5801 -> .6561, below a constant base
rate. The schema guard could not see it because the feature NAMES matched and
only the VALUES differed.

Two properties are pinned here:

  1. A block that is all-zero at serve makes the net decline to serve, rather
     than serving a degraded number with a log line beside it. The project has
     already demonstrated that a warning next to a plausible number gets
     ignored — nine consecutive `training_drift_*.json` files recorded
     `"status": "regression"` and every model was promoted anyway.

  2. Market features stay OUT of the served vector entirely. They are the one
     feature group the ablation shows helps (-.0102 Brier) and the one the
     serving path cannot populate, which is exactly the combination that
     produced the original bug.
"""

from __future__ import annotations

import pytest

from backend.services.prediction.feature_builder_v2 import (
    FEATURE_NAMES,
    FEATURE_NAMES_WITH_MARKET,
    MARKET_FEATURE_NAMES,
)
from backend.services.prediction.unified_inference import (
    DeadFeatureBlock,
    _LIVE_BLOCK_CHECKS,
    _check_live_feature_blocks,
    _dead_block_warned,
)


@pytest.fixture(autouse=True)
def _reset_warned():
    _dead_block_warned.clear()
    yield
    _dead_block_warned.clear()


class TestServedVectorExcludesMarket:
    def test_no_market_feature_is_served(self):
        for name in MARKET_FEATURE_NAMES:
            assert name not in FEATURE_NAMES, (
                f"{name!r} is back in the served vector. The serving path builds the "
                "match row with NULL odds, so this feature would be 0.0 on every live "
                "prediction while training saw a real implied probability. That is the "
                "2026-08-08 bug exactly."
            )

    def test_no_served_feature_looks_like_a_market_feature(self):
        # Catches a market feature reintroduced under a new name.
        for name in FEATURE_NAMES:
            assert not name.startswith("implied_"), f"{name!r} looks like a market feature"
            assert "overround" not in name, f"{name!r} looks like a market feature"

    def test_the_market_block_still_exists_for_a_market_informed_model(self):
        # Dropping the block entirely would lose the one feature group measured
        # to help. It is kept separate, not deleted.
        assert MARKET_FEATURE_NAMES, "the market block should still be defined"
        assert set(FEATURE_NAMES_WITH_MARKET) == set(FEATURE_NAMES) | set(
            MARKET_FEATURE_NAMES
        )


class TestDeadBlockGuard:
    def _dense(self, **overrides) -> list:
        """A dense vector with every feature at 1.0 unless overridden by prefix."""
        out = []
        for name in FEATURE_NAMES:
            value = 1.0
            for prefix, v in overrides.items():
                if name.startswith(prefix):
                    value = v
            out.append(value)
        return out

    def test_passes_when_every_checked_block_has_signal(self):
        _check_live_feature_blocks(self._dense(), match_id=1)

    @pytest.mark.parametrize("label,prefix", list(_LIVE_BLOCK_CHECKS))
    def test_raises_when_a_block_is_all_zero(self, label: str, prefix: str):
        dense = self._dense(**{prefix: 0.0})
        present = [n for n in FEATURE_NAMES if n.startswith(prefix)]
        if not present:
            pytest.skip(f"block {label!r} is not in the served vector")

        with pytest.raises(DeadFeatureBlock) as exc:
            _check_live_feature_blocks(dense, match_id=42)
        assert exc.value.label == label
        assert "42" in str(exc.value)

    def test_a_single_nonzero_value_is_enough_to_pass(self):
        """Sparse coverage is not the same defect as a dead block.

        Weather covers 66.6% of Wave A. A fixture with no weather row is
        genuinely missing data; a whole block that is never populated is a
        wiring bug. Only the second is worth refusing to serve over.
        """
        for label, prefix in _LIVE_BLOCK_CHECKS:
            names = [n for n in FEATURE_NAMES if n.startswith(prefix)]
            if not names:
                continue
            dense = self._dense(**{prefix: 0.0})
            dense[FEATURE_NAMES.index(names[0])] = 0.5
            _check_live_feature_blocks(dense, match_id=7)

    def test_reports_once_but_refuses_every_time(self):
        """Log noise is throttled; the refusal is not.

        The original implementation throttled the whole check, so the second
        and subsequent degraded predictions were served silently.
        """
        prefix = next(
            (p for _, p in _LIVE_BLOCK_CHECKS if any(n.startswith(p) for n in FEATURE_NAMES)),
            None,
        )
        if prefix is None:
            pytest.skip("no checked block is in the served vector")
        dense = self._dense(**{prefix: 0.0})
        for _ in range(3):
            with pytest.raises(DeadFeatureBlock):
                _check_live_feature_blocks(dense, match_id=1)
