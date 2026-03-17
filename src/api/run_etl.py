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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from supabase import create_client, Client
from supabase import ClientOptions
from dotenv import load_dotenv

load_dotenv()

BASKETS_PATH = Path(__file__).parent / 'markets' / 'baskets.json'

DEFAULT_NEWS_SECTIONS = [
    'home', 'technology', 'business', 'science',
    'health', 'sports', 'arts', 'world', 'politics', 'us'
]

DEFAULT_SUBREDDITS = [
    'worldnews', 'technology', 'science', 'sports',
    'entertainment', 'music', 'movies', 'programming'
]

MARKET_NEWS_CATEGORIES = ['general', 'forex', 'crypto', 'merger']


def load_baskets() -> Dict[str, List[str]]:
    """Load baskets.json — 5 groups of tickers driving all market ETL routing."""
    with open(BASKETS_PATH) as f:
        return json.load(f)


def classify_tickers(baskets: Dict[str, List[str]]) -> Dict[str, str]:
    """Return {ticker: asset_type} for every ticker across all basket groups."""
    ETF_GROUPS    = {'core_market', 'sectors', 'breadth', 'risk'}
    CRYPTO_GROUPS = {'crypto'}
    result = {}
    for group, tickers in baskets.items():
        at = ('etf'    if group in ETF_GROUPS    else
              'crypto' if group in CRYPTO_GROUPS else 'stock')
        for t in tickers:
            result[t] = at
    return result

# Full list of supported sentiment topics; default run uses SENTIMENT_TOPICS_DEFAULT
# to stay within the ~10 req/day budget per AV key
SENTIMENT_TOPICS_DEFAULT = [
    'earnings', 'financial_markets', 'technology',
    'finance', 'economy_macro',
]
SENTIMENT_TOPICS_ALL = [
    'earnings', 'financial_markets', 'technology', 'finance',
    'economy_macro', 'economy_monetary', 'economy_fiscal',
    'mergers_and_acquisitions', 'ipo', 'energy_transportation'
]


def get_supabase_client() -> Client:
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def run_sports_etl(supabase: Client, backfill_days: int = 0) -> Dict[str, Any]:
    """Run sports ETL: ESPN news and scores. Optionally backfill N days of historical scores."""
    print("\n" + "=" * 60)
    print("SPORTS ETL")
    print("=" * 60)

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'sports'))
        from sports.sports_db_helper import sync_all_sports_data, backfill_sports_scores

        stats: Dict[str, Any] = {'leagues_processed': 0, 'news_inserted': 0,
                                  'scores_inserted': 0, 'errors': []}

        if backfill_days > 0:
            print(f"\nBackfilling {backfill_days} days of ESPN scores...")
            bf_stats = backfill_sports_scores(supabase, days_back=backfill_days)
            stats['scores_inserted'] += bf_stats.get('scores_inserted', 0)
            stats['errors'].extend(bf_stats.get('errors', []))
            print(f"  Backfilled {bf_stats.get('scores_inserted', 0)} scores across "
                  f"{bf_stats.get('dates_processed', 0)} dates")

        # Always fetch current snapshot (news + today's scores)
        current = sync_all_sports_data(supabase, news_limit_per_sport=20)
        stats['leagues_processed'] = current['leagues_processed']
        stats['news_inserted'] = current['news_inserted']
        stats['scores_inserted'] += current['scores_inserted']
        stats['errors'].extend(current.get('errors', []))

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
    all_sentiment_topics: bool = False,
    skip_sentiment: bool = False,
) -> Dict[str, Any]:
    """
    Daily markets ETL: quotes + company news + market news + AV sentiment.
    Quote backfill (OHLCV history) is intentionally excluded — use run_db_seed.py.
    Profile/info updates are intentionally excluded — run --scrape-etf-info
    (ETFdb) or --refresh-profiles (FMP) manually when needed.
    """
    print("\n" + "=" * 60)
    print("MARKETS ETL")
    print("=" * 60)

    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)

    all_tickers = [t for tickers in baskets.values() for t in tickers]
    if watchlist is None:
        watchlist = all_tickers

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'markets'))
        from markets.markets_db_helper import sync_stock_data, sync_market_news, sync_news_sentiment

        total_stats = {
            'stocks_processed': 0,
            'quotes_inserted': 0,
            'news_inserted': 0,
            'market_news_inserted': 0,
            'sentiment_upserted': 0,
            'errors': []
        }

        def _fetch_ticker(ticker: str) -> tuple:
            at = asset_type_map.get(ticker, 'stock')
            print(f"\nProcessing {ticker} ({at})...")
            result = sync_stock_data(
                supabase,
                ticker,
                fetch_quotes=True,
                fetch_news=(at == 'stock'),  # stocks only; ETF/crypto news skipped
                fetch_profile=False,          # profiles updated manually, not daily
                quote_days_back=0,
                asset_type=at,
            )
            return ticker, result

        with ThreadPoolExecutor(max_workers=len(watchlist)) as executor:
            futures = {executor.submit(_fetch_ticker, t): t for t in watchlist}
            for future in as_completed(futures):
                ticker, stats = future.result()
                total_stats['stocks_processed'] += 1
                total_stats['quotes_inserted'] += stats.get('quotes_inserted', 0)
                total_stats['news_inserted'] += stats.get('news_inserted', 0)
                total_stats['errors'].extend(stats.get('errors', []))

        # Market news
        print("\nFetching market news...")
        news_stats = sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES)
        total_stats['market_news_inserted'] = news_stats.get('articles_inserted', 0)
        total_stats['errors'].extend(news_stats.get('errors', []))

        # AV news sentiment (skipped when --skip-sentiment)
        if not skip_sentiment:
            sentiment_topics = SENTIMENT_TOPICS_ALL if all_sentiment_topics else SENTIMENT_TOPICS_DEFAULT
            print(f"\nFetching AV news sentiment ({len(sentiment_topics)} topics)...")
            sentiment_stats = sync_news_sentiment(supabase, topics=sentiment_topics, tickers=watchlist)
            total_stats['sentiment_upserted'] = sentiment_stats.get('articles_upserted', 0)
            total_stats['errors'].extend(sentiment_stats.get('errors', []))
        else:
            print("\nSkipping AV news sentiment (--skip-sentiment)")

        print(f"\nMarkets ETL Complete:")
        print(f"  Stocks processed:          {total_stats['stocks_processed']}")
        print(f"  Quotes inserted:           {total_stats['quotes_inserted']}")
        print(f"  Company news inserted:     {total_stats['news_inserted']}")
        print(f"  Market news inserted:      {total_stats['market_news_inserted']}")
        print(f"  Sentiment articles upserted: {total_stats['sentiment_upserted']}")

        return {'success': True, 'stats': total_stats}

    except Exception as e:
        print(f"Markets ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_news_etl(
    supabase: Client,
    sections: Optional[List[str]] = None,
    backfill_days: int = 0,
) -> Dict[str, Any]:
    """Run news ETL: NYT top stories. Optionally backfill N days via the NYT Archive API."""
    print("\n" + "=" * 60)
    print("NEWS ETL")
    print("=" * 60)

    if sections is None:
        sections = DEFAULT_NEWS_SECTIONS

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'news'))
        from news.news_db_helper import sync_nyt_data, backfill_nyt_archive

        total_inserted = 0

        if backfill_days > 0:
            print(f"\nBackfilling {backfill_days} days of NYT articles via Archive API...")
            bf_stats = backfill_nyt_archive(supabase, days_back=backfill_days)
            total_inserted += bf_stats.get('articles_inserted', 0)
            print(f"  Archive backfill: {bf_stats.get('articles_inserted', 0)} articles "
                  f"from {bf_stats.get('months_fetched', 0)} month(s)")

        # Always fetch current top stories as well
        print("\nSyncing NYT top stories...")
        nyt_stats = sync_nyt_data(supabase, sections=sections)
        total_inserted += nyt_stats.get('articles_inserted', 0)

        print(f"\nNews ETL Complete:")
        print(f"  NYT articles inserted: {total_inserted}")

        return {'success': True, 'stats': {**nyt_stats, 'total_inserted': total_inserted}}

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


def run_etfdb_etl(supabase: Client) -> None:
    """Scrape ETF info and top-15 holdings from etfdb.com. Manual trigger only.

    DEPRECATED — ETF holdings are now fetched via Alpha Vantage ETF_PROFILE
    (sync_av_etf_holdings in markets_db_helper.py). This scraper is kept for
    manual enrichment of ETFdb-only fields (expense ratio, AUM, category) but
    is no longer part of the seed or daily pipeline.
    """
    print("\n" + "=" * 60)
    print("ETFDB SCRAPE — ETF INFO + HOLDINGS  [DEPRECATED]")
    print("  Holdings are now sourced from AV ETF_PROFILE (run_db_seed.py Phase 2).")
    print("  Use this only to backfill ETFdb-specific fields (expense ratio, AUM).")
    print("=" * 60)

    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    etf_tickers = [t for tickers in baskets.values() for t in tickers
                   if asset_type_map.get(t) == 'etf']

    print(f"ETFs to scrape: {len(etf_tickers)}")

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'markets'))
    from markets.markets_db_helper import sync_etfdb_data

    stats = sync_etfdb_data(supabase, etf_tickers)

    print(f"\nETFDB Scrape Complete:")
    print(f"  ETF info updated:  {stats['etf_info_updated']}")
    print(f"  Holdings upserted: {stats['etf_holdings_upserted']}")
    print(f"  FMP fallbacks:     {stats['fmp_fallbacks']}")
    if stats['errors']:
        print(f"  Errors ({len(stats['errors'])}): {stats['errors'][:3]}")


def run_fmp_etl(
    supabase: Client,
    watchlist: Optional[List[str]] = None,
    etf_only: bool = False,
    skip_holdings: bool = False
) -> Dict[str, Any]:
    """Run FMP ETL: enrich company profiles and upsert ETF holdings."""
    print("\n" + "=" * 60)
    print("FMP ETL")
    print("=" * 60)

    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    all_tickers = [t for tickers in baskets.values() for t in tickers]

    if watchlist is None:
        watchlist = all_tickers

    etf_tickers = [t for t in watchlist if asset_type_map.get(t) == 'etf']
    # Exclude crypto from FMP (no crypto profile/holdings endpoint)
    non_crypto = [t for t in watchlist if asset_type_map.get(t, 'stock') != 'crypto']
    tickers_to_process = etf_tickers if etf_only else non_crypto

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'markets'))
        from markets.markets_db_helper import sync_fmp_data

        stats = sync_fmp_data(
            supabase,
            watchlist=tickers_to_process,
            etf_tickers=etf_tickers,
            skip_holdings=skip_holdings
        )

        print(f"\nFMP ETL Complete:")
        print(f"  Company profiles updated: {stats['profiles_updated']}")
        print(f"  ETF info updated:         {stats['etf_info_updated']}")
        print(f"  ETF holdings upserted:    {stats['etf_holdings_upserted']}")
        if stats.get('errors'):
            print(f"  Errors: {len(stats['errors'])}")

        return {'success': True, 'stats': stats}

    except Exception as e:
        print(f"FMP ETL failed: {e}")
        return {'success': False, 'error': str(e)}


def run_full_etl(
    watchlist: Optional[List[str]] = None,
    skip_sports: bool = False,
    skip_markets: bool = False,
    skip_news: bool = False,
    skip_media: bool = False,
    skip_sentiment: bool = False,
    backfill_news_days: int = 0,
    backfill_sports_days: int = 0,
    all_sentiment_topics: bool = False
) -> Dict[str, Any]:
    """
    Run the full ETL pipeline for all data sources.
    Markets = today's quotes + company news + market news + AV sentiment only.
    Quote backfill (OHLCV history) is not part of the daily run — use run_db_seed.py.
    Profile updates: --refresh-profiles (FMP) or --scrape-etf-info (ETFdb).
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

    domain_fns = {}
    if not skip_sports:
        domain_fns['sports'] = lambda: run_sports_etl(supabase, backfill_days=backfill_sports_days)
    if not skip_markets:
        domain_fns['markets'] = lambda: run_markets_etl(
            supabase,
            watchlist=watchlist,
            all_sentiment_topics=all_sentiment_topics,
            skip_sentiment=skip_sentiment,
        )
    if not skip_news:
        domain_fns['news'] = lambda: run_news_etl(supabase, backfill_days=backfill_news_days)
    if not skip_media:
        domain_fns['media'] = lambda: run_media_etl(supabase)

    with ThreadPoolExecutor(max_workers=len(domain_fns)) as executor:
        domain_futures = {executor.submit(fn): domain for domain, fn in domain_fns.items()}
        for future in as_completed(domain_futures):
            domain = domain_futures[future]
            try:
                results[domain] = future.result()
            except Exception as e:
                results[domain] = {'success': False, 'error': str(e)}

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    print("\n" + "=" * 60)
    print(f"ETL COMPLETE — Duration: {duration:.1f}s")
    print("=" * 60)

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

    # ── Domain skip flags ────────────────────────────────────────────────────
    parser.add_argument('--skip-sports',  action='store_true', help='Skip sports ETL')
    parser.add_argument('--skip-markets', action='store_true', help='Skip markets ETL')
    parser.add_argument('--skip-news',    action='store_true', help='Skip news ETL')
    parser.add_argument('--skip-media',   action='store_true', help='Skip media ETL')

    # ── Domain "only" shortcuts ───────────────────────────────────────────────
    parser.add_argument('--sports-only',  action='store_true', help='Run sports ETL only')
    parser.add_argument('--markets-only', action='store_true', help='Run markets ETL only (quotes + news + sentiment)')
    parser.add_argument('--news-only',    action='store_true', help='Run news ETL only')
    parser.add_argument('--media-only',   action='store_true', help='Run media ETL only')

    # ── Backfill / markets options ────────────────────────────────────────────
    # Note: --backfill-quotes removed — OHLCV backfill belongs in run_db_seed.py only.
    parser.add_argument('--backfill-news', type=int, default=0, metavar='DAYS',
                        help='Backfill N days of NYT articles via the Archive API')
    parser.add_argument('--backfill-sports', type=int, default=0, metavar='DAYS',
                        help='Backfill N days of ESPN scores')
    parser.add_argument('--scrape-etf-info', action='store_true',
                        help='Scrape ETF info and top-15 holdings from etfdb.com '
                             '(run manually, not on daily/seed)')
    parser.add_argument('--skip-sentiment', action='store_true',
                        help='Skip AV news sentiment (daily run: quotes + news only)')
    parser.add_argument('--all-sentiment-topics', action='store_true',
                        help='Fetch all 10 AV sentiment topics instead of the default 5')
    parser.add_argument('--watchlist', nargs='+', metavar='TICKER',
                        help='Override basket watchlist with a custom ticker list')

    # ── Output ────────────────────────────────────────────────────────────────
    parser.add_argument('--output', metavar='FILE', help='Write results JSON to FILE')

    args = parser.parse_args()

    # --scrape-etf-info: standalone, does NOT chain into run_full_etl
    if args.scrape_etf_info:
        supabase = get_supabase_client()
        run_etfdb_etl(supabase)
        return

    # Expand "only" shortcuts into skip flags
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
        skip_sentiment=args.skip_sentiment,
        backfill_news_days=args.backfill_news,
        backfill_sports_days=args.backfill_sports,
        all_sentiment_topics=args.all_sentiment_topics,
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nResults written to {args.output}")

    any_failed = any(
        r and not r.get('success')
        for r in [results['sports'], results['markets'], results['news'], results['media']]
        if r is not None
    )
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
