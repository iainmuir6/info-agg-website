# news_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: Helper functions to insert news data into Supabase database

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions
import os
from dotenv import load_dotenv

load_dotenv()


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
    Insert NYT article records into the news_articles table.

    Args:
        supabase: Supabase client instance
        articles: List of article dicts (from fetch_nyt_top_stories or fetch_nyt_most_popular)
        source_type: 'top_stories' or 'most_popular'

    Returns:
        Number of articles inserted/updated
    """
    if not articles:
        return 0

    inserted_count = 0

    for article in articles:
        try:
            if source_type == 'top_stories':
                image_url = _extract_nyt_image(article)
                published_at = article.get('published_date') or article.get('created_date')
            else:
                image_url = _extract_nyt_popular_image(article)
                published_at = article.get('published_date')

            insert_data = {
                'source': 'nyt',
                'section': article.get('section'),
                'title': article.get('title'),
                'abstract': article.get('abstract'),
                'byline': article.get('byline'),
                'url': article.get('url'),
                'image_url': image_url,
                'published_at': published_at,
            }

            if not insert_data.get('url') or not insert_data.get('title'):
                continue

            response = supabase.table('news_articles').upsert(
                insert_data,
                on_conflict='url'
            ).execute()

            if response.data:
                inserted_count += 1

        except Exception as e:
            print(f"Error inserting NYT article '{article.get('title', 'unknown')}': {e}")

    return inserted_count



def sync_nyt_data(supabase: Client, sections: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Sync NYT top stories for given sections to the database.

    Args:
        supabase: Supabase client instance
        sections: List of NYT sections to fetch (defaults to key sections)

    Returns:
        Dictionary with sync statistics
    """
    try:
        from .nyt import fetch_nyt_top_stories, fetch_nyt_most_popular
    except ImportError:
        import sys
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from nyt import fetch_nyt_top_stories, fetch_nyt_most_popular

    if sections is None:
        sections = ['home', 'technology', 'business', 'science', 'health', 'sports', 'arts', 'world', 'politics', 'us']

    stats = {
        'sections_processed': 0,
        'articles_inserted': 0,
        'errors': []
    }

    def _fetch_section(section: str) -> tuple:
        print(f"Fetching NYT top stories for section: {section}...")
        result = fetch_nyt_top_stories(section=section)
        count = 0
        if result and result.get('articles'):
            count = insert_nyt_articles(supabase, result['articles'], source_type='top_stories')
            print(f"  Inserted {count} articles for '{section}'")
        return section, count

    with ThreadPoolExecutor(max_workers=len(sections)) as executor:
        futures = {executor.submit(_fetch_section, s): s for s in sections}
        for future in as_completed(futures):
            section = futures[future]
            try:
                _, count = future.result()
                stats['articles_inserted'] += count
                stats['sections_processed'] += 1
            except Exception as e:
                error_msg = f"Error fetching NYT section '{section}': {e}"
                stats['errors'].append(error_msg)
                print(error_msg)

    # Fetch most popular (viewed over 7 days)
    try:
        print("Fetching NYT most popular (7-day viewed)...")
        popular = fetch_nyt_most_popular(type='viewed', period=7)
        if popular and popular.get('articles'):
            count = insert_nyt_articles(supabase, popular['articles'], source_type='most_popular')
            stats['articles_inserted'] += count
            print(f"  Inserted {count} most-popular articles")
    except Exception as e:
        stats['errors'].append(f"Error fetching NYT most popular: {e}")

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
    try:
        from .nyt import fetch_nyt_archive, NYT_SECTIONS
    except ImportError:
        import sys
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from nyt import fetch_nyt_archive, NYT_SECTIONS

    from datetime import datetime, timedelta, timezone

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
