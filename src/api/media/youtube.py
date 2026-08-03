# youtube.py
#
# Author: IM
# Company: Scouts Consulting Group
# Description: Fetches trending videos from the YouTube Data API v3.
#
# Unlike Reddit, this endpoint is served normally to datacenter IPs, so it
# works from CI. It needs a YOUTUBE_API_KEY (API key only — no OAuth).
# Quota: the videos.list "mostPopular" chart costs 1 unit per call against a
# 10,000 unit/day default, so a daily run is negligible.

from typing import List, Optional, Dict, Any
import os
import sys

from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import get_http_session, HTTP_TIMEOUT_SLOW

YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3"


def get_youtube_api_key() -> Optional[str]:
    return os.getenv('YOUTUBE_API_KEY')


def _to_int(value: Any) -> Optional[int]:
    """Counts arrive as strings, and are absent when the uploader hides them."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_youtube_trending(
    region_code: str = 'US',
    limit: int = 25,
    category_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch the most popular videos for a region.

    Args:
        region_code: ISO 3166-1 alpha-2 region (default 'US')
        limit: Videos to return (1-50)
        category_id: Optional YouTube category filter (e.g. '10' = Music)
        api_key: Overrides YOUTUBE_API_KEY

    Returns:
        List of video dicts, or None when the key is missing or the call fails.
    """
    api_key = api_key or get_youtube_api_key()
    if not api_key:
        print("YOUTUBE_API_KEY not set — skipping YouTube fetch")
        return None

    params = {
        'part': 'snippet,statistics,contentDetails',
        'chart': 'mostPopular',
        'regionCode': region_code,
        'maxResults': min(max(limit, 1), 50),
        'key': api_key,
    }
    if category_id:
        params['videoCategoryId'] = category_id

    try:
        response = get_http_session().get(
            f"{YOUTUBE_BASE_URL}/videos", params=params, timeout=HTTP_TIMEOUT_SLOW
        )
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"Error fetching YouTube trending: {e}")
        return None

    videos: List[Dict[str, Any]] = []
    for item in data.get('items', []):
        video_id = item.get('id')
        snippet = item.get('snippet', {}) or {}
        stats = item.get('statistics', {}) or {}
        details = item.get('contentDetails', {}) or {}
        if not video_id or not snippet.get('title'):
            continue

        # Prefer the largest thumbnail the response offers.
        thumbs = snippet.get('thumbnails', {}) or {}
        thumbnail_url = None
        for key in ('maxres', 'standard', 'high', 'medium', 'default'):
            if thumbs.get(key, {}).get('url'):
                thumbnail_url = thumbs[key]['url']
                break

        videos.append({
            'video_id': video_id,
            'title': snippet.get('title'),
            'channel_title': snippet.get('channelTitle'),
            'channel_id': snippet.get('channelId'),
            'description': (snippet.get('description') or '')[:2000] or None,
            'category_id': snippet.get('categoryId'),
            'thumbnail_url': thumbnail_url,
            'published_at': snippet.get('publishedAt'),
            'view_count': _to_int(stats.get('viewCount')),
            'like_count': _to_int(stats.get('likeCount')),
            'comment_count': _to_int(stats.get('commentCount')),
            'duration': details.get('duration'),
            'region_code': region_code,
        })

    return videos
