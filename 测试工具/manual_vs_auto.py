# -*- coding: utf-8 -*-
"""复现用户场景：20GP + 法兰盘(0.49x0.4x0.09, 44件, 18kg) + 螺丝组(0.35x0.28x0.35, 795件, 12kg)
对比 手动模式(优先级) / 自动+按重量 / 自动+无指标 三种算法分支的装载结果。"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'D:\bag\packing-eval\ContainerPlanner-网页版\源码')

from packer_pro import MM, to_mm
from planner_core import rows_to_boxes_ex, run_packing

ROWS = [
    {'l': 0.49, 'w': 0.4, 'h': 0.09, 'n': 44, 'wt': 18, 'type': '纸箱', 'no_flip': False, 'prio': 1, 'desc': '法兰盘配件'},
    {'l': 0.35, 'w': 0.28, 'h': 0.35, 'n': 795, 'wt': 12, 'type': '纸箱', 'no_flip': False, 'prio': 0, 'desc': '标准螺丝组'},
]
CONTAINER_MM = tuple(to_mm(v) for v in (5.8, 2.35, 2.35))   # 20GP

CASES = [
    ('手动模式（优先级=1）', 'manual'),
    ('自动 + 按重量优先', 'weight'),
    ('自动 + 按体积重优先', 'volumetric'),
    ('自动（两项都不开）', 'none'),
]

for label, metric in CASES:
    boxes, no_flip, priority, desc = rows_to_boxes_ex(ROWS)
    packer, fits, msg, stats = run_packing(
        CONTAINER_MM, boxes, 100, 'standard', 600,
        no_flip=no_flip, priority=priority, bottom_metric=metric, descriptions=desc)
    plan = packer.packing_plan
    # 法兰盘(io=0)的最低 z：是否真的沉底
    z_flange = sorted({round(z / MM, 3) for (x, y, z, l, w, h), i in zip(plan, packer.box_colors)
                       if i['input_order'] == 0})
    used = sum(l * w * h for _, _, _, l, w, h in plan)
    print('%-14s 已装 %3d/%3d  利用率 %5.1f%%  法兰盘所在高度层: %s' % (
        label, len(plan), stats['total'], used / packer.container_volume * 100, z_flange))
