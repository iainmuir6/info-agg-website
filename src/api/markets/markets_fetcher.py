# markets_fetcher.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Fetches financial market data from Finnhub and Alpha Vantage APIs
#       ---> Supports stock quotes, candles, company profiles, news, sentiments, and more

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import requests
import os
import time

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"

STOCK_INDICES = {
    'sp500': '^GSPC',
    'dow': '^DJI',
    'nasdaq': '^IXIC',
    'russell2000': '^RUT'
}


def get_finnhub_api_key() -> str:
    api_key = os.getenv('FINNHUB_API_KEY')
    if not api_key: raise ValueError("FINNHUB_API_KEY not found in environment variables")
    return api_key


def get_alphavantage_api_key() -> str:
    api_key = os.getenv('ALPHA_VANTAGE_API_KEY')
    if not api_key: raise ValueError("ALPHA_VANTAGE_API_KEY not found in environment variables")
    return api_key


# ============================================================================
# FINNHUB API FUNCTIONS ##
# ============================================================================
def fetch_stock_quote(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch real-time quote data for a stock
    
    Args:
        ticker: Stock symbol (e.g., 'AAPL', 'MSFT')
        api_key: Optional API key (will fetch from env if not provided)
    
    Returns:
        Dictionary with quote data (current price, high, low, open, previous close, change, etc.)
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    url = f"{FINNHUB_BASE_URL}/quote"
    params = {
        'symbol': ticker,
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for error response
        if data.get('s') == 'no_data':
            return None
        
        return {
            'ticker': ticker,
            'current_price': data.get('c'),  # Current price
            'change': data.get('d'),  # Change
            'percent_change': data.get('dp'),  # Percent change
            'high_price': data.get('h'),  # High price of the day
            'low_price': data.get('l'),  # Low price of the day
            'open_price': data.get('o'),  # Open price of the day
            'previous_close': data.get('pc'),  # Previous close price
            'timestamp': data.get('t'),  # Unix timestamp
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching quote for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing quote data for {ticker}: {e}")
        return None


def fetch_stock_candles(
    ticker: str,
    resolution: str = 'D',
    days_back: int = 365,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch candlestick data (OHLCV) for a stock
    
    Args:
        ticker: Stock symbol
        resolution: Resolution of data (1, 5, 15, 30, 60, D, W, M)
        days_back: Number of days of historical data to fetch
        api_key: Optional API key
    
    Returns:
        Dictionary with OHLCV data and timestamps
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    # Calculate time range
    end_time = datetime.now()
    start_time = end_time - timedelta(days=days_back)
    
    from_timestamp = int(start_time.timestamp())
    to_timestamp = int(end_time.timestamp())
    
    url = f"{FINNHUB_BASE_URL}/stock/candle"
    params = {
        'symbol': ticker,
        'resolution': resolution,
        'from': from_timestamp,
        'to': to_timestamp,
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for error response
        if data.get('s') != 'ok':
            return None
        
        return {
            'ticker': ticker,
            'resolution': resolution,
            'open': data.get('o', []),  # Open prices
            'high': data.get('h', []),  # High prices
            'low': data.get('l', []),  # Low prices
            'close': data.get('c', []),  # Close prices
            'volume': data.get('v', []),  # Volumes
            'timestamps': data.get('t', []),  # Unix timestamps
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching candles for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing candles data for {ticker}: {e}")
        return None


# Per-key rate-limit tracking (5 req/min on free tier)
_AV_LAST_CALL: Dict[str, float] = {}
_AV_MIN_INTERVAL = 12.5  # seconds between calls per key


def get_alphavantage_api_keys() -> List[str]:
    """Return all configured Alpha Vantage API keys (for round-robin rotation)."""
    keys = []
    for i in ['', '_1', '_2', '_3']:
        k = os.getenv(f'ALPHA_VANTAGE_API_KEY{i}')
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
    Fetch daily OHLCV candle data for a stock via Alpha Vantage TIME_SERIES_DAILY.
    Returns data in the same shape as fetch_stock_candles() for drop-in compatibility.

    Args:
        ticker: Stock symbol (e.g. 'AAPL')
        days_back: How many calendar days of history to keep (max ~5 years with full output)
        api_key: Optional specific API key; if None, tries KEY_1 then KEY_2

    Returns:
        Dict with keys: ticker, resolution, open, high, low, close, volume, timestamps, fetched_at
        or None on failure.
    """
    keys = [api_key] if api_key else get_alphavantage_api_keys()
    outputsize = 'compact'  # free-tier keys; compact = last 100 trading days (~5 months)

    last_err = None
    for key in keys:
        # Respect per-key rate limit
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

            # Rate-limit / error messages
            if 'Note' in data or 'Information' in data:
                msg = data.get('Note') or data.get('Information', '')
                print(f"  Alpha Vantage key rotation triggered for {ticker}: {msg[:80]}")
                last_err = msg
                continue  # try next key

            if 'Error Message' in data:
                print(f"  Alpha Vantage error for {ticker}: {data['Error Message']}")
                return None

            ts_key = 'Time Series (Daily)'
            ts = data.get(ts_key)
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

            # Reverse so oldest-first
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


def fetch_company_profile(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch company profile information
    
    Args:
        ticker: Stock symbol
        api_key: Optional API key
    
    Returns:
        Dictionary with company profile data
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    url = f"{FINNHUB_BASE_URL}/stock/profile2"
    params = {
        'symbol': ticker,
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check if we got valid data
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


def fetch_company_news(
    ticker: str,
    days_back: int = 7,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch company news articles
    
    Args:
        ticker: Stock symbol
        days_back: Number of days to look back for news
        api_key: Optional API key
    
    Returns:
        List of news article dictionaries
    """
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
    """
    Fetch general market news
    
    Args:
        category: News category (general, forex, crypto, merger)
        min_id: Minimum news ID to fetch (for pagination)
        api_key: Optional API key
    
    Returns:
        List of news article dictionaries
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    url = f"{FINNHUB_BASE_URL}/news"
    params = {
        'category': category,
        'minId': min_id,
        'token': api_key
    }
    
    try:
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
    """
    Fetch analyst recommendation trends for a stock from Finnhub
    
    Args:
        ticker: Stock symbol
        api_key: Optional API key
    
    Returns:
        List of recommendation trend dictionaries
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    url = f"{FINNHUB_BASE_URL}/stock/recommendation"
    params = {
        'symbol': ticker,
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        trends = []
        for trend in data:
            trends.append({
                'ticker': ticker,
                'period': trend.get('period'),
                'strong_buy': trend.get('strongBuy', 0),
                'buy': trend.get('buy', 0),
                'hold': trend.get('hold', 0),
                'sell': trend.get('sell', 0),
                'strong_sell': trend.get('strongSell', 0),
                'fetched_at': datetime.now().isoformat()
            })
        
        return trends
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Finnhub recommendation trends for {ticker}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing Finnhub recommendation trends for {ticker}: {e}")
        return []


def fetch_country_metadata(api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch country metadata from Finnhub
    
    Args:
        api_key: Optional API key
    
    Returns:
        List of country metadata dictionaries
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    url = f"{FINNHUB_BASE_URL}/country"
    params = {
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        countries = []
        for country in data:
            countries.append({
                'code': country.get('code'),
                'country': country.get('country'),
                'currency': country.get('currency'),
                'market': country.get('market'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return countries
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Finnhub country metadata: {e}")
        return []
    except Exception as e:
        print(f"Error parsing Finnhub country metadata: {e}")
        return []


def fetch_usa_spending(api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch USA spending/government contracts data from Finnhub
    Note: This endpoint may require premium access
    
    Args:
        api_key: Optional API key
    
    Returns:
        Dictionary with USA spending data
    """
    if api_key is None:
        api_key = get_finnhub_api_key()
    
    # Note: The exact endpoint may vary - this is a placeholder based on common patterns
    # You may need to adjust the endpoint based on your Finnhub plan
    url = f"{FINNHUB_BASE_URL}/usa-spending"
    params = {
        'token': api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        return {
            'data': data,
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Finnhub USA spending: {e}")
        # If endpoint doesn't exist, return None (may require premium)
        return None
    except Exception as e:
        print(f"Error parsing Finnhub USA spending: {e}")
        return None


# ============================================================================
# ALPHA VANTAGE API FUNCTIONS
# ============================================================================
def fetch_index_constituents(symbol: str = 'VOO', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch constituents of a stock index using Alpha Vantage
    
    Args:
        symbol: ETF symbol
        api_key: Optional API key
    
    Returns:
        Dictionary with index constituents data
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()
    
    params = {
        'function': 'ETF_PROFILE',
        'symbol': symbol,
        'apikey': api_key
    }
    
    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage ETF profile: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Alpha Vantage ETF profile: {e}")
        return None


def fetch_news_sentiment(tickers: Optional[List[str]] = None, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch news sentiment analysis from Alpha Vantage
    
    Args:
        tickers: Optional list of ticker symbols to filter news (max 50)
        api_key: Optional API key
    
    Returns:
        List of news articles with sentiment analysis
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()
    
    params = {
        'function': 'NEWS_SENTIMENT',
        'apikey': api_key
    }
    
    # Add tickers if provided (comma-separated, max 50)
    if tickers:
        params['tickers'] = ','.join(tickers[:50])  # Limit to 50 tickers
    
    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for API error
        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note', 'Unknown error'))}")
            return []
        
        articles = []
        feed = data.get('feed', [])
        
        for article in feed:
            # Extract sentiment data
            overall_sentiment = article.get('overall_sentiment_score', 0)
            overall_label = article.get('overall_sentiment_label', 'Neutral')
            
            # Extract ticker sentiments
            ticker_sentiments = []
            for ticker_data in article.get('ticker_sentiment', []):
                ticker_sentiments.append({
                    'ticker': ticker_data.get('ticker'),
                    'relevance_score': ticker_data.get('relevance_score'),
                    'sentiment_score': ticker_data.get('ticker_sentiment_score'),
                    'sentiment_label': ticker_data.get('ticker_sentiment_label')
                })
            
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
                'overall_sentiment_score': overall_sentiment,
                'overall_sentiment_label': overall_label,
                'ticker_sentiments': ticker_sentiments,
                'fetched_at': datetime.now().isoformat()
            })
        
        return articles
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage news sentiment: {e}")
        return []
    except Exception as e:
        print(f"Error parsing Alpha Vantage news sentiment: {e}")
        return []


def fetch_top_gainers_losers(api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch top gainers, losers, and most actively traded stocks from Alpha Vantage
    
    Args:
        api_key: Optional API key
    
    Returns:
        Dictionary with top gainers, losers, and most actively traded
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()
    
    params = {
        'function': 'TOP_GAINERS_LOSERS',
        'apikey': api_key
    }
    
    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for API error
        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note', 'Unknown error'))}")
            return None
        
        return {
            'metadata': data.get('metadata', {}),
            'top_gainers': data.get('top_gainers', []),
            'top_losers': data.get('top_losers', []),
            'most_actively_traded': data.get('most_actively_traded', []),
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage top gainers/losers: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Alpha Vantage top gainers/losers: {e}")
        return None


def fetch_earnings_calendar(
    horizon: str = '3month',
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch earnings calendar from Alpha Vantage
    
    Args:
        horizon: Time horizon (3month, 6month, 12month)
        api_key: Optional API key
    
    Returns:
        Dictionary with earnings calendar data
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()
    
    params = {
        'function': 'EARNINGS_CALENDAR',
        'horizon': horizon,
        'apikey': api_key
    }
    
    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for API error
        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note', 'Unknown error'))}")
            return None
        
        return {
            'horizon': horizon,
            'earnings': data if isinstance(data, list) else data.get('earnings', []),
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage earnings calendar: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Alpha Vantage earnings calendar: {e}")
        return None


# ECONOMIC INDICATORS
# ============================================================================
def fetch_economic_indicator(
    function: str,
    interval: Optional[str] = None,
    maturity: Optional[str] = None,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch economic indicator data from Alpha Vantage
    
    Args:
        function: Economic indicator function (REAL_GDP, UNEMPLOYMENT, CPI, INFLATION,
                 TREASURY_YIELD, FEDERAL_FUNDS_RATE, RETAIL_SALES, DURABLE_GOODS_ORDERS,
                 NONFARM_PAYROLL, etc.)
        interval: Optional interval (annual, quarterly, monthly, daily, weekly)
        maturity: Required for TREASURY_YIELD (3month, 2year, 5year, 7year, 10year, 30year)
        api_key: Optional API key
    
    Returns:
        Dictionary with economic indicator data
    """
    if api_key is None:
        api_key = get_alphavantage_api_key()
    
    params = {
        'function': function,
        'apikey': api_key
    }
    
    # Add interval if provided
    if interval:
        params['interval'] = interval
    
    # Add maturity for treasury yield
    if function == 'TREASURY_YIELD':
        if not maturity:
            maturity = '10year'  # Default
        params['maturity'] = maturity
    
    try:
        response = requests.get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Check for API error
        if 'Error Message' in data or 'Note' in data:
            print(f"Alpha Vantage API error: {data.get('Error Message', data.get('Note', 'Unknown error'))}")
            return None
        
        # Extract data points
        data_points = []
        data_key = None
        
        # Find the data key (varies by function)
        for key in data.keys():
            if key.lower() in ['data', 'data points'] or 'data' in key.lower():
                if isinstance(data[key], list):
                    data_key = key
                    break
        
        # If no data key found, check for common patterns
        if not data_key:
            for key in data.keys():
                if key != 'name' and key != 'unit' and key != 'interval' and isinstance(data[key], list):
                    data_key = key
                    break
        
        if data_key:
            for point in data[data_key]:
                data_points.append({
                    'date': point.get('date'),
                    'value': point.get('value')
                })
        
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
        print(f"Error fetching Alpha Vantage economic indicator {function}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Alpha Vantage economic indicator {function}: {e}")
        return None


def fetch_economic_indicators(interval: str = 'annual', api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch Real GDP data from Alpha Vantage
    
    Args:
        interval: annual or quarterly
        api_key: Optional API key
    
    Returns:
        Dictionary with Real GDP data
    """
    gdp = fetch_economic_indicator('REAL_GDP', interval=interval, api_key=api_key)
    unemployment = fetch_economic_indicator('UNEMPLOYMENT', api_key=api_key)
    cpi = fetch_economic_indicator('CPI', interval=interval, api_key=api_key)
    inflation = fetch_economic_indicator('INFLATION', interval=interval, api_key=api_key)
    treasury_yield = fetch_economic_indicator('TREASURY_YIELD', interval=interval, maturity='10year', api_key=api_key)
    federal_funds_rate = fetch_economic_indicator('FEDERAL_FUNDS_RATE', interval=interval, api_key=api_key)
    retail_sales = fetch_economic_indicator('RETAIL_SALES', interval=interval, api_key=api_key)
    # durable_goods = fetch_economic_indicator('DURABLE_GOODS_ORDERS', interval=interval, api_key=api_key)
    # nonfarm_payroll = fetch_economic_indicator('NONFARM_PAYROLL', api_key=api_key)

    return {
        'gdp': gdp,
        'unemployment': unemployment,
        'cpi': cpi,
        'inflation': inflation,
        'treasury_yield': treasury_yield,
        'federal_funds_rate': federal_funds_rate,
        'retail_sales': retail_sales,
        # 'durable_goods': durable_goods,
        # 'nonfarm_payroll': nonfarm_payroll
    }


if __name__ == "__main__":
    print("=" * 60)
    print("Fetching market data from Finnhub and Alpha Vantage APIs...")
    print("=" * 60)
    
    # ============================================================================
    # FINNHUB API FUNCTIONS
    # ============================================================================
    print("\n--- Testing Finnhub API ---")
    finnhub_key = get_finnhub_api_key()
    
    print("\n--- Testing Stock Quote (Finnhub) ---")
    quote = fetch_stock_quote('AAPL', finnhub_key)
    if quote:
        print(f"AAPL Quote:")
        print(f"  Current Price: ${quote.get('current_price')}")
        print(f"  Change: {quote.get('change')} ({quote.get('percent_change')}%)")
        print(f"  High: ${quote.get('high_price')}, Low: ${quote.get('low_price')}")
    
    print("\n--- Testing Company Profile (Finnhub) ---")
    profile = fetch_company_profile('AAPL', finnhub_key)
    if profile:
        print(f"Company: {profile.get('name')}")
        print(f"  Industry: {profile.get('industry')}")
        print(f"  Market Cap: {profile.get('market_cap')}")
        print(f"  Exchange: {profile.get('exchange')}")
    
    print("\n--- Testing Company News (Finnhub) ---")
    news = fetch_company_news('AAPL', days_back=7, api_key=finnhub_key)
    print(f"Found {len(news)} news articles")
    for article in news[:3]:  # Show first 3
        print(f"  - {article.get('headline')}")
    
    # ============================================================================
    # ALPHA VANTAGE API FUNCTIONS
    # ============================================================================
    print("\n--- Testing Alpha Vantage API ---")
    av_key = get_alphavantage_api_key()
    
    snp_constituents = fetch_index_constituents('VOO', av_key)
    if snp_constituents:
        print("S&P 500 constituents received")
    else:
        print("S&P 500 constituents endpoint may require premium access")
    
    print("\n--- Testing Economic Indicators (Alpha Vantage) ---")
    economic_indicators = fetch_economic_indicators('annual', av_key)
    if economic_indicators:
        print("Economic indicators received")
    else:
        print("Economic indicators endpoint may require premium access")
    
    print("\n--- Testing Top Gainers/Losers (Alpha Vantage) ---")
    top_gainers_losers = fetch_top_gainers_losers(av_key)
    if top_gainers_losers:
        print("Top gainers/losers received")
    else:
        print("Top gainers/losers endpoint may require premium access")
    
    print("\n--- Testing Earnings Calendar (Alpha Vantage) ---")
    earnings_calendar = fetch_earnings_calendar('3month', av_key)
    if earnings_calendar:
        print("Earnings calendar received")
    else:
        print("Earnings calendar endpoint may require premium access")
    
    