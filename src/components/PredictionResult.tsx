'use client'

interface PredictionResultProps {
  result: {
    predictions: {
      home_win?: number
      draw?: number
      away_win?: number
      team_a_win?: number
      team_b_win?: number
    }
    predicted_home_goals?: number
    predicted_away_goals?: number
    predicted_team_a_goals?: number
    predicted_team_b_goals?: number
    home_team?: string
    away_team?: string
    team_a?: string
    team_b?: string
    league_a?: string
    league_b?: string
  }
  mode: 'head-to-head' | 'cross-league'
}

export const PredictionResult = ({ result, mode }: PredictionResultProps) => {
  // Defensive null checks
  if (!result || !result.predictions) {
    return (
      <div className="text-center p-8 text-[var(--text-secondary)]">
        <p>Unable to load prediction data</p>
      </div>
    );
  }

  const { 
    predictions, 
    home_team, 
    away_team, 
    team_a, 
    team_b, 
    league_a, 
    league_b,
    predicted_home_goals,
    predicted_away_goals,
    predicted_team_a_goals,
    predicted_team_b_goals
  } = result;

  // Check if prediction values are actually present
  const hasValidPredictions = mode === 'head-to-head' 
    ? (predictions.home_win !== undefined || predictions.draw !== undefined || predictions.away_win !== undefined)
    : (predictions.team_a_win !== undefined || predictions.draw !== undefined || predictions.team_b_win !== undefined);

  if (!hasValidPredictions) {
    return (
      <div className="text-center p-8 text-[var(--text-secondary)]">
        <p>Prediction data is not available for this match</p>
      </div>
    );
  }

  const winProb = mode === 'head-to-head' ? (predictions?.home_win ?? 0) : (predictions?.team_a_win ?? 0);
  const drawProb = predictions?.draw ?? 0;
  const lossProb = mode === 'head-to-head' ? (predictions?.away_win ?? 0) : (predictions?.team_b_win ?? 0);

  const homeTeamName = mode === 'head-to-head' ? (home_team || 'Home Team') : (team_a || 'Team A');
  const awayTeamName = mode === 'head-to-head' ? (away_team || 'Away Team') : (team_b || 'Team B');
  
  const homeGoals = mode === 'head-to-head' ? predicted_home_goals : predicted_team_a_goals;
  const awayGoals = mode === 'head-to-head' ? predicted_away_goals : predicted_team_b_goals;

  const getOutcome = () => {
    if (winProb > drawProb && winProb > lossProb) {
      return { outcome: homeTeamName, probability: winProb, color: 'from-[var(--accent-primary)] to-[color-mix(in_srgb,var(--accent-primary)_80%,black)]' };
    } else if (lossProb > winProb && lossProb > drawProb) {
      return { outcome: awayTeamName, probability: lossProb, color: 'from-[var(--accent-loss)] to-[color-mix(in_srgb,var(--accent-loss)_80%,black)]' };
    } else {
      return { outcome: 'Draw', probability: drawProb, color: 'from-[var(--accent-warn)] to-[color-mix(in_srgb,var(--accent-warn)_80%,black)]' };
    }
  };

  const mostLikelyOutcome = getOutcome();

  return (
    <div className="relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[color-mix(in_srgb,var(--accent-primary)_8%,var(--background))] via-[color-mix(in_srgb,var(--accent-info)_8%,var(--background))] to-[var(--background)] opacity-50"></div>
      
      <div className="relative z-10 p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-4xl md:text-5xl font-extrabold mb-3 bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
            {homeTeamName} <span className="text-[var(--text-tertiary)]">vs</span> {awayTeamName}
          </h2>
          {mode === 'cross-league' && (
            <div className="flex justify-center gap-4 text-sm text-[var(--text-secondary)] font-medium">
              <span className="px-3 py-1 bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] rounded-full border border-[color-mix(in_srgb,var(--accent-primary)_35%,transparent)]">{league_a?.replace('_', ' ').toUpperCase()}</span>
              <span className="px-3 py-1 bg-[color-mix(in_srgb,var(--accent-info)_15%,transparent)] rounded-full border border-[color-mix(in_srgb,var(--accent-info)_35%,transparent)]">{league_b?.replace('_', ' ').toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* Most Likely Outcome Card */}
        <div className="mb-10 text-center">
          <p className="text-sm uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-4">Most Likely Outcome</p>
          <div className={`inline-block px-8 py-6 rounded-2xl bg-gradient-to-br ${mostLikelyOutcome.color} shadow-2xl transform hover:scale-105 transition-transform duration-300`}>
            <p className="text-5xl md:text-6xl font-black text-white mb-2 drop-shadow-lg">
              {mostLikelyOutcome.outcome}
            </p>
            <p className="text-xl font-semibold text-white/90">
              {(mostLikelyOutcome.probability * 100).toFixed(1)}% Confidence
            </p>
          </div>
        </div>

        {/* Scoreline Prediction */}
        {homeGoals !== undefined && awayGoals !== undefined && (
          <div className="mb-10 text-center animate-fade-in">
            <p className="text-sm uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-4">Predicted Scoreline</p>
            <div className="inline-flex items-center gap-6 px-8 py-6 bg-gradient-to-r from-[var(--card-bg)] via-[var(--muted-bg)] to-[var(--card-bg)] rounded-2xl shadow-xl border-2 border-[var(--border-color)]">
              <div className="text-center">
                <p className="text-sm text-[var(--text-secondary)] mb-1">{homeTeamName}</p>
                <p className="text-6xl font-black text-[var(--accent-primary)]">{typeof homeGoals === 'number' ? homeGoals.toFixed(1) : homeGoals}</p>
              </div>
              <span className="text-4xl font-bold text-[var(--text-tertiary)]">-</span>
              <div className="text-center">
                <p className="text-sm text-[var(--text-secondary)] mb-1">{awayTeamName}</p>
                <p className="text-6xl font-black text-[var(--accent-primary)]">{typeof awayGoals === 'number' ? awayGoals.toFixed(1) : awayGoals}</p>
              </div>
            </div>
          </div>
        )}

        {/* Probability Breakdown */}
        <div className="space-y-4 mb-8">
          {/* Home/Team A Win */}
          <div className="group">
            <div className="flex justify-between items-center mb-2">
              <span className="text-lg font-semibold text-[var(--text-primary)]">{homeTeamName} Win</span>
              <span className="text-2xl font-bold text-[var(--accent-primary)]">{(winProb * 100).toFixed(1)}%</span>
            </div>
            <div className="h-4 bg-[var(--muted-bg)] rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-soft)] rounded-full shadow-lg transition-all duration-1000 ease-out group-hover:shadow-[color:color-mix(in_srgb,var(--accent-primary)_50%,transparent)]"
                style={{ width: `${winProb * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Draw */}
          <div className="group">
            <div className="flex justify-between items-center mb-2">
              <span className="text-lg font-semibold text-[var(--text-primary)]">Draw</span>
              <span className="text-2xl font-bold text-[var(--accent-warn)]">{(drawProb * 100).toFixed(1)}%</span>
            </div>
            <div className="h-4 bg-[var(--muted-bg)] rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-[var(--accent-warn)] to-[var(--accent-warn-soft)] rounded-full shadow-lg transition-all duration-1000 ease-out group-hover:shadow-[color:color-mix(in_srgb,var(--accent-warn)_50%,transparent)]"
                style={{ width: `${drawProb * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Away/Team B Win */}
          <div className="group">
            <div className="flex justify-between items-center mb-2">
              <span className="text-lg font-semibold text-[var(--text-primary)]">{awayTeamName} Win</span>
              <span className="text-2xl font-bold text-[var(--accent-loss)]">{(lossProb * 100).toFixed(1)}%</span>
            </div>
            <div className="h-4 bg-[var(--muted-bg)] rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-[var(--accent-loss)] to-[var(--accent-loss-soft)] rounded-full shadow-lg transition-all duration-1000 ease-out group-hover:shadow-[color:color-mix(in_srgb,var(--accent-loss)_50%,transparent)]"
                style={{ width: `${lossProb * 100}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-[var(--border-color)] text-center">
          <p className="text-sm text-[var(--text-secondary)] flex items-center justify-center gap-2">
            <span className="text-[var(--accent-warn)]">⚠️</span>
            Predictions are for educational and entertainment purposes only
          </p>
        </div>
      </div>
    </div>
  )
}