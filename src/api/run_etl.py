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
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from supabase import create_client, Client
from supabase import ClientOptions
from dotenv import load_dotenv

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from sports.sports_db_helper import sync_all_sports_data
from markets.markets_db_helper import (
    sync_stock_data,
    sync_market_news,
    sync_news_sentiment,
    sync_economic_indicators,
    sync_fmp_data,
    sync_etfdb_data,
    insert_stub_stocks,
    upsert_daily_stock_quotes_batch,
    build_stock_quote_row,
)
from news.news_db_helper import sync_nyt_data
from media.media_db_helper import sync_spotify_data, sync_reddit_data

load_dotenv()

BASKETS_PATH = Path(__file__).parent / 'markets' / 'baskets.json'

DEFAULT_NYT_SECTIONS = [
    'us', 'world', 'opinion', 'business', 'insider',
    'realestate', 'science', 'technology', 'arts',
    # 'sports', 'politics', 'movies', 'nyregion', 
]

DEFAULT_SUBREDDITS = [
    'worldnews', 'technology', 'science', 'sports',
    'entertainment', 'music', 'movies', 'programming'
]

MARKET_NEWS_CATEGORIES = [
    'general', 'forex', 'crypto',
    # 'merger'
]

SENTIMENT_TOPICS_ALL = [
    'earnings', 'financial_markets', 'technology', 'finance',
    'economy_macro', 'economy_monetary', 'economy_fiscal',
    'mergers_and_acquisitions', 'ipo', 'energy_transportation'
]


def load_baskets() -> Dict[str, List[str]]:
    """Load baskets.json — 5 groups of tickers driving all market ETL routing."""
    with open(BASKETS_PATH) as f:
        return json.load(f)


def classify_tickers(baskets: Dict[str, List[str]]) -> Dict[str, str]:
    """Return {ticker: asset_type} for every ticker across all basket groups."""
    ETF_GROUPS       = {'core_market', 'sectors', 'breadth', 'risk'}
    CRYPTO_GROUPS    = {'crypto'}
    FOREX_GROUPS     = {'forex'}
    COMMODITY_GROUPS = {'commodities'}
    result = {}
    for group, tickers in baskets.items():
        at = ('etf'       if group in ETF_GROUPS       else
              'crypto'    if group in CRYPTO_GROUPS    else
              'forex'     if group in FOREX_GROUPS     else
              'commodity' if group in COMMODITY_GROUPS else 'stock')
        for t in tickers:
            result[t] = at
    return result


def get_supabase_client() -> Client:
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def run_sports_etl(supabase: Client) -> Dict[str, Any]:
    """Run sports ETL: ESPN news and scores (today's snapshot only)."""
    try:
        return {'success': True, 'stats': sync_all_sports_data(supabase, news_limit_per_sport=20)}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_markets_etl(
    supabase: Client,
    watchlist: Optional[List[str]] = None,
    skip_sentiment: bool = False,
) -> Dict[str, Any]:
    """
    Daily markets ETL: quotes + company news + market news + AV sentiment (all 10 topics).
    Quote backfill (OHLCV history) is intentionally excluded — use run_db_seed.py.
    Profile/info updates are intentionally excluded — run --scrape-etf-info
    (ETFdb) or --refresh-profiles (FMP) manually when needed.
    """
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)

    all_tickers = [t for tickers in baskets.values() for t in tickers]
    if watchlist is None:
        watchlist = all_tickers

    try:
        total_stats = {
            'stocks_processed': 0,
            'quotes_inserted': 0,
            'news_inserted': 0,
            'market_news_inserted': 0,
            'sentiment_upserted': 0,
            'economic_rows_upserted': 0,
            'errors': []
        }

        # Pre-load all stock IDs in one query so threads make zero DB calls
        stock_rows = supabase.table('stocks').select('id,ticker').in_('ticker', watchlist).execute()
        stock_id_map: Dict[str, str] = {r['ticker']: r['id'] for r in (stock_rows.data or [])}

        def _fetch_ticker(ticker: str) -> tuple:
            at = asset_type_map.get(ticker, 'stock')
            # persist=False: no Supabase in workers; stubs + batch writes on main thread
            result = sync_stock_data(
                None,
                ticker,
                fetch_quotes=True,
                fetch_news=(at == 'stock'),
                fetch_profile=False,
                asset_type=at,
                write_news=False,    # batch-upserted after pool drains
                write_quotes=False,  # batch-upserted after pool drains
                stock_id=stock_id_map.get(ticker),  # pre-loaded — no DB call in thread
            )
            return ticker, result

        # Phase 1: fetch quotes + news from all tickers — threads make NO DB calls
        all_pending_news: List[Dict[str, Any]] = []
        all_pending_quotes: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=2) as executor:  # 2 Finnhub keys → 2 concurrent workers
            futures = {executor.submit(_fetch_ticker, t): t for t in watchlist}
            for future in as_completed(futures):
                ticker, st = future.result()
                total_stats['stocks_processed'] += 1
                total_stats['errors'].extend(stats.get('errors', []))
                all_pending_news.extend(stats.get('pending_news', []))
                all_pending_quotes.extend(stats.get('pending_quotes', []))

        # Phase 2: single batch upsert for all quotes after all threads complete
        if all_pending_quotes:
            try:
                resp = supabase.table('stock_quotes').upsert(
                    all_pending_quotes, on_conflict='stock_id,quote_timestamp'
                ).execute()
                total_stats['quotes_inserted'] = len(resp.data) if resp.data else 0
            except Exception as e:
                total_stats['errors'].append(f"Error batch-upserting quotes: {e}")

        # Phase 3: single batch upsert for all company news after all threads complete
        if all_pending_news:
            news_for_db: List[Dict[str, Any]] = []
            for r in all_pending_news:
                tid = r.get('ticker')
                if tid:
                    sid = ticker_to_id.get(tid)
                    if not sid:
                        total_stats['errors'].append(f"No stock_id for company news ticker {tid}")
                        continue
                    news_for_db.append(
                        {
                            'stock_id': sid,
                            'headline': r.get('headline'),
                            'summary': r.get('summary'),
                            'url': r.get('url'),
                            'image_url': r.get('image_url'),
                            'source': r.get('source'),
                            'published_at': r.get('published_at'),
                        }
                    )
                elif r.get('stock_id'):
                    news_for_db.append(r)
            seen: set = set()
            deduped = [r for r in news_for_db if not (r['url'] in seen or seen.add(r['url']))]
            try:
                resp = supabase.table('company_news').upsert(deduped, on_conflict='url').execute()
                total_stats['news_inserted'] = len(resp.data) if resp.data else 0
            except Exception as e:
                total_stats['errors'].append(f"Error batch-upserting company news: {e}")

        # Run market-news, sentiment, and econ-indicators in parallel —
        # each hits a different API (Finnhub / AV / FMP) so there is no contention.
        post_fns: Dict[str, Any] = {
            'market_news': lambda: sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES),
            'econ':        lambda: sync_economic_indicators(supabase),
        }
        if not skip_sentiment:
            post_fns['sentiment'] = lambda: sync_news_sentiment(
                supabase, topics=SENTIMENT_TOPICS_ALL, tickers=watchlist
            )

        with ThreadPoolExecutor(max_workers=len(post_fns)) as post_pool:
            post_futures = {post_pool.submit(fn): name for name, fn in post_fns.items()}
            for future in as_completed(post_futures):
                name = post_futures[future]
                try:
                    s = future.result()
                except Exception as e:
                    total_stats['errors'].append(f"Error in {name}: {e}")
                    continue
                if name == 'market_news':
                    total_stats['market_news_inserted'] = s.get('articles_inserted', 0)
                    total_stats['errors'].extend(s.get('errors', []))
                elif name == 'sentiment':
                    total_stats['sentiment_upserted'] = s.get('articles_upserted', 0)
                    total_stats['errors'].extend(s.get('errors', []))
                elif name == 'econ':
                    total_stats['economic_rows_upserted'] = s.get('rows_upserted', 0)
                    total_stats['errors'].extend(s.get('errors', []))


        return {'success': True, 'stats': total_stats}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_news_etl(supabase: Client, sections: Optional[List[str]] = None) -> Dict[str, Any]:
    """Run news ETL: NYT top stories."""
    if sections is None:
        sections = DEFAULT_NYT_SECTIONS
    try:
        return {
            'success': True, 
            'stats': sync_nyt_data(supabase, sections=sections)
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_media_etl(
    supabase: Client,
    subreddits: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Run media ETL: Spotify new releases and Reddit hot posts."""
    if subreddits is None:
        subreddits = DEFAULT_SUBREDDITS

    try:
        spotify_stats = sync_spotify_data(supabase)
        reddit_stats = sync_reddit_data(supabase, subreddits=subreddits)

        return {'success': True, 'stats': {
            'spotify_releases': spotify_stats.get('releases_inserted', 0),
            'reddit_posts': reddit_stats.get('posts_inserted', 0),
            'errors': spotify_stats.get('errors', []) + reddit_stats.get('errors', []),
        }}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_etfdb_etl(supabase: Client) -> None:
    """Scrape ETF info and top-15 holdings from etfdb.com. Manual trigger only.

    DEPRECATED — ETF holdings are now fetched via Alpha Vantage ETF_PROFILE
    (sync_av_etf_holdings in markets_db_helper.py). This scraper is kept for
    manual enrichment of ETFdb-only fields (expense ratio, AUM, category) but
    is no longer part of the seed or daily pipeline.
    """
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    etf_tickers = [t for tickers in baskets.values() for t in tickers
                   if asset_type_map.get(t) == 'etf']

    print(f"ETFs to scrape: {len(etf_tickers)}")

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
        stats = sync_fmp_data(
            supabase,
            watchlist=tickers_to_process,
            etf_tickers=etf_tickers,
            skip_holdings=skip_holdings
        )

        # print(f"\nFMP ETL Complete:")
        # print(f"  Company profiles updated: {stats['profiles_updated']}")
        # print(f"  ETF info updated:         {stats['etf_info_updated']}")
        # print(f"  ETF holdings upserted:    {stats['etf_holdings_upserted']}")
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
) -> Dict[str, Any]:
    """
    Run the full ETL pipeline for all data sources.
    Markets = today's quotes + company news + market news + AV sentiment (all 10 topics).
    Quote backfill (OHLCV history) is not part of the daily run — use run_db_seed.py.
    Profile updates: --refresh-profiles (FMP) or --scrape-etf-info (ETFdb).
    """
    start_time = datetime.now()

    results = {
        'started_at': start_time.isoformat(),
        'sports': None,
        'markets': None,
        'news': None,
        'media': None,
    }

    domain_fns = {}
    if not skip_sports:
        domain_fns['sports'] = lambda: run_sports_etl(get_supabase_client())
    if not skip_markets:
        domain_fns['markets'] = lambda: run_markets_etl(
            get_supabase_client(),
            watchlist=watchlist,
            skip_sentiment=skip_sentiment,
        )
    if not skip_news:
        domain_fns['news'] = lambda: run_news_etl(get_supabase_client())
    if not skip_media:
        domain_fns['media'] = lambda: run_media_etl(get_supabase_client())

    # Run all domains in parallel. Each domain thread fetches from external APIs then
    # writes to Supabase in a single batch upsert per table.
    domain_elapsed: Dict[str, float] = {}

    def _timed(domain: str, fn) -> Dict[str, Any]:
        t0 = datetime.now()
        try:
            return fn()
        finally:
            domain_elapsed[domain] = (datetime.now() - t0).total_seconds()

    if domain_fns:
        executor = ThreadPoolExecutor(max_workers=len(domain_fns))
        domain_futures = {
            executor.submit(_timed, domain, fn): domain
            for domain, fn in domain_fns.items()
        }
        for future in as_completed(domain_futures):
            domain = domain_futures[future]
            try:
                results[domain] = future.result()
                elapsed = domain_elapsed.get(domain, 0)
                ok = results[domain].get('success', False)
                status = 'OK  ' if ok else 'FAIL'
                print(f"  [{status}] {domain:<8}  {elapsed:.1f}s")
            except Exception as e:
                results[domain] = {'success': False, 'error': str(e)}
                print(f"  [FAIL] {domain:<8}  {str(e)[:60]}")

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    # ── Final output table ────────────────────────────────────────────────────
    W = 60
    print("=" * W)
    print(f"INFO AGGREGATOR — ETL COMPLETE")
    print(f"Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}  ·  Duration: {duration:.1f}s")
    print("=" * W)

    DOMAIN_ORDER = ['sports', 'markets', 'news', 'media']

    def _stat_str(domain: str, result: Dict[str, Any]) -> str:
        s = result.get('stats', {})
        if domain == 'sports':
            return (f"leagues={s.get('leagues_processed',0)}  "
                    f"news={s.get('news_inserted',0)}  "
                    f"scores={s.get('scores_inserted',0)}")
        if domain == 'markets':
            return (f"tickers={s.get('stocks_processed',0)}  "
                    f"cnews={s.get('news_inserted',0)}  "
                    f"mnews={s.get('market_news_inserted',0)}  "
                    f"sentiment={s.get('sentiment_upserted',0)}  "
                    f"econ={s.get('economic_rows_upserted',0)}")
        if domain == 'news':
            return (f"sections={s.get('sections_processed',0)}  "
                    f"articles={s.get('articles_inserted',0)}")
        if domain == 'media':
            return (f"spotify={s.get('spotify_releases',0)}  "
                    f"reddit={s.get('reddit_posts',0)}")
        return ''

    passed = failed = 0
    for domain in DOMAIN_ORDER:
        result = results.get(domain)
        if result is None:
            continue
        elapsed = domain_elapsed.get(domain, 0)
        ok = result.get('success', False)
        status = ' OK ' if ok else 'FAIL'
        stat_str = _stat_str(domain, result) if ok else result.get('error', '')
        print(f"  {domain:<8} [{status}]  {stat_str:<48}  {elapsed:.1f}s")
        errors = result.get('stats', {}).get('errors', [])
        if errors:
            for e in errors[:3]:
                print(f"             ↳ {e}")
            if len(errors) > 3:
                print(f"             ↳ … and {len(errors) - 3} more errors")
        passed += ok
        failed += (not ok)

    print("-" * W)
    print(f"  {passed} passed · {failed} failed · {duration:.1f}s total")
    print("=" * W)

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

    # ── Markets options ───────────────────────────────────────────────────────
    parser.add_argument('--scrape-etf-info', action='store_true',
                        help='Scrape ETF info and top-15 holdings from etfdb.com '
                             '(run manually, not on daily/seed)')
    parser.add_argument('--skip-sentiment', action='store_true',
                        help='Skip AV news sentiment (daily run: quotes + news only)')
    parser.add_argument('--watchlist', nargs='+', metavar='TICKER',
                        help='Override basket watchlist with a custom ticker list')

    # ── Test / dry-run ────────────────────────────────────────────────────────
    parser.add_argument('--test', action='store_true',
                        help='Dry-run: test every external API endpoint once and print PASS/FAIL table')

    # ── Output ────────────────────────────────────────────────────────────────
    parser.add_argument('--output', metavar='FILE', help='Write results JSON to FILE')

    args = parser.parse_args()

    # --test: dry-run endpoint test, no DB writes
    if args.test:
        test_script = Path(__file__).parent / 'run_test.py'
        import subprocess
        result = subprocess.run([sys.executable, str(test_script)], check=False)
        sys.exit(result.returncode)

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
