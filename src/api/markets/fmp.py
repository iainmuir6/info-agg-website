# fmp.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-10
# Description: Fetches financial market data from the Financial Modeling Prep (FMP) API
#       ---> Fills gaps Finnhub cannot cover on the free tier:
#            ETF profiles/holdings, richer company profiles (sector, CEO, description)

from typing import Dict, List, Optional, Any
from datetime import date, datetime
import requests
import warnings
import os
import sys
import threading
import time

from dotenv import load_dotenv
load_dotenv()

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import get_http_session, et_today, MinInterval, HTTP_TIMEOUT

# FMP_BASE_V3 = "https://financialmodelingprep.com/api/v3"
FMP_BASE_STABLE = "https://financialmodelingprep.com/stable"

# FMP free tier: 250 requests/day — daily counter with midnight reset
_FMP_DAILY_COUNT: int = 0
_FMP_DAILY_DATE: Optional[date] = None
_FMP_DAILY_LIMIT = 250
_FMP_WARN_THRESHOLD = 220

_FMP_MIN_INTERVAL_S = 1.0
_FMP_LOCK = threading.Lock()
_FMP_DISABLED_DUE_TO_429: bool = False


_fmp_pacer = MinInterval(_FMP_MIN_INTERVAL_S)


def _fmp_rate_check() -> None:
    """Warn when approaching 250 req/day; block (raise) at the hard limit.

    The daily counter is checked under the lock; the >=1s pacing sleep
    happens in MinInterval OUTSIDE any lock, so concurrent FMP callers
    (phase-1 forex/commodity quotes) are paced, not serialized."""
    global _FMP_DAILY_COUNT, _FMP_DAILY_DATE
    global _FMP_DISABLED_DUE_TO_429

    with _FMP_LOCK:
        if _FMP_DISABLED_DUE_TO_429:
            raise RuntimeError("FMP disabled for remainder of this ETL run due to 429")

        today = et_today()
        if _FMP_DAILY_DATE != today:
            _FMP_DAILY_COUNT = 0
            _FMP_DAILY_DATE = today

        _FMP_DAILY_COUNT += 1
        count = _FMP_DAILY_COUNT

    if count >= _FMP_DAILY_LIMIT:
        raise RuntimeError(
            f"FMP daily request limit reached ({_FMP_DAILY_LIMIT}). "
            "Skipping remaining FMP calls for today."
        )
    if count >= _FMP_WARN_THRESHOLD:
        warnings.warn(
            f"FMP daily request count is {count}/{_FMP_DAILY_LIMIT} — "
            "approaching daily limit.",
            stacklevel=2
        )

    _fmp_pacer.wait()


def _fmp_disable_due_to_429() -> None:
    global _FMP_DISABLED_DUE_TO_429
    with _FMP_LOCK:
        _FMP_DISABLED_DUE_TO_429 = True


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
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 429:
            _fmp_disable_due_to_429()
            raise RuntimeError("FMP disabled for remainder of this ETL run due to 429")
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


def fetch_fmp_quote(symbol: str, api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch real-time quote from FMP /stable/quote?symbol={symbol}.

    Shared by forex and commodities (same endpoint shape as stock quote).
    Returns: current_price, change_amount, percent_change, high, low, open,
             previous_close, volume, quote_timestamp
    """
    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/quote"
    params = {'symbol': symbol, 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 429:
            _fmp_disable_due_to_429()
            raise RuntimeError("FMP disabled for remainder of this ETL run due to 429")
        response.raise_for_status()
        data = response.json()

        if not data or not isinstance(data, list):
            return None

        q = data[0]
        if not q.get('price') and not q.get('previousClose'):
            return None

        return {
            'ticker': symbol,
            'current_price': q.get('price'),
            'change_amount': q.get('change'),
            'percent_change': q.get('changesPercentage'),
            'high_price': q.get('dayHigh'),
            'low_price': q.get('dayLow'),
            'open_price': q.get('open'),
            'previous_close': q.get('previousClose'),
            'volume': q.get('volume'),
            'quote_timestamp': q.get('timestamp'),
        }

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        print(f"Error fetching FMP quote for {symbol}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing FMP quote for {symbol}: {e}")
        return None


def fetch_treasury_rates(
    api_key: Optional[str] = None,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch US treasury rates from FMP /stable/treasury-rates.

    Returns a flat list of dicts with indicator_name and value per term per date:
        [{'indicator_name': 'treasury_10y', 'date': '2024-01-05', 'value': 4.05}, ...]

    errors: optional list the failure reason is appended to. Without it a
    transient outage returns `[]` indistinguishably from "no data", and the
    caller reports zero rows with an empty error list — which reads downstream
    as a silent failure of the whole economic-indicators source.
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/treasury-rates"
    params = {'apikey': api_key}

    TERM_MAP = {
        'month1':  'treasury_1m',
        'month3':  'treasury_3m',
        'month6':  'treasury_6m',
        'year1':   'treasury_1y',
        'year2':   'treasury_2y',
        'year5':   'treasury_5y',
        'year10':  'treasury_10y',
        'year20':  'treasury_20y',
        'year30':  'treasury_30y',
    }

    try:
        _fmp_rate_check()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        if response.status_code == 429:
            _fmp_disable_due_to_429()
            raise RuntimeError("FMP disabled for remainder of this ETL run due to 429")
        response.raise_for_status()
        data = response.json()

        if not data or not isinstance(data, list):
            return []

        rows = []
        for entry in data:
            dt = entry.get('date')
            if not dt:
                continue
            for api_key_term, indicator_name in TERM_MAP.items():
                value = entry.get(api_key_term)
                if value is not None:
                    rows.append({'indicator_name': indicator_name, 'date': dt, 'value': value})
        return rows

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        _fail(f"Error fetching FMP treasury rates: {e}")
        return []
    except Exception as e:
        _fail(f"Error parsing FMP treasury rates: {e}")
        return []


def fetch_economic_indicator(
    name: str,
    api_key: Optional[str] = None,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch a single economic indicator from FMP /stable/economic-indicators?name={name}.

    Returns a list of dicts: [{'indicator_name': name, 'date': '...', 'value': ...}, ...]

    errors: optional list the failure reason is appended to (see
    fetch_treasury_rates — same reason).
    """
    def _fail(msg: str) -> None:
        print(msg)
        if errors is not None:
            errors.append(msg)

    if api_key is None:
        api_key = get_fmp_api_key()

    url = f"{FMP_BASE_STABLE}/economic-indicators"
    params = {'name': name, 'apikey': api_key}

    try:
        _fmp_rate_check()
        response = get_http_session().get(url, params=params, timeout=HTTP_TIMEOUT)
        # Every other FMP call trips the circuit breaker on 429; this one did
        # not, so a rate-limited response fell through raise_for_status() into
        # the RequestException handler, returned [] silently, and let the
        # remaining macro indicators each repeat the same wasted call.
        if response.status_code == 429:
            _fmp_disable_due_to_429()
            raise RuntimeError("FMP disabled for remainder of this ETL run due to 429")
        response.raise_for_status()
        data = response.json()

        if not data or not isinstance(data, list):
            return []

        return [
            {'indicator_name': name, 'date': row.get('date'), 'value': row.get('value')}
            for row in data
            if row.get('date') is not None
        ]

    except RuntimeError:
        raise
    except requests.exceptions.RequestException as e:
        _fail(f"Error fetching FMP economic indicator '{name}': {e}")
        return []
    except Exception as e:
        _fail(f"Error parsing FMP economic indicator '{name}': {e}")
        return []


# ---------------------------------------------------------------------------
# Future fundamentals — wired in but NOT called by daily ETL
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("Testing FMP API")
    print("=" * 60)

    key = get_fmp_api_key()

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

    print(f"\nTotal FMP calls made: {_FMP_DAILY_COUNT}")
