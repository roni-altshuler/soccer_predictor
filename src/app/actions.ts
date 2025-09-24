'use server';

import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');

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

export async function fetchAllSeasons(league: string) {
  const seasonsPath = path.join(dataDir, league, 'seasons.csv');
  const seasonsFile = fs.readFileSync(seasonsPath, 'utf-8');
  const seasons = seasonsFile.split('\n').slice(1).map(line => line.split(',')[1]);
  return seasons.filter(Boolean);
}

export async function getTeams(league: string) {
  const teamsPath = path.join(dataDir, league, 'teams.csv');
  const teamsFile = fs.readFileSync(teamsPath, 'utf-8');
  const teams = teamsFile.split('\n').slice(1).map(line => line.split(',')[1]);
  return teams.filter(Boolean);
}

export async function getMatches(league: string, season: string): Promise<Match[]> {
  const matchesPath = path.join(dataDir, league, 'matches.csv');
  const matchesFile = fs.readFileSync(matchesPath, 'utf-8');
  const lines = matchesFile.split('\n');
  const headers = lines[0].split(',');

  const matches = lines.slice(1).map(line => {
    const values = line.split(',');
    const match: Match = {} as Match;
    headers.forEach((header, i) => {
      match[header.trim() as keyof Match] = values[i];
    });
    return match;
  });

  return matches.filter(match => match.Season === season);
}

export async function getSeasonStats(league: string, season: string): Promise<SeasonStats[]> {
  const seasonStatsPath = path.join(dataDir, league, 'seasonstats.csv');
  const seasonStatsFile = fs.readFileSync(seasonStatsPath, 'utf-8');
  const lines = seasonStatsFile.split('\n');
  const headers = lines[0].split(',');

  const stats = lines.slice(1).map(line => {
    const values = line.split(',');
    const seasonStat: SeasonStats = {} as SeasonStats;
    headers.forEach((header, i) => {
      seasonStat[header.trim() as keyof SeasonStats] = values[i];
    });
    return seasonStat;
  });

  return stats.filter(stat => stat.Season === season);
}

export async function fetchRankedSeasonStats(league: string, season: string): Promise<SeasonStats[]> {
  const seasonStats = await getSeasonStats(league, season);

  const rankedStats = seasonStats.map(stat => {
    const GF = parseInt(stat.GF, 10) || 0;
    const GA = parseInt(stat.GA, 10) || 0;
    const goalDifference = GF - GA;
    return {
      ...stat,
      GD: goalDifference,
    };
  });

  rankedStats.sort((a, b) => {
    const ptsA = parseInt(a.Pts, 10) || 0;
    const ptsB = parseInt(b.Pts, 10) || 0;
    if (ptsB !== ptsA) {
      return ptsB - ptsA;
    }

    if (b.GD !== a.GD) {
      return b.GD - a.GD;
    }

    const gfA = parseInt(a.GF, 10) || 0;
    const gfB = parseInt(b.GF, 10) || 0;
    return gfB - gfA;
  });

  return rankedStats;
}

export async function fetchChartsData(league: string, season: string) {
  const matches = await getMatches(league, season);

  const homeWins = matches.filter(match => Number(match['Home Goals']) > Number(match['Away Goals'])).length;
  const awayWins = matches.filter(match => Number(match['Away Goals']) > Number(match['Home Goals'])).length;
  const draws = matches.filter(match => Number(match['Home Goals']) === Number(match['Away Goals'])).length;

  const stats = await getSeasonStats(league, season);
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