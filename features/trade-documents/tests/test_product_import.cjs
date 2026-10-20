const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
const context = vm.createContext({document: {querySelector: () => null, querySelectorAll: () => []}, crypto: require('node:crypto').webcrypto});
vm.runInContext(source, context);
vm.runInContext(`
fieldDefinitions = [{id: 'item_description', group: '产品'}, {id: 'quantity', group: '产品'}, {id: 'brand', group: '产品'}];
processedDocuments = [{id:'one', fileName:'test.xlsx', fields:{quantity:[{value:'100', location:'A1'}],brand:[{value:'TEST BRAND',location:'A2'}]}}];
seedProductFromCandidates();
`, context);
assert.equal(vm.runInContext('products.length', context), 1, 'Quantity must populate reusable products');
assert.equal(vm.runInContext('products[0].values.quantity', context), '100');
assert.equal(vm.runInContext('Object.hasOwn(products[0].values, "brand")', context), false, 'Single-file brand field is outside the corpus reuse scope');
vm.runInContext(`
processedDocuments.push({id:'two',fileName:'test2.xlsx',fields:{item_description:[{value:'TEST CORN',location:'A2'}]}});
seedProductFromCandidates();
`, context);
assert.equal(vm.runInContext('products[0].values.item_description', context), 'TEST CORN', 'Later imports should populate previously empty product fields');
vm.runInContext(`
fieldDefinitions.push({id:'quantity',group:'产品'}, {id:'production_date',group:'产品'});
processedDocuments.push({id:'three',fileName:'order.xlsx',fields:{quantity:[{value:'100',location:'B1'}],production_date:[{value:'2026-01-01',location:'B2'}]}});
seedProductFromCandidates();
`, context);
assert.equal(vm.runInContext('products[0].values.quantity', context), '100', 'Repeated quantities should populate reusable products');
assert.equal(vm.runInContext('products[0].values.production_date', context), '2026-01-01', 'Production dates appear in multiple corpus files');
vm.runInContext(`
renderFields = () => {};
saveRecord = () => {};
ui.saveState = {};
applyProductTemplate({id:'legacy',name:'TEST',values:{item_description:'TEST',brand:'BRAND',unit_price:'10',currency:'USD',quantity:'100',batch_no:'B1'}});
`, context);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(products.at(-1).values)', context)), {item_description:'TEST',unit_price:'10',currency:'USD',quantity:'100',batch_no:'B1'}, 'Templates must retain price, quantity and batch fields while excluding single-file brand');
console.log('Product import regressions passed');
