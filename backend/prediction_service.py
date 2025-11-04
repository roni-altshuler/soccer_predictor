"""
Prediction service for the Soccer Predictor application.

This module provides functions for loading trained models and data, calculating
team statistics, and making match predictions. It serves as the core logic
behind the API endpoints defined in the main backend server.

The service includes functionalities for:
- Loading serialized machine learning models and processed league data.
- Calculating team statistics based on historical match data.
- Finding teams in the dataset with exact or partial name matching.
- Generating head-to-head and cross-league match predictions.
- Providing various analytics, such as league overviews, season trends, and
  performance distributions.

Functions are designed to be modular and reusable, with clear separation of
concerns for data loading, statistical computation, and prediction generation.
Error handling is incorporated to manage issues like missing files or data.
"""

import os
import json
import joblib
import pandas as pd
from typing import Dict, Tuple, List, Any
from functools import lru_cache
from sklearn.preprocessing import StandardScaler

# Constants
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "fbref_data")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")


@lru_cache(maxsize=10)
def load_league_model(league: str) -> Dict[str, Any]:
    """
    Load the trained model for a specific league.

    Args:
        league: The name of the league.

    Returns:
        A dictionary containing the trained model and associated metadata.

    Raises:
        FileNotFoundError: If the model file for the league is not found.
    """
    model_path = os.path.join(DATA_DIR, league, "model.pkl")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model for '{league}' not found")
    return joblib.load(model_path)


@lru_cache(maxsize=10)
def load_league_data(league: str) -> pd.DataFrame:
    """
    Load the processed match data for a specific league.

    Args:
        league: The name of the league.

    Returns:
        A pandas DataFrame with the processed match data.

    Raises:
        FileNotFoundError: If the data file for the league is not found.
    """
    data_path = os.path.join(PROCESSED_DIR, f"{league}_processed.csv")
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Data for '{league}' not found")
    df = pd.read_csv(data_path, low_memory=False)
    df["total_goals"] = df["home_goals"] + df["away_goals"]
    return df


def get_team_stats(
    df: pd.DataFrame, team_name: str, model_data: Dict[str, Any]
) -> pd.Series:
    """
    Calculate the average statistics for a team based on their matches.

    Args:
        df: The DataFrame containing match data.
        team_name: The name of the team.
        model_data: The model data dictionary, including feature columns.

    Returns:
        A pandas Series with the calculated team statistics.

    Raises:
        ValueError: If the team is not found in the data.
    """
    # Optimize: Convert to lowercase once
    team_lower = team_name.lower()
    
    # Use pre-computed lowercase columns if available, otherwise compute on-the-fly
    if "home_team_lower" in df.columns and "away_team_lower" in df.columns:
        home_mask = df["home_team_lower"] == team_lower
        away_mask = df["away_team_lower"] == team_lower
    else:
        home_mask = df["home_team"].str.lower() == team_lower
        away_mask = df["away_team"].str.lower() == team_lower
    
    home_matches = df[home_mask]
    away_matches = df[away_mask]

    if home_matches.empty and away_matches.empty:
        raise ValueError(f"Team '{team_name}' not found in data")

    feature_cols = model_data["feature_cols"]

    home_features = (
        home_matches[feature_cols].mean()
        if not home_matches.empty
        else pd.Series(0, index=feature_cols)
    )
    away_features = (
        away_matches[feature_cols].mean()
        if not away_matches.empty
        else pd.Series(0, index=feature_cols)
    )

    combined = home_features * 0.6 + away_features * 0.4
    return combined.fillna(0)


def find_team(team_input: str, df: pd.DataFrame) -> str:
    """
    Find the exact or closest matching team name in the DataFrame.

    Args:
        team_input: The user-provided team name.
        df: The DataFrame containing team names.

    Returns:
        The matched team name.

    Raises:
        ValueError: If no matching team is found.
    """
    team_input = team_input.strip().lower()
    available_teams = sorted(
        set(df["home_team"].unique()) | set(df["away_team"].unique())
    )

    for team in available_teams:
        if team.lower() == team_input:
            return team

    for team in available_teams:
        if team_input in team.lower():
            return team

    raise ValueError(
        f"Team '{team_input}' not found. Available teams: {', '.join(sorted(available_teams)[:10])}..."
    )


def get_league_teams(league: str) -> List[str]:
    """
    Get a list of all unique team names in a league.

    Args:
        league: The name of the league.

    Returns:
        A sorted list of unique team names.
    """
    df = load_league_data(league)
    teams = sorted(set(df["home_team"].unique()) | set(df["away_team"].unique()))
    return [t for t in teams if pd.notna(t)]


def predict_scoreline(
    df: pd.DataFrame, 
    home_team: str, 
    away_team: str, 
    outcome_probs: Dict[str, float]
) -> Dict[str, Any]:
    """
    Predict the scoreline for a match based on historical data and outcome probabilities.
    
    Args:
        df: The DataFrame containing historical match data.
        home_team: The name of the home team.
        away_team: The name of the away team.
        outcome_probs: Dictionary with win/draw/loss probabilities.
    
    Returns:
        A dictionary with predicted goals for home and away teams.
    """
    try:
        # Calculate league averages first (fallback values)
        completed_matches = df[df["status"] != "scheduled"]
        if len(completed_matches) == 0:
            # No historical data - use generic values
            return {"predicted_home_goals": 1.5, "predicted_away_goals": 1.0}
        
        league_avg_home = completed_matches["home_goals"].mean()
        league_avg_away = completed_matches["away_goals"].mean()
        
        # Get recent matches for both teams (last 2 seasons for better recency)
        unique_seasons = sorted(df["season"].unique())
        if len(unique_seasons) >= 2:
            recent_seasons = unique_seasons[-2:]
            recent_df = df[df["season"].isin(recent_seasons)].copy()
        else:
            recent_df = df.copy()
        
        # Optimize: Use lowercase comparison
        home_lower = home_team.lower()
        away_lower = away_team.lower()
        
        # Use pre-computed lowercase columns if available
        if "home_team_lower" in recent_df.columns:
            home_as_home = recent_df[recent_df["home_team_lower"] == home_lower]
            home_as_away = recent_df[recent_df["away_team_lower"] == home_lower]
            away_as_home = recent_df[recent_df["home_team_lower"] == away_lower]
            away_as_away = recent_df[recent_df["away_team_lower"] == away_lower]
        else:
            home_as_home = recent_df[recent_df["home_team"].str.lower() == home_lower]
            home_as_away = recent_df[recent_df["away_team"].str.lower() == home_lower]
            away_as_home = recent_df[recent_df["home_team"].str.lower() == away_lower]
            away_as_away = recent_df[recent_df["away_team"].str.lower() == away_lower]
        
        # Calculate home team stats
        home_goals_scored = []
        home_goals_conceded = []
        if len(home_as_home) > 0:
            home_goals_scored.extend(home_as_home["home_goals"].tolist())
            home_goals_conceded.extend(home_as_home["away_goals"].tolist())
        if len(home_as_away) > 0:
            home_goals_scored.extend(home_as_away["away_goals"].tolist())
            home_goals_conceded.extend(home_as_away["home_goals"].tolist())
        
        # Calculate away team stats
        away_goals_scored = []
        away_goals_conceded = []
        if len(away_as_home) > 0:
            away_goals_scored.extend(away_as_home["home_goals"].tolist())
            away_goals_conceded.extend(away_as_home["away_goals"].tolist())
        if len(away_as_away) > 0:
            away_goals_scored.extend(away_as_away["away_goals"].tolist())
            away_goals_conceded.extend(away_as_away["home_goals"].tolist())
        
        # Use team averages or fall back to league averages
        home_scoring_avg = pd.Series(home_goals_scored).mean() if home_goals_scored else league_avg_home
        home_conceding_avg = pd.Series(home_goals_conceded).mean() if home_goals_conceded else league_avg_away
        away_scoring_avg = pd.Series(away_goals_scored).mean() if away_goals_scored else league_avg_away
        away_conceding_avg = pd.Series(away_goals_conceded).mean() if away_goals_conceded else league_avg_home
        
        # Weight prediction by outcome probabilities
        # Strategy: Use team scoring/conceding averages weighted by match outcome
        
        home_win_prob = outcome_probs["home_win"]
        draw_prob = outcome_probs["draw"]
        away_win_prob = outcome_probs["away_win"]
        
        # Base expectations from team stats
        base_home_goals = (home_scoring_avg + away_conceding_avg) / 2
        base_away_goals = (away_scoring_avg + home_conceding_avg) / 2
        
        # Adjust based on outcome probabilities
        # If home team likely to win: boost home goals, reduce away goals
        # If away team likely to win: reduce home goals, boost away goals
        # If draw likely: keep closer to averages
        
        # More aggressive adjustment to make scoreline align with probabilities
        # Use a scaling factor that increases with probability difference
        prob_diff = abs(home_win_prob - away_win_prob)
        adjustment_factor = 0.5 + (prob_diff * 1.0)  # Range: 0.5 to 1.5
        
        if home_win_prob > away_win_prob:
            # Home team favored - boost home goals, reduce away goals
            predicted_home_goals = base_home_goals * (1.0 + adjustment_factor * home_win_prob)
            predicted_away_goals = base_away_goals * (1.0 - adjustment_factor * (home_win_prob - draw_prob) * 0.5)
        elif away_win_prob > home_win_prob:
            # Away team favored - reduce home goals, boost away goals
            predicted_home_goals = base_home_goals * (1.0 - adjustment_factor * (away_win_prob - draw_prob) * 0.5)
            predicted_away_goals = base_away_goals * (1.0 + adjustment_factor * away_win_prob)
        else:
            # Draw or very close - use base values with small adjustment
            predicted_home_goals = base_home_goals * (1.0 + 0.2 * draw_prob)
            predicted_away_goals = base_away_goals * (1.0 + 0.2 * draw_prob)
        
        # Ensure minimum difference when there's a clear favorite
        if prob_diff > 0.15:  # More than 15% difference
            if home_win_prob > away_win_prob:
                # Ensure home team scores more
                if predicted_home_goals <= predicted_away_goals:
                    predicted_home_goals = predicted_away_goals + 0.5 + (prob_diff * 2)
            else:
                # Ensure away team scores more
                if predicted_away_goals <= predicted_home_goals:
                    predicted_away_goals = predicted_home_goals + 0.5 + (prob_diff * 2)
        
        # Round to 1 decimal place for cleaner display
        return {
            "predicted_home_goals": round(predicted_home_goals, 1),
            "predicted_away_goals": round(predicted_away_goals, 1),
        }
    except Exception as e:
        print(f"Error in predict_scoreline: {str(e)}")
        # Return fallback values on error
        return {
            "predicted_home_goals": 1.5,
            "predicted_away_goals": 1.0,
        }


def predict_head_to_head(league: str, home_team: str, away_team: str) -> Dict[str, Any]:
    """
    Make a head-to-head prediction for a match within a single league.
    Includes both outcome probabilities and predicted scoreline.

    Args:
        league: The league of the match.
        home_team: The name of the home team.
        away_team: The name of the away team.

    Returns:
        A dictionary with prediction probabilities, predicted scoreline, and team information.
    """
    model_data = load_league_model(league)
    df = load_league_data(league)

    home_team_found = find_team(home_team, df)
    away_team_found = find_team(away_team, df)

    home_stats = get_team_stats(df, home_team_found, model_data)
    away_stats = get_team_stats(df, away_team_found, model_data)

    feature_diff = pd.DataFrame(home_stats - away_stats).T

    model = model_data["model"]
    proba = model.predict_proba(feature_diff)[0]
    classes = model_data["classes"]

    outcome_probs = {
        "home_win": float(proba[classes.index("win")]),
        "draw": float(proba[classes.index("draw")]),
        "away_win": float(proba[classes.index("loss")]),
    }
    
    # Add scoreline prediction
    scoreline = predict_scoreline(df, home_team_found, away_team_found, outcome_probs)

    return {
        **outcome_probs,
        **scoreline,
        "home_team": home_team_found,
        "away_team": away_team_found,
    }


def predict_cross_league(
    team_a: str, league_a: str, team_b: str, league_b: str
) -> Dict[str, Any]:
    """
    Make a prediction for a match between teams from two different leagues.
    Includes both outcome probabilities and predicted scoreline.

    Args:
        team_a: Name of the first team.
        league_a: League of the first team.
        team_b: Name of the second team.
        league_b: League of the second team.

    Returns:
        A dictionary with prediction probabilities, predicted scoreline, and team information.
    """
    model_data_a = load_league_model(league_a)
    model_data_b = load_league_model(league_b)
    df_a = load_league_data(league_a)
    df_b = load_league_data(league_b)

    team_a_found = find_team(team_a, df_a)
    team_b_found = find_team(team_b, df_b)

    stats_a = get_team_stats(df_a, team_a_found, model_data_a)
    stats_b = get_team_stats(df_b, team_b_found, model_data_b)

    scaler = StandardScaler()
    feature_names = stats_a.index
    stats_normalized = scaler.fit_transform([stats_a.values, stats_b.values])
    
    stats_normalized_df = pd.DataFrame(stats_normalized, columns=feature_names)
    
    feature_diff = pd.DataFrame(stats_normalized_df.iloc[0] - stats_normalized_df.iloc[1]).T

    model_a = model_data_a["model"]
    model_b = model_data_b["model"]

    proba_a = model_a.predict_proba(feature_diff)[0]
    proba_b = model_b.predict_proba(feature_diff)[0]

    weight_a = model_data_a["test_accuracy"]
    weight_b = model_data_b["test_accuracy"]

    classes = model_data_a["classes"]
    proba_ensemble = (proba_a * weight_a + proba_b * weight_b) / (weight_a + weight_b)

    outcome_probs = {
        "team_a_win": float(proba_ensemble[classes.index("win")]),
        "draw": float(proba_ensemble[classes.index("draw")]),
        "team_b_win": float(proba_ensemble[classes.index("loss")]),
    }
    
    # For scoreline, combine data from both leagues
    # Use league_a data with team_a as home, team_b stats from league_b
    combined_df = pd.concat([df_a, df_b], ignore_index=True)
    scoreline = predict_scoreline(combined_df, team_a_found, team_b_found, {
        "home_win": outcome_probs["team_a_win"],
        "draw": outcome_probs["draw"],
        "away_win": outcome_probs["team_b_win"],
    })

    return {
        **outcome_probs,
        "predicted_team_a_goals": scoreline["predicted_home_goals"],
        "predicted_team_b_goals": scoreline["predicted_away_goals"],
        "team_a": team_a_found,
        "team_b": team_b_found,
        "league_a": league_a,
        "league_b": league_b,
    }


# --------------------------
# Analytics Functions
# --------------------------


def get_model_metrics(league: str) -> Dict[str, Any]:
    """
    Get model performance metrics for a given league.

    Args:
        league: The name of the league.

    Returns:
        A dictionary with model performance metrics.
    """
    model_data = load_league_model(league)
    metrics = {
        "train_accuracy": model_data.get("train_accuracy"),
        "test_accuracy": model_data.get("test_accuracy"),
        "train_report": model_data.get("train_report"),
        "test_report": model_data.get("test_report"),
        "n_samples": model_data.get("n_samples"),
    }
    return metrics


def get_upcoming_matches(league: str) -> List[Dict[str, Any]]:
    """
    Get upcoming matches for a given league with predictions.
    
    Shows scheduled matches from the CURRENT season (2025-2026).
    Displays matches from the start of the current week (Sunday) through the end of next week (Saturday).
    This includes past games that already occurred this week.
    Uses team stats from the last 10 seasons for more accurate predictions.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with upcoming match data and predictions.
    """
    try:
        from datetime import datetime, timedelta
        
        df = load_league_data(league)
        
        # CURRENT SEASON: Get both scheduled and completed matches from 2025-2026 season
        current_season = "2025-2026"
        
        # Convert date column to datetime first
        df["date"] = pd.to_datetime(df["date"], errors='coerce')
        today = pd.Timestamp.now().normalize()
        
        # Calculate the start of the current week (Sunday)
        days_since_sunday = (today.weekday() + 1) % 7  # Monday=0, Sunday=6 -> convert to Sunday=0
        week_start = today - timedelta(days=days_since_sunday)
        
        # Get matches from start of current week through end of next week (14 days from week start)
        week_end = week_start + timedelta(days=13)  # Sunday to Saturday (2 weeks)
        
        # Include both scheduled AND completed matches within the time window
        # This allows us to show past games from this week with predictions
        current_week_matches = df[
            (df["season"] == current_season) &
            (df["date"] >= week_start) & 
            (df["date"] <= week_end)
        ].copy()
        
        if current_week_matches.empty:
            print(f"No matches found for {league} in current/next week")
            return []
        
        # Sort by date
        current_week_matches = current_week_matches.sort_values('date')
        print(f"Found {len(current_week_matches)} matches for {league} in current/next week (status breakdown: {current_week_matches['status'].value_counts().to_dict()})")

        # For team stats, use ALL historical data EXCLUDING current season
        # This matches the training data approach
        completed_df = df[
            (df["status"] != "scheduled") & 
            (df["season"] != current_season)
        ].copy()
        
        # Pre-lowercase team columns for faster comparison
        completed_df["home_team_lower"] = completed_df["home_team"].str.lower()
        completed_df["away_team_lower"] = completed_df["away_team"].str.lower()
        
        print(f"Using {len(completed_df)} completed matches from all historical seasons (excluding current) for team stats")

        model_data = load_league_model(league)
        model = model_data["model"]
        classes = model_data["classes"]
        
        # Pre-compute team stats for all unique teams
        unique_teams = set(current_week_matches["home_team"].tolist() + current_week_matches["away_team"].tolist())
        team_stats_cache = {}
        
        print(f"Computing stats for {len(unique_teams)} unique teams...")
        for team in unique_teams:
            try:
                team_stats_cache[team] = get_team_stats(completed_df, team, model_data)
            except Exception as e:
                print(f"Warning: Could not compute stats for {team}: {str(e)}")
                continue

        predictions = []
        for idx, match in current_week_matches.iterrows():
            try:
                home_team = match["home_team"]
                away_team = match["away_team"]
                
                # Skip if we don't have stats for both teams
                if home_team not in team_stats_cache or away_team not in team_stats_cache:
                    print(f"Skipping {home_team} vs {away_team} - missing team stats")
                    continue
                
                home_stats = team_stats_cache[home_team]
                away_stats = team_stats_cache[away_team]
                feature_diff = pd.DataFrame(home_stats - away_stats).T
                
                if feature_diff is not None:
                    probs = model.predict_proba(feature_diff)[0]
                    
                    outcome_probs = {
                        "home_win": float(probs[classes.index("win")]),
                        "draw": float(probs[classes.index("draw")]),
                        "away_win": float(probs[classes.index("loss")]),
                    }
                    
                    # Add scoreline prediction
                    scoreline = predict_scoreline(completed_df, home_team, away_team, outcome_probs)
                    
                    match_dict = {
                        "date": match["date"].isoformat(),
                        "home_team": home_team,
                        "away_team": away_team,
                        "predicted_home_win": outcome_probs["home_win"],
                        "predicted_draw": outcome_probs["draw"],
                        "predicted_away_win": outcome_probs["away_win"],
                        "predicted_home_goals": scoreline["predicted_home_goals"],
                        "predicted_away_goals": scoreline["predicted_away_goals"],
                    }
                    predictions.append(match_dict)
            except Exception as e:
                print(f"Error predicting match {match['home_team']} vs {match['away_team']}: {str(e)}")
                continue

        print(f"Successfully generated {len(predictions)} predictions")
        
        # Deduplicate matches based on date, home_team, and away_team
        seen_matches = set()
        deduplicated_predictions = []
        
        for match in predictions:
            # Create a unique key for each match
            match_key = (match["date"], match["home_team"].lower(), match["away_team"].lower())
            
            if match_key not in seen_matches:
                seen_matches.add(match_key)
                deduplicated_predictions.append(match)
            else:
                print(f"Removing duplicate: {match['home_team']} vs {match['away_team']} on {match['date']}")
        
        print(f"After deduplication: {len(deduplicated_predictions)} unique matches")
        deduplicated_predictions.sort(key=lambda x: x["date"])
        return deduplicated_predictions

    except Exception as e:
        print(f"Error getting upcoming matches for league {league}: {str(e)}")
        import traceback
        traceback.print_exc()
        return []


def get_league_stats_overview(league: str) -> Dict[str, Any]:
    """
    Get an overview of statistics for a given league.

    Args:
        league: The name of the league.

    Returns:
        A dictionary of aggregated league statistics.
    """
    df = load_league_data(league)
    total_matches = len(df)
    avg_goals = df["total_goals"].mean()
    home_win_pct = (df["result"] == "win").mean()
    draw_pct = (df["result"] == "draw").mean()
    loss_pct = (df["result"] == "loss").mean()
    return {
        "total_matches": total_matches,
        "avg_goals_per_match": round(avg_goals, 2),
        "home_win_percentage": round(home_win_pct * 100, 1),
        "draw_percentage": round(draw_pct * 100, 1),
        "away_win_percentage": round(loss_pct * 100, 1),
    }


def get_season_trends(league: str) -> List[Dict[str, Any]]:
    """
    Get season-by-season trends for average goals.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with season and total_goals data.
    """
    df = load_league_data(league)
    df.dropna(subset=["season"], inplace=True)
    if df.empty:
        return []
    trends = df.groupby("season")["total_goals"].mean().round(2).reset_index()
    trends.columns = ["season", "total_goals"]
    return trends.to_dict(orient="records")


def get_result_distribution(league: str) -> List[Dict[str, Any]]:
    """
    Get the distribution of match results (win, draw, loss).

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries representing the result distribution.
    """
    df = load_league_data(league)
    dist = df["result"].value_counts().reset_index()
    dist.columns = ["name", "value"]
    return dist.to_dict(orient="records")


def get_home_away_performance(league: str) -> List[Dict[str, Any]]:
    """
    Get home vs. away performance statistics.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with home wins, away wins, and draws.
    """
    df = load_league_data(league)
    home_wins = len(df[df["result"] == "win"])
    away_wins = len(df[df["result"] == "loss"])
    draws = len(df[df["result"] == "draw"])
    return [
        {"name": "Home Wins", "value": home_wins},
        {"name": "Away Wins", "value": away_wins},
        {"name": "Draws", "value": draws},
    ]


def get_goals_distribution(league: str) -> List[Dict[str, Any]]:
    """
    Get the distribution of total goals per match.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries representing the goals distribution.
    """
    df = load_league_data(league)
    df.dropna(subset=["total_goals"], inplace=True)
    if df.empty:
        return []
    dist = df["total_goals"].value_counts().sort_index().reset_index()
    dist.columns = ["name", "value"]
    return dist.to_dict(orient="records")