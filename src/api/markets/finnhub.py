# finnhub.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches financial market data from the Finnhub API
#       ---> Supports stock quotes, company profiles (stocks + ETFs), news

from typing import Dict, List, Optional, Any
from collections import deque
from datetime import datetime, timedelta, timezone
import requests
import threading
import sys
import os
import time

from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import (
    get_http_session, et_today, utc_now,
    breaker, EndpointUnavailable, HTTP_TIMEOUT,
)

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"


def _epoch_to_iso(ts: Any) -> Optional[str]:
    """Finnhub timestamps are Unix epochs (UTC). Convert them tz-aware.

    datetime.fromtimestamp(ts) without a tz returns machine-local *naive*
    time, which Postgres then reads as UTC — silently shifting every
    published_at by the runner's UTC offset. CI runs on UTC and was
    unaffected; local runs wrote rows 4-5 hours early, so the news tables
    ended up holding a mix of correct and shifted timestamps.
    """
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

STOCK_INDICES = {
    'sp500': '^GSPC',
    'dow': '^DJI',
    'nasdaq': '^IXIC',
    'russell2000': '^RUT'
}

CRYPTO_SYMBOL_MAP = {
    'BTC': 'BINANCE:BTCUSDT',
    'ETH': 'BINANCE:ETHUSDT',
    'XRP': 'BINANCE:XRPUSDT',
}

# Finnhub free tier: 60 API calls/minute per key — per-key sliding-window rate limiters
_FH_RATE_LIMIT = 60
_FH_WINDOW = 60.0
_FH_CALL_TIMES: Dict[str, deque] = {}
_FH_KEY_LOCKS: Dict[str, threading.Lock] = {}
_FH_INIT_LOCK = threading.Lock()

# Round-robin key selector
_fh_key_index: int = 0
_fh_key_rotation_lock = threading.Lock()


def _fh_rate_limit(key: str) -> None:
    """Sleep only if we're about to exceed 60 req/min for this Finnhub key.

    Never sleeps while holding the key lock — a lock-held sleep serializes
    every worker sharing the key (the historical ETL hang)."""
    if key not in _FH_KEY_LOCKS:
        with _FH_INIT_LOCK:
            if key not in _FH_KEY_LOCKS:
                _FH_CALL_TIMES[key] = deque()
                _FH_KEY_LOCKS[key] = threading.Lock()

    while True:
        with _FH_KEY_LOCKS[key]:
            times = _FH_CALL_TIMES[key]
            now = time.time()
            while times and now - times[0] >= _FH_WINDOW:
                times.popleft()
            if len(times) < _FH_RATE_LIMIT:
                times.append(now)
                return
            sleep_for = _FH_WINDOW - (now - times[0]) + 0.05
        time.sleep(max(sleep_for, 0.05))


def get_finnhub_api_keys() -> List[str]:
    """Return all configured Finnhub API keys."""
    keys = []
    for suffix in ['_1', '_2', '_3']:
        k = os.getenv(f'FINNHUB_API_KEY{suffix}')
        if k and k not in keys:
            keys.append(k)
    if not keys:
        raise ValueError("No FINNHUB_API_KEY* found in environment variables")
    return keys


def get_finnhub_api_key() -> str:
    """Return the next Finnhub key in round-robin rotation across all configured keys."""
    global _fh_key_index
    keys = get_finnhub_api_keys()
    with _fh_key_rotation_lock:
        key = keys[_fh_key_index % len(keys)]
        _fh_key_index += 1
    return key


def fetch_stock_quote(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch real-time quote data for a stock.

    Returns:
        Dict with current_price, change, percent_change, high/low/open, previous_close, timestamp
    """
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/quote"
    params = {'symbol': ticker, 'token': api_key}

    try:
        breaker.check('finnhub:quote')
        _fh_rate_limit(api_key)
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        breaker.record_success('finnhub:quote')

        if data.get('s') == 'no_data':
            return None

        return {
            'ticker': ticker,
            'current_price': data.get('c'),
            'change': data.get('d'),
            'percent_change': data.get('dp'),
            'high_price': data.get('h'),
            'low_price': data.get('l'),
            'open_price': data.get('o'),
            'previous_close': data.get('pc'),
            'timestamp': data.get('t'),
            'fetched_at': utc_now().isoformat()
        }

    except EndpointUnavailable:
        raise
    except requests.exceptions.RequestException as e:
        breaker.record_failure('finnhub:quote', e)
        print(f"Error fetching quote for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing quote data for {ticker}: {e}")
        return None


def fetch_crypto_quote(symbol: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch real-time quote for a crypto asset via Finnhub /quote.

    Uses the same endpoint as stocks but with exchange-prefixed symbol
    (e.g. 'BINANCE:BTCUSDT' for BTC). Returns ticker key mapped back to
    the short symbol (e.g. 'BTC').

    Args:
        symbol: Basket symbol (e.g. 'BTC', 'ETH', 'XRP')
        api_key: Optional API key

    Returns:
        Quote-shaped dict matching fetch_stock_quote() output, or None on error.
    """
    if symbol not in CRYPTO_SYMBOL_MAP:
        print(f"  Finnhub crypto: unknown symbol {symbol}")
        return None

    if api_key is None:
        api_key = get_finnhub_api_key()

    fh_symbol = CRYPTO_SYMBOL_MAP[symbol]
    quote = fetch_stock_quote(fh_symbol, api_key)
    if quote is None:
        return None

    # Re-key ticker back to the short basket symbol (e.g. 'BTC')
    quote['ticker'] = symbol
    return quote


# def fetch_stock_candles(ticker, resolution='D', days_back=365, api_key=None): ...


def fetch_company_profile(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch company profile from Finnhub /stock/profile2.
    Returns None for ETFs (use fetch_etf_profile instead).
    """
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/stock/profile2"
    params = {'symbol': ticker, 'token': api_key}

    try:
        _fh_rate_limit(api_key)
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()

        if not data or data.get('name') is None:
            return None

        return {
            'ticker': ticker,
            'name': data.get('name'),
            'country': data.get('country'),
            'currency': data.get('currency'),
            'exchange': data.get('exchange'),
            'ipo_date': data.get('ipo'),
            'market_cap': data.get('marketCapitalization'),
            'share_outstanding': data.get('shareOutstanding'),
            'logo': data.get('logo'),
            'website': data.get('weburl'),
            'industry': data.get('finnhubIndustry'),
            'fetched_at': utc_now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching profile for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing profile data for {ticker}: {e}")
        return None


def fetch_company_news(
    ticker: str,
    days_back: int = 7,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Fetch company-specific news articles from Finnhub."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    # ET calendar day, not the runner's local date: on a UTC runner at
    # 00:07 UTC (8:07pm ET the previous evening) date.today() is already
    # tomorrow in the market's own timezone.
    end_date = et_today()
    start_date = end_date - timedelta(days=days_back)

    url = f"{FINNHUB_BASE_URL}/company-news"
    params = {
        'symbol': ticker,
        'from': start_date.strftime('%Y-%m-%d'),
        'to': end_date.strftime('%Y-%m-%d'),
        'token': api_key
    }

    try:
        breaker.check('finnhub:company-news')
        _fh_rate_limit(api_key)
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        breaker.record_success('finnhub:company-news')

        articles = []
        for article in data:
            articles.append({
                'ticker': ticker,
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image'),
                'source': article.get('source'),
                'published_at': _epoch_to_iso(article.get('datetime')),
                'fetched_at': utc_now().isoformat()
            })

        return articles

    except EndpointUnavailable:
        raise
    except requests.exceptions.RequestException as e:
        # Raise, don't return []. Swallowing this made a total outage of the
        # endpoint indistinguishable from a quiet news day: company news went
        # 1847 -> 0 while etl_runs recorded zero errors and the domain
        # reported OK. The caller records it in stats['errors'].
        breaker.record_failure('finnhub:company-news', e)
        raise RuntimeError(f"finnhub company-news failed for {ticker}: {e}") from e
    except Exception as e:
        breaker.record_failure('finnhub:company-news', e)
        raise RuntimeError(f"finnhub company-news parse failed for {ticker}: {e}") from e


def fetch_market_news(category: str = 'general', min_id: int = 0, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch general market news from Finnhub (general, forex, crypto, merger)."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/news"
    params = {'category': category, 'minId': min_id, 'token': api_key}

    try:
        breaker.check('finnhub:market-news')
        _fh_rate_limit(api_key)
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        breaker.record_success('finnhub:market-news')

        articles = []
        for article in data:
            articles.append({
                'category': category,
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image'),
                'source': article.get('source'),
                'published_at': _epoch_to_iso(article.get('datetime')),
                'fetched_at': utc_now().isoformat()
            })

        return articles

    except EndpointUnavailable:
        raise
    except requests.exceptions.RequestException as e:
        breaker.record_failure('finnhub:market-news', e)
        raise RuntimeError(f"finnhub market-news failed for {category}: {e}") from e
    except Exception as e:
        breaker.record_failure('finnhub:market-news', e)
        raise RuntimeError(f"finnhub market-news parse failed for {category}: {e}") from e


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Finnhub API")
    print("=" * 60)

    key = get_finnhub_api_key()

    print("\n--- Stock Quote ---")
    quote = fetch_stock_quote('AAPL', key)
    if quote:
        print(f"AAPL: ${quote['current_price']}  {quote['change']} ({quote['percent_change']}%)")

    print("\n--- Company Profile ---")
    profile = fetch_company_profile('AAPL', key)
    if profile:
        print(f"{profile['name']} | {profile['industry']} | mktcap={profile['market_cap']}")

    print("\n--- Company News ---")
    news = fetch_company_news('AAPL', days_back=1, api_key=key)
    print(f"Found {len(news)} articles")
    for a in news[:3]:
        print(f"  - {a['headline']}")
