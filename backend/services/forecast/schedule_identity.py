"""Use existing, pinned club identities for schedule-only spellings.

The canonical fixture graph can only learn aliases from played FBref rows.
A new spelling in an unplayed schedule has no such evidence yet. The manual
registry already resolves some of these names for ingestion; reuse that
explicit evidence without guessing from spelling or changing the corpus.
"""

from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping

import yaml

from backend.scripts.build_canonical import norm_team

ALIASES = Path(__file__).resolve().parents[2] / "data" / "team_aliases.yml"


def with_pinned_schedule_aliases(
    learned: Mapping[tuple[str, str], str],
    team_keys: Iterable[str],
    *,
    alias_file: Path = ALIASES,
) -> dict[tuple[str, str], str]:
    """Supplement learned aliases only for known clubs in that competition.

    Learned evidence wins. Ambiguous pins, another competition's club, another
    gender, or a spelling that is already a different canonical identity are
    left alone. Missing identities remain visible to the publication guards.
    """
    known = set(team_keys)
    competitions = defaultdict(set)
    for key in known:
        competition, _, name = key.partition("::")
        competitions[name].add(competition)

    candidates = defaultdict(set)
    entries = yaml.safe_load(alias_file.read_text())["teams"]
    for entry in entries:
        target = norm_team(entry["canonical"])
        for competition in competitions.get(target, ()):
            gender = "F" if competition.endswith(".w") else "M"
            if entry["gender"] != gender:
                continue
            for alias in entry.get("aliases", []):
                spelling = norm_team(alias)
                if not spelling:
                    continue
                if spelling != target and f"{competition}::{spelling}" in known:
                    continue
                candidates[(competition, spelling)].add(target)

    aliases = dict(learned)
    for scope, targets in candidates.items():
        if len(targets) == 1:
            aliases.setdefault(scope, next(iter(targets)))
    return aliases
