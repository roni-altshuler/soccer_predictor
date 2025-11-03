# To do list of improvements and new features for Soccer Predictor:

## ✅ COMPLETED - Upcoming Matches Feature

### What Was Fixed:

1. **Current Season Filtering**: Updated `get_upcoming_matches()` to only display scheduled matches from the 2025-2026 season (not historical scheduled matches)
2. **Team Stats from Last 10 Seasons**: Uses completed matches from the last 10 seasons (2015-2025) for calculating team statistics
3. **Performance Optimization**: Pre-computes team stats once per request and caches them to avoid redundant calculations
4. **Date Filtering**: Shows matches from today onwards for the next 30 days
5. **API Working**: Backend successfully returns 41 upcoming Premier League matches with predictions

### Current Status:

- ✅ Upcoming matches API endpoint working (`/api/upcoming_matches/{league}`)
- ✅ Frontend fetches and displays matches correctly
- ✅ Week view calendar implemented (Saturday to Friday starting from current day)
- ✅ Day view shows individual matches when clicking a day
- ⚠️ **DRAW BIAS ISSUE**: Models are predicting 42-44% draw probability for all matches (needs retraining)

---

## ✅ COMPLETED - Head-to-Head Prediction Fix

### What Was Fixed:

1. **400 Bad Request Error**: Fixed Python syntax error where print statement was placed before the docstring in `backend/main.py`
2. **API Now Working**: Head-to-head predictions return successfully with proper JSON response
3. **Error Handling**: Proper error messages and HTTP status codes

### Current Status:

- ✅ Head-to-head prediction endpoint working
- ✅ Cross-league prediction endpoint working
- ⚠️ **Sklearn Version Warning**: Models trained with 1.6.1 but environment has 1.7.2 (requires retraining)

---

## ✅ COMPLETED - Analytics Page Visualization Updates

### What Was Updated:

1. **New Visualizations Generated**: Updated `train_league_models.py` to create:

   - Confusion Matrix (test set)
   - Feature Importance (top 15 features)
   - Prediction Probability Distribution
   - Classification Reports (train and test)

2. **Modernized Analytics UI**: Completely redesigned `MLMetricsVisualizations.tsx` with:
   - Professional gradient card design
   - Proper categorization (Performance vs Classification)
   - Better descriptions and explanations
   - Hover effects and responsive layout
   - Color-coded sections (green for training, blue for testing)

### Current Status:

- ✅ New visualization code ready
- ⚠️ **Requires Retraining**: New visualizations only appear after running `train_league_models.py`

---

## 🔧 ACTION REQUIRED - Model Retraining

### Critical Issues Requiring Retraining:

1. **Scikit-learn Version Mismatch**

   - Models trained with: sklearn 1.6.1
   - Current environment: sklearn 1.7.2
   - **Impact**: Compatibility warnings, potential prediction errors

2. **Draw Prediction Bias**
   - Current: 42-44% draw probability for every match
   - Expected: Varied probabilities based on team strengths
   - **Impact**: Poor prediction accuracy, not representative of real-world outcomes

### Solution Implemented:

**Training Data Strategy:**

- Uses **ALL historical data** (excluding current season 2025-2026)
- Applies **sample weighting** with strong emphasis on last 5 seasons:
  - **Last 5 seasons** (2020-2024): Exponential weights from 1.5x to 3.0x
  - **Older seasons**: Linear weights from 0.3x to 1.0x
  - Most recent season gets **10x more weight** than oldest season

**Model Configuration:**

1. **Custom Class Weights** to reduce draw bias:

   - Home Win: 1.2
   - Draw: 0.6 (reduced significantly)
   - Away Win: 1.2

2. **Optimized Model Parameters**:

   - `n_estimators`: 400 (increased from 300)
   - `max_depth`: 20 (increased from 15)
   - `min_samples_split`: 8 (reduced from 10)
   - `min_samples_leaf`: 4 (reduced from 5)

3. **Comprehensive Visualizations**:
   - Confusion Matrix with heatmap
   - Feature Importance bar chart (top 15)
   - Prediction Distribution histograms
   - Classification Report line plots

### How to Retrain Models:

```bash
# Step 1: Navigate to scripts directory
cd /home/roaltshu/code/soccer_predictor/scripts

# Step 2: Run training script
python train_league_models.py

# Step 3: When prompted, enter 'all' to train all leagues
# (Or enter specific league name like 'premier_league')

# Step 4: Wait for completion (20-30 minutes for all leagues)
# You'll see detailed weighting information for each league

# Step 5: Run analysis script to generate confidence threshold visualizations
python analyze_model.py
# Enter 'all' when prompted

# Step 6: Restart the server
cd ..
npm run dev
```

---

## � Current System Status

### Working Features:

- ✅ Head-to-head predictions (with sklearn warning)
- ✅ Cross-league predictions (with sklearn warning)
- ✅ Upcoming matches for current season
- ✅ Team selection dropdowns
- ✅ Analytics page structure
- ✅ Week view calendar
- ✅ Day view match lists

### Needs Attention:

- ⚠️ **Models need retraining** (sklearn version + draw bias)
- ⚠️ **New visualizations not yet generated** (requires retraining)

### After Retraining:

- 🎯 No sklearn warnings
- 🎯 Reduced draw prediction bias
- 🎯 More accurate predictions (recent seasons emphasized)
- 🎯 Professional analytics visualizations
- 🎯 Better model interpretability

---

## 📋 Remaining Future Enhancements

Models (Future Ideas):

- ❓ **Predicted scoreline feature** - Not yet implemented
  - Would require new model architecture (regression or multi-output)
  - Need to predict actual goal counts (home_goals, away_goals)
  - Updates needed to `train_league_models.py` and `analyze_model.py`
  - Frontend UI updates to display scorelines

---

## � Key Files Modified

1. **`backend/main.py`**

   - Fixed head-to-head prediction syntax error
   - Added health check endpoint

2. **`backend/prediction_service.py`**

   - Updated `get_upcoming_matches()` to filter current season
   - Uses last 10 seasons for team stats
   - Performance optimizations

3. **`scripts/train_league_models.py`**

   - Exponential season weighting
   - Custom class weights
   - Comprehensive visualizations
   - Sklearn version check

4. **`src/components/MLMetricsVisualizations.tsx`**

   - Complete redesign with modern UI
   - Updated to show new visualization types
   - Professional gradient cards

5. **`src/app/upcoming/page.tsx`**
   - Week view calendar implementation
   - Day view for individual matches
   - Current season filtering

---

## 🔍 Verification Checklist

After retraining, verify:

- [ ] No sklearn version warnings in terminal
- [ ] Head-to-head predictions show varied probabilities (not all ~44% draw)
- [ ] Analytics page shows new visualizations for selected league
- [ ] Confusion matrix appears on analytics page
- [ ] Feature importance chart displays
- [ ] Prediction distributions visible
- [ ] Classification reports render correctly
- [ ] Upcoming matches load successfully
- [ ] Week view calendar works
- [ ] Day view shows matches with predictions

---

**Last Updated:** November 3, 2025 - Post Head-to-Head Fix & Analytics Update
