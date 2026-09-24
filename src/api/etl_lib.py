# etl_lib.py
#
# Shared ETL infrastructure: logging, retrying HTTP session, rate-limit
# pacing primitives, environment preflight, and etl_runs recording.
# Every fetcher and orchestrator imports from here — keep this module
# dependency-light (stdlib + requests only; supabase is passed in).

import json
import logging
import os
import re
import sys
import threading
import time
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
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


# ── Secret redaction ─────────────────────────────────────────────────────────
# Fetchers authenticate by query param, and requests puts the full request URL
# — query string and all — into its exception strings. Those strings get
# printed and appended to a domain's `errors`, which land in etl_runs (anon can
# read that table). That is how live Finnhub keys ended up publicly readable.
#
# GitHub Actions masks secrets in workflow logs, but only where the *whole*
# secret appears verbatim: a message truncated mid-key (see EndpointBreaker)
# slips a usable prefix past the masker. So redact ourselves, at every exit —
# the stream filter below covers all ~110 `print(f"... {e}")` sites at once, and
# `_redact()` covers the etl_runs write.
_SECRET_RE = re.compile(r'((?<![\w-])(?:token|apikey|api_key|api-key|key)=)[A-Za-z0-9_-]{4,}', re.I)


def redact_secrets(text: str) -> str:
    """Replace `?api-key=…`-style credentials in an arbitrary string."""
    return _SECRET_RE.sub(r'\1[REDACTED]', text)


class _RedactingStream:
    """Text stream proxy that scrubs credentials out of everything written."""

    def __init__(self, stream: Any):
        self._stream = stream

    def write(self, text: str) -> int:
        return self._stream.write(redact_secrets(text) if '=' in text else text)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


def install_secret_redaction() -> None:
    """Wrap stdout/stderr so no fetcher can print an API key. Idempotent.

    Installed on import: logging's handlers bind whatever stderr is when the
    first logger is configured, and every ETL module imports this one, so
    wrapping here catches both `print()` and logging without each entrypoint
    having to remember.
    """
    for name in ('stdout', 'stderr'):
        stream = getattr(sys, name, None)
        if stream is not None and not isinstance(stream, _RedactingStream):
            setattr(sys, name, _RedactingStream(stream))


install_secret_redaction()


# ── Time ─────────────────────────────────────────────────────────────────────
# Every stored instant is UTC and every *calendar day* the pipeline reasons
# about is a US-Eastern day, because that is the day US markets and US sports
# schedules run on — and the day the frontend renders (lib/format-date.ts).
#
# Neither may come from the runner's clock. `datetime.now()` is naive and
# machine-local: locally it is Eastern, on GitHub Actions it is UTC. So
# `date.today()` on the intraday tier that fires at 00:07 UTC — 8:07pm ET the
# evening before — returned *tomorrow's* date and asked upstream APIs for a day
# that had not happened yet in the market's own timezone.

APP_TZ = ZoneInfo('America/New_York')


def utc_now() -> datetime:
    """Timezone-aware current instant. Use for anything stored in the DB."""
    return datetime.now(timezone.utc)


def et_now() -> datetime:
    """Timezone-aware current instant in US Eastern."""
    return datetime.now(APP_TZ)


def et_today() -> date:
    """Today's US-Eastern calendar date — the pipeline's notion of 'today'."""
    return et_now().date()


# ── HTTP session with retries ────────────────────────────────────────────────

_session: Optional[requests.Session] = None
_session_lock = threading.Lock()


def get_http_session() -> requests.Session:
    """Shared thread-safe Session: 3 retries with exponential backoff on
    5xx and connection errors. Callers keep their own explicit timeouts.

    429 is deliberately NOT retried here. Every rate-limited API in this
    pipeline handles quota itself and far better than a blind retry can:
    Finnhub and Alpha Vantage rotate to the next key, NYT disables the
    offending key for the run, FMP trips a circuit breaker for the whole
    run. Retrying inside the session ran 0s/2s/4s of backoff — or whatever
    Retry-After asked for, unbounded — *before* any of that logic saw the
    429, delaying the very handoff it exists to trigger and spending
    seconds against the <60s run budget (CLAUDE.md). Let 429 through to the
    caller immediately."""
    global _session
    with _session_lock:
        if _session is None:
            retry = Retry(
                total=3,
                connect=3,
                # read=0: a read timeout means the server accepted the
                # connection and then hung, so a retry pays the full timeout
                # again for the same answer. Finnhub's company-news endpoint
                # hanging turned 13 tickers into 3 attempts x 10s each = 240s,
                # 4x the whole run budget. Connection errors are still worth
                # retrying; hung reads are not.
                read=0,
                backoff_factor=1,          # 0s, 2s, 4s between attempts
                status_forcelist=[500, 502, 503, 504],
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


# ── HTTP timeouts ────────────────────────────────────────────────────────────
# (connect, read). Connect sits just above 3s so a single dropped SYN gets one
# TCP retransmit; read is bounded tightly because nothing this pipeline fetches
# is legitimately slow, and an unbounded read is what lets one sick endpoint
# eat the whole run budget.
HTTP_TIMEOUT = (3.05, 8.0)
HTTP_TIMEOUT_SLOW = (3.05, 20.0)   # bulk endpoints: AV time-series, NYT archive


# ── Run deadline ─────────────────────────────────────────────────────────────

class RunDeadline:
    """A cooperative wall-clock budget for one ETL run.

    The circuit breaker handles an endpoint that *fails*. This handles one that
    is merely *slow*: every call succeeding at 7s trips nothing, yet still
    walks the run past its budget. There is no way to enforce this preemptively
    — as_completed(timeout=) stops waiting but cannot cancel a running future,
    and ThreadPoolExecutor's context manager blocks on exit until its threads
    finish, so DOMAIN_TIMEOUT_S bounds nothing at all. The only real lever is
    for fan-out loops to stop *starting* new work once the budget is spent.

    Callers must record what they skipped. A silent cap is worse than a slow
    run: it reads as "covered everything" when it did not.

    Unset by default, so anything importing this module outside a run (tests,
    backfills, one-off scripts) is unbounded.
    """

    def __init__(self) -> None:
        self._end: Optional[float] = None

    def start(self, budget_seconds: float) -> None:
        self._end = time.monotonic() + budget_seconds

    def clear(self) -> None:
        self._end = None

    def remaining(self) -> float:
        if self._end is None:
            return float('inf')
        return self._end - time.monotonic()

    def expired(self) -> bool:
        return self.remaining() <= 0

    def skip_note(self, what: str, remaining_items: int) -> str:
        return (f"deadline: budget spent, skipped {remaining_items} remaining "
                f"{what} (data written so far is kept)")


run_deadline = RunDeadline()


# ── Per-endpoint circuit breaker ─────────────────────────────────────────────

class EndpointUnavailable(RuntimeError):
    """Raised instead of calling an endpoint that has already failed repeatedly
    this run. Callers should record it and move on — it is a real error, not a
    quiet 'no data' result."""


class EndpointBreaker:
    """Stop calling an endpoint that has failed N times in a row this run.

    A dead endpoint costs a full timeout per call, and the pipeline fans out
    over dozens of tickers/sections against the same URL. Without this, one
    outage is paid for once per item: Finnhub's company-news endpoint going
    down cost 240s against a 60s budget, and every ticker paid the same toll
    to learn the same fact.

    Process-lifetime (one ETL run) by design — the next run starts clean and
    re-probes. Counters reset on any success, so a single blip does not
    disable an endpoint that is merely flaky.
    """

    def __init__(self, threshold: int = 3):
        self.threshold = threshold
        self._fails: Dict[str, int] = {}
        self._reason: Dict[str, str] = {}
        self._lock = threading.Lock()

    def check(self, endpoint: str) -> None:
        """Raise EndpointUnavailable if this endpoint is already tripped."""
        with self._lock:
            if self._fails.get(endpoint, 0) >= self.threshold:
                reason = self._reason.get(endpoint, 'repeated failures')
                raise EndpointUnavailable(
                    f"{endpoint}: skipped after {self.threshold} consecutive "
                    f"failures this run ({reason})"
                )

    def record_failure(self, endpoint: str, exc: Any) -> None:
        with self._lock:
            self._fails[endpoint] = self._fails.get(endpoint, 0) + 1
            self._reason[endpoint] = redact_secrets(str(exc))[:120]

    def record_success(self, endpoint: str) -> None:
        with self._lock:
            if endpoint in self._fails:
                del self._fails[endpoint]
                self._reason.pop(endpoint, None)

    def tripped(self, endpoint: str) -> bool:
        with self._lock:
            return self._fails.get(endpoint, 0) >= self.threshold


def is_host_fault(exc: Any) -> bool:
    """True when an exception blames the *host* rather than the resource.

    Connection errors, timeouts, 5xx and 429 mean the next call to any path on
    that host will probably cost another full timeout — worth short-circuiting.
    A 404/400/403 on one path says nothing about the other eight paths behind
    the same breaker id, and counting it there is how one league's oddity ended
    up skipping every league after it.
    """
    response = getattr(exc, 'response', None)
    status = getattr(response, 'status_code', None)
    if status is None:
        return True
    return status >= 500 or status in (408, 429)


# Shared across fetchers so every caller of the same endpoint benefits from
# what the others already learned.
breaker = EndpointBreaker()


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


# ── Database resilience ──────────────────────────────────────────────────────
# Supabase/PostgREST calls go through httpx with no retry policy of its own, so
# a single dropped connection or 5xx would otherwise lose a whole batch — and,
# because domains judge success on rows written, fail the domain.

_db_log = get_logger('db')

DB_ATTEMPTS = 3
DB_BACKOFF_S = 0.4
UPSERT_CHUNK = 250


def db_call(fn: Any, what: str, attempts: int = DB_ATTEMPTS) -> Any:
    """Run a Supabase call, retrying transient failures with backoff.

    Raises the last exception if every attempt fails — callers decide whether
    that is fatal or just an entry in their error list.
    """
    last: Optional[Exception] = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as e:
            last = e
            if attempt < attempts:
                _db_log.warning('%s failed (attempt %d/%d): %s', what, attempt, attempts, e)
                time.sleep(DB_BACKOFF_S * attempt)
    raise last  # type: ignore[misc]


def chunked_upsert(
    supabase: Any,
    table: str,
    records: List[Dict[str, Any]],
    on_conflict: Optional[str] = None,
    errors: Optional[List[str]] = None,
    chunk_size: int = UPSERT_CHUNK,
    ignore_duplicates: bool = False,
) -> int:
    """Upsert records in chunks, salvaging everything that can be written.

    A chunk that fails is retried, then split in half and each half retried,
    recursing down to single rows. One malformed row therefore costs that row
    instead of the whole day's data for the table. Returns the number of rows
    written; failures are appended to ``errors`` (bounded to keep the etl_runs
    payload small) rather than raised.

    ``ignore_duplicates`` makes it insert-or-skip (``ON CONFLICT DO NOTHING``)
    and the return value counts only the rows actually inserted. Use it for
    append-only feeds that re-fetch rows they already hold: a no-op rewrite
    still writes a new tuple and, unless it lands HOT, a new entry in every
    index — company_news carried 21 MB of indexes over 6 MB of rows that way.
    """
    if not records:
        return 0

    def _write(batch: List[Dict[str, Any]], attempts: int) -> int:
        def _exec():
            kw: Dict[str, Any] = {'ignore_duplicates': ignore_duplicates}
            if on_conflict:
                kw['on_conflict'] = on_conflict
            return supabase.table(table).upsert(batch, **kw).execute()
        resp = db_call(_exec, f'{table} upsert ({len(batch)} rows)', attempts=attempts)
        if ignore_duplicates:
            # Skipped rows are absent from the representation, so it is the count.
            return len(getattr(resp, 'data', None) or [])
        # PostgREST may return no representation; assume the batch landed.
        return len(resp.data) if getattr(resp, 'data', None) else len(batch)

    def _note(msg: str) -> None:
        _db_log.warning(msg)
        if errors is not None and len(errors) < 100:
            errors.append(msg)

    def _bisect(batch: List[Dict[str, Any]]) -> int:
        """Salvage what a failed batch can still write.

        Sub-batches get a single attempt, not the full retry ladder: the parent
        already exhausted its retries, so the error is deterministic and further
        backoff would only burn the run's time budget. A row that fails alone
        gets one last retried attempt before being dropped.
        """
        try:
            return _write(batch, attempts=1)
        except Exception as e:
            if len(batch) == 1:
                try:
                    return _write(batch, attempts=DB_ATTEMPTS)
                except Exception as final:
                    _note(f'{table}: dropped 1 unwritable row: {str(final)[:160]}')
                    return 0
            mid = len(batch) // 2
            _db_log.warning('%s: batch of %d failed, bisecting: %s', table, len(batch), str(e)[:160])
            return _bisect(batch[:mid]) + _bisect(batch[mid:])

    written = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i:i + chunk_size]
        try:
            written += _write(chunk, attempts=DB_ATTEMPTS)
        except Exception as e:
            _db_log.warning('%s: chunk of %d failed, bisecting: %s', table, len(chunk), str(e)[:160])
            written += _bisect(chunk)
    # Under ignore_duplicates a short count is the skipped duplicates, not a
    # failure; real row failures were already noted by _bisect.
    if written < len(records) and not ignore_duplicates:
        _note(f'{table}: wrote {written}/{len(records)} rows')
    return written


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
            'exhausts the 25/key/day free-tier quota; later topics will return no data'
        )

    nyt = distinct_env_values('NYT_API_KEY_1', 'NYT_API_KEY_2', 'NYT_API_KEY_3')
    if not nyt:
        warnings_.append('No NYT_API_KEY_* — news domain will fail')

    if not os.getenv('FMP_API_KEY'):
        warnings_.append('No FMP_API_KEY — forex/commodity quotes and economic indicators will fail')

    if not os.getenv('YOUTUBE_API_KEY'):
        warnings_.append('No YOUTUBE_API_KEY — media domain will be skipped (Spotify/podcasts need no key, they are frontend embeds)')

    return fatal, warnings_


# ── etl_runs recording ───────────────────────────────────────────────────────
# Best-effort by design: a broken observability write must never take down
# the pipeline it observes.

log = get_logger('etl_runs')

def _redact(obj: Any) -> Any:
    """Strip API keys out of anything bound for etl_runs. Best-effort: a payload
    that will not round-trip through JSON is dropped rather than stored raw."""
    try:
        return json.loads(redact_secrets(json.dumps(obj, default=str)))
    except (TypeError, ValueError) as e:
        log.warning('could not redact run payload, omitting it: %s', e)
        return None


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
            'stats': _redact(stats),
            'errors': _redact(errors[:100]),   # bound the payload
            'cleanup': _redact(cleanup),
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
