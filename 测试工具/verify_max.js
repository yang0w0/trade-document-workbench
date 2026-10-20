// 验证「数量留空 = 求最大」：清空示例第一行数量 -> 计算 -> 检查结果文案
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`D:\bag\packing-eval\测试记录`;
const PORT = 9355;
const URL = `http://127.0.0.1:${fs.readFileSync(path.join(OUT, 'port.txt'), 'utf8').trim()}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = (...a) => console.log(a.join(' '));

(async () => {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, '.cdp-web')}`,
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

  L('标题: ' + await js('document.title'));
  L('示例载入前行数: ' + await js('document.querySelectorAll("#cargo-table tbody tr").length'));
  await js('document.querySelector("#btn-sample").click(); 1');
  await sleep(1200);
  L('示例载入后行数: ' + await js('document.querySelectorAll("#cargo-table tbody tr").length'));
  L('集装箱: ' + await js('JSON.stringify([+document.querySelector("#c-l").value,+document.querySelector("#c-w").value,+document.querySelector("#c-h").value])'));
  L('原数量列: ' + await js('JSON.stringify([...document.querySelectorAll(\'#cargo-table [data-k="n"]\')].map(i=>i.value))'));

  // 清空第 1、3 行数量 = 求最大（验证多行求最大 + 与定量行混用）
  await js(`(() => {
    const inputs = [...document.querySelectorAll('#cargo-table [data-k="n"]')];
    for (const idx of [0, 2]) { inputs[idx].value=''; inputs[idx].dispatchEvent(new Event('input',{bubbles:true})); }
    return 1;
  })()`);
  await sleep(800);
  L('改后数量列: ' + await js('JSON.stringify([...document.querySelectorAll(\'#cargo-table [data-k="n"]\')].map(i=>i.value))'));
  L('预估区: ' + String(await js('document.querySelector("#estimate-alerts").innerText')).replace(/\n/g, ' | '));
  L('预估指标: ' + String(await js('document.querySelector("#estimate-metrics").innerText')).replace(/\n/g, ' | '));

  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'max-1-留空数量.png'), Buffer.from(r.data, 'base64'));
    L('截图: max-1-留空数量.png');
  });

  await js('document.querySelector("#btn-compute").click(); 1');
  let done = false;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    done = await js('!document.querySelector("#result-area").hidden && !!document.querySelector("#result-metrics").innerText.trim()');
    if (done) break;
  }
  L('计算完成: ' + done);

  if (done) {
    L('结果指标: ' + String(await js('document.querySelector("#result-metrics").innerText')).replace(/\n/g, ' | '));
    L('结果提示: ' + String(await js('document.querySelector("#result-alerts").innerText')).replace(/\n/g, ' | '));
    L('图例: ' + String(await js('document.querySelector("#legend").innerText')).replace(/\n/g, ' | '));
    L('汇总表首两行: ' + String(await js(`[...document.querySelectorAll('#summary-table tbody tr')].slice(0,3).map(r=>[...r.cells].map(c=>c.innerText).join('/')).join(' || ')`)));
    await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
      fs.writeFileSync(path.join(OUT, 'max-2-求最大结果.png'), Buffer.from(r.data, 'base64'));
      L('截图: max-2-求最大结果.png');
    });
  }

  // 切到「精确搜索」口径，确认开关与预估文案联动（不再点计算，避免长时间等待）
  L('求最大口径开关可见: ' + await js('!document.querySelector("#max-mode-field").hidden'));
  await js('document.querySelector(\'input[name="maxmode"][value="exact"]\').click(); 1');
  await sleep(600);
  L('切精确搜索后预估: ' + String(await js('document.querySelector("#estimate-alerts").innerText')).replace(/\n/g, ' | '));
  await js('document.querySelector(\'input[name="maxmode"][value="fast"]\').click(); 1');
  await sleep(600);
  L('切回快速估算后预估: ' + String(await js('document.querySelector("#estimate-alerts").innerText')).replace(/\n/g, ' | '));

  L('控制台错误数: ' + errors.length);
  errors.slice(0, 8).forEach((e) => L('  ERR: ' + String(e).slice(0, 200)));

  try { ws.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); } catch (e) { /* ignore */ }
  try { child.kill(); } catch (e) { /* ignore */ }
  process.exit(0);
})();
