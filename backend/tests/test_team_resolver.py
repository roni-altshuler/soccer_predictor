"""Tests for cross-source team name normalization."""

from __future__ import annotations

import pytest

from backend.services.data.team_resolver import TeamResolver, _normalise, _similarity
from backend.services.data.warehouse import Warehouse


@pytest.fixture()
def warehouse(tmp_path) -> Warehouse:
    wh = Warehouse(tmp_path / "wh.sqlite")
    wh.migrate()
    yield wh
    wh.close()


def test_normalise_strips_diacritics_and_suffixes():
    assert _normalise("FC Barcelona") == "barcelona"
    assert _normalise("Manchester United FC") == "manchester united"
    assert _normalise("Barça") == "barca"
    assert _normalise("VfL Wolfsburg") == "wolfsburg"


def test_similarity_high_for_minor_variants():
    assert _similarity("Manchester United", "Man Utd") > 0.5
    assert _similarity("Atletico Madrid", "Atlético Madrid") > 0.85
    assert _similarity("Liverpool", "Wolves") < 0.6


def test_resolver_dedupes_aliases_via_yaml_overrides(warehouse: Warehouse):
    """The shipped team_aliases.yml maps Manchester United variants → one team_id."""
    r = TeamResolver(warehouse, gender_default="M")
    canonical = r.resolve("Manchester United", gender="M")
    a1 = r.resolve("Man Utd", gender="M")
    a2 = r.resolve("Manchester Utd", gender="M")
    a3 = r.resolve("ManUnited", gender="M")
    a4 = r.resolve("Manchester United FC", gender="M")
    assert canonical.team_id == a1.team_id == a2.team_id == a3.team_id == a4.team_id


def test_resolver_separates_mens_and_womens(warehouse: Warehouse):
    """Same name, different gender → different team rows (intentional)."""
    r = TeamResolver(warehouse, gender_default="M")
    men_mu = r.resolve("Manchester United", gender="M")
    wom_mu = r.resolve("Manchester United Women", gender="F")
    assert men_mu.team_id != wom_mu.team_id


def test_resolver_fuzzy_fallback_creates_new(warehouse: Warehouse):
    r = TeamResolver(warehouse, gender_default="M")
    unknown = r.resolve("Some Brand-New Club FC From Mars", gender="M")
    assert unknown.created is True
    assert unknown.confidence == 0.0
    # Resolving the same name again must hit the cache and return the same id.
    same = r.resolve("Some Brand-New Club FC From Mars", gender="M")
    assert same.team_id == unknown.team_id
    assert same.created is False


def test_resolver_rejects_empty_or_bad_gender(warehouse: Warehouse):
    r = TeamResolver(warehouse, gender_default="M")
    with pytest.raises(ValueError):
        r.resolve("", gender="M")
    with pytest.raises(ValueError):
        r.resolve("Arsenal", gender="X")
