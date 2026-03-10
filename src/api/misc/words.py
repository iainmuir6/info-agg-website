"""
words.py

Helpers for Merriam-Webster Word of the Day (RSS feed).
"""

from typing import Any, Dict, List
from datetime import datetime
import requests
import xml.etree.ElementTree as ET

from dotenv import load_dotenv

load_dotenv()

MERRIAM_WOTD_RSS = "https://www.merriam-webster.com/wotd/feed/rss2"


def fetch_merriam_webster_wotd(limit: int = 1) -> List[Dict[str, Any]]:
    """
    Fetch Merriam-Webster Word of the Day items from the public RSS feed.

    Args:
        limit: Maximum number of items to return.

    Returns:
        List of dictionaries with title, link, pub_date, and description.
    """
    try:
        response = requests.get(MERRIAM_WOTD_RSS, timeout=10)
        response.raise_for_status()
        xml_text = response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Merriam-Webster WOTD RSS: {e}")
        return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"Error parsing Merriam-Webster WOTD RSS XML: {e}")
        return []

    items: List[Dict[str, Any]] = []

    # RSS structure: <rss><channel><item>...</item></channel></rss>
    channel = root.find("channel")
    if channel is None:
        return items

    for item in channel.findall("item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        description = (item.findtext("description") or "").strip()

        items.append(
            {
                "title": title,
                "link": link,
                "pub_date": pub_date,
                "description": description,
                "source": "Merriam-Webster WOTD",
                "fetched_at": datetime.utcnow().isoformat(),
            }
        )

    return items


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Merriam-Webster WOTD RSS")
    print("=" * 60)

    words = fetch_merriam_webster_wotd(limit=3)
    for w in words:
        print(f"{w['title']} — {w['pub_date']}")

