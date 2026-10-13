# alpha_vantage.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-09
# Description: Fetches financial market data from the Alpha Vantage API
#       ---> Supports daily OHLCV candles, economic indicators, sentiment, earnings

from typing import Dict, List, Optional, Any
from collections import deque
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
from etl_lib import (
    get_http_session, utc_now, MinInterval,
    HTTP_TIMEOUT, HTTP_TIMEOUT_SLOW,
)

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
#
# 1.25s, not 1.1s: AV measures arrival, so network jitter on a 1.1s spacing
# lands inside its 1s window often enough to matter. A run was still losing a
# whole topic (~44 articles) to the "1 request per second" response.
_AV_MIN_GAP = 1.25   # seconds

# MinInterval *reserves* the next free slot under its lock and sleeps outside
# it, so N concurrent workers get N distinct, strictly increasing slots. The
# hand-rolled version this replaces computed a wait, slept, and re-checked —
# no reservation, so woken workers raced for the same slot and the loser slept
# again. Under contention that both wasted time and let bursts through.
_av_gap = MinInterval(_AV_MIN_GAP)


def _av_rate_limit(key: str) -> None:
    """Block until a request may go out: 5 req/60 s per key, ≥1.25 s apart globally.

    Never sleeps while holding a lock — a lock-held sleep serializes every
    worker sharing it (the historical ETL hang; see CLAUDE.md)."""
    if key not in _AV_KEY_LOCKS:
        with _AV_INIT_LOCK:
            if key not in _AV_KEY_LOCKS:
                _AV_CALL_TIMES[key] = deque()
                _AV_KEY_LOCKS[key] = threading.Lock()

    # Per-key sliding window: claim a slot in the 5-per-60s budget.
    while True:
        with _AV_KEY_LOCKS[key]:
            times = _AV_CALL_TIMES[key]
            now = time.time()
            while times and now - times[0] >= _AV_WINDOW:
                times.popleft()
            if len(times) < _AV_RATE_LIMIT:
                times.append(now)   # reserve it before releasing the lock
                break
            window_wait = _AV_WINDOW - (now - times[0]) + 0.05
        time.sleep(max(window_wait, 0.05))   # sleep OUTSIDE the lock

    # Global inter-request gap, reserved rather than re-checked.
    _av_gap.wait()


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
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=HTTP_TIMEOUT_SLOW)
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
                'fetched_at': utc_now().isoformat()
            })

        return articles

    except RuntimeError:
        raise  # quota/API errors must reach the caller's stats
    except Exception as e:
        raise RuntimeError(f"AV sentiment fetch failed for topic {topic}: {e}")


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
        response = get_http_session().get(ALPHA_VANTAGE_BASE_URL, params=params, timeout=HTTP_TIMEOUT)
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
            'fetched_at': utc_now().isoformat()
        }

    except requests.exceptions.RequestException as e:
        print(f"Error fetching economic indicator {function}: {e}")
        return None
    except Exception as e:
        print(f"Error parsing economic indicator {function}: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Alpha Vantage API")
    print("=" * 60)

    print("\n--- News Sentiment (topic=earnings) ---")
    sentiment = fetch_news_sentiment(get_alphavantage_api_keys()[0], topic='earnings')
    print(f"  {len(sentiment)} articles")
    if sentiment:
        print(f"  First: {sentiment[0]['title'][:60]}")
