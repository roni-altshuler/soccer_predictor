'use server';

import { getSeasons, getRankedSeasonStats } from '@/lib/data';

export async function fetchAllSeasons() {
  return getSeasons();
}

export async function fetchRankedSeasonStats(season: string) {
  return getRankedSeasonStats(season);
}