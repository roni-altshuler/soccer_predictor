'use client';

import { useEffect, useState } from 'react';
import { fetchAllSeasons, fetchRankedSeasonStats } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { SeasonStats } from '@/lib/data';
import Image from 'next/image';

export default function PremierLeaguePage() {
  const [seasons, setSeasons] = useState<string[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string>('---');
  const [seasonStats, setSeasonStats] = useState<SeasonStats[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    const loadSeasons = async () => {
      const allSeasons = await fetchAllSeasons();
      setSeasons(allSeasons);
    };
    loadSeasons();
  }, []);

  useEffect(() => {
    const loadSeasonStats = async () => {
      if (selectedSeason && selectedSeason !== '---') {
        const stats = await fetchRankedSeasonStats(selectedSeason);
        setSeasonStats(stats);
      } else {
        setSeasonStats(null);
      }
    };
    loadSeasonStats();
  }, [selectedSeason]);

  const handleSeasonChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const season = e.target.value;
    setSelectedSeason(season);
  };

  return (
    <div style={{ padding: '2rem', color: '#F5F5DC' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 1rem', backgroundColor: '#F5F5DC', borderRadius: '0.5rem', width: 'fit-content' }}>
        <Image
          src="/logo/Premier_League_Symbol.svg"
          alt="Premier League Logo"
          width={30}
          height={38}
          style={{ marginRight: '0.5rem' }}
        />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#121212' }}>Premier League</h1>
      </div>
      <p style={{ marginBottom: '2rem', lineHeight: '1.6' }}>
        The Premier League is the top level of the English football league system. Contested by 20 clubs, it operates on a system of promotion and relegation with the English Football League (EFL). Seasons run from August to May, with each team playing 38 matches (playing all 19 other teams both home and away). Most games are played on Saturday and Sunday afternoons. The competition was founded as the FA Premier League on 20 February 1992 following the decision of clubs in the Football League First Division to break away from the Football League, founded in 1888, and take advantage of a lucrative new television rights deal. For more information, visit the <a href="https://www.premierleague.com/" target="_blank" rel="noopener noreferrer" className="league-link">official Premier League website</a>.
      </p>

      <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Explore Seasons</h2>
      {seasons.length > 0 ? (
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
      ) : (
        <p>Loading seasons...</p>
      )}

      {selectedSeason !== '---' && seasonStats && seasonStats.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{selectedSeason} Final Standings</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#444' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>#</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>Squad</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>W</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>D</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>L</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>GF</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>GA</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>GD</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #555' }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {seasonStats.map((stat, index) => (
                <tr key={stat.Squad} style={{ backgroundColor: index % 2 === 0 ? '#333' : '#222' }}>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{index + 1}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.Squad}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.W}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.D}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.L}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.GF}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.GA}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.GD}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #444' }}>{stat.Pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}