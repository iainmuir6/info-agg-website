# reddit.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches hot posts from the Reddit API (unauthenticated)

from typing import List, Optional, Dict, Any
from datetime import datetime
import requests
import os
import sys

from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import get_http_session

REDDIT_BASE_URL = "https://www.reddit.com"


class RedditRateLimited(RuntimeError):
    pass


_REDDIT_DISABLED_DUE_TO_429: bool = False


def fetch_reddit_hot(subreddit: str = 'all', limit: int = 25) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch hot posts from a subreddit.

    Args:
        subreddit: Subreddit name (default: 'all')
        limit: Number of posts to fetch (max 100)

    Returns:
        List of post dicts, or None on error
    """
    url = f"{REDDIT_BASE_URL}/r/{subreddit}/hot.json"
    headers = {'User-Agent': 'python:com.iainmuir.infoagg:v1.0 (by /u/ValuableJuice8310)'}
    params = {'limit': min(limit, 100)}
    global _REDDIT_DISABLED_DUE_TO_429

    try:
        if _REDDIT_DISABLED_DUE_TO_429:
            raise RedditRateLimited("Reddit disabled due to a rate/blocked response in this ETL run")
        response = get_http_session().get(url, headers=headers, params=params, timeout=10)
        if response.status_code in (403, 429):
            _REDDIT_DISABLED_DUE_TO_429 = True
            reason = "403 blocked" if response.status_code == 403 else "429 rate-limited"
            raise RedditRateLimited(f"Reddit {reason}; stopping remaining subreddits")
        response.raise_for_status()
        data = response.json()

        posts = []
        for post in data.get('data', {}).get('children', []):
            post_data = post.get('data', {})
            posts.append({
                'post_id': post_data.get('id'),
                'title': post_data.get('title'),
                'subreddit': post_data.get('subreddit'),
                'author': post_data.get('author'),
                'score': post_data.get('score'),
                'upvote_ratio': post_data.get('upvote_ratio'),
                'num_comments': post_data.get('num_comments'),
                'url': post_data.get('url'),
                'permalink': f"https://www.reddit.com{post_data.get('permalink', '')}",
                'created_utc': post_data.get('created_utc'),
                'thumbnail': post_data.get('thumbnail'),
                'selftext': post_data.get('selftext'),
                'is_self': post_data.get('is_self'),
                'is_video': post_data.get('is_video'),
                'over_18': post_data.get('over_18'),
                'link_flair_text': post_data.get('link_flair_text'),
                'fetched_at': datetime.now().isoformat()
            })

        return posts

    except RedditRateLimited:
        raise  # always propagate — never let except Exception swallow it
    except requests.exceptions.RequestException as e:
        msg = str(e)
        if ("403" in msg and "Client Error" in msg) or ("Blocked for url" in msg):
            _REDDIT_DISABLED_DUE_TO_429 = True
            raise RedditRateLimited("Reddit blocked (403) in this ETL run; stopping remaining subreddits")
        print(f"Error fetching r/{subreddit}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing r/{subreddit} response: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Reddit API")
    print("=" * 60)

    posts = fetch_reddit_hot('all', limit=5)
    if posts:
        print(f"Found {len(posts)} posts")
        for post in posts[:3]:
            print(f"  - {post['title']} (r/{post['subreddit']}, score={post['score']})")
