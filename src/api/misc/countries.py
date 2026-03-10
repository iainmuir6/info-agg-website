"""
countries.py

Wrappers for the REST Countries API.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import requests

from dotenv import load_dotenv

load_dotenv()

REST_COUNTRIES_BASE = "https://restcountries.com/v3.1"

# See: https://gitlab.com/restcountries/restcountries/-/blob/master/FIELDS.md
COUNTRY_FIELDS = [
    "name",             # object: {common, official, nativeName}
    "altSpellings",
    "cca2",             # 2-letter code
    "cca3",             # 3-letter code
    "ccn3",             # numeric code string (was "numeric" in old API)
    "cioc",             # IOC country code
    "independent",
    "status",
    "unMember",
    "currencies",       # object
    "idd",              # object (international direct dialing)
    "capital",          # [string]
    "latlng",           # [latitude, longitude]
    "region",
    "subregion",
    "languages",        # object
    "translations",
    "landlocked",
    "borders",
    "area",             # float
    "demonyms",
    "flag",
    "maps",
    "population",
    "fifa",
    "car",
    "timezones",
    "continents",
    "flags",
    "coatOfArms",
    "startOfWeek",
    "capitalInfo",
    "postalCode",
    "tld",
]


def _normalize_country(raw: Dict[str, Any]) -> Dict[str, Any]:
    name = raw.get("name", {})
    return {
        "cca2": raw.get("cca2"),
        "cca3": raw.get("cca3"),
        "name_common": name.get("common"),
        "name_official": name.get("official"),
        "region": raw.get("region"),
        "subregion": raw.get("subregion"),
        "capital": (raw.get("capital") or [None])[0],
        "population": raw.get("population"),
        "area": raw.get("area"),
        "currencies": list((raw.get("currencies") or {}).keys()),
        "languages": list((raw.get("languages") or {}).values()),
        "flag": raw.get("flag"),
        "fetched_at": datetime.utcnow().isoformat(),
    }


def fetch_all_countries(fields: Optional[List[str]] = COUNTRY_FIELDS) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch all countries from REST Countries, batching field requests into
    chunks of at most 10 fields and merging them back together.

    Args:
        fields: Optional list of field names to request from the API.

    Returns:
        List of raw country dicts (merged across batches), or None on error.
    """
    url = f"{REST_COUNTRIES_BASE}/all"

    try:
        # Always ensure cca3 is requested so we can merge batches.
        effective_fields: List[str] = fields[:] if fields is not None else COUNTRY_FIELDS[:]
        if "cca3" not in effective_fields:
            effective_fields.append("cca3")

        # Simple case: <= 10 fields total — single request.
        if len(effective_fields) <= 10:
            params: Dict[str, Any] = {"fields": ",".join(effective_fields)}
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()

        # Batch non-id fields into chunks of at most 9, always including cca3.
        non_id_fields = [f for f in effective_fields if f != "cca3"]
        max_non_id_per_batch = 9

        batched_fields: List[List[str]] = []
        current: List[str] = []
        for f in non_id_fields:
            current.append(f)
            if len(current) == max_non_id_per_batch:
                batched_fields.append(current)
                current = []
        if current:
            batched_fields.append(current)

        merged: Dict[str, Dict[str, Any]] = {}

        for chunk in batched_fields:
            fields_param = ["cca3"] + chunk
            params = {"fields": ",".join(fields_param)}
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            for raw in data:
                key = raw.get("cca3")
                if not key:
                    continue
                existing = merged.get(key)
                if existing is None:
                    merged[key] = dict(raw)
                else:
                    existing.update(raw)

        return list(merged.values())

    except requests.exceptions.RequestException as e:
        print(f"Error fetching countries from REST Countries: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing countries from REST Countries: {e}")
        return None


def fetch_country_by_code(
    code: str,
    fields: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch a single country by ISO code (2- or 3-letter).
    """
    url = f"{REST_COUNTRIES_BASE}/alpha/{code}"
    params = {}
    if fields:
        params["fields"] = ",".join(fields)

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list) and data:
            return _normalize_country(data[0])
        if isinstance(data, dict):
            return _normalize_country(data)
        return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching country '{code}' from REST Countries: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing country '{code}' from REST Countries: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing REST Countries API")
    print("=" * 60)

    us = fetch_country_by_code("US")
    if us:
        print(f"{us['name_common']} ({us['cca2']}): {us['region']}, capital={us['capital']}")

    all_countries = fetch_all_countries()
    if all_countries:
        print(f"Found {len(all_countries)} countries")
        for country in all_countries:
            print(f"{country['name']['common']} ({country['cca2']}): {country['region']}, capital={country['capital']}")