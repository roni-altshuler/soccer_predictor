#!/usr/bin/env bash
# Run the FBref scrape on a VIRTUAL display.
#
# Chrome must stay HEADED: headless Chromium was measured failing Cloudflare's
# challenge on 2026-08-11 (403, "Just a moment...", 0 tables) while the same
# browser headed got through. So the browser is real; only the screen is fake.
# xvfb-run starts an X server nobody is looking at and points DISPLAY at it,
# which keeps the windows off the user's desktop without changing anything
# Cloudflare can fingerprint.
#
# ScraperFC's default wait_time is 6s, which is sports-reference's own stated
# bot-traffic limit. It is deliberately NOT lowered.
#
# Two tiers, because they cost three orders of magnitude apart:
#   schedules  one request per LEAGUE-SEASON — every league, all history, hours
#   matches    one request per MATCH — shots and the officials crew, expensive
#
#   backend/scripts/run_fbref_scrape.sh schedules
#   backend/scripts/run_fbref_scrape.sh schedules --leagues "England Premier League"
#   backend/scripts/run_fbref_scrape.sh matches --leagues wave-a --seasons 2023-2025
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.local/bin:$PATH"

TIER="${1:-schedules}"
shift || true
case "$TIER" in
  schedules) MODULE=backend.scripts.ingest_fbref_schedules ;;
  matches)   MODULE=backend.scripts.ingest_fbref ;;
  *) echo "usage: $0 {schedules|matches} [args...]" >&2; exit 2 ;;
esac

exec xvfb-run -a --server-args="-screen 0 1440x900x24" python3 -m "$MODULE" "$@"
