"""
countries.py

Wrapper for the REST Countries API (v5).

v3.1 was deprecated in 2026 and now 301-redirects to a JSON stub whose body
parses cleanly but carries none of the expected keys — so the old normalizer
returned a dict of Nones without ever raising. v5 fixes that but is a
different API: new host, bearer auth, a `data.objects[]` envelope, and
restructured fields (`codes.alpha_2` not `cca2`, `area` an object not a float,
`currencies`/`languages` arrays of objects not maps).
"""

import os
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import requests

from dotenv import load_dotenv

load_dotenv()

REST_COUNTRIES_BASE = "https://api.restcountries.com/countries/v5"

# Trimmed to what the card renders; the full record is ~30 top-level keys
# including paid-plan placeholders.
COUNTRY_FIELDS = [
    "names", "codes", "capitals", "flag", "region", "subregion",
    "area", "population", "currencies", "languages", "timezones",
    "continents", "borders", "links",
]


def get_countries_api_key() -> str:
    """Return COUNTRIES_API_KEY, or '' when unset (caller degrades)."""
    return os.getenv("COUNTRIES_API_KEY", "")


def _normalize_country(raw: Dict[str, Any]) -> Dict[str, Any]:
    names = raw.get("names") or {}
    codes = raw.get("codes") or {}
    capitals = raw.get("capitals") or []
    flag = raw.get("flag") or {}
    area = raw.get("area") or {}
    links = raw.get("links") or {}

    return {
        "cca2": codes.get("alpha_2"),
        "cca3": codes.get("alpha_3"),
        "name_common": names.get("common"),
        "name_official": names.get("official"),
        "region": raw.get("region"),
        "subregion": raw.get("subregion"),
        "capital": (capitals[0].get("name") if capitals else None),
        "population": raw.get("population"),
        "area_km2": area.get("kilometers"),
        "currencies": [
            {"code": c.get("code"), "name": c.get("name"), "symbol": c.get("symbol")}
            for c in (raw.get("currencies") or [])
        ],
        "languages": [l.get("name") for l in (raw.get("languages") or []) if l.get("name")],
        "timezones": raw.get("timezones") or [],
        "continents": raw.get("continents") or [],
        "borders": raw.get("borders") or [],
        "flag_emoji": flag.get("emoji"),
        "flag_png": flag.get("url_png"),
        "flag_svg": flag.get("url_svg"),
        "map_url": links.get("google_maps"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _get(path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    api_key = get_countries_api_key()
    if not api_key:
        print("COUNTRIES_API_KEY not set — skipping REST Countries fetch")
        return None

    try:
        response = requests.get(
            f"{REST_COUNTRIES_BASE}{path}",
            params=params or {},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching from REST Countries: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing REST Countries response: {e}")
        return None

    # v5 reports application errors in a 200 body, so check explicitly rather
    # than trusting the status code — this is exactly how v3.1 failed silently.
    if payload.get("errors"):
        print(f"REST Countries returned errors: {payload['errors']}")
        return None

    data = payload.get("data")
    if not isinstance(data, dict):
        print("REST Countries response missing a 'data' object")
        return None
    return data


def fetch_country_by_code(
    code: str,
    fields: Optional[List[str]] = COUNTRY_FIELDS,
) -> Optional[Dict[str, Any]]:
    """Fetch a single country by ISO alpha-2 (or alpha-3) code."""
    key = "codes.alpha_3" if len(code) == 3 else "codes.alpha_2"
    params: Dict[str, Any] = {}
    if fields:
        params["response_fields"] = ",".join(fields)

    data = _get(f"/{key}/{code.upper()}", params)
    if not data:
        return None

    objects = data.get("objects") or []
    if not objects:
        print(f"REST Countries returned no country for '{code}'")
        return None
    return _normalize_country(objects[0])


def fetch_all_countries(
    fields: Optional[List[str]] = COUNTRY_FIELDS,
    page_limit: int = 100,
) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch every country, following v5's offset pagination.

    The free plan caps `limit` at 100, so ~249 countries is 3 requests.
    """
    params: Dict[str, Any] = {"limit": page_limit, "offset": 0}
    if fields:
        params["response_fields"] = ",".join(fields)

    out: List[Dict[str, Any]] = []
    while True:
        data = _get("", params)
        if data is None:
            # Return what we have rather than losing a near-complete page set.
            return out or None

        out.extend(_normalize_country(o) for o in (data.get("objects") or []))

        meta = data.get("meta") or {}
        if not meta.get("more"):
            break
        params["offset"] = meta.get("offset", 0) + meta.get("count", page_limit)

    return out or None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing REST Countries v5")
    print("=" * 60)

    us = fetch_country_by_code("US")
    if us:
        print(f"{us['flag_emoji']} {us['name_common']} ({us['cca2']}): "
              f"{us['region']}, capital={us['capital']}, pop={us['population']:,}")

    everyone = fetch_all_countries()
    print(f"Fetched {len(everyone) if everyone else 0} countries")
