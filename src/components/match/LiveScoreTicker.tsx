'use client';

import React from 'react';

interface LiveScoreTickerProps {
  matches: Array<{
    id: number;
    home: { name: string; shortName?: string };
    away: { name: string; shortName?: string };
    result?: { home: number; away: number };
    status: { liveTime?: { short?: string } };
  }>;
}

export default function LiveScoreTicker({ matches }: LiveScoreTickerProps) {
  if (!matches || matches.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden" style={{ background: 'var(--ticker-bg)' }}>
      <div className="relative flex items-center h-10">
        {/* Live indicator */}
        <div className="flex items-center gap-2 px-4 bg-[var(--accent-loss)] h-full shrink-0">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-sm font-semibold">LIVE</span>
        </div>
        
        {/* Scrolling matches */}
        <div className="flex-1 overflow-hidden">
          <div className="flex animate-scroll gap-8 px-4">
            {matches.map((match) => (
              <div 
                key={match.id} 
                className="flex items-center gap-2 text-white text-sm whitespace-nowrap shrink-0"
              >
                <span className="font-medium">{match.home.shortName || match.home.name}</span>
                <span className="bg-white/10 px-2 py-0.5 rounded font-bold">
                  {match.result?.home ?? 0} - {match.result?.away ?? 0}
                </span>
                <span className="font-medium">{match.away.shortName || match.away.name}</span>
                <span className="text-[var(--accent-primary)] text-xs">
                  {match.status.liveTime?.short || ''}
                </span>
              </div>
            ))}
            {/* Duplicate for seamless loop */}
            {matches.map((match) => (
              <div 
                key={`${match.id}-dup`} 
                className="flex items-center gap-2 text-white text-sm whitespace-nowrap shrink-0"
              >
                <span className="font-medium">{match.home.shortName || match.home.name}</span>
                <span className="bg-white/10 px-2 py-0.5 rounded font-bold">
                  {match.result?.home ?? 0} - {match.result?.away ?? 0}
                </span>
                <span className="font-medium">{match.away.shortName || match.away.name}</span>
                <span className="text-[var(--accent-primary)] text-xs">
                  {match.status.liveTime?.short || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll {
          animation: scroll 30s linear infinite;
        }
        .animate-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
