# Model Retraining Guide

## ⚠️ IMPORTANT: Scikit-learn Version Mismatch

Your models were previously trained with scikit-learn 1.6.1, but your environment now has 1.7.2. This causes compatibility warnings and potential prediction issues.

**You MUST retrain all models to fix this.**

---

## Quick Retraining Steps

### 1. Navigate to Scripts Directory

```bash
cd /home/roaltshu/code/soccer_predictor/scripts
```

### 2. Run the Training Script

```bash
python train_league_models.py
```

### 3. When Prompted

- Enter `all` to retrain ALL leagues (recommended)
- Or enter a specific league name like `premier_league`

### 4. Wait for Completion

The script will:

- Filter data to last 10 seasons (2015-2025)
- Apply exponential weighting (recent seasons get 10x more weight)
- Train with custom class weights to reduce draw bias
- Generate comprehensive visualizations
- Save models with current sklearn version

### 5. Restart the Development Server

```bash
cd /home/roaltshu/code/soccer_predictor
npm run dev
```

---

## What Gets Generated

For each league, the training script creates:

### Visualizations (saved to `fbref_data/<league>/visualizations/`)

1. **Confusion Matrix** - Shows prediction accuracy breakdown
2. **Feature Importance** - Top 15 most influential features
3. **Prediction Distribution** - Confidence levels across all predictions
4. **Train Classification Report** - Precision/Recall/F1 for training set
5. **Test Classification Report** - Precision/Recall/F1 for test set

### Model File (saved to `fbref_data/<league>/model.pkl`)

Contains:

- Trained RandomForest model
- Feature columns used
- Class labels (win/draw/loss)
- Training/test accuracy
- Classification reports
- Number of samples

---

## Model Configuration

### Season Weighting

- **Last 10 seasons only** (2015-2016 to 2024-2025)
- **Exponential weighting**: Recent years get quadratically more weight
- 2015-2016: weight = 0.2
- 2024-2025: weight = 2.0

### Class Weights (Reduces Draw Bias)

- **Win**: 1.2
- **Draw**: 0.6 (significantly reduced)
- **Loss**: 1.2

### Hyperparameters

- `n_estimators`: 400 (trees in forest)
- `max_depth`: 20 (tree depth)
- `min_samples_split`: 8
- `min_samples_leaf`: 4
- `random_state`: 42 (for reproducibility)

---

## Expected Training Time

Per league (approximate):

- Small leagues (MLS, World Cup): 30 seconds - 1 minute
- Medium leagues (Ligue 1, Serie A): 1-2 minutes
- Large leagues (Premier League, La Liga): 2-4 minutes

**Total for all 9 leagues: ~15-25 minutes**

---

## Verifying Success

### Check for Warnings

After retraining, test a prediction:

```bash
curl -X POST http://localhost:8000/api/predict/head-to-head \
  -H "Content-Type: application/json" \
  -d '{"league":"premier_league","home_team":"Arsenal","away_team":"Chelsea"}'
```

**Before retraining:** You'll see sklearn version warnings
**After retraining:** No warnings, clean output

### Check Visualizations

1. Go to http://localhost:3000/analytics
2. Select a league (e.g., "Premier League")
3. Scroll down to "Model Performance Metrics"
4. You should see:
   - Confusion Matrix
   - Feature Importance
   - Prediction Distribution
   - Classification Reports

### Check Draw Bias

Make some predictions. You should see:

- **Before:** ~42-44% draw probability for every match
- **After:** Varied probabilities (strong teams should have higher win %, not draw %)

---

## Troubleshooting

### "No module named sklearn"

Make sure you're using the virtual environment:

```bash
cd /home/roaltshu/code/soccer_predictor
source .venv/bin/activate  # or .venv/Scripts/activate on Windows
cd scripts
python train_league_models.py
```

### "File not found" errors

Ensure processed data exists:

```bash
ls ../fbref_data/processed/
```

You should see files like `premier_league_processed.csv`

### Training crashes or hangs

- Check available RAM (training uses ~2-4GB)
- Try training one league at a time instead of `all`
- Reduce `n_estimators` in the script if needed

### Predictions still show draw bias

1. Verify new models were saved (check timestamp):
   ```bash
   ls -lh ../fbref_data/premier_league/model.pkl
   ```
2. Restart the dev server completely
3. Clear browser cache and retry

---

## Files Modified

This guide assumes the following files have been updated:

1. **`scripts/train_league_models.py`**

   - Exponential season weighting
   - Custom class weights
   - Enhanced visualizations
   - Sklearn version check

2. **`src/components/MLMetricsVisualizations.tsx`**

   - Updated to display new visualizations
   - Professional gradient design
   - Better descriptions

3. **`backend/main.py`**
   - Fixed syntax error in head-to-head endpoint

---

## After Retraining

Your soccer predictor will have:

- ✅ No sklearn version warnings
- ✅ Reduced draw prediction bias
- ✅ More accurate predictions based on recent seasons
- ✅ Professional analytics visualizations
- ✅ Better model interpretability

---

**Last Updated:** November 3, 2025
