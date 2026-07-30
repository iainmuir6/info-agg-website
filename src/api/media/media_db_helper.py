# media_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: Helper functions to insert media data into Supabase database

from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from supabase import create_client, Client
from supabase import ClientOptions
import sys
import os

from dotenv import load_dotenv
load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import chunked_upsert

try:
    from .youtube import fetch_youtube_trending, get_youtube_api_key
except ImportError:
    from youtube import fetch_youtube_trending, get_youtube_api_key


def get_supabase_client() -> Client:
    """Create and return a Supabase client."""
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def insert_youtube_videos(
    supabase: Client, videos: List[Dict[str, Any]], errors: Optional[List[str]] = None
) -> int:
    """Batch-upsert trending videos, keyed on (video_id, region_code)."""
    if not videos:
        return 0

    records: List[Dict[str, Any]] = []
    seen: set = set()
    for v in videos:
        video_id = v.get('video_id')
        if not video_id:
            continue
        key = (video_id, v.get('region_code', 'US'))
        if key in seen:
            continue
        seen.add(key)
        records.append({
            'video_id': video_id,
            'title': v.get('title'),
            'channel_title': v.get('channel_title'),
            'channel_id': v.get('channel_id'),
            'description': v.get('description'),
            'category_id': v.get('category_id'),
            'thumbnail_url': v.get('thumbnail_url'),
            'published_at': v.get('published_at'),
            'view_count': v.get('view_count'),
            'like_count': v.get('like_count'),
            'comment_count': v.get('comment_count'),
            'duration': v.get('duration'),
            'region_code': v.get('region_code', 'US'),
            # Refreshed on every run so retention (which keys off fetched_at)
            # keeps rows that are still trending.
            'fetched_at': datetime.now(timezone.utc).isoformat(),
        })

    if not records:
        return 0

    return chunked_upsert(
        supabase, 'youtube_videos', records,
        on_conflict='video_id,region_code', errors=errors,
    )


def sync_youtube_data(supabase: Client, region_code: str = 'US', limit: int = 25) -> Dict[str, Any]:
    """Sync YouTube trending videos to the database."""
    stats: Dict[str, Any] = {'videos_inserted': 0, 'errors': []}

    # A missing key is a config gap, not a pipeline failure — flag it as a skip
    # so the run does not go red every day the secret is unset.
    if not get_youtube_api_key():
        stats['skipped'] = True
        stats['notes'] = ['YOUTUBE_API_KEY not set — YouTube fetch skipped']
        return stats

    try:
        videos = fetch_youtube_trending(region_code=region_code, limit=limit)
        if videos is None:
            stats['errors'].append('YouTube fetch returned nothing (missing key or API error)')
            return stats
        stats['videos_inserted'] = insert_youtube_videos(supabase, videos, errors=stats['errors'])
    except Exception as e:
        stats['errors'].append(f"Error syncing YouTube data: {e}")
    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing media data to database...")
    print("=" * 60)

    try:
        supabase = get_supabase_client()

        print("\n--- Syncing YouTube Data ---")
        youtube_stats = sync_youtube_data(supabase)
        print(f"\nYouTube Sync Complete:")
        print(f"  Videos inserted: {youtube_stats['videos_inserted']}")

        if youtube_stats.get('errors'):
            print(f"\nErrors encountered:")
            for error in youtube_stats['errors']:
                print(f"  - {error}")

    except Exception as e:
        print(f"Fatal error: {e}")
