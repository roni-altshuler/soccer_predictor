"""The per-group breakdown behind `/evaluation`'s per-competition panels.

`benchmark_knockout` publishes a pooled ladder and, since 2026-08-13, a record
per round and per competition. The evaluation page attributes those to a named
competition, which raises the bar on them: a pooled number shown under one
competition's name is a wrong claim about that competition, and a 100% hit rate
on three ties is a wrong claim about anything.

The scoring loop itself is unremarkable. What is worth pinning is the two rules
that keep it honest — the minimum sample and the shared mask — plus the
arithmetic, because an off-by-one in a rollup produces a page that looks
completely normal and reports somebody else's numbers.
"""

import numpy as np

from backend.scripts.benchmark_knockout import rollup


class TestRollup:
    def test_scores_each_group_on_its_own_ties(self):
        labels = ["uefa.champions"] * 10 + ["fifa.world"] * 10
        # Champions League: 8 of 10 called right. World Cup: 3 of 10.
        probs = np.array([0.9] * 8 + [0.1] * 2 + [0.9] * 3 + [0.1] * 7)
        y = np.array([1] * 10 + [1] * 10)
        mask = np.ones(20, dtype=bool)

        out = rollup(labels, probs, y, mask)

        assert out["uefa.champions"] == {"correct": 8, "n": 10, "accuracy": 0.8}
        assert out["fifa.world"] == {"correct": 3, "n": 10, "accuracy": 0.3}

    def test_drops_a_group_too_small_to_mean_anything(self):
        # Nine ties at 100% is the shape of a competition the model has barely
        # seen. Published under its name it reads as mastery of it.
        labels = ["uefa.champions"] * 10 + ["afc.asian"] * 9
        probs = np.array([0.9] * 19)
        y = np.array([1] * 19)

        out = rollup(labels, probs, y, np.ones(19, dtype=bool))

        assert "uefa.champions" in out
        assert "afc.asian" not in out

    def test_honours_the_minimum_the_caller_asks_for(self):
        labels = ["uefa.champions"] * 5
        out = rollup(labels, np.array([0.9] * 5), np.array([1] * 5),
                     np.ones(5, dtype=bool), min_n=5)
        assert out["uefa.champions"]["n"] == 5

    def test_excludes_the_same_ties_the_pooled_figures_exclude(self):
        # A tie the model could not score is out of the headline `n_ties_scored`
        # and must be out of every group too, or a competition's `n` means
        # something different from the number beside it on the page.
        labels = ["uefa.champions"] * 20
        probs = np.array([0.9] * 20)
        y = np.array([1] * 10 + [0] * 10)
        mask = np.array([True] * 10 + [False] * 10)

        out = rollup(labels, probs, y, mask)

        assert out["uefa.champions"] == {"correct": 10, "n": 10, "accuracy": 1.0}

    def test_counts_a_coin_flip_probability_as_a_win_for_the_favoured_side(self):
        # `>= 0.5` is the convention the pooled accuracy uses. A tie priced at
        # exactly .5 has to fall the same way in both, or the breakdown and the
        # headline disagree by construction on a handful of ties.
        out = rollup(["x"] * 10, np.full(10, 0.5), np.ones(10), np.ones(10, dtype=bool))
        assert out["x"]["accuracy"] == 1.0

    def test_reports_brier_only_where_it_was_asked_for(self):
        labels = ["uefa.champions"] * 10
        # Every tie priced at .8 and won: squared error .04 on each.
        probs, y = np.full(10, 0.8), np.ones(10)
        mask = np.ones(10, dtype=bool)

        assert "brier" not in rollup(labels, probs, y, mask)["uefa.champions"]
        assert rollup(labels, probs, y, mask, with_brier=True)["uefa.champions"]["brier"] == 0.04

    def test_separates_picking_winners_from_being_calibrated(self):
        # Both competitions call 10 of 10 correctly; one did it at .55 and the
        # other at .95. Identical accuracy, very different Brier — which is the
        # entire reason the competition rollup carries both.
        labels = ["timid"] * 10 + ["bold"] * 10
        probs = np.array([0.55] * 10 + [0.95] * 10)
        y = np.ones(20)

        out = rollup(labels, probs, y, np.ones(20, dtype=bool), with_brier=True)

        assert out["timid"]["accuracy"] == out["bold"]["accuracy"] == 1.0
        assert out["timid"]["brier"] > out["bold"]["brier"]

    def test_orders_by_sample_size_so_the_measured_competitions_lead(self):
        labels = ["small"] * 12 + ["big"] * 40
        out = rollup(labels, np.full(52, 0.9), np.ones(52), np.ones(52, dtype=bool))
        assert list(out) == ["big", "small"]

    def test_returns_nothing_rather_than_zeroes_when_nothing_was_scored(self):
        # An empty dict renders as an absent section. A dict of zeroed rows
        # renders as a model that got everything wrong.
        assert rollup(["x"] * 10, np.full(10, 0.9), np.ones(10),
                      np.zeros(10, dtype=bool)) == {}
