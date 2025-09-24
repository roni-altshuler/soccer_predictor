import { fetchRankedSeasonStats, SeasonStats } from '@/app/actions';

export default async function SeasonPage({ params }: { params: { season: string } }) {
  const season = params.season.replace('-', '/');
  const rankedStats = await fetchRankedSeasonStats(season);

  return (
    <div className="content-box">
      <h1 className="text-4xl font-bold mb-4">Premier League Standings {season}</h1>
      <div className="overflow-x-auto">
        <table className="fotmob-table">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th>Team</th>
              <th className="w-16">W</th>
              <th className="w-16">D</th>
              <th className="w-16">L</th>
              <th className="w-16">GF</th>
              <th className="w-16">GA</th>
              <th className="w-16">GD</th>
              <th className="w-16">Pts</th>
            </tr>
          </thead>
          <tbody style={{ backgroundColor: '#FFFAF0', color: '#333' }}>
            {rankedStats.map((stats, index) => (
              <tr key={index}>
                <td>
                  <span className="ml-2">{index + 1}</span>
                </td>
                <td className={index === 0 ? 'font-bold' : ''}>{stats.Squad}</td>
                <td>{stats.W}</td>
                <td>{stats.D}</td>
                <td>{stats.L}</td>
                <td>{stats.GF}</td>
                <td>{stats.GA}</td>
                <td>{stats.GD}</td>
                <td>{stats.Pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
