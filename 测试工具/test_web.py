# -*- coding: utf-8 -*-
"""端到端验证便携 Web 版：启动 exe -> 调 API 真实装箱 -> 校验约束 -> 关闭。"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

EXE = r'D:\bag\packing-eval\ContainerPlanner-网页版\ContainerPlanner\ContainerPlanner.exe'
CWD = os.path.dirname(EXE)


def get(path):
    with urllib.request.urlopen('http://127.0.0.1:%d%s' % (PORT, path), timeout=30) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read().decode('utf-8', 'replace')


# exe 输出是 GBK，管道读取会解码崩溃；直接丢弃，端口改用 psutil 查
proc = subprocess.Popen([EXE], cwd=CWD,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PORT = None
lines = []

# 用 psutil 精确找出该进程监听的本地端口
import psutil

for _ in range(60):
    time.sleep(1.0)
    try:
        conns = psutil.Process(proc.pid).net_connections(kind='tcp')
    except Exception:
        conns = []
    for c in conns:
        if c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.ip == '127.0.0.1':
            PORT = c.laddr.port
            break
    if PORT:
        break

print('--- 启动输出 ---')
for x in lines:
    print('   ', x)
if PORT is None:
    print('FAIL：未获取到服务端口')
    proc.kill()
    sys.exit(1)
print('服务端口:', PORT)

ok = True
try:
    st, body = get('/api/health')
    print('\n[1] /api/health ->', st, body[:120])
    ok &= st == 200

    st, body = get('/')
    print('[2] 首页 ->', st, '，长度', len(body), '，含三维脚本:', 'three' in body.lower())
    ok &= st == 200 and len(body) > 5000

    st, body = get('/api/config')
    print('[3] /api/config ->', st, body[:150])
    ok &= st == 200

    payload = {
        'container': [12.032, 2.352, 2.698],
        'ship_no': 'TEST-001',
        'rows': [
            {'l': 0.6, 'w': 0.4, 'h': 0.4, 'n': 500, 'wt': 15, 'type': '纸箱', 'no_flip': False},
            {'l': 0.5, 'w': 0.35, 'h': 0.3, 'n': 450, 'wt': 10, 'type': '纸箱', 'no_flip': True},
        ],
        'mode': 'standard', 'budget': 600,
        'bottom_metric': 'weight', 'threshold': 100,
    }
    st, body = post('/api/jobs', payload)
    print('\n[4] 提交计算任务 ->', st)
    ok &= st == 202
    job = json.loads(body)
    jid = job.get('id') or job.get('job_id')
    print('    任务 id:', jid)

    result = None
    deadline = time.time() + 180
    while time.time() < deadline:
        st, body = get('/api/jobs/%s' % jid)
        snap = json.loads(body)
        state = snap.get('state') or snap.get('status')
        print('    状态:', state)
        if state in ('done', 'finished', 'completed', 'success'):
            result = snap
            break
        if state in ('error', 'failed'):
            print('    失败:', body[:400])
            break
        time.sleep(1.5)

    if result is None:
        print('FAIL：任务未在时限内完成')
        ok = False
    else:
        print('\n[5] 结果字段:', list(result.keys()))
        res = result.get('result') or result
        stats = res.get('stats') or {}
        print('    统计:', json.dumps(stats, ensure_ascii=False)[:300])
        print('    是否全装下:', res.get('fits'))

        plan = (res.get('plan') or {}).get('packing_plan') or []
        print('    方案件数:', len(plan))

        # 校验禁止倒放：第 2 种原始 (0.5,0.35,0.3)，高度必须恒为 0.3
        heights = {}
        for it in plan:
            od = tuple(round(x, 3) for x in it['box_info']['original_dimensions'])
            heights.setdefault(od, set()).add(round(it['dimensions'][2], 3))
        print('\n[6] 各类货物的实际高度取值:')
        for od, hs in heights.items():
            print('     原始', od, '-> 高度', sorted(hs))
        nf = [od for od in heights if abs(od[2] - 0.3) < 1e-6]
        if nf:
            od = nf[0]
            good = all(abs(x - 0.3) < 1e-6 for x in heights[od])
            print('     禁止倒放校验(第2种高度恒为0.3):', '通过' if good else '未通过')
            ok &= good
finally:
    proc.kill()
    try:
        subprocess.run(['taskkill', '/F', '/PID', str(proc.pid)], capture_output=True)
    except Exception:
        pass

print('\n==== 总判定:', 'PASS' if ok else 'FAIL', '====')
