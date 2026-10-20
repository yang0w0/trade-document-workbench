# -*- coding: utf-8 -*-
"""启动便携 Web 版并把监听端口写入 port.txt，供截图脚本使用。"""
import os
import subprocess
import time

import psutil

EXE = r'D:\bag\packing-eval\ContainerPlanner-网页版\ContainerPlanner\ContainerPlanner.exe'
PORT_FILE = r'D:\bag\packing-eval\测试记录\port.txt'

if os.path.exists(PORT_FILE):
    os.remove(PORT_FILE)

p = subprocess.Popen([EXE], cwd=os.path.dirname(EXE),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('pid', p.pid, flush=True)

port = None
for _ in range(60):
    time.sleep(1.0)
    try:
        conns = psutil.Process(p.pid).net_connections(kind='tcp')
    except Exception:
        conns = []
    for c in conns:
        if c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.ip == '127.0.0.1':
            port = c.laddr.port
            break
    if port:
        break

print('PORT', port, flush=True)
with open(PORT_FILE, 'w') as f:
    f.write(str(port))

time.sleep(900)
