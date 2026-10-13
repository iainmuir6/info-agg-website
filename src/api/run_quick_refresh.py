#!/usr/bin/env python3
# run_quick_refresh.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-23
# Description: Tiered intraday refresh — the frequent counterpart to the
#              daily run_etl.py. Slots come from vercel.json (one Vercel Cron
#              entry per hour, each once a day, ±59 min):
#
#   Tier A (9 slots): Finnhub quotes for stocks/ETFs/crypto, ESPN
#       scoreboards, Finnhub market news. Consumes no daily API budget.
#   Tier B (6 slots): tier A + NYT top stories, ESPN news, Frankfurter forex
#       and FMP commodity quotes (3 FMP calls/run against the 250/day cap).
#
#   AV sentiment, FMP economic indicators and retention cleanup are
#   daily-only — see run_etl.py.

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
    _sports_outcome,
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

# How many consecutive intraday runs may lose a whole upstream before the
# outage stops being treated as noise. Sports and markets run in every slot
# (roughly hourly 10-01 UTC), so two runs is about an hour down. News is tier B
# only (10/11/12/16/19/22 UTC), so two runs is one to four hours without NYT.
DEGRADE_STREAK = {'sports': 2, 'markets': 2, 'news': 2}

# Runs of history to read for those streaks. Must reach back past the tier-A
# runs that sit between tier-B ones (up to three in a row), or news never sees
# its own previous run and can never escalate. A day's worth covers it.
STREAK_HISTORY_RUNS = 16


def _is_upstream_outage(domain: str, stats: Dict[str, Any]) -> bool:
    """True when the domain wrote nothing because its API gave it nothing.

    Deliberately narrower than "the domain failed". Each domain has two ways to
    write zero rows, and only one of them is the upstream's fault:

      * nothing was attempted (0 leagues / 0 tickers / 0 sections) — the league
        or stock lookup broke, which is ours, or
      * rows were fetched and then none were written — the upsert died, also
        ours.

    Both stay loud. What degrades is the third shape: everything was attempted,
    and every call to the outside came back empty or failing.
    """
    if domain == 'sports':
        attempted = stats.get('leagues_processed', 0)
        return attempted > 0 and stats.get('leagues_failed', 0) >= attempted
    if domain == 'markets':
        return (stats.get('stocks_processed', 0) > 0
                and stats.get('quotes_pending', 0) == 0)
    if domain == 'news':
        return (stats.get('sections_processed', 0) > 0
                and stats.get('articles_pending', 0) == 0)
    return False


def _recent_intraday_stats(supabase) -> List[Dict[str, Any]]:
    """The previous finished intraday runs' per-domain stats, newest first.

    One query serves every domain's streak count. Errors return an empty
    history — the quiet path — because failing to read the history is not
    itself evidence of an outage.
    """
    try:
        resp = (supabase.table('etl_runs')
                .select('stats')
                .in_('tier', ['a', 'b'])
                .neq('status', 'running')
                .order('started_at', desc=True)
                .limit(STREAK_HISTORY_RUNS)
                .execute())
    except Exception as e:
        log.warning('could not read degraded-run history: %s', e)
        return []
    return [row.get('stats') or {} for row in (resp.data or [])]


def _degraded_streak(history: List[Dict[str, Any]], domain: str) -> int:
    """Consecutive recent runs where this domain lost its upstream.

    Runs that did not touch the domain at all are skipped rather than counted
    as healthy — otherwise the tier-A runs between two tier-B ones would reset
    news's streak on every pass, and news could never escalate.
    """
    streak = 0
    for stats in history:
        domain_stats = stats.get(domain)
        if not isinstance(domain_stats, dict):
            continue
        if not domain_stats.get('degraded'):
            break
        streak += 1
    return streak


def run_quick_markets_etl(supabase, include_fmp_quotes: bool) -> Dict[str, Any]:
    """Quotes + market news. Skips company news, sentiment, econ, profiles.

    include_fmp_quotes=False drops forex/commodity tickers so tier A never
    touches the FMP daily budget.
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

    # Same reason as news's articles_pending: 0 quotes written is either every
    # Finnhub call failing or the upsert dying, and only the fetched count
    # separates them.
    total_stats['quotes_pending'] = len(pending_quotes)

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
        # Same rule as the daily run. The old one was `rows > 0 or not
        # include_news`, which is unconditionally true on tier A — a scores-only
        # refresh could never report a failure, so a total ESPN outage on
        # tier A was indistinguishable from a night with no games.
        ok, reason = _sports_outcome(stats)
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = reason
        return result
    except Exception as e:
        return {'success': False, 'error': str(e),
                'stats': {'errors': [f"sports failed: {e}"]}}


def run_quick_refresh(tier: str, triggered_by: str = 'manual') -> Dict[str, Any]:
    """Run a tiered refresh: tier 'a' or 'b' (slots in vercel.json)."""
    start_time = et_now()
    # Tighter than the daily run: refreshes fire about hourly and must never
    # pile up behind each other.
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

    timed_out: set = set()
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
                    timed_out.add(domain)
                    results[domain] = {
                        'success': False,
                        'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout',
                    }

    # The executor joins every worker on exit, so a domain reported as timed
    # out has in fact finished — and may have written rows. Recover its result
    # and keep the overrun as an error (see run_etl.py for the full note).
    for future, domain in domain_futures.items():
        if domain not in timed_out or not future.done() or future.cancelled():
            continue
        try:
            recovered = future.result()
        except Exception as e:
            recovered = {'success': False, 'error': str(e)}
        stats = dict(recovered.get('stats') or {})
        stats['errors'] = ([f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout']
                           + list(stats.get('errors') or []))
        results[domain] = {**recovered, 'stats': stats, 'success': False,
                           'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout'}

    run_deadline.clear()

    end_time = et_now()
    duration = (end_time - start_time).total_seconds()
    results['completed_at'] = end_time.isoformat()
    results['duration_seconds'] = duration

    active = {d: r for d, r in results.items()
              if d in ('sports', 'markets', 'news') and isinstance(r, dict)}

    # A domain that failed only because its upstream went dark is reported but
    # does not fail the run. These fetchers sit behind APIs that intermittently
    # 403 or 429 a datacenter IP (ESPN's site.api does it to GitHub Actions
    # runners; Finnhub and NYT rate-limit) and clear by themselves minutes
    # later — that is noise, not an incident: the next refresh is about an
    # hour out and the daily run backfills regardless. Failing here
    # costs a red build and a GitHub failure email for something that fixed
    # itself before anyone read it.
    #
    # Until it keeps happening. Each degraded run records `degraded` in its
    # stats; at DEGRADE_STREAK consecutive runs the outage stops being a blip
    # and goes back to being a failure, so the workflow exits 1 and GitHub
    # sends its email.
    degradable = {d: r for d, r in active.items()
                  if not r.get('success') and _is_upstream_outage(d, r.get('stats') or {})}
    history = _recent_intraday_stats(supabase) if degradable else []
    for domain, result in degradable.items():
        stats = result.get('stats') or {}
        streak = _degraded_streak(history, domain) + 1
        if streak >= DEGRADE_STREAK[domain]:
            # Clear the flag in the persisted stats too, so this run breaks the
            # streak it just reported on. A genuinely sustained outage then
            # fails once per DEGRADE_STREAK runs rather than mailing on every
            # refresh until the API comes back.
            stats['degraded'] = False
            result['error'] = (f"{result.get('error', domain + ' failed')} "
                               f"({streak} consecutive intraday runs)")
            log.error('%s upstream down for %d consecutive runs — failing the run',
                      domain, streak)
        else:
            result['degraded'] = True
            stats['degraded'] = True
            log.warning('%s lost its upstream (run %d of %d before this fails '
                        'the run) — reporting partial',
                        domain, streak, DEGRADE_STREAK[domain])

    all_errors = collect_domain_errors(active)
    if any(not r.get('success') and not r.get('degraded') for r in active.values()):
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

    passed = failed = degraded_n = 0
    for domain in ['sports', 'markets', 'news']:
        result = results.get(domain)
        if not isinstance(result, dict):
            continue
        elapsed = domain_elapsed.get(domain, 0)
        ok = result.get('success', False)
        degraded = result.get('degraded', False)
        status = ' OK ' if ok else ('WARN' if degraded else 'FAIL')
        stat_str = _stat_str(domain, result) if ok else result.get('error', '')
        print(f"  {domain:<8} [{status}]  {stat_str:<48}  {elapsed:.1f}s")
        errors = result.get('stats', {}).get('errors', [])
        if errors:
            for e in errors[:3]:
                print(f"             ↳ {e}")
            if len(errors) > 3:
                print(f"             ↳ … and {len(errors) - 3} more errors")
        passed += ok
        degraded_n += degraded
        failed += (not ok and not degraded)

    print("-" * W)
    tally = f"  {passed} passed · {failed} failed"
    if degraded_n:
        tally += f" · {degraded_n} degraded"
    print(f"{tally} · {duration:.1f}s total")
    print("=" * W)

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Tiered intraday refresh')
    parser.add_argument('--tier', choices=['a', 'b'], default='a',
                        help="'a' = quotes/scores/market news, no daily API "
                             "budget; 'b' = adds NYT, ESPN news, forex and "
                             "FMP commodity quotes")
    parser.add_argument('--triggered-by', default='manual',
                        choices=['manual', 'cron', 'dispatch'])
    args = parser.parse_args()

    results = run_quick_refresh(args.tier, triggered_by=args.triggered_by)
    sys.exit(1 if results.get('status') == 'failed' else 0)
