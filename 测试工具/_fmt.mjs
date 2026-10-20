// 数字格式化、类别配色与实时预估（与 planner_core.compute_estimate 逻辑一致）。

export const TYPE_LABELS = { 0: '木箱', 1: '纸箱', 2: '托盘' };
export const PALETTE = ['#3151CB', '#B9693F', '#2F7D68', '#A84A5B', '#6B5CA5',
  '#8A6A4A', '#4F7897', '#69727D', '#8C7836', '#2F7480'];
export const categoryColor = (io) => PALETTE[io % PALETTE.length];

/** 等价于 Python 的 f"{x:g}"：6 位有效数字，去掉多余的 0。 */
export function g(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return String(Number(n.toPrecision(6)));
}

export const fixed = (x, digits) => Number(x).toLocaleString('zh-CN',
  { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const typeLabel = (t) => TYPE_LABELS[String(t)] ?? String(t);

/** 米 -> 整数毫米（与后端 to_mm 一致，用于判断有效行与超尺寸）。 */
export const toMM = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};

/** 尺寸填完整的行（数量可以留空 = 求最大）。 */
export const isSizeRow = (r) => toMM(r.l) > 0 && toMM(r.w) > 0 && toMM(r.h) > 0;

/** 数量留空（0）= 求该柜型最多能装几件。 */
export const isMaxRow = (r) => isSizeRow(r) && Math.round(Number(r.n)) <= 0;

export const isValidRow = (r) => isSizeRow(r) && Math.round(Number(r.n)) > 0;

/** 单件体积（m³）。 */
export const rowVolume = (r) => (Number(r.l) || 0) * (Number(r.w) || 0) * (Number(r.h) || 0);

const ORIENTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * 「整齐码放」可达件数：把柜子沿高度切成若干整层，每层铺同一种朝向
 * （6 种朝向取优；勾了「禁止倒放」只允许绕竖轴转），再用动态规划在高度方向上
 * 组合出件数最多的分层方案。
 *
 * 相比「整柜只用一种朝向」的粗估，这样能混用不同高度的层（例如 0.5 m 层 + 0.4 m 层），
 * 明显更接近实际装箱能达到的数量；同时它是构造式的，前端自己就能算，不需要后端搜索。
 * ratio = 这些件数占用的体积比例，可用于衡量这类货物的码放效率。
 */
export function layeredFit(row, container) {
  const [L, W, H] = container.map(toMM);
  const d = [toMM(row.l), toMM(row.w), toMM(row.h)];
  const contVol = L * W * H;
  if (contVol <= 0 || Math.min(...d) <= 0) return { count: 0, ratio: 0 };

  const perms = row.no_flip ? [[0, 1, 2], [1, 0, 2]] : ORIENTATIONS;
  const byHeight = new Map();   // 层高(mm) -> 该高度的层最多能铺几件
  for (const [i, j, k] of perms) {
    const dx = d[i], dy = d[j], dz = d[k];
    if (dz <= 0) continue;
    const cap = Math.max(Math.floor(L / dx) * Math.floor(W / dy),
      Math.floor(L / dy) * Math.floor(W / dx));
    if (cap > 0) byHeight.set(dz, Math.max(byHeight.get(dz) || 0, cap));
  }
  const types = [...byHeight.entries()].map(([dz, cap]) => ({ dz, cap }));
  if (!types.length) return { count: 0, ratio: 0, layers: 0 };

  const step = H > 12000 ? 10 : 1;   // 超高柜型降精度，避免 DP 数组过大
  const N = Math.floor(H / step);
  const dp = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    let best = dp[i - 1];            // 空着这一段高度
    for (const t of types) {
      const k = Math.ceil(t.dz / step);
      if (k > i) continue;
      const v = dp[i - k] + t.cap;
      if (v > best) best = v;
    }
    dp[i] = best;
  }
  const count = dp[N];
  // layers = 可选层高种类数：只有一种（例如禁止倒放）时，分层模型已接近真实上限，
  // 不能再往上放宽；有多种时说明还能通过混层挤出更多空间。
  return { count, ratio: Math.min(1, (count * d[0] * d[1] * d[2]) / contVol), layers: types.length };
}

// 「求最大」的安全余量：按剩余体积折算件数时留出空隙损耗。
// 件数一旦超过实际可装量，后端会陷入长时间的无效搜索（实测可从 1 秒涨到 50 秒以上），
// 因此宁可略保守，也不能超发。
export const SAFE_VOL_RATIO = 0.9;
// 精确搜索口径：放宽体积安全线，件数更多（更接近理论上限），但后端搜索更久。
export const EXACT_VOL_RATIO = 0.97;
// 分层模型只按「整层铺满」估算，实际装箱还能在同一层里混放别的货物。
// 但只有存在多种层高可选时才有这个余地（禁止倒放时只有一种层高，不能再放宽）。
const LAYERED_BONUS = 1.04;
const EXACT_LAYERED_BONUS = 1.12;

/**
 * 各类「求最大」（数量留空）的上限件数。
 *
 * 两个口径取小：
 *   ① 分层整齐码放可达件数（扣除定量货物按体积折算的占位）—— 构造式，稳；
 *   ② 剩余体积 × 安全系数 ÷ 单件体积 —— 兜住「码放效率很低」的货物不超发。
 * 多类同时留空时，合计体积不能突破剩余空间的安全体积，按比例缩减。
 *
 * @returns {Map<rowId, {cap:number, layered:number, volCap:number}>} cap = 建议提交的件数
 */
export function maxCapsFor(container, rows, mode = 'fast') {
  const c = container.map(toMM);
  const contVol = c[0] * c[1] * c[2];
  const out = new Map();
  if (contVol <= 0) return out;
  const exact = mode === 'exact';
  const ratio = exact ? EXACT_VOL_RATIO : SAFE_VOL_RATIO;

  const sized = rows.filter(isSizeRow);
  let fixedVol = 0;
  for (const r of sized) {
    if (isMaxRow(r)) continue;
    fixedVol += toMM(r.l) * toMM(r.w) * toMM(r.h) * Math.max(0, Math.round(Number(r.n)));
  }
  const freeVol = Math.max(0, contVol - fixedVol);
  const budgetVol = freeVol * ratio;

  const items = [];
  for (const r of sized) {
    if (!isMaxRow(r)) continue;
    const v = toMM(r.l) * toMM(r.w) * toMM(r.h);
    if (v <= 0) { out.set(r.id, { cap: 0, layered: 0, volCap: 0 }); continue; }
    const lf = layeredFit(r, container);
    const volCap = Math.floor(budgetVol / v);
    // 定量货物按体积折算成同类件数占位（它们可以先占掉一部分空间）
    const taken = Math.floor(fixedVol / v);
    const bonus = lf.layers >= 2 ? (exact ? EXACT_LAYERED_BONUS : LAYERED_BONUS) : 1;
    const byLayered = Math.max(1, Math.round(Math.max(0, lf.count - taken) * bonus));
    items.push({ r, v, layered: lf.count, volCap, cap: Math.max(1, Math.min(volCap, byLayered)) });
  }

  const totalVol = items.reduce((a, x) => a + x.cap * x.v, 0);
  if (totalVol > budgetVol && totalVol > 0) {
    const k = budgetVol / totalVol;
    for (const x of items) x.cap = Math.max(1, Math.floor(x.cap * k));
  }
  for (const x of items) out.set(x.r.id, { cap: x.cap, layered: x.layered, volCap: x.volCap });
  return out;
}

export function computeEstimate(container, rows, threshold, mode = 'fast') {
  const c = container.map(toMM);
  const contVol = c[0] * c[1] * c[2];
  const contVolM3 = contVol / 1e9;
  const sized = rows.filter(isSizeRow);
  const valid = rows.filter(isValidRow);
  let cargoVol = 0, pieces = 0, weight = 0, oversized = 0, heavy = 0;
  const cd = [...c].sort((a, b) => a - b);
  // 数量已指定的行：件数 / 体积 / 重量照常累计
  for (const r of valid) {
    const dims = [toMM(r.l), toMM(r.w), toMM(r.h)];
    const n = Math.round(Number(r.n));
    const wt = Number(r.wt) || 0;
    cargoVol += dims[0] * dims[1] * dims[2] * n;
    pieces += n;
    weight += wt * n;
  }
  // 尺寸 / 重货检查覆盖所有有尺寸的行（含数量留空的「求最大」行）
  let maxRows = 0;
  for (const r of sized) {
    const dims = [toMM(r.l), toMM(r.w), toMM(r.h)];
    const wt = Number(r.wt) || 0;
    if (contVol > 0) {
      const bd = [...dims].sort((a, b) => a - b);
      if (!bd.every((d, i) => d <= cd[i])) oversized += 1;
    }
    if (wt > threshold) heavy += 1;
    if (isMaxRow(r)) maxRows += 1;
  }
  // 「求最大」的上限与提交计算时用的口径完全一致
  const capMap = maxCapsFor(container, rows, mode);
  const maxCaps = sized.filter(isMaxRow).map((r) => {
    const e = capMap.get(r.id) || { cap: 0, layered: 0, volCap: 0 };
    return { id: r.id, cap: e.cap, layered: e.layered, rawCap: e.volCap };
  });
  return {
    pieces,
    cargoVolM3: cargoVol / 1e9,
    contVolM3,
    ratio: contVol > 0 ? cargoVol / contVol : 0,
    weight,
    overVolume: contVol > 0 && cargoVol > contVol,
    oversized,
    heavy,
    maxCaps,
    maxRows,
  };
}
