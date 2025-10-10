#!/usr/bin/env python3
"""
Generate season URLs for all leagues - BOTH stats and fixtures pages.
Run from root directory: python3 scripts/populate_seasons.py
"""
import json
import os
from datetime import datetime

# --------------------------
# Path Configuration
# --------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "fbref_data")
os.makedirs(DATA_DIR, exist_ok=True)
OUTPUT_PATH = os.path.join(DATA_DIR, "season_links.json")

# --------------------------
# League info - to be expanded with more leagues of interest
# --------------------------
LEAGUES = {
    "premier_league": {"id": 9, "start_season": "1888-1889"},
    "la_liga": {"id": 12, "start_season": "1988-1989"},
    "bundesliga": {"id": 20, "start_season": "1988-1989"},
    "serie_a": {"id": 11, "start_season": "1988-1989"},
    "ligue_1": {"id": 13, "start_season": "1995-1996"},
    "mls": {"id": 22, "start_season": 1996},
    "ucl": {"id": 8, "start_season": "1990-1991"},
    "uel": {"id": 19, "start_season": "1990-1991"},
    "world_cup": {"id": 1, "start_season": 1930}
}

# --------------------------
# Determine current season
# --------------------------
def get_current_season(single_year=False):
    year = datetime.now().year
    if single_year:
        return year
    else:
        month = datetime.now().month
        if month >= 8:
            return f"{year}-{year+1}"
        else:
            return f"{year-1}-{year}"

# --------------------------
# Generate list of seasons
# --------------------------
def generate_seasons(start, end, single_year=False, step=1):
    seasons = []
    if single_year:
        for y in range(start, end + 1, step):
            seasons.append(str(y))
    else:
        start_year = int(start.split("-")[0])
        end_year = int(end.split("-")[0]) if "-" in end else int(end)
        for y in range(end_year, start_year - 1, -1):
            seasons.append(f"{y}-{y+1}")
    return seasons

# --------------------------
# Generate JSON structure
# --------------------------
def generate_season_links():
    season_links = {}

    for league, info in LEAGUES.items():
        league_id = info["id"]
        start_season = info["start_season"]
        single_year = isinstance(start_season, int)
        current_season = get_current_season(single_year=single_year)

        if league == "world_cup":
            seasons = generate_seasons(start=start_season, end=current_season, single_year=True, step=4)
        else:
            seasons = generate_seasons(start=start_season, end=current_season, single_year=single_year)

        links = []
        for s in seasons:
            league_name_clean = league.replace('_', ' ').title()
            if league_name_clean == "Ucl":
                league_name_clean = "Champions-League"
            elif league_name_clean == "Uel":
                league_name_clean = "Europa-League"
            league_name_clean = league_name_clean.replace(' ', '-')
            
            # Store BOTH stats and fixtures URLs
            links.append({
                'season': s,
                'stats_url': f"https://fbref.com/en/comps/{league_id}/{s}/{s}-{league_name_clean}-Stats",
                'fixtures_url': f"https://fbref.com/en/comps/{league_id}/{s}/schedule/{s}-{league_name_clean}-Scores-and-Fixtures"
            })
        
        season_links[league] = links

    return season_links

# --------------------------
# Main
# --------------------------
if __name__ == "__main__":
    print("="*60)
    print("Season Links Generator (Enhanced)")
    print("="*60)
    print(f"\nGenerating season URLs for {len(LEAGUES)} leagues...")
    print("Generating BOTH stats and fixtures URLs for rich data")
    
    season_links = generate_season_links()
    
    for league, links in season_links.items():
        print(f"  {league:20s}: {len(links)} seasons")
    
    with open(OUTPUT_PATH, "w") as f:
        json.dump(season_links, f, indent=2)
    
    print(f"\nSeason links saved to: {OUTPUT_PATH}")
    print(f"  Total seasons: {sum(len(links) for links in season_links.values())}")
    print("="*60)