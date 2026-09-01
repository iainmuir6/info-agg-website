"""
wikipedia.py

Lightweight helpers for the Wikipedia REST API.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import os
import requests
from urllib.parse import quote

from dotenv import load_dotenv

load_dotenv()

WIKIPEDIA_REST_BASE = "https://en.wikipedia.org/api/rest_v1"


def _build_url(path: str, lang: str = "en") -> str:
    base = f"https://{lang}.wikipedia.org/api/rest_v1"
    return f"{base}{path}"


def fetch_wikipedia_summary(title: str, lang: str = "en") -> Optional[Dict[str, Any]]:
    """
    Fetch a page summary for a given title.

    Args:
        title: Page title (e.g. 'Python_(programming_language)').
        lang: Language code (default 'en').

    Returns:
        Parsed JSON dict with summary fields, or None on error.
    """
    encoded_title = quote(title.replace(" ", "_"))
    url = _build_url(f"/page/summary/{encoded_title}", lang=lang)

    headers = {
        "User-Agent": "InfoAggETL/1.0 (infoagg@gmail.com)",
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        data["fetched_at"] = datetime.utcnow().isoformat()
        return {
            "title": data.get("title"),
            "description": data.get("description"),
            "extract": data.get("extract"),
            "lang": data.get("lang", lang),
            # Flattened: the card wants a href and an <img src>, and the
            # nested envelopes made every link render as "#".
            "url": ((data.get("content_urls") or {}).get("desktop") or {}).get("page"),
            "thumbnail": (data.get("thumbnail") or {}).get("source"),
            "fetched_at": data["fetched_at"],
        }
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Wikipedia summary for '{title}': {e}")
        return None
    except ValueError as e:
        print(f"Error parsing Wikipedia summary for '{title}': {e}")
        return None


def fetch_on_this_day(
    month: Optional[int] = None,
    day: Optional[int] = None,
    limit: int = 8,
    lang: str = "en",
) -> List[Dict[str, Any]]:
    """
    Fetch historical events for a calendar day from the Wikimedia feed API.

    Keyless. Returns newest-first (the feed's own order), trimmed to `limit`.
    """
    now = datetime.utcnow()
    mm = f"{month or now.month:02d}"
    dd = f"{day or now.day:02d}"
    url = _build_url(f"/feed/onthisday/events/{mm}/{dd}", lang=lang)

    try:
        response = requests.get(
            url, headers={"User-Agent": "InfoAggETL/1.0 (infoagg@gmail.com)"}, timeout=10
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Wikipedia On This Day: {e}")
        return []
    except ValueError as e:
        print(f"Error parsing Wikipedia On This Day: {e}")
        return []

    events: List[Dict[str, Any]] = []
    for ev in (data.get("events") or [])[:limit]:
        # The first linked page is the event's own article often enough to be
        # a useful "read more" target; the rest are incidental mentions.
        pages = ev.get("pages") or []
        link = None
        if pages:
            link = ((pages[0].get("content_urls") or {}).get("desktop") or {}).get("page")
        events.append({
            "year": ev.get("year"),
            "text": ev.get("text"),
            "url": link,
        })
    return events


def fetch_random_wikipedia_summary(lang: str = "en") -> Optional[Dict[str, Any]]:
    """
    Fetch a summary for a random page.
    """
    url = _build_url("/page/random/summary", lang=lang)

    headers = {
        "User-Agent": os.getenv(
            "INFOAGG_USER_AGENT",
            "InfoAggETL/1.0 (https://example.com; contact@example.com)",
        )
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        data["fetched_at"] = datetime.utcnow().isoformat()
        return {
            "title": data.get("title"),
            "description": data.get("description"),
            "extract": data.get("extract"),
            "lang": data.get("lang", lang),
            # Flattened: the card wants a href and an <img src>, and the
            # nested envelopes made every link render as "#".
            "url": ((data.get("content_urls") or {}).get("desktop") or {}).get("page"),
            "thumbnail": (data.get("thumbnail") or {}).get("source"),
            "fetched_at": data["fetched_at"],
        }
    except requests.exceptions.RequestException as e:
        print(f"Error fetching random Wikipedia summary: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing random Wikipedia summary: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Wikipedia REST API")
    print("=" * 60)

    random_page = fetch_random_wikipedia_summary()
    if random_page:
        print(f"Random page: {random_page['title']}")
        print(random_page["extract"][:200] + "...")

