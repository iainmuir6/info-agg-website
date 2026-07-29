# sports_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Helper functions to insert sports data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions

from datetime import datetime, timedelta
import time
import sys
import os

from dotenv import load_dotenv
load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from .espn import SPORT_CONFIGS, fetch_espn_news, fetch_espn_scores, fetch_espn_standings
except ImportError:
    from espn import SPORT_CONFIGS, fetch_espn_news, fetch_espn_scores, fetch_espn_standings


def get_supabase_client() -> Client:
    """
    Create and return a Supabase client
    
    Returns:
        Supabase client instance
    """
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')  # Use service role key for server-side operations
    
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables")
    
    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def get_league_id(supabase: Client, sport: str, league: str) -> Optional[str]:
    """
    Get the league ID for a given sport/league combination
    
    Args:
        supabase: Supabase client instance
        sport: Sport name (e.g., 'football', 'basketball')
        league: League name (e.g., 'nfl', 'nba')
    
    Returns:
        League ID if found, None otherwise
    """
    try:
        response = supabase.table('leagues').select('id').eq('sport', sport).eq('league', league).maybe_single().execute()
        return response.data.get('id') if (response and response.data) else None
    except Exception as e:
        print(f"Error getting league ID for {sport}/{league}: {e}")
        return None


def _sports_news_records(league_id: str, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for article in articles:
        url = article.get('url')
        if not url:
            continue
        records.append({
            'league_id': league_id,
            'title': article.get('title'),
            'description': article.get('description'),
            'url': url,
            'published_at': article.get('published_at'),
            'source': article.get('source', 'ESPN'),
            'image_url': article.get('image'),
        })
    return records


def _upsert_sports_news_records(
    supabase: Client, records: List[Dict[str, Any]], errors: Optional[List[str]] = None
) -> int:
    if not records:
        return 0
    try:
        response = supabase.table('sports_news').upsert(records, on_conflict='url').execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting sports news: {e}")
        if errors is not None:
            errors.append(f"sports_news upsert failed ({len(records)} records): {e}")
        return 0


def insert_news_articles(supabase: Client, league_id: str, articles: List[Dict[str, Any]]) -> int:
    """
    Batch-upsert news articles into the database (single DB round-trip).

    Args:
        supabase: Supabase client instance
        league_id: League ID from leagues table
        articles: List of article dictionaries from fetch_espn_news()

    Returns:
        Number of articles successfully inserted
    """
    return _upsert_sports_news_records(supabase, _sports_news_records(league_id, articles))


def _sports_score_records(league_id: str, games: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for game in games:
        event_id = game.get('event_id')
        if not event_id:
            continue
        records.append({
            'league_id': league_id,
            'event_id': str(event_id),
            'home_team': game.get('home_team'),
            'away_team': game.get('away_team'),
            'home_abbrev': game.get('home_abbrev'),
            'away_abbrev': game.get('away_abbrev'),
            'home_logo': game.get('home_logo'),
            'away_logo': game.get('away_logo'),
            'home_score': game.get('home_score'),
            'away_score': game.get('away_score'),
            'home_record': game.get('home_record'),
            'away_record': game.get('away_record'),
            'status': game.get('status'),
            'status_detail': game.get('status_detail'),
            'game_date': game.get('date'),
            'venue': game.get('venue'),
            'broadcast': game.get('broadcast'),
            'week': game.get('week'),
            'season': game.get('season'),
            'season_type': game.get('season_type'),
        })
    return records


def _upsert_sports_score_records(
    supabase: Client, records: List[Dict[str, Any]], errors: Optional[List[str]] = None
) -> int:
    if not records:
        return 0
    # Dedupe on the conflict key — the same event can appear twice in one
    # command, which PostgREST rejects for the whole batch.
    seen: set = set()
    deduped = []
    for r in records:
        k = (r['league_id'], r['event_id'])
        if k not in seen:
            seen.add(k)
            deduped.append(r)
    try:
        response = supabase.table('sports_scores').upsert(
            deduped, on_conflict='league_id,event_id'
        ).execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting sports scores: {e}")
        if errors is not None:
            errors.append(f"sports_scores upsert failed ({len(deduped)} records): {e}")
        return 0


def insert_scores(supabase: Client, league_id: str, games: List[Dict[str, Any]]) -> int:
    """
    Batch-upsert game scores/schedule into the database (single DB round-trip).

    Args:
        supabase: Supabase client instance
        league_id: League ID from leagues table
        games: List of game dictionaries from fetch_espn_scores()

    Returns:
        Number of games successfully inserted
    """
    return _upsert_sports_score_records(supabase, _sports_score_records(league_id, games))


def sync_all_sports_data(
    supabase: Client,
    news_limit_per_sport: int = 20,
    include_news: bool = True,
) -> Dict[str, Any]:
    """
    Sync all sports data (news and scores) to the database

    Args:
        supabase: Supabase client instance
        news_limit_per_sport: Maximum number of news articles per sport
        include_news: When False, fetch scoreboards only (halves the ESPN
            call count — used by the tier-A intraday refresh)

    Returns:
        Dictionary with sync statistics
    """
    stats = {
        'leagues_processed': 0,
        'news_inserted': 0,
        'scores_inserted': 0,
        'errors': []
    }

    # Prefetch all league IDs in one query — avoids N sequential DB reads in the hot loop
    try:
        resp = supabase.table('leagues').select('id,sport,league').execute()
        league_id_map = {(r['sport'], r['league']): r['id'] for r in (resp.data or [])}
    except Exception as e:
        stats['errors'].append(f"Failed to prefetch league IDs: {e}")
        return stats

    all_news_records: List[Dict[str, Any]] = []
    all_score_records: List[Dict[str, Any]] = []

    for sport, league in SPORT_CONFIGS:
        try:
            league_id = league_id_map.get((sport, league))
            if not league_id:
                stats['errors'].append(f"League ID not found for {sport}/{league}")
                continue

            stats['leagues_processed'] += 1

            if include_news:
                articles = fetch_espn_news(sport, league, limit=news_limit_per_sport)
                all_news_records.extend(_sports_news_records(league_id, articles))

            games = fetch_espn_scores(sport, league)
            all_score_records.extend(_sports_score_records(league_id, games))

        except Exception as e:
            stats['errors'].append(f"Error processing {sport}/{league}: {e}")

    if all_news_records:
        seen_urls: set = set()
        deduped_news = [
            r
            for r in all_news_records
            if r.get('url') and not (r['url'] in seen_urls or seen_urls.add(r['url']))
        ]
        stats['news_inserted'] = _upsert_sports_news_records(
            supabase, deduped_news, errors=stats['errors']
        )

    if all_score_records:
        stats['scores_inserted'] = _upsert_sports_score_records(
            supabase, all_score_records, errors=stats['errors']
        )

    return stats


def sync_season_schedules(
    supabase: Client,
    days_back: int = 150,
    days_forward: int = 14,
    chunk_days: int = 14,
) -> Dict[str, Any]:
    """Fetch the full season schedule for every in-season league.

    The daily scoreboard call only returns today's slate, so team pages
    computed win/loss records from a handful of games. This walks the
    season in date-range chunks (ESPN accepts dates=YYYYMMDD-YYYYMMDD) for
    leagues that actually have games near today, so records are complete.

    Runs once per day (run_etl.py --season-schedules), not on the intraday
    tiers — it costs roughly (days_back / chunk_days) ESPN calls per league.
    """
    stats: Dict[str, Any] = {
        'leagues_processed': 0,
        'scores_inserted': 0,
        'errors': [],
    }

    try:
        resp = supabase.table('leagues').select('id,sport,league').execute()
        league_rows = resp.data or []
    except Exception as e:
        stats['errors'].append(f"Failed to load leagues: {e}")
        return stats

    now = datetime.now()
    window_start = now - timedelta(days=days_back)
    window_end = now + timedelta(days=days_forward)

    for row in league_rows:
        sport, league, league_id = row['sport'], row['league'], row['id']

        # In-season check: any game within +/-10 days of today?
        try:
            probe = (
                supabase.table('sports_scores')
                .select('id')
                .eq('league_id', league_id)
                .gte('game_date', (now - timedelta(days=10)).isoformat())
                .lte('game_date', (now + timedelta(days=10)).isoformat())
                .limit(1)
                .execute()
            )
            if not (probe.data or []):
                continue
        except Exception as e:
            stats['errors'].append(f"{league}: in-season probe failed: {e}")
            continue

        stats['leagues_processed'] += 1
        league_records: List[Dict[str, Any]] = []

        cursor = window_start
        while cursor < window_end:
            chunk_end = min(cursor + timedelta(days=chunk_days - 1), window_end)
            date_range = f"{cursor.strftime('%Y%m%d')}-{chunk_end.strftime('%Y%m%d')}"
            try:
                games = fetch_espn_scores(sport, league, dates=date_range)
                league_records.extend(_sports_score_records(league_id, games))
            except Exception as e:
                stats['errors'].append(f"{league} {date_range}: {e}")
            cursor = chunk_end + timedelta(days=1)

        if league_records:
            stats['scores_inserted'] += _upsert_sports_score_records(
                supabase, league_records, errors=stats['errors']
            )

    return stats


def _standings_records(league_id: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for row in rows:
        team_abbrev = row.get('team_abbrev')
        if not team_abbrev:
            continue
        records.append({
            'league_id': league_id,
            'team_name': row.get('team_name'),
            'team_abbrev': team_abbrev,
            'logo': row.get('logo'),
            'conference': row.get('conference'),
            'division': row.get('division'),
            'wins': row.get('wins'),
            'losses': row.get('losses'),
            'ties': row.get('ties'),
            'win_percent': row.get('win_percent'),
            'games_behind': row.get('games_behind'),
            'streak': row.get('streak'),
            'playoff_seed': row.get('playoff_seed'),
            'point_differential': row.get('point_differential'),
            'points': row.get('points'),
            'rank': row.get('rank'),
            'season': row.get('season'),
        })
    return records


def insert_standings(supabase: Client, league_id: str, rows: List[Dict[str, Any]]) -> int:
    """Batch-upsert one league's standings, keyed on (league_id, team_abbrev, season)."""
    records = _standings_records(league_id, rows)
    if not records:
        return 0
    try:
        response = supabase.table('sports_standings').upsert(
            records, on_conflict='league_id,team_abbrev,season'
        ).execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting standings: {e}")
        return 0


def sync_standings(supabase: Client) -> Dict[str, Any]:
    """Fetch + upsert standings for every configured league. One ESPN call per
    league (~9 calls/day) — run once daily, not on an intraday tier."""
    stats: Dict[str, Any] = {
        'leagues_processed': 0,
        'rows_inserted': 0,
        'errors': [],
    }

    try:
        resp = supabase.table('leagues').select('id,sport,league').execute()
        league_id_map = {(r['sport'], r['league']): r['id'] for r in (resp.data or [])}
    except Exception as e:
        stats['errors'].append(f"Failed to prefetch league IDs: {e}")
        return stats

    for sport, league in SPORT_CONFIGS:
        league_id = league_id_map.get((sport, league))
        if not league_id:
            stats['errors'].append(f"League ID not found for {sport}/{league}")
            continue
        try:
            rows = fetch_espn_standings(sport, league)
            if rows:
                stats['rows_inserted'] += insert_standings(supabase, league_id, rows)
            stats['leagues_processed'] += 1
        except Exception as e:
            stats['errors'].append(f"Error fetching standings for {sport}/{league}: {e}")

    return stats


def backfill_sports_scores(
    supabase: Client,
    days_back: int = 30,
) -> Dict[str, Any]:
    """
    Backfill sports_scores by fetching ESPN scoreboard for each day in the window.

    Iterates each calendar date from `days_back` days ago through yesterday,
    fetching all configured sport/league scoreboards for that date.

    Args:
        supabase: Supabase client instance
        days_back: Number of days back to backfill (default 30)

    Returns:
        Stats dict: dates_processed, scores_inserted, errors
    """
    stats: Dict[str, Any] = {
        'dates_processed': 0,
        'scores_inserted': 0,
        'errors': [],
    }

    today = datetime.now().date()
    dates = [today - timedelta(days=d) for d in range(days_back, 0, -1)]  # oldest → newest

    for date in dates:
        date_str = date.strftime('%Y%m%d')
        day_count = 0
        for sport, league in SPORT_CONFIGS:
            try:
                games = fetch_espn_scores(sport, league, dates=date_str)
                if games:
                    league_id = get_league_id(supabase, sport, league)
                    if league_id:
                        count = insert_scores(supabase, league_id, games)
                        day_count += count
            except Exception as e:
                msg = f"Error fetching {sport}/{league} scores for {date_str}: {e}"
                stats['errors'].append(msg)
        if day_count:
            print(f"  {date_str}: inserted {day_count} scores")
        stats['scores_inserted'] += day_count
        stats['dates_processed'] += 1
        time.sleep(0.3)  # light throttle — ESPN has no published rate limit

    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing sports data to database...")
    print("=" * 60)
    
    try:
        supabase = get_supabase_client()
        stats = sync_all_sports_data(supabase, news_limit_per_sport=20)
        
        print("\n" + "=" * 60)
        print("Sync Complete!")
        print("=" * 60)
        print(f"Leagues processed: {stats['leagues_processed']}")
        print(f"News articles inserted: {stats['news_inserted']}")
        print(f"Games/scores inserted: {stats['scores_inserted']}")
        
        if stats['errors']:
            print(f"\nErrors encountered: {len(stats['errors'])}")
            for error in stats['errors']:
                print(f"  - {error}")
        
    except Exception as e:
        print(f"Fatal error: {e}")

