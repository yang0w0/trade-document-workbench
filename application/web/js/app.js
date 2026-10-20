// 本地 集装箱装箱工作台 —— 网页主逻辑。
// 输入（集装箱、清单、参数）与最近一次结果自动保存在浏览器 localStorage 中，刷新不丢失；
// 恢复出的旧结果会标明是上次的结果，开始新计算时旧结果立即撤下。
import { cancelOnUnload, deleteJSON, downloadFrom, getJSON, postForm, postJSON, putJSON, saveBlob } from './api.js';
import { categoryColor, computeEstimate, escapeHtml, fixed, g, isMaxRow, isSizeRow, isValidRow, typeLabel } from './format.js';
import { PlanViewer } from './viewer3d.js';

const INPUT_KEY = 'local-workbench:inputs:v1';
const RESULT_KEY = 'local-workbench:result:v1';
const CARGO_TYPES = ['木箱', '纸箱', '托盘'];
const POLL_MS = 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  metric: 'none',            // none | weight | volumetric（自动模式下的底层优先指标）
  threshold: 100,
  shipNo: '',
  container: [null, null, null],
  rows: [],
  templates: { products: [], containers: [] },
  containerCount: 1,
  cargoFmt: 'txt',
  result: null,
  highlight: new Set(),
  region: null,
  job: null,
  restored: false,           // 当前显示的结果是否是上次打开网页时留下的
  skipDeleteConfirm: false,  // 「本次使用不再提示删除确认」，仅在当前页面有效
};
let nextRowId = 1;
let viewer = null;

// --------------------------------------------------------------------------- //
//                                  持久化                                     //
// --------------------------------------------------------------------------- //
let saveTimer = 0;
function saveInputs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(INPUT_KEY, JSON.stringify({
        metric: state.metric, threshold: state.threshold,
        shipNo: state.shipNo,
        container: state.container, containerCount: state.containerCount, rows: state.rows.map(stripRow), cargoFmt: state.cargoFmt,
      }));
    } catch { /* 隐私模式或存储已满：不影响使用 */ }
  }, 250);
}

function saveResult() {
  try {
    if (state.result) localStorage.setItem(RESULT_KEY, JSON.stringify(state.result));
    else localStorage.removeItem(RESULT_KEY);
  } catch {
    try { localStorage.removeItem(RESULT_KEY); } catch { /* ignore */ }
  }
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(INPUT_KEY) || 'null');
    if (saved) {
      for (const key of ['metric', 'threshold', 'shipNo', 'cargoFmt']) {
        if (saved[key] !== undefined) state[key] = saved[key];
      }
      if (Array.isArray(saved.container) && saved.container.length === 3) state.container = saved.container;
      state.containerCount = Math.max(1, Number(saved.containerCount) || 1);
      if (Array.isArray(saved.rows)) state.rows = saved.rows.map(newRow);
    }
    const result = JSON.parse(localStorage.getItem(RESULT_KEY) || 'null');
    if (result && result.plan && Array.isArray(result.plan.packing_plan)) {
      state.result = result;
      state.restored = true;
    }
  } catch { /* 存储内容损坏时从空白开始 */ }
}

// --------------------------------------------------------------------------- //
//                                 货物行                                      //
// --------------------------------------------------------------------------- //
function newRow(src = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  return {
    id: nextRowId++,
    l: num(src.l, 0), w: num(src.w, 0), h: num(src.h, 0),
    n: Math.max(0, Math.round(num(src.n, 1))), wt: num(src.wt, 0),
    type: CARGO_TYPES.includes(typeLabel(src.type)) ? typeLabel(src.type) : '木箱',
    no_flip: !!src.no_flip, prio: Math.round(num(src.prio, 0)), desc: String(src.desc ?? ''),
    unit_price: num(src.unit_price, 0), templateId: src.templateId || '', expanded: src.expanded !== false,
  };
}

const stripRow = ({ id, ...row }) => row;

const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

function rowElement(row) {
  const card = document.createElement('details');
  card.className = 'cargo-item'; card.dataset.id = row.id;
  card.open = row.expanded;
  card.innerHTML = `<summary><span class="cargo-item-name"></span><span class="cargo-item-qty"></span></summary>
    <div class="cargo-item-fields">
      <label class="field"><span>商品名称</span><input type="text" data-k="desc" maxlength="200" placeholder="如：电机端盖 M8"></label>
      ${[['l','长(m)'],['w','宽(m)'],['h','高(m)'],['n','数量'],['wt','单件重量(kg)'],['unit_price','单价']].map(([k,l])=>`<label class="field"><span>${l}</span><input type="number" data-k="${k}" min="0" step="${k==='n'?'1':'0.01'}" placeholder="0"></label>`).join('')}
      <label class="field"><span>包装类型</span><select data-k="type">${CARGO_TYPES.map(t=>`<option>${t}</option>`).join('')}</select></label>
      <label class="field check-field"><span>禁止倒放</span><input type="checkbox" data-k="no_flip"></label>
      <label class="field col-prio"><span>底层优先级</span><input type="number" data-k="prio" step="1" placeholder="留空 = 不使用"><small>数值越大越靠底层；填写后优先于重量 / 密度指标</small></label>
    </div><div class="btn-row"><button type="button" class="btn" data-act="save-product">保存商品模板</button>
      <button type="button" class="btn" data-act="del">删除商品</button></div>`;
  for (const key of ['desc','l','w','h','n','wt','unit_price','type','prio']) $(`[data-k="${key}"]`, card).value = String(row[key] ?? '');
  $('[data-k="prio"]', card).value = row.prio === 0 ? '' : String(row.prio);
  $('[data-k="no_flip"]', card).checked = row.no_flip;
  $('[data-k="n"]', card).placeholder = '留空 = 最大装填';
  $('[data-k="n"]', card).title = '填写定量件数；留空或填 0 时，保留其他定量货物并持续填充剩余空间';
  refreshCargoCard(card, row);
  return card;
}

function refreshCargoCard(card, row) {
  $('.cargo-item-name', card).textContent = row.desc || '新商品';
  $('.cargo-item-qty', card).textContent = row.templateId && !row.expanded ? '' : (isMaxRow(row) ? '最大装填' : `数量 ${row.n}`);
}

function renderCargoTable() {
  const list = $('#cargo-cards');
  list.replaceChildren(...state.rows.map(rowElement));
  $('#cargo-empty').hidden = state.rows.length > 0;
  renderSavedTemplates();
  onCargoChanged();
}

function onCargoChanged() {
  renderModeDependent();
  renderEstimate();
  renderExportButton();
  saveInputs();
}

function bindCargoTable() {
  const list = $('#cargo-cards');
  const findRow = (el) => state.rows.find((r) => r.id === Number(el.closest('.cargo-item').dataset.id));
  list.addEventListener('toggle', event => {
    if (!event.target.matches('.cargo-item')) return;
    const row = state.rows.find(r => r.id === Number(event.target.dataset.id));
    if (!row) return;
    row.expanded = event.target.open; refreshCargoCard(event.target, row); saveInputs();
  }, true);
  list.addEventListener('input', (event) => {
    const input = event.target;
    const key = input.dataset.k;
    const row = key && findRow(input);
    if (!row) return;
    if (key === 'desc') row.desc = input.value;
    else if (key === 'no_flip') row.no_flip = input.checked;
    else if (key === 'type') row.type = input.value;
    else {
      const value = input.value === '' ? 0 : Number(input.value);
      row[key] = Number.isFinite(value) ? (key === 'n' || key === 'prio' ? Math.round(value) : value) : 0;
    }
    refreshCargoCard(input.closest('.cargo-item'), row);
    onCargoChanged();
  });
  list.addEventListener('click', async (event) => {
    const saveBtn = event.target.closest('[data-act="save-product"]');
    if (saveBtn) { await saveProductTemplate(findRow(saveBtn)); return; }
    const btn = event.target.closest('[data-act="del"]');
    if (!btn) return;
    const row = findRow(btn);
    if (!state.skipDeleteConfirm) {
      const { ok, skip } = await confirmDialog('删除确认', '确定要删除这一行货物吗？删除后不可恢复。', '确认删除', true);
      if (!ok) return;
      if (skip) state.skipDeleteConfirm = true;
    }
    state.rows = state.rows.filter((r) => r !== row);
    btn.closest('.cargo-item').remove();
    $('#cargo-empty').hidden = state.rows.length > 0;
    onCargoChanged();
  });
}

function confirmDialog(title, text, okLabel, allowSkip = false) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  $('#confirm-skip-wrap').hidden = !allowSkip;
  $('#confirm-skip').checked = false;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve({
      ok: dialog.returnValue === 'ok', skip: $('#confirm-skip').checked,
    }), { once: true });
    dialog.showModal();
  });
}

// --------------------------------------------------------------------------- //
//                             集装箱与计算参数                                 //
// --------------------------------------------------------------------------- //
function renderPresets() {
  const box = $('#presets');
  const presets = state.config?.presets || {};
  box.replaceChildren(...Object.entries(presets).map(([name, dims]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn preset';
    btn.dataset.preset = name;
    btn.innerHTML = `<span>${escapeHtml(name)}</span><small>${dims.map(g).join('×')} m</small>`;
    btn.addEventListener('click', () => {
      state.container = [...dims];
      renderContainerInputs();
      onContainerChanged();
    });
    return btn;
  }));
  markActivePreset();
}

function renderSavedTemplates() {
  const fill = (sel, list, empty) => {
    const select = $(sel);
    select.replaceChildren(new Option(empty, ''), ...list.map(t => new Option(t.name, t.id)));
  };
  const productBox = $('#product-templates');
  if (!state.templates.products.length) {
    const note = document.createElement('p'); note.className = 'caption'; note.textContent = '暂无已保存商品；可在商品卡片中保存常用信息。';
    productBox.replaceChildren(note);
  } else {
    productBox.replaceChildren(...state.templates.products.map(tpl => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn preset product-template'; btn.dataset.templateId = tpl.id;
      const title = document.createElement('span'); title.textContent = tpl.name;
      const values = tpl.values || {};
      const detail = document.createElement('small');
      detail.textContent = [values.l, values.w, values.h].every(v => Number(v) > 0)
        ? `${[values.l, values.w, values.h].map(g).join('×')} m${Number(values.unit_price) ? ` · 单价 ${g(values.unit_price)}` : ''}`
        : '点击添加并补充信息';
      btn.append(title, detail);
      btn.classList.toggle('active', state.rows.some(row => row.templateId === tpl.id));
      btn.setAttribute('aria-pressed', state.rows.some(row => row.templateId === tpl.id) ? 'true' : 'false');
      btn.addEventListener('click', () => applyProductTemplate(tpl.id));
      return btn;
    }));
  }
  fill('#container-template-select', state.templates.containers, '选择已保存柜型');
}

async function saveProductTemplate(row) {
  if (!row?.desc.trim()) { toast('请先填写商品名称，再保存模板。', true); return; }
  const id = row.templateId || crypto.randomUUID().replaceAll('-', '');
  try {
    const item = await putJSON(`/api/templates/products/${id}`, { id, name: row.desc.trim(), values: stripRow(row) });
    row.templateId = item.id; row.expanded = false;
    const card = $(`#cargo-cards .cargo-item[data-id="${row.id}"]`);
    if (card) { card.open = false; refreshCargoCard(card, row); }
    state.templates.products = state.templates.products.filter(t => t.id !== item.id).concat(item);
    renderSavedTemplates(); saveInputs(); toast('商品模板已保存到后端。');
  } catch (err) { toast(`保存失败：${err.message}`, true); }
}

async function saveContainerTemplate() {
  const name = $('#container-template-name').value.trim();
  const [l, w, h] = state.container.map(Number);
  if (!name || ![l,w,h].every(v => v > 0)) { toast('请填写模板名称及有效的集装箱长、宽、高。', true); return; }
  const id = crypto.randomUUID().replaceAll('-', '');
  try {
    const item = await putJSON(`/api/templates/containers/${id}`, { id, name, values: { l, w, h, count: state.containerCount } });
    state.templates.containers.push(item); renderSavedTemplates(); $('#container-template-name').value = ''; toast('集装箱模板已保存到后端。');
  } catch (err) { toast(`保存失败：${err.message}`, true); }
}

function applyProductTemplate(id) {
  const tpl = state.templates.products.find(t => t.id === id);
  if (!tpl) return;
  const row = newRow({ ...tpl.values, n: 1, templateId: tpl.id });
  state.rows.push(row); renderCargoTable(); renderSavedTemplates();
  const card = $(`#cargo-cards .cargo-item[data-id="${row.id}"]`); card.open = true; $('[data-k="n"]', card).focus();
}

function markActivePreset() {
  const presets = state.config?.presets || {};
  for (const btn of $$('#presets .preset')) {
    const dims = presets[btn.dataset.preset];
    const active = dims && dims.every((d, i) => Math.abs(d - Number(state.container[i])) < 1e-9);
    btn.classList.toggle('active', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function renderContainerInputs() {
  ['#c-l', '#c-w', '#c-h'].forEach((sel, i) => {
    const v = state.container[i];
    $(sel).value = v === null || v === undefined ? '' : String(v);
  });
  $('#container-count').value = String(state.containerCount);
}

function onContainerChanged() {
  markActivePreset();
  renderEstimate();
  saveInputs();
}

function renderParams() {
  $(`input[name="cargo-fmt"][value="${state.cargoFmt}"]`).checked = true;
  $('#m-weight').checked = state.metric === 'weight';
  $('#m-vol').checked = state.metric === 'volumetric';
  $('#threshold').value = String(state.threshold);
  $('#ship-no').value = state.shipNo;
  renderModeDependent();
}

function renderModeDependent() {
  $('#metric-none-hint').hidden = state.metric !== 'none';
  $('#metric-none-hint').textContent = bottomMetric() === 'manual'
    ? '已使用产品底层优先级；清空优先级后恢复自动排布。'
    : '两项均未启用：优先最大化空间利用率，同体积下再比较装入件数。';
  $('#cargo-caption').textContent = '数量留空或填 0 = 最大装填；底层优先级选填，数值越大越靠底层，留空不使用。';
}

// 沿用装箱接口的优先级策略，页面始终自动选择，无需切换工作模式。
function bottomMetric() {
  return state.rows.some(row => isSizeRow(row) && Number(row.prio || 0) !== 0) ? 'manual' : state.metric;
}

function bindParams() {
  // 两个底层优先指标互斥
  $('#m-weight').addEventListener('change', (e) => {
    state.metric = e.target.checked ? 'weight' : 'none';
    $('#m-vol').checked = false;
    renderModeDependent(); renderEstimate(); saveInputs();
  });
  $('#m-vol').addEventListener('change', (e) => {
    state.metric = e.target.checked ? 'volumetric' : 'none';
    $('#m-weight').checked = false;
    renderModeDependent(); renderEstimate(); saveInputs();
  });
  $('#threshold').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.threshold = Number.isFinite(v) && e.target.value !== '' ? v : 0;
    renderEstimate(); saveInputs();
  });
  $('#ship-no').addEventListener('input', (e) => { state.shipNo = e.target.value; saveInputs(); renderShipCaption(); });
  ['#c-l', '#c-w', '#c-h'].forEach((sel, i) => {
    $(sel).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      state.container[i] = e.target.value === '' || !Number.isFinite(v) ? null : v;
      onContainerChanged();
    });
  });
  $('#container-count').addEventListener('input', e => {
    state.containerCount = Math.max(1, Math.round(Number(e.target.value) || 1));
    saveInputs();
  });
}

// --------------------------------------------------------------------------- //
//                                实时预估                                     //
// --------------------------------------------------------------------------- //
function metricHtml(label, value, cls = '') {
  return `<div class="metric"><div class="m-label">${label}</div><div class="m-value ${cls}">${value}</div></div>`;
}

function renderEstimate() {
  const container = state.container.map((v) => Number(v) || 0);
  const est = computeEstimate(container, state.rows, state.threshold);
  $('#estimate-metrics').innerHTML = metricHtml('货物件数', est.maxRows ? `${est.pieces}（另有 ${est.maxRows} 类求最大）` : String(est.pieces))
    + metricHtml(est.maxRows ? '定量货物体积' : '货物总体积', `${fixed(est.cargoVolM3, 2)} m³`)
    + metricHtml('体积占集装箱', `${fixed(est.ratio * 100, 1)}%`)
    + metricHtml('货物总重', `${fixed(est.weight, 0)} kg`);
  const bar = $('#estimate-bar');
  bar.style.width = `${Math.min(est.ratio, 1) * 100}%`;
  bar.classList.toggle('over', est.overVolume);
  const alerts = [];
  if (est.maxRows) {
    alerts.push('<div class="alert info">数量留空 = 最大装填：先保留定量货物，再搜索并补充剩余空间。</div>');
  }
  if (est.overVolume) {
    alerts.push(`<div class="alert err">货物总体积 ${fixed(est.cargoVolM3, 2)} m³ 已超过集装箱 ${fixed(est.contVolM3, 2)} m³，必然装不下。</div>`);
  }
  if (est.oversized) {
    alerts.push(`<div class="alert warn">有 ${est.oversized} 类货物任意摆放都超过集装箱内尺寸，无法装入。</div>`);
  }
  if (est.heavy) {
    const how = bottomMetric() === 'manual'
      ? '已按产品底层优先级安排装载顺序。'
      : bottomMetric() === 'weight'
      ? '已启用「按重量优先」，将优先放到底层（实在放不下时仍允许叠放）。'
      : '如需让重货优先压在底层，可开启「按重量优先」。';
    alerts.push(`<div class="alert info">有 ${est.heavy} 类为重货（&gt;${g(state.threshold)} kg）。${how}</div>`);
  }
  $('#estimate-alerts').innerHTML = alerts.join('');
}

function renderExportButton() {
  const n = state.rows.filter(isSizeRow).length;
  const btn = $('#btn-export-cargo');
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? '清单为空，暂无可导出内容' : `导出货物清单（${n} 类 · ${state.cargoFmt}）`;
}

// --------------------------------------------------------------------------- //
//                                 计算任务                                    //
// --------------------------------------------------------------------------- //
function setMsg(sel, text, kind = 'err') {
  const el = $(sel);
  el.textContent = text || '';
  el.className = `form-msg ${kind}`;
}

let toastTimer = 0;
function toast(text, isError = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3500);
}

async function startCompute() {
  setMsg('#compute-msg', '');
  if (state.job) return;
  if (!state.container.every((v) => Number(v) > 0)) {
    setMsg('#compute-msg', '请填写有效的集装箱尺寸（长/宽/高均需大于 0）。');
    return;
  }
  if (!state.rows.some(isSizeRow)) {
    setMsg('#compute-msg', '货物清单为空或没有有效行，请至少填写一行有效货物。');
    return;
  }
  const body = {
    container: state.container.map(Number),
    rows: state.rows.filter(isSizeRow).map(stripRow),
    ship_no: state.shipNo,
    mode: 'standard',
    budget: 600,
    bottom_metric: bottomMetric(),
    threshold: state.threshold,
  };
  setComputing(true);
  renderJob({ status: 'queued', mode: body.mode, budget: body.budget, position: 0 });
  try {
    const snap = await postJSON('/api/jobs', body);
    // 新任务已受理：旧结果作废，避免计算过程中被误当成本次结果
    state.job = { id: snap.id, failures: 0, timer: 0 };
    clearResult();
    handleSnapshot(snap);
  } catch (err) {
    setComputing(false);
    setMsg('#compute-msg', err.message);
  }
}

function schedulePoll(delay = POLL_MS) {
  if (!state.job) return;
  clearTimeout(state.job.timer);
  state.job.timer = setTimeout(pollJob, delay);
}

async function pollJob() {
  const job = state.job;
  if (!job) return;
  try {
    const snap = await getJSON(`/api/jobs/${job.id}`);
    if (state.job !== job) return;
    job.failures = 0;
    handleSnapshot(snap);
  } catch (err) {
    if (state.job !== job) return;
    job.failures += 1;
    if (job.failures >= 5 || /不存在|过期/.test(err.message)) {
      finishJob();
      setMsg('#compute-msg', `计算状态获取失败：${err.message}`);
    } else {
      schedulePoll(POLL_MS * 2);
    }
  }
}

function handleSnapshot(snap) {
  if (snap.status === 'queued' || snap.status === 'running') {
    renderJob(snap);
    schedulePoll();
    return;
  }
  finishJob();
  if (snap.status === 'done') {
    const result = { ...snap.result, elapsed: snap.elapsed, computed_at: Date.now() };
    applyResult(result);
    saveResult();
    toast(result.maxFlags?.some(Boolean) ? '最大装填搜索完成。' : (result.fits ? '计算完成，全部货物已装入。' : '计算完成，部分货物未能装入。'));
    $('#result-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (snap.status === 'error') {
    setMsg('#compute-msg', `计算失败：${snap.error || '未知错误'}`);
    toast('计算失败', true);
  } else {
    toast('已取消计算');
  }
}

function renderJob(snap) {
  const bar = $('#calc-bar');
  if (snap.status === 'queued') {
    const ahead = Math.max(0, (snap.position || 1) - 1);
    $('#calc-text').textContent = '正在排队…';
    $('#calc-sub').textContent = ahead > 0 ? `服务器正在处理其他计算，前面还有 ${ahead} 个任务` : '即将开始计算';
    bar.classList.add('indeterminate');
    return;
  }
  const elapsed = snap.elapsed || 0;
  $('#calc-text').textContent = '正在计算最优装箱方案…';
  if (snap.mode === 'enhanced') {
    $('#calc-sub').textContent = `已搜索 ${Math.round(elapsed)} 秒 / 上限 ${Math.round(snap.budget)} 秒（找到全部装入的方案会提前结束）`;
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.min(100, (elapsed / snap.budget) * 100)}%`;
  } else {
    $('#calc-sub').textContent = `正在尝试多种装载策略与货物朝向，已用 ${Math.round(elapsed)} 秒`;
    bar.classList.add('indeterminate');
  }
}

function setComputing(on) {
  $('#calc-card').hidden = !on;
  $('#btn-compute').disabled = on;
  $('#btn-load-plan').disabled = on;
  // 计算进行中不显示任何旧结果
  $('#result-area').hidden = on || !state.result;
  $('#empty-hint').hidden = on || !!state.result;
  if (on) {
    $('#calc-bar').style.width = '0';
    $('#calc-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function finishJob() {
  if (state.job) clearTimeout(state.job.timer);
  state.job = null;
  setComputing(false);
}

async function cancelCompute() {
  const job = state.job;
  if (!job) return;
  finishJob();
  toast('已取消计算');
  try { await postJSON(`/api/jobs/${job.id}/cancel`, {}); } catch { /* 任务可能刚好结束 */ }
}

// --------------------------------------------------------------------------- //
//                                  结果                                       //
// --------------------------------------------------------------------------- //
function categoryInfo(plan) {
  const placed = new Map();
  for (const item of plan.packing_plan) {
    const io = item.box_info.input_order;
    placed.set(io, (placed.get(io) || 0) + 1);
  }
  return plan.boxes.map((b, io) => ({
    io, category: io + 1, l: b[0], w: b[1], h: b[2], total: Number(b[3]), weight: Number(b[4]),
    type: typeLabel(b[5]), desc: String(b[6] ?? '').trim(), placed: placed.get(io) || 0,
  }));
}

function clearResult() {
  state.result = null;
  state.restored = false;
  saveResult();
  $('#result-area').hidden = true;
  $('#empty-hint').hidden = !!state.job;
}

function applyResult(result, { restored = false } = {}) {
  state.result = result;
  state.restored = restored;
  const cats = categoryInfo(result.plan);
  state.highlight = new Set(cats.map((c) => c.category));
  $('#result-area').hidden = false;
  $('#empty-hint').hidden = true;
  renderOverview();
  renderLegend(cats);
  renderTables(cats);
  if (viewer && viewer.supported) {
    viewer.setPlan(result.plan);
    viewer.setHighlight(state.highlight);
  }
  buildRanges();
}

function formatTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${d.getMonth() + 1}月${d.getDate()}日`;
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderShipCaption() {
  const { computed_at: at } = state.result || {};
  const parts = [];
  if (state.shipNo) parts.push(`发货单号：${state.shipNo}`);
  if (at) parts.push(`计算时间：${formatTime(at)}`);
  const el = $('#result-ship');
  el.hidden = !parts.length;
  el.textContent = parts.join('　·　');
}

function renderOverview() {
  const { stats, fits, note, mode } = state.result;
  const msg = (state.result.msg || '').replaceAll('已达到搜索时间，可用增强版继续优化。', '已达到本次搜索时间上限。');
  renderShipCaption();
  let last;
  if (mode === 'enhanced') last = metricHtml('搜索评估 / 用时', `${stats.evaluations} 次 / ${stats.seconds}s`);
  else if (mode === 'imported') last = metricHtml('方案来源', '已保存方案');
  else last = metricHtml('计算用时', `${g(state.result.elapsed ?? stats.seconds ?? 0)} s`);
  const maximizing = state.result.maxFlags?.some(Boolean);
  $('#result-metrics').innerHTML = metricHtml(maximizing ? '当前已找到可装量' : '装入 / 总数', maximizing ? `${stats.placed} 件` : `${stats.placed} / ${stats.total}`)
    + metricHtml('空间利用率', `${fixed(stats.utilization * 100, 1)}%`)
    + metricHtml(maximizing ? '定量货物是否装完' : '是否全部装入', fits ? '是' : '否', fits ? 'good' : 'bad')
    + last;
  const alerts = [];
  if (maximizing) {
    const cats = categoryInfo(state.result.plan);
    const detail = cats.filter(c => state.result.maxFlags[c.io]).map(c => `${escapeHtml(c.desc || `类别 ${c.category}`)}：${c.placed} 件`).join('；');
    alerts.push(`<div class="alert info">最大装填：${detail}。${escapeHtml(msg)}${stats.optimal_full ? '体积已填满。' : '该结果未证明为全局最优。'}</div>`);
  }
  if (state.restored) {
    const at = state.result.computed_at;
    alerts.push(`<div class="alert info stale">
      <span>这是上次${at ? `（${escapeHtml(formatTime(at))}）` : ''}留下的结果，不是本次新算的；修改清单后请重新点击「开始计算」。</span>
      <button type="button" class="btn small" data-act="clear-result">清除此结果</button></div>`);
  }
  if (!fits) {
    const why = msg || `装入 ${stats.placed}/${stats.total} 件`;
    alerts.push(`<div class="alert warn">未能全部装入：${escapeHtml(why)}</div>`);
  }
  if (note) alerts.push(`<div class="alert info">${escapeHtml(note)}</div>`);
  $('#result-alerts').innerHTML = alerts.join('');
}

function renderLegend(cats) {
  const legend = $('#legend');
  legend.replaceChildren(...cats.map((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.category = c.category;
    const lead = c.desc || `类别${c.category}`;
    const full = c.placed >= c.total;
    // 数量为本方案实际装入的件数；未全部装入时附上应装总数，避免与清单数量混淆
    const qty = full ? `已装${c.placed}件` : `已装${c.placed}/${c.total}件`;
    btn.innerHTML = `<span class="sw" style="background:${categoryColor(c.io)}"></span>`
      + `<span class="chip-text">${escapeHtml(lead)}: ${g(c.l)}×${g(c.w)}×${g(c.h)}m (${escapeHtml(c.type)}, `
      + `<span class="qty${full ? '' : ' short'}">${qty}</span>)</span>`;
    btn.title = `${lead}：应装 ${c.total} 件，本方案装入 ${c.placed} 件`;
    if (c.placed === 0) btn.disabled = true;
    btn.setAttribute('aria-pressed', state.highlight.has(c.category) ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.highlight.has(c.category)) state.highlight.delete(c.category);
      else state.highlight.add(c.category);
      syncHighlight();
    });
    return btn;
  }));
}

function syncHighlight() {
  for (const chip of $$('#legend .chip')) {
    chip.setAttribute('aria-pressed', state.highlight.has(Number(chip.dataset.category)) ? 'true' : 'false');
  }
  if (viewer) viewer.setHighlight(state.highlight);
}

// ---------------- 分段查看（三个方向的双端滑块） ---------------- //
const AXES = [
  { key: 'x', label: '长度方向 Length（装货方向）' },
  { key: 'y', label: '宽度方向 Width' },
  { key: 'z', label: '高度方向 Height' },
];

function buildRanges() {
  const dims = state.result.plan.container.map(Number);
  const box = $('#ranges');
  box.replaceChildren(...AXES.map((axis, i) => {
    const max = dims[i];
    const step = max / 100; // 100 档，保证滑块能精确停在两端
    const wrap = document.createElement('div');
    wrap.className = 'range';
    wrap.innerHTML = `
      <div class="range-head"><span>${axis.label}</span><output></output></div>
      <div class="dual"><div class="fill"></div>
        <input type="range" class="lo" min="0" max="${max}" step="${step}" value="0" aria-label="${axis.label} 起点">
        <input type="range" class="hi" min="0" max="${max}" step="${step}" value="${max}" aria-label="${axis.label} 终点">
      </div>`;
    const lo = $('.lo', wrap);
    const hi = $('.hi', wrap);
    const update = (moved) => {
      let a = Number(lo.value);
      let b = Number(hi.value);
      if (a > b) {
        if (moved === lo) { a = b; lo.value = String(b); } else { b = a; hi.value = String(a); }
      }
      lo.style.zIndex = a > max - step * 1.5 ? '3' : '1';
      $('.fill', wrap).style.left = `${(a / max) * 100}%`;
      $('.fill', wrap).style.width = `${((b - a) / max) * 100}%`;
      $('output', wrap).textContent = `${g(a)} ~ ${g(b)} m`;
      scheduleRegion();
    };
    lo.addEventListener('input', () => update(lo));
    hi.addEventListener('input', () => update(hi));
    wrap.reset = () => { lo.value = '0'; hi.value = String(max); update(hi); };
    wrap.read = () => {
      // 滑块位于两端时视为不限制，避免步长取整漏掉边缘货物
      const a = Number(lo.value);
      const b = Number(hi.value);
      return [a <= step / 2 ? -Infinity : a, b >= max - step / 2 ? Infinity : b];
    };
    update(hi);
    return wrap;
  }));
}

let regionFrame = 0;
function scheduleRegion() {
  if (regionFrame) return;
  regionFrame = requestAnimationFrame(() => {
    regionFrame = 0;
    const ranges = $$('#ranges .range');
    if (ranges.length !== 3 || !viewer) return;
    const r = ranges.flatMap((el) => el.read());
    const full = r.every((v, i) => (i % 2 === 0 ? v === -Infinity : v === Infinity));
    viewer.setRegion(full ? null : r);
  });
}

// ---------------- 汇总 / 明细表 ---------------- //
function renderTables(cats) {
  const head = (cols) => `<thead><tr>${cols.map(([t, cls]) => `<th class="${cls || ''}">${t}</th>`).join('')}</tr></thead>`;
  $('#summary-table').innerHTML = head([
    ['类别'], ['零件描述'], ['类型'], ['规格(长×宽×高 m)'], ['应装', 'num'], ['已装', 'num'], ['未装', 'num'],
    ['单件重量(kg)', 'num'], ['已装重量(kg)', 'num'], ['已装体积(m³)', 'num'],
  ]) + `<tbody>${cats.map((c) => `<tr>
      <td><span class="sw" style="background:${categoryColor(c.io)}"></span>${c.category}</td>
      <td>${escapeHtml(c.desc)}</td><td>${escapeHtml(c.type)}</td>
      <td>${g(c.l)}×${g(c.w)}×${g(c.h)}</td>
      <td class="num">${state.result.maxFlags?.[c.io] ? '求最大' : c.total}</td><td class="num">${c.placed}</td>
      <td class="num ${c.total - c.placed > 0 ? 'short' : ''}">${c.total - c.placed}</td>
      <td class="num">${g(c.weight)}</td><td class="num">${fixed(c.weight * c.placed, 1)}</td>
      <td class="num">${fixed(c.l * c.w * c.h * c.placed, 3)}</td></tr>`).join('')}</tbody>`;

  const items = [...state.result.plan.packing_plan].sort((a, b) => a.box_info.number - b.box_info.number);
  const m = (v) => fixed(v, 3);
  $('#detail-table').innerHTML = head([
    ['装载顺序', 'num'], ['类别', 'num'], ['零件描述'], ['类型'], ['原始规格(长×宽×高 m)'],
    ['摆放长(m)', 'num'], ['摆放宽(m)', 'num'], ['摆放高(m)', 'num'],
    ['位置X起点(m)', 'num'], ['位置Y起点(m)', 'num'], ['位置Z起点(m)', 'num'], ['重量(kg)', 'num'],
  ]) + `<tbody>${items.map(({ position: p, dimensions: d, box_info: info }) => {
    const [ol, ow, oh] = info.original_dimensions;
    return `<tr><td class="num">${info.number}</td><td class="num">${info.input_order + 1}</td>
      <td>${escapeHtml(info.desc || '')}</td><td>${escapeHtml(typeLabel(info.type))}</td>
      <td>${g(ol)}×${g(ow)}×${g(oh)}</td>
      <td class="num">${m(d[0])}</td><td class="num">${m(d[1])}</td><td class="num">${m(d[2])}</td>
      <td class="num">${m(p[0])}</td><td class="num">${m(p[1])}</td><td class="num">${m(p[2])}</td>
      <td class="num">${g(info.weight)}</td></tr>`;
  }).join('')}</tbody>`;
}

// --------------------------------------------------------------------------- //
//                                导入 / 导出                                   //
// --------------------------------------------------------------------------- //
function bindFilePick(input) {
  const label = input.closest('.file-pick');
  const name = $('.file-name', label);
  input.addEventListener('change', () => {
    const file = input.files[0];
    name.textContent = file ? file.name : name.dataset.empty;
    label.classList.toggle('has-file', !!file);
  });
}

function resetFilePick(input) {
  input.value = '';
  input.dispatchEvent(new Event('change'));
}

function applyImportedInputs(data) {
  state.container = data.container.map(Number);
  state.shipNo = data.ship_no || '';
  state.rows = data.rows.map(newRow);
  renderContainerInputs();
  $('#ship-no').value = state.shipNo;
  markActivePreset();
  renderCargoTable();
}

async function importCargo() {
  const fileInput = $('#cargo-file');
  const text = $('#cargo-text').value;
  const fd = new FormData();
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);
  else if (text.trim()) fd.append('text', text);
  else { setMsg('#import-msg', '请先选择文件或粘贴文本。'); return; }
  setMsg('#import-msg', '正在导入…', 'ok');
  try {
    applyImportedInputs(await postForm('/api/cargo/import', fd));
    resetFilePick(fileInput);
    setMsg('#import-msg', '已导入，请在上方核对后点击“开始计算”。', 'ok');
  } catch (err) {
    setMsg('#import-msg', err.message);
  }
}

async function exportCargo() {
  const body = {
    container: state.container.map((v) => Number(v) || 0),
    ship_no: state.shipNo,
    rows: state.rows.filter(isValidRow).map(stripRow),
  };
  try {
    await downloadFrom(`/api/cargo/export?fmt=${state.cargoFmt}`, body, `货物清单.${state.cargoFmt}`);
  } catch (err) {
    toast(`导出失败：${err.message}`, true);
  }
}

async function loadSavedPlan() {
  const input = $('#plan-file');
  const file = input.files[0];
  if (!file) { setMsg('#plan-msg', '请先选择 JSON 或 XLSX 方案文件。'); return; }
  const fd = new FormData();
  fd.append('file', file);
  setMsg('#plan-msg', '正在载入…', 'ok');
  try {
    const data = await postForm('/api/plan/import', fd);
    applyImportedInputs(data);
    applyResult(data.result);
    saveResult();
    resetFilePick(input);
    setMsg('#plan-msg', '方案已载入，集装箱尺寸、货物清单和装箱结果均已恢复。', 'ok');
    $('#result-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setMsg('#plan-msg', err.message);
  }
}

async function downloadPlanXlsx() {
  const { plan, stats } = state.result;
  try {
    await downloadFrom('/api/plan/xlsx', { plan, stats, ship_no: state.shipNo }, 'packing_plan.xlsx');
  } catch (err) {
    toast(`导出失败：${err.message}`, true);
  }
}

function downloadPlanJson() {
  // 与 Python 版 json.dumps(indent=4, ensure_ascii=False) 的结构一致，可直接再导入
  const plan = { ...state.result.plan, ship_no: state.shipNo };
  saveBlob(new Blob([JSON.stringify(plan, null, 4)], { type: 'application/json' }), 'packing_plan.json');
}

// --------------------------------------------------------------------------- //
//                                   启动                                      //
// --------------------------------------------------------------------------- //
function bindActions() {
  $('#btn-save-container').addEventListener('click', saveContainerTemplate);
  $('#btn-apply-container').addEventListener('click', () => {
    const tpl = state.templates.containers.find(t => t.id === $('#container-template-select').value);
    if (!tpl) return;
    state.container = [tpl.values.l, tpl.values.w, tpl.values.h]; state.containerCount = tpl.values.count || 1; renderContainerInputs(); onContainerChanged(); saveInputs();
  });
  $('#btn-add-row').addEventListener('click', () => {
    const row = newRow();
    state.rows.push(row);
    $('#cargo-cards').append(rowElement(row));
    $('#cargo-empty').hidden = true;
    onCargoChanged();
    $(`#cargo-cards .cargo-item[data-id="${row.id}"] [data-k="desc"]`).focus();
  });
  $('#btn-clear').addEventListener('click', async () => {
    if (!state.rows.length) return;
    const { ok } = await confirmDialog('清空清单', `确定要清空全部 ${state.rows.length} 行货物吗？`, '确认清空');
    if (!ok) return;
    state.rows = [];
    renderCargoTable();
  });
  $('#btn-sample').addEventListener('click', () => {
    if (!state.config) { toast('示例数据尚未加载，请稍后再试', true); return; }
    state.rows = state.config.sample.rows.map(newRow);
    state.container = [...state.config.sample.container];
    renderContainerInputs();
    markActivePreset();
    renderCargoTable();
  });
  for (const radio of $$('input[name="cargo-fmt"]')) {
    radio.addEventListener('change', () => { state.cargoFmt = radio.value; renderExportButton(); saveInputs(); });
  }
  $('#btn-export-cargo').addEventListener('click', exportCargo);
  $('#btn-import').addEventListener('click', importCargo);
  $('#btn-compute').addEventListener('click', startCompute);
  $('#btn-cancel').addEventListener('click', cancelCompute);
  $('#btn-load-plan').addEventListener('click', loadSavedPlan);
  bindFilePick($('#cargo-file'));
  bindFilePick($('#plan-file'));

  $('#btn-hl-all').addEventListener('click', () => {
    state.highlight = new Set(categoryInfo(state.result.plan).map((c) => c.category));
    syncHighlight();
  });
  $('#btn-hl-none').addEventListener('click', () => { state.highlight = new Set(); syncHighlight(); });
  $('#btn-reset-range').addEventListener('click', () => {
    for (const el of $$('#ranges .range')) el.reset();
  });
  $('#opt-translucent').addEventListener('change', (e) => viewer && viewer.setTranslucent(e.target.checked));
  $('#opt-edges').addEventListener('change', (e) => viewer && viewer.setEdges(e.target.checked));
  for (const btn of $$('.viewer-toolbar [data-view]')) {
    btn.addEventListener('click', () => viewer && viewer.setView(btn.dataset.view));
  }
  $('#btn-shot').addEventListener('click', async () => {
    if (!viewer || !viewer.supported) return;
    const blob = await viewer.snapshot();
    if (blob) saveBlob(blob, `装箱方案${state.shipNo ? `-${state.shipNo}` : ''}.png`);
  });
  $('#btn-full').addEventListener('click', () => {
    const wrap = $('#viewer-wrap');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => toast('浏览器不允许全屏', true));
  });
  document.addEventListener('fullscreenchange', () => {
    $('#btn-full').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
  for (const tab of $$('.tabs [data-tab]')) {
    tab.addEventListener('click', () => {
      for (const t of $$('.tabs [data-tab]')) t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      $('#tab-summary').hidden = tab.dataset.tab !== 'summary';
      $('#tab-detail').hidden = tab.dataset.tab !== 'detail';
    });
  }
  $('#result-alerts').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="clear-result"]')) clearResult();
  });
  $('#btn-dl-xlsx').addEventListener('click', downloadPlanXlsx);
  $('#btn-dl-json').addEventListener('click', downloadPlanJson);

  // 页面回到前台时立即刷新计算状态；页面关闭时通知服务器停止计算
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.job) schedulePoll(0);
  });
  window.addEventListener('pagehide', () => { if (state.job) cancelOnUnload(state.job.id); });
}

async function init() {
  restoreState();
  renderParams();
  renderContainerInputs();
  bindParams();
  bindCargoTable();
  bindActions();
  renderCargoTable();

  viewer = new PlanViewer($('#viewer'), { tooltip: $('#viewer-tip'), info: $('#viewer-info') });
  if (!viewer.supported) {
    $('#viewer-fallback').hidden = false;
    $('.viewer-toolbar').hidden = true;
  }
  if (state.result) {
    try { applyResult(state.result, { restored: true }); } catch { clearResult(); }
  }

  try {
    state.config = await getJSON('/api/config');
    state.templates = await getJSON('/api/templates');
    renderSavedTemplates();
    renderPresets();
  } catch (err) {
    toast(`无法连接服务器：${err.message}`, true);
  }
}

init();
