// Synthetic label interactions; no uploads, OCR or customer files.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; this.scrollHeight = 36; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { this.listeners.click?.({preventDefault(){}}); }
  matches() { return !!this.open; }
  showPopover() { this.open = true; this.listeners.toggle?.(); }
  hidePopover() { this.open = false; this.listeners.toggle?.(); }
  getBoundingClientRect() { return {left: 100, top: 100, right: 200, bottom: 130, width: 250, height: 240}; }
  focus() {}
}
const source = fs.readFileSync(path.resolve(__dirname, '../../../application/web/js/trade-documents.js'), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
const storage = new Map(), labels = [];
const context = vm.createContext({
  document: {querySelector: () => null, querySelectorAll: () => labels, createElement: tag => new Element(tag)},
  crypto: require('node:crypto').webcrypto, requestAnimationFrame: fn => fn(),
  window: {innerWidth: 390, innerHeight: 844},
  localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const find = (node, cls) => [node, ...node.children.flatMap(child => find(child, cls))].filter(n => n.className?.split(' ').includes(cls));
const make = (label = '数量', id = 'quantity') => {
  const control = run(`makeFieldControl({id:${JSON.stringify(id)},label:${JSON.stringify(label)}}, [], {id:'test-${labels.length}',value:'42',onChange:()=>{throw Error('Color must not edit field values')}})`);
  labels.push(find(control, 'document-field-label')[0]);
  return control;
};
const first = make(), second = make('数量', 'other-quantity'), unrelated = make('单价');
const label = labels[0];
assert.equal(label.tagName, 'button', 'Every field label must open the palette by mouse or native keyboard activation');
assert.equal(label.style.backgroundColor, '', 'Default labels have no fill');
label.click();
let palette = find(first, 'document-label-palette')[0];
assert.equal(palette.open, true);
const color = find(palette, 'document-label-custom-color')[0];
color.value = '#123456'; color.listeners.input();
assert.equal(labels[0].style.backgroundColor, '#123456');
assert.equal(labels[1].style.backgroundColor, '#123456', 'Same-name fields update together');
assert.equal(labels[2].style.backgroundColor, '', 'Other labels are independent');
assert.equal(find(first, 'document-field-input')[0].value, '42');
assert.equal(find(make(), 'document-field-label')[0].style.backgroundColor, '#123456', 'Re-rendered labels retain preferences');
const freshContext = vm.createContext({...context});
vm.runInContext(source, freshContext);
const restored = vm.runInContext(`makeFieldControl({id:'quantity',label:'数量'}, [], {id:'reloaded',value:'42',onChange:()=>{}})`, freshContext);
assert.equal(find(restored, 'document-field-label')[0].style.backgroundColor, '#123456', 'A fresh module restores saved colors');
assert.equal(labels[0].style.color, '#ffffff', 'Dark custom fills keep labels legible');
find(palette, 'document-label-color-clear')[0].click();
assert.equal(labels[0].style.backgroundColor, '');
assert.equal(labels[1].style.backgroundColor, '');
assert.equal(find(make(), 'document-field-label')[0].style.backgroundColor, '', 'Clearing persists');
context.localStorage.getItem = () => { throw Error('Storage disabled'); };
const blockedContext = vm.createContext({...context});
vm.runInContext(source, blockedContext);
const withoutStorage = vm.runInContext(`makeFieldControl({id:'packing',label:'包装'}, [], {id:'blocked',value:'42',onChange:()=>{}})`, blockedContext);
assert.equal(find(withoutStorage, 'document-field-label')[0].style.backgroundColor, '', 'Unavailable storage must not break field rendering');
console.log('Field colors: default, palette, custom color, same-name sync, persistence, clear and storage fallback passed');
