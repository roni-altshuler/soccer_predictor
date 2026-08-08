"""Cross-source team name normalization.

Different soccer data sources spell the same team differently:
* ESPN: "Manchester United"
* football-data.co.uk: "Man United"
* ClubElo: "ManUnited"
* FBref: "Manchester Utd"
* OpenFootball: "Manchester United FC"

The resolver maps every observed spelling (an *alias*) to one canonical
team in the warehouse so cross-source joins are correct.

Strategy
--------
1. **Manual overrides** loaded from `backend/data/team_aliases.yml`. Each
   entry pins a canonical name + gender + a list of known spellings. These
   take absolute precedence; that's where the user resolves ambiguity for
   well-known teams.
2. **Database lookups** against `team_aliases` and `teams.canonical_name`.
3. **Fuzzy fallback** via simple normalisation (lowercase, strip suffixes
   like "FC"/"CF"/"AC", collapse whitespace, drop diacritics) + Levenshtein
   ratio for the trickiest cases.

The resolver is intentionally conservative on the fuzzy path — if a match
isn't strong (ratio < 0.85) it inserts a new team rather than silently
merging two clubs. A periodic audit script can surface near-duplicates so
the user can add overrides to the YAML.

Two properties this module is responsible for (both regression-guarded by
`backend/scripts/validate_warehouse_integrity.py`):

1. **YAML overrides are lazy.** Loading `team_aliases.yml` must NOT create
   a `teams` row. It used to, which left one orphan row per YAML entry for
   every club that never appeared in a match — 15 zero-match women's rows
   duplicating men's `canonical_name`s, a trap for anything joining on
   name alone. A team is now materialised the first time a real match
   actually resolves to it.
2. **YAML overrides beat fuzzy matching.** The override table is consulted
   before the fuzzy pass, so a pinned spelling can never be swallowed by a
   coincidentally similar club (football-data's "Heidenheim" scores 0.70
   against "Hoffenheim", "Paderborn" 0.55 against "Werder Bremen").
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

ALIASES_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "team_aliases.yml"

# Common suffixes that source feeds sprinkle on top of the canonical name.
# Stripped during normalisation but never persisted — the canonical_name in
# `teams` keeps whatever spelling the user/seed chose (e.g. "Manchester United"
# even though some sources include "FC" at the end).
_NOISE_SUFFIXES = (
    "fc",
    "cf",
    "sc",
    "ac",
    "afc",
    "sv",
    "sk",
    "ks",
    "as",
    "rc",
    "cd",
    "ud",
    "u-19",
    "ii",
    "b",
    "(w)",
    "women",
    "femenil",
    "femenino",
    "feminino",
    "feminine",
)
_NOISE_PREFIXES = ("fc ", "ac ", "ss ", "as ", "rc ", "sv ", "1.", "1. ", "vfl ", "vfb ", "tsg ")


def _normalise(name: str) -> str:
    """Lowercase, strip diacritics + common club-name noise."""
    if not name:
        return ""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))
    lower = ascii_only.lower().strip()
    # collapse punctuation/whitespace
    lower = re.sub(r"[._\-]+", " ", lower)
    lower = re.sub(r"\s+", " ", lower).strip()
    # drop leading "FC ", "AC ", etc.
    for prefix in _NOISE_PREFIXES:
        if lower.startswith(prefix):
            lower = lower[len(prefix):].strip()
            break
    # drop trailing club tags
    parts = lower.split()
    while parts and parts[-1] in _NOISE_SUFFIXES:
        parts.pop()
    return " ".join(parts)


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _normalise(a), _normalise(b)).ratio()


@dataclass
class TeamResolution:
    team_id: int
    canonical_name: str
    confidence: float  # 1.0 = exact / alias hit; <1 = fuzzy
    created: bool


class TeamResolver:
    """Maps an arbitrary source name + gender to a warehouse team_id.

    Caller passes an already-opened `Warehouse` instance; the resolver does
    not own its lifecycle.
    """

    def __init__(self, warehouse, *, gender_default: str = "M") -> None:
        self.warehouse = warehouse
        self.gender_default = gender_default
        self._cache: Dict[Tuple[str, str], int] = {}
        # (normalised alias, gender) -> (canonical, country, [all aliases])
        self._yaml_overrides: Dict[Tuple[str, str], Tuple[str, Optional[str], Tuple[str, ...]]] = {}
        # (new_name, existing_name, score) for every 0.85..0.92 near-miss this
        # resolver created a separate team for. Loaders surface these so a
        # human can decide whether they need pinning in the YAML.
        self.near_duplicates: List[Tuple[str, str, float]] = []
        self._load_overrides()

    def _load_overrides(self) -> None:
        """Read `team_aliases.yml` into memory.

        Deliberately writes NOTHING to the warehouse. Materialising a team
        here would create a row for every pinned club whether or not it
        ever plays a match; see the module docstring.
        """
        if not ALIASES_FILE.exists():
            return
        try:
            import yaml
        except ImportError:
            logger.warning("PyYAML not installed; skipping team_aliases.yml")
            return
        try:
            data = yaml.safe_load(ALIASES_FILE.read_text()) or {}
        except Exception as exc:
            logger.warning("Failed to parse %s: %s", ALIASES_FILE, exc)
            return

        entries = data.get("teams") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            return

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            canonical = entry.get("canonical")
            gender = entry.get("gender", self.gender_default)
            country = entry.get("country")
            aliases = entry.get("aliases", []) or []
            if not canonical or gender not in ("M", "F"):
                continue
            spellings = tuple(
                [canonical] + [a for a in aliases if isinstance(a, str) and a.strip()]
            )
            payload = (canonical, country, spellings)
            # The canonical spelling resolves to itself, as does every alias.
            for spelling in spellings:
                self._yaml_overrides[(_normalise(spelling), gender)] = payload

    def _materialise_override(
        self, canonical: str, country: Optional[str], spellings: Tuple[str, ...], gender: str
    ) -> int:
        """Create the pinned team (if needed) and register all its spellings."""
        team_id = self.warehouse.upsert_team(
            canonical_name=canonical, gender=gender, country=country
        )
        for spelling in spellings:
            self.warehouse.add_alias(spelling, team_id, gender)
            self._cache[(_normalise(spelling), gender)] = team_id
        return team_id

    def resolve(
        self,
        name: str,
        *,
        gender: Optional[str] = None,
        country: Optional[str] = None,
    ) -> TeamResolution:
        """Return a `TeamResolution`; creates a new team if no good match."""
        gender = (gender or self.gender_default).upper()
        if gender not in ("M", "F"):
            raise ValueError(f"gender must be 'M' or 'F', got {gender!r}")
        if not name or not name.strip():
            raise ValueError("Cannot resolve empty team name")

        key = (_normalise(name), gender)

        # 1. Memoised hit.
        if key in self._cache:
            return TeamResolution(
                team_id=self._cache[key],
                canonical_name=name,
                confidence=1.0,
                created=False,
            )

        # 2. YAML override — absolute precedence, and the only path allowed
        #    to run before the fuzzy pass. Materialises the team on first use.
        override = self._yaml_overrides.get(key)
        if override is not None:
            canonical, country_hint, spellings = override
            team_id = self._materialise_override(
                canonical, country or country_hint, spellings, gender
            )
            return TeamResolution(
                team_id=team_id,
                canonical_name=canonical,
                confidence=1.0,
                created=False,
            )

        # 3. Warehouse alias table (spellings learned on earlier passes).
        team_id = self.warehouse.find_team_id_by_alias(name, gender)
        if team_id is not None:
            self._cache[key] = team_id
            return TeamResolution(
                team_id=team_id,
                canonical_name=name,
                confidence=1.0,
                created=False,
            )

        # 4. Try a normalised alias lookup (e.g. ESPN "Real Madrid" vs FD "Real Madrid CF").
        team_id = self.warehouse.find_team_id_by_alias(_normalise(name), gender)
        if team_id is not None:
            self._cache[key] = team_id
            self.warehouse.add_alias(name, team_id, gender)
            return TeamResolution(
                team_id=team_id,
                canonical_name=name,
                confidence=0.99,
                created=False,
            )

        # 5. Fuzzy scan against existing teams of the same gender.
        candidates = self._fuzzy_candidates(name, gender)
        if candidates:
            best_id, best_name, best_score = candidates[0]
            if best_score >= 0.92:
                self.warehouse.add_alias(name, best_id, gender)
                self._cache[key] = best_id
                return TeamResolution(
                    team_id=best_id,
                    canonical_name=best_name,
                    confidence=best_score,
                    created=False,
                )
            if best_score >= 0.85:
                logger.warning(
                    "Near-duplicate team %r ~ %r (score=%.2f); creating a NEW team. "
                    "If these are the same club, pin the spelling in "
                    "backend/data/team_aliases.yml — an unpinned split identity "
                    "silently halves that club's Elo/form/h2h history.",
                    name,
                    best_name,
                    best_score,
                )
                self.near_duplicates.append((name, best_name, best_score))

        # 6. Create new team.
        team_id = self.warehouse.upsert_team(
            canonical_name=name.strip(), gender=gender, country=country
        )
        self.warehouse.add_alias(name, team_id, gender)
        self._cache[key] = team_id
        return TeamResolution(
            team_id=team_id,
            canonical_name=name.strip(),
            confidence=0.0,
            created=True,
        )

    def _fuzzy_candidates(
        self, name: str, gender: str
    ) -> List[Tuple[int, str, float]]:
        """Score every existing team of the requested gender against `name`."""
        rows = self.warehouse._conn.execute(  # noqa: SLF001 — same-package use
            "SELECT team_id, canonical_name FROM teams WHERE gender = ?",
            (gender,),
        ).fetchall()
        scored = [
            (int(r["team_id"]), str(r["canonical_name"]), _similarity(name, r["canonical_name"]))
            for r in rows
        ]
        scored.sort(key=lambda x: x[2], reverse=True)
        return scored[:5]

    # ---- batch helper for ETL ----

    def resolve_many(
        self,
        names: Iterable[str],
        *,
        gender: str,
    ) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for n in names:
            res = self.resolve(n, gender=gender)
            out[n] = res.team_id
        return out
