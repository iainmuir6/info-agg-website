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
import os

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

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
    'arts', 'business', 'opinion', 'politics', 'realestate', 
    'science', 'sports', 'technology', 'us', 'world'
]

# NYT Most Popular types
NYT_POPULAR_TYPES = ['viewed', 'shared', 'emailed']


def get_nyt_api_key() -> str:
    """
    Get New York Times API key from environment variables

    Returns:
        API key string
    """
    api_key = os.getenv('NYT_API_KEY')
    if not api_key:
        raise ValueError("NYT_API_KEY not found in environment variables")
    return api_key


# ============================================================================
# NEW YORK TIMES API FUNCTIONS
# ============================================================================

def fetch_nyt_top_stories(section: str = 'home', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch top stories from New York Times by section

    Args:
        section: Section name (home, arts, business, technology, science, health, sports, world, etc.)
        api_key: Optional API key

    Returns:
        Dictionary with top stories data
    """
    if api_key is None:
        api_key = get_nyt_api_key()

    url = f"{NYT_BASE_URL}/topstories/v2/{section}.json"
    params = {
        'api-key': api_key
    }

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Check for API error
        if data.get('fault'):
            print(f"NYT API error: {data.get('fault', {}).get('faultstring', 'Unknown error')}")
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

    except requests.exceptions.RequestException as e:
        print(f"Error fetching NYT top stories for section {section}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing NYT top stories for section {section}: {e}")
        return None


def fetch_nyt_most_popular(
    type: str = 'viewed',
    period: int = 1,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch most popular articles from New York Times

    Args:
        type: Type of popularity (viewed, shared, emailed)
        period: Time period in days (1, 7, 30)
        api_key: Optional API key

    Returns:
        Dictionary with most popular articles
    """
    if api_key is None:
        api_key = get_nyt_api_key()

    if type not in NYT_POPULAR_TYPES:
        raise ValueError(f"Type must be one of {NYT_POPULAR_TYPES}")

    url = f"{NYT_BASE_URL}/mostpopular/v2/{type}/{period}.json"
    params = {
        'api-key': api_key
    }

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Check for API error
        if data.get('fault'):
            print(f"NYT API error: {data.get('fault', {}).get('faultstring', 'Unknown error')}")
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
        print(f"Error fetching NYT most popular ({type}): {e}")
        return None
    except Exception as e:
        print(f"Error parsing NYT most popular ({type}): {e}")
        return None


def fetch_nyt_archive(
    year: int,
    month: int,
    sections: Optional[List[str]] = None,
    since_date: Optional[str] = None,
    max_per_section_per_day: int = 5,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch articles for a given year/month from the NYT Archive API.

    Args:
        year: e.g. 2026
        month: 1–12
        sections: Slug list to include (defaults to NYT_SECTIONS). Filters on
                  section_name from the archive response.
        since_date: ISO date string 'YYYY-MM-DD'; articles before this date are dropped.
        max_per_section_per_day: Cap on articles per section per calendar day (approximates
                                  "most popular" since archive has no popularity signal).
        api_key: Optional NYT API key.

    Returns:
        List of article dicts shaped to match insert_nyt_articles() expectations.
    """
    if api_key is None:
        api_key = get_nyt_api_key()
    if sections is None:
        sections = NYT_SECTIONS

    # Map archive section_name (title-case) → our slugs
    _SECTION_MAP: Dict[str, str] = {
        'arts': 'arts',
        'books': 'arts',
        'business': 'business',
        'business day': 'business',
        'dealbook': 'business',
        'opinion': 'opinion',
        'editorial': 'opinion',
        'politics': 'politics',
        'real estate': 'realestate',
        'science': 'science',
        'health': 'science',
        'sports': 'sports',
        'technology': 'technology',
        'u.s.': 'us',
        'us': 'us',
        'national': 'us',
        'world': 'world',
        'international': 'world',
    }
    target_sections = set(sections)

    url = f"{NYT_BASE_URL}/archive/v1/{year}/{month}.json"
    params = {'api-key': api_key}

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching NYT archive {year}/{month}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing NYT archive {year}/{month}: {e}")
        return []

    docs = data.get('response', {}).get('docs', [])

    # Group by (section_slug, date_str) for per-section-per-day cap
    from collections import defaultdict
    bucket: Dict[str, int] = defaultdict(int)
    articles = []

    for doc in docs:
        pub_date = doc.get('pub_date', '')  # ISO: '2026-02-10T12:00:00+0000'
        date_str = pub_date[:10] if pub_date else ''

        if since_date and date_str < since_date:
            continue
        if doc.get('document_type') != 'article':
            continue

        raw_section = (doc.get('section_name') or '').lower().strip()
        slug = _SECTION_MAP.get(raw_section)
        if slug not in target_sections:
            continue

        bucket_key = f"{slug}:{date_str}"
        if bucket[bucket_key] >= max_per_section_per_day:
            continue
        bucket[bucket_key] += 1

        # Extract best image — archive multimedia URLs may be relative
        image_url = None
        for m in doc.get('multimedia') or []:
            if m.get('type') == 'image':
                raw_url = m.get('url', '')
                image_url = (
                    raw_url if raw_url.startswith('http')
                    else f"https://static01.nyt.com/{raw_url.lstrip('/')}"
                )
                break

        headline = doc.get('headline') or {}
        byline = doc.get('byline') or {}

        articles.append({
            'source': 'nyt',
            'section': slug,
            'title': headline.get('main') or headline.get('print_headline'),
            'abstract': doc.get('abstract') or doc.get('snippet'),
            'byline': byline.get('original'),
            'url': doc.get('web_url'),
            'image_url': image_url,
            'published_at': pub_date,
        })

    return articles


def fetch_all_nyt_top_stories(api_key: Optional[str] = None) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Fetch top stories from all NYT sections

    Args:
        api_key: Optional API key

    Returns:
        Dictionary mapping section to top stories data
    """
    if api_key is None:
        api_key = get_nyt_api_key()

    all_stories = {}

    for section in NYT_SECTIONS:
        print(f"Fetching top stories for section: {section}...")
        stories = fetch_nyt_top_stories(section, api_key)
        all_stories[section] = stories
        # Small delay to respect rate limits
        import time
        time.sleep(0.1)

    return all_stories


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
