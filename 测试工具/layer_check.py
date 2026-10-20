import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

p = r'D:\bag\packing-eval\测试数据\packing_plan.json'
d = json.load(open(p, encoding='utf-8'))
plan = d['packing_plan']

# 按「底面高度 z」分层，看每层由哪几种规格组成
layers = defaultdict(lambda: defaultdict(int))
for i in plan:
    z = round(i['position'][2], 3)
    od = tuple(round(x, 3) for x in i['box_info']['original_dimensions'])
    layers[z][od] += 1

print('共 %d 个不同的层高' % len(layers))
pure = mixed = 0
for z in sorted(layers):
    kinds = layers[z]
    tag = '纯' if len(kinds) == 1 else '混'
    if tag == '纯':
        pure += 1
    else:
        mixed += 1
    desc = '  '.join('%s x%d' % (k, v) for k, v in kinds.items())
    print('  z=%-6s [%s层] %s' % (z, tag, desc))

print('\n纯层 %d 个 / 混层 %d 个  → 纯层占比 %.0f%%' % (pure, mixed, pure / (pure + mixed) * 100))
print('说明：每一「层」= 同一底面高度上的一批箱子。纯层占比越高，工人越不需要来回换规格。')
