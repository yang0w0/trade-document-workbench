"""Synthetic geometry and the dimensions explicitly supplied in the screenshot."""
import sys
import io
import unittest
from collections import Counter
from pathlib import Path

APP = Path(__file__).resolve().parents[3] / 'application'
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / 'tests'))
from server.worker import compute_plan
from planner_core import (build_cargo_xlsx, parse_xlsx, build_excel_bytes,
                          load_plan_into_packer, load_plan_xlsx)
from test_enhanced_packing import assert_valid_plan


def row(l, w, h, n=0, **extra):
    return dict(l=l, w=w, h=h, n=n, wt=1, type='纸箱', **extra)


def solve(container, rows, **extra):
    return compute_plan(dict(container=container, rows=rows, mode='standard',
                             budget=10, bottom_metric='none', threshold=100,
                             max_pieces=20000, **extra))


class MaximumPackingTests(unittest.TestCase):
    def test_input_export_preserves_blank_quantity_for_next_session(self):
        rows = [row(.5, .5, .5)]
        exported = build_cargo_xlsx((1000,1000,1000), rows)
        _, boxes, *_ = parse_xlsx(io.BytesIO(exported))
        self.assertEqual([box[3] for box in boxes], [0])

    def test_blank_quantity_fills_container_instead_of_becoming_zero_demand(self):
        result = solve([1, 1, 1], [row(.5, .5, .5)])
        self.assertEqual(result['stats']['placed'], 8)
        self.assertEqual(result['maxFlags'], [True])
        self.assertEqual(result['stats']['utilization'], 1)
        assert_valid_plan(self, load_plan_into_packer(result['plan']))

    def test_screenshot_exceeds_old_1547_cap_and_keeps_all_44_fixed_boxes(self):
        result = solve([5.8, 2.35, 2.35], [row(.49, .4, .09, 44), row(.2, .2, .4)])
        counts = Counter(p['box_info']['input_order'] for p in result['plan']['packing_plan'])
        self.assertEqual(counts[0], 44)
        self.assertGreaterEqual(counts[1], 1754)
        self.assertGreaterEqual(result['stats']['utilization'], .90)
        self.assertFalse(result['stats']['optimal_full'])
        assert_valid_plan(self, load_plan_into_packer(result['plan']))

    def test_fixed_quantity_is_preserved_before_filler_even_if_it_lowers_volume(self):
        result = solve([1, 1, 1], [row(.6, .6, .6, 1), row(.5, .5, .5)])
        counts = Counter(p['box_info']['input_order'] for p in result['plan']['packing_plan'])
        self.assertEqual(counts[0], 1)
        self.assertTrue(result['fits'])
        assert_valid_plan(self, load_plan_into_packer(result['plan']))

    def test_no_flip_and_multiple_fillers_respect_orientations(self):
        result = solve([1, 1, .5], [row(.5, .5, .6, no_flip=True), row(.5, .5, .5)])
        self.assertEqual(result['stats']['placed'], 4)
        self.assertEqual({p['box_info']['input_order'] for p in result['plan']['packing_plan']}, {1})
        assert_valid_plan(self, load_plan_into_packer(result['plan']))

    def test_piece_limit_is_reported_without_claiming_optimum(self):
        params = dict(container=[1, 1, 1], rows=[row(.1, .1, .1)], mode='standard',
                      budget=10, bottom_metric='none', threshold=100, max_pieces=12)
        result = compute_plan(params)
        self.assertEqual(result['stats']['placed'], 12)
        self.assertEqual(result['stats']['max_search_stop'], 'piece_limit')
        self.assertFalse(result['stats']['optimal_full'])

    def test_xlsx_roundtrip_keeps_unplaceable_filler_category_and_positions(self):
        result = solve([1, 1, .5], [row(.5, .5, .6, no_flip=True), row(.5, .5, .5)])
        packer = load_plan_into_packer(result['plan'])
        restored, _ = load_plan_xlsx(io.BytesIO(build_excel_bytes(packer, result['stats'])))
        self.assertEqual(restored.packing_plan, packer.packing_plan)
        self.assertEqual([b[3] for b in restored.boxes], [0, 4])


if __name__ == '__main__':
    unittest.main()
