import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

p = r'D:\bag\packing-eval\测试数据\packing_plan.json'
d = json.load(open(p, encoding='utf-8'))
c = d['container']
plan = d['packing_plan']
print('集装箱内尺寸(米):', c)
print('已装件数:', len(plan))
print('货物清单(长 宽 高 数量 重量kg 类型):')
for b in d['boxes']:
    print('   ', b)

vol_c = c[0] * c[1] * c[2]
used = sum(i['dimensions'][0] * i['dimensions'][1] * i['dimensions'][2] for i in plan)
print('\n体积利用率: %.2f%%' % (used / vol_c * 100))

# 按「原始尺寸」分组统计实际采用的姿态
postures = defaultdict(set)
for i in plan:
    od = tuple(round(x, 3) for x in i['box_info']['original_dimensions'])
    postures[od].add(tuple(round(x, 3) for x in i['dimensions']))

print('\n各类货物的原始尺寸 -> 实际摆放姿态(长,宽,高)：')
for od in sorted(postures):
    print('  原始 %s  共出现 %d 种姿态:' % (od, len(postures[od])))
    for t in sorted(postures[od]):
        print('      ', t)

print('\n判读：')
print('  第2种原始 (0.5,0.35,0.3)，若已禁止倒放，其第3维(高)必须恒为 0.3；')
print('  若出现 (0.5,0.3,0.35) 之类「高变成 0.35/0.5」的姿态，说明约束未生效。')
