'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function MLSPage() {
  const [seasons, setSeasons] = useState<string[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string>('---');
  const [seasonStats, setSeasonStats] = useState<SeasonStats[] | null>(null);
  const router = useRouter();

  // For other leagues, seasons data is not yet available
  useEffect(() => {
    setSeasons([]); // Empty seasons for now
  }, []);

  const handleSeasonChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const season = e.target.value;
    setSelectedSeason(season);
    // No navigation for now as data is not available
  };

  return (
    <div style={{ padding: '2rem', color: '#F5F5DC' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 1rem', backgroundColor: '#F5F5DC', borderRadius: '0.5rem', width: 'fit-content' }}>
        <Image
          src="/logo/MLS-Ol4GESBPl_brandlogos.net.svg"
          alt="MLS Logo"
          width={30}
          height={32} // Adjusted height for aspect ratio
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>MLS</h1>
      </div>

      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        Major League Soccer (MLS) is a professional men&apos;s soccer league sanctioned by U.S. Soccer, which represents the sport&apos;s highest tier in the United States and Canada. Founded in 1993, MLS began play in 1996. The league comprises 29 teams, 26 in the U.S. and 3 in Canada, and operates on a single-entity structure. Unlike most football leagues worldwide, MLS does not use a system of promotion and relegation. Known for its growing popularity, diverse fan base, and increasing quality of play, MLS continues to expand its footprint in the global football landscape. For more information, visit the <a href="https://www.mlssoccer.com/" target="_blank" rel="noopener noreferrer" className="league-link">official MLS website</a>.
      </p>

      <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Explore Seasons</h2>
        <select
          value={selectedSeason}
          onChange={handleSeasonChange}
          style={{
            padding: '0.5rem',
            borderRadius: '0.25rem',
            backgroundColor: '#333',
            color: '#F5F5DC',
            border: '1px solid #555',
            fontSize: '1rem',
            marginBottom: '2rem',
          }}
        >
          <option value="---">---</option>
          {seasons.map(season => (
            <option key={season} value={season}>
              {season}
            </option>
          ))}
        </select>
    </div>
  );
}