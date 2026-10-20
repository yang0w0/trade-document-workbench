# -*- coding: utf-8 -*-
"""验证用户截图场景（20GP + 法兰盘 44 + 主机槽件求最大）在新口径下的表现。"""
import json
import sys
import time
import urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else open(
    r'D:\bag\packing-eval\测试记录\port.txt', encoding='utf-8').read().strip()
BASE = f'http://127.0.0.1:{PORT}'


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=180) as r:
        return json.loads(r.read())


def row(l, w, h, n, wt, t, desc):
    return {'l': l, 'w': w, 'h': h, 'n': n, 'wt': wt, 'type': t, 'desc': desc,
            'no_flip': False, 'prio': 0}


def run(label, cont, rows):
    t0 = time.time()
    snap = post('/api/jobs', {'container': cont, 'rows': rows, 'ship_no': '',
                              'mode': 'standard', 'budget': 10, 'bottom_metric': 'none',
                              'threshold': 100})
    jid = snap['id']
    while True:
        snap = get(f'/api/jobs/{jid}')
        if snap['status'] in ('done', 'error', 'cancelled'):
            break
        time.sleep(0.4)
    dt = time.time() - t0
    if snap['status'] != 'done':
        print(f'{label}: {dt:.1f}s ✗ {snap.get("error")}')
        return
    res = snap['result']
    plan = res['plan']
    L, W, H = plan['container']
    items = plan['packing_plan']
    zmax = max((it['position'][2] + it['dimensions'][2] for it in items), default=0)
    top = sum(1 for it in items if it['position'][2] + it['dimensions'][2] > H - 0.3)
    st = res['stats']
    print(f'{label}: {dt:.1f}s {"✓" if res["fits"] else "✗"} 装入 {st["placed"]}/{st["total"]} 件  '
          f'利用率 {st["utilization"]*100:.1f}%  最高 {zmax:.2f}/{H} m  顶层0.3m内 {top} 件')


CONT = [5.8, 2.35, 2.35]
FIX = row(0.49, 0.4, 0.09, 44, 18, '纸箱', '法兰盘配件')
print(f'服务端口 {PORT}')
run('A 槽件453+盘44（新口径）', CONT, [FIX, row(0.5, 0.4, 0.3, 453, 1472, '木箱', '主机槽件')])
run('A 槽件458+盘44（上一版口径）', CONT, [FIX, row(0.5, 0.4, 0.3, 458, 1472, '木箱', '主机槽件')])
run('A 槽件470+盘44（再多一档）', CONT, [FIX, row(0.5, 0.4, 0.3, 470, 1472, '木箱', '主机槽件')])
