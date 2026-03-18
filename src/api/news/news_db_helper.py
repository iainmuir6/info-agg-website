# news_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: Helper functions to insert news data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions
from datetime import datetime, timedelta, timezone
import os
import sys
import time
from dotenv import load_dotenv

load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from .nyt import (
        fetch_nyt_top_stories,
        fetch_nyt_most_popular,
        fetch_nyt_archive,
        NYT_SECTIONS,
    )
except ImportError:
    from nyt import (
        fetch_nyt_top_stories,
        fetch_nyt_most_popular,
        fetch_nyt_archive,
        NYT_SECTIONS,
    )


def get_supabase_client() -> Client:
    """Create and return a Supabase client."""
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def _extract_nyt_image(article: Dict[str, Any]) -> Optional[str]:
    """Extract the best available image URL from a NYT article."""
    multimedia = article.get('multimedia') or []
    if not multimedia:
        return None
    # Prefer 'mediumThreeByTwo440' or first available
    for fmt in ['mediumThreeByTwo440', 'mediumThreeByTwo210', 'Normal', 'Large']:
        for m in multimedia:
            if m.get('format') == fmt and m.get('url'):
                return m['url']
    # Fallback to first image URL
    for m in multimedia:
        if m.get('url'):
            return m['url']
    return None


def _extract_nyt_popular_image(article: Dict[str, Any]) -> Optional[str]:
    """Extract image URL from a NYT most-popular article."""
    media_list = article.get('media', [])
    for media in media_list:
        metadata = media.get('media_metadata', [])
        if metadata:
            # Pick largest available
            for m in reversed(metadata):
                if m.get('url'):
                    return m['url']
    return None


def insert_nyt_articles(supabase: Client, articles: List[Dict[str, Any]], source_type: str = 'top_stories') -> int:
    """
    Batch-upsert NYT article records into the news_articles table (single DB round-trip).

    Args:
        supabase: Supabase client instance
        articles: List of article dicts (from fetch_nyt_top_stories or fetch_nyt_most_popular)
        source_type: 'top_stories' or 'most_popular'

    Returns:
        Number of articles inserted/updated
    """
    if not articles:
        return 0

    records = []
    for article in articles:
        if source_type == 'top_stories':
            image_url = _extract_nyt_image(article)
            published_at = article.get('published_date') or article.get('created_date')
        else:
            image_url = _extract_nyt_popular_image(article)
            published_at = article.get('published_date')

        url = article.get('url')
        title = article.get('title')
        if not url or not title:
            continue

        records.append({
            'source': 'nyt',
            'section': article.get('section'),
            'title': title,
            'abstract': article.get('abstract'),
            'byline': article.get('byline'),
            'url': url,
            'image_url': image_url,
            'published_at': published_at,
        })

    if not records:
        return 0

    # Deduplicate by URL — same article can appear in multiple sections; the batch upsert
    # will error if the same URL appears twice in a single command.
    seen: set = set()
    deduped = []
    for r in records:
        if r['url'] not in seen:
            seen.add(r['url'])
            deduped.append(r)

    try:
        response = supabase.table('news_articles').upsert(deduped, on_conflict='url').execute()
        return len(response.data) if response.data else 0
    except Exception as e:
        print(f"Error batch-upserting NYT articles: {e}")
        return 0



def sync_nyt_data(supabase: Client, sections: List[str]) -> Dict[str, Any]:
    """
    Sync NYT top stories for given sections to the database.

    Args:
        supabase: Supabase client instance
        sections: List of NYT sections to fetch (defaults to key sections)

    Returns:
        Dictionary with sync statistics
    """
    stats = {
        'sections_processed': 0,
        'articles_inserted': 0,
        'errors': []
    }

    # Phase 1: Fetch all sections sequentially — 1 NYT key means no concurrent requests.
    top_stories_articles: List[Dict] = []
    popular_articles: List[Dict] = []

    for section in sections:
        try:
            result = fetch_nyt_top_stories(section=section)
            if result and result.get('articles'):
                top_stories_articles.extend(result['articles'])
            stats['sections_processed'] += 1
        except Exception as e:
            stats['errors'].append(f"Error fetching NYT section '{section}': {e}")
        time.sleep(1.1)

    try:
        popular = fetch_nyt_most_popular(type='viewed', period=7)
        if popular and popular.get('articles'):
            popular_articles = popular['articles']
    except Exception as e:
        stats['errors'].append(f"Error fetching NYT most popular: {e}")

    # Phase 2: Single batch upsert per article type.
    if top_stories_articles:
        stats['articles_inserted'] += insert_nyt_articles(supabase, top_stories_articles, source_type='top_stories')
    if popular_articles:
        stats['articles_inserted'] += insert_nyt_articles(supabase, popular_articles, source_type='most_popular')

    return stats


def backfill_nyt_archive(
    supabase: Client,
    days_back: int = 30,
) -> Dict[str, Any]:
    """
    Backfill news_articles using the NYT Archive API.

    Fetches all calendar months that overlap the last `days_back` days,
    filters to articles since the cutoff date and to NYT_SECTIONS, then upserts.

    Args:
        supabase: Supabase client instance
        days_back: Number of days back from today to include (default 30)

    Returns:
        Stats dict: months_fetched, articles_inserted, errors
    """
    stats: Dict[str, Any] = {
        'months_fetched': 0,
        'articles_inserted': 0,
        'errors': [],
    }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    since_date = cutoff.strftime('%Y-%m-%d')

    # Collect unique (year, month) pairs that overlap the window
    months: list = []
    cursor = cutoff.replace(day=1)
    today = datetime.now(timezone.utc)
    while cursor <= today:
        months.append((cursor.year, cursor.month))
        # Advance to first of next month
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)

    for year, month in months:
        try:
            print(f"  Fetching NYT archive {year}/{month:02d} (since {since_date})...")
            articles = fetch_nyt_archive(
                year=year,
                month=month,
                sections=NYT_SECTIONS,
                since_date=since_date,
                max_per_section_per_day=5,
            )
            if articles:
                # Archive articles are already shaped for insert_nyt_articles; use source_type sentinel
                inserted = 0
                for article in articles:
                    try:
                        response = supabase.table('news_articles').upsert(
                            article, on_conflict='url'
                        ).execute()
                        if response.data:
                            inserted += 1
                    except Exception as e:
                        print(f"    Error upserting '{article.get('title', '')[:50]}': {e}")
                stats['articles_inserted'] += inserted
                print(f"    Inserted {inserted}/{len(articles)} articles")
            stats['months_fetched'] += 1
        except Exception as e:
            msg = f"Error processing NYT archive {year}/{month}: {e}"
            stats['errors'].append(msg)
            print(msg)

    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing news data to database...")
    print("=" * 60)

    try:
        supabase = get_supabase_client()

        print("\n--- Syncing NYT Data ---")
        nyt_stats = sync_nyt_data(supabase)
        print(f"\nNYT Sync Complete:")
        print(f"  Sections processed: {nyt_stats['sections_processed']}")
        print(f"  Articles inserted: {nyt_stats['articles_inserted']}")

        if nyt_stats.get('errors'):
            print(f"\nErrors encountered:")
            for error in nyt_stats['errors']:
                print(f"  - {error}")

    except Exception as e:
        print(f"Fatal error: {e}")
