# media_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: Helper functions to insert media data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
try:
    from supabase.lib.client_options import ClientOptions
except ImportError:
    ClientOptions = None
import os
from dotenv import load_dotenv

load_dotenv()

# Default subreddits to track
DEFAULT_SUBREDDITS = [
    'worldnews', 'technology', 'science', 'sports',
    'entertainment', 'music', 'movies', 'programming'
]


def get_supabase_client() -> Client:
    """Create and return a Supabase client."""
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def insert_spotify_releases(supabase: Client, albums: List[Dict[str, Any]]) -> int:
    """
    Insert Spotify new release album records into the spotify_releases table.

    Args:
        supabase: Supabase client instance
        albums: List of album dicts from fetch_spotify_new_releases()['albums']

    Returns:
        Number of albums inserted/updated
    """
    if not albums:
        return 0

    inserted_count = 0

    for album in albums:
        try:
            # Extract best image (highest resolution)
            images = album.get('images', [])
            image_url = None
            if images:
                # Prefer ~640px width image, or the largest available
                for img in images:
                    if img.get('width', 0) >= 300:
                        image_url = img.get('url')
                        break
                if not image_url and images:
                    image_url = images[0].get('url')

            # Extract artist names as text array
            artist_names = [a.get('name') for a in album.get('artists', []) if a.get('name')]

            # Parse release_date (may be YYYY, YYYY-MM, or YYYY-MM-DD)
            release_date = album.get('release_date')
            precision = album.get('release_date_precision', 'day')
            if release_date and precision == 'year':
                release_date = f"{release_date}-01-01"
            elif release_date and precision == 'month':
                release_date = f"{release_date}-01"

            spotify_id = album.get('album_id') or album.get('id')
            if not spotify_id:
                continue

            insert_data = {
                'spotify_id': spotify_id,
                'name': album.get('name'),
                'artists': artist_names,
                'album_type': album.get('album_type'),
                'release_date': release_date,
                'image_url': image_url,
                'external_url': album.get('external_urls', {}).get('spotify'),
                'total_tracks': album.get('total_tracks'),
            }

            response = supabase.table('spotify_releases').upsert(
                insert_data,
                on_conflict='spotify_id'
            ).execute()

            if response.data:
                inserted_count += 1

        except Exception as e:
            print(f"Error inserting Spotify release '{album.get('name', 'unknown')}': {e}")

    return inserted_count


def insert_reddit_posts(supabase: Client, posts: List[Dict[str, Any]]) -> int:
    """
    Insert Reddit post records into the reddit_posts table.

    Args:
        supabase: Supabase client instance
        posts: List of post dicts from fetch_reddit_hot()

    Returns:
        Number of posts inserted/updated
    """
    if not posts:
        return 0

    inserted_count = 0

    for post in posts:
        try:
            # Extract post ID from permalink
            permalink = post.get('permalink', '')
            # post_id from Reddit's 'name' field (t3_XXXXX) or derive from permalink
            parts = permalink.rstrip('/').split('/')
            post_id = None
            if len(parts) >= 6:
                post_id = parts[-3] if len(parts) > 3 else parts[-1]
            if not post_id:
                # Fallback: hash the URL
                post_id = str(hash(permalink))[:10]

            # Handle thumbnail URL
            thumbnail = post.get('thumbnail')
            thumbnail_url = thumbnail if thumbnail and thumbnail.startswith('http') else None

            # Convert Unix timestamp to ISO
            created_utc = post.get('created_utc')
            posted_at = None
            if created_utc:
                from datetime import datetime, timezone
                posted_at = datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat()

            insert_data = {
                'post_id': post_id,
                'subreddit': post.get('subreddit'),
                'title': post.get('title'),
                'author': post.get('author'),
                'score': post.get('score', 0),
                'upvote_ratio': post.get('upvote_ratio'),
                'num_comments': post.get('num_comments', 0),
                'url': post.get('url'),
                'permalink': permalink,
                'selftext': (post.get('selftext') or '')[:2000],  # Truncate long self-posts
                'thumbnail_url': thumbnail_url,
                'is_self': post.get('is_self', False),
                'flair': post.get('link_flair_text') or post.get('flair'),
                'posted_at': posted_at,
            }

            if not insert_data.get('title') or not insert_data.get('subreddit'):
                continue

            response = supabase.table('reddit_posts').upsert(
                insert_data,
                on_conflict='post_id'
            ).execute()

            if response.data:
                inserted_count += 1

        except Exception as e:
            print(f"Error inserting Reddit post '{post.get('title', 'unknown')}': {e}")

    return inserted_count


def sync_spotify_data(supabase: Client) -> Dict[str, Any]:
    """
    Sync Spotify new releases to the database.

    Args:
        supabase: Supabase client instance

    Returns:
        Dictionary with sync statistics
    """
    try:
        from .media_fetcher import fetch_spotify_new_releases, get_spotify_access_token
    except ImportError:
        import sys
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from media_fetcher import fetch_spotify_new_releases, get_spotify_access_token

    stats = {
        'releases_inserted': 0,
        'errors': []
    }

    try:
        print("Getting Spotify access token...")
        access_token = get_spotify_access_token()
        if not access_token:
            stats['errors'].append("Failed to get Spotify access token")
            return stats

        print("Fetching Spotify new releases...")
        result = fetch_spotify_new_releases(country='US', limit=50, access_token=access_token)
        if result and result.get('albums'):
            count = insert_spotify_releases(supabase, result['albums'])
            stats['releases_inserted'] = count
            print(f"  Inserted {count} Spotify releases")

    except Exception as e:
        error_msg = f"Error syncing Spotify data: {e}"
        stats['errors'].append(error_msg)
        print(error_msg)

    return stats


def sync_reddit_data(supabase: Client, subreddits: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Sync Reddit hot posts to the database.

    Args:
        supabase: Supabase client instance
        subreddits: List of subreddit names (defaults to DEFAULT_SUBREDDITS)

    Returns:
        Dictionary with sync statistics
    """
    try:
        from .media_fetcher import fetch_reddit_hot
    except ImportError:
        import sys
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from media_fetcher import fetch_reddit_hot

    if subreddits is None:
        subreddits = DEFAULT_SUBREDDITS

    stats = {
        'subreddits_processed': 0,
        'posts_inserted': 0,
        'errors': []
    }

    for subreddit in subreddits:
        try:
            print(f"Fetching Reddit hot posts from r/{subreddit}...")
            posts = fetch_reddit_hot(subreddit=subreddit, limit=25)
            if posts:
                count = insert_reddit_posts(supabase, posts)
                stats['posts_inserted'] += count
                stats['subreddits_processed'] += 1
                print(f"  Inserted {count} posts from r/{subreddit}")

            import time
            time.sleep(1)  # Be respectful to Reddit's rate limits

        except Exception as e:
            error_msg = f"Error fetching r/{subreddit}: {e}"
            stats['errors'].append(error_msg)
            print(error_msg)

    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing media data to database...")
    print("=" * 60)

    try:
        supabase = get_supabase_client()

        print("\n--- Syncing Spotify Data ---")
        spotify_stats = sync_spotify_data(supabase)
        print(f"\nSpotify Sync Complete:")
        print(f"  Releases inserted: {spotify_stats['releases_inserted']}")

        print("\n--- Syncing Reddit Data ---")
        reddit_stats = sync_reddit_data(supabase)
        print(f"\nReddit Sync Complete:")
        print(f"  Subreddits processed: {reddit_stats['subreddits_processed']}")
        print(f"  Posts inserted: {reddit_stats['posts_inserted']}")

        all_errors = spotify_stats.get('errors', []) + reddit_stats.get('errors', [])
        if all_errors:
            print(f"\nErrors encountered:")
            for error in all_errors:
                print(f"  - {error}")

    except Exception as e:
        print(f"Fatal error: {e}")
