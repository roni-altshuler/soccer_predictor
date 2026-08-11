"""What the FBref client must refuse to believe.

The bug these guard against, measured 2026-08-11
------------------------------------------------
A 790-league-season sweep finished with `error: 0`, `unscraped: 0`, and a log
line saying `done: 194,591 fixtures stored`. Three whole competitions were
missing from it — **France Ligue 1**, the FIFA World Cup and the FIFA Women's
World Cup — and nothing anywhere said so.

Sports Reference answers a burst with a real, well-formed 110KB document
titled "Rate Limited Request (429 error)". It parses without error. It
contains zero season rows. The client cached it, so every later run scored a
cache hit, extracted nothing, and reported success — the failure was not just
silent but PERMANENT, surviving re-runs indefinitely.

Two rules come out of that, and both are tested here:

  1. A rejection is never cached.
  2. A page that is implausibly short is a rejection, even when it carries no
     error text at all — the World Cup history came back as a 6,253-byte
     shell with no <h1>.
"""
from __future__ import annotations

import gzip

import pytest

from backend.services.fbref.client import (
    MIN_PLAUSIBLE_BYTES,
    FBrefClient,
    cache_path,
    unwrap_comments,
)

REAL_PAGE = "<html><body class='fb'>" + ("<td>x</td>" * 20000) + "</body></html>"
RATE_LIMITED = ("<html><head><title>Rate Limited Request (429 error)</title></head>"
                "<body><h1>Rate Limited Request (429 error)</h1>"
                + ("<p>filler</p>" * 9000) + "</body></html>")
CHALLENGE = "<html><head><title>Just a moment...</title></head><body>" + "x" * 90000
SHELL = "<html><body>nothing here</body></html>"


def _client(tmp_path, monkeypatch, pages):
    """A client whose browser is a list of canned responses."""
    monkeypatch.setattr("backend.services.fbref.client.CACHE_DIR", tmp_path)
    c = FBrefClient(min_interval=0, rejection_backoff=0)
    served = iter(pages)
    c._fetch = lambda url: next(served)
    c._ensure_driver = lambda: None
    return c


@pytest.mark.parametrize("html,expected", [
    (REAL_PAGE, None),
    (RATE_LIMITED, "rate limited"),
    (CHALLENGE, "cloudflare challenge"),
])
def test_rejection_names_what_came_back_instead_of_the_data(html, expected):
    c = FBrefClient(min_interval=0)
    assert c.rejection(html) == expected


def test_a_short_page_is_a_rejection_even_with_no_error_text():
    c = FBrefClient(min_interval=0)
    assert len(SHELL) < MIN_PLAUSIBLE_BYTES
    assert "implausibly short" in c.rejection(SHELL)


def test_a_rate_limited_page_is_never_written_to_the_cache(tmp_path, monkeypatch):
    """The whole defect. Caching the 429 page made the failure permanent."""
    url = "https://fbref.com/en/comps/13/history/Ligue-1-Seasons"
    c = _client(tmp_path, monkeypatch, [RATE_LIMITED] * 4)

    assert c.html(url) is None
    assert not cache_path(url).exists()
    assert c.rejected == 4


def test_it_retries_and_caches_the_page_that_finally_arrives(tmp_path, monkeypatch):
    url = "https://fbref.com/en/comps/13/history/Ligue-1-Seasons"
    c = _client(tmp_path, monkeypatch, [RATE_LIMITED, RATE_LIMITED, REAL_PAGE])

    assert c.html(url) == REAL_PAGE
    assert c.rejected == 2
    path = cache_path(url)
    assert path.exists()
    assert gzip.decompress(path.read_bytes()).decode() == REAL_PAGE


def test_unwrap_comments_exposes_the_tables_sports_reference_hides():
    """Unrelated to rejection, and the other way a page parses to nothing."""
    html = "<div><!-- <table id='shots_all'><tr><td>1</td></tr></table> --></div>"
    assert "<table id='shots_all'>" in unwrap_comments(html)
