export interface Match {
  Season: string;
  Date: string;
  Home: string;
  xG: string;
  'Home Goals': string;
  'Away Goals': string;
  'xG.1': string;
  Away: string;
  Attendance: string;
  Venue: string;
}

export interface SeasonStats {
  Season: string;
  Squad: string;
  W: string;
  D: string;
  L: string;
  GF: string;
  GA: string;
  Pts: string;
  Sh: string;
  SoT: string;
  FK: string;
  PK: string;
  Cmp: string;
  Att: string;
  'Cmp%': string;
  CK: string;
  CrdY: string;
  CrdR: string;
  Fls: string;
  PKcon: string;
  OG: string;
  GD?: number;
}
export function getChartsData(season: string) {
  const matches = getMatches(season);

  const homeWins = matches.filter(match => Number(match['Home Goals']) > Number(match['Away Goals'])).length;
  const awayWins = matches.filter(match => Number(match['Away Goals']) > Number(match['Home Goals'])).length;
  const draws = matches.filter(match => Number(match['Home Goals']) === Number(match['Away Goals'])).length;

  const stats = getSeasonStats(season);
  const wdlData = stats.map(team => ({
    name: team.Squad,
    W: Number(team.W),
    D: Number(team.D),
    L: Number(team.L),
  }));

  return {
    outcomeData: [
      { name: 'Home Wins', value: homeWins },
      { name: 'Away Wins', value: awayWins },
      { name: 'Draws', value: draws },
    ],
    wdlData,
  };
}
