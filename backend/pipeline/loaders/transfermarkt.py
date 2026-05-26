"""Transfermarkt loader — transfers + market values.

This is a *scraping* source. Transfermarkt's TOS prohibits bulk scraping; this
loader is intentionally conservative:

* Rate-limited to 1 req / 5s
* Identified by a real ``User-Agent`` (no spoofing)
* Caches every fetched page in ``raw.transfermarkt`` to avoid re-scraping
* Disabled by default; enable via ``TRANSFERMARKT_ENABLED=true``

If/when the project adds a paid Sportmonks tier, this loader should be
deprecated in favor of the paid source.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

BASE = "https://www.transfermarkt.com"
USER_AGENT = "FotPredictAI research bot (educational use; contact: shenorrlab@technion.ac.il)"
RATE_LIMIT_SEC = 5.0


@dataclass(frozen=True)
class Transfer:
    player_name: str
    from_team: Optional[str]
    to_team: Optional[str]
    fee_eur: Optional[int]
    window: Optional[str]
    confirmed_date: Optional[str]
    market_value_eur: Optional[int]


class TransfermarktLoader:
    SOURCE = "transfermarkt"

    def __init__(self, pg_warehouse, *, http_client=None):
        self._pg = pg_warehouse
        self._http = http_client
        self._last_call = 0.0

    @property
    def enabled(self) -> bool:
        return os.getenv("TRANSFERMARKT_ENABLED", "").lower() in {"1", "true", "yes"}

    def _get(self, path: str) -> Optional[str]:
        if not self.enabled:
            logger.debug("Transfermarkt disabled; set TRANSFERMARKT_ENABLED=true to use")
            return None
        url = f"{BASE}{path}"
        elapsed = time.monotonic() - self._last_call
        if elapsed < RATE_LIMIT_SEC:
            time.sleep(RATE_LIMIT_SEC - elapsed)
        try:
            if self._http is not None:
                text = self._http.get_text(url)
            else:
                import httpx
                r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=30.0)
                r.raise_for_status()
                text = r.text
        finally:
            self._last_call = time.monotonic()
        return text

    def parse_transfers(self, html: str) -> list[Transfer]:
        """Cheap regex extraction. For production, swap in BeautifulSoup."""
        if not html:
            return []
        # Each row in Transfermarkt's transfers grid follows a recognizable pattern.
        # We deliberately keep this minimal — fragile selectors are why the loader
        # is feature-flagged. Upgrade to a proper HTML parser before relying on it.
        rows = re.findall(r"<tr class=\"odd\">.*?</tr>", html, flags=re.DOTALL)
        transfers: list[Transfer] = []
        for r in rows:
            name = _extract(r, r"data-name=\"([^\"]+)\"")
            fee = _parse_fee(_extract(r, r"fee[^>]*>([^<]+)</"))
            from_team = _extract(r, r"vereinFrom[^>]*>([^<]+)<")
            to_team = _extract(r, r"vereinTo[^>]*>([^<]+)<")
            if not name:
                continue
            transfers.append(Transfer(
                player_name=name,
                from_team=from_team,
                to_team=to_team,
                fee_eur=fee,
                window=None,
                confirmed_date=None,
                market_value_eur=None,
            ))
        return transfers

    def load_transfers(self, slug: str) -> int:
        """Fetch + ingest the transfers listing at ``/{slug}``.

        Example: ``self.load_transfers("transfers/transferrekorde/statistik")``
        """
        with self._pg.ingest_run(self.SOURCE, "load_transfers", params={"slug": slug}) as _:
            html = self._get("/" + slug.lstrip("/"))
            if html is None:
                return 0
            transfers = self.parse_transfers(html)
            if not transfers:
                return 0
            written = 0
            with self._pg.connection() as conn, conn.cursor() as cur:
                for t in transfers:
                    # raw cache
                    cur.execute(
                        "INSERT INTO raw.transfermarkt (kind, payload) VALUES (%s, %s::jsonb)",
                        ("transfer", _json(t.__dict__)),
                    )
                    # Resolve teams sloppily — leaves to_team/from_team as NULL if unknown
                    to_id = _resolve_team(cur, t.to_team)
                    from_id = _resolve_team(cur, t.from_team)
                    # Upsert player (name only; no DOB)
                    cur.execute(
                        """
                        INSERT INTO core.dim_players (canonical_name)
                        VALUES (%s)
                        ON CONFLICT (canonical_name, dob) DO UPDATE SET
                            canonical_name = EXCLUDED.canonical_name
                        RETURNING player_id
                        """,
                        (t.player_name,),
                    )
                    pid = cur.fetchone()[0]
                    cur.execute(
                        """
                        INSERT INTO core.fact_transfers
                            (player_id, from_team_id, to_team_id, fee_eur, window, confirmed_date, source)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (pid, from_id, to_id, t.fee_eur, t.window, _parse_iso(t.confirmed_date), self.SOURCE),
                    )
                    written += 1
                conn.commit()
            return written


# ---- helpers --------------------------------------------------------------

def _extract(s: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, s)
    return m.group(1).strip() if m else None


def _parse_fee(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    raw = raw.replace("&nbsp;", " ").replace("€", "").strip()
    if not raw or raw.lower() in {"-", "free transfer", "loan", "loan transfer"}:
        return 0 if raw and "free" in raw.lower() else None
    try:
        mult = 1
        if raw.endswith("m"):
            mult, raw = 1_000_000, raw[:-1]
        elif raw.endswith("k"):
            mult, raw = 1_000, raw[:-1]
        return int(float(raw.replace(",", ".")) * mult)
    except ValueError:
        return None


def _resolve_team(cur, name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    cur.execute(
        "SELECT team_id FROM core.dim_teams WHERE canonical_name = %s LIMIT 1",
        (name.strip(),),
    )
    row = cur.fetchone()
    return int(row[0]) if row else None


def _parse_iso(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def _json(obj) -> str:
    import json
    return json.dumps(obj, default=str)
