# misc_db_helper.py
#
# Description: Sync the miscellaneous cards (weather, holidays, Wikipedia,
# countries, word of the day, useless facts) into info_agg.misc_content.
#
# Every feed lands in one table as a JSONB payload keyed by (kind, key) —
# see supabase/10_misc_content.sql for why. Each source degrades on its own:
# one dead upstream costs its card, not the domain.

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional
from supabase import create_client, Client
from supabase import ClientOptions
import sys
import os

from dotenv import load_dotenv
load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import chunked_upsert

try:
    from .weather import fetch_weather_timeline, get_weather_api_key
    from .holidays import fetch_upcoming_holidays, get_calendar_api_key
    from .wikipedia import fetch_random_wikipedia_summary
    from .countries import fetch_country_by_code, get_countries_api_key
    from .words import fetch_merriam_webster_wotd
    from .facts import fetch_useless_fact
except ImportError:
    from weather import fetch_weather_timeline, get_weather_api_key
    from holidays import fetch_upcoming_holidays, get_calendar_api_key
    from wikipedia import fetch_random_wikipedia_summary
    from countries import fetch_country_by_code, get_countries_api_key
    from words import fetch_merriam_webster_wotd
    from facts import fetch_useless_fact

# Weather is fetched per city over a FORECAST_DAYS window. Visual Crossing
# bills per day of data returned, so this is 4 cities x 5 days = 20 records a
# run, once a day. Widening either list widens that product.
WEATHER_LOCATIONS: List[str] = [
    "New York,NY",
    "Charlottesville,VA",
    "Brora,Scotland",
    "Aspen,CO",
]

# The card renders 5 days; fetching more would be billed and never shown.
FORECAST_DAYS = 5

HOLIDAY_COUNTRY = "US"

# Rotates daily so the card is not the same country forever. Deterministic on
# the date, so a re-run on the same day is idempotent.
COUNTRY_ROTATION: List[str] = [
    "JP", "IS", "NZ", "PT", "KE", "NO", "CL", "VN", "MA", "IE",
    "PE", "GR", "TH", "FI", "CR", "SI", "UY", "MN", "BT", "NA",
]


def get_supabase_client() -> Client:
    """Create and return a Supabase client."""
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def _record(kind: str, key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'kind': kind,
        'key': key,
        'payload': payload,
        'fetched_at': datetime.now(timezone.utc).isoformat(),
    }


def upsert_misc(
    supabase: Client, records: List[Dict[str, Any]], errors: Optional[List[str]] = None
) -> int:
    """Upsert misc_content rows, keyed on (kind, key)."""
    if not records:
        return 0
    return chunked_upsert(
        supabase, 'misc_content', records, on_conflict='kind,key', errors=errors,
    )


def _weather_payload(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Trim Visual Crossing's timeline to what the card renders."""
    current = raw.get('currentConditions') or {}
    days = raw.get('days') or []

    return {
        'resolved_address': raw.get('resolvedAddress'),
        'timezone': raw.get('timezone'),
        'latitude': raw.get('latitude'),
        'longitude': raw.get('longitude'),
        'current': {
            'temp': current.get('temp'),
            'feelslike': current.get('feelslike'),
            'humidity': current.get('humidity'),
            'windspeed': current.get('windspeed'),
            'conditions': current.get('conditions'),
            'icon': current.get('icon'),
            'sunrise': current.get('sunrise'),
            'sunset': current.get('sunset'),
        },
        'forecast': [
            {
                'date': d.get('datetime'),
                'tempmax': d.get('tempmax'),
                'tempmin': d.get('tempmin'),
                'conditions': d.get('conditions'),
                'icon': d.get('icon'),
                'precipprob': d.get('precipprob'),
            }
            for d in days[:FORECAST_DAYS]
        ],
    }


def _country_is_current(supabase: Client, code: str, now: datetime) -> bool:
    """True when the stored country row is already today's rotation pick.

    Best-effort: any read failure returns False so the fetch still happens —
    a stale card is worse than one extra request against a monthly budget
    that a daily run uses 3% of.
    """
    try:
        res = (
            supabase.table('misc_content')
            .select('payload, fetched_at')
            .eq('kind', 'country')
            .eq('key', '')
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        row = rows[0]
        if (row.get('payload') or {}).get('cca2') != code:
            return False
        fetched = datetime.fromisoformat(str(row['fetched_at']).replace('Z', '+00:00'))
        return fetched.astimezone(timezone.utc).date() == now.date()
    except Exception:
        return False


def sync_misc_data(supabase: Client) -> Dict[str, Any]:
    """
    Fetch and upsert all six misc feeds.

    Each source is wrapped independently: a missing key is a config gap
    (recorded as a note, not an error) and a dead upstream costs one card.
    """
    stats: Dict[str, Any] = {
        'weather_upserted': 0,
        'holidays_upserted': 0,
        'wikipedia_upserted': 0,
        'countries_upserted': 0,
        'words_upserted': 0,
        'facts_upserted': 0,
        'errors': [],
        'notes': [],
    }
    records: List[Dict[str, Any]] = []

    # ── Weather ──────────────────────────────────────────────
    if not get_weather_api_key():
        stats['notes'].append('WEATHER_API_KEY not set — weather skipped')
    else:
        for location in WEATHER_LOCATIONS:
            try:
                today = datetime.now(timezone.utc).date()
                raw = fetch_weather_timeline(
                    location,
                    start_date=today.isoformat(),
                    # Inclusive range, so N-1 gets N days back. Without an
                    # explicit end_date the API returns today alone and the
                    # forecast strip renders a single column.
                    end_date=(today + timedelta(days=FORECAST_DAYS - 1)).isoformat(),
                )
                if not raw:
                    stats['errors'].append(f'Weather fetch returned nothing for {location}')
                    continue
                records.append(_record('weather', location, _weather_payload(raw)))
                stats['weather_upserted'] += 1
            except Exception as e:
                stats['errors'].append(f'Error fetching weather for {location}: {e}')

    # ── Holidays ─────────────────────────────────────────────
    if not get_calendar_api_key():
        stats['notes'].append('CALENDAR_API_KEY not set — holidays skipped')
    else:
        try:
            upcoming = fetch_upcoming_holidays(HOLIDAY_COUNTRY, limit=8)
            if upcoming:
                records.append(_record('holiday', HOLIDAY_COUNTRY, {'holidays': upcoming}))
                stats['holidays_upserted'] = 1
            else:
                stats['errors'].append('Holidays fetch returned nothing')
        except Exception as e:
            stats['errors'].append(f'Error fetching holidays: {e}')

    # ── Wikipedia ────────────────────────────────────────────
    try:
        page = fetch_random_wikipedia_summary()
        if page:
            records.append(_record('wikipedia', '', page))
            stats['wikipedia_upserted'] = 1
        else:
            stats['errors'].append('Wikipedia fetch returned nothing')
    except Exception as e:
        stats['errors'].append(f'Error fetching Wikipedia summary: {e}')

    # ── Country of the day ───────────────────────────────────
    #
    # REST Countries' free tier is 1,000 requests per MONTH, not per day, so
    # this is the one source here that cannot be re-fetched casually. The daily
    # run is ~30/month, but the daily workflow is also manually dispatchable
    # from /dashboard, and every re-run would spend another request for a card
    # that only changes once a day. So: skip if today's country is already
    # stored. Capped at 1 request/day no matter how often the run fires.
    if not get_countries_api_key():
        stats['notes'].append('COUNTRIES_API_KEY not set — country skipped')
    else:
        try:
            now = datetime.now(timezone.utc)
            code = COUNTRY_ROTATION[now.toordinal() % len(COUNTRY_ROTATION)]
            if _country_is_current(supabase, code, now):
                stats['notes'].append(
                    f'Country {code} already fetched today — skipped (1,000 req/month cap)'
                )
            else:
                country = fetch_country_by_code(code)
                if country:
                    # Single key: the card shows one country a day, so a new row
                    # per country would grow forever for no reader.
                    records.append(_record('country', '', country))
                    stats['countries_upserted'] = 1
                else:
                    stats['errors'].append(f'Country fetch returned nothing for {code}')
        except Exception as e:
            stats['errors'].append(f'Error fetching country: {e}')

    # ── Word of the day ──────────────────────────────────────
    try:
        words = fetch_merriam_webster_wotd(limit=1)
        if words:
            records.append(_record('word', '', words[0]))
            stats['words_upserted'] = 1
        else:
            stats['errors'].append('Word of the day fetch returned nothing')
    except Exception as e:
        stats['errors'].append(f'Error fetching word of the day: {e}')

    # ── Useless fact ─────────────────────────────────────────
    try:
        fact = fetch_useless_fact()
        if fact:
            records.append(_record('fact', '', fact))
            stats['facts_upserted'] = 1
        else:
            stats['errors'].append('Useless fact fetch returned nothing')
    except Exception as e:
        stats['errors'].append(f'Error fetching useless fact: {e}')

    if records:
        upsert_misc(supabase, records, errors=stats['errors'])

    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Syncing misc data to database...")
    print("=" * 60)

    client = get_supabase_client()
    result = sync_misc_data(client)
    for k, v in result.items():
        print(f"  {k}: {v}")
