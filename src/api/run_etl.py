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
    et_now,
    run_deadline,
    chunked_upsert,
    db_call,
    preflight_env,
    start_etl_run,
    finish_etl_run,
    collect_domain_errors,
    redact_secrets,
)
from sports.sports_db_helper import sync_all_sports_data, sync_season_schedules, sync_standings
from markets.markets_db_helper import (
    sync_stock_data,
    sync_market_news,
    sync_economic_indicators,
    upsert_daily_stock_quotes_batch,
)
from news.news_db_helper import sync_nyt_data
from media.media_db_helper import sync_youtube_data
from misc.misc_db_helper import sync_misc_data
from summary.summary_db_helper import sync_summaries

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


def _sports_outcome(stats: Dict[str, Any]) -> tuple:
    """Decide whether a sports run succeeded. Returns (ok, reason).

    Row count alone cannot answer this. A scores-only refresh at 04:07 UTC
    legitimately writes 0 rows because no game is in progress, which is why the
    intraday tier used to pass unconditionally — and therefore could not report
    an ESPN outage at all. Two things actually distinguish a quiet night from a
    broken one:

      * every league that was attempted failed, or
      * rows were fetched and queued but none of them were written (the upsert
        died), which no row count on its own would show.
    """
    attempted = stats.get('leagues_processed', 0)
    failed = stats.get('leagues_failed', 0)
    pending = stats.get('rows_pending')
    wrote = stats.get('news_inserted', 0) + stats.get('scores_inserted', 0)

    if attempted == 0:
        return False, 'sports processed 0 leagues (league lookup or fetch failed)'
    if failed >= attempted:
        return False, f'sports: all {attempted} league(s) failed to fetch'
    if pending and wrote == 0:
        return False, f'sports fetched {pending} row(s) but wrote 0 (upsert failure)'
    return True, ''


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
        ok, reason = _sports_outcome(stats)
        result: Dict[str, Any] = {'success': ok, 'stats': stats}
        if not ok:
            result['error'] = reason
        return result
    except Exception as e:
        # Keep whatever the domain managed to record. Returning a bare error
        # threw away the counters for rows that were already written, so the
        # dashboard showed an empty domain instead of "wrote this much, then
        # broke".
        return {'success': False, 'error': str(e),
                'stats': {'errors': [f"sports failed: {e}"]}}


def run_markets_etl(
    supabase: Client,
    watchlist: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Daily markets ETL: quotes + company news + market news + economic indicators.
    No quote backfill (OHLCV history) and no profile refresh.
    """
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)

    all_tickers = [t for tickers in baskets.values() for t in tickers]
    if watchlist is None:
        watchlist = all_tickers

    # Outside the try: an exception halfway through must still report the rows
    # that were already written, not an empty domain.
    total_stats: Dict[str, Any] = {
        'stocks_processed': 0,
        'quotes_inserted': 0,
        'news_inserted': 0,
        'market_news_inserted': 0,
        'economic_rows_upserted': 0,
        'errors': []
    }

    try:
        # Pre-load all stock IDs in one query so threads make zero DB calls
        stock_rows = db_call(
            lambda: supabase.table('stocks').select('id,ticker').in_('ticker', watchlist).execute(),
            'stocks prefetch',
        )
        stock_id_map: Dict[str, str] = {r['ticker']: r['id'] for r in (stock_rows.data or [])}

        def _fetch_ticker(ticker: str) -> tuple:
            if run_deadline.expired():
                raise RuntimeError(f"deadline: skipped {ticker} (budget spent)")
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
            submitted = [t for t in watchlist if not run_deadline.expired()]
            if len(submitted) < len(watchlist):
                total_stats['errors'].append(
                    run_deadline.skip_note('ticker(s)', len(watchlist) - len(submitted)))
            futures = {executor.submit(_fetch_ticker, t): t for t in submitted}
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
            inserted = upsert_daily_stock_quotes_batch(
                supabase, all_pending_quotes, errors=total_stats['errors']
            )
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
                            'related_tickers': [tid],
                        }
                    )
                elif r.get('stock_id'):
                    news_for_db.append(r)
            # One row per URL, carrying every ticker that returned it. Keeping
            # "whichever thread finished first" instead made stock_id flip
            # between runs, and the frontend's related_tickers filter only
            # finds an article under the tickers recorded here.
            by_url: Dict[str, Dict[str, Any]] = {}
            for r in news_for_db:
                kept = by_url.setdefault(r['url'], {**r, 'related_tickers': []})
                for t in r.get('related_tickers') or []:
                    if t not in kept['related_tickers']:
                        kept['related_tickers'].append(t)
            deduped = list(by_url.values())
            # Insert-or-skip: the 7-day lookback re-fetches every article ~7
            # times, and rewriting it each time bloated the indexes 3x.
            # Chunked + bisecting: a rejected row costs that row, not the batch.
            total_stats['news_inserted'] = chunked_upsert(
                supabase, 'company_news', deduped,
                on_conflict='url', errors=total_stats['errors'], chunk_size=100,
                ignore_duplicates=True,
            )

        # Run market-news and econ-indicators in parallel — each hits a
        # different API (Finnhub / FMP + FRED) so there is no contention.
        post_fns: Dict[str, Any] = {
            'market_news': lambda: sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES),
            'econ':        lambda: sync_economic_indicators(supabase),
        }

        # Per-source error lists, not just one pooled list: the health check
        # below has to ask "did *this* source explain its own zero?", and a
        # pooled list answers that question for the wrong source.
        source_errors: Dict[str, List[str]] = {name: [] for name in post_fns}
        with ThreadPoolExecutor(max_workers=len(post_fns)) as post_pool:
            post_futures = {post_pool.submit(fn): name for name, fn in post_fns.items()}
            for future in as_completed(post_futures):
                name = post_futures[future]
                try:
                    s = future.result()
                except Exception as e:
                    source_errors[name].append(f"Error in {name}: {e}")
                    continue
                if name == 'market_news':
                    total_stats['market_news_inserted'] = s.get('articles_inserted', 0)
                elif name == 'econ':
                    total_stats['economic_rows_upserted'] = s.get('rows_upserted', 0)
                source_errors[name].extend(s.get('errors', []))
        for name in post_fns:
            total_stats['errors'].extend(source_errors[name])

        # A source that wrote nothing is always worth an error line, whether or
        # not it explained itself: a total loss of company news (1847 rows -> 0)
        # was once recorded as a successful run with zero errors, and a total
        # loss of one source was once recorded as a successful markets domain
        # purely because the *pooled* error list was non-empty, which switched
        # the old check off. Ask each source about its own zero.
        for name, rows in (
            ('market_news', total_stats['market_news_inserted']),
            ('economic_indicators', total_stats['economic_rows_upserted']),
        ):
            if rows != 0:
                continue
            key = 'econ' if name == 'economic_indicators' else name
            if source_errors.get(key):
                total_stats['errors'].append(f"{name} wrote 0 rows")
            else:
                total_stats['errors'].append(
                    f"{name} wrote 0 rows and reported no error")

        # Honest success: the daily run must always produce quotes. Zero quotes
        # written means the fetch pool or the upsert failed wholesale — that is
        # the only markets outcome worth exiting non-zero for. A dead secondary
        # source is loud (above) and lands the run on 'partial'; failing the
        # whole run for it used to skip cache revalidation for the 50k rows that
        # *did* write.
        ok = total_stats['quotes_inserted'] > 0
        result: Dict[str, Any] = {'success': ok, 'stats': total_stats}
        if not ok:
            result['error'] = 'markets wrote 0 quote rows'
        return result

    except Exception as e:
        total_stats['errors'].append(f"markets failed: {e}")
        return {'success': False, 'error': str(e), 'stats': total_stats}


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
        return {'success': False, 'error': str(e),
                'stats': {'errors': [f"news failed: {e}"]}}


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
        if youtube_stats.get('notes'):
            stats['notes'] = youtube_stats['notes']

        # No credential configured — nothing ran, so this is a skip, not a failure.
        if youtube_stats.get('skipped'):
            return {'success': True, 'skipped': True, 'stats': stats}

        # Non-blocking by design. Media is one API, one call, no fallback, and
        # the least load-bearing data on the site — but `success: False` here
        # failed the *whole* run, which skipped cache revalidation for every
        # other domain's rows and opened a GitHub issue. Two of the three failed
        # runs in the 60 days before this change were a YouTube blip alongside
        # a fully successful sports/markets/news run. Report it loudly (the run
        # lands on 'partial') without taking the pipeline down with it.
        if stats['youtube_videos'] == 0:
            stats['errors'].append('media wrote 0 rows from any source')
            return {'success': True, 'degraded': True, 'stats': stats}
        return {'success': True, 'stats': stats}
    except Exception as e:
        return {'success': True, 'degraded': True,
                'stats': {'youtube_videos': 0, 'errors': [f"media failed: {e}"]}}


def run_misc_etl(supabase: Client) -> Dict[str, Any]:
    """Run misc ETL: weather, holidays, Wikipedia, country, word, fact.

    Six unrelated single-call feeds behind one table. Like media, this is the
    least load-bearing data on the site and must never take the pipeline down:
    each source already degrades individually inside sync_misc_data, and a
    domain that writes nothing at all lands the run on 'partial', not 'failed'.
    """
    try:
        misc_stats = sync_misc_data(supabase)

        written = sum(
            misc_stats.get(k, 0) for k in (
                'weather_upserted', 'holidays_upserted', 'wikipedia_upserted',
                'countries_upserted', 'words_upserted', 'facts_upserted',
                'onthisday_upserted',
            )
        )
        stats = {
            'weather': misc_stats.get('weather_upserted', 0),
            'holidays': misc_stats.get('holidays_upserted', 0),
            'wikipedia': misc_stats.get('wikipedia_upserted', 0),
            'countries': misc_stats.get('countries_upserted', 0),
            'words': misc_stats.get('words_upserted', 0),
            'facts': misc_stats.get('facts_upserted', 0),
            'onthisday': misc_stats.get('onthisday_upserted', 0),
            'errors': misc_stats.get('errors', []),
        }
        if misc_stats.get('notes'):
            stats['notes'] = misc_stats['notes']

        if written == 0:
            stats['errors'].append('misc wrote 0 rows from any source')
            return {'success': True, 'degraded': True, 'stats': stats}
        return {'success': True, 'stats': stats}
    except Exception as e:
        return {'success': True, 'degraded': True,
                'stats': {'weather': 0, 'errors': [f"misc failed: {e}"]}}


def run_summary_etl(supabase: Client) -> Dict[str, Any]:
    """Run the AI briefing ETL: Summary of the Day and Summary of the Week.

    Unlike every other domain this one has no upstream of its own — it
    summarises the rows the other four just wrote, which is why run_full_etl
    calls it sequentially after the parallel block instead of alongside them.

    Never fails the run. Both summaries are gated on freshness and degrade to
    the previously stored briefing, so a Gemini outage costs the card its
    newness, not its content.
    """
    try:
        summary_stats = sync_summaries(supabase)

        stats = {
            'day': summary_stats.get('day_generated', 0),
            'week': summary_stats.get('week_generated', 0),
            'model': summary_stats.get('model'),
            'errors': summary_stats.get('errors', []),
        }
        if summary_stats.get('notes'):
            stats['notes'] = summary_stats['notes']

        # Nothing generated is the normal case on a re-dispatched run (both
        # already current), so it is only degraded when something went wrong.
        if stats['errors']:
            return {'success': True, 'degraded': True, 'stats': stats}
        return {'success': True, 'stats': stats}
    except Exception as e:
        return {'success': True, 'degraded': True,
                'stats': {'day': 0, 'week': 0, 'errors': [f"summary failed: {e}"]}}


def run_full_etl(
    watchlist: Optional[List[str]] = None,
    skip_sports: bool = False,
    skip_markets: bool = False,
    skip_news: bool = False,
    skip_media: bool = False,
    skip_misc: bool = False,
    skip_summary: bool = False,
    triggered_by: str = 'manual',
    run_cleanup: bool = False,
    season_schedules: bool = False,
    budget_seconds: float = 50.0,
) -> Dict[str, Any]:
    """
    Run the full ETL pipeline for all data sources.
    Markets = today's quotes + company news + market news + economic indicators.
    No quote backfill (OHLCV history).
    """
    start_time = et_now()

    # Arm the cooperative wall-clock budget. Fan-out loops stop starting new
    # work once it is spent and record what they skipped; nothing already
    # fetched is discarded. This is the only real bound on run duration --
    # DOMAIN_TIMEOUT_S cannot cancel a running future (see CLAUDE.md's <60s
    # requirement).
    run_deadline.start(budget_seconds)

    results = {
        'started_at': start_time.isoformat(),
        'sports': None,
        'markets': None,
        'news': None,
        'media': None,
        'misc': None,
        'summary': None,
    }

    # Observability: record the run (best-effort — never blocks the pipeline).
    #
    # The tier says which domains were in scope. It used to be hardcoded
    # 'daily' even for --news-only, so a deliberately scoped run was recorded as
    # a daily run that had simply not done three quarters of its job.
    in_scope = [
        d for d, skipped in (
            ('sports', skip_sports), ('markets', skip_markets),
            ('news', skip_news), ('media', skip_media), ('misc', skip_misc),
            ('summary', skip_summary),
        ) if not skipped
    ]
    tier = 'daily' if len(in_scope) == 6 else f"scoped:{'+'.join(in_scope) or 'none'}"

    try:
        run_supabase = get_supabase_client()
    except Exception as e:
        log.warning('no Supabase client for run recording: %s', e)
        run_supabase = None
    run_id = start_etl_run(run_supabase, triggered_by, tier) if run_supabase else None

    domain_fns = {}
    if not skip_sports:
        domain_fns['sports'] = lambda: run_sports_etl(get_supabase_client(), season_schedules=season_schedules)
    if not skip_markets:
        domain_fns['markets'] = lambda: run_markets_etl(
            get_supabase_client(),
            watchlist=watchlist,
        )
    if not skip_news:
        domain_fns['news'] = lambda: run_news_etl(get_supabase_client())
    if not skip_media:
        domain_fns['media'] = lambda: run_media_etl(get_supabase_client())
    if not skip_misc:
        domain_fns['misc'] = lambda: run_misc_etl(get_supabase_client())

    # Run all domains in parallel. Each domain thread fetches from external APIs then
    # writes to Supabase in batch upserts per table.
    domain_elapsed: Dict[str, float] = {}

    def _timed(domain: str, fn) -> Dict[str, Any]:
        t0 = et_now()
        try:
            return fn()
        finally:
            domain_elapsed[domain] = (et_now() - t0).total_seconds()

    domain_futures: Dict[Any, str] = {}
    timed_out: set = set()
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
                        if results[domain].get('skipped'):
                            status = 'SKIP'
                        elif results[domain].get('degraded'):
                            status = 'WARN'
                        else:
                            status = 'OK  ' if ok else 'FAIL'
                        print(f"  [{status}] {domain:<8}  {elapsed:.1f}s")
                    except Exception as e:
                        results[domain] = {'success': False, 'error': str(e)}
                        print(f"  [FAIL] {domain:<8}  {str(e)[:60]}")
            except TimeoutError:
                for future, domain in domain_futures.items():
                    if results.get(domain) is None:
                        timed_out.add(domain)
                        results[domain] = {
                            'success': False,
                            'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout',
                        }
                        print(f"  [FAIL] {domain:<8}  timed out")

    # A "timed out" domain is not actually abandoned: the executor's context
    # manager joins every worker on exit, so by this point it has finished and
    # may well have written rows. Recover its real result and keep the overrun
    # as an error rather than reporting a bare failure with no counters.
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
        # Still a failure — the ceiling exists for a reason — but an honest one.
        results[domain] = {**recovered, 'stats': stats, 'success': False,
                           'error': f'domain exceeded {DOMAIN_TIMEOUT_S}s timeout'}

    run_deadline.clear()   # cleanup + run recording are not part of the budget

    # ── AI briefings — sequential, and last on purpose ────────────────────────
    #
    # The summary domain reads what the four domains above have just written.
    # Running it inside the parallel block would race them and summarise
    # yesterday's rows. It sits outside the cooperative budget because it makes
    # a single bounded call (25s ceiling in gemini.py) rather than a fan-out,
    # but it still counts toward the run duration reported below.
    if not skip_summary:
        t0 = et_now()
        try:
            results['summary'] = run_summary_etl(get_supabase_client())
        except Exception as e:
            results['summary'] = {'success': True, 'degraded': True,
                                  'stats': {'day': 0, 'week': 0,
                                            'errors': [f"summary failed: {e}"]}}
        domain_elapsed['summary'] = (et_now() - t0).total_seconds()
        r = results['summary']
        status = 'WARN' if r.get('degraded') else 'OK  '
        print(f"  [{status}] {'summary':<8}  {domain_elapsed['summary']:.1f}s")

    end_time = et_now()
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
              if d in ('sports', 'markets', 'news', 'media', 'misc', 'summary')
              and r is not None}
    all_errors = collect_domain_errors(active)
    if any(not r.get('success') for r in active.values()):
        run_status = 'failed'
    elif (all_errors or (cleanup_report or {}).get('error')
          or any(r.get('skipped') or r.get('degraded') for r in active.values())):
        run_status = 'partial'
    else:
        run_status = 'success'
    results['status'] = run_status

    # Persist per-domain outcome alongside the counters — the admin dashboard
    # reads this row and cannot otherwise tell OK from SKIP from FAIL.
    def _domain_payload(r: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(r.get('stats') or {})
        if r.get('error'):
            payload['error'] = r['error']
        payload['ok'] = bool(r.get('success'))
        if r.get('skipped'):
            payload['skipped'] = True
        if r.get('degraded'):
            payload['degraded'] = True
        return payload

    finish_etl_run(
        run_supabase, run_id, run_status,
        stats={d: _domain_payload(r) for d, r in active.items()},
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

    DOMAIN_ORDER = ['sports', 'markets', 'news', 'media', 'misc', 'summary']

    def _stat_str(domain: str, result: Dict[str, Any]) -> str:
        s = result.get('stats', {})
        if domain == 'sports':
            season = (f"  season={s['season_scores']}" if s.get('season_scores') is not None else "")
            return (f"leagues={s.get('leagues_processed',0)}  "
                    f"news={s.get('news_inserted',0)}  "
                    f"scores={s.get('scores_inserted',0)}{season}")
        if domain == 'markets':
            return (f"tickers={s.get('stocks_processed',0)}  "
                    f"cnews={s.get('news_inserted',0)}  "
                    f"mnews={s.get('market_news_inserted',0)}  "
                    f"econ={s.get('economic_rows_upserted',0)}")
        if domain == 'news':
            return (f"sections={s.get('sections_processed',0)}  "
                    f"articles={s.get('articles_inserted',0)}")
        if domain == 'media':
            return f"youtube={s.get('youtube_videos',0)}"
        if domain == 'misc':
            return (f"weather={s.get('weather',0)}  "
                    f"holidays={s.get('holidays',0)}  "
                    f"wiki={s.get('wikipedia',0)}  "
                    f"country={s.get('countries',0)}  "
                    f"word={s.get('words',0)}  "
                    f"fact={s.get('facts',0)}  "
                    f"otd={s.get('onthisday',0)}")
        if domain == 'summary':
            model = s.get('model')
            return (f"day={s.get('day',0)}  week={s.get('week',0)}"
                    + (f"  model={model}" if model else ''))
        return ''

    passed = failed = skipped = warned = 0
    for domain in DOMAIN_ORDER:
        result = results.get(domain)
        if result is None:
            continue
        elapsed = domain_elapsed.get(domain, 0)
        ok = result.get('success', False)
        was_skipped = bool(result.get('skipped'))
        degraded = bool(result.get('degraded'))
        status = ('SKIP' if was_skipped else
                  'WARN' if degraded else
                  (' OK ' if ok else 'FAIL'))
        stat_str = _stat_str(domain, result) if ok else result.get('error', '')
        print(f"  {domain:<8} [{status}]  {stat_str:<48}  {elapsed:.1f}s")
        notes = result.get('stats', {}).get('notes', [])
        errors = result.get('stats', {}).get('errors', [])
        for n in notes:
            print(f"             ↳ {n}")
        if errors:
            for e in errors[:3]:
                print(f"             ↳ {e}")
            if len(errors) > 3:
                print(f"             ↳ … and {len(errors) - 3} more errors")
        if was_skipped:
            skipped += 1
        elif degraded:
            warned += 1
        else:
            passed += ok
            failed += (not ok)

    print("-" * W)
    skip_str = f" · {skipped} skipped" if skipped else ""
    warn_str = f" · {warned} degraded" if warned else ""
    print(f"  {passed} passed · {failed} failed{warn_str}{skip_str} · {duration:.1f}s total")
    print("=" * W)

    return results


def main():
    parser = argparse.ArgumentParser(description='Info Aggregator ETL Pipeline')

    # ── Domain skip flags ────────────────────────────────────────────────────
    parser.add_argument('--skip-sports',  action='store_true', help='Skip sports ETL')
    parser.add_argument('--skip-markets', action='store_true', help='Skip markets ETL')
    parser.add_argument('--skip-news',    action='store_true', help='Skip news ETL')
    parser.add_argument('--skip-media',   action='store_true', help='Skip media ETL')
    parser.add_argument('--skip-misc',    action='store_true', help='Skip misc ETL')
    parser.add_argument('--skip-summary', action='store_true', help='Skip the AI briefing ETL')

    # ── Domain "only" shortcuts ───────────────────────────────────────────────
    parser.add_argument('--sports-only',  action='store_true', help='Run sports ETL only')
    parser.add_argument('--markets-only', action='store_true', help='Run markets ETL only (quotes + news + economic indicators)')
    parser.add_argument('--news-only',    action='store_true', help='Run news ETL only')
    parser.add_argument('--media-only',   action='store_true', help='Run media ETL only')
    parser.add_argument('--misc-only',    action='store_true', help='Run misc ETL only')
    parser.add_argument('--summary-only', action='store_true', help='Run the AI briefing ETL only')

    # ── Markets options ───────────────────────────────────────────────────────
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
    parser.add_argument('--budget-seconds', type=float, default=50.0,
                        help='Cooperative wall-clock budget for the domain phase. '
                             'Fan-out loops stop starting new work once spent and '
                             'record what they skipped (default 50, inside the 60s '
                             'requirement in CLAUDE.md)')
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

    # Expand "only" shortcuts into skip flags
    # A scoped run must also drop the summary: it reads every other domain's
    # rows, so generating it from one refreshed domain and four stale ones
    # would overwrite the day's briefing with a worse one. --summary-only is
    # the way to regenerate it alone.
    if args.sports_only:
        args.skip_markets = args.skip_news = args.skip_media = args.skip_misc = True
        args.skip_summary = True
    elif args.markets_only:
        args.skip_sports = args.skip_news = args.skip_media = args.skip_misc = True
        args.skip_summary = True
    elif args.news_only:
        args.skip_sports = args.skip_markets = args.skip_media = args.skip_misc = True
        args.skip_summary = True
    elif args.media_only:
        args.skip_sports = args.skip_markets = args.skip_news = args.skip_misc = True
        args.skip_summary = True
    elif args.misc_only:
        args.skip_sports = args.skip_markets = args.skip_news = args.skip_media = True
        args.skip_summary = True
    elif args.summary_only:
        args.skip_sports = args.skip_markets = args.skip_news = True
        args.skip_media = args.skip_misc = True

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
        skip_misc=args.skip_misc,
        skip_summary=args.skip_summary,
        triggered_by=args.triggered_by,
        run_cleanup=args.cleanup,
        season_schedules=args.season_schedules,
        budget_seconds=args.budget_seconds,
    )

    if args.output:
        with open(args.output, 'w') as f:
            # Uploaded as a workflow artifact, so it gets the same redaction as
            # stdout and etl_runs: error strings can carry ?token= URLs.
            f.write(redact_secrets(json.dumps(results, indent=2, default=str)))
        print(f"\nResults written to {args.output}")

    # Exit 1 on any hard domain failure; 'partial' (errors but data written)
    # stays green — it is visible in etl_runs and the stdout report.
    sys.exit(1 if results.get('status') == 'failed' else 0)


if __name__ == "__main__":
    main()
