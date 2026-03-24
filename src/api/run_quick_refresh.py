#!/usr/bin/env python3
# run_quick_refresh.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-23
# Description: Quick-refresh ETL — sports + news + stock quotes only.
#              Skips sentiment, market news, economic indicators, profile backfill, and media.
#              Designed for fast, on-demand refreshes triggered from the admin UI.

import os
import sys

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Dict, Any, List

from dotenv import load_dotenv

from run_etl import (
    load_baskets,
    classify_tickers,
    get_supabase_client,
    run_sports_etl,
    run_news_etl,
)
from markets.markets_db_helper import sync_stock_data

load_dotenv()


def run_quick_markets_etl(supabase) -> Dict[str, Any]:
    """Quotes-only markets ETL: fetches latest price for every basket ticker.

    Skips company news, market news, AV sentiment, economic indicators,
    and profile backfill — only OHLCV quote rows are written.
    """
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    all_tickers: List[str] = [t for tickers in baskets.values() for t in tickers]

    total_stats: Dict[str, Any] = {
        'stocks_processed': 0,
        'quotes_inserted': 0,
        'errors': [],
    }

    def _fetch_ticker(ticker: str) -> tuple:
        at = asset_type_map.get(ticker, 'stock')
        result = sync_stock_data(
            supabase,
            ticker,
            fetch_quotes=True,
            fetch_news=False,
            fetch_profile=False,
            asset_type=at,
            write_news=False,
        )
        return ticker, result

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(_fetch_ticker, t): t for t in all_tickers}
        for future in as_completed(futures):
            _ticker, stats = future.result()
            total_stats['stocks_processed'] += 1
            total_stats['quotes_inserted'] += stats.get('quotes_inserted', 0)
            total_stats['errors'].extend(stats.get('errors', []))

    return {'success': True, 'stats': total_stats}


def run_quick_refresh() -> Dict[str, Any]:
    """Run quick refresh: sports + news + stock quotes in parallel."""
    start_time = datetime.now()
    supabase = get_supabase_client()

    domain_fns = {
        'sports':  lambda: run_sports_etl(supabase),
        'news':    lambda: run_news_etl(supabase),
        'markets': lambda: run_quick_markets_etl(supabase),
    }

    results: Dict[str, Any] = {'started_at': start_time.isoformat()}
    domain_elapsed: Dict[str, float] = {}

    def _timed(domain: str, fn) -> Dict[str, Any]:
        t0 = datetime.now()
        result = fn()
        domain_elapsed[domain] = (datetime.now() - t0).total_seconds()
        return result

    with ThreadPoolExecutor(max_workers=len(domain_fns)) as executor:
        domain_futures = {
            executor.submit(_timed, domain, fn): domain
            for domain, fn in domain_fns.items()
        }
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

    # ── Output table ──────────────────────────────────────────────────────────
    W = 60
    print("=" * W)
    print("INFO AGGREGATOR — QUICK REFRESH COMPLETE")
    print(f"Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}  ·  Duration: {duration:.1f}s")
    print("=" * W)

    def _stat_str(domain: str, result: Dict[str, Any]) -> str:
        s = result.get('stats', {})
        if domain == 'sports':
            return (f"leagues={s.get('leagues_processed', 0)}  "
                    f"news={s.get('news_inserted', 0)}  "
                    f"scores={s.get('scores_inserted', 0)}")
        if domain == 'markets':
            return (f"tickers={s.get('stocks_processed', 0)}  "
                    f"quotes={s.get('quotes_inserted', 0)}")
        if domain == 'news':
            return (f"sections={s.get('sections_processed', 0)}  "
                    f"articles={s.get('articles_inserted', 0)}")
        return ''

    passed = failed = 0
    for domain in ['sports', 'news', 'markets']:
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


if __name__ == "__main__":
    results = run_quick_refresh()
    any_failed = any(
        r and not r.get('success')
        for r in [results.get('sports'), results.get('news'), results.get('markets')]
        if r is not None
    )
    sys.exit(1 if any_failed else 0)
