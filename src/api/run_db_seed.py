#!/usr/bin/env python3
# run_db_seed.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-12
# Description: One-time initial seed orchestrator.
#
#   Interleaves Alpha Vantage quote backfill (10 tickers/batch) with other
#   domain ETL so the AV 5 req/60s window resets naturally during domain work
#   rather than burning a sleep() call.
#
#   Phase layout (36-ticker basket, 3 AV keys → 75 req/day total):
#     0   Key inventory    report AV key count + daily budget
#     1   AV backfill      tickers [0:10]
#     2   FMP + AV ETF     stock profiles (FMP) + ETF holdings (AV ETF_PROFILE)
#     3   Sports           ESPN backfill + current news     (~60s elapsed → AV resets)
#     4   AV backfill      tickers [10:20]
#     5   News             NYT Archive backfill              (~60s elapsed → AV resets)
#     6   AV backfill      tickers [20:30]
#     7   Media            Spotify + Reddit                 (~60s elapsed → AV resets)
#     8   AV backfill      remaining tickers + sentiment (all 10 topics)
#     9   Markets          Finnhub market news + company news
#     10  Economic         FMP treasury rates + 7 macro indicators (full history)
#
# Usage:
#   python src/api/run_db_seed.py [--backfill-quotes DAYS] [--backfill-news DAYS] [--backfill-sports DAYS]

import os
import sys
import json
import argparse
from datetime import datetime
from typing import Dict, Any, List

from dotenv import load_dotenv
load_dotenv()

# Ensure src/api is importable (in case script is run from repo root)
_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from run_etl import (
    run_sports_etl, run_news_etl, run_media_etl, run_fmp_etl,
    load_baskets, classify_tickers, get_supabase_client,
    MARKET_NEWS_CATEGORIES, SENTIMENT_TOPICS_ALL,
)


def _phase_header(num: int, description: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"[Phase {num}] {description}")
    print('─' * 60)


def _run_av_batch(
    supabase,
    tickers: List[str],
    asset_type_map: Dict[str, str],
    quote_days_back: int,
) -> Dict[str, Any]:
    """Backfill AV quotes for a single batch of tickers (no news, no profile).

    Calls AV fetchers directly — does NOT go through sync_stock_data — so AV
    backfill is strictly seed-only and never bleeds into the daily run path.
    """
    from markets.alpha_vantage import fetch_historical_quotes, fetch_crypto_candles_av
    from markets.markets_db_helper import get_or_create_stock, insert_stock_quotes_batch

    stats: Dict[str, Any] = {'quotes_inserted': 0, 'errors': []}
    for ticker in tickers:
        at = asset_type_map.get(ticker, 'stock')
        # forex/commodity have no AV backfill — skip silently
        if at in ('forex', 'commodity'):
            continue
        print(f"  [{ticker}] ({at}) backfill {quote_days_back}d...")
        try:
            stock_id = get_or_create_stock(supabase, ticker, asset_type=at)
            if not stock_id:
                stats['errors'].append(f"{ticker}: failed to get/create stock row")
                continue
            if at == 'crypto':
                historical = fetch_crypto_candles_av(ticker, days_back=quote_days_back)
            else:
                historical = fetch_historical_quotes(ticker, days_back=quote_days_back)
            if historical:
                count = insert_stock_quotes_batch(supabase, stock_id, historical)
                stats['quotes_inserted'] += count
        except Exception as e:
            msg = f"{ticker}: {e}"
            stats['errors'].append(msg)
            print(f"  [av_batch] Error for {ticker}: {e}")
    return stats


def run_seed(
    backfill_quotes_days: int = 30,
    backfill_news_days: int = 30,
    backfill_sports_days: int = 30,
) -> Dict[str, Any]:
    start_time = datetime.now()
    print("=" * 60)
    print("INFO AGGREGATOR — INITIAL SEED")
    print(f"Started:  {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Quotes:   {backfill_quotes_days}d  |  "
          f"News: {backfill_news_days}d  |  "
          f"Sports: {backfill_sports_days}d")
    print("=" * 60)

    supabase = get_supabase_client()
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    all_tickers = [t for tickers in baskets.values() for t in tickers]
    etf_tickers = [t for t, at in asset_type_map.items() if at == 'etf']

    # Split watchlist into 10-ticker chunks for AV batching
    chunk_size = 10
    av_chunks = [all_tickers[i:i + chunk_size]
                 for i in range(0, len(all_tickers), chunk_size)]

    # ── Phase 0: AV key inventory ─────────────────────────────────────────────
    _phase_header(0, "AV key inventory")
    from markets.alpha_vantage import get_alphavantage_api_keys
    try:
        av_keys = get_alphavantage_api_keys()
        av_key_count = len(av_keys)
    except ValueError:
        av_key_count = 0
        av_keys = []

    daily_budget = av_key_count * 25
    backfill_calls = len(all_tickers)           # 1 AV call per ticker
    etf_holdings_calls = len(etf_tickers)       # 1 AV call per ETF
    sentiment_calls = len(SENTIMENT_TOPICS_ALL)  # 1 AV call per topic
    total_av_calls = backfill_calls + etf_holdings_calls + sentiment_calls
    per_key_avg = total_av_calls / av_key_count if av_key_count else 0

    print(f"  AV keys configured:    {av_key_count}")
    print(f"  Daily budget:          {daily_budget} req/day  ({av_key_count} × 25)")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Quote backfill:        {backfill_calls} calls  ({len(all_tickers)} tickers × 1)")
    print(f"  ETF holdings (AV):     {etf_holdings_calls} calls  ({len(etf_tickers)} ETFs × 1)")
    print(f"  Sentiment topics:      {sentiment_calls} calls  ({sentiment_calls} topics × 1)")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Total AV calls:        {total_av_calls}  (~{per_key_avg:.1f}/key)")
    headroom = daily_budget - total_av_calls
    status = "OK ✓" if headroom >= 0 else "OVER BUDGET ✗"
    print(f"  Budget headroom:       {headroom:+d}  [{status}]")
    print(f"\n  {len(all_tickers)} tickers → {len(av_chunks)} AV batch(es) of ≤{chunk_size}")
    print(f"  ETFs for AV holdings:  {etf_tickers}")

    if av_key_count == 0:
        print("\n  ERROR: No AV keys found — aborting seed.")
        return {'error': 'No AV keys configured'}

    total_quotes = 0

    # ── Phase 1: AV backfill — batch 0 ───────────────────────────────────────
    _phase_header(1, f"AV quote backfill — tickers 1–{len(av_chunks[0])} of {len(all_tickers)}")
    r = _run_av_batch(supabase, av_chunks[0], asset_type_map, backfill_quotes_days)
    total_quotes += r['quotes_inserted']

    # ── Phase 2: FMP stock profiles + AV ETF holdings ────────────────────────
    # FMP and AV ETF_PROFILE are different APIs — no contention with Phase 1 AV calls.
    _phase_header(2, "FMP — stock profiles")
    run_fmp_etl(supabase)

    _phase_header(2, f"AV ETF_PROFILE — holdings for {len(etf_tickers)} ETFs")
    from markets.markets_db_helper import sync_av_etf_holdings
    etf_stats = sync_av_etf_holdings(supabase, etf_tickers)
    print(f"  ETFs processed:    {etf_stats['etfs_processed']}")
    print(f"  Holdings upserted: {etf_stats['holdings_upserted']}")
    if etf_stats['errors']:
        print(f"  Errors:            {len(etf_stats['errors'])}")

    # ── Phase 3: Sports ───────────────────────────────────────────────────────
    # By now ~60s+ have elapsed since Phase 1 → AV 5 req/min window has reset.
    _phase_header(3, f"Sports — ESPN backfill ({backfill_sports_days}d) + current news")
    run_sports_etl(supabase, backfill_days=backfill_sports_days)

    # ── Phase 4: AV backfill — batch 1 ───────────────────────────────────────
    if len(av_chunks) > 1:
        start_idx = len(av_chunks[0])
        end_idx = start_idx + len(av_chunks[1])
        _phase_header(4, f"AV quote backfill — tickers {start_idx + 1}–{end_idx} of {len(all_tickers)}")
        r = _run_av_batch(supabase, av_chunks[1], asset_type_map, backfill_quotes_days)
        total_quotes += r['quotes_inserted']

    # ── Phase 5: News ─────────────────────────────────────────────────────────
    # ~60s+ elapsed since Phase 4 → AV window reset.
    _phase_header(5, f"News — NYT Archive backfill ({backfill_news_days}d)")
    run_news_etl(supabase, backfill_days=backfill_news_days)

    # ── Phase 6: AV backfill — batch 2 ───────────────────────────────────────
    if len(av_chunks) > 2:
        start_idx = len(av_chunks[0]) + len(av_chunks[1])
        end_idx = start_idx + len(av_chunks[2])
        _phase_header(6, f"AV quote backfill — tickers {start_idx + 1}–{end_idx} of {len(all_tickers)}")
        r = _run_av_batch(supabase, av_chunks[2], asset_type_map, backfill_quotes_days)
        total_quotes += r['quotes_inserted']

    # ── Phase 7: Media ────────────────────────────────────────────────────────
    # ~60s+ elapsed since Phase 6 → AV window reset.
    _phase_header(7, "Media — Spotify + Reddit")
    run_media_etl(supabase)

    # ── Phase 8: AV — remaining batches + sentiment ───────────────────────────
    # ~60s+ elapsed since Phase 6 → AV window reset.
    for chunk_idx in range(3, len(av_chunks)):
        chunk = av_chunks[chunk_idx]
        start_idx = sum(len(av_chunks[j]) for j in range(chunk_idx))
        end_idx = start_idx + len(chunk)
        _phase_header(8, f"AV quote backfill — tickers {start_idx + 1}–{end_idx} of {len(all_tickers)}")
        r = _run_av_batch(supabase, chunk, asset_type_map, backfill_quotes_days)
        total_quotes += r['quotes_inserted']

    _phase_header(8, f"AV news sentiment — all {len(SENTIMENT_TOPICS_ALL)} topics")
    from markets.markets_db_helper import sync_news_sentiment
    sentiment_stats = sync_news_sentiment(
        supabase, topics=SENTIMENT_TOPICS_ALL, tickers=all_tickers
    )
    print(f"  Sentiment articles upserted: {sentiment_stats.get('articles_upserted', 0)}")

    # ── Phase 9: Finnhub — market news + company news ─────────────────────────
    _phase_header(9, "Finnhub — market news + company news")
    from markets.markets_db_helper import sync_market_news, sync_stock_data

    news_stats = sync_market_news(supabase, categories=MARKET_NEWS_CATEGORIES)
    print(f"  Market news inserted: {news_stats.get('articles_inserted', 0)}")

    print("\n  Fetching company news for all tickers...")
    for ticker in all_tickers:
        at = asset_type_map.get(ticker, 'stock')
        sync_stock_data(
            supabase, ticker,
            fetch_quotes=True,
            fetch_news=True,
            fetch_profile=False,
            asset_type=at,
        )

    # ── Phase 10: Economic indicators — full history backfill ─────────────────
    # FMP treasury-rates and economic-indicator endpoints return all available
    # history (10+ years) in a single call — no per-day loop needed.
    _phase_header(10, "FMP — economic indicators full history backfill")
    from markets.markets_db_helper import sync_economic_indicators
    econ_stats = sync_economic_indicators(supabase)
    print(f"  Indicators processed:  {econ_stats.get('indicators_processed', 0)}")
    print(f"  Rows upserted:         {econ_stats.get('rows_upserted', 0)}")
    if econ_stats.get('errors'):
        print(f"  Errors:                {len(econ_stats['errors'])}")

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    print("\n" + "=" * 60)
    print(f"SEED COMPLETE — Duration: {duration:.1f}s")
    print(f"  Total quotes inserted:     {total_quotes}")
    print(f"  ETF holdings upserted:     {etf_stats['holdings_upserted']}")
    print(f"  Economic indicator rows:   {econ_stats.get('rows_upserted', 0)}")
    print(f"  AV calls (estimated):      {total_av_calls} / {daily_budget} budget")
    print("=" * 60)

    return {
        'started_at': start_time.isoformat(),
        'completed_at': end_time.isoformat(),
        'duration_seconds': duration,
        'total_quotes_inserted': total_quotes,
        'etf_holdings_upserted': etf_stats['holdings_upserted'],
        'economic_indicator_rows': econ_stats.get('rows_upserted', 0),
        'av_calls_estimated': total_av_calls,
        'av_daily_budget': daily_budget,
    }


def main():
    parser = argparse.ArgumentParser(
        description='Info Aggregator — Initial Seed (interleaved AV backfill)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
AV budget (3 keys × 25 req/day = 75 total):
  36 ticker backfills + 23 ETF holdings + 10 sentiment = 69 calls (~23/key)
  Interleaving ensures the 5 req/min window resets during domain ETL.
        """,
    )
    parser.add_argument('--backfill-quotes', type=int, default=30, metavar='DAYS',
                        help='Days of OHLCV history to backfill via AV (default: 30)')
    parser.add_argument('--backfill-news', type=int, default=30, metavar='DAYS',
                        help='Days of NYT articles to backfill via Archive API (default: 30)')
    parser.add_argument('--backfill-sports', type=int, default=30, metavar='DAYS',
                        help='Days of ESPN scores to backfill (default: 30)')
    parser.add_argument('--economic-indicators-only', action='store_true',
                        help='Fetch and upsert FMP treasury rates + macro indicators only '
                             '(no other ETL)')
    parser.add_argument('--output', metavar='FILE',
                        help='Write results JSON to FILE')

    args = parser.parse_args()

    if args.economic_indicators_only:
        from run_etl import get_supabase_client
        supabase = get_supabase_client()
        from markets.markets_db_helper import sync_economic_indicators
        stats = sync_economic_indicators(supabase)
        print(f"  Indicators processed: {stats['indicators_processed']}")
        print(f"  Rows upserted:        {stats['rows_upserted']}")
        if stats['errors']:
            print(f"  Errors: {stats['errors']}")
        return

    results = run_seed(
        backfill_quotes_days=args.backfill_quotes,
        backfill_news_days=args.backfill_news,
        backfill_sports_days=args.backfill_sports,
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nResults written to {args.output}")


if __name__ == "__main__":
    main()
