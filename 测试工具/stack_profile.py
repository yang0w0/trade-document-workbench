# -*- coding: utf-8 -*-
"""验证：不设重量优先/优先级时，算法是否只铺底层而不往上堆叠。"""
import sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'D:\bag\packing-eval\ContainerPlanner-网页版\源码')

from packer_pro import MM
from planner_core import rows_to_boxes_ex, run_packing

ROWS = [
    {'l': 0.49, 'w': 0.4, 'h': 0.09, 'n': 44, 'wt': 18, 'type': '纸箱', 'no_flip': False, 'prio': 0, 'desc': '法兰盘配件'},
    {'l': 0.35, 'w': 0.28, 'h': 0.35, 'n': 795, 'wt': 12, 'type': '纸箱', 'no_flip': False, 'prio': 0, 'desc': '标准螺丝组'},
]
CONTAINER_MM = (5800, 2350, 2350)

for metric in ('none', 'weight'):
    boxes, no_flip, priority, desc = rows_to_boxes_ex(ROWS)
    packer, fits, msg, stats = run_packing(
        CONTAINER_MM, boxes, 100, 'standard', 600,
        no_flip=no_flip, priority=priority, bottom_metric=metric, descriptions=desc)

    zs = Counter()
    max_top = 0
    for (x, y, z, l, w, h), info in zip(packer.packing_plan, packer.box_colors):
        zs[round(z / MM, 2)] += 1
        max_top = max(max_top, (z + h) / MM)
    used = sum(l * w * h for _, _, _, l, w, h in packer.packing_plan)

    print('\n===== 底层优先指标 = %s =====' % metric)
    print('已装 %d/%d，利用率 %.1f%%，最高堆到 %.2f m（柜高 2.35 m）' % (
        len(packer.packing_plan), stats['total'], used / packer.container_volume * 100, max_top))
    print('各高度层的件数分布（z=0 就是柜底那层）：')
    for z in sorted(zs):
        print('   z=%-5.2f m  -> %4d 件  %s' % (z, zs[z], '#' * (zs[z] // 10)))
    print('落地层(z=0)件数占比: %.1f%%' % (zs[0.0] / len(packer.packing_plan) * 100))

# 反证：如果只铺一层不堆叠，最多能放多少
floor = 5.8 * 2.35
print('\n--- 反证 ---')
print('柜底面积 %.2f m²；螺丝组最小落地投影 0.28×0.35=%.3f m²' % (floor, 0.28 * 0.35))
print('只铺一层最多约 %d 件螺丝 → 795 件不可能单层放完，算法必然往上堆。'
      % int(floor / (0.28 * 0.35)))
