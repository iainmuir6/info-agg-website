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
from etl_lib import get_http_session, MinInterval


ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports"

# Enforce strict >=1s minimum spacing between repeated ESPN HTTP calls from
# this module (sports ETL is sequential, but backfills are loop-driven).
# MinInterval reserves a slot under its lock and sleeps outside it, so
# concurrent callers are paced without being serialized.
_ESPN_MIN_INTERVAL_S = 1.0
_espn_pacer = MinInterval(_ESPN_MIN_INTERVAL_S)


def _espn_min_interval() -> None:
    _espn_pacer.wait()
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


def fetch_espn_news(sport: str, league: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Fetch news articles for a specific sport/league from ESPN API

    Args:
        sport: Sport name (e.g., 'football', 'basketball')
        league: League name (e.g., 'nfl', 'nba')
        limit: Maximum number of articles to return

    Returns:
        List of news article dictionaries
    """
    url = f"{ESPN_BASE_URL}/{sport}/{league}/news"

    try:
        _espn_min_interval()
        response = get_http_session().get(url, timeout=10)
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
        print(f"Error fetching news for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError) as e:
        print(f"Error parsing news data for {sport}/{league}: {e}")
        return []


def fetch_espn_teams(sport: str, league: str) -> List[Dict[str, Any]]:
    """
    Fetch all teams for a given sport/league from ESPN API.

    This uses the public teams endpoint, e.g.:
      https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams

    Args:
        sport: Sport name (e.g., 'basketball').
        league: League name (e.g., 'nba').

    Returns:
        List of simplified team dictionaries with common fields.
    """
    url = f"{ESPN_BASE_URL}/{sport}/{league}/teams"

    try:
        _espn_min_interval()
        response = get_http_session().get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        # ESPN structure: sports -> leagues -> teams -> team
        sports = data.get("sports", [])
        if not sports:
            return []

        leagues = sports[0].get("leagues", [])
        if not leagues:
            return []

        teams_wrapped = leagues[0].get("teams", []) or []
        teams: List[Dict[str, Any]] = []

        for item in teams_wrapped:
            team = item.get("team", {})
            if not team:
                continue

            logos = team.get("logos", []) or []
            primary_logo = logos[0] if logos else {}

            teams.append(
                {
                    "id": team.get("id"),
                    "uid": team.get("uid"),
                    "slug": team.get("slug"),
                    "abbreviation": team.get("abbreviation"),
                    "display_name": team.get("displayName"),
                    "short_display_name": team.get("shortDisplayName"),
                    "name": team.get("name"),
                    "nickname": team.get("nickname"),
                    "location": team.get("location"),
                    "color": team.get("color"),
                    "alternate_color": team.get("alternateColor"),
                    "is_active": team.get("isActive"),
                    "is_all_star": team.get("isAllStar"),
                    "logo": primary_logo.get("href"),
                    "logos": logos,
                    "links": team.get("links", []),
                }
            )

        return teams

    except requests.exceptions.RequestException as e:
        print(f"Error fetching teams for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError, ValueError) as e:
        print(f"Error parsing teams data for {sport}/{league}: {e}")
        return []


def find_espn_team_by_name(
    sport: str,
    league: str,
    name: str,
    *,
    match_abbreviation: bool = True,
    match_nickname: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Look up a single team within a league by name.

    Matching is case-insensitive and tries the following fields in order:
      - abbreviation (e.g., 'BOS')
      - nickname (e.g., 'Celtics')
      - location + nickname (e.g., 'Boston Celtics')
      - display_name / short_display_name

    Args:
        sport: Sport name (e.g., 'basketball').
        league: League name (e.g., 'nba').
        name: Team identifier (name, abbreviation, etc.).
        match_abbreviation: Whether to match on abbreviation.
        match_nickname: Whether to match on nickname only.

    Returns:
        The first matching team dict from `fetch_espn_teams`, or None.
    """
    teams = fetch_espn_teams(sport, league)
    if not teams:
        return None

    target = name.strip().lower()

    # Try strict matches first
    for team in teams:
        abbr = (team.get("abbreviation") or "").lower()
        nickname = (team.get("nickname") or "").lower()
        location = (team.get("location") or "").lower()
        display_name = (team.get("display_name") or "").lower()
        short_display_name = (team.get("short_display_name") or "").lower()

        full_name = f"{location} {nickname}".strip()

        if match_abbreviation and target == abbr and abbr:
            return team
        if match_nickname and target == nickname and nickname:
            return team
        if target == full_name and full_name:
            return team
        if target == display_name and display_name:
            return team
        if target == short_display_name and short_display_name:
            return team

    # Fallback: substring match on display_name / full_name
    for team in teams:
        nickname = (team.get("nickname") or "").lower()
        location = (team.get("location") or "").lower()
        display_name = (team.get("display_name") or "").lower()
        full_name = f"{location} {nickname}".strip()

        if target in full_name or target in display_name:
            return team

    return None


def fetch_espn_scores(sport: str, league: str, dates: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch scores/schedule for a specific sport/league from ESPN API

    Args:
        sport: Sport name (e.g., 'football', 'basketball')
        league: League name (e.g., 'nfl', 'nba')
        dates: Optional date filter in YYYYMMDD format (e.g., '20250115')

    Returns:
        List of game/match dictionaries
    """
    url = f"{ESPN_BASE_URL}/{sport}/{league}/scoreboard"

    params = {}
    if dates:
        params['dates'] = dates

    try:
        _espn_min_interval()
        response = get_http_session().get(url, params=params, timeout=10)
        response.raise_for_status()
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
                }
                games.append(game_data)

        return games

    except requests.exceptions.RequestException as e:
        print(f"Error fetching scores for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError) as e:
        print(f"Error parsing scores data for {sport}/{league}: {e}")
        return []


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


def fetch_soccer_scores():
    """
    Fetch soccer scores from Football-Data API (alternative to ESPN)
    Note: This requires FOOTBALL_DATA_API_KEY in environment variables
    """
    api_key = os.getenv('FOOTBALL_DATA_API_KEY')
    if not api_key:
        print("FOOTBALL_DATA_API_KEY not found - skipping Football-Data API")
        return []

    headers = {'X-Auth-Token': api_key}
    url = 'https://api.football-data.org/v4/matches'

    try:
        _espn_min_interval()
        response = get_http_session().get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        matches = []
        for match in data.get('matches', []):
            match_data = {
                'home_team': match.get('homeTeam', {}).get('name'),
                'away_team': match.get('awayTeam', {}).get('name'),
                'home_score': match.get('score', {}).get('fullTime', {}).get('home'),
                'away_score': match.get('score', {}).get('fullTime', {}).get('away'),
                'status': match.get('status'),
                'competition': match.get('competition', {}).get('name'),
                'date': match.get('utcDate'),
                'source': 'Football-Data.org'
            }
            matches.append(match_data)

        return matches

    except requests.exceptions.RequestException as e:
        print(f"Error fetching soccer data from Football-Data API: {e}")
        return []


# Legacy function for backward compatibility
def fetch_espn_scores_legacy():
    """
    Legacy function - fetches scores for NFL, NBA, and MLB only
    Use fetch_all_espn_scores() for all sports
    """
    legacy_sports = [
        ('football', 'nfl'),
        ('basketball', 'nba'),
        ('baseball', 'mlb')
    ]

    sports_data = {}
    for sport, league in legacy_sports:
        games = fetch_espn_scores(sport, league)
        sports_data[league] = games

    return sports_data


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


    print('\n--- Fetching Teams ---')
    all_teams = fetch_espn_teams(sport='basketball', league='nba')
    
    for team in all_teams:
        abbreviation = team.get('abbreviation')
        name = team.get('name')
        color = team.get('color')
        alt_color = team.get('alternate_color')
        # Print abbreviation with alternate_color, name with color
        print(f"\033[38;2;{int(alt_color[1:3],16)};{int(alt_color[3:5],16)};{int(alt_color[5:7],16)}m{abbreviation}\033[0m: \033[38;2;{int(color[1:3],16)};{int(color[3:5],16)};{int(color[5:7],16)}m{name}\033[0m")