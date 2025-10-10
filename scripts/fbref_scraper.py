#!/usr/bin/env python3
"""
Enhanced FBRef scraper - gets BOTH stats and fixtures for rich data.
Run from root directory: python3 scripts/fbref_scraper.py
"""
import os
import time
import random
import json
import requests
import pandas as pd
from io import StringIO
from bs4 import BeautifulSoup, Comment
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

# --------------------------
# Path Configuration
# --------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "fbref_data")
JSON_PATH = os.path.join(DATA_DIR, "season_links.json")
os.makedirs(DATA_DIR, exist_ok=True)

# --------------------------
# Settings
# --------------------------
DELAY_MIN = 5
DELAY_MAX = 12
MAX_RETRIES = 8
MAX_WORKERS = 2  # Reduced for politeness

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
]

# --------------------------
# Fetch with retry
# --------------------------
def get_soup(url):
    attempt = 0
    while attempt < MAX_RETRIES:
        try:
            headers = {"User-Agent": random.choice(USER_AGENTS)}
            r = requests.get(url, headers=headers, timeout=30)
            if r.status_code == 429:
                wait = random.uniform(DELAY_MIN, DELAY_MAX) * (2 ** attempt)
                print(f"Rate limited. Waiting {wait:.1f}s...")
                time.sleep(wait)
                attempt += 1
                continue
            r.raise_for_status()
            return BeautifulSoup(r.text, "html.parser")
        except requests.exceptions.RequestException as e:
            wait = random.uniform(DELAY_MIN, DELAY_MAX) * (2 ** attempt)
            print(f"Request failed: {e}. Retrying in {wait:.1f}s...")
            time.sleep(wait)
            attempt += 1
    raise Exception(f"Failed after {MAX_RETRIES} attempts: {url}")

# --------------------------
# Extract all tables
# --------------------------
def extract_all_tables(soup, source, url):
    """Extract ALL tables from the page including commented ones."""
    dfs = []
    
    # Extract commented tables (FBRef hides some in HTML comments)
    comments = soup.find_all(string=lambda t: isinstance(t, Comment) and "<table" in t)
    for comment in comments:
        try:
            tables = pd.read_html(StringIO(comment))
            for df in tables:
                if not df.empty:
                    df["_source"] = source
                    df["_url"] = url
                    df["_table_type"] = "commented"
                    dfs.append(df)
        except:
            continue
    
    # Extract visible tables
    for table in soup.find_all("table"):
        try:
            table_id = table.get('id', 'unknown')
            df = pd.read_html(StringIO(str(table)))[0]
            if not df.empty:
                df["_source"] = source
                df["_url"] = url
                df["_table_id"] = table_id
                df["_table_type"] = "visible"
                dfs.append(df)
        except:
            continue
    
    return dfs

# --------------------------
# Scrape single season (both URLs)
# --------------------------
def scrape_season(season_data, league_name):
    """Scrape both stats and fixtures pages for a season."""
    # Handle both dict and string formats
    if isinstance(season_data, dict):
        season = season_data['season']
        stats_url = season_data['stats_url']
        fixtures_url = season_data['fixtures_url']
    else:
        # Fallback for old format (just URL string)
        stats_url = season_data
        fixtures_url = None
        season = "unknown"
    
    all_dfs = []
    
    # Scrape stats page
    try:
        soup = get_soup(stats_url)
        stats_dfs = extract_all_tables(soup, f"{season}_stats", stats_url)
        all_dfs.extend(stats_dfs)
        time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    except Exception as e:
        print(f"Failed to scrape stats for {season}: {e}")
    
    # Scrape fixtures page (if available)
    if fixtures_url:
        try:
            soup = get_soup(fixtures_url)
            fixtures_dfs = extract_all_tables(soup, f"{season}_fixtures", fixtures_url)
            all_dfs.extend(fixtures_dfs)
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
        except Exception as e:
            print(f"Failed to scrape fixtures for {season}: {e}")
    
    if all_dfs:
        return pd.concat(all_dfs, ignore_index=True)
    return None

# --------------------------
# Scrape seasons in parallel
# --------------------------
def scrape_seasons_parallel(season_data_list, league_name):
    all_dfs = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_season = {
            executor.submit(scrape_season, sd, league_name): sd 
            for sd in season_data_list
        }
        
        for future in tqdm(as_completed(future_to_season),
                          total=len(season_data_list),
                          desc=f"Scraping {league_name}",
                          ncols=90):
            season_data = future_to_season[future]
            try:
                df = future.result()
                if df is not None:
                    all_dfs.append(df)
            except Exception as e:
                print(f"Failed {season_data['season']}: {e}")
    
    return all_dfs

# --------------------------
# Update league data
# --------------------------
def update_league_data(league_name, season_data_list):
    csv_path = os.path.join(DATA_DIR, f"{league_name}.csv")
    print(f"\n{'='*60}")
    print(f"Fetching {league_name.replace('_',' ').title()}")
    print(f"{'='*60}")
    
    existing = pd.DataFrame()
    if os.path.exists(csv_path):
        existing = pd.read_csv(csv_path)
        if '_url' in existing.columns:
            fetched_urls = set(existing["_url"].dropna())
            # Filter out already scraped seasons
            new_season_data = []
            for sd in season_data_list:
                if sd['stats_url'] not in fetched_urls and sd['fixtures_url'] not in fetched_urls:
                    new_season_data.append(sd)
            season_data_list = new_season_data
            print(f"Existing data: {len(existing)} rows")
            print(f"New seasons to fetch: {len(season_data_list)}")
    else:
        print(f"No existing CSV. Fetching all {len(season_data_list)} seasons")
    
    if not season_data_list:
        print("Nothing new to fetch.")
        return 0
    
    all_dfs = [existing] if not existing.empty else []
    season_dfs = scrape_seasons_parallel(season_data_list, league_name)
    all_dfs += season_dfs
    
    if all_dfs:
        updated = pd.concat(all_dfs, ignore_index=True)
        updated.to_csv(csv_path, index=False)
        new_rows = len(updated) - len(existing)
        print(f"Saved {csv_path}")
        print(f"  Total rows: {len(updated)} (added {new_rows})")
        return new_rows
    else:
        print("No data scraped")
        return 0

# --------------------------
# Main
# --------------------------
if __name__ == "__main__":
    print("="*60)
    print("Enhanced FBRef Scraper")
    print("="*60)
    print("Scrapes BOTH stats and fixtures for comprehensive data")
    print("="*60)
    
    if not os.path.exists(JSON_PATH):
        print(f"\nError: {JSON_PATH} not found!")
        print("   Please run populate_seasons.py first.")
        exit(1)
    
    with open(JSON_PATH, "r") as f:
        season_links = json.load(f)
    
    print("\nAvailable leagues:")
    for key in season_links:
        print(f"   • {key} ({len(season_links[key])} seasons)")
    
    choice = input("\nEnter league key to fetch (or 'all'): ").strip().lower()
    
    if choice == "all":
        leagues_to_scrape = list(season_links.keys())
    elif choice in season_links:
        leagues_to_scrape = [choice]
    else:
        print("Invalid input.")
        exit(1)
    
    print(f"\n{'='*60}")
    print(f"Scraping {len(leagues_to_scrape)} league(s)...")
    print(f"{'='*60}")
    print("This will take a while due to rate limiting...")
    
    total_new_rows = 0
    for lg in leagues_to_scrape:
        season_data = season_links[lg]
        new_rows = update_league_data(lg, season_data)
        total_new_rows += new_rows
    
    print(f"\n{'='*60}")
    print("Scraping complete!")
    print(f"{'='*60}")
    print(f"Total new rows added: {total_new_rows}")
    print(f"Data saved to: {DATA_DIR}")