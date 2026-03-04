"""
Match-related API endpoints.
"""

from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query

from backend.services.fotmob import get_fotmob_client
from backend.models.match import MatchSummary, Match, MatchDay, MatchStatus

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("/today", response_model=dict)
async def get_today_matches():
    """Get all matches for today."""
    client = get_fotmob_client()
    today = datetime.now().strftime("%Y%m%d")
    
    data = await client.get_matches_by_date(today)
    
    if not data:
        raise HTTPException(status_code=502, detail="Failed to fetch matches from FotMob")
    
    return data


@router.get("/date/{date}")
async def get_matches_by_date(date: str):
    """
    Get all matches for a specific date.
    
    Args:
        date: Date in YYYYMMDD format
    """
    if len(date) != 8 or not date.isdigit():
        raise HTTPException(status_code=400, detail="Date must be in YYYYMMDD format")
    
    client = get_fotmob_client()
    data = await client.get_matches_by_date(date)
    
    if not data:
        raise HTTPException(status_code=502, detail="Failed to fetch matches")
    
    return data


@router.get("/live")
async def get_live_matches():
    """Get all currently live matches."""
    client = get_fotmob_client()
    matches = await client.get_live_matches()
    
    return {
        "count": len(matches),
        "matches": matches
    }


@router.get("/upcoming")
async def get_upcoming_matches(days: int = Query(default=7, ge=1, le=30)):
    """Get upcoming matches for the next N days."""
    client = get_fotmob_client()
    matches = await client.get_upcoming_matches(days)
    
    # Group by date
    by_date = {}
    for match in matches:
        date = match.get("date", "unknown")
        if date not in by_date:
            by_date[date] = []
        by_date[date].append(match)
    
    return {
        "days": days,
        "total_matches": len(matches),
        "matches_by_date": by_date
    }


@router.get("/{match_id}")
async def get_match_details(match_id: int):
    """
    Get detailed information about a specific match.
    
    Includes:
    - Match header (teams, score, status)
    - Events (goals, cards, substitutions)
    - Lineups and formations
    - Match statistics
    - Head-to-head history
    """
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    return data


@router.get("/{match_id}/events")
async def get_match_events(match_id: int):
    """Get match events (goals, cards, substitutions)."""
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    events = data.get("content", {}).get("matchFacts", {}).get("events", {})
    
    return {
        "match_id": match_id,
        "events": events
    }


@router.get("/{match_id}/lineups")
async def get_match_lineups(match_id: int):
    """Get match lineups and formations."""
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    lineups = data.get("content", {}).get("lineup", {})
    
    return {
        "match_id": match_id,
        "lineups": lineups
    }


@router.get("/{match_id}/stats")
async def get_match_stats(match_id: int):
    """Get match statistics."""
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    stats = data.get("content", {}).get("stats", {})
    
    return {
        "match_id": match_id,
        "stats": stats
    }


@router.get("/{match_id}/live")
async def get_match_live_status(match_id: int):
    """
    Get live match status including current score, minute, and events.
    
    Returns real-time data for live matches including:
    - Current minute and period
    - Score
    - Recent events (goals, cards, substitutions)
    - Halftime countdown (if applicable)
    """
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    # Extract header info
    header = data.get("header", {})
    general = data.get("general", {})
    match_status = general.get("matchTimeUTCDate", "")
    
    # Get current status
    status_data = header.get("status", {})
    
    # Parse events
    events = []
    all_events = data.get("content", {}).get("matchFacts", {}).get("events", {}).get("events", [])
    for event in all_events:
        events.append({
            "type": event.get("type", ""),
            "minute": event.get("time", {}).get("minute", 0),
            "addedTime": event.get("time", {}).get("injuryTime"),
            "player": event.get("player", {}).get("name", "Unknown"),
            "team": "home" if event.get("isHome") else "away",
            "relatedPlayer": event.get("assistPlayer", {}).get("name") if event.get("assistPlayer") else None,
        })
    
    return {
        "match_id": match_id,
        "status": status_data.get("reason", {}).get("short", ""),
        "statusLong": status_data.get("reason", {}).get("long", ""),
        "minute": status_data.get("liveTime", {}).get("short", ""),
        "homeScore": header.get("teams", [{}])[0].get("score", 0) if header.get("teams") else 0,
        "awayScore": header.get("teams", [{}])[1].get("score", 0) if len(header.get("teams", [])) > 1 else 0,
        "events": events,
        "isLive": status_data.get("started", False) and not status_data.get("finished", True),
    }


@router.get("/{match_id}/referee")
async def get_match_referee(match_id: int):
    """
    Get referee information for a specific match.
    
    First extracts referee name from FotMob, then enriches with
    stats from the RefereeService database when available.
    """
    client = get_fotmob_client()
    data = await client.get_match_details(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    # Extract referee from match facts
    match_facts = data.get("content", {}).get("matchFacts", {})
    info_box = match_facts.get("infoBox", {})
    
    referee_info = info_box.get("Referee", info_box.get("referee", {}))
    
    # Get referee name
    if isinstance(referee_info, str):
        ref_name = referee_info
        ref_country = None
    elif isinstance(referee_info, dict):
        ref_name = referee_info.get("text", referee_info.get("name", "TBD"))
        ref_country = referee_info.get("country")
    else:
        ref_name = "TBD"
        ref_country = None
    
    # Try to enrich with RefereeService data
    enriched_stats = _get_referee_stats(ref_name)
    
    return {
        "match_id": match_id,
        "name": ref_name,
        "country": ref_country or enriched_stats.get("country"),
        "age": enriched_stats.get("age"),
        "experience_years": enriched_stats.get("experience_years", 0),
        "career_matches": enriched_stats.get("career_matches", 0),
        "avg_yellow_cards": enriched_stats.get("avg_yellow_cards", 3.2),
        "avg_red_cards": enriched_stats.get("avg_red_cards", 0.1),
        "home_win_rate": enriched_stats.get("home_win_rate", 0.45),
        "away_win_rate": enriched_stats.get("away_win_rate", 0.30),
        "draw_rate": enriched_stats.get("draw_rate", 0.25),
        "avg_goals": enriched_stats.get("avg_goals", 2.6),
        "total_penalties": enriched_stats.get("total_penalties", 0),
        "penalties_per_match": enriched_stats.get("penalties_per_match", 0.15),
        "competitions": enriched_stats.get("competitions", []),
        "tendency": enriched_stats.get("tendency", "average"),
        "data_source": enriched_stats.get("source", "default"),
    }


def _get_referee_stats(name: str) -> dict:
    """Look up referee stats from the RefereeService database."""
    try:
        from backend.services.referee.client import RefereeService
        service = RefereeService()
        ref_data = service.get_referee_by_name(name)
        if ref_data:
            stats = ref_data.get("stats", {})
            return {
                "country": ref_data.get("country"),
                "age": ref_data.get("age"),
                "experience_years": ref_data.get("experience_years", 0),
                "career_matches": stats.get("matches_officiated", 0),
                "avg_yellow_cards": stats.get("avg_yellow_cards_per_match", 3.2),
                "avg_red_cards": stats.get("avg_red_cards_per_match", 0.1),
                "home_win_rate": stats.get("home_win_percentage", 45) / 100,
                "away_win_rate": stats.get("away_win_percentage", 30) / 100,
                "draw_rate": stats.get("draw_percentage", 25) / 100,
                "avg_goals": stats.get("avg_goals_per_match", 2.6),
                "total_penalties": stats.get("penalties_awarded", 0),
                "penalties_per_match": stats.get("penalties_per_match", 0.15),
                "competitions": ref_data.get("competitions", []),
                "tendency": ref_data.get("tendency", "average"),
                "source": "database",
            }
    except Exception:
        pass
    return {"source": "default"}


@router.get("/{match_id}/h2h")
async def get_match_h2h(match_id: int):
    """Get head-to-head history for a match."""
    client = get_fotmob_client()
    data = await client.get_h2h(match_id)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"H2H data not found for match {match_id}")
    
    return {
        "match_id": match_id,
        "h2h": data
    }
