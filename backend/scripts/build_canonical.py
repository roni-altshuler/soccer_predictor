"""One analytical substrate over two SQLite databases.

Why this layer exists
---------------------
The modelling side currently has to choose between two incompatible stores:

  `warehouse.sqlite`   69,943 matches. Resolved team ids, odds, xG, lineups.
                       Its loader is FORBIDDEN from creating fixtures, and that
                       rule is correct — relaxing it is what produced 18,547
                       duplicate fixtures and a club that "won" the Bundesliga
                       because a 7-0 was counted twice.
  `fbref.sqlite`      207,517 fixtures. Three times the matches, 39
                       competitions, back to 1888, with referees the warehouse
                       has never had — and no resolved entities at all.

Neither can absorb the other. The warehouse cannot take FBref's extra 137k
fixtures without the rule that protects it; FBref has no entity layer to take
the warehouse's. So the substrate for modelling is a THIRD thing: read-only,
rebuilt from scratch on every run, and therefore free to be wrong in a way that
costs a re-run rather than a repair.

    warehouse.sqlite ─┐
                      ├─→  canonical.duckdb  +  parquet/matches/competition=…/season=…
    fbref.sqlite     ─┘

What is canonical here, and what is not
---------------------------------------
**Canonical:** the match spine. One row per match, deduplicated across sources,
with a deterministic `match_uid` so a rebuild produces identical keys.

**Deliberately NOT canonical: cross-competition team identity.** A club that
plays in La Liga and the Champions League has two `team_key`s here, because
proving they are the same club requires the entity layer that only the
warehouse has, and inventing it silently is precisely the failure this repo has
already paid for twice. Where the warehouse knows the club, its `team_id` is
carried through in `home_team_id`/`away_team_id` and IS cross-competition. Where
it does not, the key is competition-scoped and honest about it. Any model that
needs cross-competition strength must use `team_id` and accept the smaller
corpus, or state that it is pooling within competitions only.

Leakage posture
---------------
This layer stores **no derived features and no aggregates** — only facts with
timestamps. Every rolling quantity is computed downstream from the match spine
in chronological order. That is deliberate: a stored season aggregate is the
single easiest way to leak a final-season value into a March prediction, and
the cheapest defence is not to have the column.

    python3 -m backend.scripts.build_canonical
    python3 -m backend.scripts.build_canonical --no-parquet

Writes backend/data/canonical.duckdb and data/processed/matches/.
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
import unicodedata
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("build_canonical")

WAREHOUSE = ROOT / "backend" / "data" / "warehouse.sqlite"
FBREF = ROOT / "backend" / "data" / "fbref.sqlite"
DUCKDB_OUT = ROOT / "backend" / "data" / "canonical.duckdb"
PARQUET_OUT = ROOT / "data" / "processed"

# FBref league name -> warehouse competition_id. Only mappings that are
# unambiguous; anything absent keeps its FBref name as the competition key and
# simply does not join to warehouse rows. An over-eager mapping here would
# merge two different competitions, which is worse than not merging at all.
COMPETITION_MAP = {
    "England Premier League": "eng.1",
    "Spain La Liga": "esp.1",
    "Germany Bundesliga": "ger.1",
    "Italy Serie A": "ita.1",
    "France Ligue 1": "fra.1",
    "Netherlands Eredivisie": "ned.1",
    "Portugal Primeira Liga": "por.1",
    "USA MLS": "usa.1",
    "England EFL Championship": "eng.2",
    "Spain La Liga 2": "esp.2",
    "Germany 2.Bundesliga": "ger.2",
    "Italy Serie B": "ita.2",
    "France Ligue 2": "fra.2",
    "Belgium Pro League": "bel.1",
    "Turkiye Super Lig": "tur.1",
    "Mexico Liga MX": "mex.1",
    "Brazil Serie A": "bra.1",
    "Argentina Liga Profesional": "arg.1",
    "Saudi Arabia Pro League": "ksa.1",
    "UEFA Champions League": "uefa.champions",
    "UEFA Europa League": "uefa.europa",
    "UEFA Conference League": "uefa.conference",
    "UEFA European Championship": "uefa.euro",
    "FIFA World Cup": "fifa.world",
    "CONMEBOL Copa America": "conmebol.america",
    "CONMEBOL Copa Libertadores": "conmebol.libertadores",
    "England WSL": "eng.1.w",
    "Spain Liga F": "esp.1.w",
    "Germany Womens Bundesliga": "ger.1.w",
    "Italy Womens Serie A": "ita.1.w",
    "France Premiere Ligue": "fra.1.w",
    "USA NWSL": "usa.1.w",
    "Australia A-League Women": "aus.1.w",
    "FIFA Womens World Cup": "fifa.world.w",
    "UEFA Womens Champions League": "uefa.champions.w",
    "UEFA Womens European Championship": "uefa.euro.w",
}

_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")
# Corporate and structural noise that differs between sources for the same
# club. Digits are NOT stripped: "1899 Hoffenheim" and "12 de Octubre" both
# depend on them, and dropping them merged two Paraguayan clubs once already.
_NOISE = frozenset({
    "fc", "cf", "afc", "sc", "ac", "as", "ss", "us", "ud", "cd", "rc", "rcd",
    "sv", "tsv", "vfl", "vfb", "fsv", "bsc", "sd", "ca", "club", "de", "the",
    "calcio", "futbol", "football", "futebol", "kv", "rsc", "kaa", "sk", "if",
})


def norm_team(name: str) -> str:
    """A conservative, reversible-ish normalisation for name matching.

    Deliberately weaker than a fuzzy matcher: this only strips accents,
    punctuation and structural tokens. It never merges two names on similarity,
    because a silent wrong merge is undetectable afterwards and this repo has
    the scars — `team_resolver`'s 0.92 threshold created a second `teams` row
    for "Ath Madrid" and duplicated every Atletico fixture.
    """
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = _WS.sub(" ", _PUNCT.sub(" ", s)).strip()
    tokens = [t for t in s.split() if t not in _NOISE]
    return " ".join(tokens or s.split())


DDL_UDF = "norm_team"


def build(con, *, parquet: bool) -> None:
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute(f"ATTACH '{WAREHOUSE}' AS wh (TYPE sqlite, READ_ONLY)")
    con.execute(f"ATTACH '{FBREF}' AS fb (TYPE sqlite, READ_ONLY)")
    con.create_function(DDL_UDF, norm_team, ["VARCHAR"], "VARCHAR")

    comp_map = ",".join(f"('{k.replace(chr(39), chr(39) * 2)}','{v}')"
                        for k, v in COMPETITION_MAP.items())
    con.execute(f"CREATE OR REPLACE TABLE competition_map(fbref VARCHAR, "
                f"competition_id VARCHAR)")
    con.execute(f"INSERT INTO competition_map VALUES {comp_map}")

    # ---- warehouse side -------------------------------------------------
    # `matches` is results-only by invariant, so every row here is played.
    con.execute(f"""
        CREATE OR REPLACE TABLE wh_matches AS
        SELECT
            m.match_id                                   AS source_id,
            'warehouse'                                  AS source,
            m.competition_id,
            CAST(m.season AS INTEGER)                    AS season,
            m.date_utc                                   AS kickoff_utc,
            CAST(substr(m.date_utc, 1, 10) AS DATE)      AS local_date,
            m.phase,
            m.home_team_id, m.away_team_id,
            ht.canonical_name                            AS home_name,
            awy.canonical_name                           AS away_name,
            {DDL_UDF}(ht.canonical_name)                 AS home_norm,
            {DDL_UDF}(awy.canonical_name)                AS away_norm,
            m.home_score, m.away_score,
            m.home_xg, m.away_xg,
            m.home_shots, m.away_shots, m.home_sot, m.away_sot,
            m.home_corners, m.away_corners,
            m.home_yellows, m.away_yellows, m.home_reds, m.away_reds,
            r.name                                       AS referee,
            m.venue, m.attendance,
            m.odds_home, m.odds_draw, m.odds_away,
            m.odds_close_home, m.odds_close_draw, m.odds_close_away
        FROM wh.matches m
        JOIN wh.teams ht ON ht.team_id = m.home_team_id
        JOIN wh.teams awy ON awy.team_id = m.away_team_id
        LEFT JOIN wh.referees r ON r.referee_id = m.referee_id
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
    """)

    # ---- fbref side -----------------------------------------------------
    # Season is the START year: '2023-2024' -> 2023, '2024' -> 2024. The
    # warehouse uses the same convention.
    con.execute(f"""
        CREATE OR REPLACE TABLE fb_matches AS
        SELECT
            f.league || '|' || f.season || '|' || f.row_key  AS source_id,
            'fbref'                                          AS source,
            COALESCE(cm.competition_id, 'fbref:' || f.league) AS competition_id,
            CAST(substr(f.season, 1, 4) AS INTEGER)          AS season,
            CASE WHEN f.time IS NOT NULL AND f.time <> ''
                 THEN f.date || 'T' || f.time
                 ELSE f.date || 'T00:00' END                 AS kickoff_utc,
            CAST(f.date AS DATE)                             AS local_date,
            f.round                                          AS phase,
            f.home AS home_name, f.away AS away_name,
            {DDL_UDF}(f.home) AS home_norm,
            {DDL_UDF}(f.away) AS away_norm,
            f.home_goals AS home_score, f.away_goals AS away_score,
            f.home_xg, f.away_xg,
            NULLIF(f.referee, '') AS referee,
            NULLIF(f.venue, '')   AS venue,
            f.attendance,
            f.match_url
        FROM fb.fbref_fixtures f
        LEFT JOIN competition_map cm ON cm.fbref = f.league
        WHERE f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
          AND f.date IS NOT NULL
          AND {DDL_UDF}(f.home) <> '' AND {DDL_UDF}(f.away) <> ''
    """)

    # ---- entity resolution by fixture alignment --------------------------
    # Name normalisation gets eng.1 2019 to 182 of 198 and ger.1 2019 to 72 of
    # 234, because the two vocabularies differ by abbreviation and exonym, not
    # by punctuation: `Manchester Utd` / `Manchester United`, `Köln` /
    # `FC Cologne`, `Gladbach` / `Borussia Monchengladbach`. No amount of token
    # stripping fixes those, and fuzzy string matching is what put a second
    # `teams` row for "Ath Madrid" in the warehouse and duplicated every
    # Atletico fixture.
    #
    # So the identity evidence is the FIXTURE GRAPH rather than the spelling.
    # Within one competition-season both sources describe the same matches: the
    # same dates, the same scorelines. Aligning on (date, score) proposes a name
    # pair per aligned match, and a true mapping collects a vote from every one
    # of a club's ~30 fixtures while a coincidental 1-0-on-the-same-day
    # collision collects one or two. The mapping is accepted only when it is
    # the mutual best for both names AND clears an evidence floor AND dominates
    # its runner-up — three conditions, none of which involve how the strings
    # look.
    con.execute("""
        CREATE OR REPLACE TABLE alias_votes AS
        WITH aligned AS (
            SELECT w.competition_id, w.season,
                   w.home_norm AS wh_home, w.away_norm AS wh_away,
                   f.home_norm AS fb_home, f.away_norm AS fb_away
            FROM wh_matches w
            JOIN fb_matches f
              ON f.competition_id = w.competition_id
             AND f.season = w.season
             AND f.home_score = w.home_score
             AND f.away_score = w.away_score
             AND abs(date_diff('day', f.local_date, w.local_date)) <= 1
        ),
        pairs AS (
            SELECT competition_id, wh_home AS wh, fb_home AS fb FROM aligned
            UNION ALL
            SELECT competition_id, wh_away, fb_away FROM aligned
        )
        SELECT competition_id, wh, fb, COUNT(*) AS votes
        FROM pairs GROUP BY 1, 2, 3
    """)

    # Mutual best, >= MIN_VOTES, and at least DOMINANCE x the runner-up on both
    # sides. A club that changed name mid-corpus fails dominance and is left
    # unresolved rather than half-merged.
    con.execute("""
        CREATE OR REPLACE TABLE team_aliases AS
        WITH ranked_fb AS (
            SELECT *, row_number() OVER (PARTITION BY competition_id, wh
                                         ORDER BY votes DESC) AS rk_fb,
                   COALESCE(lead(votes) OVER (PARTITION BY competition_id, wh
                                              ORDER BY votes DESC), 0) AS next_fb
            FROM alias_votes
        ),
        ranked_wh AS (
            SELECT *, row_number() OVER (PARTITION BY competition_id, fb
                                         ORDER BY votes DESC) AS rk_wh,
                   COALESCE(lead(votes) OVER (PARTITION BY competition_id, fb
                                              ORDER BY votes DESC), 0) AS next_wh
            FROM ranked_fb
        )
        SELECT competition_id, fb AS fb_norm, wh AS wh_norm, votes,
               next_fb, next_wh
        FROM ranked_wh
        WHERE rk_fb = 1 AND rk_wh = 1
          AND votes >= 5
          AND votes >= 3 * next_fb
          AND votes >= 3 * next_wh
    """)
    n_alias = con.execute("SELECT COUNT(*) FROM team_aliases").fetchone()[0]
    n_ident = con.execute("SELECT COUNT(*) FROM team_aliases "
                          "WHERE fb_norm = wh_norm").fetchone()[0]
    logger.info("aliases accepted: %d (%d were already identical, %d genuinely "
                "renamed)", n_alias, n_ident, n_alias - n_ident)
    rejected = con.execute("""
        SELECT COUNT(*) FROM alias_votes v
        WHERE NOT EXISTS (SELECT 1 FROM team_aliases a
                          WHERE a.competition_id = v.competition_id
                            AND a.fb_norm = v.fb AND a.wh_norm = v.wh)
    """).fetchone()[0]
    logger.info("name pairs proposed but NOT accepted: %d "
                "(kept separate rather than guessed)", rejected)

    # Rewrite the FBref side into the warehouse's vocabulary. Unmapped names
    # keep their own spelling and simply do not join — visible, not silent.
    con.execute("""
        CREATE OR REPLACE TABLE fb_matches AS
        SELECT f.* REPLACE (
            COALESCE(ah.wh_norm, f.home_norm) AS home_norm,
            COALESCE(aa.wh_norm, f.away_norm) AS away_norm
        )
        FROM fb_matches f
        LEFT JOIN team_aliases ah ON ah.competition_id = f.competition_id
                                 AND ah.fb_norm = f.home_norm
        LEFT JOIN team_aliases aa ON aa.competition_id = f.competition_id
                                 AND aa.fb_norm = f.away_norm
    """)

    # ---- the join -------------------------------------------------------
    # Same competition, same normalised pair, kickoff within a day. The window
    # is a day and not an instant because football-data rows carry LOCAL
    # MIDNIGHT rather than a kickoff instant for 86% of Wave A, and FBref
    # publishes the local match date. Anything tighter drops real matches;
    # anything looser starts pairing a Saturday fixture with a Sunday one.
    con.execute("""
        CREATE OR REPLACE TABLE link AS
        SELECT w.source_id AS wh_id, f.source_id AS fb_id
        FROM wh_matches w
        JOIN fb_matches f
          ON f.competition_id = w.competition_id
         AND f.home_norm = w.home_norm
         AND f.away_norm = w.away_norm
         AND abs(date_diff('day', f.local_date, w.local_date)) <= 1
        QUALIFY row_number() OVER (
            PARTITION BY f.source_id
            ORDER BY abs(date_diff('day', f.local_date, w.local_date))
        ) = 1
    """)
    linked = con.execute("SELECT COUNT(*) FROM link").fetchone()[0]
    logger.info("linked %d fbref rows onto warehouse matches", linked)

    # ---- the canonical spine --------------------------------------------
    # Warehouse rows win on every field they have, because they carry resolved
    # entity ids, odds and Understat xG. FBref fills what the warehouse lacks
    # and contributes its own rows wherever no warehouse match exists.
    con.execute("""
        CREATE OR REPLACE TABLE matches AS
        WITH merged AS (
            SELECT
                w.competition_id, w.season, w.kickoff_utc, w.local_date, w.phase,
                w.home_team_id, w.away_team_id,
                w.home_name, w.away_name, w.home_norm, w.away_norm,
                w.home_score, w.away_score,
                COALESCE(w.home_xg, f.home_xg) AS home_xg,
                COALESCE(w.away_xg, f.away_xg) AS away_xg,
                w.home_shots, w.away_shots, w.home_sot, w.away_sot,
                w.home_corners, w.away_corners,
                w.home_yellows, w.away_yellows, w.home_reds, w.away_reds,
                COALESCE(w.referee, f.referee)       AS referee,
                COALESCE(w.venue, f.venue)           AS venue,
                COALESCE(w.attendance, f.attendance) AS attendance,
                w.odds_home, w.odds_draw, w.odds_away,
                w.odds_close_home, w.odds_close_draw, w.odds_close_away,
                f.match_url,
                CASE WHEN f.source_id IS NULL THEN 'warehouse' ELSE 'both' END AS provenance
            FROM wh_matches w
            LEFT JOIN link l ON l.wh_id = w.source_id
            LEFT JOIN fb_matches f ON f.source_id = l.fb_id

            UNION ALL

            SELECT
                f.competition_id, f.season, f.kickoff_utc, f.local_date, f.phase,
                NULL::BIGINT, NULL::BIGINT,
                f.home_name, f.away_name, f.home_norm, f.away_norm,
                f.home_score, f.away_score, f.home_xg, f.away_xg,
                NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE,
                NULL::DOUBLE, NULL::DOUBLE,
                NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
                f.referee, f.venue, f.attendance,
                NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE,
                NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE,
                f.match_url, 'fbref' AS provenance
            FROM fb_matches f
            WHERE f.source_id NOT IN (SELECT fb_id FROM link)
        )
        SELECT
            md5(competition_id || '|' || CAST(season AS VARCHAR) || '|'
                || CAST(local_date AS VARCHAR) || '|' || home_norm || '|'
                || away_norm)                              AS match_uid,
            competition_id || '::' || home_norm            AS home_key,
            competition_id || '::' || away_norm            AS away_key,
            CASE WHEN home_score > away_score THEN 'H'
                 WHEN home_score < away_score THEN 'A' ELSE 'D' END AS result,
            *
        FROM merged
        QUALIFY row_number() OVER (
            PARTITION BY competition_id, local_date, home_norm, away_norm
            ORDER BY CASE provenance WHEN 'both' THEN 0
                                     WHEN 'warehouse' THEN 1 ELSE 2 END
        ) = 1
    """)

    n = con.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    logger.info("canonical matches: %d", n)
    for row in con.execute("SELECT provenance, COUNT(*) FROM matches "
                           "GROUP BY 1 ORDER BY 2 DESC").fetchall():
        logger.info("  %-10s %8d", row[0], row[1])

    # ---- teams dimension -------------------------------------------------
    con.execute("""
        CREATE OR REPLACE TABLE teams AS
        SELECT team_key, competition_id, any_value(display_name) AS display_name,
               max(team_id) AS warehouse_team_id,
               COUNT(*) AS matches, min(local_date) AS first_seen,
               max(local_date) AS last_seen
        FROM (
            SELECT home_key AS team_key, competition_id, home_name AS display_name,
                   home_team_id AS team_id, local_date FROM matches
            UNION ALL
            SELECT away_key, competition_id, away_name, away_team_id, local_date
            FROM matches
        ) GROUP BY team_key, competition_id
    """)
    t = con.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
    logger.info("teams (competition-scoped keys): %d", t)

    if parquet:
        PARQUET_OUT.mkdir(parents=True, exist_ok=True)
        target = PARQUET_OUT / "matches"
        con.execute(f"""
            COPY (SELECT * FROM matches ORDER BY local_date, match_uid)
            TO '{target}' (FORMAT PARQUET, PARTITION_BY (competition_id, season),
                           OVERWRITE_OR_IGNORE 1, COMPRESSION zstd)
        """)
        logger.info("wrote parquet under %s", target)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-parquet", action="store_true")
    ap.add_argument("--output", default=str(DUCKDB_OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    import duckdb

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Rebuilt from scratch every run — that is what makes it safe to be a
    # derived layer rather than a store of record.
    if out.exists():
        out.unlink()
    con = duckdb.connect(str(out))
    build(con, parquet=not args.no_parquet)
    con.close()
    logger.info("wrote %s", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
