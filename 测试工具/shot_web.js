// 零依赖 CDP：验证便携 Web 版在真实浏览器里能加载 3D 并完成一次装箱
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`D:\bag\packing-eval\测试记录`;
const PORT = 9345;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = (...a) => { const s = a.join(' '); console.log(s); };

(async () => {
  const port = fs.readFileSync(path.join(OUT, 'port.txt'), 'utf8').trim();
  const url = `http://127.0.0.1:${port}/`;
  L('URL: ' + url);

  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, '.cdp-web')}`,
    '--window-size=1680,1050',
    url
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

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || ''));
    }
  };
  const send = (method, params) => new Promise(r => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await sleep(4000);

  L('标题: ' + await evalJS('document.title'));
  L('three.js 已加载: ' + await evalJS('typeof window.THREE'));
  L('货物行数: ' + await evalJS('document.querySelectorAll("#cargo-body tr").length || document.querySelectorAll("table tbody tr").length'));
  L('集装箱尺寸输入框: ' + await evalJS('JSON.stringify([document.querySelector("#c-l")?.value, document.querySelector("#c-w")?.value, document.querySelector("#c-h")?.value])'));

  await send('Page.captureScreenshot', { format: 'png' }).then(async r => {
    fs.writeFileSync(path.join(OUT, 'web-1-初始界面.png'), Buffer.from(r.data, 'base64'));
    L('已截图: web-1-初始界面.png');
  });

  // 载入示例 -> 填尺寸 -> 计算
  L('载入示例货物...');
  L('  载入后货物行数: ' + await evalJS('document.querySelector("#btn-sample")?.click(); document.querySelectorAll("#cargo-body tr").length'));
  await sleep(1500);
  L('  集装箱尺寸: ' + await evalJS('JSON.stringify([document.querySelector("#c-l")?.value, document.querySelector("#c-w")?.value, document.querySelector("#c-h")?.value])'));

  L('点击计算按钮...');
  await evalJS('document.querySelector("#btn-compute")?.click(); 1');
  await sleep(25000);

  L('结果区文本: ' + String(await evalJS('(document.querySelector("#result")||document.querySelector("#stats")||document.body).innerText.slice(0,400)')).replace(/\n/g, ' | '));
  await send('Page.captureScreenshot', { format: 'png' }).then(async r => {
    fs.writeFileSync(path.join(OUT, 'web-2-计算结果.png'), Buffer.from(r.data, 'base64'));
    L('已截图: web-2-计算结果.png');
  });

  L('控制台错误数: ' + consoleErrors.length);
  consoleErrors.slice(0, 8).forEach(e => L('  ERR: ' + e.slice(0, 200)));

  try { ws.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); } catch (e) {}
  try { child.kill(); } catch (e) {}
  L('DONE');
  process.exit(0);
})();
