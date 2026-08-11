"""
Tests for World Cup bracket placeholder parsing and slot resolution.

The 2026 regression these guard against: ESPN publishes the full official
bracket before groups resolve, with placeholder competitors like
"Round of 32 1 Winner". The old simulator treated those strings as real
teams and produced winner probabilities for placeholder entities.
"""

import pytest

from backend.services.simulation.bracket_paths import (
    _assign_thirds,
    _Bracket,
    _KOMatch,
    _parse_competitor,
)


# ------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    "name,expected_slot",
    [
        ("Group A Winner", {"type": "group_winner", "group": "A"}),
        ("Group L Winner", {"type": "group_winner", "group": "L"}),
        ("Group C 2nd Place", {"type": "group_runner_up", "group": "C"}),
        (
            "Third Place Group A/B/C/D/F",
            {"type": "third_place", "groups": ["A", "B", "C", "D", "F"]},
        ),
        ("Round of 32 3 Winner", {"type": "chain", "round": "R32", "index": 3}),
        ("Round of 16 12 Winner", {"type": "chain", "round": "R16", "index": 12}),
        ("Quarterfinal 1 Winner", {"type": "chain", "round": "QF", "index": 1}),
        ("Semifinal 2 Winner", {"type": "chain", "round": "SF", "index": 2}),
    ],
)
def test_placeholder_names_become_slots(name, expected_slot):
    real_name, slot = _parse_competitor(name)
    assert real_name is None  # never a real team
    assert slot == expected_slot


@pytest.mark.parametrize("name", ["TBD", "tbd", "", None, "Play-off Winner A"])
def test_unknown_placeholders_are_not_teams(name):
    real_name, slot = _parse_competitor(name)
    assert real_name is None


@pytest.mark.parametrize("name", ["Argentina", "South Korea", "Côte d'Ivoire", "USA"])
def test_real_team_names_pass_through(name):
    real_name, slot = _parse_competitor(name)
    assert real_name == name
    assert slot is None


# ------------------------------------------------------------- is_set


def _match(round_key, home, away):
    home_name, home_slot = _parse_competitor(home)
    away_name, away_slot = _parse_competitor(away)
    return _KOMatch(
        match_id="x",
        round_key=round_key,
        home=home_name,
        away=away_name,
        home_slot=home_slot,
        away_slot=away_slot,
    )


def test_bracket_with_placeholder_entrants_is_not_set():
    bracket = _Bracket(
        rounds={"R32": [_match("R32", "Group A Winner", "Group B 2nd Place")]}
    )
    assert bracket.first_round_key == "R32"
    assert not bracket.is_set
    assert bracket.needs_group_resolution


def test_bracket_with_real_entrants_is_set():
    bracket = _Bracket(rounds={"R32": [_match("R32", "Argentina", "Mexico")]})
    assert bracket.is_set
    assert not bracket.needs_group_resolution


# ------------------------------------------------------- thirds matching


def test_thirds_assignment_honours_group_constraints():
    qualified = {"A": "TeamA3", "C": "TeamC3", "E": "TeamE3"}
    slots = [
        (0, ["C"]),            # most constrained — must take C
        (1, ["A", "C"]),       # C gone -> takes A
        (2, ["E", "H", "I"]),  # takes E
    ]
    assignment = _assign_thirds(slots, qualified)
    assert assignment == {0: "TeamC3", 1: "TeamA3", 2: "TeamE3"}


def test_thirds_assignment_falls_back_when_constraints_unsatisfiable():
    qualified = {"A": "TeamA3"}
    slots = [(0, ["H", "I"])]  # no allowed group qualified
    assignment = _assign_thirds(slots, qualified)
    # Total-conserving fallback: any remaining third fills the slot.
    assert assignment == {0: "TeamA3"}


# ------------------------------------- placeholders reaching the warehouse

from backend.scripts.ingest_scheduled_fixtures import is_placeholder  # noqa: E402


@pytest.mark.parametrize("name", [
    "Group A 2nd Place", "Best 3rd Place", "Winner Match 12", "TBD",
    "Runner-up Group C", "Loser Match 3", "Vencedor 3", "",
])
def test_slot_names_are_refused_before_they_become_teams(name):
    """The same 2026 regression, one layer earlier.

    `bracket_paths` guards the simulator. This guards the INGESTER, which is
    worse when it fails: `TeamResolver.resolve` creates a club it cannot
    match, and on 2026-08-11 it fuzzy-matched every "Group X 2nd Place" in the
    Asian Cup 2027 draw onto one invented row — producing a tie whose two
    sides were the same team. A junk `teams` row is permanent and competes
    with every later fuzzy match.
    """
    assert is_placeholder(name)


@pytest.mark.parametrize("name", [
    "Fluminense", "Independiente del Valle", "Red Bull Bragantino",
    "Atlético-MG", "Montevideo City Torque", "Cienciano del Cusco",
    "1. FSV Mainz 05", "Estudiantes de La Plata", "Universidad Católica",
])
def test_real_clubs_are_not_mistaken_for_slots(name):
    """A guard that eats real clubs silently truncates the draw."""
    assert not is_placeholder(name)
