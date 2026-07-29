# etl_lib.py
#
# Shared ETL infrastructure: logging, retrying HTTP session, rate-limit
# pacing primitives, environment preflight, and etl_runs recording.
# Every fetcher and orchestrator imports from here — keep this module
# dependency-light (stdlib + requests only; supabase is passed in).

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_LOG_CONFIGURED = False
_LOG_LOCK = threading.Lock()


def get_logger(name: str) -> logging.Logger:
    """Return a namespaced logger; configures root formatting on first use."""
    global _LOG_CONFIGURED
    with _LOG_LOCK:
        if not _LOG_CONFIGURED:
            logging.basicConfig(
                level=os.getenv('ETL_LOG_LEVEL', 'INFO'),
                format='%(asctime)s %(levelname)-7s %(name)s: %(message)s',
                datefmt='%H:%M:%S',
            )
            _LOG_CONFIGURED = True
    return logging.getLogger(name)


# ── HTTP session with retries ────────────────────────────────────────────────

_session: Optional[requests.Session] = None
_session_lock = threading.Lock()


def get_http_session() -> requests.Session:
    """Shared thread-safe Session: 3 retries with exponential backoff on
    429/5xx and connection errors, honoring Retry-After. Callers keep their
    own explicit timeouts."""
    global _session
    with _session_lock:
        if _session is None:
            retry = Retry(
                total=3,
                connect=3,
                read=2,
                backoff_factor=1,          # 0s, 2s, 4s between attempts
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=['GET', 'POST'],
                respect_retry_after_header=True,
                raise_on_status=False,      # deliver the final response; callers raise_for_status()
            )
            s = requests.Session()
            adapter = HTTPAdapter(max_retries=retry, pool_maxsize=20)
            s.mount('https://', adapter)
            s.mount('http://', adapter)
            _session = s
        return _session


# ── Pacing primitive ─────────────────────────────────────────────────────────

class MinInterval:
    """Enforce a minimum interval between calls WITHOUT sleeping while the
    lock is held (a lock-held sleep serializes every worker sharing the
    module — the historical ETL hang; see CLAUDE.md). Each caller reserves
    the next free slot under the lock, then sleeps outside it."""

    def __init__(self, interval_s: float):
        self.interval_s = interval_s
        self._lock = threading.Lock()
        self._next_free = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next_free)
            self._next_free = start + self.interval_s
        delay = start - now
        if delay > 0:
            time.sleep(delay)


# ── Environment preflight ────────────────────────────────────────────────────

def distinct_env_values(*names: str) -> List[str]:
    """Distinct non-empty values among the given env var names."""
    seen: List[str] = []
    for n in names:
        v = os.getenv(n)
        if v and v not in seen:
            seen.append(v)
    return seen


def preflight_env() -> Tuple[List[str], List[str]]:
    """Validate the ETL environment before any work starts.

    Returns (fatal, warnings). Fatal issues should abort the run; warnings
    mean a source will degrade but the run can proceed.
    """
    fatal: List[str] = []
    warnings_: List[str] = []

    if not os.getenv('NEXT_PUBLIC_SUPABASE_URL') or not os.getenv('SUPABASE_SERVICE_ROLE_KEY'):
        fatal.append('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nowhere to write')

    fh = distinct_env_values('FINNHUB_API_KEY_1', 'FINNHUB_API_KEY_2', 'FINNHUB_API_KEY_3')
    if not fh:
        warnings_.append('No FINNHUB_API_KEY_* — markets quotes/news will fail')
    elif len(fh) < 2:
        warnings_.append('Only 1 distinct Finnhub key — half the expected rate budget')

    av = distinct_env_values('ALPHA_VANTAGE_API_KEY', 'ALPHA_VANTAGE_API_KEY_1',
                             'ALPHA_VANTAGE_API_KEY_2', 'ALPHA_VANTAGE_API_KEY_3')
    if len(av) < 2:
        warnings_.append(
            f'Only {len(av)} distinct Alpha Vantage key(s) — 10 sentiment topics on <2 keys '
            'trips the 5/min limiter into a ~60s sleep; sentiment should be skipped'
        )

    nyt = distinct_env_values('NYT_API_KEY_1', 'NYT_API_KEY_2', 'NYT_API_KEY_3')
    if not nyt:
        warnings_.append('No NYT_API_KEY_* — news domain will fail')

    if not os.getenv('FMP_API_KEY'):
        warnings_.append('No FMP_API_KEY — forex/commodity quotes and economic indicators will fail')

    if not os.getenv('YOUTUBE_API_KEY'):
        warnings_.append('No YOUTUBE_API_KEY — media domain will fail (Spotify/podcasts need no key, they are frontend embeds)')

    return fatal, warnings_


# ── etl_runs recording ───────────────────────────────────────────────────────
# Best-effort by design: a broken observability write must never take down
# the pipeline it observes.

log = get_logger('etl_runs')


def start_etl_run(supabase: Any, triggered_by: str, tier: str) -> Optional[str]:
    try:
        resp = supabase.table('etl_runs').insert({
            'triggered_by': triggered_by,
            'tier': tier,
            'status': 'running',
            'started_at': datetime.now(timezone.utc).isoformat(),
        }).execute()
        return resp.data[0]['id'] if resp.data else None
    except Exception as e:
        log.warning('could not record run start: %s', e)
        return None


def finish_etl_run(
    supabase: Any,
    run_id: Optional[str],
    status: str,
    stats: Dict[str, Any],
    errors: List[str],
    duration_seconds: float,
    cleanup: Optional[Dict[str, Any]] = None,
) -> None:
    if not run_id:
        return
    try:
        supabase.table('etl_runs').update({
            'status': status,
            'finished_at': datetime.now(timezone.utc).isoformat(),
            'duration_seconds': round(duration_seconds, 1),
            'stats': stats,
            'errors': errors[:100],   # bound the payload
            'cleanup': cleanup,
        }).eq('id', run_id).execute()
    except Exception as e:
        log.warning('could not record run finish: %s', e)


def collect_domain_errors(results: Dict[str, Any]) -> List[str]:
    """Flatten every domain's error strings out of a run-results dict."""
    errors: List[str] = []
    for domain, result in results.items():
        if not isinstance(result, dict):
            continue
        if result.get('error'):
            errors.append(f"{domain}: {result['error']}")
        for e in (result.get('stats') or {}).get('errors', []):
            errors.append(f"{domain}: {e}")
    return errors
