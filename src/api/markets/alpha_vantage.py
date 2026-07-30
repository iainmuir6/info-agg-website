# alpha_vantage.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches financial market data from the Alpha Vantage API
#       ---> Supports daily OHLCV candles, economic indicators, sentiment, earnings

from typing import Dict, List, Optional, Any
from collections import deque
from datetime import datetime, timedelta
import requests
import threading
import os
import sys
import time

from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import get_http_session

ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"

# NEWS_SENTIMENT treats a ticker list as AND, not OR, and 400s on long lists.
MAX_SENTIMENT_TICKERS = 2

# Free tier: 5 req/min per key — sliding-window rate limiter (same pattern as Finnhub)
_AV_CALL_TIMES: Dict[str, deque] = {}
_AV_KEY_LOCKS: Dict[str, threading.Lock] = {}
_AV_INIT_LOCK = threading.Lock()
_AV_RATE_LIMIT = 5     # calls per window
_AV_WINDOW     = 60.0  # seconds


class AVQuotaExhausted(RuntimeError):
    """A key has spent its 25-request daily allowance. Retrying costs a request
    and returns the same answer, so callers should stop using that key today."""


_AV_EXHAUSTED: set = set()
_AV_EXHAUSTED_LOCK = threading.Lock()


def mark_av_key_exhausted(api_key: str) -> None:
    with _AV_EXHAUSTED_LOCK:
        _AV_EXHAUSTED.add(api_key)


def is_av_key_exhausted(api_key: str) -> bool:
    with _AV_EXHAUSTED_LOCK:
        return api_key in _AV_EXHAUSTED


# AV also throttles bursts by IP, not just by key, answering with an
# "Information: … 1 request per second" body instead of data. Pace every
# request at least this far apart across all keys.
_AV_MIN_GAP    = 1.1   # seconds
_AV_GAP_LOCK = threading.Lock()
_AV_LAST_CALL = 0.0

def _av_rate_limit(key: str) -> None:
    """Block until a request may go out: 5 req/60 s per key, ≥1.1 s apart globally.

    Never sleeps while holding a lock — a lock-held sleep serializes every
    worker sharing it (the historical ETL hang)."""
    global _AV_LAST_CALL

    if key not in _AV_KEY_LOCKS:
        with _AV_INIT_LOCK:
            if key not in _AV_KEY_LOCKS:
                _AV_CALL_TIMES[key] = deque()
                _AV_KEY_LOCKS[key] = threading.Lock()

    while True:
        with _AV_KEY_LOCKS[key]:
            times = _AV_CALL_TIMES[key]
            now = time.time()
            while times and now - times[0] >= _AV_WINDOW:
                times.popleft()
            window_wait = (_AV_WINDOW - (now - times[0]) + 0.05
                           if len(times) >= _AV_RATE_LIMIT else 0.0)
        if window_wait > 0:
            time.sleep(window_wait)
            continue

        with _AV_GAP_LOCK:
            now = time.time()
            gap_wait = _AV_MIN_GAP - (now - _AV_LAST_CALL)
            if gap_wait <= 0:
                _AV_LAST_CALL = now
                with _AV_KEY_LOCKS[key]:
                    _AV_CALL_TIMES[key].append(now)
                return
        time.sleep(gap_wait)


def get_alphavantage_api_key() -> str:
    api_key = os.getenv('ALPHA_VANTAGE_API_KEY')
    if not api_key:
        raise ValueError("ALPHA_VANTAGE_API_KEY not found in environment variables")
    return api_key


def get_alphavantage_api_keys() -> List[str]:
    """Return all configured Alpha Vantage API keys for round-robin rotation."""
    keys = []
    for suffix in ['', '_1', '_2', '_3']:
        k = os.getenv(f'ALPHA_VANTAGE_API_KEY{suffix}')
        if k and k not in keys:
            keys.append(k)
    if not keys:
        raise ValueError("No ALPHA_VANTAGE_API_KEY* found in environment variables")
    return keys


_av_key_index: int = 0  # module-level round-robin counter


def _get_keys_round_robin(api_key: Optional[str] = None) -> List[str]:
    """Return keys list starting from the next round-robin position.

    Each call advances the counter so successive ticker fetches are distributed
    evenly across all configured keys instead of always starting with key 0.
    Fallback to the next key on Note/Information is preserved by the caller's
    ``for key in keys`` loop.
    """
    global _av_key_index
    if api_key:
        return [api_key]
    keys = get_alphavantage_api_keys()
    start = _av_key_index % len(keys)
    _av_key_index += 1
    return keys[start:] + keys[:start]

# ================================================================================================
# Markets Endpoints - DB SEED ONLY
# ================================================================================================
def fetch_stock_candles_av(
    ticker: str,
    days_back: int = 30,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch daily OHLCV candle data via Alpha Vantage TIME_SERIES_DAILY.

    Args:
        ticker: Stock symbol (e.g. 'AAPL')
        days_back: Calendar days of history to keep (compact output = last 100 trading days)
        api_key: Optional specific key; if None, rotates across all configured keys

    Returns:
        Dict with keys: ticker, resolution, open, high, low, close, volume, timestamps, fetched_at
    """
    keys = _get_keys_round_robin(api_key)
    outputsize = 'compact'  # last 100 trading days (~5 months) on free tier

    last_err = None
    for key in keys:
        _av_rate_limit(key)

        params = {
            'function': 'TIME_SERIES_DAILY',
            'symbol': ticker,
            'outputsize': outputsize,
            'apikey': key,
        }
        try:
            response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()

            if 'Note' in data or 'Information' in data:
                msg = data.get('Note') or data.get('Information', '')
                print(f"  Alpha Vantage key rotation triggered for {ticker}: {msg[:80]}")
                last_err = msg
                continue

            if 'Error Message' in data:
                print(f"  Alpha Vantage error for {ticker}: {data['Error Message']}")
                return None

            ts = data.get('Time Series (Daily)')
            if not ts:
                print(f"  Alpha Vantage: no time-series data for {ticker}")
                return None

            cutoff = datetime.now() - timedelta(days=days_back)
            opens, highs, lows, closes, volumes, timestamps = [], [], [], [], [], []

            for date_str in sorted(ts.keys(), reverse=True):
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                if dt < cutoff:
                    break
                bar = ts[date_str]
                timestamps.append(int(dt.timestamp()))
                opens.append(float(bar.get('1. open', 0)))
                highs.append(float(bar.get('2. high', 0)))
                lows.append(float(bar.get('3. low', 0)))
                closes.append(float(bar.get('4. close', 0)))
                volumes.append(int(float(bar.get('5. volume', 0))))

            # Reverse to oldest-first
            timestamps.reverse(); opens.reverse(); highs.reverse()
            lows.reverse(); closes.reverse(); volumes.reverse()

            return {
                'ticker': ticker,
                'resolution': 'D',
                'open': opens,
                'high': highs,
                'low': lows,
                'close': closes,
                'volume': volumes,
                'timestamps': timestamps,
                'fetched_at': datetime.now().isoformat(),
            }

        except requests.exceptions.RequestException as e:
            last_err = str(e)
            print(f"  Alpha Vantage request error for {ticker}: {e}")
            continue
        except Exception as e:
            print(f"  Alpha Vantage parse error for {ticker}: {e}")
            return None

    print(f"  All Alpha Vantage keys exhausted for {ticker}. Last error: {last_err}")
    return None


def fetch_historical_quotes(
    ticker: str,
    days_back: int = 30,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch the last N days of daily OHLCV candles and convert each day into a
    quote-shaped record (same fields as finnhub.fetch_stock_quote()) for bulk backfill
    of the stock_quotes table.

    Returns a list of quote dicts ordered oldest → newest.
    """
    candles = fetch_stock_candles_av(ticker, days_back=days_back, api_key=api_key)
    if not candles or not candles.get('timestamps'):
        return []

    timestamps = candles['timestamps']
    closes = candles['close']
    opens = candles['open']
    highs = candles['high']
    lows = candles['low']

    quotes = []
    for i, ts in enumerate(timestamps):
        prev_close = closes[i - 1] if i > 0 else None
        close = closes[i]
        change = (close - prev_close) if prev_close is not None else None
        pct_change = (change / prev_close * 100) if prev_close else None
        quotes.append({
            'ticker': ticker,
            'current_price': close,
            'change': change,
            'percent_change': pct_change,
            'high_price': highs[i],
            'low_price': lows[i],
            'open_price': opens[i],
            'previous_close': prev_close,
            'timestamp': ts,
            'fetched_at': datetime.now().isoformat()
        })

    return quotes


def fetch_crypto_candles_av(
    symbol: str,
    market: str = 'USD',
    days_back: int = 30,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch daily OHLCV candle data for a crypto asset via Alpha Vantage DIGITAL_CURRENCY_DAILY.
    Returns a list of quote-shaped dicts (same shape as fetch_historical_quotes) ordered oldest→newest.

    Args:
        symbol: Crypto symbol (e.g. 'BTC', 'ETH')
        market: Market currency (default 'USD')
        days_back: Calendar days of history to keep
        api_key: Optional specific key; if None, rotates across all configured keys
    """
    keys = _get_keys_round_robin(api_key)
    last_err = None

    for key in keys:
        _av_rate_limit(key)

        params = {
            'function': 'DIGITAL_CURRENCY_DAILY',
            'symbol': symbol,
            'market': market,
            'apikey': key,
        }
        try:
            response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()

            if 'Note' in data or 'Information' in data:
                msg = data.get('Note') or data.get('Information', '')
                print(f"  Alpha Vantage key rotation triggered for {symbol}: {msg[:80]}")
                last_err = msg
                continue

            if 'Error Message' in data:
                print(f"  Alpha Vantage error for {symbol}: {data['Error Message']}")
                return []

            ts = data.get('Time Series (Digital Currency Daily)')
            if not ts:
                print(f"  Alpha Vantage: no crypto time-series data for {symbol}")
                return []

            cutoff = datetime.now() - timedelta(days=days_back)
            rows = []
            for date_str in sorted(ts.keys(), reverse=True):
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                if dt < cutoff:
                    break
                bar = ts[date_str]
                rows.append((int(dt.timestamp()), bar))

            # Reverse to oldest-first
            rows.reverse()

            quotes = []
            for i, (ts_val, bar) in enumerate(rows):
                close = float(bar.get('4a. close (USD)', 0) or bar.get('4. close', 0))
                open_ = float(bar.get('1a. open (USD)', 0) or bar.get('1. open', 0))
                high  = float(bar.get('2a. high (USD)', 0) or bar.get('2. high', 0))
                low   = float(bar.get('3a. low (USD)', 0) or bar.get('3. low', 0))
                vol   = int(float(bar.get('5. volume', 0)))
                prev_close = float(rows[i - 1][1].get('4a. close (USD)', 0) or
                                   rows[i - 1][1].get('4. close', 0)) if i > 0 else None
                change = (close - prev_close) if prev_close is not None else None
                pct_change = (change / prev_close * 100) if prev_close else None
                quotes.append({
                    'ticker': symbol,
                    'current_price': close,
                    'change': change,
                    'percent_change': pct_change,
                    'high_price': high,
                    'low_price': low,
                    'open_price': open_,
                    'previous_close': prev_close,
                    'volume': vol,
                    'timestamp': ts_val,
                    'fetched_at': datetime.now().isoformat(),
                })

            return quotes

        except requests.exceptions.RequestException as e:
            last_err = str(e)
            print(f"  Alpha Vantage request error for {symbol}: {e}")
            continue
        except Exception as e:
            print(f"  Alpha Vantage parse error for {symbol}: {e}")
            return []

    print(f"  All Alpha Vantage keys exhausted for {symbol}. Last error: {last_err}")
    return []


def fetch_index_constituents(symbol: str = 'VOO', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch ETF profile and holdings via Alpha Vantage ETF_PROFILE.

    Uses round-robin key rotation with the same Note/Information fallback
    pattern as the other AV fetchers.

    Returns the raw AV response dict (keys: net_assets, net_asset_value,
    pe_ratio, dividend_yield, inception_date, leveraged, holdings[]),
    or None on failure.
    """
    keys = _get_keys_round_robin(api_key)
    last_err = None

    for key in keys:
        _av_rate_limit(key)

        params = {'function': 'ETF_PROFILE', 'symbol': symbol, 'apikey': key}
        try:
            response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            if 'Note' in data or 'Information' in data:
                msg = data.get('Note') or data.get('Information', '')
                print(f"  Alpha Vantage key rotation triggered for ETF_PROFILE {symbol}: {msg[:80]}")
                last_err = msg
                continue

            if 'Error Message' in data:
                print(f"  Alpha Vantage error for ETF_PROFILE {symbol}: {data['Error Message']}")
                return None

            return data

        except requests.exceptions.RequestException as e:
            last_err = str(e)
            print(f"  Alpha Vantage request error for ETF_PROFILE {symbol}: {e}")
            continue
        except Exception as e:
            print(f"  Alpha Vantage parse error for ETF_PROFILE {symbol}: {e}")
            return None

    print(f"  All Alpha Vantage keys exhausted for ETF_PROFILE {symbol}. Last error: {last_err}")
    return None


def fetch_etf_holdings_av(symbol: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch and normalize ETF holdings from AV ETF_PROFILE into the format
    expected by ``upsert_etf_holdings``.

    AV provides symbol, description, and weight (e.g. "7.29%") per holding.
    shares and market_value are not available via this endpoint and are left None.

    Returns a list of dicts with keys:
        asset_symbol, asset_name, weight_percentage, shares, market_value, as_of_date
    """
    raw = fetch_index_constituents(symbol, api_key=api_key)
    if not raw:
        return []

    today = datetime.now().strftime('%Y-%m-%d')
    holdings = []
    for h in raw.get('holdings', []):
        asset_symbol = h.get('symbol') or h.get('asset_symbol')
        if not asset_symbol:
            continue

        weight_str = h.get('weight', '')
        weight_pct: Optional[float] = None
        if weight_str:
            try:
                weight_pct = float(str(weight_str).strip('%'))
            except (ValueError, AttributeError):
                pass

        holdings.append({
            'asset_symbol': asset_symbol,
            'asset_name': h.get('description') or h.get('asset_name'),
            'weight_percentage': weight_pct,
            'shares': None,        # not provided by ETF_PROFILE
            'market_value': None,  # not provided by ETF_PROFILE
            'as_of_date': today,
        })

    return holdings


# ================================================================================================
# News Sentiment Endpoints - DAILY RUN
# ================================================================================================
def fetch_news_sentiment(
    api_key: str,
    tickers: Optional[List[str]] = None,
    topic: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fetch news sentiment from Alpha Vantage NEWS_SENTIMENT for a single topic.

    Uses the assigned key only — no rotation. Caller is responsible for key assignment.

    Args:
        api_key: The specific AV API key to use for this request.
        tickers: Optional ticker filter. AV ANDs these — an article must mention
            *every* ticker listed — so only pass one or two. AV also rejects long
            lists outright with "Invalid inputs", hence the hard cap below.
        topic: Optional single topic filter (e.g. 'earnings', 'technology').
    """
    if is_av_key_exhausted(api_key):
        raise AVQuotaExhausted(f"AV daily quota already exhausted for key …{api_key[-4:]}")

    if tickers and len(tickers) > MAX_SENTIMENT_TICKERS:
        raise ValueError(
            f"NEWS_SENTIMENT ANDs tickers; got {len(tickers)} "
            f"(max {MAX_SENTIMENT_TICKERS}). Query topics without a ticker filter instead."
        )

    _av_rate_limit(api_key)

    params: Dict[str, Any] = {'function': 'NEWS_SENTIMENT', 'apikey': api_key}
    if tickers:
        params['tickers'] = ','.join(tickers)
    if topic:
        params['topics'] = topic

    try:
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        # Rate-limit / quota responses come back HTTP 200 with a Note or
        # Information body. Raise so the caller records a real error —
        # silently returning [] made "sentiment=0" look like a healthy run.
        if 'Note' in data or 'Information' in data:
            msg = (data.get('Note') or data.get('Information') or '')[:120]
            if 'per day' in msg:
                # Daily quota is spent for the rest of the UTC day. Remember it
                # so the remaining topics skip this key instead of burning a
                # request each to be told the same thing.
                mark_av_key_exhausted(api_key)
                raise AVQuotaExhausted(f"AV daily quota exhausted for key …{api_key[-4:]}")
            raise RuntimeError(f"AV rate/quota response for topic {topic}: {msg}")

        if 'Error Message' in data:
            raise RuntimeError(f"AV error for topic {topic}: {str(data['Error Message'])[:120]}")

        articles = []
        for article in data.get('feed', []):
            ticker_sentiments = [
                {
                    'ticker': td.get('ticker'),
                    'relevance_score': td.get('relevance_score'),
                    'sentiment_score': td.get('ticker_sentiment_score'),
                    'sentiment_label': td.get('ticker_sentiment_label')
                }
                for td in article.get('ticker_sentiment', [])
            ]
            articles.append({
                'title': article.get('title'),
                'url': article.get('url'),
                'time_published': article.get('time_published'),
                'authors': article.get('authors', []),
                'summary': article.get('summary'),
                'banner_image': article.get('banner_image'),
                'source': article.get('source'),
                'category_within_source': article.get('category_within_source'),
                'source_domain': article.get('source_domain'),
                'topics': article.get('topics', []),
                'overall_sentiment_score': article.get('overall_sentiment_score', 0),
                'overall_sentiment_label': article.get('overall_sentiment_label', 'Neutral'),
                'ticker_sentiments': ticker_sentiments,
                'fetched_at': datetime.now().isoformat()
            })

        return articles

    except RuntimeError:
        raise  # quota/API errors must reach the caller's stats
    except Exception as e:
        raise RuntimeError(f"AV sentiment fetch failed for topic {topic}: {e}")


# ================================================================================================
# Miscellaneous Endpoints
# ================================================================================================
def fetch_top_gainers_losers(api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch top gainers, losers, and most actively traded from Alpha Vantage."""
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': 'TOP_GAINERS_LOSERS', 'apikey': api_key}

    try:
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note'))}")
            return None

        return {
            'metadata': data.get('metadata', {}),
            'top_gainers': data.get('top_gainers', []),
            'top_losers': data.get('top_losers', []),
            'most_actively_traded': data.get('most_actively_traded', []),
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching top gainers/losers: {e}")
        return None
    except Exception as e:
        print(f"Error parsing top gainers/losers: {e}")
        return None


def fetch_earnings_calendar(horizon: str = '3month', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch earnings calendar from Alpha Vantage (horizon: 3month, 6month, 12month)."""
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': 'EARNINGS_CALENDAR', 'horizon': horizon, 'apikey': api_key}

    try:
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note'))}")
            return None

        return {
            'horizon': horizon,
            'earnings': data if isinstance(data, list) else data.get('earnings', []),
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching earnings calendar: {e}")
        return None
    except Exception as e:
        print(f"Error parsing earnings calendar: {e}")
        return None


def fetch_economic_indicator(
    function: str,
    interval: Optional[str] = None,
    maturity: Optional[str] = None,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch a single economic indicator from Alpha Vantage.

    Args:
        function: REAL_GDP, UNEMPLOYMENT, CPI, INFLATION, TREASURY_YIELD,
                  FEDERAL_FUNDS_RATE, RETAIL_SALES, etc.
        interval: annual, quarterly, monthly, daily, weekly
        maturity: Required for TREASURY_YIELD (3month, 2year, 5year, 10year, 30year)
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': function, 'apikey': api_key}
    if interval:
        params['interval'] = interval
    if function == 'TREASURY_YIELD':
        params['maturity'] = maturity or '10year'

    try:
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note'))}")
            return None

        # Find the list key (varies by indicator)
        data_key = next(
            (k for k in data if isinstance(data[k], list) and k not in ('name', 'unit', 'interval')),
            None
        )
        data_points = [{'date': p.get('date'), 'value': p.get('value')} for p in (data.get(data_key) or [])]

        return {
            'indicator': function,
            'name': data.get('name'),
            'interval': data.get('interval') or interval,
            'unit': data.get('unit'),
            'maturity': maturity if function == 'TREASURY_YIELD' else None,
            'data': data_points,
            'raw_data': data,
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching economic indicator {function}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing economic indicator {function}: {e}")
        return None


def fetch_economic_indicators(interval: str = 'annual', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch a bundle of key economic indicators from Alpha Vantage."""
    return {
        'gdp': fetch_economic_indicator('REAL_GDP', interval=interval, api_key=api_key),
        'unemployment': fetch_economic_indicator('UNEMPLOYMENT', api_key=api_key),
        'cpi': fetch_economic_indicator('CPI', interval=interval, api_key=api_key),
        'inflation': fetch_economic_indicator('INFLATION', interval=interval, api_key=api_key),
        'treasury_yield': fetch_economic_indicator('TREASURY_YIELD', interval=interval, maturity='10year', api_key=api_key),
        'federal_funds_rate': fetch_economic_indicator('FEDERAL_FUNDS_RATE', interval=interval, api_key=api_key),
        'retail_sales': fetch_economic_indicator('RETAIL_SALES', interval=interval, api_key=api_key),
    }


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Alpha Vantage API")
    print("=" * 60)

    print("\n--- News Sentiment (topic=earnings) ---")
    sentiment = fetch_news_sentiment(topic='earnings')
    print(f"  {len(sentiment)} articles")
    if sentiment:
        print(f"  First: {sentiment[0]['title'][:60]}")

    print("\n--- Top Gainers/Losers ---")
    gl = fetch_top_gainers_losers()
    if gl:
        print(f"  {len(gl['top_gainers'])} gainers, {len(gl['top_losers'])} losers")
