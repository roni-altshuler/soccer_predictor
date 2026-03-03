# ⚽ Soccer Predictor v4.0

A modern soccer match prediction and live scores application powered by ESPN data. Features real-time match updates, per-league AI/ML predictions with Dixon-Coles corrected Poisson models, comprehensive league standings, an AI accuracy dashboard, and league standings simulation.

**📱 Now Available as a Progressive Web App (PWA)** — Install on Chrome for the best experience!

---

## ✨ Key Features

### 🤖 Per-League AI/ML Prediction Engine
- **Per-League Models:** Each league has its own calibrated model with league-specific parameters (draw rate, home advantage, average goals, Dixon-Coles ρ)
- **Dixon-Coles Corrected Poisson:** Low-scoring outcomes (0-0, 0-1, 1-0, 1-1) adjusted via correlation parameter
- **Adaptive ML/Poisson Blending:** 50–70% ML weight based on model confidence entropy
- **Form Momentum:** ±7.5% xG adjustment from recent 5-game form streaks
- **Enhanced Features:** Weather, injury, venue, and referee factors integrated into predictions
- **Training Feedback Loop:** Automated accuracy analysis computes parameter adjustments per league
- **ELO Ratings:** Dynamic team strength with goal-difference multiplier and upset bonuses

### 📊 AI Accuracy Dashboard
- **981+ Seeded Predictions:** Historical back-test across 10 leagues (46.8% winner accuracy)
- **183 Upcoming Predictions:** Pre-match predictions for next 14 days, auto-resolved against real results
- **Per-League Breakdown:** Accuracy, Brier score, scoreline rate for each league
- **Rolling Accuracy Trend:** Visual chart of model improvement over time
- **Confidence Calibration:** High/medium/low confidence bucket analysis
- **Recent Form & Streaks:** Win/loss streak tracking
- **Outcome Fetcher:** One-click ESPN result fetching to resolve pending predictions

### 📺 Live Scores & Matches
- **Real-time Updates:** Live match scores from all major leagues
- **ESPN API Integration:** Reliable data source for scores, standings, and statistics
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
  - MLS (USA) — Eastern & Western Conference support
- **European Competitions:**
  - UEFA Champions League
  - UEFA Europa League
  - UEFA Conference League
- **International:**
  - FIFA World Cup

### 📈 Top Scorers
- **ESPN Live Data:** Real-time scorer data from ESPN leaders endpoint
- **Curated Fallback:** Season-accurate scorer data for 11 leagues when ESPN API unavailable
- **Tournament Coverage:** Champions League, Europa League, and Conference League scorers
- **Dedicated API Route:** `/api/top-scorers/[league]` with intelligent fallback chain

### 📊 Analytics & Simulation
- **League Standings:** Live table with goal difference, form, and conference splits
- **Team Form:** Recent results and performance trends from ESPN
- **League Simulation:** Monte Carlo simulation for final standings prediction
- **Title Race:** Title, Top 4, Europa, and relegation probabilities
- **Season Trends:** Goals distribution, result patterns, and league analytics

### 📱 Progressive Web App (PWA)
- **Installable:** Add to home screen on desktop and mobile
- **Offline Support:** Access previously viewed content without internet
- **Fast Performance:** Service worker caching for instant loads
- **Native Feel:** Runs in standalone window without browser chrome

---

## 🛠 Technology Stack

### Backend (Python)
- **FastAPI** — High-performance async API
- **ESPN API** — Primary data source for scores, standings, news, and statistics
- **Pydantic** — Data validation and serialization
- **httpx** — Async HTTP client with rate limiting
- **NumPy / SciPy** — Statistical modeling (Poisson, entropy)

### Frontend (TypeScript)
- **Next.js 15** — React framework with App Router
- **TypeScript** — Type-safe development
- **Tailwind CSS** — Utility-first styling
- **Progressive Web App** — Service worker with offline support

### ML/Prediction Engine
- **Dixon-Coles Corrected Poisson** — Score matrix with low-score correlation
- **Per-League HybridPredictionModel** — League-specific calibrated parameters
- **LeagueModelManager** — Singleton managing per-league model instances
- **ELO System** — 15 league coefficients, goal-difference multiplier, upset bonus
- **Gaussian Closeness Draw Model** — `draw = base_rate × (0.6 + 0.8 × exp(-diff²/(2×250²)))`
- **Monte Carlo Simulation** — 10,000-iteration match and season simulation
- **Training Feedback Loop** — Gradient-based parameter adjustment from outcomes

---

## 📁 Project Structure

```
soccer_predictor/
├── backend/
│   ├── main.py                          # FastAPI application entry point
│   ├── config.py                        # Settings, league IDs, display names
│   ├── api/v1/
│   │   ├── tracking.py                  # Prediction tracking & accuracy API
│   │   ├── matches.py                   # Match endpoints
│   │   ├── predictions.py               # Prediction endpoints
│   │   └── leagues.py                   # League endpoints
│   ├── services/
│   │   ├── espn/client.py               # ESPN API client (12 leagues)
│   │   ├── prediction/
│   │   │   ├── probabilistic.py         # Poisson + HybridModel + LeagueModelManager
│   │   │   ├── tracker.py               # PredictionTracker + OutcomeFetcher
│   │   │   └── outcome_fetcher.py       # ESPN result resolution
│   │   ├── ratings/elo.py               # ELO system (15 league coefficients)
│   │   └── simulation/                  # Monte Carlo league simulation
│   ├── scripts/
│   │   ├── seed_predictions.py          # Back-test: seed 981 historical predictions
│   │   ├── predict_upcoming.py          # Forward: predict next 14 days of matches
│   │   └── train_feedback.py            # Learn: adjust params from outcomes
│   └── data/predictions/                # JSON prediction storage (monthly files)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── top-scorers/[league]/    # Top scorers with ESPN + curated fallback
│   │   │   └── v1/tracking/             # Accuracy dashboard API proxy routes
│   │   │       ├── accuracy/summary/    # Comprehensive dashboard data
│   │   │       ├── accuracy/trend/      # Rolling accuracy trend
│   │   │       ├── predictions/         # Prediction list with filters
│   │   │       ├── fetch-outcomes/      # Trigger ESPN outcome resolution
│   │   │       └── outcome-status/      # Tracker status
│   │   ├── leagues/[leagueId]/          # League home pages (SSG)
│   │   ├── tracking/                    # Accuracy dashboard page
│   │   └── predict/                     # Prediction interface
│   ├── components/
│   │   ├── league/LeagueHomePage.tsx     # Standings, results, scorers, fixtures
│   │   ├── match/HeadToHeadDisplay.tsx  # H2H with 14-league ESPN search
│   │   └── tracking/
│   │       ├── AccuracyDashboard.tsx    # AI accuracy dashboard
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

### Seed Historical Predictions (Required for Dashboard)

```bash
# Back-test model on 90 days of historical matches (builds ELO + generates accuracy data)
python -m backend.scripts.seed_predictions

# Generate predictions for upcoming matches (next 14 days)
python -m backend.scripts.predict_upcoming --days 14

# Analyze accuracy and compute parameter adjustments
python -m backend.scripts.train_feedback
```

### Development

```bash
# Start Next.js dev server (serves both frontend and API routes)
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
┌─────────────────────┐
│  1. seed_predictions │  ← Back-test on 90 days of ESPN historical data
│     (981 matches)    │     Builds ELO ratings, measures baseline accuracy
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  2. predict_upcoming │  ← Fetch next 14 days of scheduled matches from ESPN
│     (183 matches)    │     Generate pre-match predictions (pending outcomes)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  3. fetch-outcomes   │  ← Dashboard button or automated: check ESPN for results
│     (API route)      │     Resolve pending predictions → winner_correct/scoreline_correct
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  4. train_feedback   │  ← Analyze completed predictions per league
│     (adjustments)    │     Compute draw_rate, home_adv, goals_scale adjustments
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  5. predict_upcoming │  ← Next run loads learned adjustments automatically
│     (improved)       │     Per-league parameters incrementally refined
└─────────────────────┘
```

---

## 📊 Prediction Model Architecture

### Per-League Calibrated Parameters

Each league has its own `HybridPredictionModel` instance (managed by `LeagueModelManager`) with specific calibrated parameters:

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
| Eredivisie | 1.45 | 0.24 | 0.21 | -0.11 |
| Primeira Liga | 1.28 | 0.27 | 0.25 | -0.13 |

### Prediction Pipeline

1. **ELO Ratings** → Team strength with 15 league coefficients (0.75–1.25)
2. **Attack/Defense Strength** → Opponent-adjusted, schedule-quality-normalized
3. **Form Momentum** → ±7.5% xG from last 5 games (captures streaks ELO hasn't absorbed)
4. **Injury Factor** → 85–100% effective strength based on squad availability
5. **Weather Factor** → 80–120% total xG modifier (rain/wind suppress goals)
6. **Venue Factor** → 90–110% home advantage modifier
7. **Referee Factor** → Strict refs → fewer goals (defensive adjustment)
8. **Dixon-Coles Poisson** → Score matrix with ρ correction on low scores
9. **Adaptive ML Blending** → 50–70% ML weight based on confidence entropy
10. **Gaussian Draw Model** → League-specific base rate × closeness factor

### Prediction Output
```json
{
  "outcome": {
    "home_win": 0.5615,
    "draw": 0.2544,
    "away_win": 0.1841,
    "confidence": 0.1045
  },
  "goals": {
    "home_xG": 1.84,
    "away_xG": 0.98,
    "total_xG": 2.82,
    "over_1_5": 0.787,
    "over_2_5": 0.536,
    "over_3_5": 0.314,
    "btts": 0.541
  },
  "scorelines": [
    {"score": "1-1", "probability": 0.1215},
    {"score": "2-0", "probability": 0.1004},
    {"score": "2-1", "probability": 0.0989}
  ]
}
```

---

## 📡 API Endpoints

### Tracking & Accuracy (Next.js)
- `GET /api/v1/tracking/accuracy/summary` — Dashboard data (overall, by-league, recent form)
- `GET /api/v1/tracking/accuracy/trend?window=N` — Rolling accuracy trend
- `GET /api/v1/tracking/accuracy` — Aggregate accuracy metrics
- `GET /api/v1/tracking/predictions?time_range=week|month|season` — Prediction list
- `GET /api/v1/tracking/outcome-status` — Tracker status (pending/completed counts)
- `POST /api/v1/tracking/fetch-outcomes` — Trigger ESPN result resolution

### Top Scorers (Next.js)
- `GET /api/top-scorers/[league]` — Top scorers (ESPN live + curated fallback)

### Matches (Next.js)
- `GET /api/live_scores` — Live match scores
- `GET /api/todays_matches` — Today's matches
- `GET /api/standings` — League standings
- `GET /api/recent_results/[league]` — Recent results (last 10 days, sorted newest)
- `GET /api/upcoming_matches/[league]` — Upcoming fixtures (next 14 days)
- `GET /api/team_form/[league]/[team]` — Team form data
- `GET /api/team_stats/[league]/[team]` — Team statistics

### Predictions (Next.js)
- `POST /api/predict/head-to-head` — H2H match prediction
- `POST /api/predict/cross-league` — Cross-league prediction
- `POST /api/predict/any-teams` — Any teams prediction

### Analytics (Next.js)
- `GET /api/analytics/overview/[league]` — League analytics overview
- `GET /api/analytics/goals_distribution/[league]` — Goals distribution
- `GET /api/analytics/season_trends/[league]` — Season trend data
- `GET /api/simulation/[leagueId]` — Monte Carlo league simulation

### FastAPI Backend
- `POST /api/v1/tracking/store` — Store a prediction
- `POST /api/v1/tracking/outcome` — Record match result
- `GET /api/v1/tracking/recent` — Recent predictions (with filters)
- `GET /api/v1/tracking/model-adjustments` — Suggested parameter adjustments

---

## 🔧 Configuration

### Environment Variables

```env
# Frontend (.env.local)
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id

# Backend (.env)
JWT_SECRET_KEY=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
```

---

## 🔄 Data Sources

**ESPN API** — Primary data source providing:
- Live scores and match events
- League standings (including MLS conference splits)
- Top scorers and statistics
- News articles and headlines
- Team search across 14 leagues
- Scheduled match fixtures

---

## 📝 Scripts Reference

| Script | Purpose | Command |
|--------|---------|---------|
| `seed_predictions` | Back-test on 90 days of historical ESPN data | `python -m backend.scripts.seed_predictions` |
| `predict_upcoming` | Predict next N days of scheduled matches | `python -m backend.scripts.predict_upcoming --days 14` |
| `train_feedback` | Analyze accuracy, compute parameter adjustments | `python -m backend.scripts.train_feedback` |

---

## 📝 License

MIT License — Feel free to use and modify for your projects.

---

## 🙏 Acknowledgments

- [ESPN](https://www.espn.com) — Sports data, scores, standings, and news
- [FastAPI](https://fastapi.tiangolo.com) — Modern Python API framework
- [Next.js](https://nextjs.org) — React framework with App Router
- [SciPy](https://scipy.org) — Statistical computing (Poisson distribution)
