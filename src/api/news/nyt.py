# nyt.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches news data from the New York Times API
#       ---> Supports top stories by section and most-popular articles

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import requests
import threading
import os
import sys

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import (
    get_http_session, MinInterval,
    breaker, EndpointUnavailable, HTTP_TIMEOUT,
)

ROOT_DIR = os.getenv('ROOT_DIR')

# API base URLs
NYT_BASE_URL = "https://api.nytimes.com/svc"
# NYT Top Stories sections
ALL_NYT_SECTIONS = [
    'arts', 'automobiles', 'books', 'business', 'fashion', 'food',
    'health', 'home', 'insider', 'magazine', 'movies', 'nyregion',
    'obituaries', 'opinion', 'politics', 'realestate', 'science',
    'sports', 'sundayreview', 'technology', 'theater', 't-magazine',
    'travel', 'upshot', 'us', 'world'
]
NYT_SECTIONS = [
    'us', 'world', 'opinion', 'business', 'insider',
    'realestate', 'science', 'technology', 'arts',
    # 'sports', 'politics', 'movies', 'nyregion', 
]

# NYT Most Popular types
NYT_POPULAR_TYPES = ['viewed', 'shared', 'emailed']

# Enforce a simple >=1s minimum between any NYT HTTP calls in this module.
# This satisfies the “no endpoint burst in loops” requirement even when callers
# don't explicitly sleep. MinInterval sleeps outside its lock so concurrent
# callers are paced without being serialized.
_NYT_MIN_INTERVAL_S = 1.0
_NYT_LOCK = threading.Lock()  # guards the disabled-keys set and key labels
_nyt_pacer = MinInterval(_NYT_MIN_INTERVAL_S)

# If NYT returns 429 for a specific key, we stop using that key for the
# remainder of the current ETL run.
_NYT_DISABLED_KEYS: set[str] = set()


# Stable, non-revealing label per key for breaker/endpoint ids: the id shows up
# in log messages, so it must never carry any part of the key itself.
_NYT_KEY_LABELS: Dict[str, str] = {}


def _nyt_key_label(api_key: str) -> str:
    with _NYT_LOCK:
        if api_key not in _NYT_KEY_LABELS:
            _NYT_KEY_LABELS[api_key] = f"key{len(_NYT_KEY_LABELS) + 1}"
        return _NYT_KEY_LABELS[api_key]


def _nyt_min_interval() -> None:
    _nyt_pacer.wait()


def _nyt_is_key_disabled(api_key: str) -> bool:
    with _NYT_LOCK:
        return api_key in _NYT_DISABLED_KEYS


def _nyt_disable_key(api_key: str) -> None:
    with _NYT_LOCK:
        _NYT_DISABLED_KEYS.add(api_key)


# Public helpers for callers that want to react to key lockouts.
def is_nyt_key_disabled(api_key: str) -> bool:
    return _nyt_is_key_disabled(api_key)


def get_nyt_api_key() -> str:
    """
    Get New York Times API key from environment variables

    Returns:
        API key string
    """
    # Default to key 1 for daily switching/Archive backfill.
    api_key = os.getenv('NYT_API_KEY_1') or os.getenv('NYT_API_KEY')
    if not api_key:
        raise ValueError("NYT_API_KEY_1 not found in environment variables")
    return api_key


# ============================================================================
# NEW YORK TIMES API FUNCTIONS
# ============================================================================
def fetch_nyt_top_stories(
    section: str = 'home',
    api_key: Optional[str] = None,
    errors: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch top stories from New York Times by section

    Args:
        section: Section name (home, arts, business, technology, science, health, sports, world, etc.)
        api_key: Optional API key
        errors: Optional list the failure reason is appended to. Without it a
                failure is only printed, so the caller sees `None` and cannot
                tell "NYT is down" from "this section had no stories" — which
                is how a run that wrote 0 articles reached etl_runs with an
                empty `errors` array.

    Returns:
        Dictionary with top stories data
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    if api_key is None:
        api_key = get_nyt_api_key()

    url = f"{NYT_BASE_URL}/topstories/v2/{section}.json"
    params = {
        'api-key': api_key
    }

    endpoint = f'nyt:topstories:{_nyt_key_label(api_key)}'

    try:
        breaker.check(endpoint)
        _nyt_min_interval()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 404:
            # NYT's gateway intermittently 404s a section that exists and
            # answers 200 seconds later (observed live: `insider` 404'd inside
            # a run and returned 200 on three spaced retries right after). The
            # shared session does not retry 404 — normally correct, since a 404
            # is permanent — so retry once here, then let it fail for real.
            _nyt_min_interval()
            response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 429:
            # Handled by key rotation, not an endpoint fault — do not trip.
            _nyt_disable_key(api_key)
            _fail(f"NYT rate-limited (429) on top stories for {section}; "
                  f"key disabled for the rest of this run")
            return None
        response.raise_for_status()
        breaker.record_success(endpoint)
        data = response.json()

        # Check for API error
        if data.get('fault'):
            _fail(f"NYT API error for section {section}: "
                  f"{data.get('fault', {}).get('faultstring', 'Unknown error')}")
            return None

        articles = []
        results = data.get('results') or []

        for article in results:
            # Extract multimedia images
            images = []
            for media in article.get('multimedia') or []:
                images.append({
                    'url': media.get('url'),
                    'format': media.get('format'),
                    'height': media.get('height'),
                    'width': media.get('width'),
                    'type': media.get('type'),
                    'subtype': media.get('subtype'),
                    'caption': media.get('caption'),
                    'copyright': media.get('copyright')
                })

            articles.append({
                'section': section,
                'title': article.get('title'),
                'abstract': article.get('abstract'),
                'url': article.get('url'),
                'byline': article.get('byline'),
                'item_type': article.get('item_type'),
                'updated_date': article.get('updated_date'),
                'created_date': article.get('created_date'),
                'published_date': article.get('published_date'),
                'material_type_facet': article.get('material_type_facet'),
                'kicker': article.get('kicker'),
                'des_facet': article.get('des_facet', []),
                'org_facet': article.get('org_facet', []),
                'per_facet': article.get('per_facet', []),
                'geo_facet': article.get('geo_facet', []),
                'multimedia': images,
                'short_url': article.get('short_url'),
                'fetched_at': datetime.now().isoformat()
            })

        return {
            'section': section,
            'status': data.get('status'),
            'copyright': data.get('copyright'),
            'section_title': data.get('section'),
            'last_updated': data.get('last_updated'),
            'num_results': data.get('num_results'),
            'articles': articles,
            'fetched_at': datetime.now().isoformat()
        }

    except EndpointUnavailable as e:
        _fail(f"NYT top stories skipped for {section}: {e}")
        return None
    except requests.exceptions.RequestException as e:
        # Scoped per key: the sections are split across keys and worked by one
        # thread each, so a shared 'nyt:topstories' counter let three unlucky
        # blips spread over *both* workers trip the endpoint and skip every
        # remaining section — which is exactly how one run wrote 0 articles.
        breaker.record_failure(endpoint, e)
        _fail(f"Error fetching NYT top stories for section {section}: {e}")
        return None
    except Exception as e:
        _fail(f"Error parsing NYT top stories for section {section}: {e}")
        return None


def fetch_nyt_most_popular(
    type: str = 'viewed',
    period: int = 1,
    api_key: Optional[str] = None,
    errors: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch most popular articles from New York Times

    Args:
        type: Type of popularity (viewed, shared, emailed)
        period: Time period in days (1, 7, 30)
        api_key: Optional API key
        errors: Optional list the failure reason is appended to (see
                fetch_nyt_top_stories — same reason).

    Returns:
        Dictionary with most popular articles
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    if api_key is None:
        api_key = get_nyt_api_key()

    if type not in NYT_POPULAR_TYPES:
        raise ValueError(f"Type must be one of {NYT_POPULAR_TYPES}")

    url = f"{NYT_BASE_URL}/mostpopular/v2/{type}/{period}.json"
    params = {
        'api-key': api_key
    }

    try:
        _nyt_min_interval()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 429:
            _nyt_disable_key(api_key)
            _fail(f"NYT rate-limited (429) on most popular ({type}); "
                  f"key disabled for the rest of this run")
            return None
        response.raise_for_status()
        data = response.json()

        # Check for API error
        if data.get('fault'):
            _fail(f"NYT API error for most popular ({type}): "
                  f"{data.get('fault', {}).get('faultstring', 'Unknown error')}")
            return None

        articles = []
        results = data.get('results', [])

        for article in results:
            # Extract media
            media = []
            for media_item in article.get('media', []):
                media_metadata = media_item.get('media-metadata', [])
                media_images = []
                for img in media_metadata:
                    media_images.append({
                        'url': img.get('url'),
                        'format': img.get('format'),
                        'height': img.get('height'),
                        'width': img.get('width')
                    })

                media.append({
                    'type': media_item.get('type'),
                    'subtype': media_item.get('subtype'),
                    'caption': media_item.get('caption'),
                    'copyright': media_item.get('copyright'),
                    'approved_for_syndication': media_item.get('approved_for_syndication'),
                    'media_metadata': media_images
                })

            articles.append({
                'url': article.get('url'),
                'adx_keywords': article.get('adx_keywords'),
                'column': article.get('column'),
                'section': article.get('section'),
                'byline': article.get('byline'),
                'type': article.get('type'),
                'title': article.get('title'),
                'abstract': article.get('abstract'),
                'published_date': article.get('published_date'),
                'source': article.get('source'),
                'id': article.get('id'),
                'asset_id': article.get('asset_id'),
                'views': article.get('views', 0) if type == 'viewed' else None,
                'des_facet': article.get('des_facet', []),
                'org_facet': article.get('org_facet', []),
                'per_facet': article.get('per_facet', []),
                'geo_facet': article.get('geo_facet', []),
                'media': media,
                'uri': article.get('uri'),
                'fetched_at': datetime.now().isoformat()
            })

        return {
            'type': type,
            'period': period,
            'status': data.get('status'),
            'copyright': data.get('copyright'),
            'num_results': data.get('num_results'),
            'articles': articles,
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        _fail(f"Error fetching NYT most popular ({type}): {e}")
        return None
    except Exception as e:
        _fail(f"Error parsing NYT most popular ({type}): {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Fetching news data from New York Times API...")
    print("=" * 60)

    try:
        nyt_key = get_nyt_api_key()

        # Test fetching top stories
        print("\n--- Testing Top Stories (NYT) ---")
        top_stories = fetch_nyt_top_stories('technology', nyt_key)
        if top_stories:
            print(f"Section: {top_stories.get('section')}")
            print(f"Number of articles: {top_stories.get('num_results')}")
            for article in top_stories.get('articles', [])[:3]:  # Show first 3
                print(f"  - {article.get('title')}")
                print(f"    Published: {article.get('published_date')}")

        # Test fetching most popular
        print("\n--- Testing Most Popular (NYT) ---")
        popular = fetch_nyt_most_popular('viewed', period=1, api_key=nyt_key)
        if popular:
            print(f"Type: {popular.get('type')}")
            print(f"Period: {popular.get('period')} day(s)")
            print(f"Number of articles: {popular.get('num_results')}")
            for article in popular.get('articles', [])[:3]:  # Show first 3
                print(f"  - {article.get('title')}")
                if article.get('views'):
                    print(f"    Views: {article.get('views')}")
                    
    except ValueError as e:
        print(f"Configuration error: {e}")
    except Exception as e:
        print(f"Error: {e}")
