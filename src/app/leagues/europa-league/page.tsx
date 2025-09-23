'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function EuropaLeaguePage() {
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
          src="/logo/Europa_League_2021.svg"
          alt="Europa League Logo"
          width={30}
          height={29} // Adjusted height for aspect ratio
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>Europa League</h1>
      </div>

      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        The UEFA Europa League is an annual football club competition organised by UEFA for eligible European football clubs. It is the second-tier competition of European club football, ranking below the UEFA Champions League. Introduced in 1971 as the UEFA Cup, it underwent a format change and rebranding in 2009. The competition is known for its intense knockout stages and provides a pathway to the UEFA Champions League for its winner, adding significant stakes to its matches. For more information, visit the <a href="https://www.uefa.com/uefaeuropaleague/" target="_blank" rel="noopener noreferrer" className="league-link">official Europa League website</a>.
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