"""
weather.py

Thin wrapper around the Visual Crossing Timeline Weather API, used by
misc_db_helper.sync_misc_data for the weather cards.
"""

import os
from datetime import datetime
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

VISUAL_CROSSING_BASE_URL = (
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline"
)


def get_weather_api_key() -> str:
    """
    Return WEATHER_API_KEY from .env/.env.local, or '' when unset.

    Empty rather than raising: sync_misc_data guards on the falsy value to
    skip this one card with a note, and an exception here would escape its
    per-source try blocks and take the whole misc domain down with it.
    """
    return os.getenv("WEATHER_API_KEY", "")


def fetch_weather_timeline(
    location: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    unit_group: str = "us",
    include: str = "current,days",
    api_key: Optional[str] = None,
    extra_params: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch timeline weather data for a given location from Visual Crossing.

    Args:
        location: Location string (e.g. "New York,US" or "40.7128,-74.0060").
        start_date: Optional start date in YYYY-MM-DD; defaults to "today".
        end_date: Optional end date in YYYY-MM-DD; defaults to start_date.
        unit_group: "metric" or "us".
        include: Comma-separated include flags (e.g. "current,days").
        api_key: Optional explicit API key; falls back to WEATHER_API_KEY env var.
        extra_params: Additional query parameters to merge into the request.

    Returns:
        Parsed JSON dict on success, or None on error.
    """
    if api_key is None:
        api_key = get_weather_api_key()
    if not api_key:
        print("Weather API skipped: WEATHER_API_KEY is not set")
        return None

    if start_date is None:
        start_date = datetime.utcnow().strftime("%Y-%m-%d")
    if end_date is None:
        end_date = start_date

    url = f"{VISUAL_CROSSING_BASE_URL}/{location}/{start_date}/{end_date}"

    params: Dict[str, Any] = {
        "key": api_key,
        "unitGroup": unit_group,
        "include": include,
        "contentType": "json",
    }

    if extra_params:
        params.update(extra_params)

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        data["fetched_at"] = datetime.utcnow().isoformat()
        return data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching weather data from Visual Crossing: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing weather data from Visual Crossing: {e}")
        return None


if __name__ == "__main__":
    sample = fetch_weather_timeline("New York,NY")
    if sample:
        print("Resolved:", sample.get("resolvedAddress"))
        for day in sample.get("days", []):
            print(day.get("datetime"), day.get("tempmax"), day.get("tempmin"), day.get("conditions"))
    else:
        print("No sample data (check WEATHER_API_KEY).")
