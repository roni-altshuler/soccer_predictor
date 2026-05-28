'use client'

import { useState } from 'react'

interface AccordionItemProps {
  title: string; children: React.ReactNode; isOpen: boolean; onToggle: () => void; icon?: string
}

const AccordionItem = ({ title, children, isOpen, onToggle, icon }: AccordionItemProps) => (
  <div className="border-b border-[var(--border-color)] last:border-b-0">
    <button className="w-full py-3 text-left flex justify-between items-center focus:outline-none hover:bg-[var(--card-hover)] transition-colors px-4" onClick={onToggle}>
      <span className="flex items-center gap-2">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
      </span>
      <svg className={`w-4 h-4 text-[var(--accent-primary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    {isOpen && <div className="pb-3 px-4 text-[var(--text-secondary)] text-xs leading-relaxed">{children}</div>}
  </div>
)

export default function AboutPage() {
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))
  const toggleSection = (i: number) => setOpenSections(prev => prev.has(i) ? new Set() : new Set([i]))

  const sections = [
    {
      title: "What is Pitchwise?", icon: "⚽",
      content: `<p>Pitchwise is a live soccer tracking platform enhanced with <strong class="text-[var(--text-primary)]">AI/ML match predictions</strong> — combining the real-time scores and league coverage of apps like FotMob with a <strong class="text-[var(--text-primary)]">66-feature neural ensemble (v5.1)</strong> prediction engine. It covers <strong class="text-[var(--text-primary)]">11 leagues and competitions</strong> including the Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, MLS, Champions League, Europa League, and Conference League.</p><p class="mt-2">The unique value: FotMob tracks matches but doesn't predict them. Betting sites predict but aren't designed for fans. Pitchwise bridges both — live tracking + AI predictions in one place.</p>`
    },
    {
      title: "Neural Ensemble Architecture (v5.1)", icon: "🧠",
      content: `<p>Each league has its own trained 7-model ensemble:</p>
        <ul class="list-disc pl-5 space-y-1 mt-2">
          <li><strong class="text-[var(--text-primary)]">MLP Outcome (35%):</strong> 128→64→32 neurons, ReLU, Adam optimizer</li>
          <li><strong class="text-[var(--text-primary)]">MLP Goals:</strong> 64→32→16 neurons for expected goals regression</li>
          <li><strong class="text-[var(--text-primary)]">XGBoost (25%):</strong> 200 estimators, max depth 6</li>
          <li><strong class="text-[var(--text-primary)]">LightGBM (20%):</strong> 200 estimators, 31 leaves</li>
          <li><strong class="text-[var(--text-primary)]">GradientBoosting (10%):</strong> 150 estimators, max depth 5</li>
          <li><strong class="text-[var(--text-primary)]">RandomForest (10%):</strong> 200 trees, max depth 12</li>
        </ul>
        <p class="mt-2">Final blend: <strong class="text-[var(--text-primary)]">65% Neural Ensemble + 35% ELO-Poisson Baseline</strong>. Each model ingests a <strong class="text-[var(--text-primary)]">66-dimensional feature vector</strong> including ELO, form momentum, attack/defense strength, H2H, venue, referee, market-implied probabilities, tactical stats, and league characteristics.</p>`
    },
    {
      title: "66-Feature Pipeline", icon: "📊",
      content: `<p>The feature pipeline extracts 66 features per match:</p>
        <ul class="list-disc pl-5 space-y-1 mt-2">
          <li>ELO ratings (home, away, difference, normalized)</li>
          <li>Attack &amp; defense strength indices per team</li>
          <li>Form momentum (last 5 matches: W/D/L streaks, goals scored/conceded)</li>
          <li>Head-to-head historical record</li>
          <li>Home advantage factors (venue, crowd)</li>
          <li>League characteristics (draw rate, competitiveness, avg goals)</li>
          <li>Market-implied probabilities (when available)</li>
          <li>Tactical statistics (shots, xG proxies, possession indicators)</li>
          <li>Cross-league strength coefficients</li>
        </ul>`
    },
    {
      title: "Dixon-Coles Poisson Model", icon: "📐",
      content: `<p>Baseline scoreline predictions use Dixon-Coles — a bivariate Poisson with correlation correction for low-scoring matches (0-0, 0-1, 1-0, 1-1). Per-league calibrated parameters:</p>
        <ul class="list-disc pl-5 space-y-1 mt-2">
          <li><strong class="text-[var(--text-primary)]">λ (avg goals):</strong> 1.28–1.55 per team per match</li>
          <li><strong class="text-[var(--text-primary)]">Home advantage:</strong> xG multiplier 0.20–0.30</li>
          <li><strong class="text-[var(--text-primary)]">Draw rate:</strong> 0.20–0.27 base probability</li>
          <li><strong class="text-[var(--text-primary)]">ρ (correlation):</strong> −0.10 to −0.14</li>
        </ul>`
    },
    {
      title: "ELO Rating System", icon: "📈",
      content: `<ul class="list-disc pl-5 space-y-1">
          <li>15 league coefficients scaled 0.75–1.25</li>
          <li>Goal-difference multiplier for rating changes</li>
          <li>Upset bonus amplification</li>
          <li>Form momentum ±7.5% xG adjustment</li>
          <li>Gaussian draw model: <code class="text-[10px] bg-[var(--muted-bg)] px-1 rounded">draw = base × (0.6 + 0.8 × exp(−diff²/(2×250²)))</code></li>
        </ul>`
    },
    {
      title: "Training & Automated Pipeline", icon: "🔄",
      content: `<ul class="list-disc pl-5 space-y-1">
          <li>Multi-season data from 2003+ (ESPN)</li>
          <li>Season weighting: current 1.0×, −1yr 0.85×, −2yr 0.72×, −3yr 0.61×</li>
          <li>Online learning via <code class="text-[10px] bg-[var(--muted-bg)] px-1 rounded">partial_fit()</code></li>
          <li>GitHub Actions pipeline runs 3× daily (6AM/2PM/10PM UTC)</li>
          <li>Pipeline: fetch outcomes → predict upcoming → train feedback</li>
          <li>Adapts draw rate, home advantage, goals scale each cycle</li>
        </ul>`
    },
    {
      title: "Technology Stack", icon: "🛠️",
      content: `<ul class="list-disc pl-5 space-y-1">
          <li><strong class="text-[var(--text-primary)]">Frontend:</strong> Next.js 15, TypeScript, Tailwind CSS, PWA</li>
          <li><strong class="text-[var(--text-primary)]">Backend:</strong> Python 3.12, FastAPI</li>
          <li><strong class="text-[var(--text-primary)]">ML:</strong> scikit-learn, XGBoost, LightGBM</li>
          <li><strong class="text-[var(--text-primary)]">Data:</strong> ESPN API, FotMob (referee data)</li>
          <li><strong class="text-[var(--text-primary)]">Infra:</strong> Vercel hosting, GitHub Actions CI/CD</li>
        </ul>`
    },
    {
      title: "Disclaimer", icon: "⚠️",
      content: `<p>This tool is for <strong class="text-[var(--text-primary)]">educational and entertainment purposes only</strong>. Predictions cannot account for injuries, weather, tactical changes, or red cards. Do not use predictions for betting or financial decisions.</p>`
    },
  ]

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-[var(--text-primary)]">About Pitchwise</h1>
          <p className="text-xs text-[var(--text-tertiary)]">AI/ML models, architecture, and methodology</p>
        </div>

        {/* Stat chips */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { val: '66', label: 'Features' },
            { val: '7', label: 'Models' },
            { val: '11', label: 'Leagues' },
            { val: '3x', label: 'Daily' },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-2.5 text-center">
              <p className="text-lg font-bold text-[var(--accent-ai)]">{s.val}</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Accordion */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] overflow-hidden">
          {sections.map((section, index) => (
            <AccordionItem key={index} title={section.title} icon={section.icon} isOpen={openSections.has(index)} onToggle={() => toggleSection(index)}>
              <div dangerouslySetInnerHTML={{ __html: section.content }} />
            </AccordionItem>
          ))}
        </div>
      </div>
    </div>
  )
}
