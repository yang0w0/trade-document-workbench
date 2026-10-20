import { maxCapsFor, layeredFit, SAFE_VOL_RATIO } from './_fmt.mjs';

const T = (name, container, rows) => {
  const caps = maxCapsFor(container, rows);
  console.log(`\n${name}  柜 ${container.join('×')}`);
  const contVol = container.reduce((a, b) => a * b, 1);
  for (const r of rows) {
    const v = r.l * r.w * r.h;
    const maxRow = !(Math.round(Number(r.n)) > 0);
    const lf = layeredFit(r, container);
    const e = caps.get(r.id) || { cap: 0, layered: 0, volCap: 0 };
    if (maxRow) {
      const per = e.cap * v;
      console.log(`  留空 ${r.desc}: 单件 ${v.toFixed(3)} m³  分层码放上限 ${lf.count}`
        + ` → 提交件数 ${e.cap}（体积上限 ${e.volCap}）→ 占 ${per.toFixed(2)} m³`
        + ` = 柜体积 ${(per / contVol * 100).toFixed(1)}%`);
    } else {
      console.log(`  定量 ${r.desc}: ${r.n} 件 = ${(v * r.n).toFixed(3)} m³`);
    }
  }
};

T('案例1 用户截图（槽件求最大 + 法兰盘44）', [5.8, 2.35, 2.35], [
  { id: 1, l: 0.49, w: 0.4, h: 0.09, n: 44, wt: 18, type: '纸箱', desc: '法兰盘配件', no_flip: false },
  { id: 2, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 1472, type: '木箱', desc: '主机槽件', no_flip: false },
]);

T('案例2 大托盘求最大（无定量）', [5.8, 2.35, 2.35], [
  { id: 1, l: 1.2, w: 1.0, h: 1.35, n: 0, wt: 500, type: '托盘', desc: '大件托盘', no_flip: false },
]);

T('案例3 小件求最大（无定量）', [12.0, 2.35, 2.65], [
  { id: 1, l: 0.3, w: 0.2, h: 0.2, n: 0, wt: 5, type: '纸箱', desc: '小件', no_flip: false },
]);

T('案例4 两类同时留空', [5.8, 2.35, 2.35], [
  { id: 1, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 20, type: '木箱', desc: 'A 箱', no_flip: false },
  { id: 2, l: 0.4, w: 0.3, h: 0.25, n: 0, wt: 10, type: '纸箱', desc: 'B 箱', no_flip: false },
]);

T('案例5 禁止倒放', [5.8, 2.35, 2.35], [
  { id: 1, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 20, type: '木箱', desc: '不可倒放箱', no_flip: true },
]);
