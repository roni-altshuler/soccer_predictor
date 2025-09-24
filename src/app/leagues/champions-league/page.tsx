'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function ChampionsLeaguePage() {
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
          src="/logo/UEFA_Champions_League_logo_no_text_great.svg"
          alt="Champions League Logo"
          width={30}
          height={30} // Adjust height as needed for aspect ratio
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>Champions League</h1>
      </div>

      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        The UEFA Champions League is an annual club football competition organized by the Union of European Football Associations (UEFA) and contested by top-division European clubs. It is one of the most prestigious football tournaments in the world, and the most prestigious club competition in European football, played by the national league champions (and, for some nations, one or more runners-up) of their respective national associations. Introduced in 1955 as the European Champion Clubs&apos; Cup, it was initially a straight knockout tournament open only to the champions of Europe&apos;s domestic leagues. The competition adopted its current name and format in 1992, incorporating a round-robin group stage and allowing multiple entrants from certain countries. For more information, visit the <a href="https://www.uefa.com/uefachampionsleague/" target="_blank" rel="noopener noreferrer" className="league-link">official UEFA Champions League website</a>.
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