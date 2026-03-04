'use client'

import { useState } from 'react'

interface AccordionItemProps {
  title: string
  children: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  icon?: string
}

const AccordionItem = ({ title, children, isOpen, onToggle, icon }: AccordionItemProps) => {
  return (
    <div className="border-b border-[var(--border-color)] last:border-b-0">
      <button
        className="w-full py-4 text-left flex justify-between items-center focus:outline-none hover:bg-[var(--card-hover)] transition-colors rounded-lg px-4"
        onClick={onToggle}
      >
        <span className="flex items-center gap-3">
          {icon && <span className="text-xl">{icon}</span>}
          <span className="text-base font-medium text-[var(--text-primary)]">{title}</span>
        </span>
        <svg 
          className={`w-5 h-5 text-[var(--accent-primary)] transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="py-4 px-4 text-[var(--text-secondary)] text-sm leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}

export default function AboutPage() {
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))

  const toggleSection = (index: number) => {
    setOpenSections(prev => {
      if (prev.has(index)) return new Set()
      return new Set([index])
    })
  }

  const sections = [
    {
      title: "What is Soccer Stats Predictor?",
      icon: "⚽",
      content: `Soccer Stats Predictor is an AI/ML-powered platform that predicts soccer match outcomes using a 
      <strong class="text-[var(--text-primary)]">per-league neural network ensemble</strong> combined with Dixon-Coles corrected Poisson models 
      and ELO ratings. The system covers <strong class="text-[var(--text-primary)]">12 leagues and competitions</strong> — including the Premier League, 
      La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, MLS, Champions League, Europa League, Conference League, 
      and the FIFA World Cup — providing win/draw/loss probabilities, predicted scorelines, and goals market predictions. 
      It features live ESPN scores, standings with Monte Carlo simulation, head-to-head analysis, a "Road to the Final" 
      knockout bracket, and an AI accuracy dashboard tracking 1,100+ predictions.`
    },
    {
      title: "Key Features",
      icon: "✨",
      content: `
        <ul class="list-disc pl-6 space-y-2">
          <li><strong class="text-[var(--text-primary)]">Neural Network Ensemble:</strong> Per-league MLP (128→64→32) + XGBoost + LightGBM + GradientBoosting + RandomForest blended at trained weights</li>
          <li><strong class="text-[var(--text-primary)]">Match Outcome Predictions:</strong> Win/draw/loss probabilities with confidence scores for any matchup</li>
          <li><strong class="text-[var(--text-primary)]">Predicted Scorelines:</strong> Dixon-Coles corrected Poisson score matrix with top 5 likely scorelines</li>
          <li><strong class="text-[var(--text-primary)]">Live Scores &amp; Standings:</strong> Real-time ESPN data for all 12 leagues with Monte Carlo season simulation</li>
          <li><strong class="text-[var(--text-primary)]">AI Accuracy Dashboard:</strong> 1,100+ predictions tracked with per-league breakdown, Brier scores, rolling accuracy trend, and paginated history</li>
          <li><strong class="text-[var(--text-primary)]">Road to the Final Bracket:</strong> Two-sided knockout bracket (left converges right, trophy center, right side mirrored) for all tournaments</li>
          <li><strong class="text-[var(--text-primary)]">Head-to-Head &amp; Cross-League:</strong> Historical H2H data from ESPN + cross-league team comparisons</li>
          <li><strong class="text-[var(--text-primary)]">12 Leagues:</strong> Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, MLS, UCL, UEL, UECL, FIFA World Cup</li>
          <li><strong class="text-[var(--text-primary)]">Progressive Web App:</strong> Installable on desktop &amp; mobile with offline support</li>
        </ul>
      `
    },
    {
      title: "Neural Network Architecture",
      icon: "🧠",
      content: `Each of the 12 leagues has its own trained neural network ensemble. The architecture consists of:
        <ul class="list-disc pl-6 space-y-2 mt-2">
          <li><strong class="text-[var(--text-primary)]">Outcome Classifier (MLP):</strong> 3-layer neural network (128→64→32 neurons) predicting Home Win / Draw / Away Win with ReLU activation, Adam optimizer, and early stopping</li>
          <li><strong class="text-[var(--text-primary)]">Goals Regressor (MLP):</strong> 3-layer neural network (64→32→16 neurons) predicting expected home and away goals</li>
          <li><strong class="text-[var(--text-primary)]">XGBoost:</strong> Gradient-boosted trees (200 estimators, max depth 6) — weight: 25%</li>
          <li><strong class="text-[var(--text-primary)]">LightGBM:</strong> Fast gradient boosting (200 estimators, 31 leaves) — weight: 20%</li>
          <li><strong class="text-[var(--text-primary)]">GradientBoosting:</strong> Sklearn boosted trees (150 estimators, max depth 5) — weight: 10%</li>
          <li><strong class="text-[var(--text-primary)]">RandomForest:</strong> 200 decision trees (max depth 12) — weight: 10%</li>
          <li><strong class="text-[var(--text-primary)]">Neural Network (MLP):</strong> Primary model — weight: 35%</li>
        </ul>
        <p class="mt-3">The ensemble output is further blended: <strong class="text-[var(--text-primary)]">65% Neural Ensemble + 35% ELO-Poisson Baseline</strong> for the final prediction. 
        Each model is trained on a 38-dimensional feature vector including ELO ratings, form momentum, home advantage, head-to-head record, venue factors, referee adjustments, and league context.</p>
      `
    },
    {
      title: "Dixon-Coles Corrected Poisson Model",
      icon: "📐",
      content: `The baseline prediction engine uses the Dixon-Coles model — a bivariate Poisson distribution with a correlation 
      correction for low-scoring outcomes (0-0, 0-1, 1-0, 1-1). Each league has its own calibrated parameters:
        <ul class="list-disc pl-6 space-y-1 mt-2">
          <li><strong class="text-[var(--text-primary)]">Average Goals (λ):</strong> League-specific scoring rate (1.28–1.55 per team per match)</li>
          <li><strong class="text-[var(--text-primary)]">Home Advantage:</strong> xG multiplier per league (0.20–0.30)</li>
          <li><strong class="text-[var(--text-primary)]">Draw Rate:</strong> League-specific base draw probability (0.20–0.27)</li>
          <li><strong class="text-[var(--text-primary)]">Dixon-Coles ρ:</strong> Score correlation parameter (−0.10 to −0.14)</li>
        </ul>
        <p class="mt-2">Parameters are stored in a single <code>league_params.json</code> file and dynamically loaded by all prediction routes, ensuring consistency across the entire system.</p>
      `
    },
    {
      title: "ELO Rating System",
      icon: "📊",
      content: `Every team maintains a dynamic ELO rating updated after each match. The system uses:
        <ul class="list-disc pl-6 space-y-1 mt-2">
          <li><strong class="text-[var(--text-primary)]">15 League Coefficients:</strong> Scaled 0.75–1.25 to normalize strength across leagues</li>
          <li><strong class="text-[var(--text-primary)]">Goal-Difference Multiplier:</strong> Larger margins amplify rating changes</li>
          <li><strong class="text-[var(--text-primary)]">Upset Bonus:</strong> ELO adjustments are amplified when underdogs win</li>
          <li><strong class="text-[var(--text-primary)]">Form Momentum:</strong> ±7.5% xG adjustment from recent 5-game form streaks</li>
          <li><strong class="text-[var(--text-primary)]">Gaussian Draw Model:</strong> <code>draw = base_rate × (0.6 + 0.8 × exp(−diff²/(2×250²)))</code></li>
        </ul>
        <p class="mt-2">ELO ratings feed into both the Poisson baseline and the neural network feature vector.</p>
      `
    },
    {
      title: "Training & Online Learning",
      icon: "🎓",
      content: `Models are trained on multi-season historical data with emphasis on recent performance:
        <ul class="list-disc pl-6 space-y-2 mt-2">
          <li><strong class="text-[var(--text-primary)]">Multi-Season Data:</strong> Uses all available historical match data from ESPN (2020+)</li>
          <li><strong class="text-[var(--text-primary)]">Season Weighting:</strong> Current season: 1.0×, −1yr: 0.85×, −2yr: 0.72×, −3yr: 0.61×, older: 0.52×</li>
          <li><strong class="text-[var(--text-primary)]">38-Feature Vector:</strong> ELO, attack/defense strength, form, H2H, venue, referee, league context</li>
          <li><strong class="text-[var(--text-primary)]">Online Learning:</strong> Neural networks support <code>partial_fit()</code> for incremental updates from new match outcomes without full retraining</li>
          <li><strong class="text-[var(--text-primary)]">Automated Pipeline:</strong> GitHub Actions runs 3× daily (6AM/2PM/10PM UTC) — fetch outcomes → predict upcoming → train feedback loop</li>
          <li><strong class="text-[var(--text-primary)]">Parameter Adaptation:</strong> Each feedback cycle adjusts league-specific draw rate, home advantage, and goals scale based on prediction errors</li>
        </ul>
      `
    },
    {
      title: "AI Accuracy Dashboard",
      icon: "📈",
      content: `The tracking page provides full transparency into model performance:
        <ul class="list-disc pl-6 space-y-2 mt-2">
          <li><strong class="text-[var(--text-primary)]">1,100+ Predictions Tracked:</strong> Every prediction is stored and compared to actual outcomes</li>
          <li><strong class="text-[var(--text-primary)]">Per-League Breakdown:</strong> Accuracy, Brier score, and scoreline rate for each of the 12 leagues</li>
          <li><strong class="text-[var(--text-primary)]">Prediction History:</strong> Paginated, filterable table of all past predictions with league, time range, and status filters</li>
          <li><strong class="text-[var(--text-primary)]">Rolling Accuracy Trend:</strong> Visual chart showing accuracy over time with configurable window (10/20/50)</li>
          <li><strong class="text-[var(--text-primary)]">Confidence Calibration:</strong> High/medium/low confidence bucket analysis</li>
          <li><strong class="text-[var(--text-primary)]">Model Status Cards:</strong> Per-league model type (Neural Ensemble vs ELO+Poisson), training date, sample count</li>
          <li><strong class="text-[var(--text-primary)]">One-Click Outcome Fetch:</strong> Manually trigger ESPN result resolution for pending predictions</li>
        </ul>
      `
    },
    {
      title: "Data Sources",
      icon: "📚",
      content: `Match data is sourced from <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer" class="text-[var(--accent-primary)] hover:underline font-medium">ESPN</a> — 
      the primary data source providing live scores, standings, top scorers, team statistics, news, and scheduled fixtures across all 12 leagues. 
      Additionally, <a href="https://www.fotmob.com" target="_blank" rel="noopener noreferrer" class="text-[var(--accent-primary)] hover:underline font-medium">FotMob</a> 
      provides match details and referee data for enriching predictions. Data is updated continuously via automated pipelines and 5-minute API caching.`
    },
    {
      title: "How to Use",
      icon: "📖",
      content: `
        <ul class="list-disc pl-6 space-y-2">
          <li><strong class="text-[var(--text-primary)]">Leagues:</strong> Browse any of 12 leagues for standings, fixtures, top scorers, results, and Monte Carlo season simulation</li>
          <li><strong class="text-[var(--text-primary)]">Predict:</strong> Select two teams for head-to-head predictions within a league, or use cross-league mode to compare teams from different leagues</li>
          <li><strong class="text-[var(--text-primary)]">Upcoming Matches:</strong> Browse scheduled fixtures with automatic AI predictions — toggle between week and day view</li>
          <li><strong class="text-[var(--text-primary)]">Tournaments:</strong> View group stages, "Road to the Final" knockout brackets, top scorers, and fixtures for UCL, UEL, UECL, and World Cup</li>
          <li><strong class="text-[var(--text-primary)]">AI Accuracy:</strong> Visit the Tracking page to see model performance, browse all historical predictions, and filter by league or time range</li>
          <li><strong class="text-[var(--text-primary)]">Live Scores:</strong> Check real-time match scores and events across all leagues</li>
        </ul>
      `
    },
    {
      title: "Technology Stack",
      icon: "🛠️",
      content: `
        <ul class="list-disc pl-6 space-y-2">
          <li><strong class="text-[var(--text-primary)]">Frontend:</strong> Next.js 15 (App Router), TypeScript, Tailwind CSS, Progressive Web App</li>
          <li><strong class="text-[var(--text-primary)]">Backend:</strong> Python 3.13, FastAPI, scikit-learn, XGBoost, LightGBM</li>
          <li><strong class="text-[var(--text-primary)]">ML Models:</strong> MLPClassifier/MLPRegressor (neural network), XGBClassifier, LGBMClassifier, GradientBoostingClassifier, RandomForestClassifier</li>
          <li><strong class="text-[var(--text-primary)]">Statistical Models:</strong> Dixon-Coles corrected bivariate Poisson, ELO ratings, Gaussian draw model</li>
          <li><strong class="text-[var(--text-primary)]">Data Sources:</strong> ESPN API (scores, standings, scorers), FotMob (referee data)</li>
          <li><strong class="text-[var(--text-primary)]">Infrastructure:</strong> Vercel (hosting), GitHub Actions (3× daily automated pipeline), JSON file storage</li>
        </ul>
      `
    },
    {
      title: "Limitations & Responsible Use",
      icon: "⚠️",
      content: `While our models provide data-driven insights, soccer matches are inherently unpredictable. The predictions cannot 
      account for real-time factors such as:
        <ul class="list-disc pl-6 space-y-1 mt-2">
          <li>Player injuries, suspensions, or last-minute lineup changes</li>
          <li>Weather conditions at kickoff</li>
          <li>Team morale, motivation, and tactical changes</li>
          <li>Referee decisions or red cards during the match</li>
          <li>Transfer window activity and squad depth</li>
        </ul>
        <p class="mt-3 font-semibold text-[var(--text-primary)]">This tool is for educational and entertainment purposes only. Do not use predictions for betting or financial decisions.</p>
      `
    },
    {
      title: "Legal Disclaimer",
      icon: "⚖️",
      content: `This tool is provided for educational and entertainment purposes only. The predictions are based on historical 
      data and statistical/machine learning models, and should not be interpreted as guarantees of future results. The developers accept no 
      responsibility for any losses incurred from using these predictions for gambling or betting purposes. Always gamble 
      responsibly and be aware of your local gambling laws and regulations. If you or someone you know has a gambling problem, 
      please seek help from organizations like the National Council on Problem Gambling (1-800-522-4700).`
    }
  ]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-[var(--card-bg)] border-b border-[var(--border-color)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">About</h1>
          <p className="text-[var(--text-secondary)]">
            Learn about the AI/ML models, neural network architecture, and data behind the predictions
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="fm-card overflow-hidden">
          {sections.map((section, index) => (
            <AccordionItem
              key={index}
              title={section.title}
              icon={section.icon}
              isOpen={openSections.has(index)}
              onToggle={() => toggleSection(index)}
            >
              <div dangerouslySetInnerHTML={{ __html: section.content }} />
            </AccordionItem>
          ))}
        </div>
      </div>
    </div>
  )
}
