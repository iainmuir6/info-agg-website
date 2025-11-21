# markets_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Helper functions to insert market data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()


def get_supabase_client() -> Client:
    """
    Create and return a Supabase client
    
    Returns:
        Supabase client instance
    """
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables")
    
    return create_client(supabase_url, supabase_key)


def get_or_create_stock(supabase: Client, ticker: str, profile_data: Optional[Dict[str, Any]] = None) -> Optional[int]:
    """
    Get stock ID, creating the stock record if it doesn't exist
    
    Args:
        supabase: Supabase client instance
        ticker: Stock ticker symbol
        profile_data: Optional company profile data to insert/update
    
    Returns:
        Stock ID if found/created, None otherwise
    """
    try:
        # Try to get existing stock
        response = supabase.table('stocks').select('id').eq('ticker', ticker).single().execute()
        stock_id = response.data.get('id') if response.data else None
        
        if stock_id:
            # Update if profile data provided
            if profile_data:
                update_data = {
                    'name': profile_data.get('name'),
                    'country': profile_data.get('country'),
                    'currency': profile_data.get('currency'),
                    'exchange': profile_data.get('exchange'),
                    'ipo_date': profile_data.get('ipo_date'),
                    'market_cap': profile_data.get('market_cap'),
                    'share_outstanding': profile_data.get('share_outstanding'),
                    'logo_url': profile_data.get('logo'),
                    'website': profile_data.get('website'),
                    'industry': profile_data.get('industry')
                }
                # Remove None values
                update_data = {k: v for k, v in update_data.items() if v is not None}
                supabase.table('stocks').update(update_data).eq('id', stock_id).execute()
            
            return stock_id
        else:
            # Create new stock
            insert_data = {
                'ticker': ticker,
                'name': profile_data.get('name') if profile_data else None,
                'country': profile_data.get('country') if profile_data else None,
                'currency': profile_data.get('currency') if profile_data else None,
                'exchange': profile_data.get('exchange') if profile_data else None,
                'ipo_date': profile_data.get('ipo_date') if profile_data else None,
                'market_cap': profile_data.get('market_cap') if profile_data else None,
                'share_outstanding': profile_data.get('share_outstanding') if profile_data else None,
                'logo_url': profile_data.get('logo') if profile_data else None,
                'website': profile_data.get('website') if profile_data else None,
                'industry': profile_data.get('industry') if profile_data else None
            }
            # Remove None values
            insert_data = {k: v for k, v in insert_data.items() if v is not None}
            
            response = supabase.table('stocks').insert(insert_data).execute()
            return response.data[0].get('id') if response.data else None
            
    except Exception as e:
        print(f"Error getting/creating stock for {ticker}: {e}")
        return None


def insert_stock_quote(supabase: Client, stock_id: int, quote_data: Dict[str, Any]) -> bool:
    """
    Insert stock quote data
    
    Args:
        supabase: Supabase client instance
        stock_id: Stock ID from stocks table
        quote_data: Quote data dictionary from fetch_stock_quote()
    
    Returns:
        True if successful, False otherwise
    """
    try:
        insert_data = {
            'stock_id': stock_id,
            'current_price': quote_data.get('current_price'),
            'change_amount': quote_data.get('change'),
            'percent_change': quote_data.get('percent_change'),
            'high_price': quote_data.get('high_price'),
            'low_price': quote_data.get('low_price'),
            'open_price': quote_data.get('open_price'),
            'previous_close': quote_data.get('previous_close'),
            'quote_timestamp': quote_data.get('timestamp')
        }
        
        # Use upsert to handle duplicates
        response = supabase.table('stock_quotes').upsert(
            insert_data,
            on_conflict='stock_id,quote_timestamp'
        ).execute()
        
        return response.data is not None
        
    except Exception as e:
        print(f"Error inserting stock quote: {e}")
        return False


def insert_stock_candles(supabase: Client, stock_id: int, candles_data: Dict[str, Any]) -> int:
    """
    Insert stock candle data
    
    Args:
        supabase: Supabase client instance
        stock_id: Stock ID from stocks table
        candles_data: Candles data dictionary from fetch_stock_candles()
    
    Returns:
        Number of candles inserted
    """
    if not candles_data or not candles_data.get('timestamps'):
        return 0
    
    inserted_count = 0
    timestamps = candles_data.get('timestamps', [])
    opens = candles_data.get('open', [])
    highs = candles_data.get('high', [])
    lows = candles_data.get('low', [])
    closes = candles_data.get('close', [])
    volumes = candles_data.get('volume', [])
    resolution = candles_data.get('resolution', 'D')
    
    # Prepare batch insert data
    batch_data = []
    for i, timestamp in enumerate(timestamps):
        if i < len(opens) and i < len(highs) and i < len(lows) and i < len(closes):
            batch_data.append({
                'stock_id': stock_id,
                'resolution': resolution,
                'candle_timestamp': timestamp,
                'open_price': opens[i] if i < len(opens) else None,
                'high_price': highs[i] if i < len(highs) else None,
                'low_price': lows[i] if i < len(lows) else None,
                'close_price': closes[i] if i < len(closes) else None,
                'volume': volumes[i] if i < len(volumes) else None
            })
    
    if not batch_data:
        return 0
    
    try:
        # Insert in batches to avoid overwhelming the database
        batch_size = 100
        for i in range(0, len(batch_data), batch_size):
            batch = batch_data[i:i + batch_size]
            response = supabase.table('stock_candles').upsert(
                batch,
                on_conflict='stock_id,resolution,candle_timestamp'
            ).execute()
            inserted_count += len(batch)
        
        return inserted_count
        
    except Exception as e:
        print(f"Error inserting stock candles: {e}")
        return 0


def insert_company_news(supabase: Client, stock_id: int, articles: List[Dict[str, Any]]) -> int:
    """
    Insert company news articles
    
    Args:
        supabase: Supabase client instance
        stock_id: Stock ID from stocks table
        articles: List of article dictionaries from fetch_company_news()
    
    Returns:
        Number of articles inserted
    """
    if not articles:
        return 0
    
    inserted_count = 0
    
    for article in articles:
        try:
            insert_data = {
                'stock_id': stock_id,
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image_url'),
                'source': article.get('source'),
                'published_at': article.get('published_at'),
                'related_tickers': article.get('related_tickers', [])
            }
            
            # Use upsert to handle duplicates (based on URL)
            response = supabase.table('company_news').upsert(
                insert_data,
                on_conflict='url'
            ).execute()
            
            if response.data:
                inserted_count += 1
                
        except Exception as e:
            print(f"Error inserting company news article: {e}")
    
    return inserted_count


def insert_market_news(supabase: Client, articles: List[Dict[str, Any]]) -> int:
    """
    Insert market news articles
    
    Args:
        supabase: Supabase client instance
        articles: List of article dictionaries from fetch_market_news()
    
    Returns:
        Number of articles inserted
    """
    if not articles:
        return 0
    
    inserted_count = 0
    
    for article in articles:
        try:
            insert_data = {
                'category': article.get('category'),
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image_url'),
                'source': article.get('source'),
                'published_at': article.get('published_at'),
                'related_tickers': article.get('related_tickers', [])
            }
            
            # Use upsert to handle duplicates (based on URL)
            response = supabase.table('market_news').upsert(
                insert_data,
                on_conflict='url'
            ).execute()
            
            if response.data:
                inserted_count += 1
                
        except Exception as e:
            print(f"Error inserting market news article: {e}")
    
    return inserted_count


def sync_stock_data(
    supabase: Client,
    ticker: str,
    fetch_quotes: bool = True,
    fetch_candles: bool = True,
    fetch_news: bool = True,
    fetch_profile: bool = True
) -> Dict[str, Any]:
    """
    Sync all data for a specific stock
    
    Args:
        supabase: Supabase client instance
        ticker: Stock ticker symbol
        fetch_quotes: Whether to fetch and insert quotes
        fetch_candles: Whether to fetch and insert candles
        fetch_news: Whether to fetch and insert company news
        fetch_profile: Whether to fetch and insert company profile
    
    Returns:
        Dictionary with sync statistics
    """
    # Import from markets_fetcher module
    try:
        from .markets_fetcher import (
            fetch_stock_quote, fetch_stock_candles, fetch_company_profile,
            fetch_company_news, get_api_key
        )
    except ImportError:
        # Fallback for when running as standalone script
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from markets_fetcher import (
            fetch_stock_quote, fetch_stock_candles, fetch_company_profile,
            fetch_company_news, get_api_key
        )
    
    stats = {
        'ticker': ticker,
        'profile_updated': False,
        'quotes_inserted': 0,
        'candles_inserted': 0,
        'news_inserted': 0,
        'errors': []
    }
    
    try:
        api_key = get_api_key()
        
        # Fetch and insert profile
        if fetch_profile:
            print(f"Fetching profile for {ticker}...")
            profile = fetch_company_profile(ticker, api_key)
            if profile:
                stock_id = get_or_create_stock(supabase, ticker, profile)
                if stock_id:
                    stats['profile_updated'] = True
            else:
                # Still create stock record even if profile fetch fails
                stock_id = get_or_create_stock(supabase, ticker)
        else:
            stock_id = get_or_create_stock(supabase, ticker)
        
        if not stock_id:
            stats['errors'].append(f"Failed to get/create stock for {ticker}")
            return stats
        
        # Fetch and insert quote
        if fetch_quotes:
            print(f"Fetching quote for {ticker}...")
            quote = fetch_stock_quote(ticker, api_key)
            if quote:
                if insert_stock_quote(supabase, stock_id, quote):
                    stats['quotes_inserted'] = 1
        
        # Fetch and insert candles
        if fetch_candles:
            print(f"Fetching candles for {ticker}...")
            candles = fetch_stock_candles(ticker, resolution='D', days_back=365, api_key=api_key)
            if candles:
                count = insert_stock_candles(supabase, stock_id, candles)
                stats['candles_inserted'] = count
                print(f"  Inserted {count} candles")
        
        # Fetch and insert company news
        if fetch_news:
            print(f"Fetching company news for {ticker}...")
            news = fetch_company_news(ticker, days_back=7, api_key=api_key)
            if news:
                count = insert_company_news(supabase, stock_id, news)
                stats['news_inserted'] = count
                print(f"  Inserted {count} news articles")
        
    except Exception as e:
        error_msg = f"Error syncing data for {ticker}: {e}"
        stats['errors'].append(error_msg)
        print(error_msg)
    
    return stats


def sync_market_news(supabase: Client, categories: List[str] = ['general'], api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Sync market news for specified categories
    
    Args:
        supabase: Supabase client instance
        categories: List of news categories to fetch
        api_key: Optional API key
    
    Returns:
        Dictionary with sync statistics
    """
    try:
        from .markets_fetcher import fetch_market_news, get_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from markets_fetcher import fetch_market_news, get_api_key
    
    if api_key is None:
        api_key = get_api_key()
    
    stats = {
        'categories_processed': 0,
        'articles_inserted': 0,
        'errors': []
    }
    
    for category in categories:
        try:
            print(f"Fetching {category} market news...")
            articles = fetch_market_news(category, api_key=api_key)
            if articles:
                count = insert_market_news(supabase, articles)
                stats['articles_inserted'] += count
                stats['categories_processed'] += 1
                print(f"  Inserted {count} articles for {category}")
        except Exception as e:
            error_msg = f"Error fetching {category} news: {e}"
            stats['errors'].append(error_msg)
            print(error_msg)
    
    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing market data to database...")
    print("=" * 60)
    
    try:
        supabase = get_supabase_client()
        
        # Example: Sync data for a specific stock
        print("\n--- Syncing Stock Data ---")
        stats = sync_stock_data(supabase, 'AAPL', fetch_quotes=True, fetch_candles=True, fetch_news=True)
        print(f"\nSync Complete for {stats['ticker']}:")
        print(f"  Profile updated: {stats['profile_updated']}")
        print(f"  Quotes inserted: {stats['quotes_inserted']}")
        print(f"  Candles inserted: {stats['candles_inserted']}")
        print(f"  News inserted: {stats['news_inserted']}")
        
        # Example: Sync market news
        print("\n--- Syncing Market News ---")
        news_stats = sync_market_news(supabase, categories=['general'])
        print(f"\nMarket News Sync Complete:")
        print(f"  Categories processed: {news_stats['categories_processed']}")
        print(f"  Articles inserted: {news_stats['articles_inserted']}")
        
        if stats['errors'] or news_stats['errors']:
            print(f"\nErrors encountered:")
            for error in stats['errors'] + news_stats['errors']:
                print(f"  - {error}")
        
    except Exception as e:
        print(f"Fatal error: {e}")

