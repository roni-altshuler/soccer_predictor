"""Classify a competition phase, and derive bracket depth from the data.

Why not just parse the round name
---------------------------------
ESPN's `phase` strings are not a vocabulary, they are twenty years of
accumulated labelling habits. The warehouse holds all of these:

    quarterfinals / quarter-finals      semifinals / semi-finals
    third-place / 3rd-place / 3rd-place-match
    2010-first-phase / 201617-group-stage / 2014-first-round

and — this is the trap — `second-round` means the round of 32 in the Europa
League and the round of 16 at the 1998 World Cup. `third-round` means the round
of 16. A parser that maps names to bracket positions will get those backwards,
silently, in exactly the seasons nobody checks.

So the name is used for one job only: is this a group match, a qualifier, or a
knockout tie. Bracket DEPTH is then derived from the data — count the distinct
teams that played in a round and you get 32, 16, 8, 4, 2 without trusting a
label. That number is also self-validating: if a "round of 16" turns out to
have 22 teams in it, the grouping is wrong and it says so instead of training
on it.

Away goals: UEFA abolished the rule from 2021-22 (announced 24 June 2021).
`away_goals_applies` encodes that cut-off, because a tie level on aggregate
resolves differently either side of it.
"""
from __future__ import annotations

import re
from typing import Optional

GROUP = "group"
QUALIFYING = "qualifying"
KNOCKOUT = "knockout"
THIRD_PLACE = "third_place"

# Phases that look like knockout rounds but are group-stage football under a
# name ESPN inherited from a format that no longer exists.
_GROUP_PATTERNS = (
    re.compile(r"group"),
    re.compile(r"league-?phase"),
    re.compile(r"first-?phase"),
    re.compile(r"second-?phase"),
    # "2014-first-round" is the Europa League group stage; a bare
    # "first-round" is not, so the year prefix is required.
    re.compile(r"^\d{4,6}-first-round$"),
)

_QUALIFYING_PATTERNS = (
    re.compile(r"qualif"),
    re.compile(r"preliminary"),
)

_THIRD_PLACE_PATTERNS = (
    re.compile(r"third-?place"),
    re.compile(r"3rd-?place"),
)


def slug(phase: Optional[str]) -> str:
    """Collapse label variants so both legs of a tie share a key.

    quarter-finals and quarterfinals are the same round; 3rd-place and
    3rd-place-match are the same fixture.
    """
    s = (phase or "").strip().lower()
    if not s:
        return ""
    for pat in _THIRD_PLACE_PATTERNS:
        if pat.search(s):
            return "third-place"
    return re.sub(r"[^a-z0-9]", "", s)


def classify(phase: Optional[str]) -> str:
    """One of GROUP / QUALIFYING / KNOCKOUT / THIRD_PLACE.

    Order matters: 'knockout-round-playoffs' contains neither 'group' nor
    'qualif' and is a genuine two-legged knockout tie, so it falls through to
    KNOCKOUT, which is correct. 'qualifying-third-round' is caught by the
    qualifier rule before anything else can claim it.
    """
    s = (phase or "").strip().lower()
    if not s:
        return KNOCKOUT
    for pat in _THIRD_PLACE_PATTERNS:
        if pat.search(s):
            return THIRD_PLACE
    for pat in _QUALIFYING_PATTERNS:
        if pat.search(s):
            return QUALIFYING
    for pat in _GROUP_PATTERNS:
        if pat.search(s):
            return GROUP
    return KNOCKOUT


def away_goals_applies(season: int) -> bool:
    """UEFA scrapped away goals from 2021-22. Before that, a level aggregate
    was decided on goals scored away from home before extra time."""
    return season <= 2020


def depth_label(teams_remaining: int) -> str:
    """Name a round by how many teams are still in it — derived, not parsed."""
    return {
        2: "final",
        4: "semifinals",
        8: "quarterfinals",
        16: "round-of-16",
        32: "round-of-32",
        64: "round-of-64",
    }.get(teams_remaining, f"round-of-{teams_remaining}")
