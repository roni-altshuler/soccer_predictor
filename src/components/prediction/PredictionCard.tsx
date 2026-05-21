'use client';

import React from 'react';

interface PredictionCardProps {
  prediction: {
    match_id: number;
    home_team: string;
    away_team: string;
    league: string;
    kickoff_time: string;
    outcome: {
      home_win: number;
      draw: number;
      away_win: number;
      confidence: number;
    };
    goals: {
      home_expected_goals: number;
      away_expected_goals: number;
      over_2_5: number;
      btts_yes: number;
    };
    most_likely_score: {
      score: string;
      probability: number;
    };
  };
  onClick?: () => void;
}

export default function PredictionCard({ prediction, onClick }: PredictionCardProps) {
  const { outcome, goals, most_likely_score } = prediction;
  
  // Determine predicted winner
  const getPrediction = () => {
    if (outcome.home_win > outcome.draw && outcome.home_win > outcome.away_win) {
      return { winner: prediction.home_team, prob: outcome.home_win, type: 'home' };
    } else if (outcome.away_win > outcome.draw && outcome.away_win > outcome.home_win) {
      return { winner: prediction.away_team, prob: outcome.away_win, type: 'away' };
    } else {
      return { winner: 'Draw', prob: outcome.draw, type: 'draw' };
    }
  };
  
  const pred = getPrediction();
  const confidenceColor = outcome.confidence > 0.7 ? 'text-green-500' : outcome.confidence > 0.5 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div 
      className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
      onClick={onClick}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2">
        <span className="text-white text-xs font-medium">{prediction.league}</span>
      </div>
      
      {/* Teams */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex justify-between items-center">
          <span className="font-medium text-gray-900 dark:text-white">{prediction.home_team}</span>
          <span className="text-gray-400 text-sm">vs</span>
          <span className="font-medium text-gray-900 dark:text-white">{prediction.away_team}</span>
        </div>
      </div>
      
      {/* Outcome Probabilities */}
      <div className="p-4">
        <div className="flex gap-2 mb-4">
          <ProbabilityBar label="H" value={outcome.home_win} isHighest={pred.type === 'home'} />
          <ProbabilityBar label="D" value={outcome.draw} isHighest={pred.type === 'draw'} />
          <ProbabilityBar label="A" value={outcome.away_win} isHighest={pred.type === 'away'} />
        </div>
        
        {/* Prediction Summary */}
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-xs text-[var(--text-tertiary)]">Prediction</span>
              <p className="font-semibold text-gray-900 dark:text-white">
                {pred.winner} {pred.type !== 'draw' ? 'Win' : ''}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-[var(--text-tertiary)]">Score</span>
              <p className="font-semibold text-gray-900 dark:text-white">{most_likely_score.score}</p>
            </div>
          </div>
        </div>
        
        {/* Goals Stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <StatBox label="Home xG" value={goals.home_expected_goals.toFixed(1)} />
          <StatBox label="Away xG" value={goals.away_expected_goals.toFixed(1)} />
          <StatBox label="O2.5" value={`${(goals.over_2_5 * 100).toFixed(0)}%`} />
          <StatBox label="BTTS" value={`${(goals.btts_yes * 100).toFixed(0)}%`} />
        </div>
        
        {/* Confidence */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)]">Confidence</span>
          <span className={`font-semibold ${confidenceColor}`}>
            {(outcome.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function ProbabilityBar({ label, value, isHighest }: { label: string; value: number; isHighest: boolean }) {
  const percentage = (value * 100).toFixed(0);
  const bgColor = isHighest ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-600';
  const textColor = isHighest ? 'text-emerald-500' : 'text-[var(--text-tertiary)]';
  
  return (
    <div className="flex-1">
      <div className={`text-center text-xs font-medium ${textColor} mb-1`}>{label}</div>
      <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
        <div 
          className={`h-full ${bgColor} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className={`text-center text-xs font-semibold mt-1 ${textColor}`}>{percentage}%</div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2">
      <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      <div className="font-semibold text-gray-900 dark:text-white text-sm">{value}</div>
    </div>
  );
}
