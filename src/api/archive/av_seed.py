# av_seed.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-13
# Description: Standalone Alpha Vantage seed script.
#       Backfills index/ETF constituents (AV ETF_PROFILE) and/or historical
#       quotes (AV TIME_SERIES_DAILY / DIGITAL_CURRENCY_DAILY) for all tickers
#       in baskets.json.
#
# CLI usage:
#   python av_seed.py                        # run both constituents + quotes
#   python av_seed.py --constituents         # ETF holdings only
#   python av_seed.py --quotes               # historical quotes only
#   python av_seed.py --quotes --days-back 60
#
# Notebook usage (VS Code / Jupyter):
#   Set RUN_CONSTITUENTS / RUN_QUOTES / DAYS_BACK in the Config cell, then
#   run cells individually with Shift+Enter.

# %% [markdown]
# ## av_seed — Alpha Vantage backfill
# Backfills ETF constituents and/or historical quotes for all tickers in baskets.json.

# %% Imports & setup
import sys
import json
import time
import argparse
from pathlib import Path
from typing import Dict, List

from tqdm import tqdm
from dotenv import load_dotenv
load_dotenv(Path(__file__).parents[3] / '.env.local')

# Ensure the markets package is importable both as a module and standalone
_markets_dir = Path(__file__).parent
if str(_markets_dir) not in sys.path:
    sys.path.insert(0, str(_markets_dir))

from alpha_vantage import (
    fetch_etf_holdings_av, fetch_historical_quotes, fetch_crypto_candles_av,
    get_alphavantage_api_keys,
)
from markets_db_helper import (
    get_supabase_client,
    get_or_create_stock,
    upsert_etf_holdings,
    insert_stock_quotes_batch,
)

BASKETS_PATH = _markets_dir / 'baskets.json'

# AV free tier: 5 req/min per key → sleep 13s between batches
AV_SLEEP_SECONDS = 13
AV_DAILY_LIMIT_PER_KEY = 25

# %% Config  ← edit these for notebook runs
RUN_CONSTITUENTS: bool = True   # backfill ETF holdings
RUN_QUOTES: bool = True         # backfill historical quotes
DAYS_BACK: int = 30             # calendar days of quote history to seed

AV_TOPICS = {
    'Economy - Fiscal Policy (e.g., tax reform, government spending)': 'economy_fiscal',
    'Economy - Monetary Policy (e.g., interest rates, inflation)': 'economy_monetary',
    'Economy - Macro/Overall': 'economy_macro',
    'Blockchain': 'blockchain', 
    'Financial Markets': 'financial_markets',
    'Finance': 'finance',
    'Technology': 'technology',
    'Real Estate & Construction': 'real_estate',
    'Energy & Transportation': 'energy_transportation',
    'Retail & Wholesale': 'retail_wholesale',
    # 'Earnings': 'earnings',
    # 'Mergers & Acquisitions': 'mergers_and_acquisitions',
    # 'IPO': 'ipo',
    # 'Life Sciences': 'life_sciences',
    # 'Manufacturing': 'manufacturing',
}


# %% Helpers
def load_baskets() -> Dict[str, List[str]]:
    with open(BASKETS_PATH) as f:
        return json.load(f)


def classify_tickers(baskets: Dict[str, List[str]]) -> Dict[str, str]:
    """Return {ticker: asset_type} inferred from basket group names."""
    asset_type: Dict[str, str] = {}
    for group, tickers in baskets.items():
        if group == 'crypto':
            at = 'crypto'
        elif group == 'core_stocks':
            at = 'stock'
        else:
            at = 'etf'
        for t in tickers:
            asset_type[t] = at
    return asset_type


def check_budget(
    run_constituents_flag: bool,
    run_quotes_flag: bool,
    etf_tickers: List[str],
    all_tickers: List[str],
    keys: List[str],
) -> bool:
    """Print a budget breakdown and return True if safe to proceed.

    Prompts the user for confirmation if the request count exceeds the
    combined daily budget (keys × 25 req/day).
    """
    constituents_reqs = len(etf_tickers) if run_constituents_flag else 0
    quotes_reqs = len(all_tickers) if run_quotes_flag else 0
    total_reqs = constituents_reqs + quotes_reqs
    daily_budget = len(keys) * AV_DAILY_LIMIT_PER_KEY
    headroom = daily_budget - total_reqs

    print(f"\n{'='*60}")
    print(f"AV BUDGET CHECK")
    print(f"{'='*60}")
    print(f"  Keys configured : {len(keys)}  (budget: {len(keys)} × {AV_DAILY_LIMIT_PER_KEY} = {daily_budget} req/day)")
    if run_constituents_flag:
        print(f"  Constituents    : {constituents_reqs} requests  ({len(etf_tickers)} ETFs)")
    if run_quotes_flag:
        print(f"  Quotes          : {quotes_reqs} requests  ({len(all_tickers)} tickers)")
    print(f"  Total           : {total_reqs} requests")
    print(f"  Headroom        : {headroom:+d} requests")

    if total_reqs > daily_budget:
        print(f"\n  WARNING: {total_reqs} requests exceeds the daily budget of {daily_budget}.")
        print(f"  {total_reqs - daily_budget} request(s) will likely be rejected by AV.")
        answer = input("\n  Proceed anyway? [y/N] ").strip().lower()
        if answer != 'y':
            print("  Aborted.")
            return False
    else:
        print(f"\n  Budget OK — within daily limit.")

    return True


# %% Constituents backfill
def run_constituents(supabase, etf_tickers: List[str], keys: List[str]) -> Dict:
    """Fetch ETF_PROFILE for each ETF ticker and upsert holdings.

    Processes len(keys) tickers per 13-second window — one call per key —
    then sleeps before the next batch.
    """
    stats = {'etfs_processed': 0, 'holdings_upserted': 0, 'errors': []}

    print(f"\n{'='*60}")
    print(f"CONSTITUENTS BACKFILL  ({len(etf_tickers)} ETFs, {len(keys)} AV keys)")
    print(f"{'='*60}")

    pbar = tqdm(total=len(etf_tickers), unit='ETF', desc='Constituents')
    for chunk_start in range(0, len(etf_tickers), len(keys)):
        chunk = etf_tickers[chunk_start:chunk_start + len(keys)]
        for i, ticker in enumerate(chunk):
            key = keys[i % len(keys)]
            pbar.set_postfix_str(f"{ticker} (key ...{key[-4:]})")
            try:
                holdings = fetch_etf_holdings_av(ticker, api_key=key)
                if not holdings:
                    tqdm.write(f"  [{ticker}] No holdings returned")
                    stats['etfs_processed'] += 1
                    pbar.update(1)
                    continue

                stock_id = get_or_create_stock(supabase, ticker, asset_type='etf')
                if not stock_id:
                    msg = f"{ticker}: failed to get/create stock row"
                    tqdm.write(f"  [{ticker}] {msg}")
                    stats['errors'].append(msg)
                    pbar.update(1)
                    continue

                count = upsert_etf_holdings(supabase, stock_id, holdings)
                stats['holdings_upserted'] += count
                stats['etfs_processed'] += 1
                tqdm.write(f"  [{ticker}] Upserted {count} holdings")

            except Exception as e:
                msg = f"{ticker}: {e}"
                tqdm.write(f"  [constituents] Error for {ticker}: {e}")
                stats['errors'].append(msg)
            pbar.update(1)

        if chunk_start + len(keys) < len(etf_tickers):
            for _ in tqdm(range(AV_SLEEP_SECONDS), desc='  Rate limit pause', leave=False):
                time.sleep(1)

    pbar.close()
    print(f"\nConstituents complete — {stats['etfs_processed']} ETFs, "
          f"{stats['holdings_upserted']} holdings upserted, "
          f"{len(stats['errors'])} errors")
    return stats


# %% Quotes backfill
def run_quotes(
    supabase,
    tickers: List[str],
    asset_type_map: Dict[str, str],
    keys: List[str],
    days_back: int = 90,
) -> Dict:
    """Backfill historical daily OHLCV quotes for all tickers.

    Processes len(keys) tickers per 13-second window — one call per key —
    then sleeps before the next batch.
    """
    stats = {'tickers_processed': 0, 'quotes_upserted': 0, 'errors': []}

    print(f"\n{'='*60}")
    print(f"QUOTES BACKFILL  ({len(tickers)} tickers, {days_back}d, {len(keys)} AV keys)")
    print(f"{'='*60}")

    pbar = tqdm(total=len(tickers), unit='ticker', desc='Quotes')
    for chunk_start in range(0, len(tickers), len(keys)):
        chunk = tickers[chunk_start:chunk_start + len(keys)]
        for i, ticker in enumerate(chunk):
            key = keys[i % len(keys)]
            at = asset_type_map.get(ticker, 'stock')
            pbar.set_postfix_str(f"{ticker} ({at}, key ...{key[-4:]})")
            try:
                if at == 'crypto':
                    historical = fetch_crypto_candles_av(ticker, days_back=days_back, api_key=key)
                else:
                    historical = fetch_historical_quotes(ticker, days_back=days_back, api_key=key)

                if not historical:
                    tqdm.write(f"  [{ticker}] No data returned")
                    stats['tickers_processed'] += 1
                    pbar.update(1)
                    continue

                stock_id = get_or_create_stock(supabase, ticker, asset_type=at)
                if not stock_id:
                    msg = f"{ticker}: failed to get/create stock row"
                    tqdm.write(f"  [{ticker}] {msg}")
                    stats['errors'].append(msg)
                    pbar.update(1)
                    continue

                count = insert_stock_quotes_batch(supabase, stock_id, historical)
                stats['quotes_upserted'] += count
                stats['tickers_processed'] += 1
                tqdm.write(f"  [{ticker}] Upserted {count} quotes")

            except Exception as e:
                msg = f"{ticker}: {e}"
                tqdm.write(f"  [quotes] Error for {ticker}: {e}")
                stats['errors'].append(msg)
            pbar.update(1)

        if chunk_start + len(keys) < len(tickers):
            for _ in tqdm(range(AV_SLEEP_SECONDS), desc='  Rate limit pause', leave=False):
                time.sleep(1)

    pbar.close()
    print(f"\nQuotes complete — {stats['tickers_processed']} tickers, "
          f"{stats['quotes_upserted']} rows upserted, "
          f"{len(stats['errors'])} errors")
    return stats


# %% Run (notebook entry point)
def main(run_constituents_flag: bool, run_quotes_flag: bool, days_back: int) -> None:
    keys = get_alphavantage_api_keys()
    supabase = get_supabase_client()
    baskets = load_baskets()
    asset_type_map = classify_tickers(baskets)
    all_tickers = [t for tickers in baskets.values() for t in tickers]
    etf_tickers = [t for t, at in asset_type_map.items() if at == 'etf']

    if not check_budget(run_constituents_flag, run_quotes_flag, etf_tickers, all_tickers, keys):
        return

    if run_constituents_flag:
        run_constituents(supabase, etf_tickers, keys)

    if run_quotes_flag:
        run_quotes(supabase, all_tickers, asset_type_map, keys, days_back=days_back)


# Notebook: call main() with the Config values defined above
if __name__ != "__main__":
    main(
        run_constituents_flag=RUN_CONSTITUENTS,
        run_quotes_flag=RUN_QUOTES,
        days_back=DAYS_BACK,
    )
    pass


# %% CLI entry point
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Alpha Vantage seed: backfill ETF constituents and/or historical quotes."
    )
    parser.add_argument(
        '--constituents',
        action='store_true',
        help='Backfill ETF holdings only (AV ETF_PROFILE)'
    )
    parser.add_argument(
        '--quotes',
        action='store_true',
        help='Backfill historical quotes only (AV TIME_SERIES_DAILY / DIGITAL_CURRENCY_DAILY)'
    )
    parser.add_argument(
        '--days-back',
        type=int,
        default=90,
        metavar='N',
        help='Calendar days of quote history to backfill (default: 90)'
    )
    args = parser.parse_args()

    # No flag → run both
    run_c = args.constituents or (not args.constituents and not args.quotes)
    run_q = args.quotes or (not args.constituents and not args.quotes)

    main(run_c, run_q, args.days_back)
