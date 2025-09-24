'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function FIFAWorldCupPage() {
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
          src="/logo/trophy-prize-achievement-svgrepo-com.svg"
          alt="FIFA World Cup Logo"
          width={30}
          height={30} // Adjust height as needed for aspect ratio
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>FIFA World Cup</h1>
      </div>

      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        The FIFA World Cup, often simply called the World Cup, is an international association football competition contested by the senior men&apos;s national teams of the members of the Fédération Internationale de Football Association (FIFA), the sport&apos;s global governing body. The championship has been awarded every four years since the inaugural tournament in 1930, except in 1942 and 1946 when it was not held because of the Second World War. The current format involves a qualification phase, which takes place over the preceding three years, to determine which teams join the host nation in the tournament phase. The tournament phase, held every four years, is contested by 32 teams over about a month within a host nation or nations. For more information, visit the <a href="https://www.fifa.com/tournaments/mens/worldcup" target="_blank" rel="noopener noreferrer" className="league-link">official FIFA World Cup website</a>.
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