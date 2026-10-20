import { getJSON, postForm, putJSON, deleteJSON, saveBlob } from './api.js';

const STORAGE_KEY = 'trade-document-record.v1';
const IMPORT_POSITION_KEY = 'trade-document-import-position.v1';
const groups = ['单据', '交易方', '产品', '运输', '付款', '包装', '自定义'];
let activeFieldGroup = '单据';
let manuallySelectedFieldGroup = false;
let maxFieldsCardHeight = 0;
const ui = {
  container: document.querySelector('#container-shell'),
  documents: document.querySelector('#documents-shell'),
  tabs: [...document.querySelectorAll('[data-module-tab]')],
  input: document.querySelector('#td-file-input'),
  drop: document.querySelector('#td-drop-zone'),
  importDialog: document.querySelector('#td-import-dialog'),
  openImport: document.querySelector('#td-open-import'),
  closeImport: document.querySelector('#td-close-import'),
  fileCount: document.querySelector('#td-file-count'),
  dropConfirm: document.querySelector('#td-drop-confirm'),
  droppedFiles: document.querySelector('#td-dropped-files'),
  confirmDrop: document.querySelector('#td-confirm-drop'),
  cancelDrop: document.querySelector('#td-cancel-drop'),
  pageDrop: document.querySelector('#td-page-drop'),
  fileList: document.querySelector('#td-file-list'),
  extract: document.querySelector('#td-extract-btn'),
  clearFiles: document.querySelector('#td-clear-files-btn'),
  clearAll: document.querySelector('#td-clear-files-and-fields-btn'),
  skipReview: document.querySelector('#td-skip-candidate-review'),
  reviewCandidates: document.querySelector('#td-review-candidates'),
  status: document.querySelector('#td-import-status'),
  summary: document.querySelector('#td-source-summary'),
  groupTiles: document.querySelector('#td-group-tiles'),
  fieldGroups: document.querySelector('#td-field-groups'),
  bottomSpace: document.querySelector('#documents-bottom-space'),
  unmatchedWrap: document.querySelector('#td-unmatched-wrap'),
  unmatched: document.querySelector('#td-unmatched-text'),
  save: document.querySelector('#td-save-btn'),
  exportFields: document.querySelector('#td-export-fields-btn'),
  importFields: document.querySelector('#td-import-fields-input'),
  restore: document.querySelector('#td-restore-btn'),
  reset: document.querySelector('#td-reset-btn'),
  saveState: document.querySelector('#td-save-state'),
};

let selectedFiles = [];
let isExtracting = false;
let pendingDropFiles = [];
let dragDepth = 0;

function openImport() {
  if (!ui.importDialog.open) {
    if (ui.skipReview) ui.skipReview.checked = false;
    ui.importDialog.showModal();
  }
}

function initFloatingImport() {
  const button = ui.openImport;
  let position = { x: 16, y: Math.round(window.innerHeight * .45) };
  try {
    const saved = JSON.parse(localStorage.getItem(IMPORT_POSITION_KEY));
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) position = saved;
  } catch { /* 无法读取位置时使用默认位置。 */ }
  const place = () => {
    const margin = 8;
    position.x = Math.max(margin, Math.min(position.x, window.innerWidth - (button.offsetWidth || 104) - margin));
    position.y = Math.max(margin, Math.min(position.y, window.innerHeight - (button.offsetHeight || 120) - margin));
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
  };
  let drag = null;
  let suppressClick = false;
  button.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position }, moved: false };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    suppressClick = true;
    button.classList.add('is-moving');
    position = { x: drag.origin.x + dx, y: drag.origin.y + dy };
    place();
  });
  const finishDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) {
      try { localStorage.setItem(IMPORT_POSITION_KEY, JSON.stringify(position)); }
      catch { /* 浏览器禁用存储时仍允许移动按钮。 */ }
    }
    drag = null;
    button.classList.remove('is-moving');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  };
  button.addEventListener('pointerup', finishDrag);
  button.addEventListener('pointercancel', finishDrag);
  button.addEventListener('lostpointercapture', finishDrag);
  button.addEventListener('click', (event) => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    openImport();
  });
  window.addEventListener('resize', place);
  new ResizeObserver(place).observe(button);
  place();
}

function resetDrag() {
  dragDepth = 0;
  ui.pageDrop.hidden = true;
}

function receiveDrop(event) {
  if (![...event.dataTransfer?.types || []].includes('Files')) return;
  event.preventDefault();
  resetDrag();
  if (isExtracting) return;
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  pendingDropFiles = [...new Map([...pendingDropFiles, ...files].map(file => [fileKey(file), file])).values()];
  ui.droppedFiles.replaceChildren(...pendingDropFiles.map(file => {
    const item = document.createElement('li');
    item.textContent = file.name;
    return item;
  }));
  if (!ui.dropConfirm.open) ui.dropConfirm.showModal();
}
let processedDocuments = [];
let fieldDefinitions = [];
let unmatchedRows = [];
let customFields = [];
let editedValues = {};
let retainedValues = {};
let productTemplates = [];
let productTemplateFlash = { id: '', until: 0 };
let sectionTemplates = [];
let overallTemplates = [];
let products = [];
let productsManuallyCleared = false;
const collapsedProducts = new WeakSet();

const PRODUCT_TEMPLATE_FIELDS = [
  'item_description', 'item_specification', 'hs_code', 'quantity', 'unit_price',
  'amount', 'currency', 'production_date', 'sample_quantity', 'batch_no',
];

function productFieldIds() {
  return PRODUCT_TEMPLATE_FIELDS;
}

function reusableProductValues(values) {
  return Object.fromEntries(productFieldIds().filter(id => Object.hasOwn(values, id)).map(id => [id, values[id]]));
}

function normalize(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function normalizeFieldGroup(group) {
  if (['货物', '商品', '产品'].includes(group)) return '产品';
  if (['包装与重量', '包装和重量', '包装'].includes(group)) return '包装';
  return group || '其他';
}

function setModule(name) {
  const isDocuments = name === 'documents';
  ui.container.hidden = isDocuments;
  ui.documents.hidden = !isDocuments;
  ui.tabs.forEach((tab) => {
    const active = tab.dataset.moduleTab === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  localStorage.setItem('main-module', name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fileKey(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function addFiles(files) {
  if (isExtracting) return;
  const seen = new Set(selectedFiles.map((entry) => fileKey(entry.file)));
  for (const file of files) {
    if (!seen.has(fileKey(file))) {
      selectedFiles.push({ id: crypto.randomUUID(), file, state: '等待识别', result: null, error: '' });
      seen.add(fileKey(file));
    }
  }
  renderFiles();
}

function renderFiles() {
  ui.fileList.replaceChildren();
  if (!selectedFiles.length) {
    const empty = document.createElement('p');
    empty.className = 'td-empty';
    empty.textContent = '尚未选择文件';
    ui.fileList.append(empty);
  } else {
    for (const entry of selectedFiles) {
      const row = document.createElement('div');
      row.className = 'td-file-row';
      const icon = document.createElement('span');
      icon.className = 'td-file-icon';
      icon.textContent = entry.file.name.split('.').pop()?.slice(0, 5) || 'DOC';
      const meta = document.createElement('div');
      meta.className = 'td-file-meta';
      const previewable = /\.(docx?|pdf|xlsx?)$/i.test(entry.file.name);
      const name = document.createElement(previewable ? 'button' : 'div');
      name.className = 'td-file-name';
      name.textContent = entry.file.name;
      if (previewable) {
        name.type = 'button';
        name.classList.add('document-source-link');
        name.title = '查看来源文件';
        name.disabled = isExtracting;
        name.addEventListener('click', () => /\.xlsx?$/i.test(entry.file.name)
          ? openWorkbookSource(entry.file, '') : openDocumentSource(entry.file));
      }
      const state = document.createElement('div');
      state.className = 'td-file-state';
      state.textContent = entry.error || entry.state;
      if (entry.error) state.classList.add('document-conflict');
      meta.append(name, state);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'td-file-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `移除 ${entry.file.name}`);
      remove.disabled = isExtracting;
      remove.addEventListener('click', () => removeFile(entry.id));
      row.append(icon, meta, remove);
      ui.fileList.append(row);
    }
  }
  ui.extract.disabled = isExtracting || !selectedFiles.some((entry) => entry.state === '等待识别' || entry.error);
  ui.clearFiles.disabled = isExtracting || !selectedFiles.length;
  ui.clearAll.disabled = isExtracting;
  ui.input.disabled = isExtracting;
  ui.reset.disabled = isExtracting;
  ui.restore.disabled = isExtracting;
  ui.importFields.disabled = isExtracting;
  if (ui.skipReview) ui.skipReview.disabled = isExtracting;
  updateCandidateReviewButton();
  ui.fileCount.textContent = `${selectedFiles.length} 个文件`;
  ui.importDialog.setAttribute('aria-busy', String(isExtracting));
  updateSummary();
}

function removeFile(id) {
  if (isExtracting) return;
  retainFilledValues();
  selectedFiles = selectedFiles.filter((entry) => entry.id !== id);
  processedDocuments = processedDocuments.filter((document) => document.id !== id);
  unmatchedRows = unmatchedRows.filter((row) => row.documentId !== id);
  renderFiles();
  renderFields();
}

async function extractFiles() {
  if (isExtracting) return;
  const queue = selectedFiles.filter((entry) => entry.state === '等待识别' || entry.error);
  if (!queue.length) return;
  const skipReview = Boolean(ui.skipReview?.checked);
  retainFilledValues();
  isExtracting = true;
  ui.extract.disabled = true;
  ui.status.textContent = `正在本机解析 ${queue.length} 个文件…`;
  let succeeded = 0;
  for (const entry of queue) {
    entry.state = '正在识别';
    entry.error = '';
    renderFiles();
    const data = new FormData();
    data.append('file', entry.file, entry.file.name);
    try {
      const result = await postForm('/api/documents/extract', data);
      entry.state = `${result.document.method} · 完成`;
      if (result.warnings?.length) entry.state += `（${result.warnings.length} 项需核对：${result.warnings.map(item => item.message).join('；')}）`;
      entry.result = result;
      processedDocuments = processedDocuments.filter((doc) => doc.id !== entry.id);
      processedDocuments.push({ id: entry.id, ...result.document, fields: result.fields });
      markImportConflicts(result.fields);
      // A fresh product result starts a new import; deletion only suppresses
      // reseeding from the previously recognized candidates.
      if (productFieldIds().some(id => result.fields?.[id]?.some(candidate => normalize(candidate.value)))) {
        productsManuallyCleared = false;
      }
      unmatchedRows = unmatchedRows.filter((row) => row.documentId !== entry.id);
      unmatchedRows.push(...(result.unmatchedText || []).map((row) => ({ ...row, documentId: entry.id, fileName: entry.file.name })));
      succeeded += 1;
    } catch (error) {
      entry.state = '识别失败';
      entry.error = error.message || '文件解析失败';
    }
    renderFiles();
    renderFields();
  }
  const failed = queue.length - succeeded;
  seedProductFromCandidates();
  renderFields();
  ui.status.textContent = failed ? `完成 ${succeeded} 个，${failed} 个未能识别；可检查格式或转为可读取的扫描件。` : `已完成 ${succeeded} 个文件的本机识别。`;
  isExtracting = false;
  if (ui.skipReview) ui.skipReview.checked = false;
  renderFiles();
  if (!failed) ui.importDialog.close();
  updateSummary();
  if (succeeded) {
    if (!skipReview) openCandidateReview();
  }
}

function mergeCandidates() {
  const merged = new Map();
  for (const document of processedDocuments) {
    for (const [fieldId, candidates] of Object.entries(document.fields || {})) {
      if (!merged.has(fieldId)) merged.set(fieldId, new Map());
      const values = merged.get(fieldId);
      for (const candidate of candidates) {
        const key = candidate.normalizedValue || normalize(candidate.value);
        if (!key) continue;
        if (!values.has(key)) values.set(key, { ...candidate, files: new Set(), sources: [], sourceKeys: new Set() });
        const value = values.get(key);
        value.files.add(document.fileName);
        for (const evidence of candidate.evidence?.length ? candidate.evidence : [{ location: candidate.location, rawText: candidate.rawText }]) {
          const sourceKey = JSON.stringify([document.id, evidence.location || '', evidence.rawText || '']);
          if (value.sourceKeys.has(sourceKey)) continue;
          value.sourceKeys.add(sourceKey);
          value.sources.push({ ...evidence, fileName: document.fileName, documentId: document.id });
        }
      }
    }
  }
  for (const [fieldId, value] of Object.entries(retainedValues)) {
    if (!merged.has(fieldId)) merged.set(fieldId, new Map());
    merged.set(fieldId, withFilledSource(merged.get(fieldId), value));
  }
  return merged;
}

// Keep the snapshot separate from file evidence and from the editable final value.
function withFilledSource(candidates, filledValue) {
  const values = new Map(candidates);
  if (!String(filledValue ?? '').trim()) return values;
  const key = normalize(filledValue) || String(filledValue).trim();
  const existing = values.get(key);
  values.set(key, {
    ...(existing || { value: String(filledValue), normalizedValue: key }),
    files: new Set(existing?.files || []),
    sources: [...(existing?.sources || []), {fileName: '已填写内容', location: '再次导入前的填写值', rawText: String(filledValue), kind: 'filled'}],
  });
  return values;
}

function productCandidates(product, fieldId, merged = mergeCandidates()) {
  return [...withFilledSource(merged.get(fieldId) || new Map(), product.retainedValues?.[fieldId]).values()];
}

function retainFilledValues() {
  const merged = mergeCandidates();
  for (const [fieldId, candidates] of merged) {
    if (!productFieldIds().includes(fieldId) && !Object.hasOwn(editedValues, fieldId) && candidates.size === 1) {
      editedValues[fieldId] = String([...candidates.values()][0].value);
    }
  }
  ui.fieldGroups.querySelectorAll('[data-field-id]').forEach(input => { editedValues[input.dataset.fieldId] = input.value; });
  customFields.forEach((field, index) => {
    const id = `custom-${index}`;
    if (!Object.hasOwn(editedValues, id)) editedValues[id] = field.value || '';
  });
  retainedValues = {...retainedValues, ...Object.fromEntries(Object.entries(editedValues).filter(([, value]) => String(value ?? '').trim()))};
  for (const product of products) {
    product.retainedValues = {...product.retainedValues, ...Object.fromEntries(Object.entries(product.values).filter(([, value]) => String(value ?? '').trim()))};
  }
}


// A successful import fills blank single candidates and reopens affected conflicts.
// Unrelated fields and failed uploads must leave the user's choices untouched.
function markImportConflicts(fields) {
  const merged = mergeCandidates();
  for (const [fieldId, incoming] of Object.entries(fields || {})) {
    if (!incoming.some(candidate => normalize(candidate.value))) continue;
    if (productFieldIds().includes(fieldId)) {
      for (const product of products) {
        if (productCandidates(product, fieldId, merged).length < 2) continue;
        product.values[fieldId] = '';
        product.editedFields = [...new Set([...(product.editedFields || []), fieldId])];
      }
    } else if ((merged.get(fieldId)?.size || 0) > 1) {
      editedValues[fieldId] = '';
    } else if (merged.get(fieldId)?.size === 1 && !String(editedValues[fieldId] ?? '').trim()) {
      // Blank fields captured before extraction are not explicit selections.
      editedValues[fieldId] = String([...merged.get(fieldId).values()][0].value);
    }
  }
}


const LABEL_COLORS_KEY = 'trade-document-label-colors.v1';
let fieldLabelColors;
function labelColors() {
  if (!fieldLabelColors) {
    fieldLabelColors = Object.create(null);
    try {
      const saved = JSON.parse(localStorage.getItem(LABEL_COLORS_KEY) || '{}');
      for (const [key, color] of Object.entries(saved || {})) {
        if (/^#[0-9a-f]{6}$/i.test(color)) fieldLabelColors[key] = color;
      }
    } catch { /* Color preferences are optional when browser storage is unavailable. */ }
  }
  return fieldLabelColors;
}

function paintFieldLabel(label, color) {
  label.style.backgroundColor = color || '';
  // Choose the more legible text color, including for custom dark fills.
  const rgb = color ? color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255) : [];
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  label.style.color = color ? (luminance > .179 ? '#000000' : '#ffffff') : '';
}

function attachLabelPalette(label, row, name) {
  label.dataset.labelColorKey = name;
  label.title = '点击设置标签颜色';
  label.setAttribute('aria-label', `${name}：设置标签颜色`);
  label.setAttribute('aria-haspopup', 'dialog');
  label.setAttribute('aria-expanded', 'false');
  paintFieldLabel(label, labelColors()[name]);
  let panel;
  label.addEventListener('click', () => {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'document-label-palette';
      panel.id = `td-label-colors-${crypto.randomUUID()}`;
      panel.setAttribute('popover', 'auto');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', `${name}的标签颜色`);
      label.setAttribute('aria-controls', panel.id);
      const head = document.createElement('div');
      head.className = 'document-label-palette-head';
      const title = document.createElement('strong'); title.textContent = `${name} · 标签颜色`;
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'document-source-close'; close.textContent = '×';
      close.setAttribute('aria-label', '关闭调色板');
      close.addEventListener('click', () => { panel.hidePopover(); label.focus(); });
      head.append(title, close);
      const setColor = color => {
        if (color) labelColors()[name] = color;
        else delete labelColors()[name];
        for (const target of document.querySelectorAll('.document-field-label[data-label-color-key]')) {
          if (target.dataset.labelColorKey === name) paintFieldLabel(target, color);
        }
        try { localStorage.setItem(LABEL_COLORS_KEY, JSON.stringify(labelColors())); }
        catch { /* Keep the preference in memory if persistence is disabled. */ }
        for (const swatch of swatches.children) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color));
      };
      const swatches = document.createElement('div'); swatches.className = 'document-label-swatches';
      for (const [color, title] of [['#fee2e2','浅红'], ['#ffedd5','浅橙'], ['#fef3c7','浅黄'], ['#dcfce7','浅绿'], ['#ccfbf1','青绿'], ['#dbeafe','浅蓝'], ['#e0e7ff','靛蓝'], ['#f3e8ff','浅紫'], ['#fce7f3','浅粉'], ['#e2e8f0','灰色']]) {
        const swatch = document.createElement('button');
        swatch.type = 'button'; swatch.className = 'document-label-swatch'; swatch.style.backgroundColor = color;
        swatch.dataset.color = color; swatch.title = title;
        swatch.setAttribute('aria-label', title);
        swatch.setAttribute('aria-pressed', String(labelColors()[name] === color));
        swatch.addEventListener('click', () => { setColor(color); custom.value = color; });
        swatches.append(swatch);
      }
      const customLabel = document.createElement('label'); customLabel.className = 'document-label-custom';
      customLabel.textContent = '自定义颜色';
      const custom = document.createElement('input'); custom.type = 'color'; custom.className = 'document-label-custom-color';
      custom.value = labelColors()[name] || '#dbeafe'; custom.setAttribute('aria-label', '自定义标签颜色');
      custom.addEventListener('input', () => setColor(custom.value));
      customLabel.append(custom);
      const clear = document.createElement('button'); clear.type = 'button';
      clear.className = 'document-label-color-clear'; clear.textContent = '清除颜色（无底色）';
      clear.addEventListener('click', () => { setColor(''); custom.value = '#dbeafe'; panel.hidePopover(); label.focus(); });
      panel.append(head, swatches, customLabel, clear);
      panel.addEventListener('toggle', () => label.setAttribute('aria-expanded', String(panel.matches(':popover-open'))));
      row.append(panel);
    }
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    panel.showPopover();
    const rect = label.getBoundingClientRect();
    const placement = sourcePopoverPlacement(rect, panel.getBoundingClientRect().width, panel.getBoundingClientRect().height, window.innerWidth, window.innerHeight);
    panel.style.left = `${placement.left}px`; panel.style.top = `${placement.top}px`;
  });
}

// All imported field groups share editing, candidate selection and provenance UI.
// Callers only adapt where values are stored and their domain-specific side effects.
function hasUnresolvedConflict(candidates, value) {
  const distinct = new Set(candidates.map(candidate => String(candidate.value ?? '').trim()).filter(Boolean));
  return distinct.size > 1 && !String(value ?? '').trim();
}

function collectCandidateConflicts() {
  const merged = mergeCandidates();
  const conflicts = [];
  const knownIds = new Set(fieldDefinitions.map(field => field.id));
  const fields = [...fieldDefinitions, ...[...merged.keys()].filter(id => !knownIds.has(id))
    .map(id => ({ id, label: id, group: '其他' }))];
  for (const field of fields) {
    const targets = productFieldIds().includes(field.id)
      ? products.flatMap((product, index) => product.autoSeeded || product.retainedValues
        ? [{ product, label: `产品 ${index + 1} · ${field.label}` }] : [])
      : [{ label: `${normalizeFieldGroup(field.group)} · ${field.label}` }];
    for (const target of targets) {
      const candidates = target.product ? productCandidates(target.product, field.id, merged)
        : [...(merged.get(field.id)?.values() || [])];
      const value = target.product ? target.product.values[field.id] : editedValues[field.id];
      if (hasUnresolvedConflict(candidates, value)) conflicts.push({ ...target, field, candidates });
    }
  }
  return conflicts;
}

// Skips leave the existing conflict indicators intact and remain reviewable later.
function openCandidateReview() {
  const conflicts = collectCandidateConflicts();
  if (!conflicts.length) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'document-template-dialog document-candidate-review';
  dialog.setAttribute('aria-labelledby', 'td-candidate-review-title');
  dialog.setAttribute('aria-describedby', 'td-candidate-review-help');
  const heading = document.createElement('h3');
  heading.id = 'td-candidate-review-title'; heading.textContent = '请选择候选值';
  const help = document.createElement('p');
  help.id = 'td-candidate-review-help'; help.className = 'muted';
  help.textContent = '以下字段识别到多个值，可点选或手工填写。跳过后仍可在页面核对。';
  const progress = document.createElement('p'); progress.setAttribute('role', 'status');
  const content = document.createElement('div');
  const actions = document.createElement('div'); actions.className = 'btn-row';
  const skipAll = templateButton('跳过全部', () => dialog.close());
  const skip = templateButton('跳过此项', () => advance());
  const next = templateButton('确认并继续', () => advance(), 'btn primary');
  actions.append(skipAll, skip, next);
  dialog.append(heading, help, progress, content, actions);
  let index = 0;
  const show = () => {
    const { field, candidates, product, label } = conflicts[index];
    progress.textContent = `${index + 1} / ${conflicts.length} · ${label}`;
    next.disabled = !String(product ? product.values[field.id] ?? '' : editedValues[field.id] ?? '').trim();
    const control = makeFieldControl(field, candidates, {
      id: 'td-candidate-review-input', product: Boolean(product),
      value: product ? product.values[field.id] : editedValues[field.id],
      onChange: value => {
        if (product) {
          product.values[field.id] = value;
          product.editedFields = [...new Set([...(product.editedFields || []), field.id])];
        } else editedValues[field.id] = value;
        next.disabled = !value.trim();
        // Refresh before saving: the main form still contains its previous value.
        renderFields(); saveRecord();
      },
    });
    content.replaceChildren(control);
    requestAnimationFrame(() => control.querySelector?.('textarea')?.focus());
  };
  const advance = () => {
    index++;
    if (index === conflicts.length) dialog.close();
    else show();
  };
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal(); show();
}

function updateGroupConflictIndicators(merged = mergeCandidates()) {
  for (const tile of ui.groupTiles?.children || []) {
    const group = tile.dataset.fieldGroup;
    const unresolved = fieldDefinitions.some(field => {
      if (normalizeFieldGroup(field.group) !== group) return false;
      const candidates = [...(merged.get(field.id)?.values() || [])];
      if (group === '产品') {
        return productFieldIds().includes(field.id) && products.some(product =>
          (product.autoSeeded || product.retainedValues) && hasUnresolvedConflict(productCandidates(product, field.id, merged), product.values[field.id]));
      }
      return hasUnresolvedConflict(candidates, editedValues[field.id]);
    });
    tile.dataset.unresolvedConflict = String(unresolved);
    tile.setAttribute('aria-label', `${group}${unresolved ? '：有来源冲突待选择' : ''}`);
  }
  updateCandidateReviewButton();
}

function updateCandidateReviewButton() {
  if (!ui.reviewCandidates) return;
  const count = collectCandidateConflicts().length;
  ui.reviewCandidates.disabled = isExtracting || count === 0;
  ui.reviewCandidates.textContent = count ? `核对候选项（${count}）` : '核对候选项';
}

function makeFieldControl(field, candidates, { id, value, onChange, product = false, suggestions }) {
  const row = document.createElement('div');
  row.className = 'document-field-row';
  const label = document.createElement('button');
  label.className = 'document-field-label';
  label.type = 'button';
  label.textContent = field.label;
  const input = document.createElement('textarea');
  input.className = 'document-field-input';
  input.id = id;
  input.setAttribute('aria-label', field.label);
  input.rows = 1;
  input.value = value ?? '';
  input.dataset[product ? 'productField' : 'fieldId'] = field.id;
  input.placeholder = suggestions ? '手工填写，可选择已有内容' : candidates.length > 1 ? '有多个候选值，请选择或手工填写' : '识别值或手工填写';
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  const buttons = [];
  const updateConflict = () => {
    const unresolved = !suggestions && hasUnresolvedConflict(candidates, input.value);
    row.dataset.unresolvedConflict = String(unresolved);
    label.setAttribute('aria-label', `${field.label}${unresolved ? '：来源冲突待选择' : ''}：设置标签颜色`);
    input.setAttribute('aria-description', unresolved ? '来源冲突，请选择候选值或手工填写' : '');
  };
  const commit = () => {
    resize();
    for (const [button, candidate] of buttons) {
      button.setAttribute('aria-pressed', String(input.value === String(candidate.value)));
    }
    onChange(input.value);
    updateConflict();
    updateGroupConflictIndicators();
  };
  input.addEventListener('input', commit);
  const evidence = document.createElement('div');
  evidence.className = 'document-evidence';
  if (suggestions) {
    row.className += ' document-manual-product-field';
    evidence.className += ' document-product-suggestions';
    evidence.id = `${id}-suggestions`;
    evidence.hidden = true;
    input.setAttribute('aria-controls', evidence.id);
    input.setAttribute('aria-expanded', 'false');
    const close = () => {
      evidence.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      evidence.replaceChildren();
      for (const value of suggestions()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'document-candidate';
        button.textContent = value;
        button.setAttribute('aria-label', `将“${value}”填入${field.label}`);
        button.addEventListener('click', () => {
          input.value = value;
          commit();
          input.focus();
          close();
        });
        evidence.append(button);
      }
      evidence.hidden = !evidence.children.length;
      input.setAttribute('aria-expanded', String(!evidence.hidden));
    };
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && !evidence.hidden) {
        event.preventDefault();
        evidence.firstElementChild?.focus();
      }
    });
    row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget)) close(); });
    row.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); input.focus(); close(); }
    });
    row.append(label, input, evidence);
    attachLabelPalette(label, row, field.label);
    updateConflict();
    requestAnimationFrame(resize);
    return row;
  }
  for (const candidate of candidates) {
    const item = document.createElement('div');
    item.className = 'document-candidate-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'document-candidate';
    button.setAttribute('aria-label', `将“${candidate.value}”填入${field.label}`);
    button.setAttribute('aria-pressed', String(input.value === String(candidate.value)));
    button.textContent = candidate.value;
    button.addEventListener('click', () => {
      input.value = String(candidate.value);
      commit();
    });
    buttons.push([button, candidate]);
    item.append(button);
    attachSourcePopover(item, field, candidate);
    evidence.append(item);
  }
  if (!candidates.length) {
    const note = document.createElement('small');
    note.textContent = '未从已导入文件中找到，支持手工录入';
    evidence.append(note);
  }
  row.append(label, input, evidence);
  attachLabelPalette(label, row, field.label);
  updateConflict();
  requestAnimationFrame(resize);
  return row;
}

// Only show a label that occurs explicitly in the primary source evidence.
function candidateBasis(field, candidate) {
  if (candidate.sources?.[0]?.kind === 'filled') return '已填写内容';
  const raw = String(candidate.sources?.[0]?.rawText || candidate.rawText || '').trim();
  const header = raw.split(/[:：\n\t]/, 1)[0].trim();
  const aliases = [field.label, ...(field.aliases || [])].filter(Boolean);
  return aliases.some(alias => normalize(alias) === normalize(header)) ? header : '查看来源';
}

let sourcePopoverOpening = false;

function sourcePopoverPlacement(rect, width, height, viewportWidth, viewportHeight) {
  const margin = 12;
  const sideGap = 6;
  let left;
  let top;
  if (rect.right + sideGap + width <= viewportWidth - margin) {
    left = rect.right + sideGap;
    top = rect.top;
  } else if (rect.left - sideGap - width >= margin) {
    left = rect.left - sideGap - width;
    top = rect.top;
  } else {
    left = rect.right - width;
    // Touch the row edge: a vertical gap can expose another candidate on
    // the mouse path and switch its source before the popup is reached.
    top = rect.top - height >= margin ? rect.top - height : rect.bottom;
  }
  return {
    left: Math.max(margin, Math.min(left, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(top, viewportHeight - height - margin)),
  };
}

function attachSourcePopover(item, field, candidate) {
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'document-candidate-basis';
  const icon = document.createElement('span');
  icon.className = 'document-candidate-source-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8M14 2v6h6M14 2l6 6v4"/><circle cx="15.5" cy="16.5" r="3.5"/><path d="m18 19 3 3"/></svg>';
  const basis = document.createElement('span');
  basis.className = 'document-candidate-basis-label';
  basis.textContent = candidateBasis(field, candidate);
  badge.append(icon, basis);
  badge.setAttribute('aria-label', `${candidate.value}的识别依据与来源`);
  badge.setAttribute('aria-haspopup', 'dialog');
  badge.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'document-source-popover';
  panel.id = `td-evidence-${crypto.randomUUID()}`;
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `${field.label}的识别详情`);
  badge.setAttribute('aria-controls', panel.id);
  const head = document.createElement('div');
  head.className = 'document-source-popover-head';
  const title = document.createElement('strong');
  title.textContent = '识别依据与来源';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'document-source-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭识别详情');
  close.addEventListener('click', () => panel.hidePopover());
  head.append(title, close);
  const value = document.createElement('div');
  value.className = 'document-source-popover-value';
  value.textContent = candidate.value;
  panel.append(head, value, makeEvidence(candidate, false));
  let hideTimer;
  const cancelHide = () => clearTimeout(hideTimer);
  const position = () => {
    const rect = item.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    const height = panel.getBoundingClientRect().height;
    const placement = sourcePopoverPlacement(rect, width, height, window.innerWidth, window.innerHeight);
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
  };
  const show = () => {
    cancelHide();
    // Auto popovers replace earlier panels; avoid nested native show operations.
    if (sourcePopoverOpening) return;
    sourcePopoverOpening = true;
    try {
      if (!panel.matches(':popover-open')) panel.showPopover();
      position();
    } finally {
      sourcePopoverOpening = false;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer = setTimeout(() => { if (panel.matches(':popover-open')) panel.hidePopover(); }, 180);
  };
  item.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(); });
  item.addEventListener('pointerleave', scheduleHide);
  // Keyboard users open with the badge's native button activation. Merely
  // restoring focus after Escape must not reopen the dismissed popover.
  item.addEventListener('focusin', cancelHide);
  item.addEventListener('focusout', scheduleHide);
  panel.addEventListener('pointerenter', cancelHide);
  panel.addEventListener('pointerleave', scheduleHide);
  panel.addEventListener('toggle', () => {
    badge.setAttribute('aria-expanded', String(panel.matches(':popover-open')));
  });
  badge.addEventListener('click', show);
  panel.addEventListener('toggle', cancelHide);
  panel.addEventListener('toggle', event => {
    if (event.target !== panel && panel.matches(':popover-open')) position();
  }, true);
  item.append(badge, panel);
}

function makeSourceCard(source, candidate) {
  const card = document.createElement('div');
  card.className = 'document-source-card';
  const selected = selectedFiles.find(entry => entry.id === source.documentId);
  const canOpen = selected && (/\.(docx?|pdf)$/i.test(selected.file.name) ||
    /\.xlsx?$/i.test(selected.file.name));
  const file = document.createElement(canOpen ? 'button' : 'span');
  file.className = 'document-source-file';
  file.textContent = source.fileName || '未知文件';
  if (canOpen) {
    file.type = 'button';
    file.className += ' document-source-link';
    file.setAttribute('aria-label', `查看来源文件：${source.fileName}，${source.location || '位置未提供'}`);
    file.addEventListener('click', () => /\.(docx?|pdf)$/i.test(selected.file.name)
      ? openDocumentSource(selected.file, source.location, candidate.value)
      : openWorkbookSource(selected.file, source.location));
  }
  const location = document.createElement('span');
  location.className = 'document-source-location';
  location.textContent = `位置：${source.location || '未提供'}`;
  card.append(file, location);
  if (source.rawText) {
    const text = document.createElement('blockquote');
    text.className = 'document-source-excerpt';
    text.textContent = source.rawText;
    card.append(text);
  }
  return card;
}

function makeEvidence(candidate, conflict) {
  const wrapper = document.createElement('div');
  wrapper.className = conflict ? 'document-candidates' : 'document-evidence';
  const seen = new Set();
  const sources = (candidate.sources || []).filter(source => {
    const key = JSON.stringify([source.documentId || source.fileName, source.location || '', source.rawText || '']);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (sources.length) wrapper.append(makeSourceCard(sources[0], candidate));
  if (sources.length > 1) {
    const details = document.createElement('details');
    details.className = 'document-source-more';
    const summary = document.createElement('summary');
    summary.textContent = `另有 ${sources.length - 1} 条来源，展开查看`;
    details.append(summary, ...sources.slice(1).map(source => makeSourceCard(source, candidate)));
    wrapper.append(details);
  }
  const confidence = document.createElement('small');
  confidence.textContent = candidate.confidence == null && sources.some(source => source.kind === 'filled')
    ? '已填写内容，保留供核对' : `识别置信度 ${Math.round((candidate.confidence || 0) * 100)}%`;
  wrapper.append(confidence);
  return wrapper;
}

async function openWorkbookSource(file, location) {
  const tab = window.open('/spreadsheet.html?loading=1', '_blank');
  if (!tab) {
    ui.status.textContent = '浏览器拦截了新标签页，请允许此应用打开弹出窗口后重试。';
    return;
  }
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const result = await postForm('/api/documents/workbook-sessions', form);
    const match = String(location || '').match(/^工作表「(.*)」!([A-Z]{1,3}[1-9]\d*)$/);
    const query = new URLSearchParams({ session: result.sessionId });
    if (match) {
      query.set('sheet', match[1]);
      query.set('cell', match[2]);
    } else {
      const rowMatch = String(location || '').match(/^工作表「(.*)」第\s*([1-9]\d*)\s*行$/);
      if (rowMatch) {
        query.set('sheet', rowMatch[1]);
        query.set('row', rowMatch[2]);
      }
    }
    tab.location.href = `/spreadsheet.html?${query.toString()}`;
  } catch (error) {
    tab.close();
    ui.status.textContent = error.message || '无法打开 Excel 编辑器。';
  }
}

async function openDocumentSource(file, location = '', text = '') {
  const tab = window.open('/document-source.html?loading=1', '_blank');
  if (!tab) {
    ui.status.textContent = '浏览器拦截了新标签页，请允许此应用打开弹出窗口后重试。';
    return;
  }
  // Do not place business values in URLs/history. Transfer focus via this tab's session storage.
  const focusKey = `document-focus-${crypto.randomUUID()}`;
  tab.sessionStorage.setItem(focusKey, JSON.stringify({ location, text }));
  try {
    const cached = selectedFiles.find(entry => entry.file === file);
    if (cached?.sourceSession) {
      try { await getJSON(`/api/documents/source-sessions/${cached.sourceSession}`); }
      catch { delete cached.sourceSession; }
    }
    if (!cached?.sourceSession || Date.now() - cached.sourceSessionCreated > 55 * 60 * 1000) {
      const form = new FormData();
      form.append('file', file, file.name);
      const result = await postForm('/api/documents/source-sessions', form);
      const entry = selectedFiles.find(item => item.file === file);
      if (entry) { entry.sourceSession = result.sessionId; entry.sourceSessionCreated = Date.now(); }
      tab.location.href = `/document-source.html?${new URLSearchParams({ session: result.sessionId, focus: focusKey })}`;
    } else {
      const entry = selectedFiles.find(item => item.file === file);
      tab.location.href = `/document-source.html?${new URLSearchParams({ session: entry.sourceSession, focus: focusKey })}`;
    }
  } catch (error) {
    const status = tab.document.querySelector('#status');
    if (status) status.textContent = error.message || '无法打开原文。';
    ui.status.textContent = error.message || '无法打开原文。';
    const entry = selectedFiles.find(item => item.file === file);
    if (entry) delete entry.sourceSession;
  }
}

function templateList(kind) {
  return kind === 'trade_products' ? productTemplates : kind === 'trade_sections' ? sectionTemplates : overallTemplates;
}

function setTemplateList(kind, items) {
  if (kind === 'trade_products') productTemplates = items;
  else if (kind === 'trade_sections') sectionTemplates = items;
  else overallTemplates = items;
}

function templateButton(text, action, className = 'btn') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

function productTemplateDefaultName(product, index) {
  return product.values.item_description?.trim() || `产品 ${index + 1}`;
}

function applyProductTemplate(template) {
  productTemplateFlash = { id: template.id, until: Date.now() + 450 };
  products.push({ id: crypto.randomUUID(), values: reusableProductValues(template.values) });
  productsManuallyCleared = false;
  renderFields(); saveRecord();
  ui.saveState.textContent = `已添加产品「${template.name}」。`;
}

async function persistTemplate(kind, name, values) {
  name = name.trim();
  if (!name) throw new Error('请填写模板名称。');
  const old = templateList(kind).find(item => item.name === name &&
    (kind !== 'trade_sections' || item.values.group === values.group));
  if (old && !window.confirm(`已存在「${name}」，是否覆盖该模板？`)) return false;
  const id = old?.id || crypto.randomUUID().replaceAll('-', '');
  const saved = await putJSON(`/api/templates/${kind}/${id}`, { id, name, values });
  setTemplateList(kind, templateList(kind).filter(item => item.id !== saved.id).concat(saved));
  renderFields(); renderOverallTemplates();
  ui.saveState.textContent = `模板「${saved.name}」已保存。`;
  return true;
}

async function deleteSavedTemplate(kind, template) {
  if (!window.confirm(`删除模板「${template.name}」？已填写的内容会保留。`)) return;
  try {
    await deleteJSON(`/api/templates/${kind}/${template.id}`);
    setTemplateList(kind, templateList(kind).filter(item => item.id !== template.id));
    renderFields(); renderOverallTemplates();
    ui.saveState.textContent = `已删除模板「${template.name}」。`;
  } catch (error) { ui.saveState.textContent = `删除模板失败：${error.message}`; }
}

function openTemplateSave(kind, defaultName, values) {
  const dialog = document.createElement('dialog');
  dialog.className = 'document-template-dialog';
  dialog.setAttribute('aria-labelledby', 'td-template-save-title');
  const form = document.createElement('form');
  const heading = document.createElement('h3');
  heading.id = 'td-template-save-title'; heading.textContent = '保存模板';
  const label = document.createElement('label'); label.className = 'field';
  const labelText = document.createElement('span'); labelText.textContent = '模板名称';
  const input = document.createElement('input');
  input.type = 'text'; input.required = true; input.maxLength = 200; input.value = defaultName;
  label.append(labelText, input);
  const message = document.createElement('p'); message.className = 'form-msg'; message.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'btn-row two';
  const save = templateButton('保存模板', () => {} , 'btn primary'); save.type = 'submit';
  const cancel = templateButton('取消', () => dialog.close());
  actions.append(save, cancel); form.append(heading, label, message, actions); dialog.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; cancel.disabled = true;
    try { if (await persistTemplate(kind, input.value, values)) dialog.close(); }
    catch (error) { message.textContent = `保存失败：${error.message}`; }
    finally { save.disabled = false; cancel.disabled = false; }
  });
  dialog.addEventListener('cancel', event => { if (save.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
}

function renderTemplateTiles(parent, kind, templates, apply) {
  const tiles = document.createElement('div'); tiles.className = 'presets document-product-tiles';
  for (const template of templates) {
    const tile = document.createElement('div'); tile.className = 'document-template-tile';
    const use = templateButton(template.name, () => apply(template), 'btn preset document-product-tile');
    if (kind === 'trade_products' && template.id === productTemplateFlash.id && productTemplateFlash.until > Date.now()) {
      use.classList.add('is-clicked');
      use.style.animationDuration = `${productTemplateFlash.until - Date.now()}ms`;
    }
    const remove = templateButton('×', async () => {
      remove.disabled = true;
      try { await deleteSavedTemplate(kind, template); } finally { remove.disabled = false; }
    }, 'document-template-delete');
    remove.setAttribute('aria-label', `删除模板「${template.name}」`); remove.title = `删除模板「${template.name}」`;
    tile.append(use, remove); tiles.append(tile);
  }
  parent.append(tiles);
}

function renderProductTemplatePanel(section) {
  const panel = document.createElement('div'); panel.className = 'document-product-templates';
  const label = document.createElement('strong'); label.textContent = '常用产品';
  panel.append(label);
  renderTemplateTiles(panel, 'trade_products', productTemplates, applyProductTemplate);
  section.append(panel);
}

function currentTemplateFields() {
  const values = { ...editedValues };
  for (const [id, candidates] of mergeCandidates()) {
    if (!Object.hasOwn(values, id) && candidates.size === 1) values[id] = [...candidates.values()][0].value;
  }
  for (const id of productFieldIds()) delete values[id];
  for (const id of Object.keys(values)) if (id.startsWith('custom-')) delete values[id];
  return values;
}

function currentCustomFields() {
  return customFields.map((field, index) => ({label: field.label, value: editedValues[`custom-${index}`] ?? field.value ?? ''}));
}

function sectionTemplateValues(group) {
  const current = currentTemplateFields();
  const fields = Object.fromEntries(fieldDefinitions.filter(field => normalizeFieldGroup(field.group) === group)
    .map(field => [field.id, current[field.id] ?? '']));
  return group === '自定义' ? {group, fields: {}, customFields: currentCustomFields()} : {group, fields};
}

function applySectionTemplate(template) {
  const {group, fields = {}} = template.values;
  if (!window.confirm(`套用「${template.name}」将替换“${group}”栏目填写内容，是否继续？`)) return;
  if (group === '自定义') {
    customFields = structuredClone(template.values.customFields || []);
    for (const id of Object.keys(editedValues)) if (id.startsWith('custom-')) delete editedValues[id];
  } else {
    for (const field of fieldDefinitions.filter(field => normalizeFieldGroup(field.group) === group)) {
      if (Object.hasOwn(fields, field.id)) editedValues[field.id] = fields[field.id];
    }
  }
  activeFieldGroup = group; manuallySelectedFieldGroup = true;
  renderFields(); saveRecord(); ui.saveState.textContent = `已套用模板「${template.name}」。`;
}

function renderSectionTemplates(section, group) {
  const panel = document.createElement('div'); panel.className = 'document-section-templates';
  panel.append(templateButton('保存栏目模板', () => openTemplateSave('trade_sections', `${group}模板`, sectionTemplateValues(group))));
  renderTemplateTiles(panel, 'trade_sections', sectionTemplates.filter(item => item.values.group === group), applySectionTemplate);
  section.append(panel);
}

function overallTemplateValues() {
  seedProductFromCandidates();
  return {fields: currentTemplateFields(), customFields: currentCustomFields(),
    products: products.map(product => ({values: reusableProductValues(product.values)}))};
}

function applyOverallTemplate(template) {
  if (!window.confirm(`套用总体模板「${template.name}」将替换所有栏目和产品填写内容，是否继续？`)) return;
  editedValues = {...template.values.fields};
  customFields = structuredClone(template.values.customFields || []);
  // Explicit blanks prevent old source candidates from silently refilling the form.
  for (const field of fieldDefinitions) if (!productFieldIds().includes(field.id) && !Object.hasOwn(editedValues, field.id)) editedValues[field.id] = '';
  products = (template.values.products || []).map(product => ({id: crypto.randomUUID(), values: reusableProductValues(product.values)}));
  productsManuallyCleared = true; manuallySelectedFieldGroup = true;
  renderFields(); saveRecord(); ui.saveState.textContent = `已套用总体模板「${template.name}」。`;
}

function renderOverallTemplates() {
  const panel = document.querySelector('#td-overall-templates');
  if (!panel) return;
  panel.replaceChildren();
  panel.append(templateButton('保存当前为总体模板', () => openTemplateSave('trade_records', '总体模板', overallTemplateValues())));
  renderTemplateTiles(panel, 'trade_records', overallTemplates, applyOverallTemplate);
  if (!overallTemplates.length) { const empty = document.createElement('p'); empty.className = 'caption'; empty.textContent = '暂无总体模板'; panel.append(empty); }
}

function addProduct() {
  const values = {};
  for (const fieldId of productFieldIds()) {
    values[fieldId] = '';
  }
  products.push({ id: crypto.randomUUID(), values });
  productsManuallyCleared = false;
  renderFields();
  saveRecord();
}

function seedProductFromCandidates(merged = mergeCandidates()) {
  const ids = productFieldIds();
  if (!products.length && !productsManuallyCleared && ids.some((id) => merged.has(id))) {
    products.push({ id: crypto.randomUUID(), values: {}, autoSeeded: true, editedFields: [] });
  }
  for (const product of products.filter(item => item.autoSeeded)) {
    for (const fieldId of ids) {
      if (product.editedFields?.includes(fieldId) || Object.hasOwn(product.retainedValues || {}, fieldId)) continue;
      const candidates = [...(merged.get(fieldId)?.values() || [])];
      product.values[fieldId] = candidates.length === 1 ? String(candidates[0].value) : '';
    }
  }
}

function renderProductCards(section, merged, fields) {
  seedProductFromCandidates(merged);
  const list = document.createElement('div');
  list.className = 'document-products-list';
  if (!products.length) {
    const empty = document.createElement('p');
    empty.className = 'document-products-empty';
    empty.textContent = '还没有添加产品。每种产品单独填写，可按需增删。';
    list.append(empty);
  }
  products.forEach((product, index) => {
    const card = document.createElement('article');
    card.className = 'document-product-card';
    const header = document.createElement('div');
    header.className = 'document-product-card-head';
    const title = document.createElement('strong');
    title.textContent = productTemplateDefaultName(product, index);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn'; remove.textContent = '删除产品';
    remove.setAttribute('aria-label', `删除产品 ${index + 1}`);
    remove.addEventListener('click', () => {
      products.splice(index, 1);
      if (!products.length) productsManuallyCleared = true;
      renderFields(); saveRecord();
    });
    const actions = document.createElement('div'); actions.className = 'document-product-card-actions';
    actions.append(templateButton('保存模板', () => openTemplateSave('trade_products', productTemplateDefaultName(product, index), reusableProductValues(product.values))), remove);
    header.append(title, actions);
    const grid = document.createElement('div');
    grid.className = 'document-field-grid';
    grid.id = `td-product-fields-${product.id}`;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'btn';
    toggle.setAttribute('aria-controls', grid.id);
    const updateExpanded = () => {
      const expanded = !collapsedProducts.has(product);
      grid.hidden = !expanded;
      toggle.textContent = expanded ? '收起' : '展开';
      toggle.setAttribute('aria-expanded', String(expanded));
    };
    toggle.addEventListener('click', () => {
      if (collapsedProducts.has(product)) collapsedProducts.delete(product);
      else collapsedProducts.add(product);
      updateExpanded();
    });
    updateExpanded();
    actions.prepend(toggle);
    for (const field of fields) {
      const candidates = productCandidates(product, field.id, merged);
      grid.append(makeFieldControl(field, candidates, {
        id: `td-product-${product.id}-${field.id}`,
        value: product.values[field.id],
        product: true,
        suggestions: product.autoSeeded || product.retainedValues ? undefined : () => [...new Set(
          products.slice(0, index).map(item => String(item.values[field.id] ?? '').trim()).filter(Boolean)
        )],
        onChange: value => {
          product.values[field.id] = value;
          product.editedFields = [...new Set([...(product.editedFields || []), field.id])];
          if (field.id === 'item_description') title.textContent = value.trim() || `产品 ${index + 1}`;
          saveRecord();
        },
      }));
    }
    card.append(header, grid); list.append(card);
  });
  const addButton = document.createElement('button');
  addButton.type = 'button'; addButton.className = 'btn'; addButton.textContent = '＋ 添加产品';
  addButton.addEventListener('click', () => addProduct());
  const actions = document.createElement('div'); actions.className = 'btn-row two document-product-list-actions';
  actions.append(addButton, templateButton('清空列表', () => {
    if (!window.confirm('清空产品列表？已保存的产品模板会保留。')) return;
    products = []; productsManuallyCleared = true; renderFields(); saveRecord();
  }));
  section.append(list, actions);
}

function renderFields() {
  // Keep the card's previous height by placing any difference below all controls.
  const fieldsCard = ui.fieldGroups.closest('.document-fields-card');
  maxFieldsCardHeight = Math.max(maxFieldsCardHeight, fieldsCard.getBoundingClientRect().height);
  ui.bottomSpace.style.height = '0px';
  const merged = mergeCandidates();
  const definitions = fieldDefinitions.length ? fieldDefinitions : [];
  const knownIds = new Set(definitions.map((field) => field.id));
  const groupsByName = new Map(groups.map((group) => [group, []]));
  for (const field of definitions) {
    const groupName = normalizeFieldGroup(field.group);
    if (groupName === '产品' && !productFieldIds().includes(field.id)) continue;
    if (!groupsByName.has(groupName)) groupsByName.set(groupName, []);
    groupsByName.get(groupName).push({
      ...field,
      group: groupName,
      label: field.id === 'item_description' ? '产品名称' : field.label,
    });
  }
  for (const [fieldId] of merged) {
    if (!knownIds.has(fieldId)) groupsByName.get('其他')?.push({ id: fieldId, label: fieldId, group: '其他' });
  }
  if (customFields.length) groupsByName.set('自定义', customFields.map((field, index) => ({ id: `custom-${index}`, label: field.label, group: '自定义' })));
  const populatedGroups = [...groupsByName].filter(([name, fields]) => fields.length || name === '自定义');
  if (!populatedGroups.some(([name]) => name === activeFieldGroup)) activeFieldGroup = populatedGroups[0]?.[0] || '单据';
  if (!manuallySelectedFieldGroup && merged.size) {
    const best = populatedGroups
      .map(([name, fields]) => [name, fields.filter(field => (merged.get(field.id)?.size || 0) > 0).length])
      .sort((a, b) => b[1] - a[1])[0];
    if (best?.[1]) activeFieldGroup = best[0];
  }
  ui.groupTiles.replaceChildren(...populatedGroups.map(([name, fields]) => {
    const recognized = fields.filter(field => (merged.get(field.id)?.size || 0) > 0).length;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn preset document-group-tile';
    button.dataset.fieldGroup = name;
    button.classList.toggle('active', name === activeFieldGroup);
    button.setAttribute('aria-pressed', name === activeFieldGroup ? 'true' : 'false');
    const title = document.createElement('span'); title.textContent = name;
    const detail = document.createElement('small'); detail.textContent = `${recognized} / ${fields.length} 个字段已识别`;
    button.append(title, detail);
    button.addEventListener('click', () => {
      const scrollY = window.scrollY;
      activeFieldGroup = name;
      manuallySelectedFieldGroup = true;
      renderFields();
      // Keep the viewport fixed even when browser scroll anchoring reacts to
      // the replaced fields before the bottom spacer has taken effect.
      window.scrollTo(0, scrollY);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    });
    return button;
  }));
  ui.fieldGroups.replaceChildren();
  for (const [groupName, fields] of groupsByName) {
    if ((!fields?.length && groupName !== '自定义') || groupName !== activeFieldGroup) continue;
    const section = document.createElement('section');
    section.className = 'document-field-group';
    const heading = document.createElement('h3');
    heading.textContent = groupName;
    section.append(heading);
    if (groupName === '产品') {
      renderProductTemplatePanel(section);
      renderProductCards(section, merged, fields);
      ui.fieldGroups.append(section);
      continue;
    }
    renderSectionTemplates(section, groupName);
    const fieldGrid = document.createElement('div');
    fieldGrid.className = 'document-field-grid';
    for (const field of fields) {
      const candidates = [...(merged.get(field.id)?.values() || [])];
      const autoValue = candidates.length === 1 ? candidates[0].value : '';
      const customValue = field.id.startsWith('custom-') ? customFields[Number(field.id.slice(7))]?.value || '' : undefined;
      fieldGrid.append(makeFieldControl(field, candidates, {
        id: `td-field-${field.id}`,
        value: Object.hasOwn(editedValues, field.id) ? editedValues[field.id] : customValue ?? autoValue,
        onChange: value => {
          editedValues[field.id] = value;
          saveRecord();
        },
      }));
    }
    section.append(fieldGrid);
    ui.fieldGroups.append(section);
  }
  updateGroupConflictIndicators(merged);
  ui.unmatched.replaceChildren();
  if (unmatchedRows.length) {
    ui.unmatchedWrap.hidden = false;
    for (const item of unmatchedRows) {
      const row = document.createElement('div');
      row.className = 'document-unmatched-row';
      const source = document.createElement('span');
      source.textContent = `${item.fileName} · ${item.location}`;
      const text = document.createElement('span');
      text.textContent = item.text;
      row.append(source, text);
      ui.unmatched.append(row);
    }
  } else {
    ui.unmatchedWrap.hidden = true;
  }
  updateSummary();
  const contentHeight = fieldsCard.getBoundingClientRect().height;
  ui.bottomSpace.style.height = `${Math.max(0, maxFieldsCardHeight - contentHeight)}px`;
}

function updateSummary() {
  const count = processedDocuments.length;
  const sourceCount = new Set([...mergeCandidates().values()].flatMap((values) => [...values.values()].flatMap((value) => [...value.files]))).size;
  ui.summary.firstElementChild.textContent = `${sourceCount || selectedFiles.filter((entry) => entry.state === '识别失败').length} 个文件`;
  const fieldCount = [...mergeCandidates().keys()].length;
  ui.summary.lastElementChild.textContent = count ? `识别到 ${fieldCount} 类字段 · ${processedDocuments.map((doc) => doc.method).filter((value, index, all) => all.indexOf(value) === index).join(' / ')}` : '等待导入或手工填写';
}

function saveRecord() {
  const values = { ...editedValues };
  ui.fieldGroups.querySelectorAll('[data-field-id]').forEach((input) => { values[input.dataset.fieldId] = input.value; });
  for (const fieldId of productFieldIds()) delete values[fieldId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ values, retainedValues, customFields, products, productsManuallyCleared, documents: processedDocuments.map(({ id, fileName, method }) => ({ id, fileName, method })) }));
  editedValues = values;
  ui.saveState.textContent = `已保存到本机浏览器 · ${new Date().toLocaleTimeString()}`;
}

async function exportFieldsXlsx() {
  seedProductFromCandidates();
  const values = { ...editedValues };
  ui.fieldGroups.querySelectorAll('[data-field-id]').forEach((input) => { values[input.dataset.fieldId] = input.value; });
  for (const [fieldId, candidates] of mergeCandidates()) {
    if (productFieldIds().includes(fieldId)) continue;
    if (!Object.hasOwn(values, fieldId) && candidates.size === 1) values[fieldId] = [...candidates.values()][0].value;
  }
  try {
    const response = await fetch('/api/documents/fields/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, customFields, products }),
    });
    if (!response.ok) throw new Error(`导出失败（${response.status}）`);
    saveBlob(await response.blob(), '贸易单据字段汇总.xlsx');
    ui.saveState.textContent = '已导出分类 Excel 工作簿。';
  } catch (error) { ui.saveState.textContent = `导出失败：${error.message}`; }
}

async function importFieldsXlsx(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.xlsx')) { ui.saveState.textContent = '请选择 .xlsx 工作簿。'; return; }
  try {
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/documents/fields/import', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || `导入失败（${response.status}）`);
    editedValues = result.values || {};
    products = (result.products || result.goods || []).map((item) => ({ id: crypto.randomUUID(), values: item.values || item }));
    productsManuallyCleared = false;
    customFields = result.customFields || [];
    renderFields(); saveRecord();
    ui.saveState.textContent = `已导入 ${result.rowsRead} 行，恢复 ${Object.keys(editedValues).length} 个其他字段及 ${products.length} 项产品。`;
  } catch (error) { ui.saveState.textContent = `导入失败：${error.message}`; }
}

function restoreLastRecord() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) { ui.saveState.textContent = '本机没有找到可恢复的上次填写内容。'; return; }
    retainedValues = saved.retainedValues || {};
    editedValues = saved.values || {}; customFields = saved.customFields || [];
    products = (saved.products || saved.goods || []).map((item) => ({
      id: item.id || crypto.randomUUID(), values: item.values || item,
      ...(item.retainedValues ? {retainedValues: item.retainedValues} : {}),
      ...(item.autoSeeded === true ? {autoSeeded: true, editedFields: item.editedFields || []} : {}),
    }));
    if (!products.length && productFieldIds().some((fieldId) => Object.hasOwn(editedValues, fieldId))) {
      const values = {};
      for (const fieldId of productFieldIds()) { values[fieldId] = editedValues[fieldId] || ''; delete editedValues[fieldId]; }
      products.push({ id: crypto.randomUUID(), values });
    }
    // The form displays one category at a time. Select the first category
    // containing restored values so restoring a record visibly shows its data.
    const restoredValueIds = new Set(Object.keys(editedValues).filter((id) => String(editedValues[id] ?? '').trim()));
    for (const [index, field] of customFields.entries()) {
      if (String(field.value ?? '').trim()) restoredValueIds.add(`custom-${index}`);
    }
    const restoredGroup = fieldDefinitions
      .filter((field) => restoredValueIds.has(field.id))
      .map((field) => normalizeFieldGroup(field.group))[0];
    productsManuallyCleared = saved.productsManuallyCleared === true;
    if (restoredGroup) activeFieldGroup = restoredGroup;
    else if (customFields.some((field) => String(field.value ?? '').trim())) activeFieldGroup = '自定义';
    else if (products.length) activeFieldGroup = '产品';
    manuallySelectedFieldGroup = true;
    renderFields();
    const restoredFields = restoredValueIds.size;
    ui.saveState.textContent = `已恢复 ${restoredFields} 个其他字段及 ${products.length} 项产品；可切换分类查看其余字段。源文件证据需重新导入文件查看。`;
  } catch { ui.saveState.textContent = '上次保存内容无法读取。'; }
}

function resetRecord() {
  if (isExtracting) return;
  if (!window.confirm('清空当前导入结果和手工录入内容？已保存的本机记录也会一并删除。')) return;
  selectedFiles = [];
  processedDocuments = [];
  unmatchedRows = [];
  customFields = [];
  editedValues = {};
  retainedValues = {};
  products = [];
  productsManuallyCleared = false;
  localStorage.removeItem(STORAGE_KEY);
  ui.status.textContent = '';
  ui.saveState.textContent = '';
  renderFiles();
  renderFields();
}

async function init() {
  initFloatingImport();
  const overallDialog = document.querySelector('#td-overall-template-dialog');
  document.querySelector('#td-open-overall-templates').addEventListener('click', () => overallDialog.showModal());
  document.querySelector('#td-close-overall-templates').addEventListener('click', () => overallDialog.close());
  ui.closeImport.addEventListener('click', () => ui.importDialog.close());
  ui.reviewCandidates.addEventListener('click', openCandidateReview);
  ui.confirmDrop.addEventListener('click', () => {
    const files = pendingDropFiles;
    ui.dropConfirm.close();
    setModule('documents');
    addFiles(files);
    openImport();
  });
  ui.cancelDrop.addEventListener('click', () => ui.dropConfirm.close());
  ui.dropConfirm.addEventListener('close', () => { pendingDropFiles = []; });
  window.addEventListener('dragenter', (event) => {
    if (![...event.dataTransfer?.types || []].includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    if (!isExtracting) ui.pageDrop.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (![...event.dataTransfer?.types || []].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isExtracting ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) resetDrag();
  });
  window.addEventListener('drop', receiveDrop);
  window.addEventListener('dragend', resetDrag);
  window.addEventListener('blur', resetDrag);
  ui.tabs.forEach((tab) => tab.addEventListener('click', () => setModule(tab.dataset.moduleTab)));
  ui.input.addEventListener('change', (event) => {
    addFiles([...event.target.files]);
    event.target.value = '';
  });
  ui.extract.addEventListener('click', extractFiles);
  ui.clearAll.addEventListener('click', resetRecord);
  ui.clearFiles.addEventListener('click', () => {
    if (isExtracting) return;
    retainFilledValues();
    selectedFiles = [];
    processedDocuments = [];
    unmatchedRows = [];
    renderFiles();
    renderFields();
    ui.status.textContent = '';
    saveRecord();
  });
  ui.save.addEventListener('click', saveRecord);
  ui.exportFields.addEventListener('click', exportFieldsXlsx);
  ui.importFields.addEventListener('change', (event) => { importFieldsXlsx(event.target.files[0]); event.target.value = ''; });
  ui.restore.addEventListener('click', restoreLastRecord);
  ui.reset.addEventListener('click', resetRecord);
  const savedModule = localStorage.getItem('main-module');
  if (savedModule === 'documents') setModule(savedModule);
  try {
    const response = await fetch('/api/documents/fields');
    const data = await response.json();
    fieldDefinitions = data.fields || [];
  } catch {
    ui.status.textContent = '无法连接单据识别接口；手工填写仍可使用。';
  }
  try {
    const templates = await getJSON('/api/templates');
    productTemplates = templates.trade_products || [];
    sectionTemplates = templates.trade_sections || [];
    overallTemplates = templates.trade_records || [];
  } catch { /* 模板接口暂不可用时，单据识别与手工填写仍可使用。 */ }
  renderFiles();
  renderFields();
  renderOverallTemplates();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.documents?.length) {
      const note = document.createElement('small');
      note.textContent = `本机保存的上次记录包含 ${saved.documents.length} 个来源文件；点击“恢复上次填写”后可载入字段。源文件证据需重新导入文件查看。`;
      ui.summary.append(note);
    }
  } catch { /* 忽略损坏的本机草稿 */ }
}

init();
