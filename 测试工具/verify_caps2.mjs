// 校验「求最大」上限估算：分层整齐码放 + 双重体积安全线
import { maxCapsFor, layeredFit, SAFE_VOL_RATIO } from '../ContainerPlanner-网页版/ContainerPlanner/_internal/web/js/format.js';

const T = (name, container, rows) => {
  const caps = maxCapsFor(container, rows);
  const contVol = container.reduce((a, b) => a * b, 1);
  console.log(`\n${name}  柜 ${container.join('×')}  = ${contVol.toFixed(2)} m³`);
  let totalVol = 0;
  for (const r of rows) {
    const v = r.l * r.w * r.h;
    const isMax = !(Math.round(Number(r.n)) > 0);
    if (isMax) {
      const e = caps.get(r.id) || { cap: 0, layered: 0, volCap: 0 };
      const lf = layeredFit(r, container);
      totalVol += e.cap * v;
      console.log(`  留空「${r.desc}」 单件 ${v.toFixed(4)} m³ | 分层码放 ${lf.count}(层高种类${lf.layers})`
        + ` → 提交 ${e.cap} 件（体积上限 ${e.volCap}）占 ${(e.cap * v).toFixed(2)} m³`
        + ` = 全柜 ${(e.cap * v / contVol * 100).toFixed(1)}%`);
    } else {
      totalVol += v * r.n;
      console.log(`  定量「${r.desc}」 ${r.n} 件 = ${(v * r.n).toFixed(2)} m³ = 全柜 ${(v * r.n / contVol * 100).toFixed(1)}%`);
    }
  }
  console.log(`  → 提交的货物总体积 ${totalVol.toFixed(2)} m³ = 全柜 ${(totalVol / contVol * 100).toFixed(1)}%`
    + `（安全线 ${(SAFE_VOL_RATIO * 100).toFixed(0)}%）`);
};

const CONT = [5.8, 2.35, 2.35];

T('A 用户截图案例（槽件求最大 + 法兰盘 44）', CONT, [
  { id: 1, l: 0.49, w: 0.4, h: 0.09, n: 44, wt: 18, type: '纸箱', desc: '法兰盘配件' },
  { id: 2, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 1472, type: '木箱', desc: '主机槽件' },
]);

T('B 程序内置示例（清空第 1、3 行数量）', CONT, [
  { id: 1, l: 0.49, w: 0.4, h: 0.09, n: 0, wt: 18, type: '纸箱', desc: '法兰盘配件' },
  { id: 2, l: 1.2, w: 1.0, h: 1.35, n: 7, wt: 1472, type: '木箱', desc: '主机箱体' },
  { id: 3, l: 0.6, w: 0.26, h: 0.37, n: 0, wt: 12, type: '纸箱', desc: '连接管件' },
  { id: 4, l: 0.35, w: 0.28, h: 0.35, n: 168, wt: 9, type: '纸箱', desc: '标准螺栓组' },
  { id: 5, l: 1.1, w: 1.1, h: 1.4, n: 2, wt: 600, type: '木箱', desc: '变速箱总成' },
]);

T('C 禁倒放（单一层高，不加码）', CONT, [
  { id: 1, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 20, type: '木箱', desc: '不可倒放箱', no_flip: true },
]);

T('D 大托盘求最大', CONT, [
  { id: 1, l: 1.2, w: 1.0, h: 1.35, n: 0, wt: 500, type: '托盘', desc: '大件托盘' },
]);

T('E 两类同时留空', CONT, [
  { id: 1, l: 0.5, w: 0.4, h: 0.3, n: 0, wt: 20, type: '木箱', desc: 'A 箱' },
  { id: 2, l: 0.4, w: 0.3, h: 0.25, n: 0, wt: 10, type: '纸箱', desc: 'B 箱' },
]);
