const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8');
const start = source.indexOf('async function openWorkbookSource(');
const end = source.indexOf('async function openDocumentSource(', start);
const tab = {location: {}, close() { throw new Error('Navigation unexpectedly failed'); }};
const context = vm.createContext({window: {open: () => tab}, URLSearchParams, FormData,
  postForm: async () => ({sessionId: 'synthetic'}), ui: {status: {}}});
vm.runInContext(source.slice(start, end), context);
(async () => {
  for (const [location, want] of [
    ['工作表「来源表」!B2', {sheet: '来源表', cell: 'B2'}],
    ['工作表「来源表」第 10 行', {sheet: '来源表', row: '10'}],
    ['', {}],
  ]) {
    await context.openWorkbookSource(new Blob(['synthetic']), location);
    const url = new URL(tab.location.href, 'http://localhost');
    assert.equal(url.pathname, '/spreadsheet.html');
    assert.deepEqual(Object.fromEntries(url.searchParams), {session: 'synthetic', ...want});
  }
  console.log('Excel navigation: cell, row-only and whole-file evidence passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
