// Synthetic DOM regressions; no customer documents or extraction service needed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; this.scrollHeight = 36; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() { this.listeners.focus?.(); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { this.listeners.click?.(); }
}
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
const context = vm.createContext({document: {querySelector: () => null, querySelectorAll: () => [], createElement: tag => new Element(tag)}, crypto: require('node:crypto').webcrypto, requestAnimationFrame: fn => fn()});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const placement = (...args) => JSON.parse(run(`JSON.stringify(sourcePopoverPlacement(...${JSON.stringify(args)}))`));
assert.deepEqual(placement({left:100,right:400,top:250,bottom:280},340,220,1440,1000),{left:406,top:250},'Prefer the right side so adjacent candidates are not on the pointer path');
assert.deepEqual(placement({left:1000,right:1300,top:250,bottom:280},340,220,1440,1000),{left:654,top:250},'Use the left side near the right viewport edge');
assert.deepEqual(placement({left:30,right:360,top:300,bottom:330},340,220,390,844),{left:20,top:80},'Narrow viewports use the upper edge without a hover gap');
assert.deepEqual(placement({left:30,right:360,top:100,bottom:130},340,220,390,844),{left:20,top:130},'If only below fits, remove the gap that exposed the next candidate');
assert.equal(run(`candidateBasis({label:'产品名称',aliases:['产品名称','Product Name']}, {rawText:'产品名称：甜玉米罐头'})`), '产品名称');
assert.equal(run(`candidateBasis({label:'产品名称',aliases:['产品名称','Product Name']}, {rawText:'Product Name: CORN'})`), 'Product Name');
assert.equal(run(`candidateBasis({label:'产品名称',aliases:['产品名称']}, {rawText:'甜玉米罐头'})`), '查看来源', 'A field label alone is not evidence');
assert.equal(run(`candidateBasis({label:'数量',aliases:['数量','quantity']}, {rawText:'样品数量：10'})`), '查看来源', 'A substring must not be presented as the matched label');
assert.equal(run(`candidateBasis({label:'产品名称'}, {rawText:'产品名称',sources:[{rawText:'没有明确标签'}]})`), '查看来源', 'The badge must describe the primary source actually shown');
const all = (node, className) => [node, ...node.children.flatMap(child => all(child, className))].filter(n => n.className?.split(' ').includes(className));
run(`
fieldDefinitions = [{id:'item_description', label:'产品名称', group:'产品'}];
processedDocuments = [
  {id:'one',fileName:'first.pdf',fields:{item_description:[{value:'Corn',location:'第1页',rawText:'Corn'}]}},
  {id:'two',fileName:'second.pdf',fields:{item_description:[{value:'Corn',location:'第2页',rawText:'Corn'},{value:'Rice',location:'第2页',rawText:'Rice'}]}}
];
saveRecord = () => { savedCount++; }; savedCount = 0;
`);
const section = new Element('section'); context.section = section;
run('renderProductCards(section, mergeCandidates(), fieldDefinitions)');
const buttons = all(section, 'document-candidate');
assert.equal(buttons.length, 2, 'Product alternatives must be clickable candidates');
assert.equal(all(section, 'document-candidate-basis').length, 2, 'Every candidate has a compact provenance badge');
assert.equal(all(section, 'document-source-popover').length, 2, 'Source details must move into popovers');
assert.equal(all(section, 'document-source-popover')[0].attributes.popover, 'auto');
buttons[1].click();
assert.equal(run('products[0].values.item_description'), 'Rice');
assert.equal(all(section, 'document-field-input')[0].value, 'Rice');
assert.equal(run('savedCount'), 1, 'Candidate selection must persist');
run('seedProductFromCandidates()');
assert.equal(run('products[0].values.item_description'), 'Rice', 'Later imports must preserve explicit selection');
const evidence = run('makeEvidence([...mergeCandidates().get("item_description").values()][0], true)');
assert.equal(evidence.children[0].className, 'document-source-card', 'One primary source remains visible');
const details = evidence.children.find(node => node.tagName === 'details');
assert.ok(details, 'Additional sources must use a native expandable control');
assert.ok(!details.open, 'Additional sources start collapsed');
assert.equal(all(evidence, 'document-source-card').length, 2, 'Collapsed sources are preserved');
assert.equal(all(evidence, 'document-source-file').length, 2);
assert.equal(all(evidence, 'document-source-location').length, 2);
const second = run('makeEvidence([...mergeCandidates().get("item_description").values()][1], true)');
assert.equal(all(second, 'document-source-card').length, 1, 'A shared location must remain available for each distinct candidate');
context.changeValue = null;
const control = run(`makeFieldControl({id:'invoice_no',label:'单据编号'}, [...mergeCandidates().get('item_description').values()], {
  id:'test-invoice', value:'', onChange:value => { changeValue = value; }
})`);
assert.equal(control.dataset.unresolvedConflict, 'true', 'An empty conflicting field needs a warning');
assert.match(all(control, 'document-field-label')[0].attributes['aria-label'], /来源冲突待选择/);
all(control, 'document-candidate')[0].click();
assert.equal(control.dataset.unresolvedConflict, 'false', 'Choosing a source clears the warning');
assert.equal(context.changeValue, 'Corn', 'Regular fields must use the same selection behavior');
const textInput = all(control, 'document-field-input')[0];
textInput.value = 'Manual'; textInput.listeners.input();
assert.equal(context.changeValue, 'Manual');
assert.equal(all(control, 'document-candidate').every(button => button.attributes['aria-pressed'] === 'false'), true);
assert.equal(control.dataset.unresolvedConflict, 'false', 'A manually entered value resolves the conflict');
textInput.value = '  '; textInput.listeners.input();
assert.equal(control.dataset.unresolvedConflict, 'true', 'Clearing the value restores the warning');
assert.equal(run(`hasUnresolvedConflict([{value:'Corn'},{value:'Corn'}], '')`), false, 'Repeated evidence of the same value is not a conflict');
run(`fieldDefinitions.push({id:'invoice_no', label:'单据编号', group:'单据'});
processedDocuments.push({id:'invoices',fields:{invoice_no:[{value:'A'},{value:'B'}]}});
editedValues = {}; ui.groupTiles = {children: []};`);
const groupTile = new Element('button'); groupTile.dataset.fieldGroup = '单据';
context.groupTile = groupTile;
run('ui.groupTiles.children.push(groupTile); updateGroupConflictIndicators();');
assert.equal(groupTile.dataset.unresolvedConflict, 'true', 'The navigation entry warns about unresolved fields');
run("editedValues.invoice_no = 'Manual'; updateGroupConflictIndicators();");
assert.equal(groupTile.dataset.unresolvedConflict, 'false', 'Manual resolution clears the navigation warning');
run("editedValues.invoice_no = ''; updateGroupConflictIndicators();");
assert.equal(groupTile.dataset.unresolvedConflict, 'true');
run("processedDocuments = processedDocuments.filter(item => item.id !== 'invoices'); fieldDefinitions.pop(); editedValues = {};");
const single = run(`makeFieldControl({id:'quantity',label:'数量'}, [{value:'100',rawText:'数量：100'}], {id:'single',value:'',onChange:value => {changeValue=value;}})`);
assert.equal(single.dataset.unresolvedConflict, 'false', 'Missing values without competing sources do not get a conflict dot');
assert.equal(all(single, 'document-candidate').length, 1, 'Single candidates use the same compact row');
all(single, 'document-candidate')[0].click();
assert.equal(context.changeValue, '100');
run(`processedDocuments.push({id:'three',fileName:'empty-evidence.pdf',fields:{invoice_no:[{value:'INV-1',evidence:[],location:'第3页',rawText:'Invoice: INV-1'}]}})`);
assert.equal(run('mergeCandidates().get("invoice_no").values().next().value.sources[0].location'), '第3页', 'Empty evidence arrays must retain the candidate location');
run(`selectedFiles = [{id:'one',file:{name:'first.pdf'}}]; openDocumentSource = (file,location,value) => { opened = {file:file.name,location,value}; };`);
const preview = run('makeEvidence([...mergeCandidates().get("item_description").values()][0], false)');
all(preview, 'document-source-link')[0].click();
assert.equal(run('opened.location'), '第1页');
assert.equal(run('opened.value'), 'Corn', 'Source navigation must retain the selected candidate');
console.log('Shared field controls: product selection, persistence, source folding and provenance passed');

// Both Excel formats use the same source navigation with the evidence location.
for (const name of ['arbitrary.xls', 'arbitrary.XLS', 'arbitrary.xlsx']) {
  run(`selectedFiles = [{id:'excel',file:{name:${JSON.stringify(name)}}}]; openWorkbookSource = (file,location) => { opened = {file:file.name,location}; };`);
  const card = run(`makeSourceCard({documentId:'excel',fileName:${JSON.stringify(name)},location:'工作表「来源表」!B2'}, {value:'125'})`);
  assert.equal(all(card, 'document-source-link').length, 1, `${name} must offer source navigation`);
  all(card, 'document-source-link')[0].click();
  assert.equal(run('opened.file'), name);
  assert.equal(run('opened.location'), '工作表「来源表」!B2');
}

// Manual/template cards offer previous values without attributing them to files.
run(`renderFields = () => {}; ui.saveState = {}; products[0].values.item_description = 'Edited corn'; addProduct(); applyProductTemplate({id:'saved', name:'Saved', values:{item_description:'Template corn'}});`);
const manualSection = new Element('section'); context.manualSection = manualSection;
run('renderProductCards(manualSection, mergeCandidates(), fieldDefinitions)');
const cards = all(manualSection, 'document-product-card');
assert.equal(all(cards[0], 'document-source-popover').length, 2, 'Recognized products retain provenance');
for (const card of cards.slice(1)) {
  assert.equal(all(card, 'document-source-popover').length, 0, 'Manual and template products must not show source windows');
  assert.equal(all(card, 'document-candidate-basis').length, 0);
  const suggestions = all(card, 'document-product-suggestions')[0];
  assert.ok(suggestions, 'Manual cards offer a value dropdown');
  assert.equal(suggestions.hidden, true, 'Suggestions start closed');
  all(card, 'document-field-input')[0].listeners.focus();
  assert.equal(suggestions.hidden, false, 'Focusing the field opens suggestions');
  const choices = all(suggestions, 'document-candidate');
  assert.ok(choices.some(button => button.textContent === 'Edited corn'), 'Offer the current value of the product above');
  choices.find(button => button.textContent === 'Edited corn').click();
  assert.equal(suggestions.hidden, true, 'Choosing a value closes the dropdown');
}
assert.equal(run('products[1].values.item_description'), 'Edited corn', 'Selecting a suggestion fills and persists the manual product');
assert.equal(run('products[2].values.item_description'), 'Edited corn', 'Selecting a suggestion fills the template product');
run('products = []; productsManuallyCleared = true; addProduct();');
assert.equal(run('products[0].values.item_description'), '', 'Adding a manual product never copies recognized values automatically');
console.log('Manual/template product suggestions and provenance isolation passed');
