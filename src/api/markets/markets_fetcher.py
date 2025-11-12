"""
Markets API Script
Fetches financial market data from various sources
"""

from dotenv import load_dotenv
from datetime import datetime
import pandas as pd
import requests
import partial
import time
import os

load_dotenv()


def quote(key, ticker):
    """
    Real-time quote data for United States equities
    ---> includes high, low, open, close, change, etc.

    :param key
    :param ticker
    :return:
    """

    q = f'https://finnhub.io/api/v1/quote?symbol={ticker}&token={key}'
    with requests.get(q) as r:
        resp = r.json()
    return list(resp.values())


def candles(key, ticker):
    """
    Get candlestick data (OHLCV) for stocks.
    ---> daily data will be adjusted for splits; intraday data will remain unadjusted.

    :param key
    :param ticker
    :return:
    """

    today = datetime.date.today()
    f = int(time.mktime((today - datetime.timedelta(365)).timetuple()))
    t = int(time.mktime(today.timetuple()))

    candle = f'https://finnhub.io/api/v1/stock/candle?symbol={ticker}&resolution=D&from={f}&to={t}&token={key}'
    with requests.get(candle) as r:
        resp = r.json()

    try:
        return pd.DataFrame(resp)
    except ValueError:
        return None


def name_search(key, ticker):
    """

    :param key
    :param ticker
    :return:
    """

    prof = f'https://finnhub.io/api/v1/stock/profile2?symbol={ticker}&token={key}'
    with requests.get(prof) as r:
        resp = r.json()

    try:
        name = resp['name']
    except KeyError:
        return None

    return f'{name} ({ticker})'


def free_stock_search(key):
    sp500 = f'https://finnhub.io/api/v1/index/constituents?symbol=^GSPC&token={key}'

    with requests.get(sp500) as r:
        resp = r.json()
    sp500_constituents = sorted(resp['constituents'])

    # Get Candles
    sp500_candles = list(
        map(
            partial(candles, key), sp500_constituents
        )
    )

    # Get Names
    sp500_names = list(
        map(
            partial(name_search, key), sp500_constituents
        )
    )
    sp500_names = list(filter(None, sp500_names))

    return sp500_candles


def profile(client, ticker):
    """
    General information of a company
    ---> mainly qualitative data
    """

    country, curr, exc, ipo, mkt_cap, name, _, shares, _, url, logo, industry = client.company_profile2(
        symbol=ticker
    ).values()
    return [
        country, curr, exc, ipo, mkt_cap, name, shares, url, logo, industry
    ]


def news(client, ticker, today):
    """
    List latest company news by symbol
    ---> headline, image, summary, url
    """

    return client.company_news(
        symbol=ticker,
        _from=str(today - datetime.timedelta(7)),
        to=str(today)
    )
    
