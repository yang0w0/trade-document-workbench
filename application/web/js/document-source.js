import { postJSON } from './api.js';

const query = new URLSearchParams(location.search);
const status = document.querySelector('#status');
const pages = document.querySelector('#pages');
const select = document.querySelector('#page-select');
const zoom = document.querySelector('#zoom');
let metadata;

function resize() {
  if (!metadata) return;
  pages.querySelectorAll('.page').forEach((element, index) => {
    const page = metadata.pages[index];
    const scale = zoom.value === 'fit' ? Math.min(1.5, (pages.clientWidth - 48) / page.width) : Number(zoom.value);
    element.style.width = `${page.width * scale}px`;
    element.style.height = `${page.height * scale}px`;
  });
}

async function load() {
  if (!query.has('session')) return;
  try {
    const focusKey = query.get('focus');
    const focus = JSON.parse(sessionStorage.getItem(focusKey) || '{}');
    const base = `/api/documents/source-sessions/${encodeURIComponent(query.get('session'))}`;
    metadata = await postJSON(`${base}/focus`, { location: focus.location || '', text: String(focus.text || '') });
    document.title = `${metadata.fileName} · 原文核对`;
    document.querySelector('#file-name').textContent = metadata.fileName;
    document.querySelector('#focus-note').textContent = focus.location || `共 ${metadata.pageCount} 页`;
    status.textContent = !focus.location ? '按原页版式显示，可切换页码、缩放或下载导入原件。' : metadata.locationResolved
      ? '已标出来源文字；重复文字可能出现多个标记，请结合来源位置核对。'
      : '已打开原版式页面；此处尚未精确定位到文字，请结合来源位置核对（扫描件可能没有文字层）。';
    for (const [id, suffix] of [['download', '/original'], ['pdf', '/preview.pdf']]) {
      const link = document.querySelector(`#${id}`);
      link.href = base + suffix;
      link.hidden = false;
    }
    metadata.pages.forEach((page, index) => {
      const number = index + 1;
      const option = document.createElement('option');
      option.value = number;
      option.textContent = `${number} / ${metadata.pageCount}`;
      select.append(option);
      const section = document.createElement('section');
      section.className = 'page';
      section.id = `page-${number}`;
      section.setAttribute('aria-label', `第 ${number} 页`);
      const img = document.createElement('img');
      img.src = `${base}/pages/${number}.png`;
      img.alt = `原文第 ${number} 页`;
      img.loading = number === metadata.focusPage ? 'eager' : 'lazy';
      img.addEventListener('error', () => { status.textContent = '页面读取失败或会话已过期，请从来源重新打开。'; });
      section.append(img);
      metadata.matches.filter(match => match.page === number).forEach(match => {
        const highlight = document.createElement('span');
        highlight.className = 'highlight';
        const [x0, y0, x1, y1] = match.rect;
        Object.assign(highlight.style, { left: `${100 * x0 / page.width}%`, top: `${100 * y0 / page.height}%`,
          width: `${100 * (x1 - x0) / page.width}%`, height: `${100 * (y1 - y0) / page.height}%` });
        section.append(highlight);
      });
      pages.append(section);
    });
    select.disabled = false;
    select.value = metadata.focusPage;
    resize();
    document.querySelector(`#page-${metadata.focusPage}`).scrollIntoView();
  } catch (error) {
    status.textContent = error.message || '无法读取原文。请从来源重新打开。';
  }
}
select.addEventListener('change', () => document.querySelector(`#page-${select.value}`)?.scrollIntoView({ behavior: 'smooth' }));
zoom.addEventListener('change', resize);
window.addEventListener('resize', resize);
load();
