// Synthetic template flows, without customer files or a running server.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.classList = {toggle(){}}; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute() {}
  querySelectorAll() { return []; }
}
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8').replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
const writes = [], deletes = [];
let storedRecord;
const context = vm.createContext({document:{querySelector:()=>null,querySelectorAll:()=>[],createElement:tag=>new Element(tag)}, crypto:require('node:crypto').webcrypto,
  putJSON:async(url,body)=>{writes.push({url,body});return body;}, deleteJSON:async url=>{deletes.push(url);return {ok:true};}, window:{confirm:()=>true}, structuredClone,
  localStorage:{setItem:(_,value)=>{storedRecord=value;},getItem:()=>storedRecord}});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
(async () => {
  run(`ui.saveState = {}; originalSaveRecord = saveRecord; renderFields = () => {}; saveRecord = () => {}; renderOverallTemplates = () => {}; products = [{id:'one',values:{item_description:'First'}},{id:'two',values:{item_description:'Second',quantity:'23'}}];`);
  assert.equal(run(`productTemplateDefaultName(products[1], 1)`), 'Second', 'Name must default to the selected product');
  await run(`persistTemplate('trade_products', 'Second', reusableProductValues(products[1].values))`);
  assert.equal(writes[0].body.values.item_description, 'Second');
  assert.equal(writes[0].body.values.quantity, '23');
  const savedId = writes[0].body.id;
  await run(`deleteSavedTemplate('trade_products', productTemplates[0])`);
  assert.equal(deletes[0], `/api/templates/trade_products/${savedId}`);
  assert.equal(run('productTemplates.length'), 0);
  run(`fieldDefinitions = [{id:'invoice_no',group:'单据'},{id:'buyer',group:'交易方'}]; editedValues = {invoice_no:'INV-2',buyer:'Keep'};`);
  assert.equal(run(`sectionTemplateValues('单据').fields.invoice_no`), 'INV-2');
  assert.equal(run(`sectionTemplateValues('单据').fields.buyer`), undefined);
  run(`applySectionTemplate({name:'Invoice',values:{group:'单据',fields:{invoice_no:'INV-3',buyer:'Wrong'}}})`);
  assert.equal(run('editedValues.invoice_no'), 'INV-3');
  assert.equal(run('editedValues.buyer'), 'Keep', 'Section application must stay within its group');
  run(`processedDocuments = [{id:'source',fields:{}}]; applyOverallTemplate({name:'All',values:{fields:{buyer:'New'},products:[{values:{item_description:'Saved'}}],customFields:[{label:'Mark',value:'A'}]}})`);
  assert.equal(run('products[0].values.item_description'), 'Saved');
  assert.equal(run('customFields[0].value'), 'A');
  assert.equal(run('processedDocuments[0].id'), 'source', 'Applying templates must preserve source evidence');
  assert.equal(run('products[0].autoSeeded'), undefined, 'Template products must not be overwritten by source seeding');
  context.fieldGroup = new Element('div');
  run(`ui.fieldGroups = fieldGroup; products = []; productsManuallyCleared = true; originalSaveRecord(); productsManuallyCleared = false; restoreLastRecord();`);
  assert.equal(run('productsManuallyCleared'), true, 'Restoring a cleared list must preserve deliberate emptiness');
  run(`fieldDefinitions = [{id:'item_description',group:'产品'}]; processedDocuments = [{id:'source',fields:{item_description:[{value:'Source product'}]}}]; seedProductFromCandidates();`);
  assert.equal(run('products.length'), 0, 'Source candidates must not repopulate the restored empty list');
  run(`products = [{id:'recognized', values:{item_description:'Corn'},autoSeeded:true,editedFields:['item_description']},{id:'manual',values:{item_description:'Rice'}}]; originalSaveRecord(); products = []; restoreLastRecord();`);
  assert.equal(run('products[0].autoSeeded'), true, 'Restored recognized products retain their provenance mode');
  assert.equal(run('products[0].editedFields[0]'), 'item_description', 'Restored edits must survive later source imports');
  assert.equal(run('products[1].autoSeeded'), undefined, 'Restored manual products remain free of provenance windows');
  console.log('Template actions: naming, selected product, deletion, group isolation and overall restore passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
