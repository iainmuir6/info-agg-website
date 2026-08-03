#!/usr/bin/env python3
# run_quick_refresh.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-23
# Description: Tiered intraday refresh — the frequent counterpart to the
#              daily run_etl.py. Budgets per docs/IMPROVEMENT_PLAN.md §1.1:
#
#   Tier A (every 15 min): Finnhub quotes for stocks/ETFs/crypto, ESPN
#       scoreboards, Finnhub market news. Consumes no daily API budget.
#   Tier B (hourly): tier A + NYT top stories, ESPN news, and FMP
#       forex/commodity quotes (13 calls/run against the 250/day cap).
#
#   AV sentiment, FMP economic indicators, Spotify, and retention cleanup
#   are daily-only — see run_etl.py.

import os
import sys
import argparse

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Dict, Any, List

from dotenv import load_dotenv

from etl_lib import (
    get_logger,
    et_now,
    run_deadline,
    start_etl_run,
    finish_etl_run,
    collect_domain_errors,
)
from run_etl import (
    load_baskets,
    classify_tickers,
    get_supabase_client,
    run_news_etl,
    MARKET_NEWS_CATEGORIES,
    DOMAIN_TIMEOUT_S,
)
from sports.sports_db_helper import sync_all_sports_data
from markets.markets_db_helper import (
    sync_stock_data,
    sync_market_news,
    upsert_daily_stock_quotes_batch,
)

load_dotenv()

log = get_logger('quick_refresh')

# Asset types quoted via FMP (250 req/day budget) — excluded from tier A
FMP_ASSET_TYPES = {'forex', 'commodity'}


def run_quick_markets_etl(supabase, include_fmp_quotes: bool) -> Dict[str, Any]:
    """Quotes + market news. Skips company news, sentiment, econ, profiles.

    include_fmp_quotes=False drops forex/commodity tickers so the 15-min
    cadence never touches the FMP daily budget.
    """
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    tickers: List[str] = [
        t for group in baskets.values() for t in group
        if include_fmp_quotes or asset_type_map.get(t, 'stock') not in FMP_ASSET_TYPES
    ]

    total_stats: Dict[str, Any] = {
        'stocks_processed': 0,
        'quotes_inserted': 0,
        'market_news_inserted': 0,
        'errors': [],
    }

    # Pre-load stock IDs in ONE query so worker threads make zero DB calls
    # (same pattern as run_etl — concurrent per-thread lookups through the
    # shared client intermittently failed, e.g. TLT/XRP/EURUSD).
    stock_rows = supabase.table('stocks').select('id,ticker').in_('ticker', tickers).execute()
    stock_id_map: Dict[str, str] = {r['ticker']: r['id'] for r in (stock_rows.data or [])}

    def _fetch_ticker(ticker: str) -> tuple:
        at = asset_type_map.get(ticker, 'stock')
        result = sync_stock_data(
            None,
            ticker,
            fetch_quotes=True,
            fetch_news=False,
            fetch_profile=False,
            asset_type=at,
            write_news=False,
            write_quotes=False,  # batch-upserted after the pool drains
            stock_id=stock_id_map.get(ticker),
        )
        return ticker, result

    pending_quotes: list = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(_fetch_ticker, t): t for t in tickers}
        for future in as_completed(futures):
            t = futures[future]
            try:
                _ticker, stats = future.result()
            except Exception as e:
                total_stats['errors'].append(f"{t}: fetch failed: {e}")
                continue
            total_stats['stocks_processed'] += 1
            total_stats['errors'].extend(stats.get('errors', []))
            pending_quotes.extend(stats.get('pending_quotes', []))

    if pending_quotes:
        inserted = upsert_daily_stock_quotes_batch(
            supabase, pending_quotes, errors=total_stats['errors']
        )
        total_stats['quotes_inserted'] = inserted
        if inserted < len(pending_quotes):
            total_stats['errors'].append(
                f"Quote upsert wrote {inserted}/{len(pending_quotes)} rows"
            )

    try:
        news_stats = sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES)
        total_stats['market_news_inserted'] = news_stats.get('articles_inserted', 0)
        total_stats['errors'].extend(news_stats.get('errors', []))
    except Exception as e:
        total_stats['errors'].append(f"market news failed: {e}")

    ok = total_stats['quotes_inserted'] > 0
    result: Dict[str, Any] = {'success': ok, 'stats': total_stats}
    if not ok:
        result['error'] = 'quick markets wrote 0 quote rows'
    return result


def run_quick_sports_etl(supabase, include_news: bool) -> Dict[str, Any]:
    try:
        stats = sync_all_sports_data(
            supabase, news_limit_per_sport=20, include_news=include_news
        )
        ok = (stats['news_inserted'] + stats['scores_inserted']) > 0 or not include_news
        # Scores-only runs can legitimately write 0 rows overnight; only a
        # full (news included) run writing nothing is a failure signal.
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = 'sports wrote 0 rows (fetch or upsert failure)'
        return result
    except Exception as e:
        return {'success': False, 'error': str(e)}


def run_quick_refresh(tier: str, triggered_by: str = 'manual') -> Dict[str, Any]:
    """Run a tiered refresh: tier 'a' (15-min) or 'b' (hourly)."""
    start_time = et_now()
    # Tighter than the daily run: this fires every 15 minutes and must never
    # pile up behind itself.
    run_deadline.start(120.0)
    supabase = get_supabase_client()
    run_id = start_etl_run(supabase, triggered_by, tier)

    include_b = tier == 'b'
    # One client per domain thread, matching run_etl.py. Sharing a single
    # client across concurrent domains intermittently dropped lookups
    # (TLT/XRP/EURUSD); the client is not safe to fan out this way.
    domain_fns = {
        'sports':  lambda: run_quick_sports_etl(get_supabase_client(), include_news=include_b),
        'markets': lambda: run_quick_markets_etl(get_supabase_client(), include_fmp_quotes=include_b),
    }
    if include_b:
        domain_fns['news'] = lambda: run_news_etl(get_supabase_client())

    results: Dict[str, Any] = {'started_at': start_time.isoformat()}
    domain_elapsed: Dict[str, float] = {}

    def _timed(domain: str, fn) -> Dict[str, Any]:
        t0 = et_now()
        try:
            return fn()
        finally:
            domain_elapsed[domain] = (et_now() - t0).total_seconds()

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
                except Exception as e:
                    results[domain] = {'success': False, 'error': str(e)}
        except TimeoutError:
            for future, domain in domain_futures.items():
                if domain not in results:
                    results[domain] = {
                        'success': False,
                        'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout',
                    }

    run_deadline.clear()

    end_time = et_now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    active = {d: r for d, r in results.items()
              if d in ('sports', 'markets', 'news') and isinstance(r, dict)}
    all_errors = collect_domain_errors(active)
    if any(not r.get('success') for r in active.values()):
        run_status = 'failed'
    elif all_errors:
        run_status = 'partial'
    else:
        run_status = 'success'
    results['status'] = run_status

    finish_etl_run(
        supabase, run_id, run_status,
        stats={d: r.get('stats') or {'error': r.get('error')} for d, r in active.items()},
        errors=all_errors,
        duration_seconds=duration,
    )

    # ── Output table ──────────────────────────────────────────────────────────
    W = 60
    print("=" * W)
    print(f"INFO AGGREGATOR — QUICK REFRESH (TIER {tier.upper()}) COMPLETE")
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
                    f"quotes={s.get('quotes_inserted', 0)}  "
                    f"mnews={s.get('market_news_inserted', 0)}")
        if domain == 'news':
            return (f"sections={s.get('sections_processed', 0)}  "
                    f"articles={s.get('articles_inserted', 0)}")
        return ''

    passed = failed = 0
    for domain in ['sports', 'markets', 'news']:
        result = results.get(domain)
        if not isinstance(result, dict):
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
    parser = argparse.ArgumentParser(description='Tiered intraday refresh')
    parser.add_argument('--tier', choices=['a', 'b'], default='a',
                        help="'a' = 15-min (quotes/scores/market news, no daily "
                             "API budget); 'b' = hourly (adds NYT, ESPN news, "
                             "FMP forex/commodity quotes)")
    parser.add_argument('--triggered-by', default='manual',
                        choices=['manual', 'cron', 'dispatch'])
    args = parser.parse_args()

    results = run_quick_refresh(args.tier, triggered_by=args.triggered_by)
    sys.exit(1 if results.get('status') == 'failed' else 0)
