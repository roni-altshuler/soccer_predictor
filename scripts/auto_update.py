#!/usr/bin/env python3
"""
Auto-update system for soccer predictor.
Checks for new data, updates CSVs, and retrains models.
Run manually or schedule with cron/Task Scheduler.
"""
import os
import sys
import json
import subprocess
from datetime import datetime
import logging

# Setup logging
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
LOG_DIR = os.path.join(ROOT_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, f'update_{datetime.now().strftime("%Y%m%d")}.log')),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# --------------------------
# Configuration
# --------------------------
DATA_DIR = os.path.join(ROOT_DIR, "fbref_data")
SEASON_LINKS_PATH = os.path.join(DATA_DIR, "season_links.json")

# Leagues to update (or 'all')
LEAGUES_TO_UPDATE = 'all'  # Change to specific league if needed

# Retrain threshold: retrain if new data added
RETRAIN_THRESHOLD = 10  # Minimum new rows to trigger retrain

# --------------------------
# Run script helper
# --------------------------
def run_script(script_name, *args, input_text=None):
    """Run a Python script and return success status."""
    script_path = os.path.join(SCRIPT_DIR, script_name)
    
    try:
        logger.info(f"Running {script_name}...")
        cmd = [sys.executable, script_path] + list(args)
        
        result = subprocess.run(
            cmd,
            input=input_text,
            text=True,
            capture_output=True,
            cwd=ROOT_DIR
        )
        
        if result.returncode == 0:
            logger.info(f"{script_name} completed successfully")
            logger.debug(result.stdout)
            return True, result.stdout
        else:
            logger.error(f"{script_name} failed: {result.stderr}")
            return False, result.stderr
            
    except Exception as e:
        logger.error(f"Error running {script_name}: {e}")
        return False, str(e)

# --------------------------
# Check for updates
# --------------------------
def check_for_updates():
    """Check if season links need updating (new season started)."""
    logger.info("Checking for season updates...")
    
    if not os.path.exists(SEASON_LINKS_PATH):
        logger.warning("Season links not found. Generating...")
        return True
    
    # Check if we're in a new season (August = new season)
    now = datetime.now()
    if now.month == 8 and now.day <= 7:
        logger.info("New season detected (August). Updating season links...")
        return True
    
    # Check file age
    file_mod_time = datetime.fromtimestamp(os.path.getmtime(SEASON_LINKS_PATH))
    days_old = (now - file_mod_time).days
    
    if days_old > 30:
        logger.info(f"Season links are {days_old} days old. Updating...")
        return True
    
    logger.info("Season links are up to date.")
    return False

# --------------------------
# Update workflow
# --------------------------
def update_data():
    """Run the update workflow."""
    logger.info("="*60)
    logger.info("SOCCER PREDICTOR AUTO-UPDATE")
    logger.info("="*60)
    logger.info(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Step 1: Update season links if needed
    if check_for_updates():
        success, output = run_script("populate_seasons.py")
        if not success:
            logger.error("Failed to update season links. Aborting.")
            return False
    
    # Step 2: Scrape new data
    logger.info("\nStep 2: Scraping new data...")
    success, output = run_script("fbref_scraper.py", input_text=LEAGUES_TO_UPDATE + "\n")
    
    if not success:
        logger.error("Failed to scrape data. Aborting.")
        return False
    
    # Parse output to check if new data was added
    new_rows = 0
    for line in output.split('\n'):
        if 'new rows:' in line.lower():
            try:
                new_rows += int(line.split(':')[-1].strip())
            except:
                pass
    
    logger.info(f"Total new rows added: {new_rows}")
    
    if new_rows == 0:
        logger.info("No new data found. Skipping processing and training.")
        return True
    
    # Step 3: Process new data
    logger.info("\nStep 3: Processing data...")
    success, output = run_script("process_scraped_data.py")
    
    if not success:
        logger.error("Failed to process data. Continuing anyway...")
    
    # Step 4: Retrain models if enough new data
    if new_rows >= RETRAIN_THRESHOLD:
        logger.info(f"\nStep 4: Retraining models ({new_rows} new rows)...")
        success, output = run_script("train_league_models.py", input_text=LEAGUES_TO_UPDATE + "\n")
        
        if not success:
            logger.error("Failed to retrain models.")
            return False
        
        logger.info("Models retrained successfully")
    else:
        logger.info(f"\nStep 4: Skipping retrain ({new_rows} < {RETRAIN_THRESHOLD} threshold)")
    
    logger.info("\n" + "="*60)
    logger.info("AUTO-UPDATE COMPLETE")
    logger.info("="*60)
    logger.info(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    return True

# --------------------------
# Health check
# --------------------------
def health_check():
    """Check system health and data integrity."""
    logger.info("\nRunning health check...")
    issues = []
    
    # Check data directory
    if not os.path.exists(DATA_DIR):
        issues.append("Data directory missing")
    
    # Check for CSV files
    csv_count = len([f for f in os.listdir(DATA_DIR) if f.endswith('.csv')]) if os.path.exists(DATA_DIR) else 0
    if csv_count == 0:
        issues.append("No CSV data files found")
    
    # Check processed directory
    processed_dir = os.path.join(DATA_DIR, "processed")
    if not os.path.exists(processed_dir):
        issues.append("Processed directory missing")
    else:
        processed_count = len([f for f in os.listdir(processed_dir) if f.endswith('.csv')])
        if processed_count == 0:
            issues.append("No processed data files found")
    
    # Check for models
    model_count = 0
    if os.path.exists(DATA_DIR):
        for item in os.listdir(DATA_DIR):
            model_path = os.path.join(DATA_DIR, item, "model.pkl")
            if os.path.exists(model_path):
                model_count += 1
    
    if model_count == 0:
        issues.append("No trained models found")
    
    # Report
    if issues:
        logger.warning(f"Health check found {len(issues)} issue(s):")
        for issue in issues:
            logger.warning(f"  - {issue}")
        return False
    else:
        logger.info(f"Health check passed")
        logger.info(f"  - {csv_count} data files")
        logger.info(f"  - {model_count} trained models")
        return True

# --------------------------
# Main
# --------------------------
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Auto-update soccer predictor")
    parser.add_argument("--check-only", action="store_true", help="Only run health check")
    parser.add_argument("--force", action="store_true", help="Force update even if no changes")
    parser.add_argument("--leagues", type=str, default="all", help="Leagues to update (default: all)")
    
    args = parser.parse_args()
    
    if args.check_only:
        health_check()
        sys.exit(0)
    
    if args.leagues:
        LEAGUES_TO_UPDATE = args.leagues
    
    # Run health check first
    health_check()
    
    # Run update
    success = update_data()
    
    if success:
        logger.info("\nUpdate completed successfully")
        sys.exit(0)
    else:
        logger.error("\nUpdate failed")
        sys.exit(1)
