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

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from etl_lib import (
    get_logger,
    preflight_env,
    distinct_env_values,
    start_etl_run,
    finish_etl_run,
    collect_domain_errors,
)
from sports.sports_db_helper import sync_all_sports_data, sync_season_schedules, sync_standings
from markets.markets_db_helper import (
    sync_stock_data,
    sync_market_news,
    sync_news_sentiment,
    sync_economic_indicators,
    sync_fmp_data,
    sync_etfdb_data,
    upsert_daily_stock_quotes_batch,
)
from news.news_db_helper import sync_nyt_data
from media.media_db_helper import sync_youtube_data

load_dotenv()

log = get_logger('etl')

# Per-domain wall-clock ceiling. A domain that exceeds this is reported as
# failed; the full run should finish in well under 60s (see CLAUDE.md).
DOMAIN_TIMEOUT_S = 600

BASKETS_PATH = Path(__file__).parent / 'markets' / 'baskets.json'

DEFAULT_NYT_SECTIONS = [
    'us', 'world', 'opinion', 'business', 'insider',
    'realestate', 'science', 'technology', 'arts',
    # 'sports', 'politics', 'movies', 'nyregion', 
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


def run_sports_etl(supabase: Client, season_schedules: bool = False) -> Dict[str, Any]:
    """Run sports ETL: ESPN news and scores (today's snapshot).

    season_schedules=True additionally walks each in-season league's full
    season so team pages show complete win/loss records, and refreshes
    standings — both daily-only (one ESPN standings call per league, ~9
    total, so this stays well inside the 60s ETL budget).
    """
    try:
        stats = sync_all_sports_data(supabase, news_limit_per_sport=20)
        if season_schedules:
            season_stats = sync_season_schedules(supabase)
            stats['season_leagues'] = season_stats.get('leagues_processed', 0)
            stats['season_scores'] = season_stats.get('scores_inserted', 0)
            stats['errors'].extend(season_stats.get('errors', []))

            standings_stats = sync_standings(supabase)
            stats['standings_leagues'] = standings_stats.get('leagues_processed', 0)
            stats['standings_rows'] = standings_stats.get('rows_inserted', 0)
            stats['errors'].extend(standings_stats.get('errors', []))
        # Honest success: ESPN always has news, so writing nothing at all
        # means the fetch or the writes failed — not a quiet day.
        ok = (stats['news_inserted'] + stats['scores_inserted']) > 0
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = 'sports wrote 0 rows (fetch or upsert failure)'
        return result
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
                t = futures[future]
                # One bad ticker must not discard every other ticker's
                # already-fetched quotes and news.
                try:
                    ticker, st = future.result()
                except Exception as e:
                    total_stats['errors'].append(f"{t}: fetch failed: {e}")
                    continue
                total_stats['stocks_processed'] += 1
                total_stats['errors'].extend(st.get('errors', []))
                all_pending_news.extend(st.get('pending_news', []))
                all_pending_quotes.extend(st.get('pending_quotes', []))

        # Phase 2: chunked batch upsert for all quotes after all threads complete
        if all_pending_quotes:
            inserted = upsert_daily_stock_quotes_batch(supabase, all_pending_quotes)
            total_stats['quotes_inserted'] = inserted
            if inserted < len(all_pending_quotes):
                total_stats['errors'].append(
                    f"Quote upsert wrote {inserted}/{len(all_pending_quotes)} rows"
                )

        # Phase 3: single batch upsert for all company news after all threads complete
        if all_pending_news:
            news_for_db: List[Dict[str, Any]] = []
            for r in all_pending_news:
                tid = r.get('ticker')
                if tid:
                    sid = stock_id_map.get(tid)
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
            # Chunked upsert so one rejected payload can't lose the whole batch
            inserted = 0
            for i in range(0, len(deduped), 100):
                chunk = deduped[i:i + 100]
                try:
                    supabase.table('company_news').upsert(chunk, on_conflict='url').execute()
                    inserted += len(chunk)
                except Exception as e:
                    total_stats['errors'].append(
                        f"Company news chunk {i}-{i + len(chunk)} failed: {e}"
                    )
            total_stats['news_inserted'] = inserted

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

        # Honest success: the daily run must always produce quotes. Zero
        # quotes written means the fetch pool or the upsert failed wholesale.
        ok = total_stats['quotes_inserted'] > 0
        result: Dict[str, Any] = {'success': ok, 'stats': total_stats}
        if not ok:
            result['error'] = 'markets wrote 0 quote rows'
        return result

    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_news_etl(supabase: Client, sections: Optional[List[str]] = None) -> Dict[str, Any]:
    """Run news ETL: NYT top stories."""
    if sections is None:
        sections = DEFAULT_NYT_SECTIONS
    try:
        stats = sync_nyt_data(supabase, sections=sections)
        ok = stats.get('articles_inserted', 0) > 0
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = 'news wrote 0 articles'
        return result
    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_media_etl(supabase: Client) -> Dict[str, Any]:
    """Run media ETL: YouTube trending videos.

    Spotify (new releases) and Reddit (hot posts) were removed — Spotify's
    media page/homepage surfaces are now live embedded playlists/shows with
    no backend fetch, and Reddit blocked datacenter IPs without OAuth.
    """
    try:
        youtube_stats = sync_youtube_data(supabase)

        stats = {
            'youtube_videos': youtube_stats.get('videos_inserted', 0),
            'errors': youtube_stats.get('errors', []),
        }
        ok = stats['youtube_videos'] > 0
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = 'media wrote 0 rows from any source'
        return result
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
    triggered_by: str = 'manual',
    run_cleanup: bool = False,
    season_schedules: bool = False,
) -> Dict[str, Any]:
    """
    Run the full ETL pipeline for all data sources.
    Markets = today's quotes + company news + market news + AV sentiment (all 10 topics).
    Quote backfill (OHLCV history) is not part of the daily run — use run_db_seed.py.
    Profile updates: --refresh-profiles (FMP) or --scrape-etf-info (ETFdb).
    """
    start_time = datetime.now()

    # Sentiment on <2 distinct AV keys trips the 5/min limiter into a ~60s
    # sleep and blows the <60s run budget — skip it and say so.
    av_keys = distinct_env_values('ALPHA_VANTAGE_API_KEY', 'ALPHA_VANTAGE_API_KEY_1',
                                  'ALPHA_VANTAGE_API_KEY_2', 'ALPHA_VANTAGE_API_KEY_3')
    if not skip_sentiment and not skip_markets and len(av_keys) < 2:
        log.warning('only %d distinct Alpha Vantage key(s) — skipping sentiment', len(av_keys))
        skip_sentiment = True

    results = {
        'started_at': start_time.isoformat(),
        'sports': None,
        'markets': None,
        'news': None,
        'media': None,
    }

    # Observability: record the run (best-effort — never blocks the pipeline)
    try:
        run_supabase = get_supabase_client()
    except Exception as e:
        log.warning('no Supabase client for run recording: %s', e)
        run_supabase = None
    run_id = start_etl_run(run_supabase, triggered_by, 'daily') if run_supabase else None

    domain_fns = {}
    if not skip_sports:
        domain_fns['sports'] = lambda: run_sports_etl(get_supabase_client(), season_schedules=season_schedules)
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
    # writes to Supabase in batch upserts per table.
    domain_elapsed: Dict[str, float] = {}

    def _timed(domain: str, fn) -> Dict[str, Any]:
        t0 = datetime.now()
        try:
            return fn()
        finally:
            domain_elapsed[domain] = (datetime.now() - t0).total_seconds()

    if domain_fns:
        with ThreadPoolExecutor(max_workers=len(domain_fns)) as executor:
            domain_futures = {
                executor.submit(_timed, domain, fn): domain
                for domain, fn in domain_fns.items()
            }
            try:
                for future in as_completed(domain_futures, timeout=DOMAIN_TIMEOUT_S):
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
            except TimeoutError:
                for future, domain in domain_futures.items():
                    if results.get(domain) is None:
                        results[domain] = {
                            'success': False,
                            'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout',
                        }
                        print(f"  [FAIL] {domain:<8}  timed out")

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    # Optional retention cleanup (daily workflow passes --cleanup)
    cleanup_report: Optional[Dict[str, Any]] = None
    if run_cleanup and run_supabase:
        try:
            resp = run_supabase.rpc('cleanup_daily').execute()
            cleanup_report = resp.data
            log.info('cleanup_daily: %s', json.dumps(cleanup_report))
        except Exception as e:
            cleanup_report = {'error': str(e)}
            log.error('cleanup_daily failed: %s', e)
    results['cleanup'] = cleanup_report

    # Roll up run status: failed > partial > success
    active = {d: r for d, r in results.items()
              if d in ('sports', 'markets', 'news', 'media') and r is not None}
    all_errors = collect_domain_errors(active)
    if any(not r.get('success') for r in active.values()):
        run_status = 'failed'
    elif all_errors or (cleanup_report or {}).get('error'):
        run_status = 'partial'
    else:
        run_status = 'success'
    results['status'] = run_status

    finish_etl_run(
        run_supabase, run_id, run_status,
        stats={d: r.get('stats') or {'error': r.get('error')} for d, r in active.items()},
        errors=all_errors,
        duration_seconds=duration,
        cleanup=cleanup_report,
    )

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
            return f"youtube={s.get('youtube_videos',0)}"
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

    # ── Output / observability ───────────────────────────────────────────────
    parser.add_argument('--output', metavar='FILE', help='Write results JSON to FILE')
    parser.add_argument('--triggered-by', default='manual',
                        choices=['manual', 'cron', 'dispatch'],
                        help='Recorded in etl_runs (workflows pass cron/dispatch)')
    parser.add_argument('--cleanup', action='store_true',
                        help='Run info_agg.cleanup_daily() retention after the ETL completes')
    parser.add_argument('--season-schedules', action='store_true',
                        help='Also fetch full season schedules for in-season leagues '
                             '(complete team records; daily run only)')

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

    # Preflight: fail fast on a hopeless environment, log degradations
    fatal, env_warnings = preflight_env()
    for w in env_warnings:
        log.warning('preflight: %s', w)
    if fatal:
        for f_msg in fatal:
            log.error('preflight: %s', f_msg)
        sys.exit(1)

    results = run_full_etl(
        watchlist=args.watchlist,
        skip_sports=args.skip_sports,
        skip_markets=args.skip_markets,
        skip_news=args.skip_news,
        skip_media=args.skip_media,
        skip_sentiment=args.skip_sentiment,
        triggered_by=args.triggered_by,
        run_cleanup=args.cleanup,
        season_schedules=args.season_schedules,
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nResults written to {args.output}")

    # Exit 1 on any hard domain failure; 'partial' (errors but data written)
    # stays green — it is visible in etl_runs and the stdout report.
    sys.exit(1 if results.get('status') == 'failed' else 0)


if __name__ == "__main__":
    main()
