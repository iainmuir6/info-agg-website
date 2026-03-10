#!/usr/bin/env python3
"""
generate_snippets.py — Capture live API response samples for each ETL data source.

Writes JSON files to /data/snippets/{domain}/ with:
  - endpoint: the URL called
  - fetched_at: ISO timestamp
  - raw_sample: up to 2 items from any list field
  - stored_shape: the dict actually passed to Supabase upsert

Usage:
    source _agg_venv/bin/activate
    python src/api/generate_snippets.py

Flags:
    --domain DOMAIN   Only run snippets for a specific domain
                      (e.g. markets, sports, news, media, misc).
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Allow imports from each domain's subfolder
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'news'))
sys.path.insert(0, str(ROOT / 'sports'))
sys.path.insert(0, str(ROOT / 'markets'))
sys.path.insert(0, str(ROOT / 'media'))
sys.path.insert(0, str(ROOT / 'misc'))

# Load .env.local / .env
from dotenv import load_dotenv
for env_file in [ROOT.parent.parent / '.env.local', ROOT.parent.parent / '.env']:
    if env_file.exists():
        load_dotenv(env_file)
        break

SNIPPETS_DIR = ROOT.parent.parent / 'data' / 'snippets'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def truncate_lists(obj, max_items: int = 2):
    """Recursively truncate any list longer than max_items to first max_items elements."""
    if isinstance(obj, list):
        return [truncate_lists(item, max_items) for item in obj[:max_items]]
    if isinstance(obj, dict):
        return {k: truncate_lists(v, max_items) for k, v in obj.items()}
    return obj


def save_snippet(domain: str, name: str, endpoint: str, raw_sample, stored_shape):
    out_dir = SNIPPETS_DIR / domain
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{name}.json"
    data = {
        "endpoint": endpoint,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "raw_sample": truncate_lists(raw_sample),
        "stored_shape": truncate_lists(stored_shape),
    }
    with open(out_path, 'w') as f:
        json.dump(data, f, indent=2, default=str)
    return out_path


# ---------------------------------------------------------------------------
# NEWS
# ---------------------------------------------------------------------------

def snippet_nyt_top_stories():
    from nyt import fetch_nyt_top_stories
    result = fetch_nyt_top_stories(section='technology')
    if not result:
        return None, "fetch returned None"
    articles = result.get('articles', [])
    raw_sample = result.copy()
    raw_sample['articles'] = articles[:2]
    # stored_shape mirrors news_db_helper insert_data
    stored_shapes = []
    for a in articles[:2]:
        stored_shapes.append({
            'title': a.get('title'),
            'abstract': a.get('abstract'),
            'url': a.get('url'),
            'byline': a.get('byline'),
            'section': a.get('section'),
            'published_date': a.get('published_date'),
            'image_url': a.get('multimedia', [{}])[0].get('url') if a.get('multimedia') else None,
            'source': 'NYT',
        })
    return save_snippet(
        'news', 'nyt_top_stories',
        'GET https://api.nytimes.com/svc/topstories/v2/technology.json',
        raw_sample, stored_shapes
    ), None


# ---------------------------------------------------------------------------
# SPORTS
# ---------------------------------------------------------------------------

def snippet_espn_news():
    from espn import fetch_espn_news
    articles = fetch_espn_news('basketball', 'nba', limit=5)
    if not articles:
        return None, "fetch returned empty list"
    stored_shapes = []
    for a in articles[:2]:
        stored_shapes.append({
            'league_id': '<looked up from leagues table>',
            'title': a.get('title'),
            'description': a.get('description'),
            'url': a.get('url'),
            'published_at': a.get('published_at'),
            'source': a.get('source', 'ESPN'),
            'image_url': a.get('image'),
        })
    return save_snippet(
        'sports', 'espn_news',
        'GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news',
        articles[:2], stored_shapes
    ), None


def snippet_espn_scoreboard():
    from espn import fetch_espn_scores
    games = fetch_espn_scores('basketball', 'nba')
    if not games:
        return None, "fetch returned empty list"
    stored_shapes = []
    for g in games[:2]:
        stored_shapes.append({
            'league_id': '<looked up from leagues table>',
            'event_id': str(g.get('event_id')),
            'home_team': g.get('home_team'),
            'away_team': g.get('away_team'),
            'home_score': g.get('home_score'),
            'away_score': g.get('away_score'),
            'home_record': g.get('home_record'),
            'away_record': g.get('away_record'),
            'status': g.get('status'),
            'status_detail': g.get('status_detail'),
            'game_date': g.get('date'),
            'venue': g.get('venue'),
            'broadcast': g.get('broadcast'),
            'week': g.get('week'),
            'season': g.get('season'),
        })
    return save_snippet(
        'sports', 'espn_scoreboard',
        'GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
        games[:2], stored_shapes
    ), None


# ---------------------------------------------------------------------------
# MARKETS
# ---------------------------------------------------------------------------

def snippet_finnhub_quote():
    from finnhub import fetch_stock_quote, get_finnhub_api_key
    api_key = get_finnhub_api_key()
    quote = fetch_stock_quote('AAPL', api_key=api_key)
    if not quote:
        return None, "fetch returned None"
    quote_timestamp = quote.get('timestamp') or int(time.time())
    stored_shape = {
        'stock_id': '<looked up from stocks table>',
        'current_price': quote.get('current_price'),
        'change_amount': quote.get('change'),
        'percent_change': quote.get('percent_change'),
        'high_price': quote.get('high_price'),
        'low_price': quote.get('low_price'),
        'open_price': quote.get('open_price'),
        'previous_close': quote.get('previous_close'),
        'quote_timestamp': quote_timestamp,
    }
    return save_snippet(
        'markets', 'finnhub_quote',
        'GET https://finnhub.io/api/v1/quote?symbol=AAPL',
        quote, stored_shape
    ), None


def snippet_fmp_historical_prices():
    from fmp import fetch_historical_prices, get_fmp_api_key
    api_key = get_fmp_api_key()
    rows = fetch_historical_prices('AAPL', days_back=5, api_key=api_key)
    if not rows:
        return None, "fetch returned empty list"
    stored_shapes = []
    for row in rows[:2]:
        stored_shapes.append({
            'stock_id': '<looked up from stocks table>',
            'current_price': row.get('current_price'),
            'change_amount': row.get('change_amount'),
            'percent_change': row.get('percent_change'),
            'high_price': row.get('high_price'),
            'low_price': row.get('low_price'),
            'open_price': row.get('open_price'),
            'previous_close': row.get('previous_close'),
            'volume': row.get('volume'),
            'quote_timestamp': row.get('quote_timestamp'),
        })
    return save_snippet(
        'markets', 'fmp_historical_prices',
        'GET https://financialmodelingprep.com/api/v3/historical-price-full/AAPL',
        rows[:2], stored_shapes
    ), None


def snippet_av_news_sentiment():
    from alpha_vantage import fetch_news_sentiment
    articles = fetch_news_sentiment(topic='earnings')
    if not articles:
        return None, "fetch returned empty list"
    stored_shapes = []
    for a in articles[:2]:
        stored_shapes.append({
            'title': a.get('title'),
            'url': a.get('url'),
            'source': a.get('source'),
            'source_domain': a.get('source_domain'),
            'summary': a.get('summary'),
            'banner_image': a.get('banner_image'),
            'published_at': a.get('time_published'),
            'topics': [t.get('topic') for t in a.get('topics', []) if t.get('topic')],
            'overall_sentiment_score': a.get('overall_sentiment_score'),
            'overall_sentiment_label': a.get('overall_sentiment_label'),
            'ticker_sentiments': a.get('ticker_sentiments'),
        })
    return save_snippet(
        'markets', 'av_news_sentiment',
        'GET https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=earnings',
        articles[:2], stored_shapes
    ), None


def snippet_finnhub_profile():
    from finnhub import fetch_company_profile, get_finnhub_api_key
    api_key = get_finnhub_api_key()
    profile = fetch_company_profile('AAPL', api_key=api_key)
    if not profile:
        return None, "fetch returned None"
    stored_shape = {
        'ticker': profile.get('ticker'),
        'name': profile.get('name'),
        'country': profile.get('country'),
        'currency': profile.get('currency'),
        'exchange': profile.get('exchange'),
        'ipo_date': profile.get('ipo_date'),
        'market_cap': profile.get('market_cap'),
        'share_outstanding': profile.get('share_outstanding'),
        'logo_url': profile.get('logo'),
        'website': profile.get('website'),
        'industry': profile.get('industry'),
    }
    return save_snippet(
        'markets', 'finnhub_profile',
        'GET https://finnhub.io/api/v1/stock/profile2?symbol=AAPL',
        profile, stored_shape
    ), None


def snippet_finnhub_company_news():
    from finnhub import fetch_company_news, get_finnhub_api_key
    api_key = get_finnhub_api_key()
    articles = fetch_company_news('AAPL', days_back=7, api_key=api_key)
    if not articles:
        return None, "fetch returned empty list"
    stored_shapes = []
    for a in articles[:2]:
        stored_shapes.append({
            'stock_id': '<looked up from stocks table>',
            'headline': a.get('headline'),
            'summary': a.get('summary'),
            'url': a.get('url'),
            'image_url': a.get('image_url'),
            'source': a.get('source'),
            'published_at': a.get('published_at'),
            'related_tickers': a.get('related_tickers', []),
        })
    return save_snippet(
        'markets', 'finnhub_company_news',
        'GET https://finnhub.io/api/v1/company-news?symbol=AAPL',
        articles[:2], stored_shapes
    ), None


def snippet_finnhub_market_news():
    from finnhub import fetch_market_news, get_finnhub_api_key
    api_key = get_finnhub_api_key()
    articles = fetch_market_news('crypto', api_key=api_key)
    if not articles:
        return None, "fetch returned empty list"
    stored_shapes = []
    for a in articles[:2]:
        stored_shapes.append({
            'category': a.get('category'),
            'headline': a.get('headline'),
            'summary': a.get('summary'),
            'url': a.get('url'),
            'image_url': a.get('image_url'),
            'source': a.get('source'),
            'published_at': a.get('published_at'),
            'related_tickers': a.get('related_tickers', []),
        })
    return save_snippet(
        'markets', 'finnhub_market_news',
        'GET https://finnhub.io/api/v1/news?category=crypto',
        articles[:2], stored_shapes
    ), None


# ---------------------------------------------------------------------------
# MEDIA
# ---------------------------------------------------------------------------

def snippet_spotify_new_releases():
    from spotify import fetch_spotify_new_releases, get_spotify_access_token
    token = get_spotify_access_token()
    if not token:
        return None, "failed to get Spotify access token"
    result = fetch_spotify_new_releases(country='US', limit=5, access_token=token)
    if not result:
        return None, "fetch returned None"
    albums = result.get('albums', [])
    raw_sample = result.copy()
    raw_sample['albums'] = albums[:2]
    stored_shapes = []
    for album in albums[:2]:
        images = album.get('images', [])
        image_url = None
        for img in images:
            if img.get('width', 0) >= 300:
                image_url = img.get('url')
                break
        if not image_url and images:
            image_url = images[0].get('url')
        release_date = album.get('release_date')
        precision = album.get('release_date_precision', 'day')
        if release_date and precision == 'year':
            release_date = f"{release_date}-01-01"
        elif release_date and precision == 'month':
            release_date = f"{release_date}-01"
        stored_shapes.append({
            'spotify_id': album.get('album_id') or album.get('id'),
            'name': album.get('name'),
            'artists': [a.get('name') for a in album.get('artists', []) if a.get('name')],
            'album_type': album.get('album_type'),
            'release_date': release_date,
            'image_url': image_url,
            'external_url': album.get('external_urls', {}).get('spotify'),
            'total_tracks': album.get('total_tracks'),
        })
    return save_snippet(
        'media', 'spotify_new_releases',
        'GET https://api.spotify.com/v1/browse/new-releases?country=US',
        raw_sample, stored_shapes
    ), None


def snippet_reddit_hot_posts():
    from reddit import fetch_reddit_hot
    posts = fetch_reddit_hot('technology', limit=5)
    if not posts:
        return None, "fetch returned None or empty"
    stored_shapes = []
    for post in posts[:2]:
        created_utc = post.get('created_utc')
        posted_at = None
        if created_utc:
            posted_at = datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat()
        thumbnail = post.get('thumbnail')
        thumbnail_url = thumbnail if thumbnail and thumbnail.startswith('http') else None
        stored_shapes.append({
            'post_id': post.get('post_id'),
            'subreddit': post.get('subreddit'),
            'title': post.get('title'),
            'author': post.get('author'),
            'score': post.get('score', 0),
            'upvote_ratio': post.get('upvote_ratio'),
            'num_comments': post.get('num_comments', 0),
            'url': post.get('url'),
            'permalink': post.get('permalink'),
            'selftext': (post.get('selftext') or '')[:200],
            'thumbnail_url': thumbnail_url,
            'is_self': post.get('is_self', False),
            'flair': post.get('link_flair_text'),
            'posted_at': posted_at,
        })
    return save_snippet(
        'media', 'reddit_hot_posts',
        'GET https://www.reddit.com/r/technology/hot.json',
        posts[:2], stored_shapes
    ), None


# ---------------------------------------------------------------------------
# MISC
# ---------------------------------------------------------------------------

def snippet_misc_weather():
    from weather import fetch_weather_timeline

    result = fetch_weather_timeline("New York,US")
    if not result:
        return None, "fetch returned None"

    # stored_shape: likely future misc_weather_observations
    current = result.get('currentConditions', {}) or {}
    stored_shape = {
        'location': result.get('resolvedAddress'),
        'timezone': result.get('timezone'),
        'temp': current.get('temp'),
        'feels_like': current.get('feelslike'),
        'humidity': current.get('humidity'),
        'conditions': current.get('conditions'),
        'icon': current.get('icon'),
        'wind_speed': current.get('windspeed'),
        'wind_dir': current.get('winddir'),
        'observation_time': current.get('datetimeEpoch'),
    }

    raw_sample = {
        'resolvedAddress': result.get('resolvedAddress'),
        'timezone': result.get('timezone'),
        'currentConditions': current,
        'days': (result.get('days') or [])[:2],
    }

    return save_snippet(
        'misc', 'weather_new_york',
        'GET https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/New%20York,US',
        raw_sample,
        stored_shape,
    ), None


def snippet_misc_holidays():
    from holidays import fetch_upcoming_holidays

    holidays = fetch_upcoming_holidays(country='US', limit=5)
    if not holidays:
        return None, "fetch returned empty list"

    stored_shapes = []
    for h in holidays[:2]:
        stored_shapes.append({
            'name': h.get('name'),
            'description': h.get('description'),
            'country': h.get('country'),
            'location': h.get('location'),
            'types': h.get('types'),
            'date': h.get('date'),
            'week_day': h.get('week_day'),
        })

    return save_snippet(
        'misc', 'holidays_us',
        'GET https://holidays.abstractapi.com/v1/',
        holidays[:2],
        stored_shapes,
    ), None


def snippet_misc_wikipedia_random():
    from wikipedia import fetch_random_wikipedia_summary

    page = fetch_random_wikipedia_summary()
    if not page:
        return None, "fetch returned None"

    stored_shape = {
        'title': page.get('title'),
        'description': page.get('description'),
        'extract': page.get('extract'),
        'lang': page.get('lang'),
        'page_url': (page.get('content_urls') or {}).get('desktop', {}).get('page'),
        'thumbnail_url': (page.get('thumbnail') or {}).get('source'),
    }

    return save_snippet(
        'misc', 'wikipedia_random',
        'GET https://en.wikipedia.org/api/rest_v1/page/random/summary',
        page,
        stored_shape,
    ), None


def snippet_misc_country_us():
    from countries import fetch_country_by_code, fetch_all_countries

    country = fetch_country_by_code('US')
    if not country:
        return None, "fetch returned None"

    stored_shape = {
        'cca2': country.get('cca2'),
        'cca3': country.get('cca3'),
        'common': country.get('name', {}).get('common'),
        'official': country.get('name', {}).get('official'),
        'region': country.get('region'),
        'subregion': country.get('subregion'),
        'capital': country.get('capital'),
        'population': country.get('population'),
        'area': country.get('area'),
        'currencies': country.get('currencies'),
        'languages': country.get('languages'),
    }

    countries = fetch_all_countries()
    if countries:
        with open(f'{SNIPPETS_DIR}/misc/countries.json', 'w') as f:
            json.dump(countries, f, indent=2)

    return save_snippet(
        'misc', 'country_us',
        'GET https://restcountries.com/v3.1/alpha/US',
        country,
        stored_shape,
    ), None


def snippet_misc_wotd():
    from words import fetch_merriam_webster_wotd

    items = fetch_merriam_webster_wotd(limit=2)
    if not items:
        return None, "fetch returned empty list"

    stored_shapes = []
    for item in items:
        stored_shapes.append({
            'title': item.get('title'),
            'link': item.get('link'),
            'pub_date': item.get('pub_date'),
            'description': item.get('description'),
            'source': item.get('source'),
        })

    return save_snippet(
        'misc', 'merriam_webster_wotd',
        'GET https://www.merriam-webster.com/wotd/feed/rss2',
        items,
        stored_shapes,
    ), None


def snippet_misc_useless_fact():
    from facts import fetch_useless_fact

    fact = fetch_useless_fact()
    if not fact:
        return None, "fetch returned None"

    stored_shape = {
        'text': fact.get('text'),
        'source': fact.get('source'),
        'source_url': fact.get('source_url'),
        'permalink': fact.get('permalink'),
        'language': fact.get('language'),
    }

    return save_snippet(
        'misc', 'useless_fact',
        'GET https://uselessfacts.jsph.pl/random.json?language=en',
        fact,
        stored_shape,
    ), None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SNIPPETS = [
    ('news',    'nyt_top_stories',        snippet_nyt_top_stories),
    ('sports',  'espn_news',              snippet_espn_news),
    ('sports',  'espn_scoreboard',        snippet_espn_scoreboard),
    ('markets', 'finnhub_quote',          snippet_finnhub_quote),
    ('markets', 'fmp_historical_prices',  snippet_fmp_historical_prices),
    ('markets', 'av_news_sentiment',      snippet_av_news_sentiment),
    ('markets', 'finnhub_profile',        snippet_finnhub_profile),
    ('markets', 'finnhub_company_news',   snippet_finnhub_company_news),
    ('markets', 'finnhub_market_news',    snippet_finnhub_market_news),
    ('media',   'spotify_new_releases',   snippet_spotify_new_releases),
    ('media',   'reddit_hot_posts',       snippet_reddit_hot_posts),
    ('misc',    'weather_new_york',       snippet_misc_weather),
    ('misc',    'holidays_us',            snippet_misc_holidays),
    ('misc',    'wikipedia_random',       snippet_misc_wikipedia_random),
    ('misc',    'country_us',             snippet_misc_country_us),
    ('misc',    'merriam_webster_wotd',   snippet_misc_wotd),
    ('misc',    'useless_fact',           snippet_misc_useless_fact),
]


def main():
    print("=" * 60)
    print("Generating API snippets...")
    print("=" * 60)

    parser = argparse.ArgumentParser(description="Generate API response snippets.")
    parser.add_argument(
        "--domain",
        dest="domain",
        help="Only run snippets for this domain (e.g. markets, sports, news, media, misc).",
    )
    args = parser.parse_args()

    col_w = 30
    results = []

    for domain, name, fn in SNIPPETS:
        if args.domain and domain != args.domain:
            continue
        label = f"{domain}/{name}"
        print(f"  {label}...", end=' ', flush=True)
        try:
            path, err = fn()
            if path:
                status = "OK"
                detail = str(path.relative_to(ROOT.parent.parent))
            else:
                status = "SKIP"
                detail = err or "no data"
        except Exception as exc:
            status = "ERROR"
            detail = str(exc)
        print(status)
        results.append((label, status, detail))

    print()
    print(f"{'Snippet':<40} {'Status':<8} Detail")
    print("-" * 80)
    for label, status, detail in results:
        print(f"{label:<40} {status:<8} {detail}")

    ok = sum(1 for _, s, _ in results if s == 'OK')
    print(f"\n{ok}/{len(results)} snippets written successfully.")


if __name__ == '__main__':
    main()
