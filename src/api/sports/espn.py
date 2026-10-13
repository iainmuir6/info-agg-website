# espn.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches sports data from the ESPN API
#       ---> Supports news and scores/schedule for: NFL, College Football, NBA, WNBA,
#            Men's/Women's College Basketball, MLB, College Baseball, NHL, and Soccer

from pprint import PrettyPrinter
from typing import Dict, List, Optional, Any
from datetime import datetime
import requests
import os
import sys
import time
import threading

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import (
    get_http_session, MinInterval,
    breaker, EndpointUnavailable, HTTP_TIMEOUT, is_host_fault,
)


ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_STANDINGS_BASE_URL = "https://site.api.espn.com/apis/v2/sports"

# Enforce strict >=1s minimum spacing between repeated ESPN HTTP calls from
# this module (sports ETL is sequential, but backfills are loop-driven).
# MinInterval reserves a slot under its lock and sleeps outside it, so
# concurrent callers are paced without being serialized.
_ESPN_MIN_INTERVAL_S = 1.0
_espn_pacer = MinInterval(_ESPN_MIN_INTERVAL_S)

# Standings runs once/day (9 calls total, one per league) against an endpoint
# with no documented rate limit — the 1s scoreboard/news pacer above would add
# ~9s to the already-tight season-schedules daily run and risk the 60s ETL
# budget (CLAUDE.md). A separate, lighter pacer keeps this call family fast
# without loosening the shared pacer used by the higher-frequency calls.
_ESPN_STANDINGS_MIN_INTERVAL_S = 0.2
_espn_standings_pacer = MinInterval(_ESPN_STANDINGS_MIN_INTERVAL_S)


def _espn_min_interval() -> None:
    _espn_pacer.wait()


# The college scoreboards are Top 25 only unless asked for a division.
# groups=80 is all of FBS (FBS-vs-FCS games included) — without it the
# dateless intraday call held 16 of week 5's 59 games (Sep 2026). groups=50 is
# all of Division I basketball: 4 games → 82 on a November Saturday.
_LEAGUE_SCOREBOARD_PARAMS: Dict[tuple, Dict[str, str]] = {
    ('football', 'college-football'): {'groups': '80'},
    ('basketball', 'mens-college-basketball'): {'groups': '50'},
}

# Which multi-day forms ESPN's scoreboard still honours (probed Sep 2026):
#   - dates=YYYYMMDD-YYYYMMDD: a 200 with zero events, every league. Dead.
#   - dates=YYYYMM: a whole month in one call, but `limit` past ~500 is
#     ignored and hands back 25 events, hence MONTH_LIMIT.
#   - men's college basketball with groups=50: the month form returns zero
#     events (and without groups it is Top 25 only), so the full D1 slate can
#     only be read a day at a time. A single day is uncapped — opening night
#     returned all 169.
MONTH_LIMIT = 500
DAILY_ONLY_LEAGUES = {'mens-college-basketball'}


def months_spanning(start, end) -> List[str]:
    """Each calendar month touching [start, end] (dates or datetimes), as 'YYYYMM'."""
    months: List[str] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append(f"{y:04d}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


SPORT_CONFIGS = [
    # Football
    ('football', 'nfl'),
    ('football', 'college-football'),
    # Basketball
    ('basketball', 'nba'),
    ('basketball', 'wnba'),
    ('basketball', 'mens-college-basketball'),
    # ('basketball', 'womens-college-basketball'),
    # Baseball
    ('baseball', 'mlb'),
    ('baseball', 'college-baseball'),
    # Hockey
    ('hockey', 'nhl'),
    # Soccer leagues (major ones)
    ('soccer', 'eng.1'),  # English Premier League
    # ('soccer', 'usa.1'),  # MLS
    # ('soccer', 'esp.1'),  # La Liga
    # ('soccer', 'ita.1'),  # Serie A
    # ('soccer', 'fra.1'),  # Ligue 1
    # ('soccer', 'ger.1'),  # Bundesliga
]


def fetch_espn_news(
    sport: str,
    league: str,
    limit: int = 20,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch news articles for a specific sport/league from ESPN API

    Args:
        sport: Sport name (e.g., 'football', 'basketball')
        league: League name (e.g., 'nfl', 'nba')
        limit: Maximum number of articles to return
        errors: Optional list the failure reason is appended to. Without it an
                outage returns `[]`, identical to a league with no news, and
                the caller reports a clean run that quietly lost a league.

    Returns:
        List of news article dictionaries
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    url = f"{ESPN_BASE_URL}/{sport}/{league}/news"

    try:
        _espn_min_interval()
        response = get_http_session().get(url, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()

        articles = []
        # Parse per-article so one malformed record drops itself, not the
        # whole league's news.
        for article in data.get('articles', [])[:limit]:
            try:
                images = article.get('images') or []
                image_url = images[0].get('url') if images and isinstance(images[0], dict) else None
                articles.append({
                    'title': article.get('headline'),
                    'description': article.get('description'),
                    'url': article.get('links', {}).get('web', {}).get('href'),
                    'published_at': article.get('published'),
                    'source': 'ESPN',
                    'sport': sport,
                    'league': league,
                    'image': image_url
                })
            except Exception as e:
                print(f"Skipping malformed article for {sport}/{league}: {e}")

        return articles

    except requests.exceptions.RequestException as e:
        _fail(f"Error fetching news for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError) as e:
        _fail(f"Error parsing news data for {sport}/{league}: {e}")
        return []


def fetch_espn_scores(
    sport: str,
    league: str,
    dates: Optional[str] = None,
    limit: Optional[int] = None,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch scores/schedule for a specific sport/league from ESPN API

    Args:
        sport: Sport name (e.g., 'football', 'basketball')
        league: League name (e.g., 'nfl', 'nba')
        dates: Single date 'YYYYMMDD' or a whole month 'YYYYMM'. The range
            form 'YYYYMMDD-YYYYMMDD' now returns zero events on every league
            (seen Sep 2026) — a 200 with an empty list, not an error.
        limit: Optional cap on events ESPN returns. The backfill sets this so a
            truncated range can be detected (returned == limit) and split.
        errors: Optional list the failure reason is appended to (see
            fetch_espn_news — same reason).

    Returns:
        List of game/match dictionaries
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    url = f"{ESPN_BASE_URL}/{sport}/{league}/scoreboard"

    params = dict(_LEAGUE_SCOREBOARD_PARAMS.get((sport, league), {}))
    if dates:
        params['dates'] = dates
    if limit:
        params['limit'] = limit

    # Two breaker ids per call. The shared one carries host-level faults, so an
    # ESPN outage still costs one timeout rather than one per league; the
    # per-league one carries that league's own 4xx, which says nothing about
    # the other eight and must not skip them.
    league_endpoint = f'espn:scoreboard:{sport}/{league}'

    try:
        breaker.check('espn:scoreboard')
        breaker.check(league_endpoint)
        _espn_min_interval()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        breaker.record_success('espn:scoreboard')
        breaker.record_success(league_endpoint)
        data = response.json()

        games = []
        for event in data.get('events', []):
            competition = event.get('competitions', [{}])[0]
            competitors = competition.get('competitors', [])

            if len(competitors) >= 2:
                home_competitor = competitors[0] if competitors[0].get('homeAway') == 'home' else competitors[1]
                away_competitor = competitors[1] if competitors[0].get('homeAway') == 'home' else competitors[0]

                game_data = {
                    'event_id': event.get('id'),
                    'sport': sport,
                    'league': league,
                    'home_team': home_competitor.get('team', {}).get('displayName'),
                    'away_team': away_competitor.get('team', {}).get('displayName'),
                    # Official ESPN abbreviations (e.g. WNBA Dallas Wings → DAL) —
                    # the frontend prefers these over its lookup-table fallback.
                    'home_abbrev': home_competitor.get('team', {}).get('abbreviation'),
                    'away_abbrev': away_competitor.get('team', {}).get('abbreviation'),
                    # Already present on the scoreboard payload — no extra call needed.
                    'home_logo': home_competitor.get('team', {}).get('logo'),
                    'away_logo': away_competitor.get('team', {}).get('logo'),
                    'home_score': home_competitor.get('score'),
                    'away_score': away_competitor.get('score'),
                    'home_record': home_competitor.get('records', [{}])[0].get('summary') if home_competitor.get('records') else None,
                    'away_record': away_competitor.get('records', [{}])[0].get('summary') if away_competitor.get('records') else None,
                    'status': event.get('status', {}).get('type', {}).get('description'),
                    'status_detail': event.get('status', {}).get('type', {}).get('shortDetail'),
                    'date': event.get('date'),
                    'venue': competition.get('venue', {}).get('fullName'),
                    'broadcast': competition.get('broadcasts', [{}])[0].get('names', [None])[0] if competition.get('broadcasts') else None,
                    'week': event.get('week', {}).get('number') if event.get('week') else None,
                    'season': event.get('season', {}).get('year') if event.get('season') else None,
                    # 1=preseason, 2=regular, 3=postseason — used to exclude
                    # preseason games from team records without hiding them.
                    'season_type': event.get('season', {}).get('type') if event.get('season') else None,
                }
                games.append(game_data)

        return games

    except EndpointUnavailable as e:
        _fail(f"ESPN scoreboard skipped for {sport}/{league}: {e}")
        return []
    except requests.exceptions.RequestException as e:
        breaker.record_failure(
            'espn:scoreboard' if is_host_fault(e) else league_endpoint, e)
        _fail(f"Error fetching scores for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError) as e:
        _fail(f"Error parsing scores data for {sport}/{league}: {e}")
        return []


def _standings_stat(stats: List[Dict[str, Any]], *names: str) -> Optional[Dict[str, Any]]:
    """Find a stat entry by name (ESPN's `stats[].name`), case-insensitive."""
    wanted = {n.lower() for n in names}
    for s in stats:
        if (s.get('name') or '').lower() in wanted:
            return s
    return None


def _parse_overall_record(stats: List[Dict[str, Any]]) -> tuple:
    """College football's standings stats carry no `losses`/`ties`/`winPercent`
    field at all (unlike every other ESPN league) — the only place the loss
    count exists is as text, in the "W-L" or "W-L-T" `displayValue` of the
    stat literally named `overall`. Returns (wins, losses, ties), any of
    which may be None if the summary stat is missing or unparseable."""
    overall = _standings_stat(stats, 'overall')
    display = overall.get('displayValue') if overall else None
    if not display:
        return None, None, None
    parts = display.split('-')
    try:
        if len(parts) == 3:
            return int(parts[0]), int(parts[1]), int(parts[2])
        if len(parts) == 2:
            return int(parts[0]), int(parts[1]), None
    except ValueError:
        pass
    return None, None, None


def _standings_entries(
    entries: List[Dict[str, Any]], conference: Optional[str], division: Optional[str], season: Optional[int]
) -> List[Dict[str, Any]]:
    rows = []
    for entry in entries:
        team = entry.get('team', {}) or {}
        stats = entry.get('stats', []) or []
        wins = _standings_stat(stats, 'wins')
        losses = _standings_stat(stats, 'losses')
        ties = _standings_stat(stats, 'ties')
        win_pct = _standings_stat(stats, 'winPercent')
        games_behind = _standings_stat(stats, 'gamesBehind')
        streak = _standings_stat(stats, 'streak')
        playoff_seed = _standings_stat(stats, 'playoffSeed')
        differential = _standings_stat(stats, 'differential', 'pointDifferential')
        # NHL/soccer rank by league points + a explicit `rank`, not winPercent
        # (soccer has no winPercent/playoffSeed stat at all).
        points = _standings_stat(stats, 'points')
        rank = _standings_stat(stats, 'rank')
        logos = team.get('logos') or []

        wins_val = int(wins['value']) if wins and wins.get('value') is not None else None
        losses_val = int(losses['value']) if losses and losses.get('value') is not None else None
        ties_val = int(ties['value']) if ties and ties.get('value') is not None else None
        if losses_val is None:
            # College football: fall back to the "W-L(-T)" text summary.
            ov_wins, ov_losses, ov_ties = _parse_overall_record(stats)
            wins_val = wins_val if wins_val is not None else ov_wins
            losses_val = ov_losses
            ties_val = ties_val if ties_val is not None else ov_ties

        win_pct_val = win_pct.get('value') if win_pct else None
        if win_pct_val is None and wins_val is not None and losses_val is not None:
            played = wins_val + losses_val + (ties_val or 0)
            win_pct_val = wins_val / played if played > 0 else None

        rank_val = int(rank['value']) if rank and rank.get('value') is not None else None
        playoff_seed_val = int(playoff_seed['value']) if playoff_seed and playoff_seed.get('value') is not None else None
        if rank_val is None and win_pct is None and playoff_seed_val is not None:
            # College football has neither a top-level `rank` nor `winPercent`
            # stat (this is the same payload shape `losses` was missing
            # from, above) — its `playoffSeed` is ESPN's own tiebreak-resolved
            # conference standing position, verified against espn.com's
            # displayed ACC order. Gated on `win_pct is None` too so this
            # doesn't fire for leagues (NFL, NBA, ...) that do carry
            # `winPercent` but no `rank`, where `playoffSeed` is a
            # league-wide playoff seed, not a within-division rank.
            rank_val = playoff_seed_val

        rows.append({
            'team_name': team.get('displayName'),
            'team_abbrev': team.get('abbreviation'),
            'logo': logos[0].get('href') if logos else None,
            'conference': conference,
            'division': division,
            'wins': wins_val,
            'losses': losses_val,
            'ties': ties_val,
            'win_percent': win_pct_val,
            'games_behind': games_behind.get('displayValue') if games_behind else None,
            'streak': streak.get('displayValue') if streak else None,
            'playoff_seed': playoff_seed_val,
            'point_differential': differential.get('value') if differential else None,
            'points': points.get('value') if points else None,
            'rank': rank_val,
            'season': season,
        })
    return rows


def fetch_espn_standings(
    sport: str,
    league: str,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch current-season standings for a sport/league from ESPN.

    Normalizes two response shapes into one flat list of team-row dicts:
      - Conference leagues (NFL, NBA, ...): `children` = conferences, each
        either with its own `children` (divisions) or a direct `standings`.
      - Non-conference leagues (EPL, ...): a single top-level `standings`.

    Returns:
        List of dicts: team_name, team_abbrev, conference, division, wins,
        losses, ties, win_percent, games_behind, streak, playoff_seed,
        point_differential, season. `conference`/`division` are None when
        the league has no such grouping.

    errors: Optional list the failure reason is appended to (see
    fetch_espn_news — same reason).
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    url = f"{ESPN_STANDINGS_BASE_URL}/{sport}/{league}/standings"

    try:
        _espn_standings_pacer.wait()
        response = get_http_session().get(url, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        _fail(f"Error fetching standings for {sport}/{league}: {e}")
        return []
    except Exception as e:
        _fail(f"Error parsing standings data for {sport}/{league}: {e}")
        return []

    season = data.get('season', {}).get('year')
    groups = data.get('children') or []

    if not groups:
        entries = (data.get('standings') or {}).get('entries', [])
        return _standings_entries(entries, conference=None, division=None, season=season)

    rows: List[Dict[str, Any]] = []
    for group in groups:
        conference = group.get('name') or group.get('abbreviation')
        divisions = group.get('children') or []
        if divisions:
            for division in divisions:
                division_name = division.get('name') or division.get('abbreviation')
                entries = (division.get('standings') or {}).get('entries', [])
                rows.extend(_standings_entries(entries, conference=conference, division=division_name, season=season))
        else:
            entries = (group.get('standings') or {}).get('entries', [])
            rows.extend(_standings_entries(entries, conference=conference, division=None, season=season))

    return rows


def fetch_all_espn_news(limit_per_sport: int = 10) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch news for all configured sports/leagues

    Args:
        limit_per_sport: Maximum number of articles per sport/league

    Returns:
        Dictionary mapping 'sport/league' to list of articles
    """
    all_news = {}

    for sport, league in SPORT_CONFIGS:
        key = f"{sport}/{league}"
        print(f"Fetching news for {key}...")
        articles = fetch_espn_news(sport, league, limit=limit_per_sport)
        all_news[key] = articles

    return all_news


def fetch_all_espn_scores(dates: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch scores/schedule for all configured sports/leagues

    Args:
        dates: Optional date filter in YYYYMMDD format

    Returns:
        Dictionary mapping 'sport/league' to list of games/matches
    """
    all_scores = {}

    for sport, league in SPORT_CONFIGS:
        key = f"{sport}/{league}"
        print(f"Fetching scores for {key}...")
        games = fetch_espn_scores(sport, league, dates=dates)
        all_scores[key] = games

    return all_scores


if __name__ == "__main__":
    print("=" * 60)
    print("Fetching sports data from ESPN API...")
    print("=" * 60)

    # Fetch news for all sports
    print("\n--- Fetching News ---")
    all_news = fetch_all_espn_news(limit_per_sport=5)

    # Fetch scores for all sports
    print("\n--- Fetching Scores/Schedule ---")
    all_scores = fetch_all_espn_scores()
    for key, games in all_scores.items():
        if games:
            print(f"\n{key.upper()}: {len(games)} games/matches")
            for game in games[:2]:  # Show first 2
                home = game.get('home_team', 'TBD')
                away = game.get('away_team', 'TBD')
                home_score = game.get('home_score', '')
                away_score = game.get('away_score', '')
                status = game.get('status', '')
                print(f"  - {away} @ {home}: {away_score}-{home_score} ({status})")
