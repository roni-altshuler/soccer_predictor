
'use client';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAllSeasons } from '../actions';

const ITEM_HEIGHT = 24; // Approximate height of each season link (py-1 is 8px vertical padding, plus font size)
const VISIBLE_ITEMS = 5;

export default function Navbar() {
  const [allSeasons, setAllSeasons] = useState<string[]>([]);
  const [visibleSeasons, setVisibleSeasons] = useState<string[]>([]);
  const [startIndex, setStartIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadAllSeasons = async () => {
      setLoading(true);
      const seasons = await fetchAllSeasons();
      setAllSeasons(seasons);
      setLoading(false);
    };
    loadAllSeasons();
  }, []);

  const updateVisibleItems = useCallback(() => {
    if (!scrollContainerRef.current || allSeasons.length === 0) return;

    const { scrollTop } = scrollContainerRef.current;
    const newStartIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const newEndIndex = Math.min(newStartIndex + VISIBLE_ITEMS, allSeasons.length);

    if (newStartIndex !== startIndex) {
      setStartIndex(newStartIndex);
      setVisibleSeasons(allSeasons.slice(newStartIndex, newEndIndex));
    }
  }, [allSeasons, startIndex]);

  useEffect(() => {
    if (allSeasons.length > 0) {
      const initialEndIndex = Math.min(VISIBLE_ITEMS, allSeasons.length);
      setVisibleSeasons(allSeasons.slice(0, initialEndIndex));
    }
  }, [allSeasons]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    scrollContainer.addEventListener('scroll', updateVisibleItems);

    return () => {
      scrollContainer.removeEventListener('scroll', updateVisibleItems);
    };
  }, [updateVisibleItems]);

  const totalHeight = allSeasons.length * ITEM_HEIGHT;
  const paddingTop = startIndex * ITEM_HEIGHT;
  const paddingBottom = (allSeasons.length - (startIndex + visibleSeasons.length)) * ITEM_HEIGHT;

  return (
    <header style={{ backgroundColor: '#121212', borderBottom: '1px solid rgba(245, 245, 220, 0.5)' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', margin: '0 auto', padding: '1rem', color: '#F5F5DC', boxSizing: 'border-box' }}>
        <Link href="/" style={{ fontSize: '1.5rem', fontWeight: 'bold', textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
          Soccer Stats
        </Link>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginLeft: 'auto', marginRight: '1rem', flexShrink: 1 }}>
          <Link href="/" className="nav-link">Home</Link>
          <div className="relative group">
            <span style={{ cursor: 'pointer' }} className="nav-link">Leagues</span>
            <div className="absolute hidden group-hover:block mt-8 z-50 bg-gray-800 border border-gray-700 rounded-md w-80">
              <Link href="/leagues/premier-league" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Premier League</Link>
              <Link href="/leagues/champions-league" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Champions League</Link>
              <Link href="/leagues/laliga" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>LaLiga</Link>
              <Link href="/leagues/fifa-world-cup" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>FIFA World Cup</Link>
              <Link href="/leagues/bundesliga" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Bundesliga</Link>
              <Link href="/leagues/mls" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>MLS</Link>
              <Link href="/leagues/serie-a" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Serie A</Link>
              <Link href="/leagues/europa-league" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Europa League</Link>
              <Link href="/leagues/ligue-1" className="block py-1 nav-link" style={{ whiteSpace: 'nowrap' }}>Ligue 1</Link>
            </div>
          </div>
          <Link href="/prediction" className="nav-link">Prediction</Link>
        </div>
      </nav>
    </header>
  );
}
