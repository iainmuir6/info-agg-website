"""
holidays.py

Wrapper around the Calendarific Holidays API.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, date
import os
import requests

from dotenv import load_dotenv

load_dotenv()

CALENDARIFIC_HOLIDAYS_URL = "https://calendarific.com/api/v2/holidays"


def get_calendar_api_key() -> str:
    """
    Get the Calendarific holidays key from environment variables.

    Expects CALENDAR_API_KEY to be set in .env/.env.local.
    """
    api_key = os.getenv("CALENDAR_API_KEY")
    if not api_key:
        raise ValueError("CALENDAR_API_KEY must be set in environment variables")
    return api_key


def fetch_holidays(
    country: str = "US",
    year: Optional[int] = None,
    month: Optional[int] = None,
    day: Optional[int] = None,
    types: Optional[List[str]] = None,
    api_key: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch holidays from Calendarific for a given country and date.

    Args:
        country: Country code (e.g. 'US').
        year: Year component; defaults to current year.
        month: Optional month; if provided, restricts to that month.
        day: Optional day; if provided, restricts to that specific day.
        types: Optional list of Calendarific holiday types to filter by
               (e.g. ["national"], ["religious"]).
        api_key: Optional explicit API key.

    Returns:
        List of holiday dicts, or None on error.
    """
    if api_key is None:
        try:
            api_key = get_calendar_api_key()
        except ValueError as e:
            print(f"Calendar API skipped: {e}")
            return None

    today = date.today()
    if year is None:
        year = today.year

    params: Dict[str, Any] = {
        "api_key": api_key,
        "country": country,
        "year": year,
    }
    if month is not None:
        params["month"] = month
    if day is not None:
        params["day"] = day
    if types:
        # Calendarific supports a comma-separated list of types
        params["type"] = ",".join(types)

    try:
        response = requests.get(CALENDARIFIC_HOLIDAYS_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        raw_holidays = data.get("response", {}).get("holidays", [])

        holidays: List[Dict[str, Any]] = []
        for item in raw_holidays:
            date_info = item.get("date", {}) or {}
            iso = date_info.get("iso")
            try:
                dt = datetime.fromisoformat(iso) if iso else None
                week_day = dt.strftime("%A") if dt else None
            except Exception:
                week_day = None

            holidays.append(
                {
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "country": item.get("country", {}).get("id"),
                    "location": item.get("locations"),
                    "types": item.get("type", []),
                    "date": iso,
                    "week_day": week_day,
                    "fetched_at": datetime.utcnow().isoformat(),
                }
            )

        return holidays

    except requests.exceptions.RequestException as e:
        print(f"Error fetching holidays from Calendarific: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing holidays from Calendarific: {e}")
        return None


def fetch_upcoming_holidays(
    country: str = "US",
    limit: int = 5,
    api_key: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Convenience helper: fetch US Christian holidays for today and forward,
    then return the next N upcoming holidays.
    """
    today = date.today()
    # Fetch all holidays for the current year, restricted to religious
    # types, then filter to Christian client-side.
    holidays = fetch_holidays(
        country=country,
        year=today.year,
        month=None,
        day=None,
        types=["religious"],
        api_key=api_key,
    )
    if holidays is None:
        return None

    upcoming: List[Dict[str, Any]] = []
    for h in holidays:
        iso = h.get("date")
        if not iso:
            continue
        try:
            h_date = datetime.fromisoformat(iso).date()
        except Exception:
            continue

        # Only keep Christian holidays
        types_list = h.get("types") or []
        is_christian = any("christian" in str(t).lower() for t in types_list)
        if not is_christian:
            continue

        if h_date >= today:
            upcoming.append(h)

    upcoming.sort(key=lambda h: h.get("date") or "")
    return upcoming[:limit]


if __name__ == "__main__":
    print("=" * 60)
    print("Testing AbstractAPI Holidays API")
    print("=" * 60)

    sample = fetch_upcoming_holidays(country="US", limit=5)
    if sample:
        for h in sample:
            print(f"{h['date']}: {h['name']} ({h.get('type')})")

