#!/usr/bin/env python3
"""
Prediction and analysis tool with enhanced usability.
Handles case-insensitive team names and multi-word inputs.
"""
import os
import json
import argparse
import joblib
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from tqdm import tqdm
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

# --------------------------
# Paths
# --------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "fbref_data")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")

# --------------------------
# Load model
# --------------------------
def load_league_model(league):
    """Load trained model."""
    model_path = os.path.join(DATA_DIR, league, "model.pkl")
    
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model for '{league}' not found. Please train first!")
    
    model_data = joblib.load(model_path)
    print(f"Loaded {league} model (accuracy: {model_data['test_accuracy']:.3f})")
    
    return model_data

# --------------------------
# Load data
# --------------------------
def load_league_data(league):
    """Load processed match data."""
    data_path = os.path.join(PROCESSED_DIR, f"{league}_processed.csv")
    
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Data for '{league}' not found. Please process data first!")
    
    df = pd.read_csv(data_path, low_memory=False)
    return df

# --------------------------
# Find team (case-insensitive fuzzy match)
# --------------------------
def find_team(team_input, available_teams):
    """Find team name with case-insensitive matching."""
    team_input = team_input.strip()
    
    # Exact match (case-insensitive)
    for team in available_teams:
        if team.lower() == team_input.lower():
            return team
    
    # Partial match
    for team in available_teams:
        if team_input.lower() in team.lower():
            return team
    
    # No match found
    raise ValueError(
        f"Team '{team_input}' not found.\n"
        f"Available teams: {', '.join(sorted(available_teams)[:10])}..."
    )

# --------------------------
# Get team statistics
# --------------------------
def get_team_stats(df, team_name, model_data):
    """Calculate average statistics for a team."""
    # Find matches
    home_matches = df[df['home_team'].str.lower() == team_name.lower()]
    away_matches = df[df['away_team'].str.lower() == team_name.lower()]
    
    if home_matches.empty and away_matches.empty:
        available = sorted(set(df['home_team'].unique()) | set(df['away_team'].unique()))
        raise ValueError(f"Team '{team_name}' not found. Available: {', '.join(available[:10])}...")
    
    feature_cols = model_data['feature_cols']
    
    # Get stats
    home_features = home_matches[feature_cols].mean() if not home_matches.empty else pd.Series(0, index=feature_cols)
    away_features = away_matches[feature_cols].mean() if not away_matches.empty else pd.Series(0, index=feature_cols)
    
    combined = (home_features * 0.6 + away_features * 0.4)
    
    return combined.fillna(0)

# --------------------------
# Save prediction
# --------------------------
def save_prediction(output_dir, filename, proba_dict, title, teams=None):
    """Save prediction as JSON and visualization."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Save JSON
    json_path = os.path.join(output_dir, f"{filename}.json")
    result = {
        'timestamp': datetime.now().isoformat(),
        'title': title,
        'probabilities': proba_dict
    }
    if teams:
        result['teams'] = teams
    
    with open(json_path, 'w') as f:
        json.dump(result, f, indent=2)
    
    # Visualization
    plt.figure(figsize=(10, 6))
    outcomes = list(proba_dict.keys())
    probabilities = list(proba_dict.values())
    colors = {'win': '#4CAF50', 'draw': '#FFC107', 'loss': '#F44336'}
    bar_colors = [colors.get(o, '#2196F3') for o in outcomes]
    
    bars = plt.bar(outcomes, probabilities, color=bar_colors, edgecolor='black', linewidth=2)
    
    for bar, prob in zip(bars, probabilities):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height + 0.02,
                f'{prob*100:.1f}%',
                ha='center', va='bottom', fontsize=14, fontweight='bold')
    
    plt.title(title, fontsize=16, fontweight='bold', pad=20)
    plt.ylabel('Probability', fontsize=12)
    plt.ylim(0, 1.0)
    plt.grid(axis='y', alpha=0.3)
    plt.tight_layout()
    
    img_path = os.path.join(output_dir, f"{filename}.png")
    plt.savefig(img_path, dpi=150, bbox_inches='tight')
    plt.close()
    
    print(f"Saved: {json_path}")
    print(f"Saved: {img_path}")

# --------------------------
# Head-to-head prediction
# --------------------------
def predict_head_to_head(league, home_team, away_team):
    """Predict specific match outcome."""
    print("\n" + "="*60)
    print("HEAD-TO-HEAD PREDICTION")
    print("="*60)
    
    model_data = load_league_model(league)
    df = load_league_data(league)
    
    # Find teams (case-insensitive)
    available_teams = sorted(set(df['home_team'].unique()) | set(df['away_team'].unique()))
    home_team = find_team(home_team, available_teams)
    away_team = find_team(away_team, available_teams)
    
    print(f"\nHome: {home_team}")
    print(f"Away: {away_team}")
    print(f"League: {league.replace('_', ' ').title()}")
    
    # Get stats
    home_stats = get_team_stats(df, home_team, model_data)
    away_stats = get_team_stats(df, away_team, model_data)
    
    # Predict
    feature_diff = (home_stats - away_stats).values.reshape(1, -1)
    model = model_data['model']
    proba = model.predict_proba(feature_diff)[0]
    classes = model_data['classes']
    
    proba_dict = {cls: float(prob) for cls, prob in zip(classes, proba)}
    
    # Display results
    print("\n" + "="*60)
    print("PREDICTION RESULTS")
    print("="*60)
    
    # Interpret results clearly
    win_prob = proba_dict.get('win', 0)
    draw_prob = proba_dict.get('draw', 0)
    loss_prob = proba_dict.get('loss', 0)
    
    print(f"\n{'Outcome':<20} {'Probability':<15} {'Bar'}")
    print("-" * 60)
    print(f"{home_team + ' WINS':<20} {win_prob*100:>6.1f}%       {'█' * int(win_prob * 40)}")
    print(f"{'DRAW':<20} {draw_prob*100:>6.1f}%       {'█' * int(draw_prob * 40)}")
    print(f"{away_team + ' WINS':<20} {loss_prob*100:>6.1f}%       {'█' * int(loss_prob * 40)}")
    print("-" * 60)
    
    # Most likely outcome
    if win_prob > max(draw_prob, loss_prob):
        print(f"\nMost Likely: {home_team} WINS ({win_prob*100:.1f}%)")
    elif loss_prob > max(win_prob, draw_prob):
        print(f"\nMost Likely: {away_team} WINS ({loss_prob*100:.1f}%)")
    else:
        print(f"\nMost Likely: DRAW ({draw_prob*100:.1f}%)")
    
    # Save
    output_dir = os.path.join(DATA_DIR, league, "predictions", "head_to_head")
    filename = f"{home_team.replace(' ', '_')}_vs_{away_team.replace(' ', '_')}"
    title = f"{home_team} vs {away_team}\n{league.replace('_', ' ').title()}"
    
    save_prediction(output_dir, filename, proba_dict, title, 
                   teams={'home': home_team, 'away': away_team})
    
    return proba_dict

# --------------------------
# Cross-league prediction
# --------------------------
def predict_cross_league(team_a, league_a, team_b, league_b):
    """Predict cross-league match."""
    print("\n" + "="*60)
    print("CROSS-LEAGUE PREDICTION")
    print("="*60)
    
    model_data_a = load_league_model(league_a)
    model_data_b = load_league_model(league_b)
    df_a = load_league_data(league_a)
    df_b = load_league_data(league_b)
    
    # Find teams
    teams_a = sorted(set(df_a['home_team'].unique()) | set(df_a['away_team'].unique()))
    teams_b = sorted(set(df_b['home_team'].unique()) | set(df_b['away_team'].unique()))
    
    team_a = find_team(team_a, teams_a)
    team_b = find_team(team_b, teams_b)
    
    print(f"\n{team_a} ({league_a})")
    print(f"     VS")
    print(f"{team_b} ({league_b})")
    
    # Get stats
    stats_a = get_team_stats(df_a, team_a, model_data_a)
    stats_b = get_team_stats(df_b, team_b, model_data_b)
    
    # Normalize
    from sklearn.preprocessing import StandardScaler
    scaler = StandardScaler()
    stats_normalized = scaler.fit_transform([stats_a.values, stats_b.values])
    feature_diff = (stats_normalized[0] - stats_normalized[1]).reshape(1, -1)
    
    # Ensemble prediction
    model_a = model_data_a['model']
    model_b = model_data_b['model']
    
    proba_a = model_a.predict_proba(feature_diff)[0]
    proba_b = model_b.predict_proba(feature_diff)[0]
    
    weight_a = model_data_a['test_accuracy']
    weight_b = model_data_b['test_accuracy']
    
    classes = model_data_a['classes']
    proba_ensemble = (proba_a * weight_a + proba_b * weight_b) / (weight_a + weight_b)
    
    proba_dict = {cls: float(prob) for cls, prob in zip(classes, proba_ensemble)}
    
    # Display
    print("\n" + "="*60)
    print("PREDICTION RESULTS")
    print("="*60)
    
    win_prob = proba_dict.get('win', 0)
    draw_prob = proba_dict.get('draw', 0)
    loss_prob = proba_dict.get('loss', 0)
    
    print(f"\n{team_a} WINS: {win_prob*100:.1f}%")
    print(f"DRAW:         {draw_prob*100:.1f}%")
    print(f"{team_b} WINS: {loss_prob*100:.1f}%")
    
    # Save
    output_dir = os.path.join(DATA_DIR, "cross_league_predictions")
    filename = f"{team_a.replace(' ', '_')}_vs_{team_b.replace(' ', '_')}"
    title = f"{team_a} ({league_a}) vs {team_b} ({league_b})"
    
    save_prediction(output_dir, filename, proba_dict, title,
                   teams={'team_a': team_a, 'league_a': league_a,
                         'team_b': team_b, 'league_b': league_b})
    
    return proba_dict

# --------------------------
# Season simulation
# --------------------------
def simulate_season(league, num_simulations=1000):
    """Monte Carlo season simulation."""
    print("\n" + "="*60)
    print("SEASON SIMULATION")
    print("="*60)
    
    model_data = load_league_model(league)
    df = load_league_data(league)
    
    teams = sorted(set(df['home_team'].unique()) | set(df['away_team'].unique()))
    teams = [t for t in teams if pd.notna(t)]
    
    print(f"\nLeague: {league.replace('_', ' ').title()}")
    print(f"Teams: {len(teams)}")
    print(f"Simulations: {num_simulations:,}")
    
    final_points = {team: [] for team in teams}
    
    model = model_data['model']
    classes = model_data['classes']
    feature_cols = model_data['feature_cols']
    
    for sim in tqdm(range(num_simulations), desc="Simulating seasons", ncols=80):
        points = {team: 0 for team in teams}
        
        for _, match in df.iterrows():
            home = match['home_team']
            away = match['away_team']
            
            if pd.isna(home) or pd.isna(away):
                continue
            
            try:
                # Extract features for this match
                home_features = match[[c for c in feature_cols if c.startswith('home_')]].values
                away_features = match[[c for c in feature_cols if c.startswith('away_')]].values
                
                feature_diff = (pd.Series(home_features) - pd.Series(away_features)).values.reshape(1, -1)
                proba = model.predict_proba(feature_diff)[0]
                outcome = np.random.choice(classes, p=proba)
                
                if outcome == 'win':
                    points[home] += 3
                elif outcome == 'draw':
                    points[home] += 1
                    points[away] += 1
                elif outcome == 'loss':
                    points[away] += 3
                    
            except (ValueError, KeyError, IndexError):
                continue
        
        for team in teams:
            final_points[team].append(points[team])
    
    # Calculate statistics
    print("\n" + "="*60)
    print("SIMULATION RESULTS")
    print("="*60)
    
    results = []
    for team in teams:
        if not final_points[team]:
            continue
        
        results.append({
            'team': team,
            'avg_points': np.mean(final_points[team]),
            'std_points': np.std(final_points[team]),
            'min_points': np.min(final_points[team]),
            'max_points': np.max(final_points[team])
        })
    
    results_df = pd.DataFrame(results).sort_values('avg_points', ascending=False)
    
    print("\nProjected Final Standings:")
    print("-" * 80)
    print(f"{'Rank':<6} {'Team':<35} {'Avg Pts':<12} {'Range':<15}")
    print("-" * 80)
    
    for i, row in results_df.iterrows():
        rank = results_df.index.get_loc(i) + 1
        range_str = f"{row['min_points']:.0f}-{row['max_points']:.0f}"
        print(f"{rank:<6} {row['team']:<35} {row['avg_points']:>7.1f}     {range_str:<15}")
    
    # Save
    output_dir = os.path.join(DATA_DIR, league, "predictions", "season_simulation")
    
    champion_probs = (results_df['avg_points'] / results_df['avg_points'].sum()).to_dict()
    save_prediction(output_dir, "champion_probabilities", champion_probs,
                   f"{league.replace('_', ' ').title()} - Championship Probabilities")
    
    results_df.to_csv(os.path.join(output_dir, "full_simulation_results.csv"), index=False)
    print(f"\nFull results: {output_dir}")
    
    return results_df

# --------------------------
# CLI
# --------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Soccer Match Prediction & Analysis Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Head-to-head (handles spaces and case)
  python scripts/predict_and_analyze.py --mode head_to_head \\
      --league premier_league \\
      --home_team "manchester city" \\
      --away_team "liverpool"
  
  # Cross-league
  python scripts/predict_and_analyze.py --mode cross_league \\
      --league_a premier_league --team_a "Manchester City" \\
      --league_b la_liga --team_b "real madrid"
  
  # Season simulation
  python scripts/predict_and_analyze.py --mode season_simulation \\
      --league premier_league --simulations 10000
        """
    )
    
    parser.add_argument("--mode", type=str, required=True,
                       choices=["head_to_head", "cross_league", "season_simulation"])
    parser.add_argument("--league", type=str)
    parser.add_argument("--home_team", type=str, nargs='+')  # Handles multi-word
    parser.add_argument("--away_team", type=str, nargs='+')
    parser.add_argument("--league_a", type=str)
    parser.add_argument("--team_a", type=str, nargs='+')
    parser.add_argument("--league_b", type=str)
    parser.add_argument("--team_b", type=str, nargs='+')
    parser.add_argument("--simulations", type=int, default=1000)
    
    args = parser.parse_args()
    
    # Join multi-word team names
    if args.home_team:
        args.home_team = ' '.join(args.home_team)
    if args.away_team:
        args.away_team = ' '.join(args.away_team)
    if args.team_a:
        args.team_a = ' '.join(args.team_a)
    if args.team_b:
        args.team_b = ' '.join(args.team_b)
    
    try:
        if args.mode == "head_to_head":
            if not all([args.league, args.home_team, args.away_team]):
                parser.error("head_to_head requires --league, --home_team, --away_team")
            predict_head_to_head(args.league, args.home_team, args.away_team)
            
        elif args.mode == "cross_league":
            if not all([args.league_a, args.team_a, args.league_b, args.team_b]):
                parser.error("cross_league requires --league_a, --team_a, --league_b, --team_b")
            predict_cross_league(args.team_a, args.league_a, args.team_b, args.league_b)
            
        elif args.mode == "season_simulation":
            if not args.league:
                parser.error("season_simulation requires --league")
            simulate_season(args.league, args.simulations)
            
    except Exception as e:
        print(f"\nError: {e}")
        exit(1)