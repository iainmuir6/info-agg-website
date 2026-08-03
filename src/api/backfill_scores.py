#!/usr/bin/env python3
# backfill_scores.py
#
# Author: IM
# Company: Scouts Consulting Group
# Description: One-off / on-demand historical backfill of ESPN scores and
#              schedules into info_agg.sports_scores.
#
# The daily ETL only sees today's scoreboard, so team records and season
# history come from here. Safe to re-run: every write is an upsert keyed on
# (league_id, event_id), so re-running a range repairs it rather than
# duplicating it. Keep this around as the recovery path when the daily ETL
# misses days.
#
# Usage (from repo root, venv active):
#
#   # Current season to date for every league ESPN covers
#   python src/api/backfill_scores.py --season current
#
#   # A specific league and season
#   python src/api/backfill_scores.py --leagues wnba --season 2026
#
#   # Several past seasons
#   python src/api/backfill_scores.py --leagues nfl,nba --season 2023,2024,2025
#
#   # An explicit window
#   python src/api/backfill_scores.py --start 2026-04-01 --end 2026-07-29
#
#   # See the plan without writing anything
#   python src/api/backfill_scores.py --season current --dry-run

import os
import sys
import json
import argparse
from datetime import datetime, timedelta, date
from typing import Dict, List, Any, Optional, Tuple

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from supabase import create_client, Client, ClientOptions
from dotenv import load_dotenv

from etl_lib import et_today
from sports.espn import SPORT_CONFIGS, fetch_espn_scores
from sports.sports_db_helper import _sports_score_records, _upsert_sports_score_records

load_dotenv()

# ESPN caps events per scoreboard response. We request this many and treat a
# full response as "probably truncated", then split the range and retry — so
# the backfill stays complete even if the real cap differs per league.
PAGE_LIMIT = 900

# Months each league actually plays (1-12). Chunks entirely outside these are
# skipped, which removes most of the wasted calls in a season-long backfill.
SEASON_MONTHS: Dict[str, set] = {
    'nfl':                     {9, 10, 11, 12, 1, 2},
    'college-football':        {8, 9, 10, 11, 12, 1},
    'nba':                     {10, 11, 12, 1, 2, 3, 4, 5, 6},
    'wnba':                    {5, 6, 7, 8, 9, 10},
    'mens-college-basketball': {11, 12, 1, 2, 3, 4},
    'mlb':                     {2, 3, 4, 5, 6, 7, 8, 9, 10, 11},
    'college-baseball':        {2, 3, 4, 5, 6},
    'nhl':                     {9, 10, 11, 12, 1, 2, 3, 4, 5, 6},
    'eng.1':                   {8, 9, 10, 11, 12, 1, 2, 3, 4, 5},
}

# Leagues whose season spans a calendar-year boundary. "Season 2025" for these
# means Aug 2025 → Jul 2026; for the rest it means the 2025 calendar year.
SPLIT_YEAR_LEAGUES = {
    'nfl', 'college-football', 'nba', 'mens-college-basketball', 'nhl', 'eng.1',
}


def get_supabase_client() -> Client:
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
        )
    return create_client(url, key, options=ClientOptions(schema='info_agg'))


def season_window(league: str, season: int) -> Tuple[date, date]:
    """Inclusive date window for a league's season."""
    if league in SPLIT_YEAR_LEAGUES:
        return date(season, 7, 1), date(season + 1, 6, 30)
    return date(season, 1, 1), date(season, 12, 31)


def chunk_has_games(league: str, start: date, end: date) -> bool:
    """True when any month in the chunk is part of the league's season."""
    months = SEASON_MONTHS.get(league)
    if not months:
        return True
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        if cursor.month in months:
            return True
        cursor = date(cursor.year + (cursor.month // 12), (cursor.month % 12) + 1, 1)
    return False


def fetch_range(
    sport: str,
    league: str,
    start: date,
    end: date,
    stats: Dict[str, Any],
    depth: int = 0,
) -> List[Dict[str, Any]]:
    """Fetch one date range, splitting it if ESPN truncated the response.

    A response at the page limit means ESPN capped it and games are missing,
    so the range is halved and retried. Recursion bottoms out at a single day,
    which cannot be split further.
    """
    span = f"{start.strftime('%Y%m%d')}-{end.strftime('%Y%m%d')}"
    try:
        games = fetch_espn_scores(sport, league, dates=span, limit=PAGE_LIMIT)
        stats['requests'] += 1
    except Exception as e:
        stats['errors'].append(f"{league} {span}: {e}")
        return []

    truncated = len(games) >= PAGE_LIMIT
    if truncated and start < end:
        mid = start + (end - start) // 2
        stats['splits'] += 1
        return (
            fetch_range(sport, league, start, mid, stats, depth + 1)
            + fetch_range(sport, league, mid + timedelta(days=1), end, stats, depth + 1)
        )
    if truncated:
        # Single day still at the cap — take what we got and say so.
        stats['errors'].append(
            f"{league} {span}: hit the {PAGE_LIMIT}-event cap on a single day; "
            f"some games may be missing"
        )
    return games


def backfill_league(
    supabase: Optional[Client],
    sport: str,
    league: str,
    league_id: Optional[str],
    start: date,
    end: date,
    chunk_days: int,
    dry_run: bool,
) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        'league': league,
        'requests': 0,
        'splits': 0,
        'skipped_chunks': 0,
        'games_fetched': 0,
        'rows_written': 0,
        'errors': [],
    }

    records: List[Dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        if not chunk_has_games(league, cursor, chunk_end):
            stats['skipped_chunks'] += 1
            cursor = chunk_end + timedelta(days=1)
            continue

        games = fetch_range(sport, league, cursor, chunk_end, stats)
        stats['games_fetched'] += len(games)
        if games and league_id:
            records.extend(_sports_score_records(league_id, games))
        cursor = chunk_end + timedelta(days=1)

    if records and not dry_run and supabase is not None:
        # Write in batches — a full season is well past a comfortable
        # single-statement payload.
        BATCH = 500
        for i in range(0, len(records), BATCH):
            stats['rows_written'] += _upsert_sports_score_records(
                supabase, records[i:i + BATCH], errors=stats['errors']
            )

    return stats


def parse_season_arg(value: str) -> List[int]:
    if value.strip().lower() == 'current':
        today = et_today()
        # July onward starts the next split-year season; either way the
        # current calendar year is the right anchor.
        return [today.year]
    out: List[int] = []
    for part in value.split(','):
        part = part.strip()
        if part:
            out.append(int(part))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Backfill historical ESPN scores into info_agg.sports_scores'
    )
    parser.add_argument('--leagues', type=str, default=None,
                        help='Comma-separated league slugs (default: all configured)')
    parser.add_argument('--season', type=str, default=None,
                        help="Season year(s), comma-separated, or 'current'")
    parser.add_argument('--start', type=str, default=None, help='Start date YYYY-MM-DD')
    parser.add_argument('--end', type=str, default=None, help='End date YYYY-MM-DD')
    parser.add_argument('--chunk-days', type=int, default=7,
                        help='Days per ESPN request before adaptive splitting (default 7)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Fetch and report without writing to Supabase')
    parser.add_argument('--output', type=str, default=None, help='Write a JSON report here')
    args = parser.parse_args()

    if not args.season and not (args.start and args.end):
        parser.error('provide --season, or both --start and --end')

    configs = SPORT_CONFIGS
    if args.leagues:
        wanted = {s.strip().lower() for s in args.leagues.split(',') if s.strip()}
        configs = [(sp, lg) for sp, lg in SPORT_CONFIGS if lg.lower() in wanted]
        unknown = wanted - {lg.lower() for _, lg in SPORT_CONFIGS}
        if unknown:
            print(f"Unknown league(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            print(f"Known: {', '.join(lg for _, lg in SPORT_CONFIGS)}", file=sys.stderr)
            return 2

    supabase: Optional[Client] = None
    league_id_map: Dict[str, str] = {}
    if not args.dry_run:
        supabase = get_supabase_client()
        resp = supabase.table('leagues').select('id,sport,league').execute()
        league_id_map = {r['league']: r['id'] for r in (resp.data or [])}

    started = datetime.now()
    all_stats: List[Dict[str, Any]] = []

    for sport, league in configs:
        if args.start and args.end:
            windows = [(
                datetime.strptime(args.start, '%Y-%m-%d').date(),
                datetime.strptime(args.end, '%Y-%m-%d').date(),
            )]
        else:
            windows = [season_window(league, s) for s in parse_season_arg(args.season)]

        league_id = league_id_map.get(league)
        if not args.dry_run and not league_id:
            print(f"  ! {league}: not in info_agg.leagues — skipping")
            continue

        for start, end in windows:
            # Never ask ESPN for the future beyond the next couple of weeks.
            end = min(end, et_today() + timedelta(days=14))
            if start > end:
                continue
            print(f"→ {league}: {start} .. {end}", flush=True)
            stats = backfill_league(
                supabase, sport, league, league_id,
                start, end, args.chunk_days, args.dry_run,
            )
            all_stats.append(stats)
            print(
                f"  {stats['requests']} requests"
                f" ({stats['splits']} splits, {stats['skipped_chunks']} offseason chunks skipped)"
                f" · {stats['games_fetched']} games"
                f" · {stats['rows_written']} rows written"
                + (f" · {len(stats['errors'])} errors" if stats['errors'] else ""),
                flush=True,
            )
            for err in stats['errors'][:5]:
                print(f"    - {err}", flush=True)

    elapsed = (datetime.now() - started).total_seconds()
    totals = {
        'elapsed_seconds': round(elapsed, 1),
        'requests': sum(s['requests'] for s in all_stats),
        'games_fetched': sum(s['games_fetched'] for s in all_stats),
        'rows_written': sum(s['rows_written'] for s in all_stats),
        'errors': [e for s in all_stats for e in s['errors']],
        'dry_run': args.dry_run,
        'per_league': all_stats,
    }

    print(
        f"\nDone in {totals['elapsed_seconds']}s — "
        f"{totals['requests']} ESPN requests, "
        f"{totals['games_fetched']} games, "
        f"{totals['rows_written']} rows written, "
        f"{len(totals['errors'])} errors"
        + ("  [DRY RUN — nothing written]" if args.dry_run else "")
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(totals, f, indent=2)
        print(f"Report: {args.output}")

    # Errors are reported but don't fail the run — a partial backfill is
    # still progress, and re-running repairs the gaps.
    return 0


if __name__ == '__main__':
    sys.exit(main())
