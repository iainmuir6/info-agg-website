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
import argparse
import json
import os
import re
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
    "one sentence, at most about 25 words.\n"
    "5. Every item and every bullet lists in `cites` the `id`s of the CONTEXT rows "
    "that support it, 1 to 3, most direct first. Only use ids that appear in the "
    "CONTEXT. A forward-looking item grounded only in a holiday or a general thread "
    "may have an empty list. Never write ids, brackets or citations in the text "
    "itself, and never in the headline."
)

# Source numbers the model attaches to an item. Constrained by the schema so the
# model returns them as data rather than as "[3]" inside the prose, which small
# models do unreliably; _resolve_citations validates and renumbers them.
_CITES_SCHEMA = {'type': 'ARRAY', 'items': {'type': 'INTEGER'}}

_ITEM_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'domain': {'type': 'STRING', 'enum': DOMAINS},
        'title': {'type': 'STRING'},
        'detail': {'type': 'STRING'},
        'cites': _CITES_SCHEMA,
    },
    'required': ['domain', 'title', 'detail', 'cites'],
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
                    'bullets': {
                        'type': 'ARRAY',
                        'items': {
                            'type': 'OBJECT',
                            'properties': {
                                'text': {'type': 'STRING'},
                                'cites': _CITES_SCHEMA,
                            },
                            'required': ['text', 'cites'],
                        },
                    },
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
    # Some Finnhub summaries arrive as HTML link lists; tags carry URLs the
    # model must never see (it may only cite by id).
    text = ' '.join(re.sub(r'<[^>]+>', ' ', str(text)).split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '…'


# ── Sources and citations ───────────────────────────────────────────────────
#
# Every citable CONTEXT row carries a sequential integer `id`. The model sees
# only that number; the URL stays here, in the registry, so the model cannot
# invent or mangle a link. After generation _resolve_citations keeps the ids
# that exist, renumbers them 1..k by first appearance, and stores the cited
# rows as the payload's `sources`. Holidays have no source page, so they carry
# no id and are uncitable.

NEWS_OUTLETS = {'nyt': 'NYT', 'newsapi': 'NewsAPI'}

# Display labels for a game source's title, mirroring LEAGUES in lib/leagues.ts.
LEAGUE_LABELS = {
    'nfl': 'NFL', 'nba': 'NBA', 'wnba': 'WNBA', 'mlb': 'MLB', 'nhl': 'NHL',
    'college-football': 'NCAAF', 'mens-college-basketball': 'NCAAB',
    'womens-college-basketball': 'NCAAW', 'college-baseball': 'NCAA Baseball',
    'eng.1': 'Premier League',
}

MAX_CITES_PER_ITEM = 3

# "[3]", "[1, 2]", "[#4]" — stripped from text in case the model ignores rule 5.
_STRAY_CITE_RE = re.compile(r'\s*\[#?\d+(?:\s*,\s*#?\d+)*\]')


class SourceRegistry:
    """id -> {title, url, kind, outlet} for every citable row in one bundle."""

    def __init__(self) -> None:
        self._rows: Dict[int, Dict[str, str]] = {}

    def add(self, kind: str, title: Optional[str], url: Optional[str],
            outlet: Optional[str]) -> Optional[int]:
        """Register a row and return its id, or None when it has no link."""
        if not url or not title:
            return None
        n = len(self._rows) + 1
        self._rows[n] = {
            'title': str(title),
            'url': str(url),
            'kind': kind,
            'outlet': str(outlet or ''),
        }
        return n

    def get(self, n: int) -> Optional[Dict[str, str]]:
        return self._rows.get(n)

    def __len__(self) -> int:
        return len(self._rows)

    def as_dict(self) -> Dict[int, Dict[str, str]]:
        return dict(self._rows)


def espn_game_url(league: Optional[str], event_id: Optional[str]) -> Optional[str]:
    """ESPN gamecast URL, the same one the score rows link to.

    Mirrors espnGameUrl in lib/leagues.ts: leagues.league already stores ESPN's
    path segment, and soccer leagues (dotted slugs like eng.1) use /soccer/match/.
    """
    if not league or not event_id:
        return None
    if '.' in league:
        return f'https://www.espn.com/soccer/match/_/gameId/{event_id}'
    return f'https://www.espn.com/{league}/game/_/gameId/{event_id}'


def _with_id(row: Dict[str, Any], n: Optional[int]) -> Dict[str, Any]:
    """Put the id first so it reads as the row's label in the prompt."""
    return {'id': n, **row} if n is not None else row


def _strip_cites(text: Any) -> str:
    return _STRAY_CITE_RE.sub('', str(text or '')).strip()


def _cite_ints(raw: Any) -> List[int]:
    """Integers from the model's cites list, in order, without duplicates."""
    out: List[int] = []
    if not isinstance(raw, list):
        return out
    for v in raw:
        if isinstance(v, bool):
            continue
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, str) and v.strip().lstrip('#').isdigit():
            v = int(v.strip().lstrip('#'))
        if isinstance(v, int) and v not in out:
            out.append(v)
    return out


def _resolve_citations(
    kind: str, out: Dict[str, Any], registry: SourceRegistry
) -> Dict[str, Any]:
    """Validate the model's cites and build the stored `sources` list.

    Pure: takes the raw model output for a day ('yesterday'/'today' items) or
    week ('sections' with bullets) briefing and returns the cleaned fields plus
    `sources` and cite counts. Unknown ids are dropped, each item keeps at most
    MAX_CITES_PER_ITEM, surviving ids are renumbered 1..k in order of first
    appearance, and stray "[n]" the model wrote into the text are removed. The
    headline is stripped too: it is the push notification body.
    """
    renumber: Dict[int, int] = {}
    sources: List[Dict[str, Any]] = []
    cited = uncited = 0

    def resolve(raw: Any) -> List[int]:
        nonlocal cited, uncited
        kept: List[int] = []
        for orig in _cite_ints(raw):
            if registry.get(orig) is None:
                continue
            if orig not in renumber:
                renumber[orig] = len(renumber) + 1
                sources.append({'n': renumber[orig], **registry.get(orig)})
            kept.append(renumber[orig])
            if len(kept) >= MAX_CITES_PER_ITEM:
                break
        if kept:
            cited += 1
        else:
            uncited += 1
        return kept

    def items(raw_items: Any) -> List[Dict[str, Any]]:
        res: List[Dict[str, Any]] = []
        for it in raw_items if isinstance(raw_items, list) else []:
            if not isinstance(it, dict):
                continue
            res.append({
                'domain': it.get('domain'),
                'title': _strip_cites(it.get('title')),
                'detail': _strip_cites(it.get('detail')),
                'cites': resolve(it.get('cites')),
            })
        return res

    result: Dict[str, Any] = {'headline': _strip_cites(out.get('headline')) or None}
    if kind == 'day':
        result['yesterday'] = items(out.get('yesterday'))
        result['today'] = items(out.get('today'))
    else:
        sections: List[Dict[str, Any]] = []
        for sec in out.get('sections') or []:
            if not isinstance(sec, dict):
                continue
            bullets: List[Dict[str, Any]] = []
            for b in sec.get('bullets') or []:
                if isinstance(b, str):
                    b = {'text': b, 'cites': []}
                if not isinstance(b, dict):
                    continue
                text = _strip_cites(b.get('text'))
                if not text:
                    continue
                bullets.append({'text': text, 'cites': resolve(b.get('cites'))})
            sections.append({'domain': sec.get('domain'), 'bullets': bullets})
        result['sections'] = sections
    result['sources'] = sources
    result['cite_counts'] = {'cited': cited, 'uncited': uncited}
    return result


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


def _news_rows(
    supabase: Client, since: datetime, limit: int, registry: SourceRegistry
) -> List[Dict[str, Any]]:
    res = (
        supabase.table('news_articles')
        .select('section, title, abstract, source, url, published_at')
        .gte('published_at', since.isoformat())
        .order('published_at', desc=True)
        .limit(limit)
        .execute()
    )
    out: List[Dict[str, Any]] = []
    for r in res.data or []:
        source = r.get('source') or ''
        n = registry.add('article', r.get('title'), r.get('url'),
                         NEWS_OUTLETS.get(source.lower(), source))
        out.append(_with_id({
            'section': r.get('section'),
            'title': r.get('title'),
            'abstract': _trim(r.get('abstract')),
        }, n))
    return out


def _market_news_rows(
    supabase: Client, since: datetime, limit: int, registry: SourceRegistry
) -> List[Dict[str, Any]]:
    res = (
        supabase.table('market_news')
        .select('category, headline, summary, source, url, published_at')
        .gte('published_at', since.isoformat())
        .order('published_at', desc=True)
        .limit(limit)
        .execute()
    )
    out: List[Dict[str, Any]] = []
    for r in res.data or []:
        n = registry.add('market', r.get('headline'), r.get('url'), r.get('source'))
        out.append(_with_id({
            'category': r.get('category'),
            'headline': r.get('headline'),
            'summary': _trim(r.get('summary'), 180),
        }, n))
    return out


def _mover_rows(supabase: Client, limit: int, registry: SourceRegistry) -> List[Dict[str, Any]]:
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
    # Registered after the ranking so only the rows the prompt carries get ids.
    # A mover links to the site's own ticker page, not an outside quote.
    out: List[Dict[str, Any]] = []
    for m in movers[:limit]:
        ticker = m.get('ticker')
        pct = m['percent_change']
        n = registry.add(
            'quote', f"{ticker} {'+' if pct >= 0 else ''}{pct:.2f}%",
            f'/markets/{ticker}' if ticker else None, 'Markets',
        )
        out.append(_with_id(m, n))
    return out


def _score_rows(
    supabase: Client, start: datetime, end: datetime, limit: int, finished: bool,
    registry: SourceRegistry,
) -> List[Dict[str, Any]]:
    res = (
        supabase.table('sports_scores')
        .select('event_id, home_team, away_team, home_score, away_score, status, '
                'status_detail, game_date, broadcast, leagues(league)')
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
        url = espn_game_url(league, r.get('event_id'))
        label = LEAGUE_LABELS.get(league or '', (league or '').upper())
        if finished:
            game = (f"{r.get('away_team')} {r.get('away_score')} — "
                    f"{r.get('home_team')} {r.get('home_score')}")
            n = registry.add('game', f'{game} · {label}' if label else game, url, 'ESPN')
            out.append(_with_id({
                'league': league,
                'game': game,
                'detail': r.get('status_detail'),
            }, n))
        else:
            game = f"{r.get('away_team')} at {r.get('home_team')}"
            n = registry.add('game', f'{game} · {label}' if label else game, url, 'ESPN')
            out.append(_with_id({
                'league': league,
                'game': game,
                'starts': r.get('game_date'),
                'broadcast': r.get('broadcast'),
            }, n))
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
    include_lookahead: bool, errors: List[str], registry: SourceRegistry,
) -> Dict[str, Any]:
    """Assemble the CONTEXT bundle the prompt is grounded on.

    Fills `registry` as it goes: every citable row gets an `id` in the bundle,
    and the registry keeps that id's link out of the prompt.
    """
    ctx: Dict[str, Any] = {
        'NEWS': _safe(
            'news_articles', lambda: _news_rows(supabase, since, limits['news'], registry), errors, []
        ),
        'MARKET_NEWS': _safe(
            'market_news',
            lambda: _market_news_rows(supabase, since, limits['market_news'], registry),
            errors, [],
        ),
        'BIGGEST_MOVERS': _safe(
            'stock_quotes', lambda: _mover_rows(supabase, limits['movers'], registry), errors, []
        ),
        'COMPLETED_GAMES': _safe(
            'sports_scores',
            lambda: _score_rows(supabase, since, now, limits['scores'], True, registry),
            errors, [],
        ),
    }
    if include_lookahead:
        # The only genuinely forward-looking rows the database holds.
        ctx['SCHEDULED_TODAY'] = _safe(
            'sports_scores (scheduled)',
            lambda: _score_rows(
                supabase, now, now + timedelta(hours=30), limits['schedule'], False, registry
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
        "- `headline`: at most 12 words, the single most consequential thing in the CONTEXT. "
        "No citations in it.\n"
        "- `yesterday`: 4 to 6 items covering what actually happened, spread across the "
        "domains the CONTEXT has material for.\n"
        "- `today`: 3 to 5 things to watch, each traceable to SCHEDULED_TODAY, "
        "UPCOMING_HOLIDAYS, or an unresolved thread in a story above. Return fewer "
        "items rather than inventing any.\n"
        "- `cites` on every item: the `id`s of the CONTEXT rows behind it (1 to 3)."
    )


def _week_prompt(ctx: Dict[str, Any], now_et: datetime, since: datetime) -> str:
    return (
        f"The week runs from {since.strftime('%d %B %Y')} to {now_et.strftime('%d %B %Y')}.\n\n"
        f"CONTEXT:\n{json.dumps(ctx, default=str)}\n\n"
        "Write the weekly review.\n"
        "- `headline`: at most 12 words for the week as a whole.\n"
        "- `sections`: one entry per domain the CONTEXT has real material for, each "
        "with 2 to 4 bullets. Omit a domain entirely rather than padding it. Bullets "
        "are single sentences naming specific events, figures, or results, each an "
        "object with `text` and `cites` (the `id`s of the CONTEXT rows behind it, 1 to 3). "
        "No citations in the headline."
    )


def _prepare(supabase: Client, kind: str, now_et: datetime) -> Dict[str, Any]:
    """Build one briefing's CONTEXT, registry and prompt. Reads only.

    Shared by the real run and --dry-run, so the dry run shows exactly the
    bundle and numbering the model would get.
    """
    errors: List[str] = []
    registry = SourceRegistry()
    if kind == 'day':
        # 30 rather than 24 hours: the daily run fires in the morning, and a
        # 24h window clips the previous evening's games and late filings.
        since = now_et - timedelta(hours=30)
        ctx = _build_context(supabase, since, now_et, DAY_LIMITS, True, errors, registry)
        prompt = _day_prompt(ctx, now_et)
        schema = DAY_SCHEMA
    else:
        since = now_et - timedelta(days=7)
        ctx = _build_context(supabase, since, now_et, WEEK_LIMITS, False, errors, registry)
        prompt = _week_prompt(ctx, now_et, since)
        schema = WEEK_SCHEMA
    return {'ctx': ctx, 'registry': registry, 'since': since, 'errors': errors,
            'prompt': prompt, 'schema': schema}


def _payload(kind: str, out: Dict[str, Any], prep: Dict[str, Any], now_et: datetime) -> Dict[str, Any]:
    resolved = _resolve_citations(kind, out, prep['registry'])
    grounded_on = _context_counts(prep['ctx'])
    grounded_on['citable'] = len(prep['registry'])
    grounded_on.update(resolved.pop('cite_counts'))
    return {
        'kind': kind,
        **resolved,
        'model': out.get('_model'),
        'generated_at': now_et.isoformat(),
        'covers': {'from': prep['since'].isoformat(), 'to': now_et.isoformat()},
        'grounded_on': grounded_on,
    }


def sync_summaries(supabase: Client, force: bool = False) -> Dict[str, Any]:
    """Generate and store the day and week briefings.

    Both are gated on freshness, so a re-dispatched daily run (the /dashboard
    button fires the same workflow) costs no extra generation. `force` skips
    both gates (run_etl.py --force-summary); every write fires the briefing
    push trigger in 13_notifications.sql, so it is opt-in. Any failure leaves
    the previously stored row untouched — the card keeps serving the last good
    briefing with its own timestamp rather than emptying.
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
    day_row = None if force else _stored(supabase, 'day')
    if not force and _day_is_current(day_row, now_et):
        stats['notes'].append("Daily summary already written today — kept it")
    else:
        prep = _prepare(supabase, 'day', now_et)
        stats['errors'].extend(prep['errors'])
        if not _has_material(prep['ctx']):
            stats['notes'].append('No fresh rows to summarise — daily summary skipped')
        else:
            try:
                out = _generate(prep['prompt'], prep['schema'])
                stats['model'] = out.get('_model')
                payload = _payload('day', out, prep, now_et)
                records.append(_record('day', payload))
                stats['day_generated'] = 1
                stats['day_cites'] = {k: payload['grounded_on'][k] for k in ('cited', 'uncited')}
            except GeminiError as e:
                stats['errors'].append(f'Daily summary generation failed: {e}')

    # ── Summary of the Week ──────────────────────────────────
    week_row = None if force else _stored(supabase, 'week')
    spent = (et_now() - now_et).total_seconds()
    if spent > SUMMARY_BUDGET_S:
        stats['notes'].append(
            f'Weekly summary deferred — {spent:.0f}s of the {SUMMARY_BUDGET_S}s '
            'budget already spent'
        )
    elif not force and _week_is_current(week_row, now_et):
        stats['notes'].append("Weekly summary already written this week — kept it")
    else:
        prep = _prepare(supabase, 'week', now_et)
        stats['errors'].extend(prep['errors'])
        if not _has_material(prep['ctx']):
            stats['notes'].append('No fresh rows to summarise — weekly summary skipped')
        else:
            try:
                out = _generate(prep['prompt'], prep['schema'])
                stats['model'] = out.get('_model')
                payload = _payload('week', out, prep, now_et)
                records.append(_record('week', payload))
                stats['week_generated'] = 1
                stats['week_cites'] = {k: payload['grounded_on'][k] for k in ('cited', 'uncited')}
            except GeminiError as e:
                stats['errors'].append(f'Weekly summary generation failed: {e}')

    if records:
        try:
            supabase.table('misc_content').upsert(records, on_conflict='kind,key').execute()
        except Exception as e:
            stats['errors'].append(f'Could not store summaries: {e}')
            stats['day_generated'] = stats['week_generated'] = 0

    return stats


def dry_run(supabase: Client, kinds: List[str]) -> None:
    """Print the numbered CONTEXT, the source map and the response schema.

    Reads the database and nothing else: no Gemini call, no write, no push.
    """
    now_et = et_now()
    for kind in kinds:
        prep = _prepare(supabase, kind, now_et)
        print('=' * 60)
        print(f'{kind.upper()} — {len(prep["registry"])} citable rows '
              f'(counts {_context_counts(prep["ctx"])})')
        for e in prep['errors']:
            print(f'  error: {e}')
        print('=' * 60)
        print('SYSTEM INSTRUCTION:\n' + SYSTEM_INSTRUCTION + '\n')
        print('PROMPT (exactly what the model gets; no URLs):\n' + prep['prompt'] + '\n')
        print('SOURCE MAP (kept in Python, never sent):')
        for n, src in prep['registry'].as_dict().items():
            print(f'  {n:>3}  {src["kind"]:<7} {src["outlet"]:<14} {src["title"][:70]}  ->  {src["url"]}')
        print('\nRESPONSE SCHEMA:\n' + json.dumps(prep['schema'], indent=2) + '\n')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='AI briefings (Summary of the Day / Week)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the numbered context, source map and schema. '
                             'No Gemini call, no DB write.')
    parser.add_argument('--kind', choices=['day', 'week', 'both'], default='both',
                        help='Which briefing --dry-run prints (default both)')
    parser.add_argument('--force', action='store_true',
                        help='Regenerate even when today\'s/this week\'s briefing exists '
                             '(writes the DB and fires the briefing push)')
    cli = parser.parse_args()

    client = get_supabase_client()
    if cli.dry_run:
        dry_run(client, ['day', 'week'] if cli.kind == 'both' else [cli.kind])
        sys.exit(0)

    print("=" * 60)
    print("Generating AI summaries...")
    print("=" * 60)
    result = sync_summaries(client, force=cli.force)
    for k, v in result.items():
        print(f"  {k}: {v}")
