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


# ── clubs that are not each other ───────────────────────────────────────
#
# The fuzzy pass merges at a 0.92 similarity ratio, which is the right
# threshold for `Atlético Madrid` / `Atletico Madrid` and the wrong one for
# two unrelated clubs whose names happen to be one letter apart. Reggiana
# (Reggio Emilia) scored .93 against Reggina (Reggio Calabria) and took over
# 114 of its Serie B matches the first time second-tier history was ingested.
#
# A split identity halves a club's history and is loud — the integrity guard
# reports it. A merged identity is silent: one entity with two clubs' results,
# ratings and form, and every downstream number quietly wrong.

CONFUSABLE = [
    # (a, b, why they are not the same club)
    ("Reggiana", "Reggina", "Reggio Emilia; Reggio Calabria"),
    ("Juventude", "Juventud", "Caxias do Sul, Brazil; Las Piedras, Uruguay"),
]


@pytest.mark.parametrize("a,b,why", CONFUSABLE)
def test_confusable_clubs_are_above_the_fuzzy_threshold(a, b, why):
    """If this ever fails, the pin below has become unnecessary — but check
    why before deleting it."""
    assert _similarity(a, b) >= 0.92, why


@pytest.mark.parametrize("a,b,why", CONFUSABLE)
def test_confusable_clubs_resolve_to_different_teams(warehouse: Warehouse, a, b, why):
    """The pin in team_aliases.yml has to fire before the fuzzy pass."""
    r = TeamResolver(warehouse, gender_default="M")
    assert r.resolve(a, gender="M").team_id != r.resolve(b, gender="M").team_id, (
        f"{a} and {b} resolved to one club — {why}")


def test_no_alias_is_claimed_by_two_clubs():
    """One spelling meaning two clubs is a merge waiting to happen, and the
    file is 154 entries deep — too many to hold in a reviewer's head."""
    import yaml
    from pathlib import Path

    path = (Path(__file__).resolve().parent.parent / "data" / "team_aliases.yml")
    entries = yaml.safe_load(path.read_text())["teams"]

    owner = {}
    for entry in entries:
        key = (entry["canonical"], entry.get("gender", "M"))
        for spelling in [entry["canonical"], *entry.get("aliases", [])]:
            seen = owner.setdefault((_normalise(spelling), key[1]), key)
            assert seen == key, (
                f"{spelling!r} is claimed by both {seen[0]!r} and {key[0]!r}")
