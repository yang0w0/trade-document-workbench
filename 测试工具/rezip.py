# -*- coding: utf-8 -*-
"""把 ContainerPlanner-网页版 目录重新打包为 zip（网页端改动后同步给压缩包版）。"""
import os
import zipfile

ROOT = r'D:\bag\packing-eval'
SRC = os.path.join(ROOT, 'ContainerPlanner-网页版')
TMP = os.path.join(ROOT, '发布包', 'ContainerPlanner-网页版-new.zip')
DST = os.path.join(ROOT, '发布包', 'ContainerPlanner-网页版.zip')
BAK = os.path.join(ROOT, '发布包', 'ContainerPlanner-网页版-prev.zip')

n = 0
with zipfile.ZipFile(TMP, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(SRC):
        # 源码目录不进客户包
        dirnames[:] = [d for d in dirnames if d != '源码']
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, SRC).replace('\\', '/')
            z.write(full, rel)
            n += 1
            if n % 500 == 0:
                print('...', n, flush=True)
print('files:', n)
print('tmp size:', os.path.getsize(TMP))

if os.path.exists(BAK):
    os.remove(BAK)
if os.path.exists(DST):
    os.replace(DST, BAK)
os.replace(TMP, DST)
print('done:', DST, os.path.getsize(DST))
