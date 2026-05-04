# ⚽ FotPredict AI

**Live scores, league tracking, and AI-powered match predictions — all in one app.**

FotPredict AI combines the real-time match experience of apps like FotMob with a custom-built machine learning prediction engine. It's designed for football fans who want both live data and data-driven insights in a single interface.

> **This is a personal/educational project. There is no license attached — all rights reserved. Not intended for commercial use, redistribution, or betting.**

---

## What It Does

- **Live Scores & Match Tracking** — Real-time scores, today's matches grouped by league, and a date-swipe navigation (like FotMob)
- **AI Match Predictions** — Neural-first unified prediction endpoint using 66 match features, calibrated league parameters, and ELO-Poisson fallback
- **League Standings & Fixtures** — ESPN-sourced standings, recent results, upcoming fixtures, and top scorers for all supported leagues
- **Season Simulator** — Monte Carlo simulation (1,000 iterations) on live standings to project title, top-4, Europa, and relegation probabilities
- **AI Accuracy Dashboard** — Full prediction history with per-league accuracy, Brier scores, rolling trend, confidence calibration, and model status
- **Personal Team Tracking** — Team watchlists with live-match monitoring, tracked prediction queues, and home-feed filtering for followed clubs
- **News Feed** — Aggregated soccer news from ESPN
- **World Cup 2026 Hub** — FIFA World Cup countdown, readiness panel, tournament page, fixtures, and `fifa.world` prediction support
- **Progressive Web App** — Installable on desktop/mobile with offline support

---

## The AI/ML Prediction Engine

This is what differentiates FotPredict from standard live-score apps. The prediction layer now serves through `/api/predict/unified`, which tries the neural ensemble first and falls back to the calibrated ELO-Poisson model only when a neural artifact is unavailable.

### Model Architecture (v5.1.x)

Most trained competitions have a **per-league neural ensemble** containing 7 models. The training script also supports a cross-league `global` challenger model so the project can move toward one shared model trained across domestic leagues, UEFA competitions, MLS, and World Cup history.

| Model | Architecture | Notes |
|-------|-------------|-------|
| **MLP Classifier** | 256→128→64 (ReLU, Adam, early stopping) | Primary outcome predictor |
| **MLP Regressor** | 128→64→32 | Goal prediction (home/away xG) |
| **XGBoost** | 500 estimators, depth 4, lr=0.03 | Gradient-boosted trees |
| **LightGBM** | 500 estimators, 31 leaves, lr=0.03 | Fast gradient boosting |
| **GradientBoosting** | 500 estimators, depth 4, lr=0.03 | Sklearn gradient boosting |
| **RandomForest** | 400 trees, depth 12 | Bagging diversity |
| **ExtraTrees** | 400 trees, depth 12 | Low-correlation ensemble member |
| **AdaBoost** | 300 estimators, depth-4 stumps | Boosted weak learners |

Predictions are combined via a **stacking meta-learner** (logistic regression trained on calibration set) with **isotonic regression calibration** and **temperature scaling**.

### 66-Feature Vector

Features are organized into 13 groups:

| Group | Count | Features |
|-------|-------|----------|
| ELO ratings | 3 | Home/away ELO, ELO difference |
| Form | 12 | 5-game and 10-game form, weighted form, goals scored/conceded averages |
| Home/away splits | 4 | Home win %, away win %, home/away goals per game |
| Head-to-head | 3 | H2H home advantage, avg total goals, match count |
| Context | 6 | Matchday %, derby flag, league coefficient, rest days |
| Season stats | 6 | Points per game, clean sheet %, goal difference per game |
| Momentum | 4 | Win/loss streaks, unbeaten runs |
| Market-implied | 5 | Implied probabilities (H/D/A), over 2.5, market overround |
| Tactical stats | 8 | Shots ratio, shots-on-target ratio, discipline, corner dominance |
| League characteristics | 4 | Draw rate, avg goals, home win rate, competitiveness |
| Poisson xG | 2 | Dixon-Coles corrected expected goals |
| Key interactions | 5 | ELO×form, ELO×H2H, implied×form, rest×form |
| Goal consistency | 2 | Scoring variance (lower = more predictable) |
| Strength of schedule | 2 | Average opponent ELO in recent matches |

### Dixon-Coles Corrected Poisson Baseline

The neural ensemble is blended with a classical statistical model:

- Per-league Poisson models with Dixon-Coles low-score correction (ρ parameter)
- Each league has calibrated parameters in `league_params.json` (draw rate, home advantage, avg goals, ρ)
- Adaptive blending: 60–70% neural ensemble, 30–40% ELO-Poisson depending on confidence entropy

### ELO Rating System

- Dynamic ratings updated after every match with goal-difference multiplier
- 12 competition coefficients (0.75–1.25) to normalize cross-league strength
- Gaussian closeness draw model: `draw = base_rate × (0.6 + 0.8 × exp(−diff²/(2×250²)))`

### Current Model Status

The May 3, 2026 audit is saved in [`docs/PROJECT_AUDIT_2026-05-03.md`](docs/PROJECT_AUDIT_2026-05-03.md). Key findings:

- The unified API is neural-first for trained leagues and returns the model used with each prediction.
- League parameter clamps now prevent impossible values such as negative average goals.
- Scheduled predictions now store their 66-feature vectors, allowing online neural `partial_fit()` to learn from future settled matches without fabricating proxy features.
- A cross-league global model can be trained with `--global-model`; when the artifact exists, `train_feedback.py` also updates it from the latest settled feature-vector predictions across competitions.

### Automated Pipeline

The GitHub Actions pipeline (`.github/workflows/prediction_pipeline.yml`) runs 3× daily:

| Time (UTC) | Step 1 | Step 2 | Step 3 |
|------------|--------|--------|--------|
| 06:00, 14:00, 22:00 | `fetch_outcomes` — resolve pending predictions against ESPN results | `predict_upcoming` — generate predictions for next 7 days | `train_feedback` — online learning via `partial_fit()` + parameter tuning |

Results are auto-committed back to the repository. New production predictions should be stored before kickoff and resolved only from real results; missing model, weather, venue, referee, or H2H data should be omitted from the UI instead of replaced with fake placeholder values.

---

## Supported Competitions (12)

| League | ID | Country |
|--------|----|---------|
| Premier League | `eng.1` | England |
| La Liga | `esp.1` | Spain |
| Serie A | `ita.1` | Italy |
| Bundesliga | `ger.1` | Germany |
| Ligue 1 | `fra.1` | France |
| Eredivisie | `ned.1` | Netherlands |
| Primeira Liga | `por.1` | Portugal |
| MLS | `usa.1` | USA |
| UEFA Champions League | `uefa.champions` | Europe |
| UEFA Europa League | `uefa.europa` | Europe |
| UEFA Conference League | `uefa.europa.conf` | Europe |
| FIFA World Cup 2026 | `fifa.world` | International |

### World Cup Readiness

The site includes a World Cup countdown, model-readiness panel, and dedicated `fifa.world` tournament hub. FIFA lists the 2026 World Cup opening match on **June 11, 2026** and the final on **July 19, 2026** ([FIFA schedule announcement](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fifa-world-cup-26-match-schedule-revealed)). Because international tournaments have smaller samples than domestic leagues, World Cup predictions should be validated with both the World Cup artifact and the cross-league global model before the tournament begins.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| **Backend** | FastAPI (Python), ESPN API for live data |
| **ML** | scikit-learn (MLP, GBT, RF, ET, AdaBoost), XGBoost, LightGBM |
| **Statistics** | SciPy (Poisson, optimization), NumPy |
| **CI/CD** | GitHub Actions (3× daily prediction pipeline) |
| **PWA** | Service worker, offline caching, installable |
| **Design** | FotMob-inspired dark theme, mobile bottom-tab navigation |

---

## Project Structure

```
soccer_predictor/
├── backend/
│   ├── main.py                     # FastAPI entry point
│   ├── config.py                   # League IDs, settings
│   ├── api/v1/                     # REST API routes (tracking, matches, predictions, leagues)
│   ├── services/
│   │   ├── espn/client.py          # ESPN API client
│   │   ├── prediction/
│   │   │   ├── training.py         # FeatureBuilder (66 features) + ModelTrainer
│   │   │   ├── neural_model.py     # PerLeagueNeuralModel (7-model ensemble v5.1)
│   │   │   ├── probabilistic.py    # Dixon-Coles Poisson + HybridModel
│   │   │   ├── model.py            # Prediction pipeline orchestrator
│   │   │   ├── tracker.py          # PredictionTracker + OutcomeFetcher
│   │   │   └── outcome_fetcher.py  # ESPN result resolution
│   │   ├── ratings/elo.py          # ELO system (12 competition coefficients)
│   │   └── simulation/             # Monte Carlo league simulation
│   ├── scripts/
│   │   ├── train_models.py         # Full training pipeline (multi-season, 2003+)
│   │   ├── predict_upcoming.py     # Generate predictions for next N days
│   │   ├── fetch_outcomes.py       # Resolve pending predictions
│   │   └── train_feedback.py       # Online learning + parameter adjustment
│   └── data/
│       ├── league_params.json      # Per-league model parameters
│       ├── predictions/            # JSON prediction storage (monthly files)
│       └── models/                 # Per-league trained model artifacts (.pkl + metadata)
├── src/
│   ├── app/
│   │   ├── page.tsx                # Home — today's matches, date navigation
│   │   ├── matches/page.tsx        # League selection + fixtures/standings
│   │   ├── predict/page.tsx        # AI match predictor + season simulator
│   │   ├── tracking/page.tsx       # AI accuracy dashboard
│   │   ├── news/page.tsx           # News feed
│   │   ├── about/page.tsx          # Model documentation
│   │   ├── simulator/page.tsx      # Monte Carlo season simulator
│   │   ├── leagues/[leagueId]/     # League home pages
│   │   ├── matches/[id]/           # Match detail pages
│   │   └── api/                    # 24 API routes
│   ├── components/
│   │   ├── Navbar.tsx              # Desktop top nav + mobile bottom tabs
│   │   ├── Footer.tsx              # Site footer
│   │   ├── league/                 # League home, standings, fixtures
│   │   ├── knockout/               # Tournament bracket visualization
│   │   ├── prediction/             # Season simulator component
│   │   └── tracking/               # Accuracy dashboard components
│   └── data/leagues.ts             # League metadata + flag URLs
├── public/                         # Static assets, PWA manifest, icons
├── .github/workflows/
│   └── prediction_pipeline.yml     # 3× daily automated pipeline
├── requirements.txt                # Python dependencies
├── package.json                    # Node dependencies
└── next.config.js                  # Next.js configuration
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm

### Setup

```bash
# Clone and install
git clone <repo-url>
cd soccer_predictor

# Python dependencies
pip install -r requirements.txt

# Node dependencies
npm install
```

### Train Models

```bash
# Train per-league neural ensemble on historical data (back to 2003)
python -m backend.scripts.train_models --min-season 2003

# Train per-league models plus a cross-league global challenger
python -m backend.scripts.train_models --min-season 2003 --global-model

# Train specific leagues only
python -m backend.scripts.train_models --leagues eng.1 esp.1

# Recompute diagnostics and calibration tuning from settled prediction history
python -m backend.scripts.model_audit --apply
```

### Generate Predictions

```bash
# Predict upcoming matches (next 7 days)
python -m backend.scripts.predict_upcoming --days 7

# Resolve completed predictions against ESPN results
python -m backend.scripts.fetch_outcomes

# Online learning: update models from outcomes
python -m backend.scripts.train_feedback
```

### Run Locally

```bash
# Development
npm run dev
# → http://localhost:3000

# Production build
npm run build && npm start
```

---

## API Endpoints

### Predictions
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/predict/unified` | Neural-first prediction with calibrated ELO-Poisson fallback |
| POST | `/api/predict/any-teams` | Predict any matchup |
| POST | `/api/predict/head-to-head` | H2H prediction with history |
| POST | `/api/predict/cross-league` | Cross-league prediction |

### Live Data
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/live_scores` | Live match scores |
| GET | `/api/todays_matches` | Today's matches (supports `?date=` param) |
| GET | `/api/standings?league=X` | League standings |
| GET | `/api/upcoming_matches/[league]` | Upcoming fixtures |
| GET | `/api/recent_results/[league]` | Recent results |
| GET | `/api/top-scorers/[league]` | Top scorers |
| GET | `/api/world-cup/readiness` | World Cup model, calibration, diagnostics, and data-integrity status |

### AI Tracking
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/tracking/accuracy/summary` | Dashboard data |
| GET | `/api/v1/tracking/accuracy/trend` | Rolling accuracy trend |
| GET | `/api/v1/tracking/predictions` | Paginated prediction history |
| GET | `/api/v1/tracking/model-info` | Per-league model status |
| POST | `/api/v1/tracking/fetch-outcomes` | Trigger ESPN result resolution |

### Simulation
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/simulation/[leagueId]` | Monte Carlo season simulation |

---

## Design

The frontend is inspired by [FotMob](https://www.fotmob.com) — dark theme, matches-first layout, and mobile bottom-tab navigation. The key design difference is the **AI prediction layer** (highlighted with a purple accent) that surfaces model predictions alongside live match data.

- **Dark theme** — `#0d1117` background, `#161b22` cards
- **Green accent** — `#00c853` for primary actions and live indicators
- **AI purple accent** — `#7c3aed` for prediction-related UI (the differentiator)
- **Mobile-first** — Bottom tab navigation, swipeable date selector
- **Score-centric** — Match rows show teams and scores in a clean, scannable format

### Match Card Data Rules

- Match rows show only provider-backed fields: team names, score, kickoff time/status, league, venue, and real model outputs.
- Venue, referee, weather, H2H, and prediction modules are hidden when source data is unavailable.
- The app must not display random weather, invented referee details, synthetic H2H records, or zero-probability placeholders as if they were real.
- Prediction cards label model outputs clearly and preserve the model version/source when provided.

---

## Disclaimer

This project is for **educational and entertainment purposes only**. Predictions are based on statistical models and historical data. Football outcomes are inherently unpredictable. **Do not use for betting.**

Match data is sourced from ESPN and FotMob public endpoints where available. This project is not affiliated with ESPN, FotMob, FIFA, or any football organization.

---

## No License

This project does **not** include an open-source license. All rights are reserved by the author. You may not copy, distribute, or create derivative works without explicit permission.

---

## Acknowledgments

- [ESPN](https://www.espn.com) — Live scores, standings, fixtures, and news data
- [FotMob](https://www.fotmob.com) — Design inspiration
- [scikit-learn](https://scikit-learn.org) — MLP, GBT, RF, ExtraTrees, AdaBoost
- [XGBoost](https://xgboost.readthedocs.io) — Gradient boosting
- [LightGBM](https://lightgbm.readthedocs.io) — Fast gradient boosting
- [Next.js](https://nextjs.org) — React framework
- [SciPy](https://scipy.org) — Statistical computing
