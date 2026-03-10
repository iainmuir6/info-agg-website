# finnhub.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches financial market data from the Finnhub API
#       ---> Supports stock quotes, company profiles (stocks + ETFs), news

from typing import Dict, List, Optional, Any
from collections import deque
from datetime import datetime, timedelta
import requests
import os
import time

from dotenv import load_dotenv
load_dotenv()

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"

STOCK_INDICES = {
    'sp500': '^GSPC',
    'dow': '^DJI',
    'nasdaq': '^IXIC',
    'russell2000': '^RUT'
}

# Finnhub free tier: 60 API calls/minute — sliding-window rate limiter
_FH_CALL_TIMES: deque = deque()
_FH_RATE_LIMIT = 60
_FH_WINDOW = 60.0


def _fh_rate_limit() -> None:
    """Sleep only if we're about to exceed 60 req/min on Finnhub."""
    now = time.time()
    while _FH_CALL_TIMES and now - _FH_CALL_TIMES[0] >= _FH_WINDOW:
        _FH_CALL_TIMES.popleft()
    if len(_FH_CALL_TIMES) >= _FH_RATE_LIMIT:
        sleep_for = _FH_WINDOW - (now - _FH_CALL_TIMES[0]) + 0.05
        if sleep_for > 0:
            time.sleep(sleep_for)
    _FH_CALL_TIMES.append(time.time())


def get_finnhub_api_key() -> str:
    api_key = os.getenv('FINNHUB_API_KEY')
    if not api_key:
        raise ValueError("FINNHUB_API_KEY not found in environment variables")
    return api_key


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
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

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
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching quote for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing quote data for {ticker}: {e}")
        return None


# DEPRECATED: fetch_stock_candles (Finnhub /stock/candle) — use alpha_vantage.fetch_stock_candles_av instead.
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
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
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
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching profile for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing profile data for {ticker}: {e}")
        return None


def fetch_etf_profile(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch ETF profile from Finnhub /etf/profile.
    Returns data in the same shape as fetch_company_profile() for drop-in compatibility.
    NOTE: Requires Finnhub premium — returns 403 on the free tier.
    """
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/etf/profile"
    params = {'symbol': ticker, 'token': api_key}

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not data or not data.get('name'):
            return None

        return {
            'ticker': ticker,
            'name': data.get('name'),
            'country': data.get('domicile'),
            'currency': data.get('nav_currency'),
            'exchange': None,
            'ipo_date': data.get('inception_date'),
            'market_cap': None,
            'share_outstanding': None,
            'logo': data.get('logo'),
            'website': data.get('website'),
            'industry': data.get('asset_class'),  # e.g. "Equity"
            'fetched_at': datetime.now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching ETF profile for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing ETF profile for {ticker}: {e}")
        return None


def fetch_company_news(
    ticker: str,
    days_back: int = 7,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Fetch company-specific news articles from Finnhub."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days_back)

    url = f"{FINNHUB_BASE_URL}/company-news"
    params = {
        'symbol': ticker,
        'from': start_date.strftime('%Y-%m-%d'),
        'to': end_date.strftime('%Y-%m-%d'),
        'token': api_key
    }

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        articles = []
        for article in data:
            articles.append({
                'ticker': ticker,
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image'),
                'source': article.get('source'),
                'published_at': datetime.fromtimestamp(article.get('datetime', 0)).isoformat() if article.get('datetime') else None,
                'related_tickers': [t for t in (article.get('related') or '').split(',') if t],
                'fetched_at': datetime.now().isoformat()
            })

        return articles

    except requests.exceptions.RequestException as e:
        print(f"Error fetching company news for {ticker}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing company news for {ticker}: {e}")
        return []


def fetch_market_news(category: str = 'general', min_id: int = 0, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch general market news from Finnhub (general, forex, crypto, merger)."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/news"
    params = {'category': category, 'minId': min_id, 'token': api_key}

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        articles = []
        for article in data:
            articles.append({
                'category': category,
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image_url': article.get('image'),
                'source': article.get('source'),
                'published_at': datetime.fromtimestamp(article.get('datetime', 0)).isoformat() if article.get('datetime') else None,
                'related_tickers': [t for t in (article.get('related') or '').split(',') if t],
                'fetched_at': datetime.now().isoformat()
            })

        return articles

    except requests.exceptions.RequestException as e:
        print(f"Error fetching market news: {e}")
        return []
    except Exception as e:
        print(f"Error parsing market news: {e}")
        return []


def fetch_recommendation_trends(ticker: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch analyst recommendation trends for a stock."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/stock/recommendation"
    params = {'symbol': ticker, 'token': api_key}

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        return [
            {
                'ticker': ticker,
                'period': trend.get('period'),
                'strong_buy': trend.get('strongBuy', 0),
                'buy': trend.get('buy', 0),
                'hold': trend.get('hold', 0),
                'sell': trend.get('sell', 0),
                'strong_sell': trend.get('strongSell', 0),
                'fetched_at': datetime.now().isoformat()
            }
            for trend in data
        ]

    except requests.exceptions.RequestException as e:
        print(f"Error fetching recommendation trends for {ticker}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing recommendation trends for {ticker}: {e}")
        return []


def fetch_country_metadata(api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch country metadata from Finnhub."""
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/country"
    params = {'token': api_key}

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        return [
            {
                'code': c.get('code'),
                'country': c.get('country'),
                'currency': c.get('currency'),
                'market': c.get('market'),
                'fetched_at': datetime.now().isoformat()
            }
            for c in data
        ]

    except requests.exceptions.RequestException as e:
        print(f"Error fetching country metadata: {e}")
        return []
    except Exception as e:
        print(f"Error parsing country metadata: {e}")
        return []


def fetch_usa_spending(api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch USA spending/government contracts data from Finnhub.
    NOTE: May require premium access.
    """
    if api_key is None:
        api_key = get_finnhub_api_key()

    url = f"{FINNHUB_BASE_URL}/usa-spending"
    params = {'token': api_key}

    try:
        _fh_rate_limit()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return {'data': response.json(), 'fetched_at': datetime.now().isoformat()}

    except requests.exceptions.RequestException as e:
        print(f"Error fetching USA spending: {e}")
        return None
    except Exception as e:
        print(f"Error parsing USA spending: {e}")
        return None


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
    news = fetch_company_news('AAPL', days_back=7, api_key=key)
    print(f"Found {len(news)} articles")
    for a in news[:3]:
        print(f"  - {a['headline']}")
