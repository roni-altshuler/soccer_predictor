# ⚽ Soccer Predictor v6.0

A modern soccer match prediction and live scores application powered by ESPN data and a **per-league neural network ensemble**. Features real-time match updates, AI/ML predictions blending neural networks with Dixon-Coles corrected Poisson models, live ESPN standings with Monte Carlo simulation, head-to-head analysis, an AI accuracy dashboard with full prediction history, and a "Road to the Final" knockout bracket.

**📱 Now Available as a Progressive Web App (PWA)** — Install on Chrome for the best experience!

---

## ✨ Key Features

### 🧠 Per-League Neural Network Ensemble
- **Neural Network (MLP):** 3-layer architecture (128→64→32) trained per league — 35% ensemble weight
- **XGBoost:** Gradient-boosted trees (200 estimators, max depth 6) — 25% ensemble weight
- **LightGBM:** Fast gradient boosting (200 estimators, 31 leaves) — 20% ensemble weight
- **GradientBoosting:** Sklearn boosted trees (150 estimators, max depth 5) — 10% ensemble weight
- **RandomForest:** 200 decision trees (max depth 12) — 10% ensemble weight
- **Blending:** 65% Neural Ensemble + 35% ELO-Poisson Baseline for final predictions
- **38-Feature Vector:** ELO, attack/defense strength, form, H2H, venue, referee, league context
- **Online Learning:** `partial_fit()` for incremental updates from new match outcomes

### 📐 Dixon-Coles Corrected Poisson Baseline
- **Per-League Models:** Each league has its own calibrated model from `league_params.json` (draw rate, home advantage, average goals, Dixon-Coles ρ)
- **Score Matrix:** Bivariate Poisson with ρ correction on low-scoring outcomes (0-0, 0-1, 1-0, 1-1)
- **Adaptive Blending:** ML/Poisson weight varies by confidence entropy (50–70% range)
- **Form Momentum:** ±7.5% xG adjustment from recent 5-game form streaks
- **Enhanced Factors:** Weather, injury, venue, and referee adjustments integrated

### ⚡ ELO Rating System
- **Dynamic Ratings:** Updated after every match with goal-difference multiplier
- **15 League Coefficients:** Scaled 0.75–1.25 to normalize strength across leagues
- **Upset Bonus:** ELO adjustments amplified when underdogs win
- **Gaussian Draw Model:** `draw = base_rate × (0.6 + 0.8 × exp(−diff²/(2×250²)))`

### 📊 AI Accuracy Dashboard
- **1,100+ Predictions Tracked:** Historical predictions across all 12 leagues
- **Prediction History:** Paginated, filterable table with league, time range, and status filters
- **Per-League Breakdown:** Accuracy, Brier score, and scoreline rate per league
- **Rolling Accuracy Trend:** Visual chart with configurable window (10/20/50)
- **Confidence Calibration:** High/medium/low confidence bucket analysis
- **Model Status Cards:** Per-league neural ensemble vs ELO+Poisson status, training date, architecture
- **Recent Form & Streaks:** Win/loss streak tracking
- **Automated Pipeline:** GitHub Actions 3× daily (6AM/2PM/10PM UTC) — fetch outcomes → predict → train
- **One-Click Outcome Fetch:** Manual ESPN result resolution for pending predictions

### 📺 Live Scores & Matches
- **Real-time Updates:** Live match scores from all major leagues via ESPN
- **Today's Matches:** Complete schedule with live and upcoming games
- **Match Details:** Events, statistics, and score breakdowns

### 🎯 Match Predictions
- **Probabilistic Model:** Win/Draw/Loss probabilities with confidence scores
- **Expected Goals (xG):** Dixon-Coles corrected Poisson-based goal predictions
- **Score Predictions:** Most likely scoreline with top 5 alternatives
- **Over/Under & BTTS:** Goals market predictions (1.5, 2.5, 3.5)
- **Head-to-Head:** Historical matchup data with ESPN multi-league search
- **Cross-League Predictions:** Compare teams from different leagues

### 🏆 League Coverage (12 Leagues)
- **Major European Leagues:**
  - Premier League (England)
  - La Liga (Spain)
  - Bundesliga (Germany)
  - Serie A (Italy)
  - Ligue 1 (France)
- **Other Domestic Leagues:**
  - Eredivisie (Netherlands)
  - Primeira Liga (Portugal)
  - MLS (USA) — Eastern & Western Conference support with calendar-year season handling
- **European Competitions:**
  - UEFA Champions League
  - UEFA Europa League
  - UEFA Conference League
- **International:**
  - FIFA World Cup

### 📈 Top Scorers
- **ESPN Live Data:** Real-time scorer data from ESPN leaders endpoint
- **Curated Fallback:** Season-accurate scorer data for all leagues when ESPN API unavailable
- **Tournament Scorers:** Inline curated data for UCL, UEL, UECL
- **Dedicated API Route:** `/api/top-scorers/[league]` with intelligent fallback chain

### 🏆 Road to the Final Knockout Bracket
- **Two-Sided Layout:** Left side converges right → Trophy center → Right side mirrored
- **Responsive Design:** Full bracket on desktop, tab-based fallback on mobile
- **Two-Legged Ties:** Shows individual leg scores + aggregate total
- **Live Indicators:** Animated pulse on live matches, accent-highlighted winners
- **Tournament Configs:** Champions League, Europa League, Conference League, World Cup

### 📊 Analytics & Simulation
- **Live ESPN Standings:** All 8 domestic leagues with correct season handling (calendar-year for MLS)
- **Real Team Form:** Last 5 match results from ESPN scoreboard API
- **Head-to-Head History:** ESPN-sourced H2H match history
- **Monte Carlo Simulation:** 1,000-iteration season simulation on live standings
- **Title Race:** Title, Top 4, Europa, and relegation probabilities
- **MLS Conference Support:** Eastern & Western Conference standings with 34-match season

### 📱 Progressive Web App (PWA)
- **Installable:** Add to home screen on desktop and mobile
- **Offline Support:** Access previously viewed content without internet
- **Fast Performance:** Service worker caching for instant loads
- **Native Feel:** Runs in standalone window without browser chrome

---

## 🛠 Technology Stack

### Backend (Python)
- **FastAPI** — High-performance async API
- **scikit-learn** — MLPClassifier/MLPRegressor neural networks
- **XGBoost** — Gradient-boosted tree ensemble member
- **LightGBM** — Fast gradient boosting ensemble member
- **ESPN API** — Primary data source for scores, standings, news, statistics
- **NumPy / SciPy** — Statistical modeling (Poisson, entropy)

### Frontend (TypeScript)
- **Next.js 15** — React framework with App Router
- **TypeScript** — Type-safe development
- **Tailwind CSS** — Utility-first styling
- **Progressive Web App** — Service worker with offline support

### ML/Prediction Engine
- **Per-League Neural Ensemble** — MLP (128→64→32) + XGB + LGB + GBT + RF
- **Dixon-Coles Corrected Poisson** — Score matrix with low-score correlation
- **Per-League `league_params.json`** — Single source of truth for all 12 league parameters
- **ELO System** — 15 league coefficients, goal-difference multiplier, upset bonus
- **Gaussian Closeness Draw Model** — `draw = base_rate × (0.6 + 0.8 × exp(-diff²/(2×250²)))`
- **Monte Carlo Simulation** — 1,000-iteration season simulation on live ESPN standings
- **Online Learning** — `partial_fit()` for incremental neural network updates
- **Training Feedback Loop** — Gradient-based parameter adjustment from outcomes
- **GitHub Actions Pipeline** — 3× daily automated predict → fetch outcomes → train loop

---

## 📁 Project Structure

```
soccer_predictor/
├── backend/
│   ├── main.py                          # FastAPI application entry point
│   ├── config.py                        # Settings, league IDs, display names
│   ├── api/v1/
│   │   ├── tracking.py                  # Prediction tracking & accuracy API
│   │   ├── matches.py                   # Match endpoints with referee enrichment
│   │   ├── predictions.py               # Prediction endpoints
│   │   └── leagues.py                   # League endpoints
│   ├── services/
│   │   ├── espn/client.py               # ESPN API client (12 leagues)
│   │   ├── prediction/
│   │   │   ├── probabilistic.py         # Poisson + HybridModel (loads league_params.json)
│   │   │   ├── neural_model.py          # PerLeagueNeuralModel + LeagueModelRegistry
│   │   │   ├── model.py                 # Prediction pipeline with referee factor
│   │   │   ├── tracker.py               # PredictionTracker + OutcomeFetcher
│   │   │   └── outcome_fetcher.py       # ESPN result resolution
│   │   ├── ratings/elo.py               # ELO system (15 league coefficients)
│   │   └── simulation/                  # Monte Carlo league simulation
│   ├── scripts/
│   │   ├── train_models.py              # Full training pipeline (multi-season, weighted)
│   │   ├── seed_predictions.py          # Back-test: seed historical predictions
│   │   ├── predict_upcoming.py          # Forward: predict next 7 days (65% NN + 35% ELO)
│   │   ├── fetch_outcomes.py            # Resolve pending predictions against ESPN
│   │   └── train_feedback.py            # Online learning + league_params adjustment
│   └── data/
│       ├── league_params.json           # Single source of truth (12 leagues)
│       ├── predictions/                 # JSON prediction storage (monthly files)
│       └── models/                      # Per-league trained model files
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── standings/               # Live ESPN standings (season-aware, MLS calendar year)
│   │   │   ├── predict/any-teams/       # Per-league predictions (loads league_params.json)
│   │   │   ├── predict/head-to-head/    # H2H with ESPN history (loads league_params.json)
│   │   │   ├── tournament/[id]/         # Tournament data with inline scorers
│   │   │   ├── top-scorers/[league]/    # Top scorers with ESPN + curated fallback
│   │   │   └── v1/tracking/             # Accuracy dashboard API routes
│   │   │       ├── accuracy/summary/    # Comprehensive dashboard data
│   │   │       ├── accuracy/trend/      # Rolling accuracy trend
│   │   │       ├── predictions/         # Paginated prediction list with filters
│   │   │       ├── model-info/          # Per-league neural model status
│   │   │       ├── fetch-outcomes/      # Trigger ESPN outcome resolution
│   │   │       └── outcome-status/      # Tracker status
│   │   ├── about/                       # About page (ML architecture docs)
│   │   ├── leagues/[leagueId]/          # League home pages (SSG)
│   │   ├── tracking/                    # Accuracy dashboard page
│   │   └── predict/                     # Prediction interface
│   ├── components/
│   │   ├── league/LeagueHomePage.tsx     # Standings, results, scorers, fixtures (MLS season fix)
│   │   ├── knockout/KnockoutBracket.tsx # Road to the Final two-sided bracket
│   │   ├── tournament/TournamentHomePage.tsx # Tournament pages with "Top Scorers" tab
│   │   ├── match/HeadToHeadDisplay.tsx  # H2H with 14-league ESPN search
│   │   └── tracking/
│   │       ├── AccuracyDashboard.tsx    # AI accuracy dashboard with prediction history
│   │       └── PredictionTracker.tsx    # Prediction list & filters
│   └── types/api.ts                     # TypeScript types (12 league union)
└── public/                              # Static assets & PWA manifest
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- npm

### Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
npm install
```

### Train Neural Network Models

```bash
# Train per-league neural network ensemble on historical data
python -m backend.scripts.train_models --min-season 2020

# Optionally train specific leagues
python -m backend.scripts.train_models --leagues eng.1 esp.1 ger.1
```

### Seed Historical Predictions

```bash
# Back-test model on 90 days of historical matches
python -m backend.scripts.seed_predictions

# Generate predictions for upcoming matches (next 14 days)
python -m backend.scripts.predict_upcoming --days 14

# Analyze accuracy and compute parameter adjustments
python -m backend.scripts.train_feedback
```

### Development

```bash
# Start Next.js dev server
npm run dev
```

The app will be available at http://localhost:3000

### Production Build

```bash
npm run build
npm start
```

---

## 🔄 Prediction Workflow

The system operates as a continuous learning cycle:

```
┌──────────────────────┐
│  1. train_models      │  ← Train per-league neural ensemble on multi-season data
│     (12 leagues)      │     Season-weighted: 1.0× current → 0.52× old
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  2. predict_upcoming  │  ← Fetch next 7 days of matches from ESPN
│     (scheduled)       │     65% Neural Ensemble + 35% ELO-Poisson blend
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  3. fetch-outcomes    │  ← Dashboard button or automated: check ESPN for results
│     (API route)       │     Resolve pending → winner_correct / scoreline_correct
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  4. train_feedback    │  ← Online learning: partial_fit() on neural models
│     (adjustments)     │     Update league_params.json with refined parameters
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  5. predict_upcoming  │  ← Next run uses updated models + refined parameters
│     (improved)        │     Continuous improvement cycle
└──────────────────────┘
```

---

## 🧠 Neural Network Architecture

### Per-League Model Structure

Each of the 12 leagues has its own `PerLeagueNeuralModel` containing:

| Component | Architecture | Weight |
|-----------|-------------|--------|
| MLP Classifier | 128→64→32→3 (ReLU, Adam, early stopping) | 35% |
| MLP Regressor | 64→32→16→2 (goals prediction) | — |
| XGBoost | 200 estimators, max depth 6, lr=0.05 | 25% |
| LightGBM | 200 estimators, 31 leaves, lr=0.05 | 20% |
| GradientBoosting | 150 estimators, max depth 5, lr=0.05 | 10% |
| RandomForest | 200 trees, max depth 12 | 10% |

### 38-Dimensional Feature Vector

| Features 1–10 | Features 11–20 | Features 21–30 | Features 31–38 |
|---------------|----------------|----------------|----------------|
| Home ELO | Away ELO | ELO diff | ELO avg |
| Home form (5g) | Away form (5g) | Home goals/game | Away goals/game |
| Home conceded/game | Away conceded/game | Home win rate | Away win rate |
| H2H home wins | H2H away wins | H2H draws | H2H total |
| Home adv factor | Venue factor | Referee factor | League avg goals |
| League draw rate | Is tournament | Is knockout | Season progress |
| Days since last (home) | Days since last (away) | Home league coeff | Away league coeff |
| ELO ratio | Form diff | Attack diff | Defense diff |
| Momentum home | Momentum away | | |

### Ensemble Blending

```
Final Prediction = 0.65 × Neural_Ensemble + 0.35 × ELO_Poisson_Baseline

Where Neural_Ensemble = Σ(weight_i × model_i.predict_proba())
  model weights: NN(0.35) + XGB(0.25) + LGB(0.20) + GBT(0.10) + RF(0.10)
```

### Per-League Calibrated Parameters (league_params.json)

| League | Avg Goals | Home Adv | Draw Rate | Dixon-Coles ρ |
|--------|-----------|----------|-----------|---------------|
| Premier League | 1.42 | 0.28 | 0.23 | -0.13 |
| La Liga | 1.30 | 0.30 | 0.24 | -0.12 |
| Bundesliga | 1.55 | 0.25 | 0.22 | -0.11 |
| Serie A | 1.32 | 0.26 | 0.27 | -0.14 |
| Ligue 1 | 1.30 | 0.27 | 0.24 | -0.12 |
| MLS | 1.45 | 0.20 | 0.22 | -0.10 |
| Champions League | 1.50 | 0.22 | 0.20 | -0.12 |
| Europa League | 1.42 | 0.20 | 0.22 | -0.11 |
| Conference League | 1.38 | 0.18 | 0.23 | -0.11 |
| Eredivisie | 1.45 | 0.24 | 0.21 | -0.11 |
| Primeira Liga | 1.28 | 0.27 | 0.25 | -0.13 |
| World Cup | 1.20 | 0.15 | 0.25 | -0.12 |

---

## 📡 API Endpoints

### Tracking & Accuracy (Next.js)
- `GET /api/v1/tracking/accuracy/summary` — Dashboard data (overall, by-league, recent form)
- `GET /api/v1/tracking/accuracy/trend?window=N` — Rolling accuracy trend
- `GET /api/v1/tracking/accuracy` — Aggregate accuracy metrics
- `GET /api/v1/tracking/predictions?page=1&limit=25&league=X&status=completed&time_range=all` — Paginated prediction history
- `GET /api/v1/tracking/model-info` — Per-league neural model status and metadata
- `GET /api/v1/tracking/outcome-status` — Tracker status (pending/completed counts)
- `POST /api/v1/tracking/fetch-outcomes` — Trigger ESPN result resolution

### Top Scorers (Next.js)
- `GET /api/top-scorers/[league]` — Top scorers (ESPN live + curated fallback)

### Matches (Next.js)
- `GET /api/live_scores` — Live match scores
- `GET /api/todays_matches` — Today's matches
- `GET /api/standings?league=premier_league` — League standings (season-aware, MLS calendar year)
- `GET /api/recent_results/[league]` — Recent results (last 10 days, sorted newest)
- `GET /api/upcoming_matches/[league]` — Upcoming fixtures (next 14 days)

### Predictions (Next.js)
- `POST /api/predict/head-to-head` — H2H match prediction (loads league_params.json)
- `POST /api/predict/cross-league` — Cross-league prediction
- `POST /api/predict/any-teams` — Any teams prediction (loads league_params.json)

### Simulation & Analytics (Next.js)
- `GET /api/simulation/[leagueId]` — Monte Carlo league simulation
- `GET /api/analytics/overview/[league]` — League analytics overview

---

## 🔄 Automated Pipeline (GitHub Actions)

The prediction pipeline runs 3× daily via `.github/workflows/prediction_pipeline.yml`:

| Time (UTC) | Actions |
|------------|--------|
| 06:00 | Fetch overnight outcomes → Predict upcoming → Train feedback |
| 14:00 | Fetch morning outcomes → Predict upcoming → Train feedback |
| 22:00 | Fetch evening outcomes → Predict upcoming → Train feedback |

Each run:
1. **`fetch_outcomes`** — Resolves pending predictions against ESPN match results
2. **`predict_upcoming`** — Generates predictions for newly scheduled matches (65% NN + 35% ELO)
3. **`train_feedback`** — Online learning (`partial_fit`) + league parameter adjustment
4. **Auto-commits** updated prediction data and model parameters

---

## 📝 Scripts Reference

| Script | Purpose | Command |
|--------|---------|---------|
| `train_models` | Train per-league neural ensemble on multi-season data | `python -m backend.scripts.train_models` |
| `seed_predictions` | Back-test on 90 days of historical ESPN data | `python -m backend.scripts.seed_predictions` |
| `predict_upcoming` | Predict next N days with neural ensemble | `python -m backend.scripts.predict_upcoming --days 7` |
| `fetch_outcomes` | Resolve pending predictions against ESPN results | `python -m backend.scripts.fetch_outcomes` |
| `train_feedback` | Online learning + parameter adjustment | `python -m backend.scripts.train_feedback` |

---

## 📝 License

MIT License — Feel free to use and modify for your projects.

---

## 🙏 Acknowledgments

- [ESPN](https://www.espn.com) — Sports data, scores, standings, and news
- [FotMob](https://www.fotmob.com) — Match details and referee data
- [scikit-learn](https://scikit-learn.org) — Neural network and ML models
- [XGBoost](https://xgboost.readthedocs.io) — Gradient boosting framework
- [LightGBM](https://lightgbm.readthedocs.io) — Fast gradient boosting
- [Next.js](https://nextjs.org) — React framework with App Router
- [SciPy](https://scipy.org) — Statistical computing (Poisson distribution)
