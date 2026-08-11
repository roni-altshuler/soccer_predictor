"""One browser, kept alive, with a disk cache and a rate limit that is honoured.

Why not just use ScraperFC directly
-----------------------------------
ScraperFC works — it is the only thing measured on 2026-08-11 that got past
Cloudflare's challenge, where plain `requests`, curl with full browser headers,
and headless Chromium all returned 403 "Just a moment...". But its `_get_soup`
is decorated `@browser(headless=False, ...)` with no `reuse_driver`, so **every
page launches and tears down a whole Chrome**. Measured cost: 8.6s per match,
of which the 6s policy wait is only part — the rest is browser startup.

This client keeps one driver alive for the whole run. It also does three
things ScraperFC does not, each of which was a real defect in the first pass:

  1. **Unwraps HTML comments.** Sports-Reference ships most secondary tables
     inside `<!-- ... -->`. `_get_shots` looks for `table#shots_all` in a soup
     where that table is still comment text, so it silently returns an empty
     DataFrame — the first probe stored 11 matches and 0 shots. The
     `comm.sub("", res.text)` line in the widely-copied scraping notebook
     exists for exactly this reason.
  2. **Caches raw HTML to disk.** A parser bug should cost a re-parse, not a
     re-scrape. At six seconds a page that distinction is the difference
     between a minute and a day.
  3. **Enforces the interval itself.** Sports-Reference publishes a bot-traffic
     policy and asks for a request every few seconds. The default here matches
     their stated limit and is deliberately not tunable below it.

Headless is not an option
-------------------------
`headless=True` fails the challenge — measured, 403 with the interstitial. The
browser must be real. `enable_xvfb_virtual_display` renders it to an X server
nobody is looking at, which keeps windows off the user's desktop without
changing anything Cloudflare can fingerprint.

CI cannot run this. There is no browser on a GitHub runner and the challenge
would fail regardless, so this is a local bake whose OUTPUT is the artefact —
the same pattern the sibling F1 project uses for race replays.
"""
from __future__ import annotations

import gzip
import os
import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup, Comment

logger = logging.getLogger("fbref.client")

# Sports-Reference's published guidance for automated traffic. Not lowered.
MIN_INTERVAL_SECONDS = 6.0

CACHE_DIR = Path(__file__).resolve().parents[3] / "backend" / "data" / "cache" / "fbref_html"

_COMMENT_MARKERS = re.compile(r"<!--|-->")


def unwrap_comments(html: str) -> str:
    """Strip comment markers so hidden tables become real tags.

    Sports-Reference wraps secondary tables in comments to keep them out of the
    initial render. Removing only the markers — not the content — turns them
    into ordinary markup that BeautifulSoup and pandas can both see.
    """
    return _COMMENT_MARKERS.sub("", html)


def cache_path(url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / digest[:2] / f"{digest}.html.gz"


class FBrefClient:
    """A single long-lived browser session.

    Not thread-safe and deliberately so: two drivers hitting the same host
    would double the request rate and break the policy this class exists to
    keep.
    """

    def __init__(self, *, min_interval: float = MIN_INTERVAL_SECONDS,
                 use_cache: bool = True,
                 virtual_display: Optional[bool] = None) -> None:
        self.min_interval = max(min_interval, MIN_INTERVAL_SECONDS)
        self.use_cache = use_cache
        # Exactly ONE virtual display. `run_fbref_scrape.sh` wraps the process
        # in xvfb-run, which exports DISPLAY; letting botasaurus start a second
        # Xvfb inside that one hangs the launch — measured, 110 seconds with
        # zero pages fetched. So if DISPLAY already points somewhere other than
        # the desktop, use it and let botasaurus stay out of the way.
        if virtual_display is None:
            display = os.environ.get("DISPLAY", "")
            virtual_display = display in ("", ":0")
        self.virtual_display = virtual_display
        self._last_request = 0.0
        self._fetch = None
        self.fetched = 0
        self.cache_hits = 0

    # -- browser ------------------------------------------------------------
    def _ensure_driver(self):
        if self._fetch is not None:
            return
        from botasaurus.browser import browser

        @browser(
            reuse_driver=True,          # the whole point: one Chrome, many pages
            headless=False,             # headless fails the challenge, measured
            enable_xvfb_virtual_display=self.virtual_display,
            block_images_and_css=True,  # tables only; this roughly halves load time
            wait_for_complete_page_load=False,
            output=None, create_error_logs=False,
            max_retry=3, retry_wait=15,
        )
        def _fetch(driver, url):  # pragma: no cover - needs a browser
            driver.google_get(url)
            # `body.fb` is the class Sports-Reference puts on a rendered page.
            # Its absence means the challenge is still up, so reload rather
            # than parse an interstitial into an empty table.
            for _ in range(6):
                try:
                    driver.wait_for_element("body.fb", wait=10)
                    return driver.page_html
                except Exception:  # noqa: BLE001 — retry is the whole handler
                    driver.reload()
            return driver.page_html

        self._fetch = _fetch

    def _throttle(self) -> None:
        gap = time.time() - self._last_request
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last_request = time.time()

    # -- fetching -----------------------------------------------------------
    def html(self, url: str, *, refresh: bool = False) -> Optional[str]:
        """Raw page HTML, from disk when it is already there."""
        path = cache_path(url)
        if self.use_cache and not refresh and path.exists():
            self.cache_hits += 1
            try:
                return gzip.decompress(path.read_bytes()).decode("utf-8")
            except OSError:
                logger.warning("corrupt cache entry, refetching: %s", path)

        self._ensure_driver()
        self._throttle()
        try:
            html = self._fetch(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch failed %s: %s", url, str(exc)[:160])
            return None
        if not html:
            return None
        self.fetched += 1

        if self.use_cache:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(gzip.compress(html.encode("utf-8")))
        return html

    def soup(self, url: str, *, refresh: bool = False) -> Optional[BeautifulSoup]:
        """Parsed page with commented-out tables promoted to real markup."""
        html = self.html(url, refresh=refresh)
        if not html:
            return None
        return BeautifulSoup(unwrap_comments(html), "html.parser")

    def is_challenge(self, html: str) -> bool:
        return "Just a moment" in html[:4000] or "cf-mitigated" in html[:4000]

    def stats(self) -> dict:
        return {"fetched": self.fetched, "cache_hits": self.cache_hits}


def commented_tables(soup: BeautifulSoup) -> int:
    """How many tables are still hidden in comments — a parser smoke test.

    Should be zero on a soup built by `FBrefClient.soup`. A non-zero count
    means the unwrap did not run and every secondary table will read empty.
    """
    return sum(1 for c in soup.find_all(string=lambda el: isinstance(el, Comment))
               if "<table" in c)
