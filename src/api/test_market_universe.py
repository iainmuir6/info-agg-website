"""Offline check of the baskets + tracked_stocks merge. No network, no DB writes.

    source _agg_venv/bin/activate && python -m unittest src/api/test_market_universe.py
    python src/api/test_market_universe.py        # same thing

Covers run_etl.merge_universe (pure) and run_etl.market_universe against a
fake Supabase client: tracked tickers are appended after the baskets, basket
classification wins, the cap holds, untrackable asset types are skipped, and a
failed or missing tracked_stocks read falls back to baskets only.
"""
import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

import run_etl  # noqa: E402
import run_quick_refresh  # noqa: E402,F401  (import check: it must use market_universe)

BASKETS = {
    'core_market': ['SPY', 'QQQ'],
    'core_stocks': ['AAPL', 'SPCX'],
    'crypto': ['BTC'],
    'forex': ['EURUSD'],
}


class _FakeQuery:
    def __init__(self, rows=None, exc=None):
        self._rows, self._exc = rows or [], exc
        self.calls = []

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self
        return chain

    def execute(self):
        if self._exc:
            raise self._exc
        return mock.Mock(data=self._rows)


class _FakeSupabase:
    """Read-only stand-in: any write method raises, so the test can't write."""

    def __init__(self, rows=None, exc=None):
        self.query = _FakeQuery(rows, exc)
        self.tables = []

    def table(self, name):
        self.tables.append(name)
        for write in ('insert', 'upsert', 'update', 'delete'):
            setattr(self.query, write, mock.Mock(side_effect=AssertionError(f'{write} called')))
        return self.query


def _tracked_rows(*pairs):
    return [{'added_at': f'2026-11-{i + 1:02d}', 'stocks': {'ticker': t, 'asset_type': at}}
            for i, (t, at) in enumerate(pairs)]


class MergeUniverseTest(unittest.TestCase):
    def test_baskets_only(self):
        tickers, types = run_etl.merge_universe(BASKETS, {})
        self.assertEqual(tickers, ['SPY', 'QQQ', 'AAPL', 'SPCX', 'BTC', 'EURUSD'])
        self.assertEqual(types['SPY'], 'etf')
        self.assertEqual(types['BTC'], 'crypto')

    def test_tracked_appended_after_baskets(self):
        tickers, types = run_etl.merge_universe(BASKETS, {'ANT': 'stock', 'VTI': 'etf'})
        self.assertEqual(tickers[-2:], ['ANT', 'VTI'])
        self.assertEqual(types['ANT'], 'stock')
        self.assertEqual(types['VTI'], 'etf')

    def test_basket_classification_wins(self):
        tickers, types = run_etl.merge_universe(BASKETS, {'SPY': 'stock'})
        self.assertEqual(tickers.count('SPY'), 1)
        self.assertEqual(types['SPY'], 'etf')

    def test_untrackable_types_skipped(self):
        tickers, _ = run_etl.merge_universe(BASKETS, {'DOGE': 'crypto', 'GBPUSD': 'forex'})
        self.assertNotIn('DOGE', tickers)
        self.assertNotIn('GBPUSD', tickers)

    def test_cap(self):
        tracked = {f'T{i:02d}': 'stock' for i in range(run_etl.TRACKED_STOCKS_CAP + 5)}
        tickers, _ = run_etl.merge_universe(BASKETS, tracked)
        self.assertEqual(len(tickers), 6 + run_etl.TRACKED_STOCKS_CAP)


class MarketUniverseTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(run_etl, 'load_baskets', return_value=BASKETS)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_reads_tracked(self):
        sb = _FakeSupabase(_tracked_rows(('ANT', 'stock'), ('spcx', 'stock')))
        errors = []
        tickers, types = run_etl.market_universe(sb, errors)
        self.assertEqual(sb.tables, ['tracked_stocks'])
        self.assertIn(('limit', (run_etl.TRACKED_STOCKS_CAP,), {}), sb.query.calls)
        self.assertEqual(tickers[-1], 'ANT')
        self.assertEqual(tickers.count('SPCX'), 1)
        self.assertEqual(errors, [])

    def test_missing_table_is_silent(self):
        exc = Exception("{'code': 'PGRST205', 'message': \"Could not find the table 'info_agg.tracked_stocks'\"}")
        errors = []
        tickers, _ = run_etl.market_universe(_FakeSupabase(exc=exc), errors)
        self.assertEqual(len(tickers), 6)
        self.assertEqual(errors, [])

    def test_failed_read_falls_back_with_error(self):
        errors = []
        tickers, _ = run_etl.market_universe(_FakeSupabase(exc=Exception('timeout')), errors)
        self.assertEqual(len(tickers), 6)
        self.assertEqual(len(errors), 1)


class CapParityTest(unittest.TestCase):
    def test_cap_matches_sql_and_ts(self):
        root = Path(_API_DIR).parent.parent
        sql = (root / 'supabase' / '15_tracked_stocks.sql').read_text()
        ts = (root / 'lib' / 'tracked-stocks-shared.ts').read_text()
        cap = run_etl.TRACKED_STOCKS_CAP
        self.assertRegex(sql, rf'cap CONSTANT integer := {cap};')
        self.assertRegex(ts, rf'TRACKED_STOCKS_CAP = {cap};')

    def test_quick_refresh_uses_shared_helper(self):
        src = (Path(_API_DIR) / 'run_quick_refresh.py').read_text()
        self.assertIn('market_universe(', src)
        self.assertIsNone(re.search(r'\bload_baskets\(', src))


if __name__ == '__main__':
    unittest.main()
