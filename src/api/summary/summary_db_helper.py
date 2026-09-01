# summary_db_helper.py
#
# Description: Generate the two AI briefing cards — "Summary of the Day" and
# "Summary of the Week" — and store them in info_agg.misc_content under
# kind='summary', keys 'day' and 'week'.
#
# This domain is unlike every other one here: it has no upstream of its own.
# Its input is the rows the other four domains just wrote, which is why
# run_etl.py runs it sequentially AFTER the parallel block rather than
# alongside — run it in parallel and it summarises yesterday's data.
#
# Grounding
# ---------
# The model is given a context bundle assembled from the database and told, in
# the system instruction, that it may only reference what is in that bundle.
# This matters most for the forward-looking half of the daily card: the site's
# tables are all backward-looking except for scheduled games and upcoming
# holidays, so "what to look for today" is grounded in those plus follow-ups to
# stories that are actually in the bundle. An ungrounded lookahead from a small
# model invents fixtures and earnings dates, and it does it on the one card
# read first thing every morning.

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import json
import os
import sys

from supabase import create_client, Client
from supabase import ClientOptions
from dotenv import load_dotenv

load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from etl_lib import et_now

try:
    from .gemini import generate_json, get_gemini_api_key, GeminiError
except ImportError:
    from gemini import generate_json, get_gemini_api_key, GeminiError


# How much of each source goes into the prompt. These are the only real cost
# control: the free tier's 1M TPM is never the binding limit, but a bundle that
# grows without bound makes the summary vaguer, not better.
DAY_LIMITS = {
    'news': 45,
    'market_news': 20,
    'movers': 12,
    'scores': 30,
    'schedule': 25,
}
WEEK_LIMITS = {
    'news': 90,
    'market_news': 30,
    'movers': 15,
    'scores': 60,
}

# Wall-clock ceiling for the whole domain. It runs sequentially after the
# parallel block, so every second here lands directly on the run duration that
# CLAUDE.md caps at 60s. The daily briefing is generated first and the weekly
# one is skipped if the budget is already spent — a fresh daily card matters
# more than a same-day weekly refresh, and the weekly gate retries tomorrow.
SUMMARY_BUDGET_S = 30

# The card's own vocabulary. Kept as slugs so the frontend owns the display
# labels, and constrained by the response schema so a stray value can't reach
# the renderer.
DOMAINS = ['us_news', 'world_news', 'sports', 'markets', 'media']

SYSTEM_INSTRUCTION = (
    "You write a terse daily briefing for one reader's personal news dashboard. "
    "You are given a CONTEXT bundle of rows from that dashboard's own database. "
    "Rules, in order of importance:\n"
    "1. Every claim must be supported by the CONTEXT. Never introduce an event, "
    "figure, fixture, name, or date that does not appear in it.\n"
    "2. For anything forward-looking, use only the SCHEDULED_TODAY and "
    "UPCOMING_HOLIDAYS sections, or an explicit unresolved thread in a story "
    "that is in the CONTEXT. If the context supports nothing forward-looking "
    "for a domain, return fewer items — do not speculate to fill the list.\n"
    "3. Be specific and quantitative: scores, percentages, names. Never write "
    "filler like 'markets moved' or 'several games were played'.\n"
    "4. No preamble, no sign-off, no hedging phrases, no emoji. Each detail is "
    "one sentence, at most about 25 words."
)

_ITEM_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'domain': {'type': 'STRING', 'enum': DOMAINS},
        'title': {'type': 'STRING'},
        'detail': {'type': 'STRING'},
    },
    'required': ['domain', 'title', 'detail'],
}

DAY_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'headline': {'type': 'STRING'},
        'yesterday': {'type': 'ARRAY', 'items': _ITEM_SCHEMA},
        'today': {'type': 'ARRAY', 'items': _ITEM_SCHEMA},
    },
    'required': ['headline', 'yesterday', 'today'],
}

WEEK_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'headline': {'type': 'STRING'},
        'sections': {
            'type': 'ARRAY',
            'items': {
                'type': 'OBJECT',
                'properties': {
                    'domain': {'type': 'STRING', 'enum': DOMAINS},
                    'bullets': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
                },
                'required': ['domain', 'bullets'],
            },
        },
    },
    'required': ['headline', 'sections'],
}


def get_supabase_client() -> Client:
    """Create and return a Supabase client scoped to info_agg."""
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    if ClientOptions is not None:
        return create_client(supabase_url, supabase_key, options=ClientOptions(schema='info_agg'))
    return create_client(supabase_url, supabase_key)


def _record(key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'kind': 'summary',
        'key': key,
        'payload': payload,
        'fetched_at': datetime.now(timezone.utc).isoformat(),
    }


def _trim(text: Optional[str], limit: int = 240) -> Optional[str]:
    """Abstracts run long and add little past the first sentence or two."""
    if not text:
        return None
    text = ' '.join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '…'


# ── Context assembly ─────────────────────────────────────────────────────────
#
# Each block is independently wrapped: the briefing is worth generating from
# four sources out of five, and one failed query must not cost the card.

def _safe(label: str, fn, errors: List[str], default):
    try:
        return fn()
    except Exception as e:
        errors.append(f'Could not read {label} for the summary: {e}')
        return default


def _news_rows(supabase: Client, since: datetime, limit: int) -> List[Dict[str, Any]]:
    res = (
        supabase.table('news_articles')
        .select('section, title, abstract, source, published_at')
        .gte('published_at', since.isoformat())
        .order('published_at', desc=True)
        .limit(limit)
        .execute()
    )
    return [
        {
            'section': r.get('section'),
            'title': r.get('title'),
            'abstract': _trim(r.get('abstract')),
        }
        for r in (res.data or [])
    ]


def _market_news_rows(supabase: Client, since: datetime, limit: int) -> List[Dict[str, Any]]:
    res = (
        supabase.table('market_news')
        .select('category, headline, summary, published_at')
        .gte('published_at', since.isoformat())
        .order('published_at', desc=True)
        .limit(limit)
        .execute()
    )
    return [
        {
            'category': r.get('category'),
            'headline': r.get('headline'),
            'summary': _trim(r.get('summary'), 180),
        }
        for r in (res.data or [])
    ]


def _mover_rows(supabase: Client, limit: int) -> List[Dict[str, Any]]:
    """Biggest absolute movers among the watchlist tickers.

    The model is bad at picking the interesting ones out of 60 near-flat
    quotes, and good at explaining the six that actually moved — so the
    ranking happens here, in code, and only the tail goes into the prompt.
    """
    res = (
        supabase.table('stocks')
        .select('ticker, name, asset_type, stock_quotes(current_price, percent_change, quote_timestamp)')
        .eq('is_core', True)
        .eq('is_active', True)
        .execute()
    )
    movers: List[Dict[str, Any]] = []
    for row in res.data or []:
        quotes = row.get('stock_quotes') or []
        if not quotes:
            continue
        latest = max(quotes, key=lambda q: str(q.get('quote_timestamp') or ''))
        pct = latest.get('percent_change')
        if pct is None:
            continue
        movers.append({
            'ticker': row.get('ticker'),
            'name': row.get('name'),
            'type': row.get('asset_type'),
            'price': latest.get('current_price'),
            'percent_change': round(float(pct), 2),
        })
    movers.sort(key=lambda m: abs(m['percent_change']), reverse=True)
    return movers[:limit]


def _score_rows(
    supabase: Client, start: datetime, end: datetime, limit: int, finished: bool
) -> List[Dict[str, Any]]:
    res = (
        supabase.table('sports_scores')
        .select('home_team, away_team, home_score, away_score, status, status_detail, '
                'game_date, broadcast, leagues(league)')
        .gte('game_date', start.isoformat())
        .lte('game_date', end.isoformat())
        .order('game_date', desc=True)
        .limit(limit * 3)
        .execute()
    )
    out: List[Dict[str, Any]] = []
    for r in res.data or []:
        status = (r.get('status') or '').lower()
        is_final = status in ('final', 'post', 'status_final') or 'final' in status
        if is_final != finished:
            continue
        league = ((r.get('leagues') or {}) or {}).get('league')
        if finished:
            out.append({
                'league': league,
                'game': f"{r.get('away_team')} {r.get('away_score')} — "
                        f"{r.get('home_team')} {r.get('home_score')}",
                'detail': r.get('status_detail'),
            })
        else:
            out.append({
                'league': league,
                'game': f"{r.get('away_team')} at {r.get('home_team')}",
                'starts': r.get('game_date'),
                'broadcast': r.get('broadcast'),
            })
        if len(out) >= limit:
            break
    return out


def _upcoming_holidays(supabase: Client, limit: int = 4) -> List[Dict[str, Any]]:
    res = (
        supabase.table('misc_content')
        .select('payload')
        .eq('kind', 'holiday')
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return []
    holidays = ((rows[0].get('payload') or {}).get('holidays') or [])[:limit]
    return [{'name': h.get('name'), 'date': h.get('date')} for h in holidays]


def _build_context(
    supabase: Client, since: datetime, now: datetime, limits: Dict[str, int],
    include_lookahead: bool, errors: List[str],
) -> Dict[str, Any]:
    """Assemble the CONTEXT bundle the prompt is grounded on."""
    ctx: Dict[str, Any] = {
        'NEWS': _safe('news_articles', lambda: _news_rows(supabase, since, limits['news']), errors, []),
        'MARKET_NEWS': _safe(
            'market_news', lambda: _market_news_rows(supabase, since, limits['market_news']), errors, []
        ),
        'BIGGEST_MOVERS': _safe('stock_quotes', lambda: _mover_rows(supabase, limits['movers']), errors, []),
        'COMPLETED_GAMES': _safe(
            'sports_scores', lambda: _score_rows(supabase, since, now, limits['scores'], finished=True),
            errors, [],
        ),
    }
    if include_lookahead:
        # The only genuinely forward-looking rows the database holds.
        ctx['SCHEDULED_TODAY'] = _safe(
            'sports_scores (scheduled)',
            lambda: _score_rows(
                supabase, now, now + timedelta(hours=30), limits['schedule'], finished=False
            ),
            errors, [],
        )
        ctx['UPCOMING_HOLIDAYS'] = _safe('misc_content', lambda: _upcoming_holidays(supabase), errors, [])
    return ctx


def _context_counts(ctx: Dict[str, Any]) -> Dict[str, int]:
    return {k: len(v) for k, v in ctx.items() if isinstance(v, list)}


def _has_material(ctx: Dict[str, Any]) -> bool:
    """A briefing built from nothing is worse than yesterday's briefing."""
    return any(ctx.get(k) for k in ('NEWS', 'MARKET_NEWS', 'COMPLETED_GAMES'))


# ── Freshness gates ──────────────────────────────────────────────────────────

def _stored(supabase: Client, key: str) -> Optional[Dict[str, Any]]:
    try:
        res = (
            supabase.table('misc_content')
            .select('payload, fetched_at')
            .eq('kind', 'summary')
            .eq('key', key)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def _fetched_at(row: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not row or not row.get('fetched_at'):
        return None
    try:
        return datetime.fromisoformat(str(row['fetched_at']).replace('Z', '+00:00'))
    except ValueError:
        return None


def _day_is_current(row: Optional[Dict[str, Any]], now_et: datetime) -> bool:
    """True when today's briefing already exists, in the reader's own day.

    Deliberately Eastern, not UTC: the card is read at 7am ET and a UTC day
    boundary would let a 20:00 ET run overwrite the morning's briefing with
    one built from the same rows.
    """
    fetched = _fetched_at(row)
    return fetched is not None and fetched.astimezone(now_et.tzinfo).date() == now_et.date()


def _week_is_current(row: Optional[Dict[str, Any]], now_et: datetime) -> bool:
    """True when this ISO week's briefing already exists.

    Gating on the ISO week rather than "is it Monday" means a Monday the run
    failed on retries every day until it succeeds, instead of leaving a
    week-old card up until the following Monday.
    """
    fetched = _fetched_at(row)
    if fetched is None:
        return False
    return fetched.astimezone(now_et.tzinfo).isocalendar()[:2] == now_et.isocalendar()[:2]


# ── Generation ───────────────────────────────────────────────────────────────

def _generate(prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    return generate_json(prompt=prompt, schema=schema, system_instruction=SYSTEM_INSTRUCTION)


def _day_prompt(ctx: Dict[str, Any], now_et: datetime) -> str:
    yesterday = (now_et - timedelta(days=1)).strftime('%A %d %B %Y')
    today = now_et.strftime('%A %d %B %Y')
    return (
        f"Today is {today}. The previous day was {yesterday}.\n\n"
        f"CONTEXT:\n{json.dumps(ctx, default=str)}\n\n"
        "Write the daily briefing.\n"
        "- `headline`: at most 12 words, the single most consequential thing in the CONTEXT.\n"
        "- `yesterday`: 4 to 6 items covering what actually happened, spread across the "
        "domains the CONTEXT has material for.\n"
        "- `today`: 3 to 5 things to watch, each traceable to SCHEDULED_TODAY, "
        "UPCOMING_HOLIDAYS, or an unresolved thread in a story above. Return fewer "
        "items rather than inventing any."
    )


def _week_prompt(ctx: Dict[str, Any], now_et: datetime, since: datetime) -> str:
    return (
        f"The week runs from {since.strftime('%d %B %Y')} to {now_et.strftime('%d %B %Y')}.\n\n"
        f"CONTEXT:\n{json.dumps(ctx, default=str)}\n\n"
        "Write the weekly review.\n"
        "- `headline`: at most 12 words for the week as a whole.\n"
        "- `sections`: one entry per domain the CONTEXT has real material for, each "
        "with 2 to 4 bullets. Omit a domain entirely rather than padding it. Bullets "
        "are single sentences naming specific events, figures, or results."
    )


def sync_summaries(supabase: Client) -> Dict[str, Any]:
    """Generate and store the day and week briefings.

    Both are gated on freshness, so a re-dispatched daily run (the /dashboard
    button fires the same workflow) costs no extra generation. Any failure
    leaves the previously stored row untouched — the card keeps serving the
    last good briefing with its own timestamp rather than emptying.
    """
    stats: Dict[str, Any] = {
        'day_generated': 0,
        'week_generated': 0,
        'model': None,
        'errors': [],
        'notes': [],
    }

    if not get_gemini_api_key():
        stats['notes'].append('GEMINI_API_KEY not set — AI summaries skipped')
        return stats

    now_et = et_now()
    records: List[Dict[str, Any]] = []

    # ── Summary of the Day ───────────────────────────────────
    day_row = _stored(supabase, 'day')
    if _day_is_current(day_row, now_et):
        stats['notes'].append("Daily summary already written today — kept it")
    else:
        # 30 rather than 24 hours: the daily run fires in the morning, and a
        # 24h window clips the previous evening's games and late filings.
        since = now_et - timedelta(hours=30)
        errors: List[str] = []
        ctx = _build_context(supabase, since, now_et, DAY_LIMITS, True, errors)
        stats['errors'].extend(errors)
        if not _has_material(ctx):
            stats['notes'].append('No fresh rows to summarise — daily summary skipped')
        else:
            try:
                out = _generate(_day_prompt(ctx, now_et), DAY_SCHEMA)
                stats['model'] = out.get('_model')
                records.append(_record('day', {
                    'kind': 'day',
                    'headline': out.get('headline'),
                    'yesterday': out.get('yesterday') or [],
                    'today': out.get('today') or [],
                    'model': out.get('_model'),
                    'generated_at': now_et.isoformat(),
                    'covers': {'from': since.isoformat(), 'to': now_et.isoformat()},
                    'grounded_on': _context_counts(ctx),
                }))
                stats['day_generated'] = 1
            except GeminiError as e:
                stats['errors'].append(f'Daily summary generation failed: {e}')

    # ── Summary of the Week ──────────────────────────────────
    week_row = _stored(supabase, 'week')
    spent = (et_now() - now_et).total_seconds()
    if spent > SUMMARY_BUDGET_S:
        stats['notes'].append(
            f'Weekly summary deferred — {spent:.0f}s of the {SUMMARY_BUDGET_S}s '
            'budget already spent'
        )
    elif _week_is_current(week_row, now_et):
        stats['notes'].append("Weekly summary already written this week — kept it")
    else:
        since = now_et - timedelta(days=7)
        errors = []
        ctx = _build_context(supabase, since, now_et, WEEK_LIMITS, False, errors)
        stats['errors'].extend(errors)
        if not _has_material(ctx):
            stats['notes'].append('No fresh rows to summarise — weekly summary skipped')
        else:
            try:
                out = _generate(_week_prompt(ctx, now_et, since), WEEK_SCHEMA)
                stats['model'] = out.get('_model')
                records.append(_record('week', {
                    'kind': 'week',
                    'headline': out.get('headline'),
                    'sections': out.get('sections') or [],
                    'model': out.get('_model'),
                    'generated_at': now_et.isoformat(),
                    'covers': {'from': since.isoformat(), 'to': now_et.isoformat()},
                    'grounded_on': _context_counts(ctx),
                }))
                stats['week_generated'] = 1
            except GeminiError as e:
                stats['errors'].append(f'Weekly summary generation failed: {e}')

    if records:
        try:
            supabase.table('misc_content').upsert(records, on_conflict='kind,key').execute()
        except Exception as e:
            stats['errors'].append(f'Could not store summaries: {e}')
            stats['day_generated'] = stats['week_generated'] = 0

    return stats


if __name__ == "__main__":
    print("=" * 60)
    print("Generating AI summaries...")
    print("=" * 60)

    client = get_supabase_client()
    result = sync_summaries(client)
    for k, v in result.items():
        print(f"  {k}: {v}")
