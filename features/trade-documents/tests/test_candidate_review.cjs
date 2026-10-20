// Synthetic conflicts only; never reads business documents.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; this.scrollHeight = 36; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() {}
  click() { if (!this.disabled) this.listeners.click?.(); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  remove() { this.removed = true; }
}
const body = new Element('body');
const context = vm.createContext({document: {body, querySelector: () => null, querySelectorAll: () => [], createElement: tag => new Element(tag)}, requestAnimationFrame: fn => fn(), crypto: require('node:crypto').webcrypto});
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8').replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const all = node => [node, ...node.children.flatMap(all)];
const button = (dialog, text) => all(dialog).find(node => node.tagName === 'button' && node.textContent === text);
run(`fieldDefinitions = [
  {id:'invoice_no',label:'发票编号',group:'单据'},
  {id:'currency',label:'币种',group:'付款'},
  {id:'item_description',label:'产品名称',group:'产品'},
  {id:'quantity',label:'数量',group:'产品'}
];
processedDocuments = [{id:'synthetic',fileName:'演示资料.txt',fields:{
  invoice_no:[{value:'DEMO-A'},{value:'DEMO-B'}], currency:[{value:'USD'},{value:'USD'}],
  item_description:[{value:'演示产品 A'},{value:'演示产品 B'}], quantity:[{value:'10'},{value:'20'}]
}}];
editedValues = {}; products = [{id:'auto',autoSeeded:true,values:{quantity:'10'}},{id:'manual',values:{}}];
renderFields = () => { renderCount++; }; saveRecord = () => { savedCount++; };
renderCount = 0; savedCount = 0;`);
assert.equal(run('collectCandidateConflicts().length'), 2, 'Only unresolved distinct values, including imported products, need review');
run('openCandidateReview()');
let dialog = body.children.at(-1);
assert.equal(dialog.open, true);
assert.equal(button(dialog, '确认并继续').disabled, true, 'Blank conflicts cannot be confirmed');
button(dialog, 'DEMO-B').click();
assert.equal(run('editedValues.invoice_no'), 'DEMO-B');
assert.equal(run('savedCount'), 1, 'Selection persists immediately');
assert.equal(button(dialog, '确认并继续').disabled, false);
button(dialog, '确认并继续').click();
assert.ok(all(dialog).some(node => node.textContent?.endsWith('产品 1 · 产品名称')));
button(dialog, '跳过此项').click();
assert.equal(dialog.open, false);
assert.equal(run('products[0].values.item_description'), undefined, 'Skipping never guesses a value');
run('openCandidateReview()');
dialog = body.children.at(-1);
const input = all(dialog).find(node => node.tagName === 'textarea');
input.value = '手工产品'; input.listeners.input();
assert.equal(run('products[0].values.item_description'), '手工产品');
assert.equal(run('products[0].editedFields.includes("item_description")'), true);
button(dialog, '跳过全部').click();
assert.equal(dialog.open, false);
const count = body.children.length;
run('openCandidateReview()');
assert.equal(body.children.length, count, 'No dialog when all conflicts have been resolved');
run(`editedValues.invoice_no = ''; products[0].values.item_description = ''; openCandidateReview();`);
dialog = body.children.at(-1);
button(dialog, '跳过全部').click();
assert.equal(run('editedValues.invoice_no'), '');
assert.equal(run('products[0].values.item_description'), '');
assert.equal(run('collectCandidateConflicts().length'), 2, 'Skip all retains unresolved conflicts for later');
async function checkBatchImport() {
  context.FormData = class { append() {} };
  run(`
    processedDocuments = []; editedValues = {}; products = []; productsManuallyCleared = false;
    ui.importDialog = document.createElement('dialog'); ui.importDialog.showModal();
    ui.extract = {}; ui.status = {}; renderFiles = () => {}; updateSummary = () => {};
    retainFilledValues = () => {};
    selectedFiles = ['A', 'B'].map(id => ({id, file:{name:id + '.txt'},state:'等待识别'}));
    postForm = async () => ({document:{fileName:'synthetic.txt',method:'text'},fields:{invoice_no:[{value:'A'},{value:'B'}]}});
    reviewCount = 0; const actualOpenReview = openCandidateReview;
    openCandidateReview = () => {reviewCount++; actualOpenReview();};
  `);
  await run('extractFiles()');
  assert.equal(run('reviewCount'), 1, 'Review opens once after the whole batch');
  assert.equal(run('processedDocuments.length'), 2);
  assert.equal(run('ui.importDialog.open'), false);
  assert.equal(body.children.at(-1).open, true);
  body.children.at(-1).close();
  run(`ui.skipReview = {checked:true}; ui.importDialog.showModal(); selectedFiles = [{id:'bad',file:{name:'bad.txt'},state:'等待识别'}];
    postForm = async () => {throw new Error('Synthetic failure');};`);
  await run('extractFiles()');
  assert.equal(run('reviewCount'), 1, 'A completely failed batch never opens a review of stale values');
  assert.equal(run('ui.importDialog.open'), true, 'Failure keeps the retry window available');
  assert.equal(run('ui.skipReview.checked'), false, 'Even a failed attempt must not carry its skip setting into a retry');
  run(`ui.skipReview = {checked:true};
    selectedFiles = [{id:'skip',file:{name:'skip.txt'},state:'等待识别'}];
    postForm = async () => ({document:{fileName:'skip.txt',method:'text'},fields:{invoice_no:[{value:'C'},{value:'D'}]}});`);
  await run('extractFiles()');
  assert.equal(run('reviewCount'), 1, 'The batch skip option suppresses automatic review');
  assert.equal(run('editedValues.invoice_no'), '', 'Automatic skipping must not choose a value');
  assert.equal(run('ui.skipReview.checked'), false, 'The skip option applies only to the current successful batch');
  run(`ui.skipReview.checked = true; openImport();`);
  assert.equal(run('ui.skipReview.checked'), false, 'A new import window defaults to asking for review');
  run('ui.reviewCandidates = {}; updateGroupConflictIndicators();');
  assert.equal(run('ui.reviewCandidates.disabled'), false, 'Skipped conflicts can be reopened from the toolbar');
  console.log('Candidate review: batch completion, failed import, selection, manual input, skips and product isolation passed');
}
checkBatchImport().catch(error => { console.error(error); process.exitCode = 1; });
