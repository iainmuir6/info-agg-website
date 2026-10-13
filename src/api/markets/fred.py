"""
fred.py

Economic series from FRED (St. Louis Fed) via its public CSV export —
keyless and unmetered, like Frankfurter.

Real GDP moved here in Oct 2026 when FMP's /stable/economic-indicators started
answering `realGDP` with an empty list (stuck at Q1 2026). FMP's numbers were
FRED's GDPC1 (billions of chained 2017 dollars, seasonally adjusted annual
rate), so the stored series continues without a jump.
"""

from datetime import timedelta
from typing import Any, Dict, List, Optional
import csv
import io
import os
import sys

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import get_http_session, et_today, HTTP_TIMEOUT

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

# indicator_name as stored in info_agg.economic_indicators -> FRED series id
FRED_SERIES = {
    'realGDP': 'GDPC1',
}


def fetch_fred_series(
    indicator_name: str,
    lookback_days: int = 730,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch one FRED series as [{'indicator_name', 'date', 'value'}, ...].

    Same row shape as fmp.fetch_economic_indicator so the caller can mix them.
    Empty list on failure, with the reason appended to `errors`.
    """
    series_id = FRED_SERIES[indicator_name]
    start = (et_today() - timedelta(days=lookback_days)).isoformat()
    try:
        resp = get_http_session().get(
            FRED_CSV_URL, params={'id': series_id, 'cosd': start}, timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        rows = []
        for rec in csv.DictReader(io.StringIO(resp.text)):
            date, value = rec.get('observation_date') or rec.get('DATE'), rec.get(series_id)
            # FRED writes "." (or nothing) for a missing observation.
            if not date or value in (None, '', '.'):
                continue
            rows.append({'indicator_name': indicator_name, 'date': date, 'value': float(value)})
        if not rows:
            msg = f"FRED {series_id} returned no observations"
            print(msg)
            if errors is not None:
                errors.append(msg)
        return rows
    except Exception as e:
        msg = f"Error fetching FRED {series_id} ({indicator_name}): {e}"
        print(msg)
        if errors is not None:
            errors.append(msg)
        return []


if __name__ == "__main__":
    for name in FRED_SERIES:
        rows = fetch_fred_series(name)
        print(name, len(rows), rows[-2:])
