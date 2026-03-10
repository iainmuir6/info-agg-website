"""
Odds API v4 wrapper for sports betting data.

Fetches data from https://api.the-odds-api.com (v4) and writes small JSON
snippets for each endpoint under ``data/snippets/sports`` for inspection.

Persistence to Supabase is intentionally out of scope for now.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import requests
from dotenv import load_dotenv


load_dotenv()

ODDS_API_BASE = "https://api.the-odds-api.com/v4"
ODDS_SNIPPETS_DIR = Path("data/snippets/sports")


class OddsApiError(Exception):
    """
    Raised when The Odds API returns an error or the request fails.

    Attributes:
        status_code: HTTP status code, if available.
        message: Human-readable error message.
        requests_remaining: x-requests-remaining header, if present.
        requests_used: x-requests-used header, if present.
        requests_last: x-requests-last header, if present.
    """

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        requests_remaining: Optional[str] = None,
        requests_used: Optional[str] = None,
        requests_last: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.requests_remaining = requests_remaining
        self.requests_used = requests_used
        self.requests_last = requests_last


@dataclass
class OddsApiClient:
    """
    Thin wrapper around The Odds API v4.

    This client focuses on fetching data and writing small JSON snippets;
    no database persistence is performed here.
    """

    api_key: str
    base_url: str = ODDS_API_BASE
    snippets_dir: Path = ODDS_SNIPPETS_DIR
    session: Optional[requests.Session] = None

    def __post_init__(self) -> None:
        if not self.api_key:
            raise ValueError("ODDS_API_KEY must be set to use OddsApiClient")
        if self.session is None:
            self.session = requests.Session()
        # Ensure snippet directory exists
        self.snippets_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Core request / snippet helpers
    # ------------------------------------------------------------------
    def _get(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        *,
        save_snippet: bool = False,
        endpoint_name: str,
        snippet_label: Optional[str] = None,
        max_items: Optional[int] = None,
    ) -> Union[Dict[str, Any], List[Any]]:
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        query: Dict[str, Any] = {}
        if params:
            query.update(params)
        query["apiKey"] = self.api_key

        try:
            resp = self.session.get(url, params=query, timeout=10)
        except requests.exceptions.RequestException as e:
            msg = f"Error calling Odds API [{endpoint_name}] at {url}: {e}"
            print(msg)
            raise OddsApiError(message=msg) from e

        quota_headers = {
            "remaining": resp.headers.get("x-requests-remaining"),
            "used": resp.headers.get("x-requests-used"),
            "last": resp.headers.get("x-requests-last"),
        }

        if resp.status_code != 200:
            # Attempt to include error payload if present
            try:
                payload = resp.json()
            except ValueError:
                payload = resp.text
            msg = (
                f"Odds API error [{endpoint_name}] {resp.status_code}: {payload}. "
                f"Quota remaining={quota_headers['remaining']} used={quota_headers['used']} "
                f"last={quota_headers['last']}"
            )
            print(msg)
            raise OddsApiError(
                message=msg,
                status_code=resp.status_code,
                requests_remaining=quota_headers["remaining"],
                requests_used=quota_headers["used"],
                requests_last=quota_headers["last"],
            )

        try:
            data: Union[Dict[str, Any], List[Any]] = resp.json()
        except ValueError as e:
            msg = f"Failed to decode JSON from Odds API [{endpoint_name}] at {url}: {e}"
            print(msg)
            raise OddsApiError(message=msg) from e

        if save_snippet:
            self._save_snippet(
                endpoint=endpoint_name,
                label=snippet_label,
                payload=data,
                max_items=max_items,
                request_info={"url": url, "params": query, "status_code": resp.status_code},
            )

        return data

    def _save_snippet(
        self,
        *,
        endpoint: str,
        label: Optional[str],
        payload: Union[Dict[str, Any], List[Any]],
        max_items: Optional[int],
        request_info: Dict[str, Any],
    ) -> None:
        """
        Write a small JSON snippet for debugging/inspection.
        """
        # ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        slug = endpoint.replace("/", "_")
        label_part = f"_{label}" if label else ""
        # filename = self.snippets_dir / f"odds_{slug}{label_part}_{ts}.json"
        filename = self.snippets_dir / f"odds_{slug}{label_part}.json"

        # Truncate large lists for readability
        snippet_payload: Union[Dict[str, Any], List[Any]] = payload
        if isinstance(payload, list) and max_items is not None and max_items > 0:
            snippet_payload = payload[:max_items]
        elif isinstance(payload, dict) and max_items is not None and max_items > 0:
            # For historical odds/events responses that wrap data under a key
            data_val = payload.get("data")
            if isinstance(data_val, list):
                trimmed = data_val[:max_items]
                snippet_payload = {**payload, "data": trimmed}

        snippet = {
            "endpoint": endpoint,
            "saved_at_utc": datetime.utcnow().isoformat() + "Z",
            "request": request_info,
            "payload": snippet_payload,
        }

        try:
            with filename.open("w", encoding="utf-8") as f:
                json.dump(snippet, f, ensure_ascii=False, indent=2)
        except OSError as e:
            print(f"Failed to write Odds API snippet to {filename}: {e}")

    # ------------------------------------------------------------------
    # Core live endpoints
    # ------------------------------------------------------------------
    def get_sports(self, all: Optional[bool] = None, save_snippet: bool = False) -> List[Dict[str, Any]]:
        """
        GET /sports

        Returns a list of in-season sports (or all sports if all=true).
        """
        params: Dict[str, Any] = {}
        if all is not None:
            params["all"] = str(all).lower()

        data = self._get(
            "/sports",
            params=params,
            endpoint_name="sports",
            snippet_label="all" if all else "in_season",
            max_items=10,
            save_snippet=save_snippet,
        )
        return list(data) if isinstance(data, list) else []

    def get_odds(
        self,
        sport: str,
        *,
        regions: str,
        markets: Optional[str] = None,
        date_format: Optional[str] = None,
        odds_format: Optional[str] = None,
        event_ids: Optional[str] = None,
        bookmakers: Optional[str] = None,
        commence_time_from: Optional[str] = None,
        commence_time_to: Optional[str] = None,
        include_links: Optional[bool] = None,
        include_sids: Optional[bool] = None,
        include_bet_limits: Optional[bool] = None,
        include_rotation_numbers: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """
        GET /sports/{sport}/odds

        Returns upcoming and live games with odds for the specified sport.
        """
        params: Dict[str, Any] = {"regions": regions}
        if markets:
            params["markets"] = markets
        if date_format:
            params["dateFormat"] = date_format
        if odds_format:
            params["oddsFormat"] = odds_format
        if event_ids:
            params["eventIds"] = event_ids
        if bookmakers:
            params["bookmakers"] = bookmakers
        if commence_time_from:
            params["commenceTimeFrom"] = commence_time_from
        if commence_time_to:
            params["commenceTimeTo"] = commence_time_to
        if include_links is not None:
            params["includeLinks"] = str(include_links).lower()
        if include_sids is not None:
            params["includeSids"] = str(include_sids).lower()
        if include_bet_limits is not None:
            params["includeBetLimits"] = str(include_bet_limits).lower()
        if include_rotation_numbers is not None:
            params["includeRotationNumbers"] = str(include_rotation_numbers).lower()

        data = self._get(
            f"/sports/{sport}/odds",
            params=params,
            endpoint_name="odds",
            snippet_label=sport,
            max_items=10,
        )
        return list(data) if isinstance(data, list) else []

    def get_scores(
        self,
        sport: str,
        *,
        days_from: Optional[int] = None,
        date_format: Optional[str] = None,
        event_ids: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        GET /sports/{sport}/scores

        Returns upcoming, live, and recently completed games for the given sport.
        """
        params: Dict[str, Any] = {}
        if days_from is not None:
            params["daysFrom"] = days_from
        if date_format:
            params["dateFormat"] = date_format
        if event_ids:
            params["eventIds"] = event_ids

        data = self._get(
            f"/sports/{sport}/scores",
            params=params,
            endpoint_name="scores",
            snippet_label=sport,
            max_items=10,
        )
        return list(data) if isinstance(data, list) else []

    def get_events(
        self,
        sport: str,
        *,
        date_format: Optional[str] = None,
        event_ids: Optional[str] = None,
        commence_time_from: Optional[str] = None,
        commence_time_to: Optional[str] = None,
        include_rotation_numbers: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """
        GET /sports/{sport}/events

        Returns in-play and pre-match events (no odds).
        """
        params: Dict[str, Any] = {}
        if date_format:
            params["dateFormat"] = date_format
        if event_ids:
            params["eventIds"] = event_ids
        if commence_time_from:
            params["commenceTimeFrom"] = commence_time_from
        if commence_time_to:
            params["commenceTimeTo"] = commence_time_to
        if include_rotation_numbers is not None:
            params["includeRotationNumbers"] = str(include_rotation_numbers).lower()

        data = self._get(
            f"/sports/{sport}/events",
            params=params,
            endpoint_name="events",
            snippet_label=sport,
            max_items=10,
        )
        return list(data) if isinstance(data, list) else []

    def get_event_odds(
        self,
        sport: str,
        event_id: str,
        *,
        regions: str,
        markets: str,
        date_format: Optional[str] = None,
        odds_format: Optional[str] = None,
        include_multipliers: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        GET /sports/{sport}/events/{eventId}/odds

        Returns odds for a single event across specified markets/regions.
        """
        params: Dict[str, Any] = {
            "regions": regions,
            "markets": markets,
        }
        if date_format:
            params["dateFormat"] = date_format
        if odds_format:
            params["oddsFormat"] = odds_format
        if include_multipliers is not None:
            params["includeMultipliers"] = str(include_multipliers).lower()

        data = self._get(
            f"/sports/{sport}/events/{event_id}/odds",
            params=params,
            endpoint_name="event_odds",
            snippet_label=f"{sport}_{event_id[:8]}",
            max_items=None,
        )
        return data if isinstance(data, dict) else {}

    def get_event_markets(
        self,
        sport: str,
        event_id: str,
        *,
        regions: str,
        bookmakers: Optional[str] = None,
        date_format: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        GET /sports/{sport}/events/{eventId}/markets

        Returns available market keys per bookmaker for a single event.
        """
        params: Dict[str, Any] = {"regions": regions}
        if bookmakers:
            params["bookmakers"] = bookmakers
        if date_format:
            params["dateFormat"] = date_format

        data = self._get(
            f"/sports/{sport}/events/{event_id}/markets",
            params=params,
            endpoint_name="event_markets",
            snippet_label=f"{sport}_{event_id[:8]}",
            max_items=None,
        )
        return data if isinstance(data, dict) else {}

    def get_participants(self, sport: str) -> List[Dict[str, Any]]:
        """
        GET /sports/{sport}/participants

        Returns a list of participants (teams or players) for a sport.
        """
        data = self._get(
            f"/sports/{sport}/participants",
            params=None,
            endpoint_name="participants",
            snippet_label=sport,
            max_items=50,
        )
        return list(data) if isinstance(data, list) else []

    # ------------------------------------------------------------------
    # Historical endpoints
    # ------------------------------------------------------------------
    def get_historical_odds(
        self,
        sport: str,
        *,
        regions: str,
        markets: str,
        date: str,
        odds_format: Optional[str] = None,
        date_format: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        GET /historical/sports/{sport}/odds

        Returns a historical snapshot of games with odds for the given sport.
        """
        params: Dict[str, Any] = {
            "regions": regions,
            "markets": markets,
            "date": date,
        }
        if odds_format:
            params["oddsFormat"] = odds_format
        if date_format:
            params["dateFormat"] = date_format

        data = self._get(
            f"/historical/sports/{sport}/odds",
            params=params,
            endpoint_name="historical_odds",
            snippet_label=sport,
            max_items=10,
        )
        return data if isinstance(data, dict) else {}

    def get_historical_events(
        self,
        sport: str,
        *,
        date: str,
        date_format: Optional[str] = None,
        event_ids: Optional[str] = None,
        commence_time_from: Optional[str] = None,
        commence_time_to: Optional[str] = None,
        include_rotation_numbers: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        GET /historical/sports/{sport}/events

        Returns a list of historical events snapshot at the given timestamp.
        """
        params: Dict[str, Any] = {
            "date": date,
        }
        if date_format:
            params["dateFormat"] = date_format
        if event_ids:
            params["eventIds"] = event_ids
        if commence_time_from:
            params["commenceTimeFrom"] = commence_time_from
        if commence_time_to:
            params["commenceTimeTo"] = commence_time_to
        if include_rotation_numbers is not None:
            params["includeRotationNumbers"] = str(include_rotation_numbers).lower()

        data = self._get(
            f"/historical/sports/{sport}/events",
            params=params,
            endpoint_name="historical_events",
            snippet_label=sport,
            max_items=10,
        )
        return data if isinstance(data, dict) else {}

    def get_historical_event_odds(
        self,
        sport: str,
        event_id: str,
        *,
        regions: str,
        markets: str,
        date: str,
        odds_format: Optional[str] = None,
        date_format: Optional[str] = None,
        include_multipliers: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        GET /historical/sports/{sport}/events/{eventId}/odds

        Returns historical odds for a single event snapshot at the given time.
        """
        params: Dict[str, Any] = {
            "regions": regions,
            "markets": markets,
            "date": date,
        }
        if odds_format:
            params["oddsFormat"] = odds_format
        if date_format:
            params["dateFormat"] = date_format
        if include_multipliers is not None:
            params["includeMultipliers"] = str(include_multipliers).lower()

        data = self._get(
            f"/historical/sports/{sport}/events/{event_id}/odds",
            params=params,
            endpoint_name="historical_event_odds",
            snippet_label=f"{sport}_{event_id[:8]}",
            max_items=None,
        )
        return data if isinstance(data, dict) else {}


# ----------------------------------------------------------------------
# Module-level helpers / convenience
# ----------------------------------------------------------------------
def get_odds_client(
    *,
    api_key: Optional[str] = None,
    base_url: str = ODDS_API_BASE,
    snippets_dir: Path = ODDS_SNIPPETS_DIR,
) -> OddsApiClient:
    """
    Construct an OddsApiClient using ODDS_API_KEY from environment by default.
    """
    key = api_key or os.getenv("ODDS_API_KEY")
    if not key:
        raise ValueError(
            "ODDS_API_KEY environment variable is not set. "
            "Add it to your .env.local or shell environment."
        )
    return OddsApiClient(api_key=key, base_url=base_url, snippets_dir=snippets_dir)


def fetch_upcoming_us_odds(
    sport_key: str,
    *,
    markets: str = "h2h",
    odds_format: str = "american",
) -> List[Dict[str, Any]]:
    """
    Convenience helper: fetch upcoming + live odds for a sport in US region.

    Example:
        fetch_upcoming_us_odds("americanfootball_nfl")
        fetch_upcoming_us_odds("upcoming")  # across all sports
    """
    client = get_odds_client()
    return client.get_odds(
        sport=sport_key,
        regions="us",
        markets=markets,
        odds_format=odds_format,
    )


if __name__ == "__main__":
    """
    Simple manual smoke test:

    Activate the venv, export ODDS_API_KEY, then run:
        python3 src/api/sports/odds.py
    """
    try:
        client = get_odds_client()
    except Exception as exc:  # pragma: no cover - manual usage
        print(f"Cannot create OddsApiClient: {exc}")
    else:  # pragma: no cover - manual usage
        print("Fetching sports list from Odds API...")
        try:
            sports = client.get_sports(save_snippet=True)
            print(f"Received {len(sports)} sports (sample):")
            for s in sports[:5]:
                print(f"- {s.get('key')}: {s.get('title')}")
        except OddsApiError as e:
            print(f"Error fetching sports: {e}")

