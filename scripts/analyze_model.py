#!/usr/bin/env python3
"""
Analyze machine learning models for each league, generating performance metrics
and visualizations based on confidence thresholds and feature importance.

This script loads trained models and processed data, then calculates and plots
precision, recall, and F1-score across various confidence thresholds for
both training and testing sets. It also visualizes feature importances.
All generated plots are saved as image files in the respective league's
visualization directory.
"""

import os
import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt
import seaborn as sns
from tqdm import tqdm
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix, ConfusionMatrixDisplay
from typing import List, Dict, Any, Tuple

# --------------------------
# Paths
# --------------------------
BASE_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR: str = os.path.join(BASE_DIR, "fbref_data")
PROCESSED_DIR: str = os.path.join(DATA_DIR, "processed")

# --------------------------
# Helper: Load processed data
# --------------------------
def load_processed_data(league_name: str) -> pd.DataFrame:
    """
    Load processed match-level data for a given league.
    """
    processed_path = os.path.join(PROCESSED_DIR, f"{league_name}_processed.csv")
    if not os.path.exists(processed_path):
        raise FileNotFoundError(f"Processed data not found: {processed_path}")
    df = pd.read_csv(processed_path, low_memory=False)
    return df

# --------------------------
# Helper: Prepare features
# --------------------------
def prepare_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series, List[str]]:
    """
    Prepare the feature matrix (X), target variable (y), and feature columns.
    """
    exclude_cols = [
        "home_team", "away_team", "result", "season", "home_goals", "away_goals",
        "date", "venue", "url", "source", "status", "season_start_year"
    ]
    feature_cols = [c for c in df.columns if c not in exclude_cols]
    X = df[feature_cols].select_dtypes(include=[np.number]).fillna(0)
    y = df["result"]
    return X, y, feature_cols

# --------------------------
# Helper: Load trained model
# --------------------------
def load_trained_model(league_name: str) -> Dict[str, Any]:
    """
    Load a trained model and its metadata for a specific league.
    """
    model_path = os.path.join(DATA_DIR, league_name, "model.pkl")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Trained model not found: {model_path}")
    return joblib.load(model_path)

# --------------------------
# Analysis: Confidence Thresholds
# --------------------------
def analyze_confidence_thresholds(
    model: Any, X: pd.DataFrame, y: pd.Series, classes: List[str],
    set_name: str, league_name: str, vis_dir: str
) -> None:
    """
    Analyze model performance across various confidence thresholds and save plots.
    """
    tqdm.write(f"Analyzing confidence thresholds for {league_name} ({set_name} set)...")
    probabilities = model.predict_proba(X)
    thresholds = np.arange(0.0, 1.01, 0.05) # From 0% to 100% confidence

    metrics_data = {cls: {metric: [] for metric in ['precision', 'recall', 'f1-score']} for cls in classes}
    metrics_data['overall_accuracy'] = []
    
    for threshold in tqdm(thresholds, desc=f"Thresholds ({set_name})"):
        predictions_at_threshold = []
        for i, probs in enumerate(probabilities):
            max_proba = np.max(probs)
            if max_proba >= threshold:
                predicted_class_idx = np.argmax(probs)
                predictions_at_threshold.append(classes[predicted_class_idx])
            else:
                predictions_at_threshold.append(None) # No prediction if confidence is too low

        # Filter out 'None' predictions for metric calculation
        valid_indices = [i for i, p in enumerate(predictions_at_threshold) if p is not None]
        if not valid_indices:
            for cls in classes:
                metrics_data[cls]['precision'].append(0)
                metrics_data[cls]['recall'].append(0)
                metrics_data[cls]['f1-score'].append(0)
            metrics_data['overall_accuracy'].append(0)
            continue

        y_true_filtered = y.iloc[valid_indices]
        y_pred_filtered = [predictions_at_threshold[i] for i in valid_indices]

        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true_filtered, y_pred_filtered, labels=classes, average=None, zero_division=0
        )
        
        for i, cls in enumerate(classes):
            metrics_data[cls]['precision'].append(precision[i])
            metrics_data[cls]['recall'].append(recall[i])
            metrics_data[cls]['f1-score'].append(f1[i])
        
        # Calculate accuracy for predictions made
        correct_predictions = sum(1 for true, pred in zip(y_true_filtered, y_pred_filtered) if true == pred)
        metrics_data['overall_accuracy'].append(correct_predictions / len(y_true_filtered) if len(y_true_filtered) > 0 else 0)

    # Plotting individual metrics for each class
    for cls in classes:
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.plot(thresholds, metrics_data[cls]['precision'], label='Precision', marker='o')
        ax.plot(thresholds, metrics_data[cls]['recall'], label='Recall', marker='o')
        ax.plot(thresholds, metrics_data[cls]['f1-score'], label='F1-Score', marker='o')
        ax.set_title(f'{league_name.replace("_", " ").title()} - {set_name.title()} Set: {cls.title()} Metrics by Confidence Threshold')
        ax.set_xlabel('Confidence Threshold')
        ax.set_ylabel('Score')
        ax.legend()
        ax.grid(True, linestyle='--', alpha=0.6)
        ax.set_ylim(0, 1.05)
        plt.tight_layout()
        plt.savefig(os.path.join(vis_dir, f"{league_name}_{set_name}_{cls}_confidence_metrics.png"))
        plt.close(fig)
        tqdm.write(f"Saved {league_name}_{set_name}_{cls}_confidence_metrics.png")

    # Plotting overall accuracy
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(thresholds, metrics_data['overall_accuracy'], label='Overall Accuracy (of predicted)', marker='o', color='purple')
    ax.set_title(f'{league_name.replace("_", " ").title()} - {set_name.title()} Set: Overall Accuracy by Confidence Threshold')
    ax.set_xlabel('Confidence Threshold')
    ax.set_ylabel('Accuracy')
    ax.legend()
    ax.grid(True, linestyle='--', alpha=0.6)
    ax.set_ylim(0, 1.05)
    plt.tight_layout()
    plt.savefig(os.path.join(vis_dir, f"{league_name}_{set_name}_overall_accuracy_confidence.png"))
    plt.close(fig)
    tqdm.write(f"Saved {league_name}_{set_name}_overall_accuracy_confidence.png")

# --------------------------
# Analysis: Feature Importance
# --------------------------
def plot_feature_importance(model: Any, feature_cols: List[str], league_name: str, vis_dir: str) -> None:
    """
    Plot and save feature importances from the trained model.
    """
    tqdm.write(f"Plotting feature importance for {league_name}...")
    importances = model.feature_importances_
    feature_importance_df = pd.DataFrame({'feature': feature_cols, 'importance': importances})
    feature_importance_df = feature_importance_df.sort_values('importance', ascending=False).head(20) # Top 20 features

    fig, ax = plt.subplots(figsize=(12, 8))
    sns.barplot(x='importance', y='feature', data=feature_importance_df, ax=ax, palette='viridis')
    ax.set_title(f'{league_name.replace("_", " ").title()} - Top 20 Feature Importances')
    ax.set_xlabel('Importance')
    ax.set_ylabel('Feature')
    plt.tight_layout()
    plt.savefig(os.path.join(vis_dir, f"{league_name}_feature_importance.png"))
    plt.close(fig)
    tqdm.write(f"Saved {league_name}_feature_importance.png")

# --------------------------
# Main Analysis Function
# --------------------------
def analyze_model_for_league(league_name: str) -> None:
    """
    Perform comprehensive analysis for a given league's model.
    """
    tqdm.write(f"\n{'='*60}")
    tqdm.write(f"Analyzing model for {league_name.upper()}")
    tqdm.write(f"{'='*60}")

    try:
        # Load model and data
        model_data = load_trained_model(league_name)
        model = model_data['model']
        feature_cols = model_data['feature_cols']
        classes = model_data['classes']

        df = load_processed_data(league_name)
        
        # Filter for played matches and last 10 seasons (consistent with training)
        df = df[df["status"] == "played"].copy()
        df["season_start_year"] = df["season"].apply(lambda x: int(str(x).split("-")[0]))
        df = df[(df["season_start_year"] >= 2015) & (df["season_start_year"] <= 2025)]

        X, y, _ = prepare_features(df) # _ to ignore feature_cols from prepare_features as we use model_data's feature_cols
        X = X[feature_cols] # Ensure feature order and selection matches training

        # Split data (consistent with training)
        try:
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, stratify=y, random_state=42
            )
        except ValueError:
            tqdm.write(f"Cannot stratify split for {league_name}. Using random split.")
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )

        vis_dir = os.path.join(DATA_DIR, league_name, "visualizations")
        os.makedirs(vis_dir, exist_ok=True)

        # Run analyses
        analyze_confidence_thresholds(model, X_train, y_train, classes, "train", league_name, vis_dir)
        analyze_confidence_thresholds(model, X_test, y_test, classes, "test", league_name, vis_dir)
        plot_feature_importance(model, feature_cols, league_name, vis_dir)

        # Generate and save confusion matrix for test set
        y_pred_test = model.predict(X_test)
        cm = confusion_matrix(y_test, y_pred_test, labels=classes)
        disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=classes)
        fig, ax = plt.subplots(figsize=(10, 10))
        disp.plot(cmap=plt.cm.Blues, ax=ax)
        ax.set_title(f'{league_name.replace("_", " ").title()} - Test Set Confusion Matrix')
        plt.tight_layout()
        plt.savefig(os.path.join(vis_dir, f"{league_name}_confusion_matrix.png"))
        plt.close(fig)
        tqdm.write(f"Saved {league_name}_confusion_matrix.png")


    except FileNotFoundError as e:
        tqdm.write(f"Error for {league_name}: {e}")
    except Exception as e:
        tqdm.write(f"An unexpected error occurred for {league_name}: {e}")

# --------------------------
# Main execution
# --------------------------
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("SOCCER PREDICTION MODEL ANALYZER")
    print("=" * 60)

    processed_files = [
        f.replace("_processed.csv", "")
        for f in os.listdir(PROCESSED_DIR)
        if f.endswith("_processed.csv")
    ]
    
    available_leagues = []
    for league in processed_files:
        model_path = os.path.join(DATA_DIR, league, "model.pkl")
        if os.path.exists(model_path):
            available_leagues.append(league)
        else:
            print(f"Skipping {league}: No trained model found at {model_path}")

    if not available_leagues:
        print("\nNo trained models found to analyze. Please run train_league_models.py first.")
        exit()

    print(f"\nFound {len(available_leagues)} trained models for leagues:")
    for league in available_leagues:
        print(f"   • {league}")

    print("\nOptions:\n   • Enter league name (e.g., 'premier_league')\n   • Enter 'all' to analyze all leagues")
    choice = input("\nYour choice: ").strip().lower()

    leagues_to_analyze = []
    if choice == "all":
        leagues_to_analyze = available_leagues
    elif choice in available_leagues:
        leagues_to_analyze = [choice]
    else:
        print(f"Error: League '{choice}' not found or no trained model available.")
        exit()

    for league in leagues_to_analyze:
        analyze_model_for_league(league)

    print("\n" + "=" * 60)
    print("ANALYSIS COMPLETE")
    print("=" * 60)
