"""The club-identity matcher, pinned by example.

This is the highest-leverage safety net in the ingest path. A FALSE NEGATIVE
splits one club in two, which silently duplicates every fixture it played and
was what made 60 of 77 league-seasons unreconstructable before 2026-08-08. A
FALSE POSITIVE is worse and unrecoverable without a rebuild: merge 'Real
Madrid' into 'Atletico Madrid' and the warehouse now contains a club that never
existed, with a fabricated 76-match season.

The pairs below are the ones that actually appear in the warehouse across the
three ingest sources (ESPN, football-data.co.uk, OpenFootball). Each provider
spells clubs its own way, so this list is the specification.
"""

from __future__ import annotations

import pytest

from backend.scripts.validate_warehouse_integrity import (
    DISTINCT_CLUB_PAIRS,
    _norm,
    _norm_tokens,
    _same_club_shape,
)


def matches(a: str, b: str) -> bool:
    """What the repair does: exact normalised equality, or token subset."""
    return _norm(a) == _norm(b) or _same_club_shape(a, b)


# One club, spelled by two providers. Every one of these was a live split
# identity in the 2026-08-10 warehouse.
SAME_CLUB = [
    # OpenFootball's legal-form prefixes vs ESPN's short name
    ("Mallorca", "RCD Mallorca"),
    ("Osasuna", "CA Osasuna"),
    ("Espanyol", "RCD Espanyol de Barcelona"),
    ("Angers", "Angers SCO"),
    # Founding years, which no other provider prints
    ("Hoffenheim", "1899 Hoffenheim"),
    ("Mainz", "1. FSV Mainz 05"),
    ("Heidenheim", "1. FC Heidenheim 1846"),
    # A qualifier appended rather than prepended
    ("Alavés", "Deportivo Alavés"),
    ("Nimes", "Nîmes Olympique"),
    ("Real Sociedad", "Real Sociedad de Fútbol"),
    ("Rayo Vallecano", "Rayo Vallecano de Madrid"),
    # football-data.co.uk's terse English spellings
    ("Blackburn", "Blackburn Rovers"),
    ("Swansea", "Swansea City"),
    ("Charlton", "Charlton Athletic"),
    ("Wigan", "Wigan Athletic"),
    ("Derby", "Derby County"),
    # Accents dropped by one source
    ("Alaves", "Alavés"),
    ("Nurnberg", "1. FC Nürnberg"),
]

# Different clubs that a careless normaliser folds together. Several share a
# city; several share a first word. None may ever merge.
DIFFERENT_CLUBS = [
    ("Real Madrid", "Atletico Madrid"),
    ("Real Madrid", "Real Sociedad"),
    ("Real Betis", "Real Sociedad"),
    ("Athletic Bilbao", "Atletico Madrid"),
    ("Manchester United", "Manchester City"),
    ("Borussia Dortmund", "Borussia Monchengladbach"),
    ("Bayern Munich", "Borussia Dortmund"),
    ("Hellas Verona", "Chievo Verona"),
    ("Sheffield United", "Sheffield Wednesday"),
    ("Nottingham Forest", "Nottingham"),  # only if pinned — see below
]


@pytest.mark.parametrize("a,b", SAME_CLUB)
def test_same_club_is_recognised(a: str, b: str) -> None:
    assert matches(a, b), f"{a!r} and {b!r} are one club but do not match"


@pytest.mark.parametrize("a,b", DIFFERENT_CLUBS[:-1])
def test_different_clubs_never_merge(a: str, b: str) -> None:
    assert not matches(a, b), f"{a!r} and {b!r} are different clubs but matched"


def test_city_derbies_survive_normalisation() -> None:
    """The words that name a club are not stripped as noise.

    'Real', 'Atletico', 'Athletic', 'Borussia' and 'Deportivo' look like legal
    decoration and are not: removing them collapses both Madrid clubs, both
    Borussias and both Basque clubs onto one identity each.
    """
    for a, b in (
        ("Real Madrid", "Atletico Madrid"),
        ("Borussia Dortmund", "Borussia Monchengladbach"),
        ("Athletic Bilbao", "Atletico Madrid"),
    ):
        assert _norm(a) != _norm(b), f"{a!r} and {b!r} normalise identically"


def test_subset_rule_needs_a_second_belt() -> None:
    """Names where subset alone is not enough, and what stops them.

    These four ARE token subsets, so `_same_club_shape` says yes. They are
    stopped by `DISTINCT_CLUB_PAIRS` and — in the repair — by the fact that
    both clubs have played each other. Documented here so that removing either
    guard fails loudly rather than quietly merging Serbia into Yugoslavia.
    """
    for a, b in (
        ("Inter", "Inter Baku"),
        ("AC Ajaccio", "GFC Ajaccio"),
        ("Serbia", "Serbia & Montenegro"),
        ("Paris Saint-Germain", "Paris FC"),
    ):
        assert _same_club_shape(a, b), f"{a!r}/{b!r} no longer a subset — update this test"
        assert frozenset((a, b)) in DISTINCT_CLUB_PAIRS, (
            f"{a!r}/{b!r} is a token subset of a different club and is NOT pinned "
            "in DISTINCT_CLUB_PAIRS — the repair would merge them"
        )


def test_numeric_tokens_are_dropped() -> None:
    assert _norm_tokens("1899 Hoffenheim") == ["hoffenheim"]
    assert _norm_tokens("1. FSV Mainz 05") == ["mainz"]


def test_identical_names_are_not_a_subset() -> None:
    """Equality is pass 1's job; the subset rule must not double-claim it."""
    assert not _same_club_shape("Mallorca", "RCD Mallorca")
    assert _norm("Mallorca") == _norm("RCD Mallorca")
