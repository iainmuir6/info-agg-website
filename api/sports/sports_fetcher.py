"""
Sports API Script
Fetches sports data from various sources
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def fetch_espn_scores():
    """Fetch sports scores from ESPN API"""
    # ESPN API endpoints (may require API key)
    endpoints = {
        'nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
        'nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
        'mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard'
    }
    
    sports_data = {}
    
    for sport, url in endpoints.items():
        try:
            response = requests.get(url)
            response.raise_for_status()
            data = response.json()
            
            games = []
            for event in data.get('events', []):
                game_data = {
                    'sport': sport,
                    'home_team': event.get('competitions', [{}])[0].get('competitors', [{}])[0].get('team', {}).get('displayName'),
                    'away_team': event.get('competitions', [{}])[0].get('competitors', [{}])[1].get('team', {}).get('displayName'),
                    'home_score': event.get('competitions', [{}])[0].get('competitors', [{}])[0].get('score'),
                    'away_score': event.get('competitions', [{}])[0].get('competitors', [{}])[1].get('score'),
                    'status': event.get('status', {}).get('type', {}).get('description'),
                    'date': event.get('date')
                }
                games.append(game_data)
            
            sports_data[sport] = games
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching {sport} data: {e}")
            sports_data[sport] = []
    
    return sports_data

def fetch_soccer_scores():
    """Fetch soccer scores from Football-Data API"""
    api_key = os.getenv('FOOTBALL_DATA_API_KEY')
    if not api_key:
        print("FOOTBALL_DATA_API_KEY not found")
        return []
    
    headers = {'X-Auth-Token': api_key}
    url = 'https://api.football-data.org/v4/matches'
    
    try:
        response = requests.get(url, headers=headers)
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
                'date': match.get('utcDate')
            }
            matches.append(match_data)
        
        return matches
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching soccer data: {e}")
        return []

if __name__ == "__main__":
    print("Fetching sports data...")
    
    # Fetch ESPN data
    espn_data = fetch_espn_scores()
    for sport, games in espn_data.items():
        print(f"\n{sport.upper()} Games:")
        for game in games[:3]:  # Show first 3 games
            print(f"- {game['away_team']} @ {game['home_team']}: {game['away_score']}-{game['home_score']}")
    
    # Fetch soccer data
    soccer_data = fetch_soccer_scores()
    if soccer_data:
        print(f"\nSoccer Matches ({len(soccer_data)} found):")
        for match in soccer_data[:3]:  # Show first 3 matches
            print(f"- {match['away_team']} @ {match['home_team']}: {match['away_score']}-{match['home_score']}")
