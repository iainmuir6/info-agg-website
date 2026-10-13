#!/usr/bin/env python3
# run_test.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-17
# Description: Dry-run endpoint test runner — calls every external API once,
#              validates the response, and prints a PASS/FAIL summary table.
#              No Supabase writes.

import sys
import os
from dataclasses import dataclass
from typing import Any, Callable, Tuple

# Ensure all src/api sub-packages are importable
_HERE = os.path.dirname(os.path.abspath(__file__))
for _sub in ('markets', 'sports', 'news', 'media'):
    _path = os.path.join(_HERE, _sub)
    if _path not in sys.path:
        sys.path.insert(0, _path)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from dotenv import load_dotenv
load_dotenv()


@dataclass
class TestCase:
    name: str
    callable: Callable[[], Any]
    validate_fn: Callable[[Any], Tuple[bool, str]]


def _run_tests(cases: list) -> int:
    """Run all test cases, print table, return number of failures."""
    COL_STATUS = 6
    COL_NAME   = 45
    COL_DETAIL = 50

    header = f"{'STATUS':<{COL_STATUS}}  {'ENDPOINT':<{COL_NAME}}  {'DETAIL'}"
    print("\n" + "=" * (COL_STATUS + COL_NAME + COL_DETAIL + 4))
    print("API ENDPOINT DRY-RUN TEST")
    print("=" * (COL_STATUS + COL_NAME + COL_DETAIL + 4))
    print(header)
    print("-" * (COL_STATUS + COL_NAME + COL_DETAIL + 4))

    failures = 0
    for tc in cases:
        try:
            data = tc.callable()
            ok, detail = tc.validate_fn(data)
        except Exception as exc:
            ok, detail = False, f"Exception: {exc}"

        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"{status:<{COL_STATUS}}  {tc.name:<{COL_NAME}}  {detail[:COL_DETAIL]}")

    print("=" * (COL_STATUS + COL_NAME + COL_DETAIL + 4))
    total = len(cases)
    print(f"Results: {total - failures}/{total} passed\n")
    return failures


def build_test_cases() -> list:
    from markets.finnhub import (
        fetch_stock_quote, fetch_crypto_quote, fetch_company_profile,
        fetch_company_news, fetch_market_news, get_finnhub_api_key,
    )
    from markets.fmp import (
        fetch_company_profile as fmp_fetch_profile,
        fetch_fmp_quote, fetch_treasury_rates, fetch_economic_indicator,
        get_fmp_api_key,
    )
    from markets.frankfurter import fetch_forex_quote
    from markets.fred import fetch_fred_series
    from sports.espn import fetch_espn_news, fetch_espn_scores, fetch_espn_standings
    from news.nyt import fetch_nyt_top_stories

    fh_key  = get_finnhub_api_key()
    fmp_key = get_fmp_api_key()

    cases = [
        # ── Finnhub ─────────────────────────────────────────────────────────
        TestCase(
            name='Finnhub: stock quote (AAPL)',
            callable=lambda: fetch_stock_quote('AAPL', fh_key),
            validate_fn=lambda d: (
                (True, f"price={d['current_price']}")
                if d and (d.get('current_price') or 0) > 0
                else (False, f"no price — got {d}")
            ),
        ),
        TestCase(
            name='Finnhub: crypto quote (BTC)',
            callable=lambda: fetch_crypto_quote('BTC', fh_key),
            validate_fn=lambda d: (
                (True, f"price={d['current_price']}")
                if d and (d.get('current_price') or 0) > 0
                else (False, f"no price — got {d}")
            ),
        ),
        TestCase(
            name='Finnhub: company profile (AAPL)',
            callable=lambda: fetch_company_profile('AAPL', fh_key),
            validate_fn=lambda d: (
                (True, d['name'])
                if d and d.get('name')
                else (False, f"no name — got {d}")
            ),
        ),
        TestCase(
            name='Finnhub: company news (AAPL)',
            callable=lambda: fetch_company_news('AAPL', days_back=1, api_key=fh_key),
            validate_fn=lambda d: (
                (True, f"{len(d)} articles, headline='{(d[0].get('headline') or '')[:40]}'")
                if d and len(d) > 0 and d[0].get('headline')
                else (False, f"empty or no headline — got {len(d) if d else 0} items")
            ),
        ),
        TestCase(
            name='Finnhub: market news (general)',
            callable=lambda: fetch_market_news('general', api_key=fh_key),
            validate_fn=lambda d: (
                (True, f"{len(d)} articles")
                if d and len(d) > 0
                else (False, f"empty — got {len(d) if d else 0} items")
            ),
        ),
        # ── FMP ──────────────────────────────────────────────────────────────
        TestCase(
            name='FMP: company profile (AAPL)',
            callable=lambda: fmp_fetch_profile('AAPL', fmp_key),
            validate_fn=lambda d: (
                (True, f"name={d['name']}, sector={d.get('sector')}")
                if d and d.get('name') and d.get('sector')
                else (False, f"missing name or sector — got {d}")
            ),
        ),
        TestCase(
            name='FMP: commodity quote (GCUSD)',
            callable=lambda: fetch_fmp_quote('GCUSD', fmp_key),
            validate_fn=lambda d: (
                (True, f"price={d['current_price']}")
                if d and (d.get('current_price') or 0) > 0
                else (False, f"no price — got {d}")
            ),
        ),
        TestCase(
            name='FMP: treasury rates',
            callable=lambda: fetch_treasury_rates(fmp_key),
            validate_fn=lambda d: (
                (True, f"{len(d)} rows, sample={next((r for r in d if r['indicator_name']=='treasury_10y'), {}).get('value')}")
                if d and len(d) > 0 and any(r.get('indicator_name') == 'treasury_10y' for r in d)
                else (False, f"missing rows or treasury_10y — got {len(d) if d else 0} rows")
            ),
        ),
        TestCase(
            name='FMP: economic indicator (CPI)',
            callable=lambda: fetch_economic_indicator('CPI', fmp_key),
            validate_fn=lambda d: (
                (True, f"{len(d)} rows, latest={d[0].get('date')} val={d[0].get('value')}")
                if d and len(d) > 0 and d[0].get('date') and d[0].get('value') is not None
                else (False, f"missing rows or fields — got {d[:1] if d else []}")
            ),
        ),
        # ── Keyless (Frankfurter, FRED) ──────────────────────────────────────
        TestCase(
            name='Frankfurter: forex quote (USDEUR)',
            callable=lambda: fetch_forex_quote('USDEUR'),
            validate_fn=lambda d: (
                (True, f"price={d['current_price']}")
                if d and (d.get('current_price') or 0) > 0
                else (False, f"no price — got {d}")
            ),
        ),
        TestCase(
            name='FRED: real GDP (GDPC1)',
            callable=lambda: fetch_fred_series('realGDP'),
            validate_fn=lambda d: (
                (True, f"{len(d)} rows, latest={d[-1]['date']} val={d[-1]['value']}")
                if d
                else (False, "no observations")
            ),
        ),
        # ── ESPN ─────────────────────────────────────────────────────────────
        TestCase(
            name='ESPN: news (football/nfl)',
            callable=lambda: fetch_espn_news('football', 'nfl', limit=5),
            validate_fn=lambda d: (
                (True, f"{len(d)} articles")
                if d and len(d) > 0
                else (False, f"empty — got {len(d) if d else 0} articles")
            ),
        ),
        TestCase(
            name='ESPN: scores (football/nfl)',
            callable=lambda: fetch_espn_scores('football', 'nfl'),
            validate_fn=lambda d: (
                (True, f"{len(d)} events")
                if d and len(d) > 0
                else (False, f"empty (off-season may return 0) — got {len(d) if d else 0} events")
            ),
        ),
        TestCase(
            name='ESPN: standings (football/nfl)',
            callable=lambda: fetch_espn_standings('football', 'nfl'),
            validate_fn=lambda d: (
                (True, f"{len(d)} teams")
                if d and len(d) > 0
                else (False, f"empty — got {len(d) if d else 0} teams")
            ),
        ),
        # ── NYT ──────────────────────────────────────────────────────────────
        TestCase(
            name='NYT: top stories (technology)',
            callable=lambda: fetch_nyt_top_stories(section='technology'),
            validate_fn=lambda d: (
                (True, f"{len(d.get('articles', []))} articles")
                if d and len(d.get('articles', [])) > 0
                else (False, f"empty or error — got {d}")
            ),
        ),
    ]
    return cases


def main():
    print("Loading test cases...")
    try:
        cases = build_test_cases()
    except Exception as e:
        print(f"Failed to build test cases: {e}")
        sys.exit(1)

    failures = _run_tests(cases)
    sys.exit(1 if failures > 0 else 0)


if __name__ == '__main__':
    main()
