# seed.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-13
# Description: Master markets seed script. Runs once to populate the full
#              markets domain from scratch.
#
# Phase 1 — FMP company profiles → stocks (core, is_core=True)
# Phase 2 — AV ETF_PROFILE → etf_holdings + etf_sectors
# Phase 3 — Derive non-core candidate tickers from ETF holdings
# Phase 4 — FMP company profiles → stocks (non-core, is_core=False)
# Phase 5 — AV TIME_SERIES_DAILY (+ DIGITAL_CURRENCY_DAILY) → stock_quotes (30d, all core)
# Phase 6 — Finnhub real-time quotes → stock_quotes (non-core stocks only)
# Phase 7 — AV NEWS_SENTIMENT → news_sentiment (10 topics)
#
# CLI:    python seed.py
# Notebook: run cells top-to-bottom; set DAYS_BACK in Config cell if needed

# %% Imports & setup
import sys
import json
import time
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from tqdm import tqdm
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[3] / '.env.local')

_markets_dir = Path(__file__).parent
if str(_markets_dir) not in sys.path:
    sys.path.insert(0, str(_markets_dir))

from alpha_vantage import (
    get_alphavantage_api_keys,
    fetch_index_constituents,
    fetch_historical_quotes,
    fetch_crypto_candles_av,
    fetch_news_sentiment,
)
from finnhub import fetch_stock_quote, get_finnhub_api_key
from fmp import fetch_company_profile as fmp_fetch_profile, get_fmp_api_key, _FMP_DAILY_LIMIT
from markets_db_helper import (
    get_supabase_client,
    get_or_create_stock,
    insert_stub_stocks,
    upsert_etf_holdings,
    upsert_etf_sectors,
    insert_stock_quotes_batch,
    insert_stock_quote,
    insert_news_sentiment,
)

BASKETS_PATH = _markets_dir / 'baskets.json'

# AV rate limiting — same strategy as av_seed.py
AV_SLEEP_SECONDS    = 13
AV_DAILY_PER_KEY    = 25
# FMP daily cap (imported from fmp.py)
FMP_DAILY_CAP       = _FMP_DAILY_LIMIT

# Sentiment topics (full set of 10)
SENTIMENT_TOPICS = [
    'earnings', 'financial_markets', 'technology', 'finance',
    'economy_macro', 'economy_monetary', 'economy_fiscal',
    'mergers_and_acquisitions', 'ipo', 'energy_transportation',
]

# %% Config  ← edit for notebook runs
DAYS_BACK: int = 30  # calendar days of quote history for core tickers (Phase 5)


# %% Helpers
def load_baskets() -> Dict[str, List[str]]:
    with open(BASKETS_PATH) as f:
        return json.load(f)


def classify_tickers(baskets: Dict[str, List[str]]) -> Dict[str, str]:
    asset_type: Dict[str, str] = {}
    for group, tickers in baskets.items():
        at = 'crypto' if group == 'crypto' else ('stock' if group == 'core_stocks' else 'etf')
        for t in tickers:
            asset_type[t] = at
    return asset_type


def av_chunked(
    tickers: List[str],
    keys: List[str],
    fn,           # callable(ticker, api_key) → result
    desc: str,
) -> List[Tuple[str, object]]:
    """
    Call fn(ticker, key) for each ticker, rotating across keys in chunks
    of len(keys), sleeping AV_SLEEP_SECONDS between chunks.
    Returns [(ticker, result), ...].
    """
    results = []
    pbar = tqdm(total=len(tickers), unit='ticker', desc=desc)
    for chunk_start in range(0, len(tickers), len(keys)):
        chunk = tickers[chunk_start:chunk_start + len(keys)]
        for i, ticker in enumerate(chunk):
            key = keys[i % len(keys)]
            pbar.set_postfix_str(f"{ticker} (key …{key[-4:]})")
            results.append((ticker, fn(ticker, key)))
            pbar.update(1)
        if chunk_start + len(keys) < len(tickers):
            for _ in tqdm(range(AV_SLEEP_SECONDS), desc='  Rate-limit pause', leave=False):
                time.sleep(1)
    pbar.close()
    return results


# %% Budget check
def check_budget(
    etf_tickers: List[str],
    core_tickers: List[str],
    av_keys: List[str],
) -> bool:
    """
    Print a full budget table for AV and FMP and prompt for confirmation
    if either limit would be exceeded.
    """
    # AV: Phase 2 + Phase 5 + Phase 7
    av_phase2 = len(etf_tickers)
    av_phase5 = len(core_tickers)        # all core (stocks + ETFs + crypto)
    av_phase7 = len(SENTIMENT_TOPICS)
    av_total  = av_phase2 + av_phase5 + av_phase7
    av_budget = len(av_keys) * AV_DAILY_PER_KEY

    # FMP: Phase 1 (all core) + Phase 4 (non-core estimated worst-case = 100)
    fmp_phase1 = len(core_tickers)
    fmp_phase4_est = 100
    fmp_total_est  = fmp_phase1 + fmp_phase4_est

    print(f"\n{'='*60}")
    print('SEED BUDGET CHECK')
    print(f"{'='*60}")
    print(f"\n  Alpha Vantage ({len(av_keys)} key(s) × {AV_DAILY_PER_KEY} req/day = {av_budget} budget)")
    print(f"    Phase 2 — ETF_PROFILE       : {av_phase2:>4} calls")
    print(f"    Phase 5 — TIME_SERIES_DAILY : {av_phase5:>4} calls")
    print(f"    Phase 7 — NEWS_SENTIMENT    : {av_phase7:>4} calls")
    print(f"    Total                        : {av_total:>4} / {av_budget}  (headroom: {av_budget - av_total:+d})")

    print(f"\n  FMP (cap: {FMP_DAILY_CAP} req/day)")
    print(f"    Phase 1 — all core profiles    : {fmp_phase1:>4} calls")
    print(f"    Phase 4 — non-core profiles    : ≤{fmp_phase4_est:>3} calls (est.)")
    print(f"    Total (est.)                   : ≤{fmp_total_est:>3} / {FMP_DAILY_CAP}")

    over_budget = False
    if av_total > av_budget:
        print(f"\n  ⚠ AV: {av_total} calls exceeds daily budget of {av_budget} ({av_total - av_budget} over).")
        over_budget = True
    if fmp_total_est > FMP_DAILY_CAP:
        print(f"\n  ⚠ FMP: estimated {fmp_total_est} calls exceeds daily cap of {FMP_DAILY_CAP}.")
        over_budget = True

    if over_budget:
        answer = input('\n  Proceed anyway? [y/N] ').strip().lower()
        if answer != 'y':
            print('  Aborted.')
            return False
    else:
        print('\n  Budget OK.')

    return True


# %% Phase 1 — FMP core profiles (all 36 core tickers)
def phase1_core_profiles(
    supabase,
    core_tickers: List[str],
    asset_type_map: Dict[str, str],
    fmp_key: str,
) -> None:
    print(f"\n{'='*60}")
    print(f'PHASE 1 — FMP core profiles ({len(core_tickers)} tickers)')
    print(f"{'='*60}")

    for ticker in tqdm(core_tickers, unit='ticker', desc='Core profiles'):
        at = asset_type_map.get(ticker, 'stock')
        try:
            profile = fmp_fetch_profile(ticker, fmp_key)
            stock_id = get_or_create_stock(supabase, ticker, profile, asset_type=at)
            if stock_id:
                supabase.table('stocks').update({'is_core': True}).eq('id', stock_id).execute()
            tqdm.write(f'  [{ticker}] {"Profile upserted" if profile else "Stub row"} (asset_type={at}, is_core=True)')
        except RuntimeError as e:
            tqdm.write(f'  FMP limit reached: {e}')
            break
        except Exception as e:
            tqdm.write(f'  [{ticker}] Error: {e}')


# %% Phase 2 — AV ETF profiles → etf_holdings + etf_sectors
def phase2_etf_profiles(supabase, etf_tickers: List[str], av_keys: List[str]) -> Dict[str, List[Dict]]:
    """
    Fetch AV ETF_PROFILE for each ETF, upsert holdings and sectors.
    Returns {etf_ticker: [holding_dicts]} for use in Phase 3.
    """
    print(f"\n{'='*60}")
    print(f'PHASE 2 — AV ETF_PROFILE ({len(etf_tickers)} ETFs)')
    print(f"{'='*60}")

    today = date.today().isoformat()
    all_holdings: Dict[str, List[Dict]] = {}

    pbar = tqdm(total=len(etf_tickers), unit='ETF', desc='ETF profiles')
    for chunk_start in range(0, len(etf_tickers), len(av_keys)):
        chunk = etf_tickers[chunk_start:chunk_start + len(av_keys)]
        for i, ticker in enumerate(chunk):
            key = av_keys[i % len(av_keys)]
            pbar.set_postfix_str(f'{ticker} (key …{key[-4:]})')
            try:
                raw = fetch_index_constituents(ticker, api_key=key)
                if not raw:
                    tqdm.write(f'  [{ticker}] No data returned')
                    pbar.update(1)
                    continue

                # Ensure ETF row exists and mark as core
                etf_stock_id = get_or_create_stock(supabase, ticker, asset_type='etf')
                if not etf_stock_id:
                    tqdm.write(f'  [{ticker}] Failed to get/create ETF stock row')
                    pbar.update(1)
                    continue
                supabase.table('stocks').update({'is_core': True}).eq('id', etf_stock_id).execute()

                # --- Holdings ---
                valid_holdings = [
                    h for h in raw.get('holdings', [])
                    if h.get('symbol') and h.get('symbol') != 'n/a'
                ]
                holding_symbols = [h['symbol'] for h in valid_holdings]

                # Insert stub stock rows for all holding symbols, get {ticker: id} map
                ticker_id_map = insert_stub_stocks(supabase, holding_symbols, asset_type='stock')

                holdings_to_upsert = []
                for h in valid_holdings:
                    sym = h['symbol']
                    stock_id = ticker_id_map.get(sym)
                    if not stock_id:
                        continue
                    weight_str = h.get('weight', '')
                    try:
                        weight_pct = float(weight_str) * 100  # AV gives e.g. "0.0861" → 8.61%
                    except (ValueError, TypeError):
                        weight_pct = None
                    holdings_to_upsert.append({
                        'asset_stock_id': stock_id,
                        'asset_name': h.get('description') if h.get('description') != 'n/a' else None,
                        'weight_pct': weight_pct,
                        'shares': None,
                        'market_value': None,
                        'as_of_date': today,
                    })

                h_count = upsert_etf_holdings(supabase, etf_stock_id, holdings_to_upsert)

                # --- Sectors ---
                sectors_to_upsert = []
                for s in raw.get('sectors', []):
                    sector_name = s.get('sector')
                    if not sector_name:
                        continue
                    try:
                        w = float(s.get('weight', 0)) * 100
                    except (ValueError, TypeError):
                        w = None
                    sectors_to_upsert.append({
                        'sector': sector_name,
                        'weight_pct': w,
                        'as_of_date': today,
                    })
                s_count = upsert_etf_sectors(supabase, etf_stock_id, sectors_to_upsert)

                all_holdings[ticker] = [
                    {'symbol': h['symbol'], 'weight_pct': hh['weight_pct']}
                    for h, hh in zip(valid_holdings, holdings_to_upsert)
                ]
                tqdm.write(f'  [{ticker}] {h_count} holdings, {s_count} sectors upserted')

            except Exception as e:
                tqdm.write(f'  [{ticker}] Error: {e}')
            pbar.update(1)

        if chunk_start + len(av_keys) < len(etf_tickers):
            for _ in tqdm(range(AV_SLEEP_SECONDS), desc='  Rate-limit pause', leave=False):
                time.sleep(1)

    pbar.close()
    return all_holdings


# %% Phase 3 — Derive non-core candidate tickers
def phase3_derive_candidates(
    supabase,
    all_holdings: Dict[str, List[Dict]],
) -> List[str]:
    """
    For each ETF take the top 20 holdings by weight, deduplicate across ETFs,
    filter out tickers that already have a full profile (name IS NOT NULL),
    rank by weight descending, cap at 100. Returns list of candidate tickers.
    """
    print(f"\n{'='*60}")
    print('PHASE 3 — Derive non-core candidate tickers')
    print(f"{'='*60}")

    # Collect {ticker: max_weight} across all ETFs, taking top 20 per ETF
    weight_map: Dict[str, float] = {}
    for etf_ticker, holdings in all_holdings.items():
        sorted_h = sorted(holdings, key=lambda h: h.get('weight_pct') or 0, reverse=True)
        top20 = sorted_h[:20] if len(sorted_h) >= 20 else sorted_h
        for h in top20:
            sym = h['symbol']
            w = h.get('weight_pct') or 0
            if w > weight_map.get(sym, 0):
                weight_map[sym] = w

    # Fetch tickers that already have a full profile (name IS NOT NULL)
    try:
        resp = supabase.table('stocks').select('ticker').not_.is_('name', 'null').execute()
        profiled: Set[str] = {row['ticker'] for row in (resp.data or [])}
    except Exception as e:
        print(f'  Warning: could not fetch profiled tickers: {e}')
        profiled = set()

    candidates = [t for t in weight_map if t not in profiled]
    candidates.sort(key=lambda t: weight_map[t], reverse=True)

    if len(candidates) > 100:
        candidates = candidates[:100]

    print(f'  {len(weight_map)} unique symbols across ETFs')
    print(f'  {len(profiled)} already have profiles → filtered out')
    print(f'  {len(candidates)} candidates (capped at 100)')
    return candidates


# %% Phase 4 — FMP non-core stock profiles
def phase4_noncore_profiles(supabase, candidates: List[str], fmp_key: str) -> None:
    print(f"\n{'='*60}")
    print(f'PHASE 4 — FMP non-core stock profiles ({len(candidates)} tickers)')
    print(f"{'='*60}")

    for ticker in tqdm(candidates, unit='ticker', desc='Non-core profiles'):
        try:
            profile = fmp_fetch_profile(ticker, fmp_key)
            if profile:
                stock_id = get_or_create_stock(supabase, ticker, profile, asset_type='stock')
                if stock_id:
                    supabase.table('stocks').update({'is_core': False}).eq('id', stock_id).execute()
                    tqdm.write(f'  [{ticker}] Profile upserted')
            else:
                tqdm.write(f'  [{ticker}] No FMP profile returned')
        except RuntimeError as e:
            # FMP daily limit hit — abort gracefully
            tqdm.write(f'  FMP limit reached: {e}')
            break
        except Exception as e:
            tqdm.write(f'  [{ticker}] Error: {e}')


# %% Phase 5 — AV historical quotes for all core tickers
def phase5_core_quotes(
    supabase,
    core_tickers: List[str],
    asset_type_map: Dict[str, str],
    av_keys: List[str],
    days_back: int = 30,
) -> None:
    print(f"\n{'='*60}")
    print(f'PHASE 5 — AV quote backfill ({len(core_tickers)} tickers, {days_back}d)')
    print(f"{'='*60}")

    def fetch_quotes(ticker: str, key: str):
        at = asset_type_map.get(ticker, 'stock')
        if at == 'crypto':
            return fetch_crypto_candles_av(ticker, days_back=days_back, api_key=key)
        return fetch_historical_quotes(ticker, days_back=days_back, api_key=key)

    results = av_chunked(core_tickers, av_keys, fetch_quotes, desc='Core quotes')

    for ticker, historical in results:
        if not historical:
            tqdm.write(f'  [{ticker}] No quote data returned')
            continue
        at = asset_type_map.get(ticker, 'stock')
        stock_id = get_or_create_stock(supabase, ticker, asset_type=at)
        if not stock_id:
            tqdm.write(f'  [{ticker}] Could not get stock_id')
            continue
        count = insert_stock_quotes_batch(supabase, stock_id, historical)
        tqdm.write(f'  [{ticker}] Upserted {count} quotes')


# %% Phase 6 — Finnhub real-time quotes for non-core stocks
def phase6_noncore_quotes(supabase, candidates: List[str], fh_key: str) -> None:
    print(f"\n{'='*60}")
    print(f'PHASE 6 — Finnhub real-time quotes ({len(candidates)} tickers)')
    print(f"{'='*60}")

    for ticker in tqdm(candidates, unit='ticker', desc='Non-core quotes'):
        try:
            quote = fetch_stock_quote(ticker, fh_key)
            if not quote:
                tqdm.write(f'  [{ticker}] No quote returned')
                continue
            stock_id = get_or_create_stock(supabase, ticker, asset_type='stock')
            if not stock_id:
                tqdm.write(f'  [{ticker}] Could not get stock_id')
                continue
            insert_stock_quote(supabase, stock_id, quote)
        except Exception as e:
            tqdm.write(f'  [{ticker}] Error: {e}')


# %% Phase 7 — AV news sentiment
def phase7_news_sentiment(supabase, av_keys: List[str]) -> None:
    print(f"\n{'='*60}")
    print(f'PHASE 7 — AV news sentiment ({len(SENTIMENT_TOPICS)} topics)')
    print(f"{'='*60}")

    def fetch_sentiment(topic: str, key: str):
        return fetch_news_sentiment(topic=topic, api_key=key)

    results = av_chunked(SENTIMENT_TOPICS, av_keys, fetch_sentiment, desc='Sentiment topics')

    for topic, articles in results:
        if not articles:
            tqdm.write(f'  [{topic}] No articles returned')
            continue
        count = insert_news_sentiment(supabase, articles)
        tqdm.write(f'  [{topic}] Upserted {count} articles')


# %% Main
def main(days_back: int = DAYS_BACK) -> None:
    av_keys = get_alphavantage_api_keys()
    fmp_key = get_fmp_api_key()
    fh_key  = get_finnhub_api_key()
    supabase = get_supabase_client()

    baskets       = load_baskets()
    asset_type_map = classify_tickers(baskets)

    etf_tickers  = [t for t, at in asset_type_map.items() if at == 'etf']
    core_tickers = list(asset_type_map)  # all baskets: stocks + ETFs + crypto

    if not check_budget(etf_tickers, core_tickers, av_keys):
        return

    phase1_core_profiles(supabase, core_tickers, asset_type_map, fmp_key)

    all_holdings = phase2_etf_profiles(supabase, etf_tickers, av_keys)

    candidates = phase3_derive_candidates(supabase, all_holdings)
    len(candidates)

    phase4_noncore_profiles(supabase, candidates, fmp_key)

    # Need to Run
    phase5_core_quotes(supabase, core_tickers, asset_type_map, av_keys, days_back=days_back)

    phase6_noncore_quotes(supabase, candidates, fh_key)

    # Need to Run
    phase7_news_sentiment(supabase, av_keys)

    print(f"\n{'='*60}")
    print('SEED COMPLETE')
    print(f"{'='*60}")


# Notebook entry point
if __name__ != '__main__':
    # Run cell-by-cell, or call:
    #   main(days_back=DAYS_BACK)
    pass

# %% CLI entry point
if __name__ == '__main__':
    main()
