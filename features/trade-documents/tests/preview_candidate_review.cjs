// Isolated browser preview of the real app. Only synthetic uploads and read APIs
// are proxied; template mutations cannot reach the running backend.
// Run: node features/trade-documents/tests/preview_candidate_review.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const web = path.resolve(__dirname, '../../../application/web');
const demo = `<script>
const demoButton = document.createElement('button');
demoButton.className = 'btn primary'; demoButton.textContent = '使用合成资料体验';
demoButton.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:500';
demoButton.addEventListener('click', () => {
  const transfer = new DataTransfer();
  for (const [suffix, quantity] of [['A',100],['B',200]]) {
    transfer.items.add(new File([
      'Contract No: DEMO-2026-' + suffix + '\\nInvoice No: INV-' + suffix + '\\nProduct Name: Demo Product ' + suffix + '\\nQuantity: ' + quantity
    ], 'demo-' + suffix + '.txt', {type:'text/plain',lastModified:1}));
  }
  const input = document.querySelector('#td-file-input');
  input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  document.querySelector('#td-open-import').click();
});
document.body.append(demoButton);
</script>`;
http.createServer((req, res) => {
  const route = new URL(req.url, 'http://127.0.0.1').pathname;
  if (route.startsWith('/api/')) {
    if (req.method !== 'GET' && !(req.method === 'POST' && route === '/api/documents/extract')) {
      res.writeHead(403); return res.end('Preview blocks persistent server changes');
    }
    const upstream = http.request({hostname:'127.0.0.1',port:8000,path:req.url,method:req.method,
      headers:{...req.headers,host:'127.0.0.1:8000'}}, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Start the local app on port 8000 first'); });
    req.pipe(upstream); return;
  }
  const file = path.resolve(web, '.' + decodeURIComponent(route === '/' ? '/index.html' : route));
  if (!file.startsWith(web + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end();
  }
  const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
  res.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const content = fs.readFileSync(file);
  res.end(route === '/' ? content.toString().replace('</body>', demo + '</body>') : content);
}).listen(8013, '127.0.0.1', () => console.log('Synthetic preview: http://127.0.0.1:8013/ (backend: 8000)'));
