"""
misc_fetcher.py

Legacy convenience script for exercising misc API wrappers.
New code should import from the per-API modules in this folder:
  - weather.py
  - holidays.py
  - wikipedia.py
  - countries.py
  - words.py
  - facts.py
"""

from datetime import datetime

from dotenv import load_dotenv

from .weather import fetch_weather_timeline
from .holidays import fetch_upcoming_holidays
from .facts import fetch_useless_fact
from .words import fetch_merriam_webster_wotd
from .wikipedia import fetch_random_wikipedia_summary
from .countries import fetch_country_by_code

load_dotenv()


def demo_weather():
    sample = fetch_weather_timeline("New York,US")
    if not sample:
        return
    address = sample.get("resolvedAddress") or "Unknown"
    current = sample.get("currentConditions", {})
    temp = current.get("temp")
    conditions = current.get("conditions")
    print(f"\nWeather — {address}")
    print(f"- {temp}°, {conditions}")


def demo_holidays():
    upcoming = fetch_upcoming_holidays("US", limit=5)
    if not upcoming:
        return
    print("\nUpcoming US Holidays:")
    for h in upcoming:
        print(f"- {h['date']}: {h['name']} ({h.get('type')})")


def demo_fact():
    fact = fetch_useless_fact()
    if not fact:
        return
    print("\nUseless Fact:")
    print(f"- {fact['text']}")


def demo_wotd():
    words = fetch_merriam_webster_wotd(limit=1)
    if not words:
        return
    w = words[0]
    print("\nWord of the Day:")
    print(f"- {w['title']} — {w['pub_date']}")


def demo_wikipedia():
    page = fetch_random_wikipedia_summary()
    if not page:
        return
    print("\nRandom Wikipedia Summary:")
    print(f"- {page['title']}")
    extract = (page.get("extract") or "")[:200]
    print(f"  {extract}...")


def demo_country():
    us = fetch_country_by_code("US")
    if not us:
        return
    print("\nCountry Snapshot (US):")
    print(f"- {us['name_common']} — capital={us['capital']}, region={us['region']}")


if __name__ == "__main__":
    print("Fetching miscellaneous data...")
    print(f"Run at {datetime.utcnow().isoformat()}")

    demo_weather()
    demo_holidays()
    demo_fact()
    demo_wotd()
    demo_wikipedia()
    demo_country()

