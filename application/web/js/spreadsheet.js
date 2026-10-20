const params = new URLSearchParams(location.search);
const sessionId = params.get('session');
const focusSheet = params.get('sheet') || '';
const focusCell = params.get('cell') || '';
const focusRow = params.get('row') || '';
const fileName = document.querySelector('#file-name');
const focusNote = document.querySelector('#focus-note');
const sheetSelect = document.querySelector('#sheet-select');
const saveButton = document.querySelector('#save-button');
const originalLink = document.querySelector('#original-link');
const sheetWrap = document.querySelector('#sheet-wrap');
const status = document.querySelector('#status');
let workbook;
let activeSheet;
const edits = new Map();

function columnName(index) {
  let name = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function coordinate(row, col) { return `${columnName(col + 1)}${row + 1}`; }

function applyCellStyle(cell, style) {
  if (!style) return;
  const font = style.font || {};
  if (font.name) cell.style.fontFamily = `"${font.name.replace(/["\\]/g, '')}", sans-serif`;
  if (Number.isFinite(font.size)) cell.style.fontSize = `${Math.min(48, Math.max(8, font.size))}pt`;
  if (font.bold) cell.style.fontWeight = '700';
  if (font.italic) cell.style.fontStyle = 'italic';
  if (font.underline) cell.style.textDecoration = 'underline';
  if (font.strike) cell.style.textDecoration = `${cell.style.textDecoration} line-through`.trim();
  if (/^#[0-9a-f]{6}$/i.test(font.color || '')) cell.style.color = font.color;
  if (/^#[0-9a-f]{6}$/i.test(style.fill || '')) cell.style.backgroundColor = style.fill;
  const alignment = style.alignment || {};
  if (['left', 'center', 'right', 'justify', 'fill', 'distributed'].includes(alignment.horizontal)) {
    cell.style.textAlign = alignment.horizontal === 'distributed' ? 'justify' : alignment.horizontal;
  }
  if (['top', 'center', 'bottom'].includes(alignment.vertical)) {
    cell.style.verticalAlign = alignment.vertical === 'center' ? 'middle' : alignment.vertical;
  }
  if (alignment.wrap) cell.style.whiteSpace = 'pre-wrap';
  if (Number.isFinite(alignment.indent) && alignment.indent > 0) cell.style.paddingLeft = `${Math.min(40, 7 + alignment.indent * 12)}px`;
  const borderStyles = { hair: 'dotted', dotted: 'dotted', dashed: 'dashed', dashDot: 'dashed',
    dashDotDot: 'dashed', thin: 'solid', medium: 'solid', thick: 'solid', double: 'double',
    mediumDashed: 'dashed', mediumDashDot: 'dashed', mediumDashDotDot: 'dashed', slantDashDot: 'dashed' };
  for (const [side, border] of Object.entries(style.borders || {})) {
    const cssSide = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' }[side];
    if (!cssSide) continue;
    const width = ['medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot'].includes(border.style) ? 2
      : border.style === 'thick' ? 3 : 1;
    const color = /^#[0-9a-f]{6}$/i.test(border.color || '') ? border.color : '#9ca3af';
    const line = borderStyles[border.style] || 'solid';
    cell.style[`border${cssSide}`] = `${width}px ${line} ${color}`;
  }
}

function renderSheet(name) {
  activeSheet = workbook.sheets.find((sheet) => sheet.name === name) || workbook.sheets[0];
  if (!activeSheet) return;
  const table = document.createElement('table');
  const columns = Math.max(1, activeSheet.maxColumn);
  const mergedAt = new Map();
  const mergedCovered = new Set();
  for (const range of activeSheet.merged || []) {
    mergedAt.set(`${range.minRow}:${range.minColumn}`, range);
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let col = range.minColumn; col <= range.maxColumn; col += 1) {
        if (row !== range.minRow || col !== range.minColumn) mergedCovered.add(`${row}:${col}`);
      }
    }
  }
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.textContent = '';
  headerRow.append(corner);
  const colgroup = document.createElement('colgroup');
  const rowHeaderCol = document.createElement('col');
  rowHeaderCol.style.width = '52px';
  colgroup.append(rowHeaderCol);
  for (let col = 0; col < columns; col += 1) {
    const colElement = document.createElement('col');
    const dimension = (activeSheet.columns || []).find((item) => {
      const start = item.min || item.letter?.split(':')[0].charCodeAt(0) - 64;
      const end = item.max || item.letter?.split(':').at(-1).charCodeAt(0) - 64;
      return col + 1 >= start && col + 1 <= end;
    });
    const width = dimension?.width || activeSheet.defaultColumnWidth || 8.43;
    colElement.style.width = `${Math.max(40, Math.min(600, width * 7 + 5))}px`;
    if (dimension?.hidden) colElement.style.display = 'none';
    colgroup.append(colElement);
    const th = document.createElement('th');
    th.textContent = columnName(col + 1);
    headerRow.append(th);
  }
  head.append(headerRow);
  table.append(colgroup);
  table.append(head);
  const body = document.createElement('tbody');
  for (let row = 0; row < activeSheet.maxRow; row += 1) {
    const tr = document.createElement('tr');
    tr.dataset.row = String(row + 1);
    const rowDimension = activeSheet.rowDimensions?.[String(row + 1)];
    const rowHeight = rowDimension?.height;
    if (Number.isFinite(rowHeight) && rowHeight > 0) tr.style.height = `${Math.min(240, rowHeight * 1.333)}px`;
    if (rowDimension?.hidden) tr.style.display = 'none';
    const rowHead = document.createElement('th');
    rowHead.className = 'row-head';
    rowHead.textContent = String(row + 1);
    tr.append(rowHead);
    const values = activeSheet.rows[row] || [];
    for (let col = 0; col < columns; col += 1) {
      if (mergedCovered.has(`${row + 1}:${col + 1}`)) continue;
      const cell = document.createElement('td');
      const ref = coordinate(row, col);
      const key = `${activeSheet.name}\u0000${ref}`;
      const value = values[col];
      const shown = edits.has(key) ? edits.get(key).value : value;
      cell.textContent = shown === null || shown === undefined ? '' : String(shown);
      cell.contentEditable = workbook.capabilities?.edit === false ? 'false' : 'true';
      cell.spellcheck = false;
      cell.dataset.sheet = activeSheet.name;
      cell.dataset.cell = ref;
      const merged = mergedAt.get(`${row + 1}:${col + 1}`);
      if (merged) {
        cell.rowSpan = merged.maxRow - merged.minRow + 1;
        cell.colSpan = merged.maxColumn - merged.minColumn + 1;
      }
      applyCellStyle(cell, workbook.styles?.[activeSheet.styleIds?.[row]?.[col]]);
      if (edits.has(key)) cell.classList.add('edited');
      cell.addEventListener('input', () => {
        if (workbook.capabilities?.edit === false) return;
        edits.set(key, { sheet: activeSheet.name, cell: ref, value: cell.textContent });
        cell.classList.add('edited');
        saveButton.disabled = false;
        status.textContent = `已有 ${edits.size} 个单元格修改尚未下载。`;
      });
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  sheetWrap.replaceChildren(table);
  if (name === focusSheet && /^[1-9]\d*$/.test(focusRow) && !focusCell) {
    const target = sheetWrap.querySelector(`tr[data-row="${CSS.escape(focusRow)}"]`);
    if (target) {
      target.classList.add('focus-row');
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      focusNote.textContent = `已定位到 ${name} 第 ${focusRow} 行；来源未提供精确单元格。`;
    } else {
      focusNote.textContent = `来源位置 ${name} 第 ${focusRow} 行未在工作表中找到。`;
    }
  }
  if (name === focusSheet && focusCell) {
    let target = sheetWrap.querySelector(`td[data-cell="${CSS.escape(focusCell)}"]`);
    if (!target) {
      const match = focusCell.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        let col = 0;
        for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64;
        const row = Number(match[2]);
        const merged = (activeSheet.merged || []).find((range) => row >= range.minRow && row <= range.maxRow && col >= range.minColumn && col <= range.maxColumn);
        if (merged) target = sheetWrap.querySelector(`td[data-cell="${CSS.escape(coordinate(merged.minRow - 1, merged.minColumn - 1))}"]`);
      }
    }
    if (target) {
      target.classList.add('focus-cell');
      target.scrollIntoView({ block: 'center', inline: 'center' });
      focusNote.textContent = `已定位到 ${name}!${focusCell}；${workbook.capabilities?.edit === false ? '当前来源为只读查看。' : '可直接编辑任意单元格。'}`;
    } else {
      focusNote.textContent = `来源位置 ${name}!${focusCell} 未在工作表中找到。`;
    }
  }
}

async function loadWorkbook() {
  if (!sessionId) throw new Error('缺少工作簿会话信息，请从单据冲突来源重新打开。');
  const query = new URLSearchParams({ sheet: focusSheet, cell: focusCell });
  const response = await fetch(`/api/documents/workbook-sessions/${encodeURIComponent(sessionId)}?${query}`);
  if (!response.ok) {
    let message = '无法读取工作簿。';
    try { message = (await response.json()).detail || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  workbook = await response.json();
  const readOnly = workbook.capabilities?.edit === false;
  document.title = readOnly ? 'Excel 来源查看' : 'Excel 工作簿编辑器';
  sheetWrap.setAttribute('aria-label', readOnly ? '只读工作表' : '可编辑工作表');
  fileName.textContent = workbook.fileName || 'Excel 工作簿';
  originalLink.href = `/api/documents/workbook-sessions/${encodeURIComponent(sessionId)}/original`;
  originalLink.download = workbook.fileName || '工作簿';
  originalLink.hidden = false;
  saveButton.hidden = readOnly;
  focusNote.textContent = readOnly ? '只读查看来源，可切换工作表或下载原文件。' : '可编辑工作表并下载修改后的副本。';
  sheetSelect.replaceChildren(...workbook.sheets.map((sheet) => {
    const option = document.createElement('option');
    option.value = sheet.name;
    option.textContent = sheet.name;
    return option;
  }));
  const initial = workbook.sheets.some((sheet) => sheet.name === focusSheet) ? focusSheet : workbook.sheets[0]?.name;
  sheetSelect.value = initial;
  sheetSelect.disabled = false;
  saveButton.disabled = true;
  saveButton.addEventListener('click', saveWorkbook);
  sheetSelect.addEventListener('change', () => renderSheet(sheetSelect.value));
  renderSheet(initial);
  status.textContent = readOnly
    ? '当前 .xls 文件为只读查看，保留单元格与合并区域；图片、图表和打印版式请下载原文件查看。'
    : '编辑会话保存在本机应用内存中，关闭应用后会失效。下载按钮会生成修改后的副本。';
}

async function saveWorkbook() {
  if (!edits.size || workbook.capabilities?.edit === false) return;
  saveButton.disabled = true;
  status.textContent = '正在生成 Excel 副本…';
  try {
    const response = await fetch(`/api/documents/workbook-sessions/${encodeURIComponent(sessionId)}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [...edits.values()] }),
    });
    if (!response.ok) {
      let message = '生成文件失败。';
      try { message = (await response.json()).detail || message; } catch { /* ignore */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.textContent || '工作簿-已修改.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `已下载修改后的副本（${edits.size} 个单元格修改）。`;
  } catch (error) {
    status.textContent = error.message || '生成文件失败。';
    saveButton.disabled = false;
  }
}

loadWorkbook().catch((error) => {
  focusNote.textContent = error.message || '工作簿读取失败。';
  status.textContent = error.message || '工作簿读取失败。';
  sheetWrap.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: status.textContent }));
});
