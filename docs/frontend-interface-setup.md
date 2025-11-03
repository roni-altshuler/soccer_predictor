# ⚽ Soccer Stats Predictor – Frontend Interface Setup

## 🧭 Project Goal
Build a professional, interactive web interface for the **Soccer Stats Predictor** using **Next.js 14 (App Router)** and **Tailwind CSS**.  
The website will connect to the backend prediction API (Flask or FastAPI) and allow users to generate **Head-to-Head** and **Cross-League** predictions.

---

## 🏗️ Tech Stack Overview

| Layer | Technology | Purpose |
|-------|-------------|----------|
| Frontend | **Next.js 14 + TypeScript** | UI, routing, and rendering |
| Styling | **Tailwind CSS** | Responsive dark theme |
| Charts | **Recharts** or **Chart.js** | Probability visualization |
| Backend | **FastAPI** or **Flask** | Handles prediction requests |
| ML Engine | **scikit-learn (RandomForest)** | Core model for predictions |
| State Management | **Zustand** or **Context API** | Manage selected league, model, and team state |

---

## 🎨 Global Design & Layout

- **Dark theme** throughout (background: `#0D1117`, text: `#E0E0E0`, accent: `#00C853`).
- **Sticky Navbar** with dropdowns for league/model selection.
- **Footer** with data source credits and disclaimer.
- **Subtle soccer field–themed background** integrated for aesthetic depth.
- **Responsive layout** for desktop, tablet, and mobile.
- Smooth animations and transitions for loading, page changes, and hover effects.

---

## 🧭 Pages Overview

| Page | Path | Description |
|------|------|--------------|
| Home | `/` | Introduction, overview, disclaimers |
| Prediction Hub | `/predict` | Main interface for generating match predictions |
| Analytics | `/analytics` | Displays historical data charts and model analysis |
| About | `/about` | Explains model behavior, accuracy, and limitations |

---

## ⚙️ Navbar Components

- **Logo:** “⚽ Soccer Stats Predictor” (clickable, routes to `/`)
- **Dropdowns:**
  - **Leagues:** Premier League, LaLiga, Bundesliga, Serie A, etc.
  - **Models (Future):** RandomForest (default), XGBoost, NeuralNet (coming soon)
- **Links:** Predict | Analytics | About
- Hover glow and separator lines for clean modern UI.

---

## 🎯 Step 3: Prediction Hub (`/predict`)

The core of user interaction.  
Contains **two modes:**  
1. 🏠 Head-to-Head  
2. 🌍 Cross-League  

### 🏠 Head-to-Head Mode

**Layout:**  
A left-to-right arrangement:

[ League Dropdown ]
Team 1 (Home): [ user input + dropdown suggestions ] vs Team 2 (Away): [ user input + dropdown suggestions ]
[ Predict Button ]
[ Result Display Section ]

markdown
Copy code

- **League Selection:**  
  - Dropdown list of available leagues (populated from database).  
  - Selecting a league automatically populates team lists for that league.

- **Team Selection:**  
  - Users can **type** the team name (case-insensitive).
  - A **dropdown suggestion menu** appears as they type, showing valid team names.
  - Layout clearly labels:
    - **Left (Team 1)** → Home Team  
    - **Right (Team 2)** → Away Team

- **Prediction Trigger:**  
  - “Predict” button sends a `POST` request to:  
    ```
    /api/predict/head-to-head
    ```
    Example JSON:
    ```json
    {
      "league": "premier_league",
      "home_team": "Manchester City",
      "away_team": "Liverpool"
    }
    ```

- **Loading State:**  
  - Display a **spinning soccer ball icon** centered beneath the button while awaiting response.

- **Response Display:**  
  - Replace loader with a clear text and visual report:
    ```
    🏆 Most Likely Outcome: Manchester City WINS (45.2%)
    ⚖️ Draw Probability: 28.5%
    ❌ Liverpool Wins: 26.3%
    ```
  - Visualize with horizontal probability bars (Recharts or Chart.js).  
  - Emphasize the winning team (bold text or green highlight).  
  - Include note:  
    > ⚠️ Predictions are for educational and entertainment purposes only.

---

### 🌍 Cross-League Mode

**Layout:**  
Similar left-to-right structure for visual consistency:

League A: [ dropdown ] → Team A: [ user input + suggestions ]
vs
League B: [ dropdown ] → Team B: [ user input + suggestions ]
[ Predict Button ]
[ Result Display Section ]

- Predict button sends a `POST` request to:
/api/predict/cross-league

Example JSON:
```json
{
  "league_a": "premier_league",
  "team_a": "Manchester City",
  "league_b": "la_liga",
  "team_b": "Real Madrid"
}
Loading State:

Display the same spinning soccer ball loader centered beneath the button.

Response Display:

⚽ Matchup: Manchester City (Premier League) vs Real Madrid (LaLiga)
🏆 Predicted Winner: Manchester City (47.8%)
⚖️ Draw Probability: 31.2%
❌ Real Madrid Wins: 21.0%
Side-by-side probability bars for clarity.

Smooth fade-in animation when results appear.

🧠 Prediction Output Handling — In-Memory (Stateless Approach)

To ensure scalability and prevent disk overload when multiple users generate predictions, all prediction results (JSON + visualizations) are handled in-memory rather than being saved to disk.

Instead of writing PNG and JSON files to the project folder, the backend:

Runs the prediction model in real time.

Generates any visualization (e.g., probability bars) directly in memory using io.BytesIO().

Encodes the image as a Base64 string and includes it in the JSON response.

This method allows the frontend to instantly render both the prediction data and its chart without creating or storing physical files.

Example Response:

{
  "predictions": {
    "home_win": 0.45,
    "draw": 0.28,
    "away_win": 0.27
  },
  "chart_image": "data:image/png;base64,<encoded-image-string>"
}


Advantages:

⚡ No file I/O — fast and stateless

🧹 No storage buildup or cleanup required

🔒 Secure — no cross-user data exposure

🌐 Ideal for public-facing or API-based web apps

This design mirrors how large-scale APIs (e.g., OpenAI, Hugging Face) serve model results — lightweight, ephemeral, and secure.

📊 Analytics Page (/analytics)
Displays historical and analytical visualizations (pre-generated or dynamic):

League competitiveness charts

Home vs away advantage

Win-rate over time

Model feature importance visualization

ℹ️ About Page (/about)
Overview of RandomForest model

Expected accuracy and performance

Ethical disclaimers (not for betting)

Data source (FBRef) with TOS acknowledgment

Accordion or collapsible layout for readability

🔌 Backend Integration
Frontend communicates with backend endpoints:

Mode	Endpoint	Description
Head-to-Head	/api/predict/head-to-head	Predicts outcome between two teams in same league
Cross-League	/api/predict/cross-league	Predicts outcome between teams from different leagues

Example API Response:
json

{
  "home_team": "Manchester City",
  "away_team": "Liverpool",
  "win_prob_home": 0.452,
  "draw_prob": 0.285,
  "win_prob_away": 0.263,
  "most_likely": "Manchester City"
}
🧠 Future-Proofing
Add Model Selection Dropdown (RandomForest, XGBoost, NeuralNet).

Pass "model": "randomforest" in API payload for extensibility.

Keep placeholder models in UI marked as “(coming soon)”.

✨ UX Notes
Use animated transitions for:

Loading → Result view

Tab switching

Dropdown expansions

Maintain clear labeling for “Home” and “Away” teams.

Ensure mobile-friendly layout: stacked vertically but preserve left-right clarity.

Keep predictions section centered and visually prominent.

⚠️ Disclaimers
This tool is for educational and entertainment purposes only.

Soccer outcomes are inherently unpredictable.

The developer disclaims any responsibility for financial or betting outcomes.

⚙️ Unified Server Startup

To simplify development, the project uses a single command to start both the frontend (Next.js) and backend (API) servers simultaneously.

How It Works

We use concurrently
, a lightweight Node.js process manager that allows multiple npm scripts to run in parallel.
This ensures a smooth developer experience without needing to start each server manually.

package.json Configuration:

"scripts": {
  "start-api": "python backend/main.py",
  "dev": "concurrently \"npm run start-api\" \"next dev\"",
  "build": "next build",
  "start": "next start"
}


Run the full stack:

npm run dev


This starts both:

🧠 start-api — the Python backend (Flask/FastAPI)

🌐 next dev — the Next.js frontend

All logs appear in a single terminal window, making development faster and easier.

Why This Approach

✅ Single command — less manual setup

⚡ Faster development workflow

🔁 Auto restarts on file changes

💼 Mirrors professional workflows used in modern web stacks