# -*- coding: utf-8 -*-
"""实测：前端新口径给出的件数，后端能否稳装下、用时多久。"""
import json
import sys
import time
import urllib.request

BASE = None


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=180) as r:
        return json.loads(r.read())


def analyze(plan):
    L, W, H = plan['container']
    items = plan['packing_plan']
    zmax = max((it['position'][2] + it['dimensions'][2] for it in items), default=0)
    vol = sum(i['dimensions'][0] * i['dimensions'][1] * i['dimensions'][2] for i in items)
    return {'zmax': round(zmax, 3), 'util': round(vol / (L * W * H), 4)}


def run(label, cont, rows, mode='standard', budget=10):
    t0 = time.time()
    try:
        snap = post('/api/jobs', {'container': cont, 'rows': rows, 'ship_no': '',
                                  'mode': mode, 'budget': budget, 'bottom_metric': 'none',
                                  'threshold': 100})
    except Exception as exc:
        print(f'{label:30s} 提交失败 {exc}')
        return
    jid = snap['id']
    while True:
        snap = get(f'/api/jobs/{jid}')
        if snap['status'] in ('done', 'error', 'cancelled'):
            break
        time.sleep(0.4)
    dt = time.time() - t0
    if snap['status'] != 'done':
        print(f'{label:30s} {dt:6.1f}s  ✗ {snap.get("error")}')
        return
    res = snap['result']
    a = analyze(res['plan'])
    st = res['stats']
    print(f'{label:30s} {dt:6.1f}s {"✓" if res["fits"] else "✗"} placed={st["placed"]}/{st["total"]} '
          f'util={a["util"]*100:5.1f}% 最高={a["zmax"]:.2f}/{cont[2]}')


def row(l, w, h, n, wt, t, desc, no_flip=False):
    return {'l': l, 'w': w, 'h': h, 'n': n, 'wt': wt, 'type': t, 'desc': desc,
            'no_flip': no_flip, 'prio': 0}


if __name__ == '__main__':
    port = int(sys.argv[1])
    BASE = f'http://127.0.0.1:{port}'
    globals()['BASE'] = BASE
    only = sys.argv[2] if len(sys.argv) > 2 else None

    cases = [
        ('1 截图案例 槽件458+盘44', [5.8, 2.35, 2.35], [
            row(0.49, 0.4, 0.09, 44, 18, '纸箱', '法兰盘配件'),
            row(0.5, 0.4, 0.3, 458, 1472, '木箱', '主机槽件')]),
        ('2 大托盘 13', [5.8, 2.35, 2.35], [row(1.2, 1.0, 1.35, 13, 500, '托盘', '大件托盘')]),
        ('3 小件 5604 (40HQ)', [12.0, 2.35, 2.65], [row(0.3, 0.2, 0.2, 5604, 5, '纸箱', '小件')]),
        ('4 两类留空 237+485', [5.8, 2.35, 2.35], [
            row(0.5, 0.4, 0.3, 237, 20, '木箱', 'A 箱'),
            row(0.4, 0.3, 0.25, 485, 10, '纸箱', 'B 箱')]),
        ('5 禁倒放 412', [5.8, 2.35, 2.35], [row(0.5, 0.4, 0.3, 412, 20, '木箱', '不可倒放箱', True)]),
    ]
    for label, cont, rows in cases:
        if only and not label.startswith(only):
            continue
        run(label, cont, rows)
