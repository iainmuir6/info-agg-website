# sports_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Helper functions to insert sports data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions

from datetime import datetime, timedelta, timezone
import sys
import os

from dotenv import load_dotenv
load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from .espn import (
        SPORT_CONFIGS, DAILY_ONLY_LEAGUES, MONTH_LIMIT, months_spanning,
        fetch_espn_news, fetch_espn_scores, fetch_espn_standings,
    )
except ImportError:
    from espn import (
        SPORT_CONFIGS, DAILY_ONLY_LEAGUES, MONTH_LIMIT, months_spanning,
        fetch_espn_news, fetch_espn_scores, fetch_espn_standings,
    )

_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import chunked_upsert, db_call, et_now, run_deadline


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
    return chunked_upsert(
        supabase, 'sports_news', records, on_conflict='url', errors=errors
    )


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
    return chunked_upsert(
        supabase, 'sports_scores', deduped,
        on_conflict='league_id,event_id', errors=errors,
    )


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
        'leagues_failed': 0,
        'news_inserted': 0,
        'scores_inserted': 0,
        'errors': []
    }

    # Prefetch all league IDs in one query — avoids N sequential DB reads in the hot loop
    try:
        resp = db_call(
            lambda: supabase.table('leagues').select('id,sport,league').execute(),
            'leagues prefetch',
        )
        league_id_map = {(r['sport'], r['league']): r['id'] for r in (resp.data or [])}
    except Exception as e:
        stats['errors'].append(f"Failed to prefetch league IDs: {e}")
        return stats

    all_news_records: List[Dict[str, Any]] = []
    all_score_records: List[Dict[str, Any]] = []

    for idx, (sport, league) in enumerate(SPORT_CONFIGS):
        if run_deadline.expired():
            stats['errors'].append(
                run_deadline.skip_note('league(s)', len(SPORT_CONFIGS) - idx))
            break
        try:
            league_id = league_id_map.get((sport, league))
            if not league_id:
                stats['errors'].append(f"League ID not found for {sport}/{league}")
                continue

            stats['leagues_processed'] += 1
            # ESPN's fetchers report failures by appending here rather than
            # raising, so "did this league work?" is the change in the error
            # list across it. The count is what lets a scores-only run tell a
            # quiet night (0 games, 0 failures) from an outage.
            errors_before = len(stats['errors'])

            if include_news:
                articles = fetch_espn_news(
                    sport, league, limit=news_limit_per_sport, errors=stats['errors'])
                all_news_records.extend(_sports_news_records(league_id, articles))

            games = fetch_espn_scores(sport, league, errors=stats['errors'])
            all_score_records.extend(_sports_score_records(league_id, games))

            if len(stats['errors']) > errors_before:
                stats['leagues_failed'] += 1

        except Exception as e:
            stats['errors'].append(f"Error processing {sport}/{league}: {e}")
            stats['leagues_failed'] += 1

    stats['rows_pending'] = len(all_news_records) + len(all_score_records)

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


# A day-only league (see DAILY_ONLY_LEAGUES) costs one ESPN call per day, so
# its walk is narrowed to what can still change: yesterday's late finals and
# the next ten days of schedule. Today's scores ride the intraday call.
_DAILY_WALK_BACK = 1
_DAILY_WALK_FORWARD = 10


def sync_season_schedules(
    supabase: Client,
    days_back: int = 21,
    days_forward: int = 14,
) -> Dict[str, Any]:
    """Refresh the recent + upcoming schedule for every in-season league.

    The daily scoreboard call only returns today's slate, so team pages
    computed win/loss records from a handful of games. This walks the window
    a calendar month at a time (dates=YYYYMM) for leagues that actually have
    games near today.

    It used to walk 14-day ranges (dates=YYYYMMDD-YYYYMMDD). In Sep 2026 ESPN
    began answering every range with a 200 and zero events, so this walk
    wrote nothing and college football's upcoming week held only what the
    Top-25 intraday call saw — 16 of 59 games, and CMF could not link the
    rest of the slate's odds. A month is the one multi-day form that still
    works; it over-fetches the edges of the window, which is harmless. Men's
    college basketball is the exception: its full D1 slate only comes a day
    at a time, over a narrower window (see _DAILY_WALK_*).

    days_back only needs to cover recent corrections and a short run outage:
    sports_scores is now fully retained, so history accumulates rather than
    being re-fetched daily. It used to walk 150 days to rebuild season
    records against a 30-day retention window that deleted them again every
    run — ~35s of the daily budget spent re-fetching rows that were then
    dropped. Use backfill_scores.py to repair anything older than this
    window.

    Runs once per day (run_etl.py --season-schedules), not on the intraday
    tiers — it costs two or three ESPN calls per league, twelve for college
    basketball.
    """
    stats: Dict[str, Any] = {
        'leagues_processed': 0,
        'scores_inserted': 0,
        'errors': [],
    }

    try:
        resp = db_call(
            lambda: supabase.table('leagues').select('id,sport,league').execute(),
            'leagues prefetch',
        )
        league_rows = resp.data or []
    except Exception as e:
        stats['errors'].append(f"Failed to load leagues: {e}")
        return stats

    now = et_now()
    window_start = now - timedelta(days=days_back)
    window_end = now + timedelta(days=days_forward)

    for idx, row in enumerate(league_rows):
        if run_deadline.expired():
            stats['errors'].append(
                run_deadline.skip_note('league(s) in season walk', len(league_rows) - idx))
            break
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

        if league in DAILY_ONLY_LEAGUES:
            first = (now - timedelta(days=_DAILY_WALK_BACK)).date()
            spans = [(first + timedelta(days=i)).strftime('%Y%m%d')
                     for i in range(_DAILY_WALK_BACK + _DAILY_WALK_FORWARD + 1)]
        else:
            spans = months_spanning(window_start, window_end)

        for span in spans:
            if run_deadline.expired():
                stats['errors'].append(
                    f"deadline: budget spent mid-season-walk for {league}; "
                    f"stopped at {span} (data written so far is kept)")
                break
            try:
                games = fetch_espn_scores(
                    sport, league, dates=span, limit=MONTH_LIMIT,
                    errors=stats['errors'])
                if len(games) >= MONTH_LIMIT:
                    stats['errors'].append(
                        f"{league} {span}: {len(games)} events hit the "
                        f"{MONTH_LIMIT} limit — it may be truncated")
                league_records.extend(_sports_score_records(league_id, games))
            except Exception as e:
                stats['errors'].append(f"{league} {span}: {e}")

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
            # Stamped on every upsert — without it an existing row keeps the
            # fetched_at from its first insert and looks permanently stale.
            'fetched_at': datetime.now(timezone.utc).isoformat(),
        })
    return records


def insert_standings(
    supabase: Client, league_id: str, rows: List[Dict[str, Any]],
    errors: Optional[List[str]] = None,
) -> int:
    """Batch-upsert one league's standings, keyed on (league_id, team_abbrev, season)."""
    records = _standings_records(league_id, rows)
    if not records:
        return 0
    return chunked_upsert(
        supabase, 'sports_standings', records,
        on_conflict='league_id,team_abbrev,season', errors=errors,
    )


def sync_standings(supabase: Client) -> Dict[str, Any]:
    """Fetch + upsert standings for every configured league. One ESPN call per
    league (~9 calls/day) — run once daily, not on an intraday tier."""
    stats: Dict[str, Any] = {
        'leagues_processed': 0,
        'rows_inserted': 0,
        'errors': [],
    }

    try:
        resp = db_call(
            lambda: supabase.table('leagues').select('id,sport,league').execute(),
            'leagues prefetch',
        )
        league_id_map = {(r['sport'], r['league']): r['id'] for r in (resp.data or [])}
    except Exception as e:
        stats['errors'].append(f"Failed to prefetch league IDs: {e}")
        return stats

    for idx, (sport, league) in enumerate(SPORT_CONFIGS):
        if run_deadline.expired():
            stats['errors'].append(
                run_deadline.skip_note('league standings', len(SPORT_CONFIGS) - idx))
            break
        league_id = league_id_map.get((sport, league))
        if not league_id:
            stats['errors'].append(f"League ID not found for {sport}/{league}")
            continue
        try:
            rows = fetch_espn_standings(sport, league, errors=stats['errors'])
            if rows:
                stats['rows_inserted'] += insert_standings(
                    supabase, league_id, rows, errors=stats['errors']
                )
            stats['leagues_processed'] += 1
        except Exception as e:
            stats['errors'].append(f"Error fetching standings for {sport}/{league}: {e}")

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

