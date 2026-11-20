"""Offline check of the AI briefing citations. No network, no DB, no Gemini.

    source _agg_venv/bin/activate && python -m unittest src/api/test_summary_citations.py
    python src/api/test_summary_citations.py        # same thing

Covers summary_db_helper's SourceRegistry, espn_game_url and _resolve_citations:
unknown ids dropped, renumbering by first appearance, the per-item cap, stray
"[n]" stripped from text and headline, legacy string bullets, and the schema
requiring `cites`.
"""
import os
import sys
import unittest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from summary import summary_db_helper as h  # noqa: E402


def _registry(n: int) -> h.SourceRegistry:
    reg = h.SourceRegistry()
    for i in range(1, n + 1):
        reg.add('article', f'Story {i}', f'https://example.com/{i}', 'NYT')
    return reg


class RegistryTest(unittest.TestCase):
    def test_rows_without_url_get_no_id(self):
        reg = h.SourceRegistry()
        self.assertEqual(reg.add('article', 'A', 'https://a', 'NYT'), 1)
        self.assertIsNone(reg.add('article', 'B', None, 'NYT'))
        self.assertEqual(reg.add('game', 'C', 'https://c', 'ESPN'), 2)
        self.assertEqual(len(reg), 2)

    def test_espn_url_matches_lib_leagues(self):
        self.assertEqual(h.espn_game_url('nba', '401'),
                         'https://www.espn.com/nba/game/_/gameId/401')
        self.assertEqual(h.espn_game_url('eng.1', '7'),
                         'https://www.espn.com/soccer/match/_/gameId/7')
        self.assertIsNone(h.espn_game_url('nba', None))
        self.assertIsNone(h.espn_game_url(None, '1'))


class ResolveDayTest(unittest.TestCase):
    def test_renumbers_by_first_appearance_and_drops_unknown(self):
        out = {
            'headline': 'Big day [2]',
            'yesterday': [
                {'domain': 'us_news', 'title': 'A', 'detail': 'one [5].', 'cites': [5, 99, 2]},
                {'domain': 'sports', 'title': 'B', 'detail': 'two', 'cites': [2, 2, 3]},
            ],
            'today': [
                {'domain': 'sports', 'title': 'C', 'detail': 'three', 'cites': []},
            ],
        }
        r = h._resolve_citations('day', out, _registry(5))
        self.assertEqual(r['headline'], 'Big day')
        self.assertEqual(r['yesterday'][0]['detail'], 'one.')
        self.assertEqual(r['yesterday'][0]['cites'], [1, 2])
        self.assertEqual(r['yesterday'][1]['cites'], [2, 3])
        self.assertEqual(r['today'][0]['cites'], [])
        self.assertEqual([s['n'] for s in r['sources']], [1, 2, 3])
        self.assertEqual([s['url'] for s in r['sources']],
                         ['https://example.com/5', 'https://example.com/2',
                          'https://example.com/3'])
        self.assertEqual(r['cite_counts'], {'cited': 2, 'uncited': 1})

    def test_caps_cites_per_item(self):
        out = {'headline': 'h', 'yesterday': [
            {'domain': 'markets', 'title': 't', 'detail': 'd', 'cites': [1, 2, 3, 4, 5]},
        ], 'today': []}
        r = h._resolve_citations('day', out, _registry(5))
        self.assertEqual(r['yesterday'][0]['cites'], [1, 2, 3])
        self.assertEqual(len(r['sources']), 3)

    def test_tolerates_bad_cite_values(self):
        out = {'headline': 'h', 'yesterday': [
            {'domain': 'markets', 'title': 't', 'detail': 'd', 'cites': ['2', 1.0, True, None, 'x']},
        ], 'today': []}
        r = h._resolve_citations('day', out, _registry(2))
        self.assertEqual(r['yesterday'][0]['cites'], [1, 2])
        self.assertEqual([s['url'] for s in r['sources']],
                         ['https://example.com/2', 'https://example.com/1'])

    def test_missing_cites_is_uncited(self):
        out = {'headline': 'h', 'yesterday': [
            {'domain': 'markets', 'title': 't', 'detail': 'd'},
        ], 'today': []}
        r = h._resolve_citations('day', out, _registry(2))
        self.assertEqual(r['yesterday'][0]['cites'], [])
        self.assertEqual(r['sources'], [])


class ResolveWeekTest(unittest.TestCase):
    def test_object_and_legacy_string_bullets(self):
        out = {'headline': 'Week', 'sections': [
            {'domain': 'sports', 'bullets': [
                {'text': 'Won [1, 2]', 'cites': [3]},
                'Legacy bullet',
                {'text': '[4]', 'cites': [4]},  # nothing left after stripping
            ]},
        ]}
        r = h._resolve_citations('week', out, _registry(4))
        bullets = r['sections'][0]['bullets']
        self.assertEqual(bullets, [
            {'text': 'Won', 'cites': [1]},
            {'text': 'Legacy bullet', 'cites': []},
        ])
        self.assertEqual(r['sources'][0]['url'], 'https://example.com/3')


class SchemaTest(unittest.TestCase):
    def test_schemas_require_cites(self):
        self.assertIn('cites', h._ITEM_SCHEMA['required'])
        bullet = h.WEEK_SCHEMA['properties']['sections']['items']['properties']['bullets']['items']
        self.assertEqual(bullet['required'], ['text', 'cites'])
        self.assertNotIn('cites', h.DAY_SCHEMA['properties'])


if __name__ == '__main__':
    unittest.main()
