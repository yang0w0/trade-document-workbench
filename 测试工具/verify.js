// 零依赖 CDP 验证：证明 container-calculator 能在 file:// 下双击即用
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const ROOT = String.raw`D:\bag\packing-eval\container-calculator`;
const OUT = String.raw`D:\bag\packing-eval\测试记录`;
const PORT = 9333;
const LOGF = path.join(OUT, 'verify.log');
const sleep = ms => new Promise(r => setTimeout(r, ms));

try { fs.writeFileSync(LOGF, ''); } catch (e) {}
const L = (...a) => { const s = a.join(' '); try { fs.appendFileSync(LOGF, s + '\n'); } catch (e) {} console.log(s); };

(async () => {
  const pagePath = path.join(ROOT, 'index.html');
  const target = 'file:///' + encodeURI(pagePath.replace(/\\/g, '/'));
  L('PAGE_URL: ' + target);

  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, '.cdp-profile')}`,
    '--window-size=1680,1050',
    target
  ], { stdio: 'ignore' });

  const CDP = `http://127.0.0.1:${PORT}`;
  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(CDP + '/json/list')).json();
      page = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) break;
    } catch (e) {}
    await sleep(500);
  }
  if (!page) { L('FATAL: 无法连接调试端口'); process.exitCode = 1; return; }
  L('TARGET_URL: ' + page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push('console.' + m.params.type + ': ' + (m.params.args || []).map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded') logs.push('log.' + m.params.entry.level + ': ' + m.params.entry.text);
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

  // --- 1. 等 THREE 就绪（本地 vendor 优先）---
  let sig = null;
  for (let i = 0; i < 40; i++) {
    try {
      sig = await evaluate(`(async()=>{ if(!window.__threeReady) return 'NO_SIGNAL';
        const v = await Promise.race([window.__threeReady, new Promise(r=>setTimeout(()=>r('TIMEOUT'),2000))]);
        return String(v); })()`);
      if (sig !== 'TIMEOUT' && sig !== 'NO_SIGNAL') break;
    } catch (e) { sig = 'ERR:' + e.message; break; }
    await sleep(500);
  }
  L('THREE_READY_SIGNAL: ' + sig);

  // --- 2. THREE 探针：确认走的是本地 vendor 还是 CDN ---
  L('THREE_PROBE: ' + JSON.stringify(await evaluate(`(()=>({
    hasTHREE: typeof THREE !== 'undefined',
    rev: (typeof THREE !== 'undefined' && THREE.REVISION) || null,
    hasOrbit: (typeof THREE !== 'undefined' && !!(THREE.OrbitControls)) || false,
    scripts: [...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')),
    bannerVisible: !!document.querySelector('.three-banner, #threeBanner'),
    canvases: document.querySelectorAll('canvas').length
  }))()`)));

  // --- 3. 跑一次真实双规格混装计算（A 可翻转 / B 仅直立）---
  L('SETUP: ' + await evaluate(`(()=>{
    products.length = 0;
    products.push({id:101,type:'standard',name:'A箱',L:60,W:40,H:40,weight:15,qty:180,uprightOnly:false,maxStack:null});
    products.push({id:102,type:'standard',name:'B箱',L:50,W:35,H:30,weight:10,qty:260,uprightOnly:true,maxStack:null});
    refreshProducts();
    return '货品数=' + products.length;
  })()`));
  L('CONTAINER: ' + await evaluate(`document.getElementById('containerType') ? document.getElementById('containerType').value : 'NOT_FOUND'`));

  const t0 = Date.now();
  await evaluate(`(async()=>{ runOptimize(); return 1; })()`);
  let waited = 0;
  while (waited < 30000) {
    const done = await evaluate(`!!(lastResult && lastResult.containersNeeded !== undefined)`);
    if (done) break;
    await sleep(300); waited += 300;
  }
  L('CALC_TIME_MS: ' + (Date.now() - t0));

  L('RESULT: ' + JSON.stringify(await evaluate(`(()=>{
    if(!lastResult) return {err:'no lastResult'};
    const cu = lastResult.containersUsed || [];
    return {
      mode: lastResult.mode,
      containersNeeded: lastResult.containersNeeded,
      avgFillRatePct: lastResult.avgFillRate != null ? +(lastResult.avgFillRate*100).toFixed(2) : null,
      totalCounts: lastResult.totalCounts,
      perContainer: cu.slice(0,3).map(c=>({
        柜型: c.container.name,
        装载率: +(c.volume/(c.container.L*c.container.W*c.container.H)*100).toFixed(2),
        件数: c.counts
      }))
    };
  })()`)));

  // --- 4. 三维场景是否真有物体 ---
  L('SCENE: ' + JSON.stringify(await evaluate(`(()=>{
    const c = document.querySelector('canvas');
    if(!c) return {noCanvas:true};
    let mesh = 'unknown';
    try { mesh = (window.scene && window.scene.children) ? window.scene.children.length : 'no-window-scene'; } catch(e){}
    return { canvasW: c.width, canvasH: c.height, sceneChildren: mesh };
  })()`)));

  // --- 5. 截图 ---
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'verified-file-protocol.png'), Buffer.from(shot.data, 'base64'));
    L('SCREENSHOT: ok');
  } catch (e) { L('SCREENSHOT_FAIL: ' + e.message); }

  // --- 6. 页面日志（CSP、加载失败等）---
  const errs = logs.filter(x => /error|fail|violat|blocked|refus/i.test(x));
  L('PAGE_ERRORS(' + errs.length + '): ' + (errs.slice(0, 8).join(' | ') || '无'));

  try { ws.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); } catch (e) {}
  await sleep(600);
  try { child.kill(); } catch (e) {}
  L('DONE');
})().catch(e => { L('UNCAUGHT: ' + e.message + '\n' + e.stack); process.exitCode = 1; });
