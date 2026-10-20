# -*- coding: utf-8 -*-
"""探测：不同件数下后端标准版的装箱表现（能否装下 / 顶部是否被利用）。"""
import json
import sys
import time
import urllib.request

BASE = None


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return json.loads(r.read())


def analyze(plan):
    L, W, H = plan['container']
    items = plan['packing_plan']
    zmax = 0.0
    top = 0.0
    for it in items:
        z, h = it['position'][2], it['dimensions'][2]
        if z + h > zmax:
            zmax = z + h
    # 顶层 0.3m 内的件数
    top = sum(1 for it in items if it['position'][2] + it['dimensions'][2] > H - 0.3)
    vol = sum(i['dimensions'][0] * i['dimensions'][1] * i['dimensions'][2] for i in items)
    return {'zmax': round(zmax, 3), 'top30': top, 'vol': round(vol, 3),
            'util': round(vol / (L * W * H), 4)}


def run(label, cont, rows, mode='standard', budget=10):
    t0 = time.time()
    snap = post('/api/jobs', {'container': cont, 'rows': rows, 'ship_no': '',
                              'mode': mode, 'budget': budget, 'bottom_metric': 'none',
                              'threshold': 100})
    jid = snap['id']
    while True:
        snap = get(f'/api/jobs/{jid}')
        if snap['status'] in ('done', 'error', 'cancelled'):
            break
        time.sleep(0.4)
    dt = time.time() - t0
    if snap['status'] != 'done':
        print(f'{label:28s} {dt:6.1f}s  ✗ {snap.get("error")}')
        return
    res = snap['result']
    a = analyze(res['plan'])
    st = res['stats']
    flag = '✓' if res['fits'] else '✗'
    print(f'{label:28s} {dt:6.1f}s {flag} placed={st["placed"]}/{st["total"]} '
          f'util={a["util"]*100:5.1f}% 最高={a["zmax"]:.2f}/{cont[2]} 顶层0.3m内={a["top30"]}件')
    return res


def row(l, w, h, n, wt, t, desc):
    return {'l': l, 'w': w, 'h': h, 'n': n, 'wt': wt, 'type': t, 'desc': desc,
            'no_flip': False, 'prio': 0}


CONT = [5.8, 2.35, 2.35]
FIX = row(0.49, 0.4, 0.09, 44, 18, '纸箱', '法兰盘配件')


def main(n):
    print(f'单件 0.5x0.4x0.3 m，柜 {CONT}  法兰盘固定 44 件')
    for k in n:
        b = row(0.5, 0.4, 0.3, k, 1472, '木箱', '主机槽件')
        run(f'槽件{k}+盘44', CONT, [FIX, b])


if __name__ == '__main__':
    port = int(sys.argv[1])
    BASE = f'http://127.0.0.1:{port}'
    globals()['BASE'] = BASE
    main([int(x) for x in sys.argv[2:]] or [382, 385, 392, 400, 420, 429])
