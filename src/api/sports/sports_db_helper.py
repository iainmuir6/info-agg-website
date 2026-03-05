# sports_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Helper functions to insert sports data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
try:
    from supabase.lib.client_options import ClientOptions
except ImportError:
    ClientOptions = None
import os
from dotenv import load_dotenv

load_dotenv()


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


def get_league_id(supabase: Client, sport: str, league: str) -> Optional[int]:
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
        response = supabase.table('leagues').select('id').eq('sport', sport).eq('league', league).single().execute()
        return response.data.get('id') if response.data else None
    except Exception as e:
        print(f"Error getting league ID for {sport}/{league}: {e}")
        return None


def insert_news_articles(supabase: Client, league_id: int, articles: List[Dict[str, Any]]) -> int:
    """
    Insert news articles into the database
    
    Args:
        supabase: Supabase client instance
        league_id: League ID from leagues table
        articles: List of article dictionaries from fetch_espn_news()
    
    Returns:
        Number of articles successfully inserted
    """
    if not articles:
        return 0
    
    inserted_count = 0
    
    for article in articles:
        try:
            # Prepare data for insertion
            news_data = {
                'league_id': league_id,
                'title': article.get('title'),
                'description': article.get('description'),
                'url': article.get('url'),
                'published_at': article.get('published_at'),
                'source': article.get('source', 'ESPN'),
                'image_url': article.get('image')
            }
            
            # Insert with ON CONFLICT DO NOTHING to handle duplicates
            response = supabase.table('sports_news').insert(news_data).execute()
            if response.data:
                inserted_count += 1
                
        except Exception as e:
            # Handle unique constraint violations (duplicate URLs)
            if 'duplicate key' in str(e).lower() or 'unique constraint' in str(e).lower():
                # Try to update existing record instead
                try:
                    supabase.table('sports_news').update({
                        'title': article.get('title'),
                        'description': article.get('description'),
                        'published_at': article.get('published_at'),
                        'image_url': article.get('image')
                    }).eq('url', article.get('url')).execute()
                except Exception as update_error:
                    print(f"Error updating news article {article.get('url')}: {update_error}")
            else:
                print(f"Error inserting news article: {e}")
    
    return inserted_count


def insert_scores(supabase: Client, league_id: int, games: List[Dict[str, Any]]) -> int:
    """
    Insert game scores/schedule into the database
    
    Args:
        supabase: Supabase client instance
        league_id: League ID from leagues table
        games: List of game dictionaries from fetch_espn_scores()
    
    Returns:
        Number of games successfully inserted
    """
    if not games:
        return 0
    
    inserted_count = 0
    
    for game in games:
        try:
            # Prepare data for insertion
            score_data = {
                'league_id': league_id,
                'event_id': str(game.get('event_id')),
                'home_team': game.get('home_team'),
                'away_team': game.get('away_team'),
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
                'season': game.get('season')
            }
            
            # Insert with ON CONFLICT DO UPDATE to handle duplicates
            response = supabase.table('sports_scores').upsert(
                score_data,
                on_conflict='league_id,event_id'
            ).execute()
            
            if response.data:
                inserted_count += 1
                
        except Exception as e:
            print(f"Error inserting game score: {e}")
            print(f"Game data: {game}")
    
    return inserted_count


def sync_all_sports_data(supabase: Client, news_limit_per_sport: int = 20) -> Dict[str, Any]:
    """
    Sync all sports data (news and scores) to the database
    
    Args:
        supabase: Supabase client instance
        news_limit_per_sport: Maximum number of news articles per sport
    
    Returns:
        Dictionary with sync statistics
    """
    # Import from sports_fetcher module (same directory)
    # When running as script, import directly; when imported as module, use relative import
    try:
        from .sports_fetcher import SPORT_CONFIGS, fetch_espn_news, fetch_espn_scores
    except ImportError:
        # Fallback for when running as standalone script
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from sports_fetcher import SPORT_CONFIGS, fetch_espn_news, fetch_espn_scores
    
    stats = {
        'leagues_processed': 0,
        'news_inserted': 0,
        'scores_inserted': 0,
        'errors': []
    }
    
    for sport, league in SPORT_CONFIGS:
        try:
            # Get league ID
            league_id = get_league_id(supabase, sport, league)
            if not league_id:
                stats['errors'].append(f"League ID not found for {sport}/{league}")
                continue
            
            stats['leagues_processed'] += 1
            
            # Fetch and insert news
            print(f"Fetching news for {sport}/{league}...")
            articles = fetch_espn_news(sport, league, limit=news_limit_per_sport)
            news_count = insert_news_articles(supabase, league_id, articles)
            stats['news_inserted'] += news_count
            print(f"  Inserted {news_count} news articles")
            
            # Fetch and insert scores
            print(f"Fetching scores for {sport}/{league}...")
            games = fetch_espn_scores(sport, league)
            scores_count = insert_scores(supabase, league_id, games)
            stats['scores_inserted'] += scores_count
            print(f"  Inserted {scores_count} games/scores")
            
        except Exception as e:
            error_msg = f"Error processing {sport}/{league}: {e}"
            stats['errors'].append(error_msg)
            print(error_msg)
    
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

