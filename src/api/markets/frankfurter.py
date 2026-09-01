"""
frankfurter.py

Forex rates from Frankfurter (https://frankfurter.dev) — the ECB's published
reference rates, keyless and unmetered.

Replaces ten FMP `/quote` calls (one per pair) with a single request, which is
what makes the Tier B intraday budget cheap: FMP's free tier is 250 calls/day
and forex was the bulk of it.

**Granularity caveat.** These are ECB *reference* rates, published once per
business day around 16:00 CET — not a live feed. Forex rows therefore change
once a day, no matter how often the intraday tiers run, and no rate is
published on weekends or TARGET holidays (the fetcher carries the last
published day forward). Commodities stay on FMP, which is live.
"""

from typing import Any, Dict, Optional
from datetime import datetime, timedelta, timezone
import threading
import requests

from dotenv import load_dotenv

load_dotenv()

FRANKFURTER_BASE = "https://api.frankfurter.dev/v1"

# Every pair the site tracks, as stored in info_agg.stocks.
#
# All USD-base ("units of X per 1 USD") rather than the market's conventional
# direction, so a card can drop the redundant USD leg and label each row with
# the foreign currency alone. EURUSD/GBPUSD/AUDUSD/NZDUSD were the four quoted
# the other way round and are now inverted here.
FOREX_PAIRS = [
    "USDEUR", "USDGBP", "USDJPY", "USDCAD", "USDCHF",
    "USDAUD", "USDCNY", "USDINR", "USDMXN", "USDNZD",
]

# One HTTP call serves every pair, so the result is memoized for the life of
# the process. sync_asset_daily() is called per ticker and would otherwise
# refetch the same payload ten times.
_cache: Optional[Dict[str, Dict[str, Any]]] = None
_cache_lock = threading.Lock()


def _symbols() -> list:
    """Non-USD legs of every tracked pair."""
    out = []
    for p in FOREX_PAIRS:
        base, quote = p[:3], p[3:]
        other = quote if base == "USD" else base
        if other not in out:
            out.append(other)
    return out


def _price(pair: str, rates: Dict[str, float]) -> Optional[float]:
    """Convert a USD-based rate table into this pair's quoted price.

    With base=USD the table holds "units of X per 1 USD". USDJPY is that value
    directly; EURUSD is its reciprocal.
    """
    base, quote = pair[:3], pair[3:]
    if base == "USD":
        r = rates.get(quote)
        return r if r else None
    if quote == "USD":
        r = rates.get(base)
        return (1 / r) if r else None
    return None


def fetch_forex_rates(force: bool = False) -> Dict[str, Dict[str, Any]]:
    """
    Fetch every tracked pair in one request.

    Returns {ticker: quote-dict} shaped like fetch_fmp_quote's output so the
    caller can swap one for the other. Empty dict on failure — the caller
    treats that as "no quote", not as a pipeline error.
    """
    global _cache
    with _cache_lock:
        if _cache is not None and not force:
            return _cache

    # A short window rather than /latest: the second-newest published day is
    # the previous close, which is what change and percent_change need. ECB
    # skips weekends and holidays, so 10 days always contains two entries.
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=10)
    url = f"{FRANKFURTER_BASE}/{start.isoformat()}..{end.isoformat()}"

    try:
        response = requests.get(
            url,
            params={"base": "USD", "symbols": ",".join(_symbols())},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Frankfurter rates: {e}")
        return {}
    except ValueError as e:
        print(f"Error parsing Frankfurter rates: {e}")
        return {}

    series = payload.get("rates") or {}
    if not series:
        print("Frankfurter returned no rates")
        return {}

    dates = sorted(series.keys())
    latest_date = dates[-1]
    prev_date = dates[-2] if len(dates) > 1 else None
    latest = series[latest_date]
    prev = series[prev_date] if prev_date else {}

    out: Dict[str, Dict[str, Any]] = {}
    for pair in FOREX_PAIRS:
        price = _price(pair, latest)
        if price is None:
            continue
        previous = _price(pair, prev) if prev else None
        change = (price - previous) if previous else None
        out[pair] = {
            "ticker": pair,
            "current_price": round(price, 6),
            "previous_close": round(previous, 6) if previous else None,
            "change_amount": round(change, 6) if change is not None else None,
            "percent_change": (
                round(change / previous * 100, 4) if change is not None and previous else None
            ),
            # ECB publishes a daily reference rate — there is no intraday
            # open/high/low or volume to report, and inventing one from the
            # close would be a lie the chart would render.
            "open_price": None,
            "high_price": None,
            "low_price": None,
            "volume": None,
            # Epoch seconds, not ISO: insert_stock_quote() calls
            # datetime.fromtimestamp() on this field, matching FMP's contract.
            "quote_timestamp": int(
                datetime.fromisoformat(f"{latest_date}T00:00:00+00:00").timestamp()
            ),
            "rate_date": latest_date,
        }

    with _cache_lock:
        _cache = out
    return out


def fetch_forex_quote(ticker: str) -> Optional[Dict[str, Any]]:
    """Single-pair accessor over the shared one-call fetch."""
    return fetch_forex_rates().get(ticker.upper())


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Frankfurter (ECB reference rates)")
    print("=" * 60)
    rates = fetch_forex_rates()
    print(f"{len(rates)} pairs from 1 request\n")
    for t, q in rates.items():
        print(f"  {t}  {q['current_price']:>12}  prev {str(q['previous_close']):>12}  "
              f"{q['percent_change']}%  @ {q['rate_date']}")
