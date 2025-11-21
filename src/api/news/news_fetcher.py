# news_fetcher.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Fetches news data from New York Times API and other sources
#       ---> Supports top stories, article search, most popular, and more

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import requests
import os

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

# API base URLs
NYT_BASE_URL = "https://api.nytimes.com/svc"
NEWS_API_BASE_URL = "https://newsapi.org/v2"

# NYT Top Stories sections
NYT_SECTIONS = [
    'arts', 'automobiles', 'books', 'business', 'fashion', 'food',
    'health', 'home', 'insider', 'magazine', 'movies', 'nyregion',
    'obituaries', 'opinion', 'politics', 'realestate', 'science',
    'sports', 'sundayreview', 'technology', 'theater', 't-magazine',
    'travel', 'upshot', 'us', 'world'
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


def get_news_api_key() -> str:
    """
    Get NewsAPI key from environment variables
    
    Returns:
        API key string
    """
    api_key = os.getenv('NEWS_API_KEY')
    if not api_key:
        raise ValueError("NEWS_API_KEY not found in environment variables")
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
        results = data.get('results', [])
        
        for article in results:
            # Extract multimedia images
            images = []
            for media in article.get('multimedia', []):
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
