# reddit.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches hot posts from the Reddit API (OAuth when credentials
#              are present, falling back to the public JSON endpoint)

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
REDDIT_OAUTH_URL = "https://oauth.reddit.com"
REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"

# Reddit blocks the public *.json endpoints from datacenter IPs, which is
# where CI runs — every scheduled run logged "Reddit 403/429" and wrote zero
# posts. An OAuth app token is accepted from those IPs, so use it whenever
# credentials are configured and keep the anonymous path for local runs.
USER_AGENT = os.getenv(
    'REDDIT_USER_AGENT',
    'python:com.iainmuir.infoagg:v1.1 (by /u/ValuableJuice8310)',
)

_ACCESS_TOKEN: Optional[str] = None
_TOKEN_FAILED: bool = False


def get_reddit_access_token() -> Optional[str]:
    """Client-credentials token, cached for the life of the process.

    Returns None when credentials are absent or the exchange fails, in which
    case callers fall back to the public endpoint.
    """
    global _ACCESS_TOKEN, _TOKEN_FAILED
    if _ACCESS_TOKEN or _TOKEN_FAILED:
        return _ACCESS_TOKEN

    client_id = os.getenv('REDDIT_CLIENT_ID')
    client_secret = os.getenv('REDDIT_CLIENT_SECRET')
    if not client_id or not client_secret:
        _TOKEN_FAILED = True
        return None

    try:
        response = requests.post(
            REDDIT_TOKEN_URL,
            auth=(client_id, client_secret),
            data={'grant_type': 'client_credentials'},
            headers={'User-Agent': USER_AGENT},
            timeout=10,
        )
        response.raise_for_status()
        _ACCESS_TOKEN = response.json().get('access_token')
        if not _ACCESS_TOKEN:
            _TOKEN_FAILED = True
        return _ACCESS_TOKEN
    except Exception as e:
        print(f"Reddit OAuth token request failed: {e}")
        _TOKEN_FAILED = True
        return None


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
    token = get_reddit_access_token()
    if token:
        url = f"{REDDIT_OAUTH_URL}/r/{subreddit}/hot"
        headers = {'User-Agent': USER_AGENT, 'Authorization': f'bearer {token}'}
    else:
        url = f"{REDDIT_BASE_URL}/r/{subreddit}/hot.json"
        headers = {'User-Agent': USER_AGENT}
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
