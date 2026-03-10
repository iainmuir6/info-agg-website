# espn.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches sports data from the ESPN API
#       ---> Supports news and scores/schedule for: NFL, College Football, NBA, WNBA,
#            Men's/Women's College Basketball, MLB, College Baseball, NHL, and Soccer

from typing import Dict, List, Optional, Any
from datetime import datetime
import requests
import os

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()


ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports"
SPORT_CONFIGS = [
    # Football
    ('football', 'nfl'),
    ('football', 'college-football'),
    # Basketball
    ('basketball', 'nba'),
    ('basketball', 'wnba'),
    ('basketball', 'mens-college-basketball'),
    ('basketball', 'womens-college-basketball'),
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
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        articles = []
        for article in data.get('articles', [])[:limit]:
            articles.append({
                'title': article.get('headline'),
                'description': article.get('description'),
                'url': article.get('links', {}).get('web', {}).get('href'),
                'published_at': article.get('published'),
                'source': 'ESPN',
                'sport': sport,
                'league': league,
                'image': article.get('images', [{}])[0].get('url') if article.get('images') else None
            })

        return articles

    except requests.exceptions.RequestException as e:
        print(f"Error fetching news for {sport}/{league}: {e}")
        return []
    except (KeyError, IndexError) as e:
        print(f"Error parsing news data for {sport}/{league}: {e}")
        return []


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
        response = requests.get(url, params=params, timeout=10)
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
        response = requests.get(url, headers=headers, timeout=10)
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


