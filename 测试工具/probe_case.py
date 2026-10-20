# -*- coding: utf-8 -*-
"""探测：复现用户截图中的场景，分析后端标准版装箱结果的空隙。"""
import json
import sys
import time
import urllib.request

import subprocess

BASE = None


def find_port():
    for _ in range(30):
        out = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True, text=True).stdout
        out2 = subprocess.run(['tasklist', '/FO', 'CSV'], capture_output=True, text=True).stdout
        pids = [ln.split(',')[1].strip('"') for ln in out2.splitlines() if 'ContainerPlanner.exe' in ln]
        for ln in out.splitlines():
            if 'LISTENING' not in ln:
                continue
            parts = ln.split()
            port, pid = parts[1].split(':')[-1], parts[-1]
            if pid in pids:
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/config', timeout=2) as r:
                        if r.status == 200:
                            return int(port)
                except Exception:
                    pass
        time.sleep(1)
    return None


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())


def run_case(label, container, rows, mode='standard', budget=10):
    t0 = time.time()
    snap = post('/api/jobs', {'container': container, 'rows': rows, 'ship_no': '',
                              'mode': mode, 'budget': budget, 'bottom_metric': 'none',
                              'threshold': 100})
    jid = snap['id']
    while True:
        snap = get(f'/api/jobs/{jid}')
        if snap['status'] in ('done', 'error', 'cancelled'):
            break
        time.sleep(0.5)
    dt = time.time() - t0
    if snap['status'] != 'done':
        print(f'[{label}] 失败: {snap.get("error")}')
        return None
    res = snap['result']
    plan = res['plan']
    print(f'[{label}] 用时 {dt:.1f}s  fits={res["fits"]}  stats={res["stats"]}')
    print(f'  msg={res["msg"]!r} note={res.get("note")!r}')
    analyze(plan)
    return plan


def analyze(plan):
    L, W, H = plan['container']
    items = plan['packing_plan']
    print(f'  柜 {L}x{W}x{H}  件数 {len(items)}')
    # 各类别数量与位置范围
    from collections import defaultdict
    by = defaultdict(list)
    for it in items:
        by[it['box_info']['input_order']].append(it)
    for io, lst in sorted(by.items()):
        xs = [i['position'][0] for i in lst]
        ys = [i['position'][1] for i in lst]
        zs = [i['position'][2] for i in lst]
        ex = [i['position'][0] + i['dimensions'][0] for i in lst]
        ey = [i['position'][1] + i['dimensions'][1] for i in lst]
        ez = [i['position'][2] + i['dimensions'][2] for i in lst]
        vol = sum(i['dimensions'][0] * i['dimensions'][1] * i['dimensions'][2] for i in lst)
        print(f'  类别{io+1}: {len(lst)} 件  体积 {vol:.3f} m³  占地 X[{min(xs):.2f},{max(ex):.2f}] '
              f'Y[{min(ys):.2f},{max(ey):.2f}] Z[{min(zs):.2f},{max(ez):.2f}]')
    # 沿 X 方向切 10 段，看每段的最高点（发现"上方空着"的区域）
    print('  沿长度方向分段（每段 10% 长）最高货物高度 / 该段体积占用率:')
    segs = 10
    for s in range(segs):
        x0, x1 = L * s / segs, L * (s + 1) / segs
        zi = 0.0
        vol = 0.0
        for it in items:
            x, y, z = it['position']
            l, w, h = it['dimensions']
            if x >= x1 or x + l <= x0:
                continue
            ov = (min(x + l, x1) - max(x, x0)) / l
            vol += l * w * h * ov
            if z + h > zi:
                zi = z + h
        cap = (x1 - x0) * W * H
        print(f'   seg{s}: 最高 {zi:.2f} m / 柜高 {H}   体积 {vol:.3f}/{cap:.3f} = {vol/cap*100:.1f}%')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else find_port()
    if not port:
        print('未找到服务端口')
        sys.exit(1)
    BASE = f'http://127.0.0.1:{port}'
    print('服务端口', port)

    cont = [5.8, 2.35, 2.35]
    r_fixed = {'l': 0.49, 'w': 0.4, 'h': 0.09, 'n': 44, 'wt': 18, 'type': '纸箱', 'desc': '法兰盘配件', 'no_flip': False, 'prio': 0}
    r_max = {'l': 0.5, 'w': 0.4, 'h': 0.3, 'n': 382, 'wt': 1472, 'type': '木箱', 'desc': '主机槽件', 'no_flip': False, 'prio': 0}

    plan = run_case('fast/382件', cont, [r_fixed, dict(r_max)])
    if plan:
        json.dump(plan, open('D:/bag/packing-eval/测试记录/probe_plan.json', 'w', encoding='utf-8'), ensure_ascii=False)
