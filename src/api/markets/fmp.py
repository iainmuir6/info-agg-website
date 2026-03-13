# fmp.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-10
# Description: Fetches financial market data from the Financial Modeling Prep (FMP) API
#       ---> Fills gaps Finnhub cannot cover on the free tier:
#            ETF profiles/holdings, richer company profiles (sector, CEO, description)

from typing import Dict, List, Optional, Any
from datetime import date, datetime, timedelta
import requests
import warnings
import os

from dotenv import load_dotenv
load_dotenv()

# FMP_BASE_V3 = "https://financialmodelingprep.com/api/v3"
FMP_BASE_STABLE = "https://financialmodelingprep.com/stable"

# FMP free tier: 250 requests/day — daily counter with midnight reset
_FMP_DAILY_COUNT: int = 0
_FMP_DAILY_DATE: Optional[date] = None
_FMP_DAILY_LIMIT = 250
_FMP_WARN_THRESHOLD = 220


def _fmp_rate_check() -> None:
    """Warn when approaching 250 req/day; block (raise) at the hard limit."""
    global _FMP_DAILY_COUNT, _FMP_DAILY_DATE

    today = date.today()
    if _FMP_DAILY_DATE != today:
        _FMP_DAILY_COUNT = 0
        _FMP_DAILY_DATE = today

    _FMP_DAILY_COUNT += 1

    if _FMP_DAILY_COUNT >= _FMP_DAILY_LIMIT:
        raise RuntimeError(
            f"FMP daily request limit reached ({_FMP_DAILY_LIMIT}). "
            "Skipping remaining FMP calls for today."
        )
    if _FMP_DAILY_COUNT >= _FMP_WARN_THRESHOLD:
        warnings.warn(
            f"FMP daily request count is {_FMP_DAILY_COUNT}/{_FMP_DAILY_LIMIT} — "
            "approaching daily limit.",
            stacklevel=2
        )


def get_fmp_api_key() -> str:
    api_key = os.getenv('FMP_API_KEY')
    if not api_key:
        raise ValueError("FMP_API_KEY not found in environment variables")
    return api_key


# ---------------------------------------------------------------------------
# Actively used in daily ETL
# ---------------------------------------------------------------------------
def fetch_company_profile(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch company profile from FMP /stable/profile?symbol={symbol}.

    Field mapping verified against live API response (fmp_aapl.json).
    Returns None if the ticker is unknown to FMP or has no companyName.
    """
    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/profile"
    params = {'symbol': ticker.replace('.', '-'), 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not data or not isinstance(data, list):
            return None

        p = data[0]
        if not p.get('companyName'):
            return None

        return {
            'ticker': ticker,
            'name': p.get('companyName'),
            'country': p.get('country'),
            'currency': p.get('currency'),
            'exchange': p.get('exchange'),           # "NASDAQ" (was wrongly mapped to exchangeShortName)
            'exchange_full': p.get('exchangeFullName'),
            'ipo_date': p.get('ipoDate'),
            'market_cap': p.get('marketCap'),        # was mktCap — actual field is marketCap
            'share_outstanding': None,               # not provided by this endpoint
            'logo': p.get('image'),
            'website': p.get('website'),
            'industry': p.get('industry'),
            'sector': p.get('sector'),
            'description': p.get('description'),
            'ceo': p.get('ceo'),
            'full_time_employees': p.get('fullTimeEmployees'),
            'city': p.get('city'),
            'state': p.get('state'),
            'beta': p.get('beta'),
            'is_etf': p.get('isEtf', False),
            'is_actively_trading': p.get('isActivelyTrading', True),
            'fetched_at': datetime.now().isoformat(),
        }

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        print(f"Error fetching FMP profile for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing FMP profile for {ticker}: {e}")
        return None


# NOTE: fetch_etf_info and fetch_etf_holdings are NO LONGER called by the ETL.
# Both endpoints are premium (gated behind a paid FMP plan) and return no useful
# data on the free tier. ETF metadata and holdings are now scraped from etfdb.com
# via src/api/markets/etfdb.py (trigger: --scrape-etf-info). Functions are kept
# here for potential future use or direct invocation.
def fetch_etf_info(ticker: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch ETF information from FMP /stable/etf/information.
    PREMIUM ENDPOINT — not called by the ETL (replaced by etfdb.scrape_etf_info).

    Returns same shape as finnhub.fetch_etf_profile() plus:
    expense_ratio, aum, holdings_count, avg_volume.
    """
    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/etf/info"
    params = {'symbol': ticker, 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Response may be a list or a single dict
        if isinstance(data, list):
            if not data:
                return None
            p = data[0]
        elif isinstance(data, dict):
            p = data
        else:
            return None

        if not p or not p.get('name'):
            return None

        return {
            'ticker': ticker,
            'name': p.get('name'),
            'country': p.get('domicile') or p.get('country'),
            'currency': p.get('currency') or p.get('nav_currency'),
            'exchange': p.get('stockExchange') or p.get('exchange'),
            'ipo_date': p.get('inceptionDate') or p.get('inception_date'),
            'market_cap': None,
            'share_outstanding': None,
            'logo': None,
            'website': p.get('website'),
            'industry': p.get('assetClass') or p.get('asset_class'),
            # FMP extras
            'expense_ratio': p.get('expenseRatio'),
            'aum': p.get('aum'),
            'holdings_count': p.get('holdingsCount'),
            'avg_volume': p.get('avgVolume'),
            'fetched_at': datetime.now().isoformat()
        }

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        print(f"Error fetching FMP ETF info for {ticker}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing FMP ETF info for {ticker}: {e}")
        return None


def fetch_etf_holdings(ticker: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch ETF holdings from FMP /stable/etf/holdings.
    PREMIUM ENDPOINT — not called by the ETL (replaced by etfdb.scrape_etf_holdings).

    Returns list of dicts with:
    asset_symbol, asset_name, weight_percentage, shares, market_value
    """
    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/etf/holdings"
    params = {'symbol': ticker, 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not data or not isinstance(data, list):
            return []

        holdings = []
        for h in data:
            holdings.append({
                'asset_symbol': h.get('asset') or h.get('symbol'),
                'asset_name': h.get('name'),
                'weight_percentage': h.get('weightPercentage') or h.get('weight'),
                'shares': h.get('sharesNumber') or h.get('shares'),
                'market_value': h.get('marketValue'),
                'as_of_date': h.get('updated') or h.get('date'),
            })

        return holdings

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        print(f"Error fetching FMP ETF holdings for {ticker}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing FMP ETF holdings for {ticker}: {e}")
        return []


def fetch_historical_prices(
    ticker: str,
    days_back: int = 30,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch historical daily OHLCV prices from FMP /stable/historical-price-full/{symbol}.

    Returns a list of quote-shaped dicts (oldest → newest) matching the stock_quotes
    insert format. Counts as a single FMP rate-limit call per ticker.
    """
    if api_key is None:
        api_key = get_fmp_api_key()

    from_date = (date.today() - timedelta(days=days_back)).isoformat()
    to_date = date.today().isoformat()

    url = f"{FMP_BASE_STABLE}/historical-price-full/{ticker}"
    params = {'from': from_date, 'to': to_date, 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        historical = data.get('historical', [])
        if not historical:
            return []

        # FMP returns newest-first — reverse to oldest-first
        historical = list(reversed(historical))

        quotes = []
        for row in historical:
            quotes.append({
                'current_price': row.get('close'),
                'change_amount': row.get('change'),
                'percent_change': row.get('changePercent'),
                'high_price': row.get('high'),
                'low_price': row.get('low'),
                'open_price': row.get('open'),
                'previous_close': None,  # not available per-row from FMP historical
                'volume': row.get('volume'),
                'quote_timestamp': row.get('date'),  # ISO date string, valid TIMESTAMPTZ
            })

        return quotes

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        print(f"Error fetching FMP historical prices for {ticker}: {e}")
        return []
    except Exception as e:
        print(f"Error parsing FMP historical prices for {ticker}: {e}")
        return []


# ---------------------------------------------------------------------------
# Future fundamentals — wired in but NOT called by daily ETL
# ---------------------------------------------------------------------------

def fetch_income_statement(ticker: str, period: str = 'annual', api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch income statements. period: 'annual' or 'quarter'."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/income-statement/{ticker}"
    params = {'period': period, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching income statement for {ticker}: {e}")
        return []


def fetch_balance_sheet(ticker: str, period: str = 'annual', api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch balance sheet statements. period: 'annual' or 'quarter'."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/balance-sheet-statement/{ticker}"
    params = {'period': period, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching balance sheet for {ticker}: {e}")
        return []


def fetch_cash_flow(ticker: str, period: str = 'annual', api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch cash flow statements. period: 'annual' or 'quarter'."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/cash-flow-statement/{ticker}"
    params = {'period': period, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching cash flow for {ticker}: {e}")
        return []


def fetch_key_metrics(ticker: str, period: str = 'annual', api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch key metrics (P/E, EPS, ROE, margins, etc.)."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/key-metrics/{ticker}"
    params = {'period': period, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching key metrics for {ticker}: {e}")
        return []


def fetch_financial_ratios(ticker: str, period: str = 'annual', api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch financial ratios."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/financial-ratios/{ticker}"
    params = {'period': period, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching financial ratios for {ticker}: {e}")
        return []


def fetch_analyst_estimates(ticker: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch analyst estimates."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/analyst-estimates/{ticker}"
    params = {'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching analyst estimates for {ticker}: {e}")
        return []


def fetch_insider_trades(ticker: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch insider trading activity."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/insider-trading/{ticker}"
    params = {'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching insider trades for {ticker}: {e}")
        return []


def fetch_press_releases(ticker: str, limit: int = 10, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch press releases."""
    if api_key is None:
        api_key = get_fmp_api_key()
    url = f"{FMP_BASE_STABLE}/press-releases/{ticker}"
    params = {'limit': limit, 'apikey': api_key}
    try:
        _fmp_rate_check()
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json() or []
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error fetching press releases for {ticker}: {e}")
        return []


if __name__ == "__main__":
    print("=" * 60)
    print("Testing FMP API")
    print("=" * 60)

    key = get_fmp_api_key()

    print("\n--- ETF Info: SPY ---")
    etf_info = fetch_etf_info('SPY', key)
    if etf_info:
        print(f"  Name:          {etf_info['name']}")
        print(f"  Asset class:   {etf_info['industry']}")
        print(f"  Expense ratio: {etf_info['expense_ratio']}")
        print(f"  AUM:           {etf_info['aum']}")
        print(f"  Holdings:      {etf_info['holdings_count']}")
    else:
        print("  No data returned")

    print("\n--- ETF Holdings: SPY (first 5) ---")
    holdings = fetch_etf_holdings('SPY', key)
    print(f"  Total holdings returned: {len(holdings)}")
    for h in holdings[:5]:
        print(f"  {h['asset_symbol']:6s}  {h['weight_percentage']}%  {h['asset_name']}")

    print("\n--- Company Profile: AAPL ---")
    profile = fetch_company_profile('AAPL', key)
    if profile:
        print(f"  Name:      {profile['name']}")
        print(f"  Sector:    {profile['sector']}")
        print(f"  Industry:  {profile['industry']}")
        print(f"  CEO:       {profile['ceo']}")
        print(f"  Employees: {profile['full_time_employees']}")
        print(f"  HQ:        {profile['city']}, {profile['state']}")
    else:
        print("  No data returned")

    print("\n--- Historical Prices: AAPL (5 days) ---")
    hist = fetch_historical_prices('AAPL', days_back=5, api_key=key)
    print(f"  Rows returned: {len(hist)}")
    if hist:
        print(f"  First row: {hist[0]}")

    print(f"\nTotal FMP calls made: {_FMP_DAILY_COUNT}")
