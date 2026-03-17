# markets_db_helper.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Helper functions to insert market data into Supabase database

from typing import Dict, List, Optional, Any
from supabase import create_client, Client
from supabase import ClientOptions
from datetime import datetime, timezone
import os
import time
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
    
    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def get_or_create_stock(supabase: Client, ticker: str, profile_data: Optional[Dict[str, Any]] = None, asset_type: str = 'stock') -> Optional[str]:
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
        # Try to get existing stock (maybe_single returns None on 0 rows in supabase 2.x)
        response = supabase.table('stocks').select('id').eq('ticker', ticker).maybe_single().execute()
        stock_id = response.data.get('id') if (response and response.data) else None
        
        if stock_id:
            if profile_data:
                _mc = profile_data.get('market_cap')
                _so = profile_data.get('share_outstanding')
                update_data = {
                    'name':              profile_data.get('name'),
                    'country':           profile_data.get('country'),
                    'currency':          profile_data.get('currency'),
                    'exchange':          profile_data.get('exchange'),
                    'ipo_date':          profile_data.get('ipo_date'),
                    'market_cap':        int(round(_mc)) if _mc is not None else None,
                    'share_outstanding': int(round(_so)) if _so is not None else None,
                    'logo_url':          profile_data.get('logo'),
                    'website':           profile_data.get('website'),
                    'industry':          profile_data.get('industry'),
                    'sector':            profile_data.get('sector'),
                    'description':       profile_data.get('description'),
                    'ceo':               profile_data.get('ceo'),
                    'city':              profile_data.get('city'),
                    'state':             profile_data.get('state'),
                    'beta':              profile_data.get('beta'),
                    'is_active':         profile_data.get('is_actively_trading'),
                }
                update_data = {k: v for k, v in update_data.items() if v is not None}
                supabase.table('stocks').update(update_data).eq('id', stock_id).execute()
            return stock_id
        else:
            _mc = profile_data.get('market_cap') if profile_data else None
            _so = profile_data.get('share_outstanding') if profile_data else None
            insert_data = {
                'ticker':            ticker,
                'asset_type':        asset_type,
                'name':              profile_data.get('name') if profile_data else None,
                'country':           profile_data.get('country') if profile_data else None,
                'currency':          profile_data.get('currency') if profile_data else None,
                'exchange':          profile_data.get('exchange') if profile_data else None,
                'ipo_date':          profile_data.get('ipo_date') if profile_data else None,
                'market_cap':        int(round(_mc)) if _mc is not None else None,
                'share_outstanding': int(round(_so)) if _so is not None else None,
                'logo_url':          profile_data.get('logo') if profile_data else None,
                'website':           profile_data.get('website') if profile_data else None,
                'industry':          profile_data.get('industry') if profile_data else None,
                'sector':            profile_data.get('sector') if profile_data else None,
                'description':       profile_data.get('description') if profile_data else None,
                'ceo':               profile_data.get('ceo') if profile_data else None,
                'city':              profile_data.get('city') if profile_data else None,
                'state':             profile_data.get('state') if profile_data else None,
                'beta':              profile_data.get('beta') if profile_data else None,
                'is_active':         profile_data.get('is_actively_trading') if profile_data else None,
            }
            insert_data = {k: v for k, v in insert_data.items() if v is not None}
            response = supabase.table('stocks').upsert(
                insert_data,
                on_conflict='ticker'
            ).execute()
            return response.data[0].get('id') if response.data else None
            
    except Exception as e:
        print(f"Error getting/creating stock for {ticker}: {e}")
        return None


def insert_stock_quote(supabase: Client, stock_id: str, quote_data: Dict[str, Any]) -> bool:
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
        ts = quote_data.get('timestamp')
        quote_timestamp = (
            datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts
            else datetime.now(timezone.utc).isoformat()
        )
        insert_data = {
            'stock_id': stock_id,
            'current_price': quote_data.get('current_price'),
            'change_amount': quote_data.get('change'),
            'percent_change': quote_data.get('percent_change'),
            'high_price': quote_data.get('high_price'),
            'low_price': quote_data.get('low_price'),
            'open_price': quote_data.get('open_price'),
            'previous_close': quote_data.get('previous_close'),
            'volume': quote_data.get('volume'),
            'quote_timestamp': quote_timestamp
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



def insert_stock_quotes_batch(supabase: Client, stock_id: str, quotes: List[Dict[str, Any]]) -> int:
    """
    Bulk-upsert a list of quote records (e.g. from fetch_historical_quotes()).

    Returns the number of rows upserted.
    """
    if not quotes:
        return 0

    batch_data = []
    for q in quotes:
        ts = q.get('timestamp')
        # Alpha Vantage returns date strings (e.g. '2025-03-01') — valid TIMESTAMPTZ for Postgres.
        # Finnhub returns Unix epoch integers — convert to ISO string.
        if ts and isinstance(ts, (int, float)):
            quote_timestamp = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        elif ts:
            quote_timestamp = ts  # already a date/datetime string
        else:
            quote_timestamp = datetime.now(timezone.utc).isoformat()
        batch_data.append({
            'stock_id': stock_id,
            'current_price': q.get('current_price'),
            'change_amount': q.get('change'),
            'percent_change': q.get('percent_change'),
            'high_price': q.get('high_price'),
            'low_price': q.get('low_price'),
            'open_price': q.get('open_price'),
            'previous_close': q.get('previous_close'),
            'volume': q.get('volume'),
            'quote_timestamp': quote_timestamp
        })

    try:
        inserted = 0
        batch_size = 100
        for i in range(0, len(batch_data), batch_size):
            batch = batch_data[i:i + batch_size]
            response = supabase.table('stock_quotes').upsert(
                batch,
                on_conflict='stock_id,quote_timestamp'
            ).execute()
            inserted += len(batch)
        return inserted
    except Exception as e:
        print(f"Error batch-inserting quotes for stock_id={stock_id}: {e}")
        return 0


def insert_company_news(supabase: Client, stock_id: str, articles: List[Dict[str, Any]]) -> int:
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
    fetch_news: bool = True,
    fetch_profile: bool = True,
    asset_type: str = 'stock'
) -> Dict[str, Any]:
    """
    Sync daily data for a specific stock, ETF, crypto, forex, or commodity asset.

    Args:
        supabase: Supabase client instance
        ticker: Ticker symbol
        fetch_quotes: Whether to fetch and insert the latest quote
        fetch_news: Whether to fetch and insert company news (stocks only)
        fetch_profile: Whether to fetch and insert company profile (stocks/ETFs only)
        asset_type: 'stock', 'etf', 'crypto', 'forex', or 'commodity'

    Returns:
        Dictionary with sync statistics
    """
    try:
        from .finnhub import (
            fetch_stock_quote, fetch_company_profile,
            fetch_company_news, fetch_crypto_quote, get_finnhub_api_key
        )
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from finnhub import (
            fetch_stock_quote, fetch_company_profile,
            fetch_company_news, fetch_crypto_quote, get_finnhub_api_key
        )

    stats = {
        'ticker': ticker,
        'profile_updated': False,
        'quotes_inserted': 0,
        'news_inserted': 0,
        'errors': []
    }

    try:
        # Forex/commodity: stub row + FMP quote only — no profile, no news, no Finnhub
        if asset_type in ('forex', 'commodity'):
            try:
                from .fmp import fetch_fmp_quote, get_fmp_api_key
            except ImportError:
                import sys
                import os
                current_dir = os.path.dirname(os.path.abspath(__file__))
                if current_dir not in sys.path:
                    sys.path.insert(0, current_dir)
                from fmp import fetch_fmp_quote, get_fmp_api_key

            stock_id = get_or_create_stock(supabase, ticker, asset_type=asset_type)
            if not stock_id:
                stats['errors'].append(f"Failed to get/create stock for {ticker}")
                return stats

            if fetch_quotes:
                print(f"Fetching FMP quote for {ticker} ({asset_type})...")
                fmp_key = get_fmp_api_key()
                quote = fetch_fmp_quote(ticker, fmp_key)
                if quote:
                    # Map fetch_fmp_quote keys to insert_stock_quote expectations
                    quote_mapped = {
                        'current_price': quote.get('current_price'),
                        'change': quote.get('change_amount'),
                        'percent_change': quote.get('percent_change'),
                        'high_price': quote.get('high_price'),
                        'low_price': quote.get('low_price'),
                        'open_price': quote.get('open_price'),
                        'previous_close': quote.get('previous_close'),
                        'volume': quote.get('volume'),
                        'timestamp': quote.get('quote_timestamp'),
                    }
                    if insert_stock_quote(supabase, stock_id, quote_mapped):
                        stats['quotes_inserted'] = 1
            return stats

        api_key = get_finnhub_api_key()

        # Crypto assets: skip profile fetch (no Finnhub/FMP profile) — just ensure row exists
        if asset_type == 'crypto':
            stock_id = get_or_create_stock(supabase, ticker, asset_type=asset_type)
        elif fetch_profile:
            print(f"Fetching profile for {ticker}...")
            profile = fetch_company_profile(ticker, api_key)
            if not profile:
                print(f"  No company profile for {ticker} — skipping profile update")
            if profile:
                stock_id = get_or_create_stock(supabase, ticker, profile, asset_type=asset_type)
                if stock_id:
                    stats['profile_updated'] = True
            else:
                stock_id = get_or_create_stock(supabase, ticker, asset_type=asset_type)
        else:
            stock_id = get_or_create_stock(supabase, ticker, asset_type=asset_type)

        if not stock_id:
            stats['errors'].append(f"Failed to get/create stock for {ticker}")
            return stats

        # Fetch and insert latest quote
        if fetch_quotes:
            print(f"Fetching quote for {ticker}...")
            if asset_type == 'crypto':
                quote = fetch_crypto_quote(ticker, api_key)
            else:
                quote = fetch_stock_quote(ticker, api_key)
            if quote:
                if insert_stock_quote(supabase, stock_id, quote):
                    stats['quotes_inserted'] = 1

        # Fetch and insert company news (stocks only — skip ETFs, crypto, forex, commodity)
        if fetch_news and asset_type not in ('crypto', 'etf', 'forex', 'commodity'):
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
        from .finnhub import fetch_market_news, get_finnhub_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from finnhub import fetch_market_news, get_finnhub_api_key
    
    if api_key is None:
        api_key = get_finnhub_api_key()
    
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


def insert_stub_stocks(supabase: Client, tickers: List[str], asset_type: str = 'stock') -> Dict[str, str]:
    """
    Batch-insert stub rows for tickers that don't yet exist in stocks, then
    return a {ticker: id} map for all requested tickers.

    Uses ON CONFLICT DO NOTHING so existing rows are untouched.
    """
    if not tickers:
        return {}

    unique = list(dict.fromkeys(tickers))  # deduplicate, preserve order

    # Insert stubs — ignore conflicts on existing tickers
    stubs = [{'ticker': t, 'asset_type': asset_type} for t in unique]
    try:
        batch_size = 100
        for i in range(0, len(stubs), batch_size):
            supabase.table('stocks').upsert(
                stubs[i:i + batch_size],
                on_conflict='ticker',
                ignore_duplicates=True,
            ).execute()
    except Exception as e:
        print(f"Error inserting stub stocks: {e}")

    # Fetch IDs for all requested tickers
    try:
        resp = supabase.table('stocks').select('id,ticker').in_('ticker', unique).execute()
        return {row['ticker']: row['id'] for row in (resp.data or [])}
    except Exception as e:
        print(f"Error fetching stock IDs after stub insert: {e}")
        return {}


def upsert_etf_holdings(supabase: Client, etf_stock_id: str, holdings: List[Dict[str, Any]]) -> int:
    """
    Batch upsert ETF holdings into etf_holdings table.

    Each holding dict must contain:
        asset_stock_id (UUID), asset_name, weight_pct, shares, market_value, as_of_date

    Returns number of rows upserted.
    """
    if not holdings:
        return 0

    batch_data = []
    for h in holdings:
        asset_stock_id = h.get('asset_stock_id')
        if not asset_stock_id:
            continue
        batch_data.append({
            'etf_stock_id': etf_stock_id,
            'asset_stock_id': asset_stock_id,
            'asset_name': h.get('asset_name'),
            'weight_pct': h.get('weight_pct'),
            'shares': h.get('shares'),
            'market_value': h.get('market_value'),
            'as_of_date': h.get('as_of_date'),
        })

    if not batch_data:
        return 0

    try:
        upserted = 0
        batch_size = 100
        for i in range(0, len(batch_data), batch_size):
            batch = batch_data[i:i + batch_size]
            supabase.table('etf_holdings').upsert(
                batch,
                on_conflict='etf_stock_id,asset_stock_id,as_of_date'
            ).execute()
            upserted += len(batch)
        return upserted
    except Exception as e:
        print(f"Error upserting ETF holdings for stock_id={etf_stock_id}: {e}")
        return 0


def upsert_etf_sectors(supabase: Client, etf_stock_id: str, sectors: List[Dict[str, Any]]) -> int:
    """
    Batch upsert ETF sector breakdown into etf_sectors.

    Each sector dict must contain: sector (str), weight_pct (float), as_of_date (str).

    Returns number of rows upserted.
    """
    if not sectors:
        return 0

    batch_data = [
        {
            'etf_stock_id': etf_stock_id,
            'sector': s['sector'],
            'weight_pct': s.get('weight_pct'),
            'as_of_date': s.get('as_of_date'),
        }
        for s in sectors if s.get('sector')
    ]

    if not batch_data:
        return 0

    try:
        upserted = 0
        batch_size = 100
        for i in range(0, len(batch_data), batch_size):
            supabase.table('etf_sectors').upsert(
                batch_data[i:i + batch_size],
                on_conflict='etf_stock_id,sector,as_of_date'
            ).execute()
            upserted += len(batch_data[i:i + batch_size])
        return upserted
    except Exception as e:
        print(f"Error upserting ETF sectors for stock_id={etf_stock_id}: {e}")
        return 0


def sync_fmp_data(
    supabase: Client,
    watchlist: List[str],
    etf_tickers: Optional[List[str]] = None,
    skip_holdings: bool = False
) -> Dict[str, Any]:
    """
    Master FMP sync function — enriches stocks and upserts ETF holdings.

    Args:
        supabase: Supabase client instance
        watchlist: All tickers to enrich with FMP company profiles
        etf_tickers: Subset of watchlist that are ETFs (gets info + optional holdings)
        skip_holdings: If True, skip ETF holdings fetch (use on non-weekly days)

    Returns:
        Stats dict
    """
    try:
        from .fmp import fetch_company_profile as fmp_profile, get_fmp_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from fmp import fetch_company_profile as fmp_profile, get_fmp_api_key

    stats: Dict[str, Any] = {
        'profiles_updated': 0,
        'etf_info_updated': 0,
        'etf_holdings_upserted': 0,
        'errors': []
    }

    try:
        api_key = get_fmp_api_key()
    except ValueError as e:
        stats['errors'].append(str(e))
        print(f"FMP sync skipped: {e}")
        return stats

    if etf_tickers is None:
        etf_tickers = []

    etf_set = set(etf_tickers)

    for ticker in watchlist:
        try:
            # ETFs are now handled exclusively by sync_etfdb_data(); skip them here
            if ticker in etf_set:
                continue

            print(f"  [{ticker}] Fetching FMP company profile...")
            profile = fmp_profile(ticker, api_key)
            if profile:
                # Enrich existing stocks row with FMP extras
                stock_id = get_or_create_stock(supabase, ticker, profile)
                if stock_id:
                    # Write FMP-only fields that get_or_create_stock doesn't cover
                    extra_fields = {k: profile[k] for k in
                                    ('sector', 'description', 'ceo', 'city', 'state', 'beta')
                                    if profile.get(k) is not None}
                    if extra_fields:
                        try:
                            supabase.table('stocks').update(extra_fields).eq('id', stock_id).execute()
                        except Exception:
                            pass  # columns may not exist yet — non-fatal
                    stats['profiles_updated'] += 1

        except RuntimeError as e:
            # Daily limit hit — abort remaining FMP calls
            print(f"FMP rate limit: {e}")
            stats['errors'].append(str(e))
            break
        except Exception as e:
            msg = f"FMP error for {ticker}: {e}"
            print(msg)
            stats['errors'].append(msg)

    return stats


def sync_av_etf_holdings(supabase: Client, etf_tickers: List[str]) -> Dict[str, Any]:
    """
    Fetch ETF holdings from Alpha Vantage ETF_PROFILE and upsert into etf_holdings.

    One AV call per ETF ticker. Uses round-robin key rotation via
    fetch_etf_holdings_av(). AV provides symbol, description, and weight%;
    shares and market_value are not available and are stored as NULL.

    Returns:
        Stats dict: etfs_processed, holdings_upserted, errors
    """
    try:
        from .alpha_vantage import fetch_etf_holdings_av
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from alpha_vantage import fetch_etf_holdings_av

    stats: Dict[str, Any] = {
        'etfs_processed': 0,
        'holdings_upserted': 0,
        'errors': [],
    }

    for ticker in etf_tickers:
        try:
            print(f"  [{ticker}] Fetching ETF holdings via AV ETF_PROFILE...")
            raw_holdings = fetch_etf_holdings_av(ticker)
            if not raw_holdings:
                print(f"  [{ticker}] No holdings returned")
                stats['etfs_processed'] += 1
                continue

            etf_stock_id = get_or_create_stock(supabase, ticker, asset_type='etf')
            if not etf_stock_id:
                stats['errors'].append(f"{ticker}: failed to get/create stock row")
                continue

            # Insert stub rows for all holding symbols, get {ticker: id} map
            holding_tickers = [h['asset_symbol'] for h in raw_holdings if h.get('asset_symbol')]
            ticker_id_map = insert_stub_stocks(supabase, holding_tickers, asset_type='stock')

            # Re-shape holdings to use asset_stock_id FK
            holdings = []
            for h in raw_holdings:
                sym = h.get('asset_symbol')
                stock_id = ticker_id_map.get(sym) if sym else None
                if not stock_id:
                    continue
                holdings.append({
                    'asset_stock_id': stock_id,
                    'asset_name': h.get('asset_name'),
                    'weight_pct': h.get('weight_percentage'),
                    'shares': h.get('shares'),
                    'market_value': h.get('market_value'),
                    'as_of_date': h.get('as_of_date'),
                })

            count = upsert_etf_holdings(supabase, etf_stock_id, holdings)
            stats['holdings_upserted'] += count
            stats['etfs_processed'] += 1
            print(f"  [{ticker}] Upserted {count} holdings")

        except Exception as e:
            msg = f"{ticker}: {e}"
            print(f"  [av_etf_holdings] Error for {ticker}: {e}")
            stats['errors'].append(msg)

    return stats


def sync_etfdb_data(supabase: Client, etf_tickers: List[str]) -> Dict[str, Any]:
    """
    DEPRECATED — ETF holdings are now fetched via AV ETF_PROFILE in sync_av_etf_holdings().

    This Selenium-based scraper remains available for manual enrichment (expense ratio,
    AUM, ETF category) that AV does not provide, but it is no longer called by the
    seed or daily ETL pipelines. Trigger manually with --scrape-etf-info if needed.

    Scrape all ETF pages in one Selenium session, then batch-upsert to Supabase.

    Flow:
      1. scrape_all_etfs(etf_tickers) — one browser session, one page visit per ticker,
         returns [{ticker, info, holdings}] for all tickers
      2. For each result: info None → FMP company profile fallback
      3. get_or_create_stock() + upsert_etf_holdings() for every ticker

    Returns:
        Stats dict: etf_info_updated, etf_holdings_upserted, fmp_fallbacks, errors
    """
    try:
        from .etfdb import scrape_all_etfs
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from etfdb import scrape_all_etfs

    try:
        from .fmp import fetch_company_profile as fmp_profile, get_fmp_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from fmp import fetch_company_profile as fmp_profile, get_fmp_api_key

    stats: Dict[str, Any] = {
        'etf_info_updated': 0,
        'etf_holdings_upserted': 0,
        'fmp_fallbacks': 0,
        'errors': [],
    }

    fmp_key: Optional[str] = None
    try:
        fmp_key = get_fmp_api_key()
    except ValueError:
        pass  # FMP key optional — used only as fallback for info

    # --- Phase 1: scrape all pages in one browser session ---
    print(f"\nScraping {len(etf_tickers)} ETF pages via Selenium...")
    scraped = scrape_all_etfs(etf_tickers)

    # --- Phase 2: upsert results to Supabase ---
    print(f"\nUpserting {len(scraped)} ETF results to Supabase...")
    for result in scraped:
        ticker = result['ticker']
        info = result['info']
        holdings = result['holdings']

        try:
            # Info: fall back to FMP company profile if etfdb returned nothing
            if info is None:
                print(f"  [{ticker}] etfdb info unavailable — trying FMP profile fallback...")
                if fmp_key:
                    try:
                        info = fmp_profile(ticker, fmp_key)
                        if info:
                            stats['fmp_fallbacks'] += 1
                    except Exception as fmp_err:
                        print(f"  [{ticker}] FMP profile fallback failed: {fmp_err}")

            if info:
                stock_id = get_or_create_stock(supabase, ticker, info, asset_type='etf')
                if stock_id:
                    stats['etf_info_updated'] += 1
                else:
                    print(f"  [{ticker}] Warning: get_or_create_stock returned None")
                    continue
            else:
                print(f"  [{ticker}] Warning: no info available — creating stub row")
                stock_id = get_or_create_stock(supabase, ticker, asset_type='etf')
                if not stock_id:
                    stats['errors'].append(f"{ticker}: failed to get/create stock row")
                    continue

            # Holdings: no FMP fallback (holdings endpoint is premium)
            if holdings:
                count = upsert_etf_holdings(supabase, stock_id, holdings)
                stats['etf_holdings_upserted'] += count
                print(f"  [{ticker}] Upserted {count} holdings")
            else:
                print(f"  [{ticker}] No holdings to upsert")

        except Exception as e:
            msg = f"{ticker}: {e}"
            print(f"  [etfdb] DB error for {ticker}: {e}")
            stats['errors'].append(msg)

    return stats


def insert_news_sentiment(supabase: Client, articles: List[Dict[str, Any]]) -> int:
    """
    Upsert AV news sentiment articles into info_agg.news_sentiment.

    On conflict (url) all fields are overwritten; topics from AV already
    contain the full topic list for each article so no merge is needed.

    Returns the number of rows upserted.
    """
    if not articles:
        return 0

    # Build ticker → stock UUID map for primary_ticker_id resolution
    stocks_result = supabase.table('stocks').select('id, ticker').execute()
    ticker_to_id = {row['ticker']: row['id'] for row in (stocks_result.data or [])}

    batch_data = []
    for article in articles:
        # Parse AV time_published: '20240101T120000' → ISO timestamp
        time_published = article.get('time_published')
        published_at = None
        if time_published:
            try:
                published_at = datetime.strptime(time_published, '%Y%m%dT%H%M%S').isoformat()
            except ValueError:
                published_at = None

        # Extract topic strings from AV topic dicts
        raw_topics = article.get('topics', [])
        topic_strings = [t.get('topic') for t in raw_topics if t.get('topic')]

        url = article.get('url')
        if not url:
            continue

        # Resolve primary_ticker_id: highest relevance_score ticker present in stocks
        ts = article.get('ticker_sentiments') or []
        primary_ticker_id = None
        if ts:
            for entry in sorted(ts, key=lambda x: float(x.get('relevance_score') or 0), reverse=True):
                tid = ticker_to_id.get(entry.get('ticker'))
                if tid:
                    primary_ticker_id = tid
                    break

        batch_data.append({
            'title': article.get('title'),
            'url': url,
            'source': article.get('source'),
            'source_domain': article.get('source_domain'),
            'summary': article.get('summary'),
            'banner_image': article.get('banner_image'),
            'published_at': published_at,
            'topics': topic_strings,
            'overall_sentiment_score': article.get('overall_sentiment_score'),
            'overall_sentiment_label': article.get('overall_sentiment_label'),
            'ticker_sentiments': article.get('ticker_sentiments'),
            'primary_ticker_id': primary_ticker_id,
        })

    if not batch_data:
        return 0

    try:
        upserted = 0
        batch_size = 100
        for i in range(0, len(batch_data), batch_size):
            batch = batch_data[i:i + batch_size]
            supabase.table('news_sentiment').upsert(
                batch,
                on_conflict='url'
            ).execute()
            upserted += len(batch)
        return upserted
    except Exception as e:
        print(f"Error upserting news sentiment articles: {e}")
        return 0


def sync_news_sentiment(
    supabase: Client,
    topics: List[str],
    tickers: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Fetch and store AV news sentiment for each topic in the list.

    Args:
        supabase: Supabase client instance
        topics: List of AV topic strings (e.g. ['earnings', 'technology'])
        tickers: Optional list of tickers to include as additional filter

    Returns:
        Stats dict: topics_processed, articles_upserted, errors
    """
    try:
        from .alpha_vantage import fetch_news_sentiment, get_alphavantage_api_keys
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from alpha_vantage import fetch_news_sentiment, get_alphavantage_api_keys

    stats: Dict[str, Any] = {
        'topics_processed': 0,
        'articles_upserted': 0,
        'errors': []
    }

    try:
        get_alphavantage_api_keys()  # validate at least one key exists before looping
    except ValueError as e:
        stats['errors'].append(str(e))
        print(f"AV sentiment sync skipped: {e}")
        return stats

    for topic in topics:
        try:
            print(f"  Fetching AV sentiment for topic={topic}...")
            articles = fetch_news_sentiment(tickers=tickers, topic=topic)  # rotation handled internally
            if articles:
                count = insert_news_sentiment(supabase, articles)
                stats['articles_upserted'] += count
                stats['topics_processed'] += 1
                print(f"    Upserted {count} articles")
            else:
                stats['topics_processed'] += 1
        except Exception as e:
            msg = f"Error fetching sentiment for topic={topic}: {e}"
            print(msg)
            stats['errors'].append(msg)

    return stats


def backfill_missing_profiles(supabase: Client, batch_size: int = 100) -> Dict[str, Any]:
    """
    Fetch FMP company profiles for stocks that have no name yet.

    Queries stocks WHERE name IS NULL AND asset_type = 'stock', fetches
    FMP company profile for each, and updates the row via get_or_create_stock.

    Returns:
        {'checked': int, 'updated': int, 'errors': list}
    """
    try:
        from .fmp import fetch_company_profile as fmp_profile, get_fmp_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from fmp import fetch_company_profile as fmp_profile, get_fmp_api_key

    stats: Dict[str, Any] = {'checked': 0, 'updated': 0, 'errors': []}

    try:
        api_key = get_fmp_api_key()
    except ValueError as e:
        stats['errors'].append(str(e))
        print(f"Profile backfill skipped: {e}")
        return stats

    try:
        resp = (
            supabase.table('stocks')
            .select('id,ticker')
            .is_('name', 'null')
            .eq('asset_type', 'stock')
            .limit(batch_size)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        stats['errors'].append(f"Query failed: {e}")
        return stats

    for row in rows:
        ticker = row['ticker']
        stats['checked'] += 1
        try:
            profile = fmp_profile(ticker, api_key)
            if profile:
                get_or_create_stock(supabase, ticker, profile, asset_type='stock')
                stats['updated'] += 1
                print(f"  [backfill] {ticker}: profile updated")
            else:
                print(f"  [backfill] {ticker}: no FMP profile found")
        except RuntimeError as e:
            print(f"FMP rate limit during profile backfill: {e}")
            stats['errors'].append(str(e))
            break
        except Exception as e:
            msg = f"{ticker}: {e}"
            stats['errors'].append(msg)
            print(f"  [backfill] Error for {ticker}: {e}")

    return stats


def upsert_economic_indicators(supabase: Client, rows: List[Dict[str, Any]]) -> int:
    """
    Batch upsert rows into info_agg.economic_indicators on (indicator_name, date).

    Each row must have: indicator_name, date, value.
    Returns number of rows upserted.
    """
    if not rows:
        return 0

    # Filter out rows missing required fields
    clean = [r for r in rows if r.get('indicator_name') and r.get('date')]
    if not clean:
        return 0

    try:
        upserted = 0
        batch_size = 200
        for i in range(0, len(clean), batch_size):
            batch = clean[i:i + batch_size]
            supabase.table('economic_indicators').upsert(
                batch,
                on_conflict='indicator_name,date'
            ).execute()
            upserted += len(batch)
        return upserted
    except Exception as e:
        print(f"Error upserting economic indicators: {e}")
        return 0


def sync_economic_indicators(supabase: Client) -> Dict[str, Any]:
    """
    Fetch and store economic indicators: treasury rates (1 FMP call) +
    7 macro indicators (7 FMP calls) = 8 calls/day total.

    Returns:
        {'indicators_processed': int, 'rows_upserted': int, 'errors': list}
    """
    try:
        from .fmp import fetch_treasury_rates, fetch_economic_indicator, get_fmp_api_key
    except ImportError:
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from fmp import fetch_treasury_rates, fetch_economic_indicator, get_fmp_api_key

    MACRO_INDICATORS = [
        'realGDP',
        'federalFunds',
        'CPI',
        'unemploymentRate',
        'inflationRate',
        '30YearFixedRateMortgageAverage',
        'initialClaims',
    ]

    stats: Dict[str, Any] = {'indicators_processed': 0, 'rows_upserted': 0, 'errors': []}

    try:
        api_key = get_fmp_api_key()
    except ValueError as e:
        stats['errors'].append(str(e))
        print(f"Economic indicators sync skipped: {e}")
        return stats

    all_rows: List[Dict[str, Any]] = []

    # Treasury rates (9 terms, 1 API call)
    print("  Fetching FMP treasury rates...")
    try:
        treasury_rows = fetch_treasury_rates(api_key)
        all_rows.extend(treasury_rows)
        stats['indicators_processed'] += 1
        print(f"    Got {len(treasury_rows)} treasury rate rows")
    except RuntimeError as e:
        print(f"FMP rate limit fetching treasury rates: {e}")
        stats['errors'].append(str(e))
        count = upsert_economic_indicators(supabase, all_rows)
        stats['rows_upserted'] += count
        return stats
    except Exception as e:
        msg = f"Error fetching treasury rates: {e}"
        print(msg)
        stats['errors'].append(msg)

    # Macro indicators (7 API calls)
    for name in MACRO_INDICATORS:
        print(f"  Fetching FMP economic indicator: {name}...")
        try:
            indicator_rows = fetch_economic_indicator(name, api_key)
            all_rows.extend(indicator_rows)
            stats['indicators_processed'] += 1
            print(f"    Got {len(indicator_rows)} rows")
        except RuntimeError as e:
            print(f"FMP rate limit fetching {name}: {e}")
            stats['errors'].append(str(e))
            break
        except Exception as e:
            msg = f"Error fetching {name}: {e}"
            print(msg)
            stats['errors'].append(msg)

    count = upsert_economic_indicators(supabase, all_rows)
    stats['rows_upserted'] += count
    print(f"  Economic indicators: upserted {count} rows")
    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing market data to database...")
    print("=" * 60)
    
    try:
        supabase = get_supabase_client()
        
        # Example: Sync data for a specific stock
        print("\n--- Syncing Stock Data ---")
        stats = sync_stock_data(supabase, 'AAPL', fetch_quotes=True, fetch_news=True)
        print(f"\nSync Complete for {stats['ticker']}:")
        print(f"  Profile updated: {stats['profile_updated']}")
        print(f"  Quotes inserted: {stats['quotes_inserted']}")
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

