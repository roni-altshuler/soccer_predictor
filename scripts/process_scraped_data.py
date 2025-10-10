#!/usr/bin/env python3
"""
Enhanced data processor - handles rich stats + fixtures data.
Run from root directory: python3 scripts/process_scraped_data.py
"""
import os
import pandas as pd
import numpy as np
from tqdm import tqdm
import warnings
warnings.filterwarnings('ignore')

# --------------------------
# Paths
# --------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "fbref_data")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
os.makedirs(PROCESSED_DIR, exist_ok=True)

# --------------------------
# Extract match results
# --------------------------
def extract_match_results(df):
    """Extract match results from fixtures table."""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    
    matches = []
    
    # Check for match results columns
    if 'home' in df.columns and 'away' in df.columns and 'score' in df.columns:
        for _, row in df.iterrows():
            try:
                home = row.get('home', np.nan)
                away = row.get('away', np.nan)
                score = row.get('score', np.nan)
                
                if pd.isna(home) or pd.isna(away) or pd.isna(score):
                    continue
                
                # Parse score
                if isinstance(score, str):
                    score = score.replace("-", "–").replace("—", "–")
                    parts = score.split("–")
                    if len(parts) == 2:
                        try:
                            home_goals = int(parts[0].strip())
                            away_goals = int(parts[1].strip())
                            
                            matches.append({
                                'home_team': str(home).strip(),
                                'away_team': str(away).strip(),
                                'home_goals': home_goals,
                                'away_goals': away_goals,
                                'date': row.get('date', ''),
                                'attendance': row.get('attendance', np.nan),
                                'venue': row.get('venue', ''),
                                'referee': row.get('referee', '')
                            })
                        except (ValueError, AttributeError):
                            continue
            except Exception:
                continue
    
    return pd.DataFrame(matches)

# --------------------------
# Extract team statistics
# --------------------------
def extract_team_stats(df):
    """Extract team-level statistics from stats tables."""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    
    # Look for squad/team stats table - must have specific characteristics
    if 'squad' in df.columns or 'team' in df.columns:
        team_col = 'squad' if 'squad' in df.columns else 'team'
        
        # Filter: Only keep rows where team name looks valid (not NaN, not numbers)
        valid_teams = df[team_col].notna() & df[team_col].astype(str).str.len() > 2
        df_filtered = df[valid_teams].copy()
        
        # Must have reasonable number of teams (between 10 and 100)
        if len(df_filtered) < 10 or len(df_filtered) > 100:
            return pd.DataFrame()
        
        # Select numeric columns for stats (limit to reasonable number)
        numeric_cols = df_filtered.select_dtypes(include=[np.number]).columns.tolist()
        
        # Limit columns to prevent memory explosion (take most relevant)
        if len(numeric_cols) > 50:
            # Keep only columns with meaningful names
            important_keywords = ['gf', 'ga', 'xg', 'poss', 'sh', 'sot', 'pass', 'tkl', 'int', 'clr', 'pts', 'w', 'd', 'l']
            numeric_cols = [c for c in numeric_cols if any(kw in c.lower() for kw in important_keywords)][:30]
        
        if numeric_cols and team_col in df_filtered.columns:
            stats_df = df_filtered[[team_col] + numeric_cols].copy()
            stats_df.rename(columns={team_col: 'team'}, inplace=True)
            stats_df['team'] = stats_df['team'].str.strip()
            
            # Remove duplicates
            stats_df = stats_df.drop_duplicates(subset=['team'], keep='first')
            
            return stats_df
    
    return pd.DataFrame()

# --------------------------
# Merge match results with team stats
# --------------------------
def enrich_matches_with_stats(matches_df, team_stats_df):
    """Add team statistics to each match."""
    if team_stats_df.empty or matches_df.empty:
        return matches_df
    
    # Standardize team names
    team_stats_df['team'] = team_stats_df['team'].str.strip()
    matches_df['home_team'] = matches_df['home_team'].str.strip()
    matches_df['away_team'] = matches_df['away_team'].str.strip()
    
    # Merge home team stats
    home_stats = team_stats_df.add_prefix('home_')
    home_stats.rename(columns={'home_team': 'home_team'}, inplace=True)
    enriched = matches_df.merge(home_stats, on='home_team', how='left')
    
    # Merge away team stats
    away_stats = team_stats_df.add_prefix('away_')
    away_stats.rename(columns={'away_team': 'away_team'}, inplace=True)
    enriched = enriched.merge(away_stats, on='away_team', how='left')
    
    return enriched

# --------------------------
# Calculate rolling statistics
# --------------------------
def calculate_rolling_stats(matches_df):
    """Calculate rolling team statistics."""
    if matches_df.empty:
        return matches_df
    
    # Sort by date
    if 'date' in matches_df.columns:
        matches_df = matches_df.sort_values('date').reset_index(drop=True)
    
    # Calculate result
    matches_df['result'] = matches_df.apply(
        lambda row: 'win' if row['home_goals'] > row['away_goals'] 
        else ('loss' if row['home_goals'] < row['away_goals'] else 'draw'),
        axis=1
    )
    
    teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()
    
    team_stats = {team: {
        'goals_scored': [],
        'goals_conceded': [],
        'wins': 0,
        'draws': 0,
        'losses': 0,
        'matches_played': 0
    } for team in teams}
    
    enhanced_matches = []
    
    for idx, match in matches_df.iterrows():
        home = match['home_team']
        away = match['away_team']
        
        home_s = team_stats[home].copy()
        away_s = team_stats[away].copy()
        
        match_features = match.to_dict()
        
        # Add rolling stats
        match_features.update({
            'home_form_goals_scored': np.mean(home_s['goals_scored'][-5:]) if home_s['goals_scored'] else 0,
            'home_form_goals_conceded': np.mean(home_s['goals_conceded'][-5:]) if home_s['goals_conceded'] else 0,
            'home_form_wins': home_s['wins'],
            'home_form_draws': home_s['draws'],
            'home_form_losses': home_s['losses'],
            'home_form_matches': home_s['matches_played'],
            'home_form_win_rate': home_s['wins'] / max(home_s['matches_played'], 1),
            
            'away_form_goals_scored': np.mean(away_s['goals_scored'][-5:]) if away_s['goals_scored'] else 0,
            'away_form_goals_conceded': np.mean(away_s['goals_conceded'][-5:]) if away_s['goals_conceded'] else 0,
            'away_form_wins': away_s['wins'],
            'away_form_draws': away_s['draws'],
            'away_form_losses': away_s['losses'],
            'away_form_matches': away_s['matches_played'],
            'away_form_win_rate': away_s['wins'] / max(away_s['matches_played'], 1),
        })
        
        enhanced_matches.append(match_features)
        
        # Update stats
        team_stats[home]['goals_scored'].append(match['home_goals'])
        team_stats[home]['goals_conceded'].append(match['away_goals'])
        team_stats[away]['goals_scored'].append(match['away_goals'])
        team_stats[away]['goals_conceded'].append(match['home_goals'])
        
        team_stats[home]['matches_played'] += 1
        team_stats[away]['matches_played'] += 1
        
        if match['result'] == 'win':
            team_stats[home]['wins'] += 1
            team_stats[away]['losses'] += 1
        elif match['result'] == 'loss':
            team_stats[home]['losses'] += 1
            team_stats[away]['wins'] += 1
        else:
            team_stats[home]['draws'] += 1
            team_stats[away]['draws'] += 1
    
    return pd.DataFrame(enhanced_matches)

# --------------------------
# Process league
# --------------------------
def process_league(league_name, csv_path):
    """Process a single league with enhanced data."""
    print(f"\n{'='*60}")
    print(f"Processing {league_name}")
    print(f"{'='*60}")
    
    try:
        df = pd.read_csv(csv_path, low_memory=False)
        print(f"Loaded {len(df)} rows from raw data")
        
        # Separate fixtures and stats tables
        fixtures_df = df[df['_source'].str.contains('fixtures', na=False)] if '_source' in df.columns else df
        stats_df = df[df['_source'].str.contains('stats', na=False)] if '_source' in df.columns else pd.DataFrame()
        
        # Extract match results
        matches = extract_match_results(fixtures_df)
        if matches.empty:
            print("No match results found")
            return None
        
        print(f"Extracted {len(matches)} matches")
        
        # Extract team stats
        team_stats = extract_team_stats(stats_df) if not stats_df.empty else pd.DataFrame()
        if not team_stats.empty:
            print(f"Extracted stats for {len(team_stats)} teams")
            matches = enrich_matches_with_stats(matches, team_stats)
        
        # Calculate rolling statistics
        processed = calculate_rolling_stats(matches)
        
        # Add season info
        if '_source' in df.columns:
            # Extract season from source
            processed['season'] = processed['_source'].str.extract(r'(\d{4}-\d{4}|\d{4})')[0] if '_source' in processed.columns else ''
        
        print(f"Processed {len(processed)} matches with {len(processed.columns)} features")
        
        return processed
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return None

# --------------------------
# Main
# --------------------------
def process_all_leagues():
    """Process all leagues."""
    csv_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".csv")]
    
    if not csv_files:
        print("\nNo CSV files found!")
        print("   Please run fbref_scraper.py first")
        return
    
    print(f"\n{'='*60}")
    print("Enhanced Data Processor")
    print(f"{'='*60}")
    print(f"Found {len(csv_files)} league files")
    
    for csv_file in tqdm(csv_files, desc="Processing leagues"):
        league_name = csv_file.replace(".csv", "")
        csv_path = os.path.join(DATA_DIR, csv_file)
        
        processed = process_league(league_name, csv_path)
        
        if processed is not None and not processed.empty:
            output_path = os.path.join(PROCESSED_DIR, f"{league_name}_processed.csv")
            processed.to_csv(output_path, index=False)
            print(f"Saved to: {output_path}")
    
    print(f"\n{'='*60}")
    print("Processing complete!")
    print(f"{'='*60}")
    print(f"Processed data: {PROCESSED_DIR}")

if __name__ == "__main__":
    process_all_leagues()