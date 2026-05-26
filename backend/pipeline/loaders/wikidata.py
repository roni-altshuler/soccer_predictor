"""Wikidata SPARQL loader — player metadata + historical transfers.

Wikidata's SPARQL endpoint at ``https://query.wikidata.org/sparql`` is free
and unauthenticated. We use it for:

* Player canonical names, DOB, nationality, primary position
* Historical transfer chains (sparse for women's, decent for men's top tier)

Rate-limit ourselves to 1 query / 2s (Wikidata recommends < 60/min).
"""

from __future__ import annotations

import logging
import time
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

SPARQL_URL = "https://query.wikidata.org/sparql"
USER_AGENT = "FotPredictAI/1.0 (https://github.com/shenorrlab/soccer_predictor)"
RATE_LIMIT_SEC = 2.0

# SPARQL to fetch a single footballer's metadata by canonical name.
PLAYER_BY_NAME = """
SELECT ?player ?playerLabel ?dob ?nationalityLabel ?positionLabel WHERE {
  ?player rdfs:label "%s"@en .
  ?player wdt:P31 wd:Q5 .                 # is a human
  ?player wdt:P106 wd:Q937857 .           # occupation: association football player
  OPTIONAL { ?player wdt:P569 ?dob }
  OPTIONAL { ?player wdt:P27 ?nationality }
  OPTIONAL { ?player wdt:P413 ?position }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5
"""


class WikidataLoader:
    SOURCE = "wikidata"

    def __init__(self, pg_warehouse, *, http_client=None):
        self._pg = pg_warehouse
        self._http = http_client
        self._last_call = 0.0

    def _query(self, sparql: str) -> dict:
        elapsed = time.monotonic() - self._last_call
        if elapsed < RATE_LIMIT_SEC:
            time.sleep(RATE_LIMIT_SEC - elapsed)
        if self._http is not None:
            data = self._http.get_json(SPARQL_URL, params={"query": sparql, "format": "json"})
        else:
            import httpx
            r = httpx.get(
                SPARQL_URL,
                params={"query": sparql, "format": "json"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                timeout=30.0,
            )
            r.raise_for_status()
            data = r.json()
        self._last_call = time.monotonic()
        return data

    def fetch_player(self, name: str) -> Optional[dict]:
        """Return the first hit for ``name`` or None."""
        try:
            data = self._query(PLAYER_BY_NAME % name.replace('"', '\\"'))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Wikidata query for %s failed: %s", name, exc)
            return None
        bindings = ((data.get("results") or {}).get("bindings") or [])
        if not bindings:
            return None
        b = bindings[0]
        return {
            "wikidata_uri": (b.get("player") or {}).get("value"),
            "name": (b.get("playerLabel") or {}).get("value", name),
            "dob": (b.get("dob") or {}).get("value"),
            "nationality": (b.get("nationalityLabel") or {}).get("value"),
            "primary_position": (b.get("positionLabel") or {}).get("value"),
        }

    def enrich_players(self, names: Iterable[str]) -> int:
        """Look up each ``name``; upsert into ``core.dim_players``. Returns count enriched."""
        with self._pg.ingest_run(self.SOURCE, "enrich_players") as _:
            updated = 0
            for name in names:
                hit = self.fetch_player(name)
                if not hit:
                    continue
                with self._pg.connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO core.dim_players (canonical_name, dob, nationality, primary_position)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (canonical_name, dob) DO UPDATE SET
                            nationality = COALESCE(EXCLUDED.nationality, core.dim_players.nationality),
                            primary_position = COALESCE(EXCLUDED.primary_position, core.dim_players.primary_position)
                        """,
                        (
                            hit["name"],
                            (hit.get("dob") or "")[:10] or None,
                            hit.get("nationality"),
                            hit.get("primary_position"),
                        ),
                    )
                    conn.commit()
                updated += 1
            return updated
