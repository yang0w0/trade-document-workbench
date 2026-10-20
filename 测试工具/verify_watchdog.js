// 验证「超发自动降档重算」：切到精确搜索口径（件数会超发）→ 计算 → 看门狗应自动降档并最终出结果
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`D:\bag\packing-eval\测试记录`;
const PORT = 9356;
const URL = `http://127.0.0.1:${fs.readFileSync(path.join(OUT, 'port.txt'), 'utf8').trim()}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = (...a) => console.log(a.join(' '));

(async () => {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, '.cdp-wd')}`,
    '--window-size=1680,1050',
    URL,
  ], { stdio: 'ignore' });

  const CDP = `http://127.0.0.1:${PORT}`;
  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) break;
    } catch (e) { /* 等待调试端口 */ }
    await sleep(500);
  }
  if (!page) { L('FATAL: 无法连接调试端口'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || ''));
    }
  };
  const send = (method, params) => new Promise((r) => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await sleep(3500);

  await js('document.querySelector("#btn-sample").click(); 1');
  await sleep(1000);
  await js(`(() => {
    const inputs = [...document.querySelectorAll('#cargo-table [data-k="n"]')];
    for (const idx of [0, 2]) { inputs[idx].value=''; inputs[idx].dispatchEvent(new Event('input',{bubbles:true})); }
    return 1;
  })()`);
  await sleep(500);
  await js('document.querySelector(\'input[name="maxmode"][value="exact"]\').click(); 1');
  await sleep(500);
  L('口径: 精确搜索（件数会超发，用于验证看门狗）');
  L('预估: ' + String(await js('document.querySelector("#estimate-alerts").innerText')).replace(/\n/g, ' | ').slice(-160));

  const t0 = Date.now();
  await js('document.querySelector("#btn-compute").click(); 1');

  const timeline = [];
  let done = false;
  let lastToast = '';
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    const s = await js(`(() => {
      const t = document.querySelector('#toast');
      return JSON.stringify({
        toast: t && !t.hidden ? t.innerText : '',
        calc: !document.querySelector('#calc-card').hidden,
        sub: document.querySelector('#calc-sub').innerText,
        result: !document.querySelector('#result-area').hidden && !!document.querySelector('#result-metrics').innerText.trim(),
      });
    })()`);
    const o = JSON.parse(s);
    const el = Math.round((Date.now() - t0) / 1000);
    if (o.toast && o.toast !== lastToast) { timeline.push(`  ${el}s TOAST: ${o.toast}`); lastToast = o.toast; }
    if (o.calc && !timeline.some((x) => x.includes('开始计算'))) timeline.push(`  ${el}s 计算中…`);
    if (o.result) { done = true; timeline.push(`  ${el}s 出结果`); break; }
    if (!o.calc && !o.result && el > 2) { timeline.push(`  ${el}s 计算结束但无结果（异常）`); break; }
  }
  L('--- 时间线 ---');
  timeline.forEach((x) => L(x));
  L('总用时: ' + Math.round((Date.now() - t0) / 1000) + 's');
  L('出结果: ' + done);
  if (done) {
    L('结果指标: ' + String(await js('document.querySelector("#result-metrics").innerText')).replace(/\n/g, ' | '));
    L('结果提示: ' + String(await js('document.querySelector("#result-alerts").innerText')).replace(/\n/g, ' | '));
    await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
      fs.writeFileSync(path.join(OUT, 'max-3-精确搜索降档结果.png'), Buffer.from(r.data, 'base64'));
      L('截图: max-3-精确搜索降档结果.png');
    });
  } else {
    L('页面提示: ' + String(await js('document.querySelector("#compute-msg").innerText')));
  }
  L('控制台错误数: ' + errors.length);
  errors.slice(0, 6).forEach((e) => L('  ERR: ' + String(e).slice(0, 200)));

  try { ws.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); } catch (e) { /* ignore */ }
  try { child.kill(); } catch (e) { /* ignore */ }
  process.exit(0);
})();
