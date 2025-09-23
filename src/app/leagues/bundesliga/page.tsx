'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function BundesligaPage() {
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
          src="/logo/bundesliga-logo-2AA0A3yP_brandlogos.net.svg"
          alt="Bundesliga Logo"
          width={30}
          height={30} // Adjust height as needed for aspect ratio
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>Bundesliga</h1>
      </div>

      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        The Bundesliga is a professional association football league in Germany. At the top of the German football league system, it is the country's primary football competition. The Bundesliga is contested by 18 teams and operates on a system of promotion and relegation with the 2. Bundesliga. Seasons run from August to May, with most games played on Saturdays and Sundays. Known for its high-scoring matches, passionate fan culture, and emphasis on youth development, the Bundesliga is one of the most popular football leagues worldwide, boasting the highest average stadium attendance globally. For more information, visit the <a href="https://www.bundesliga.com/en/bundesliga" target="_blank" rel="noopener noreferrer" className="league-link">official Bundesliga website</a>.
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