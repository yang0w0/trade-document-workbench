// Exercise delete/clear/reimport through the real event handlers with synthetic results.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute() {}
  querySelectorAll() { return []; }
  close() { this.open = false; }
  click() { return this.listeners.click?.(); }
}
const nodes = new Map();
const storage = new Map();
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
const context = vm.createContext({
  document: {
    querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); },
    querySelectorAll: () => [], createElement: () => new Element(),
  },
  crypto: require('node:crypto').webcrypto,
  window: { addEventListener() {}, confirm: () => true },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  FormData, Blob,
  fetch: async () => ({json: async () => ({fields: []})}),
  getJSON: async () => ({}),
});
const run = code => vm.runInContext(code, context);
run(source);
const descendants = node => [node, ...node.children.flatMap(descendants)];
const clickProductAction = text => {
  const button = descendants(context.section).find(node => node.textContent === text);
  assert.ok(button, `Missing product action: ${text}`);
  return button.click();
};
(async () => {
  run(`
    section = document.createElement('section');
    initFloatingImport = () => {};
    renderFiles = () => {};
    updateSummary = () => {};
    // Candidate dialog behavior is covered by test_candidate_review.cjs.
    openCandidateReview = () => {};
    renderOverallTemplates = () => {};
    renderFields = () => {
      section.replaceChildren();
      renderProductCards(section, mergeCandidates(), []);
    };
    nextFields = {item_description: [{value: 'Synthetic corn', location: 'A1'}], quantity: [{value: '100', location: 'B1'}]};
    failUpload = false;
    postForm = async () => {
      if (failUpload) throw new Error('Synthetic upload failure');
      return {document: {fileName: 'synthetic.xlsx', method: 'Excel'}, fields: nextFields};
    };
    queueFile = () => {
      const file = new Blob(['synthetic']); file.name = 'synthetic.xlsx';
      selectedFiles.push({id: crypto.randomUUID(), file, state: '等待识别'});
    };
  `);
  await run('init()');
  run(`resetRecord(); editedValues = {contract_no: ''}; nextFields = {contract_no:[{value:'CONTRACT-SINGLE',location:'A1',rawText:'Contract No: CONTRACT-SINGLE'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.contract_no'), 'CONTRACT-SINGLE', 'A blank form snapshot must not block a newly recognized single candidate');
  assert.equal(run('mergeCandidates().get("contract_no").size'), 1);
  assert.equal(run('[...mergeCandidates().get("contract_no").values()][0].sources[0].location'), 'A1', 'Autofill must preserve the source evidence');
  run(`saveRecord(); editedValues = {}; restoreLastRecord()`);
  assert.equal(run('editedValues.contract_no'), 'CONTRACT-SINGLE', 'Autofill must survive save and restore');
  run(`resetRecord(); editedValues = {contract_no: '  '}; nextFields = {contract_no:[{value:'CONTRACT-TRIM'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.contract_no'), 'CONTRACT-TRIM', 'Whitespace must count as blank during successful import');
  run(`resetRecord(); editedValues = {contract_no:''}; nextFields = {contract_no:[{value:'CONTRACT-A'},{value:'CONTRACT-B'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.contract_no'), '', 'Multiple candidates must remain unselected');
  run(`resetRecord(); nextFields = {item_description:[{value:'Synthetic corn',location:'A1'}],quantity:[{value:'100',location:'B1'}]}`);
  run('queueFile()');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products[0].values.item_description'), 'Synthetic corn');
  clickProductAction('删除产品');
  assert.equal(run('products.length'), 0, 'Deleting the last card must not immediately recreate it');
  run('renderFields()');
  assert.equal(run('products.length'), 0, 'Rerendering existing candidates must respect deletion');
  nodes.get('#td-clear-files-btn').click();
  assert.equal(run('processedDocuments.length'), 0);
  run('queueFile()');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products.length'), 1, 'Reimport after deleting products and clearing files must restore a recognized product');
  assert.equal(run('products[0].values.quantity'), '100');
  assert.equal(run('mergeCandidates().get("item_description").values().next().value.sources[0].location'), 'A1');

  clickProductAction('清空列表');
  run('queueFile(); failUpload = true');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products.length'), 0, 'A failed upload must not resurrect deleted products from old candidates');
  run('failUpload = false; nextFields = {invoice_no: [{value: "INV-1"}]}');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products.length'), 0, 'Importing unrelated fields must not resurrect deleted product candidates');
  run('nextFields = {item_description: [{value: "Synthetic rice", location: "C1"}]}; queueFile()');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products.length'), 1, 'A fresh product result must also work after clearing the product list');
  assert.equal(run('mergeCandidates().get("item_description").size'), 2, 'New and old conflicting evidence must remain available');
  run('products[0].values.item_description = "Manual selection"; products[0].editedFields = ["item_description"]; queueFile()');
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('products[0].values.item_description'), '', 'Different imported values must require a fresh choice even after manual editing');
  assert.equal(run('products.length'), 1, 'Later recognition must not duplicate an existing product');
  // Every filled value counts as an existing source, including automatic values.
  run(`resetRecord(); nextFields = {invoice_no: [{value: 'INV-OLD'}], item_description: [{value: 'Auto product'}], quantity: [{value: '100'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  nodes.get('#td-clear-files-btn').click();
  assert.equal(run('editedValues.invoice_no'), 'INV-OLD', 'Clearing files must preserve automatically filled ordinary fields');
  assert.equal(run('products[0].values.quantity'), '100', 'Clearing files must preserve automatically filled product fields');
  assert.equal(run('selectedFiles.length + processedDocuments.length'), 0);
  run(`nextFields = {invoice_no: [{value: 'INV-NEW'}], quantity: [{value: '200'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), '', 'Conflicting imports must clear the default selection, preserving the value as a source');
  assert.equal(run('mergeCandidates().get("invoice_no").size'), 2, 'Filled value must join conflicting file sources');
  assert.equal(run('products[0].values.quantity'), '');
  assert.equal(run('hasUnresolvedConflict(productCandidates(products[0], "quantity"), products[0].values.quantity)'), true);
  assert.equal(run('productCandidates(products[0], "quantity").length'), 2);
  assert.equal(run('mergeCandidates().get("invoice_no").get(normalize("INV-OLD")).sources[0].fileName'), '已填写内容');
  run(`nextFields = {invoice_no: [{value: 'INV-OLD'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('mergeCandidates().get("invoice_no").size'), 2, 'Repeated filled values must merge');
  assert.equal(run('mergeCandidates().get("invoice_no").get(normalize("INV-OLD")).sources.length'), 2, 'Matching file and filled sources must both remain');
  nodes.get('#td-clear-files-and-fields-btn').click();
  assert.equal(run('products.length + Object.keys(editedValues).length + mergeCandidates().size + selectedFiles.length'), 0, 'New clear-all action must clear files, fields and retained sources');
  run(`editedValues = {invoice_no: 'Typed first'}; products = [{id:'manual', values:{quantity:'30'}}]; nextFields = {invoice_no:[{value:'Imported'}],quantity:[{value:'40'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), '');
  assert.equal(run('mergeCandidates().get("invoice_no").size'), 2);
  assert.equal(run('productCandidates(products[0], "quantity").length'), 2, 'Manual products must expose conflicting import candidates after import');
  run('saveRecord(); products = []; editedValues = {}; retainedValues = {}; restoreLastRecord()');
  assert.equal(run('products[0].retainedValues.quantity'), '30', 'Product retained sources must survive saving');
  assert.equal(run('retainedValues.invoice_no'), 'Typed first', 'Ordinary retained sources must survive saving');
  run(`resetRecord(); nextFields = {invoice_no:[{value:'Automatic first'}], quantity:[{value:'10'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  run(`nextFields = {invoice_no:[{value:'Automatic second'}], quantity:[{value:'20'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), '', 'Adding conflicting files must require ordinary field confirmation');
  assert.equal(run('products[0].values.quantity'), '', 'Adding conflicting files must require product field confirmation');
  run(`products.push({id:'second',values:{quantity:'999'}}); retainFilledValues()`);
  assert.equal(run('productCandidates(products[0], "quantity").some(candidate => candidate.value === "999")'), false, 'Filled product sources must stay scoped to their own card');
  nodes.get('#td-clear-files-and-fields-btn').click();
  run(`resetRecord(); editedValues = {invoice_no:'SAME'}; products = [{id:'same',values:{quantity:'10'}}]; nextFields = {invoice_no:[{value:'SAME'}],quantity:[{value:'10'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), 'SAME', 'Matching sources must keep the existing value');
  assert.equal(run('products[0].values.quantity'), '10');
  run(`nextFields = {invoice_no:[{value:'OTHER'}],quantity:[{value:'20'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), '');
  assert.equal(run('products[0].values.quantity'), '');
  run(`queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('retainedValues.invoice_no'), 'SAME', 'Reimport while unresolved must retain the original filled source');
  assert.equal(run('products[0].retainedValues.quantity'), '10');
  run(`editedValues.invoice_no = 'Chosen'; products[0].values.quantity = '30'; nextFields = {contract_no:[{value:'UNRELATED'}]}; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), 'Chosen', 'Unrelated imports must preserve resolved choices');
  assert.equal(run('products[0].values.quantity'), '30');
  run(`failUpload = true; queueFile()`);
  await nodes.get('#td-extract-btn').click();
  assert.equal(run('editedValues.invoice_no'), 'Chosen', 'Failed imports must preserve resolved choices');
  assert.equal(run('products[0].values.quantity'), '30');
  console.log('Product delete/clear/reimport regressions passed (including failed and unrelated imports, evidence and manual edits)');
})().catch(error => { console.error(error); process.exitCode = 1; });
