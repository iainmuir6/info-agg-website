# alpha_vantage.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches financial market data from the Alpha Vantage API
#       ---> Supports daily OHLCV candles, economic indicators, sentiment, earnings

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import requests
import os
import time

from dotenv import load_dotenv
load_dotenv()

ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"

# Free tier: 5 req/min, 25 req/day per key — enforce 12.5s minimum between calls per key
_AV_LAST_CALL: Dict[str, float] = {}
_AV_MIN_INTERVAL = 12.5  # seconds between calls per key


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


def fetch_stock_candles_av(
    ticker: str,
    days_back: int = 365,
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
    keys = [api_key] if api_key else get_alphavantage_api_keys()
    outputsize = 'compact'  # last 100 trading days (~5 months) on free tier

    last_err = None
    for key in keys:
        elapsed = time.time() - _AV_LAST_CALL.get(key, 0)
        if elapsed < _AV_MIN_INTERVAL:
            time.sleep(_AV_MIN_INTERVAL - elapsed)
        _AV_LAST_CALL[key] = time.time()

        params = {
            'function': 'TIME_SERIES_DAILY',
            'symbol': ticker,
            'outputsize': outputsize,
            'apikey': key,
        }
        try:
            response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=15)
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


def fetch_index_constituents(symbol: str = 'VOO', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch ETF constituents via Alpha Vantage ETF_PROFILE (premium endpoint)."""
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': 'ETF_PROFILE', 'symbol': symbol, 'apikey': api_key}

    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage ETF profile: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Alpha Vantage ETF profile: {e}")
        return None


def fetch_news_sentiment(tickers: Optional[List[str]] = None, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch news sentiment analysis from Alpha Vantage (max 50 tickers)."""
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': 'NEWS_SENTIMENT', 'apikey': api_key}
    if tickers:
        params['tickers'] = ','.join(tickers[:50])

    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note'))}")
            return []

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

    except requests.exceptions.RequestException as e:
        print(f"Error fetching news sentiment: {e}")
        return []
    except Exception as e:
        print(f"Error parsing news sentiment: {e}")
        return []


def fetch_top_gainers_losers(api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch top gainers, losers, and most actively traded from Alpha Vantage."""
    if api_key is None:
        api_key = get_alphavantage_api_key()

    params = {'function': 'TOP_GAINERS_LOSERS', 'apikey': api_key}

    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
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
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
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
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
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

    print("\n--- Daily Candles (AAPL, 30d) ---")
    candles = fetch_stock_candles_av('AAPL', days_back=30)
    if candles:
        print(f"  {len(candles['timestamps'])} bars returned")

    print("\n--- Historical Quotes (AAPL, 30d) ---")
    quotes = fetch_historical_quotes('AAPL', days_back=30)
    print(f"  {len(quotes)} quote records")

    print("\n--- Top Gainers/Losers ---")
    gl = fetch_top_gainers_losers()
    if gl:
        print(f"  {len(gl['top_gainers'])} gainers, {len(gl['top_losers'])} losers")
