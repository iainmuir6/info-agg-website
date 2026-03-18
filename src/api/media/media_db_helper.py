# media_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: Helper functions to insert media data into Supabase database

from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions
import os
import sys
from dotenv import load_dotenv

load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from .spotify import fetch_spotify_new_releases, get_spotify_access_token
except ImportError:
    from spotify import fetch_spotify_new_releases, get_spotify_access_token

try:
    from .reddit import fetch_reddit_hot
except ImportError:
    from reddit import fetch_reddit_hot

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

    records = []
    for album in albums:
        spotify_id = album.get('album_id') or album.get('id')
        if not spotify_id:
            continue

        images = album.get('images', [])
        image_url = None
        if images:
            for img in images:
                if img.get('width', 0) >= 300:
                    image_url = img.get('url')
                    break
            if not image_url:
                image_url = images[0].get('url')

        artist_names = [a.get('name') for a in album.get('artists', []) if a.get('name')]

        release_date = album.get('release_date')
        precision = album.get('release_date_precision', 'day')
        if release_date and precision == 'year':
            release_date = f"{release_date}-01-01"
        elif release_date and precision == 'month':
            release_date = f"{release_date}-01"

        records.append({
            'spotify_id': spotify_id,
            'name': album.get('name'),
            'artists': artist_names,
            'album_type': album.get('album_type'),
            'release_date': release_date,
            'image_url': image_url,
            'external_url': album.get('external_urls', {}).get('spotify'),
            'total_tracks': album.get('total_tracks'),
        })

    if not records:
        return 0

    try:
        response = supabase.table('spotify_releases').upsert(records, on_conflict='spotify_id').execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting Spotify releases: {e}")
        return 0


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

    records = []
    for post in posts:
        post_id = post.get('post_id')
        title = post.get('title')
        subreddit = post.get('subreddit')
        if not post_id or not title or not subreddit:
            continue

        thumbnail = post.get('thumbnail')
        thumbnail_url = thumbnail if thumbnail and thumbnail.startswith('http') else None

        created_utc = post.get('created_utc')
        posted_at = (
            datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat()
            if created_utc else None
        )

        records.append({
            'post_id': post_id,
            'subreddit': subreddit,
            'title': title,
            'author': post.get('author'),
            'score': post.get('score', 0),
            'upvote_ratio': post.get('upvote_ratio'),
            'num_comments': post.get('num_comments', 0),
            'url': post.get('url'),
            'permalink': post.get('permalink', ''),
            'selftext': (post.get('selftext') or '')[:2000],
            'thumbnail_url': thumbnail_url,
            'is_self': post.get('is_self', False),
            'flair': post.get('link_flair_text') or post.get('flair'),
            'posted_at': posted_at,
        })

    if not records:
        return 0

    try:
        response = supabase.table('reddit_posts').upsert(records, on_conflict='post_id').execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting Reddit posts: {e}")
        return 0


def sync_spotify_data(supabase: Client) -> Dict[str, Any]:
    """
    Sync Spotify new releases to the database.

    Args:
        supabase: Supabase client instance

    Returns:
        Dictionary with sync statistics
    """
    stats = {
        'releases_inserted': 0,
        'errors': []
    }

    try:
        access_token = get_spotify_access_token()
        if not access_token:
            stats['errors'].append("Failed to get Spotify access token")
            return stats
        result = fetch_spotify_new_releases(country='US', limit=50, access_token=access_token)
        if result and result.get('albums'):
            stats['releases_inserted'] = insert_spotify_releases(supabase, result['albums'])
    except Exception as e:
        stats['errors'].append(f"Error syncing Spotify data: {e}")

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
    if subreddits is None:
        subreddits = DEFAULT_SUBREDDITS

    stats = {
        'subreddits_processed': 0,
        'posts_inserted': 0,
        'errors': []
    }

    # Phase 1: Fetch all subreddits sequentially — 1 Reddit credential set means no
    # concurrent requests. Collect all posts first, then write once.
    all_posts: List[Dict] = []
    for subreddit in subreddits:
        try:
            posts = fetch_reddit_hot(subreddit=subreddit, limit=25)
            if posts:
                all_posts.extend(posts)
                stats['subreddits_processed'] += 1
        except Exception as e:
            stats['errors'].append(f"Error fetching r/{subreddit}: {e}")

    # Phase 2: Single batch upsert for all posts.
    if all_posts:
        stats['posts_inserted'] = insert_reddit_posts(supabase, all_posts)

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
