"""Search service: build a lightweight global search index over cached data.

This package exposes :class:`SearchIndex`, which scans the historical match
JSON files and league metadata in order to power the Google-style omni-search
in the frontend navbar.

The implementation is intentionally dependency-free (plain Python substring +
prefix scoring) so we can serve hundreds of teams and a handful of leagues
without bringing in an external search engine.
"""

from backend.services.search.index_builder import SearchIndex, get_search_index

__all__ = ["SearchIndex", "get_search_index"]
