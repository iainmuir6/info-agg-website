"""
weather.py

Lightweight wrapper around the Visual Crossing Timeline Weather API.
"""

from typing import Any, Dict, Optional
from datetime import datetime
import os
import requests

from dotenv import load_dotenv

load_dotenv()

VISUAL_CROSSING_BASE_URL = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline"


def get_weather_api_key() -> str:
    """
    Get the Visual Crossing API key from environment variables.

    Expects WEATHER_API_KEY to be set in .env/.env.local.
    """
    api_key = os.getenv("WEATHER_API_KEY")
    if not api_key:
        raise ValueError("WEATHER_API_KEY must be set in environment variables")
    return api_key


def fetch_weather_timeline(
    location: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    unit_group: str = "metric",
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
        try:
            api_key = get_weather_api_key()
        except ValueError as e:
            print(f"Weather API skipped: {e}")
            return None

    # Visual Crossing uses /{location}/{start}/{end} style paths
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

        # Attach a fetched_at timestamp so we can store this later if needed.
        data["fetched_at"] = datetime.utcnow().isoformat()
        return data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching weather data from Visual Crossing: {e}")
        return None
    except ValueError as e:
        # JSON decoding or other value errors
        print(f"Error parsing weather data from Visual Crossing: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Visual Crossing Weather API")
    print("=" * 60)

    sample = fetch_weather_timeline("New York,US")
    if sample:
        address = sample.get("resolvedAddress") or "Unknown"
        current = sample.get("currentConditions", {})
        temp = current.get("temp")
        conditions = current.get("conditions")
        print(f"Location: {address}")
        print(f"Current: {temp}°, {conditions}")

