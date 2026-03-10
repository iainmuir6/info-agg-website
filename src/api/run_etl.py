#!/usr/bin/env python3
# run_etl.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-04
# Description: ETL orchestrator — runs all data fetchers and loads into Supabase

import os
import sys
import json
import argparse
from datetime import datetime
from typing import Dict, Any, List, Optional
from supabase import create_client, Client
from supabase import ClientOptions
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# WATCHLIST — Curated list of stocks to track (Mag 7 + indices)
# ============================================================
DEFAULT_WATCHLIST = [
    'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'META', 'TSLA',        # Magnificent 7
    'SPY', 'QQQ', 'DIA',                                            # Major ETF indices
    'JPM', 'BAC', 'BRK.B',                                          # Financials
]

DEFAULT_NEWS_SECTIONS = [
    'home', 'technology', 'business', 'science',
    'health', 'sports', 'arts', 'world', 'politics', 'us'
]

DEFAULT_SUBREDDITS = [
    'worldnews', 'technology', 'science', 'sports',
    'entertainment', 'music', 'movies', 'programming'
]

MARKET_NEWS_CATEGORIES = ['general', 'forex', 'crypto', 'merger']


def get_supabase_client() -> Client:
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def run_sports_etl(supabase: Client) -> Dict[str, Any]:
    """Run sports ETL: ESPN news and scores for all configured leagues."""
    print("\n" + "=" * 60)
    print("SPORTS ETL")
    print("=" * 60)

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'sports'))
        from sports.sports_db_helper import sync_all_sports_data
        stats = sync_all_sports_data(supabase, news_limit_per_sport=20)
        print(f"\nSports ETL Complete:")
        print(f"  Leagues processed: {stats['leagues_processed']}")
        print(f"  News inserted: {stats['news_inserted']}")
        print(f"  Scores inserted: {stats['scores_inserted']}")
        return {'success': True, 'stats': stats}
    except Exception as e:
        print(f"Sports ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_markets_etl(
    supabase: Client,
    watchlist: Optional[List[str]] = None,
    fetch_candles: bool = True,
    quote_days_back: int = 0
) -> Dict[str, Any]:
    """Run markets ETL: stock quotes, candles, company news, and market news."""
    print("\n" + "=" * 60)
    print("MARKETS ETL")
    print("=" * 60)

    if watchlist is None:
        watchlist = DEFAULT_WATCHLIST

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'markets'))
        from markets.markets_db_helper import sync_stock_data, sync_market_news

        total_stats = {
            'stocks_processed': 0,
            'quotes_inserted': 0,
            'candles_inserted': 0,
            'news_inserted': 0,
            'market_news_inserted': 0,
            'errors': []
        }

        for ticker in watchlist:
            print(f"\nProcessing {ticker}...")
            stats = sync_stock_data(
                supabase,
                ticker,
                fetch_quotes=True,
                fetch_candles=fetch_candles,
                fetch_news=(quote_days_back == 0),  # skip company news during backfill
                fetch_profile=True,
                quote_days_back=quote_days_back
            )
            total_stats['stocks_processed'] += 1
            total_stats['quotes_inserted'] += stats.get('quotes_inserted', 0)
            total_stats['candles_inserted'] += stats.get('candles_inserted', 0)
            total_stats['news_inserted'] += stats.get('news_inserted', 0)
            total_stats['errors'].extend(stats.get('errors', []))

        # Fetch general market news
        print("\nFetching market news...")
        news_stats = sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES)
        total_stats['market_news_inserted'] = news_stats.get('articles_inserted', 0)
        total_stats['errors'].extend(news_stats.get('errors', []))

        print(f"\nMarkets ETL Complete:")
        print(f"  Stocks processed: {total_stats['stocks_processed']}")
        print(f"  Quotes inserted: {total_stats['quotes_inserted']}")
        print(f"  Candles inserted: {total_stats['candles_inserted']}")
        print(f"  Company news inserted: {total_stats['news_inserted']}")
        print(f"  Market news inserted: {total_stats['market_news_inserted']}")

        return {'success': True, 'stats': total_stats}

    except Exception as e:
        print(f"Markets ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_news_etl(
    supabase: Client,
    sections: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Run news ETL: NYT top stories."""
    print("\n" + "=" * 60)
    print("NEWS ETL")
    print("=" * 60)

    if sections is None:
        sections = DEFAULT_NEWS_SECTIONS

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'news'))
        from news.news_db_helper import sync_nyt_data

        print("\nSyncing NYT data...")
        nyt_stats = sync_nyt_data(supabase, sections=sections)

        print(f"\nNews ETL Complete:")
        print(f"  NYT articles inserted: {nyt_stats.get('articles_inserted', 0)}")

        return {'success': True, 'stats': nyt_stats}

    except Exception as e:
        print(f"News ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_media_etl(
    supabase: Client,
    subreddits: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Run media ETL: Spotify new releases and Reddit hot posts."""
    print("\n" + "=" * 60)
    print("MEDIA ETL")
    print("=" * 60)

    if subreddits is None:
        subreddits = DEFAULT_SUBREDDITS

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'media'))
        from media.media_db_helper import sync_spotify_data, sync_reddit_data

        total_stats = {
            'spotify_releases': 0,
            'reddit_posts': 0,
            'errors': []
        }

        print("\nSyncing Spotify data...")
        spotify_stats = sync_spotify_data(supabase)
        total_stats['spotify_releases'] = spotify_stats.get('releases_inserted', 0)
        total_stats['errors'].extend(spotify_stats.get('errors', []))

        print("\nSyncing Reddit data...")
        reddit_stats = sync_reddit_data(supabase, subreddits=subreddits)
        total_stats['reddit_posts'] = reddit_stats.get('posts_inserted', 0)
        total_stats['errors'].extend(reddit_stats.get('errors', []))

        print(f"\nMedia ETL Complete:")
        print(f"  Spotify releases inserted: {total_stats['spotify_releases']}")
        print(f"  Reddit posts inserted: {total_stats['reddit_posts']}")

        return {'success': True, 'stats': total_stats}

    except Exception as e:
        print(f"Media ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_full_etl(
    watchlist: Optional[List[str]] = None,
    skip_sports: bool = False,
    skip_markets: bool = False,
    skip_news: bool = False,
    skip_media: bool = False,
    fetch_candles: bool = True,
    quote_days_back: int = 0
) -> Dict[str, Any]:
    """
    Run the full ETL pipeline for all data sources.

    Args:
        watchlist: Optional list of stock tickers (defaults to DEFAULT_WATCHLIST)
        skip_sports: Skip sports ETL
        skip_markets: Skip markets ETL
        skip_news: Skip news ETL
        skip_media: Skip media ETL
        fetch_candles: Whether to fetch historical candle data (slow)
        quote_days_back: If > 0, backfill this many days of daily quotes per ticker

    Returns:
        Summary dictionary with all ETL results
    """
    start_time = datetime.now()
    print("=" * 60)
    print(f"INFO AGGREGATOR — FULL ETL RUN")
    print(f"Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    supabase = get_supabase_client()

    results = {
        'started_at': start_time.isoformat(),
        'sports': None,
        'markets': None,
        'news': None,
        'media': None,
    }

    if not skip_sports:
        results['sports'] = run_sports_etl(supabase)

    if not skip_markets:
        results['markets'] = run_markets_etl(
            supabase, watchlist=watchlist, fetch_candles=fetch_candles, quote_days_back=quote_days_back
        )

    if not skip_news:
        results['news'] = run_news_etl(supabase)

    if not skip_media:
        results['media'] = run_media_etl(supabase)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    print("\n" + "=" * 60)
    print(f"ETL COMPLETE — Duration: {duration:.1f}s")
    print("=" * 60)

    # Summary
    for domain in ['sports', 'markets', 'news', 'media']:
        result = results.get(domain)
        if result:
            status = "OK" if result.get('success') else "FAILED"
            print(f"  [{status}] {domain.upper()}")
            if not result.get('success'):
                print(f"    Error: {result.get('error')}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Info Aggregator ETL Pipeline')
    parser.add_argument('--skip-sports', action='store_true', help='Skip sports ETL')
    parser.add_argument('--skip-markets', action='store_true', help='Skip markets ETL')
    parser.add_argument('--skip-news', action='store_true', help='Skip news ETL')
    parser.add_argument('--skip-media', action='store_true', help='Skip media ETL')
    parser.add_argument('--no-candles', action='store_true', help='Skip historical candle data (faster)')
    parser.add_argument('--backfill-quotes', type=int, default=0, metavar='DAYS',
                        help='Backfill N days of daily quote history per ticker (e.g. 30)')
    parser.add_argument('--watchlist', nargs='+', help='Custom stock ticker list')
    parser.add_argument('--output', help='Write results JSON to file')
    parser.add_argument('--sports-only', action='store_true')
    parser.add_argument('--markets-only', action='store_true')
    parser.add_argument('--news-only', action='store_true')
    parser.add_argument('--media-only', action='store_true')

    args = parser.parse_args()

    # Handle "only" flags
    if args.sports_only:
        args.skip_markets = args.skip_news = args.skip_media = True
    elif args.markets_only:
        args.skip_sports = args.skip_news = args.skip_media = True
    elif args.news_only:
        args.skip_sports = args.skip_markets = args.skip_media = True
    elif args.media_only:
        args.skip_sports = args.skip_markets = args.skip_news = True

    results = run_full_etl(
        watchlist=args.watchlist,
        skip_sports=args.skip_sports,
        skip_markets=args.skip_markets,
        skip_news=args.skip_news,
        skip_media=args.skip_media,
        fetch_candles=not args.no_candles,
        quote_days_back=args.backfill_quotes,
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nResults written to {args.output}")

    # Exit with non-zero if any domain failed
    any_failed = any(
        r and not r.get('success')
        for r in [results['sports'], results['markets'], results['news'], results['media']]
        if r is not None
    )
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
