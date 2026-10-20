"""Local, expiring original-document previews shared by source/template adapters."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import pymupdf
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

router = APIRouter()
_SESSIONS = {}
_TTL = 3600
_MAX_BYTES = 128 * 1024 * 1024
_LOCK = threading.Lock()


def render_word(content: bytes, extension: str, output_format: str = 'pdf') -> bytes:
    """Use an installed layout engine; never reconstruct Word formatting as HTML."""
    with tempfile.TemporaryDirectory(prefix='trade-preview-') as directory:
        root = Path(directory)
        source = root / ('input' + extension)
        target = root / ('input.' + output_format)
        source.write_bytes(content)
        executable = os.environ.get('LIBREOFFICE_PATH') or shutil.which('soffice')
        if not executable:
            for base in [os.environ.get('ProgramFiles', ''), os.environ.get('ProgramFiles(x86)', '')]:
                candidate = Path(base) / 'LibreOffice/program/soffice.exe'
                if candidate.is_file():
                    executable = str(candidate)
                    break
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        try:
            if executable:
                subprocess.run([executable, '-env:UserInstallation=' + (root / 'profile').as_uri(),
                                '--headless', '--convert-to', output_format, '--outdir', directory, str(source)],
                               capture_output=True, timeout=90, creationflags=flags, check=True)
            elif os.name == 'nt':
                # Paths travel through environment variables, never interpolated shell code.
                script = '''$ErrorActionPreference = 'Stop'
$word = $null; $doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $doc = $word.Documents.Open($env:TRADE_PREVIEW_INPUT, $false, $true, $false)
  if ($env:TRADE_PREVIEW_FORMAT -eq 'pdf') { $doc.ExportAsFixedFormat($env:TRADE_PREVIEW_OUTPUT, 17) }
  else { $doc.SaveAs2($env:TRADE_PREVIEW_OUTPUT, 16) }
} finally {
  if ($doc) { $doc.Close(0) }
  if ($word) { $word.Quit() }
}
'''
                env = {**os.environ, 'TRADE_PREVIEW_INPUT': str(source),
                       'TRADE_PREVIEW_OUTPUT': str(target), 'TRADE_PREVIEW_FORMAT': output_format}
                subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                               env=env, capture_output=True, timeout=90, creationflags=flags, check=True)
            else:
                raise RuntimeError('Word 原版式预览需要安装 LibreOffice，或在 Windows 上安装 Microsoft Word。')
        except (subprocess.SubprocessError, OSError) as exc:
            raise RuntimeError('Word 排版转换失败，请检查本机 Word/LibreOffice 是否可用、文件是否加密。') from exc
        if not target.is_file():
            raise RuntimeError('排版引擎没有生成预览，请确认文件未损坏且本机排版引擎可用。')
        return target.read_bytes()


def _get(session_id):
    with _LOCK:
        now = time.time()
        for key in list(_SESSIONS):
            if now - _SESSIONS[key]['created'] > _TTL:
                del _SESSIONS[key]
        session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, '文档预览已过期或服务已重启，请从来源重新打开。')
    return session


def _create(filename, content):
    extension = Path(filename).suffix.lower()
    if extension not in {'.pdf', '.docx', '.doc'}:
        raise HTTPException(400, '原文预览支持 Word（.doc/.docx）和 PDF。')
    try:
        preview = content if extension == '.pdf' else render_word(content, extension)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    try:
        with pymupdf.open(stream=preview, filetype='pdf') as pdf:
            if pdf.needs_pass or not len(pdf):
                raise ValueError('文件加密或没有页面。')
            pages = [{'width': page.rect.width, 'height': page.rect.height} for page in pdf]
        rows = []
        if extension == '.docx':
            from server.trade_documents import _read_docx
            rows = _read_docx(content)
        session = {'created': time.time(), 'filename': filename, 'extension': extension,
                   'content': content, 'preview': preview, 'pages': pages, 'rows': rows}
    except Exception as exc:
        raise HTTPException(400, '无法预览该文档，请检查文件是否损坏或加密。') from exc
    size = len(content) + len(preview)
    if size > _MAX_BYTES:
        raise HTTPException(413, '文档预览过大。')
    with _LOCK:
        now = time.time()
        for key in list(_SESSIONS):
            if now - _SESSIONS[key]['created'] > _TTL:
                del _SESSIONS[key]
        if sum(len(s['content']) + len(s['preview']) for s in _SESSIONS.values()) + size > _MAX_BYTES:
            raise HTTPException(503, '预览会话空间已满，请稍后重试。')
        session_id = uuid.uuid4().hex
        _SESSIONS[session_id] = session
    return {'sessionId': session_id, 'fileName': filename}


@router.post('/source-sessions')
async def create_source_session(file: UploadFile = File(...)):
    content = await file.read(25 * 1024 * 1024 + 1)
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, '单个文件不能超过 25 MB。')
    return await run_in_threadpool(_create, file.filename or 'document', content)


@router.get('/source-sessions/{session_id}')
def get_source_session(session_id: str):
    return _source_metadata(session_id)


class SourceFocus(BaseModel):
    location: str = Field(default='', max_length=2000)
    text: str = Field(default='', max_length=10000)


@router.post('/source-sessions/{session_id}/focus')
def focus_source_session(session_id: str, focus: SourceFocus):
    return _source_metadata(session_id, focus.location, focus.text)


def _search_page(page, needle):
    if not needle:
        return []
    exact = page.search_for(needle)
    if exact:
        return exact
    # Keep character boxes while normalizing whitespace; Word/PDF often insert
    # layout spaces inside numbers/units that the extractor has already joined.
    characters, boxes = [], []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                for char in span['chars']:
                    for value in char['c'].casefold():
                        if not value.isspace():
                            characters.append(value)
                            boxes.append(char['bbox'])
    normalized = ''.join(characters)
    target = ''.join(needle.casefold().split())
    if not target:
        return []
    results, start = [], 0
    while len(results) < 100:
        index = normalized.find(target, start)
        if index < 0:
            break
        rect = pymupdf.Rect(boxes[index])
        for box in boxes[index + 1:index + len(target)]:
            rect |= pymupdf.Rect(box)
        results.append(rect)
        start = index + len(target)
    return results


def _source_metadata(session_id: str, location: str = '', text: str = ''):
    session = _get(session_id)
    page_match = re.search(r'第\s*(\d+)\s*页', location)
    focus = int(page_match[1]) if page_match else 1
    focus = min(max(focus, 1), len(session['pages']))
    needle = text[:1000].strip()
    # Word locations select the actual paragraph/cell before searching rendered pages.
    for row in session['rows']:
        for cell_location, value in row.cells or [(row.location, row.text)]:
            if cell_location == location and not needle:
                needle = value
                break
    matches = []
    region = re.search(r'OCR，区域\s*([\d.,-]+)', location)
    if region:
        coordinates = [float(v) / 2 for v in region[1].split(',')]
        if len(coordinates) == 8:
            xs, ys = coordinates[::2], coordinates[1::2]
            rect = [max(0, min(xs)), max(0, min(ys)),
                    min(session['pages'][focus - 1]['width'], max(xs)),
                    min(session['pages'][focus - 1]['height'], max(ys))]
            if rect[2] > rect[0] and rect[3] > rect[1]:
                matches.append({'page': focus, 'rect': rect, 'kind': 'ocr-region'})
    with pymupdf.open(stream=session['preview'], filetype='pdf') as pdf:
        table_location = re.search(r'表格\s*(\d+)\s*第\s*(\d+)\s*行第\s*(\d+)\s*列', location)
        if page_match and table_location and session['extension'] == '.pdf':
            table_index, row_index, column_index = [int(v) - 1 for v in table_location.groups()]
            tables = pdf[focus - 1].find_tables().tables
            if 0 <= table_index < len(tables):
                rows = tables[table_index].rows
                if 0 <= row_index < len(rows) and 0 <= column_index < len(rows[row_index].cells):
                    rect = rows[row_index].cells[column_index]
                    if rect:
                        matches.append({'page': focus, 'rect': list(rect), 'kind': 'table-cell'})
        indices = [focus - 1] if page_match else range(len(pdf))
        for index in indices:
            page = pdf[index]
            rects = _search_page(page, needle)
            for rect in rects:
                matches.append({'page': index + 1, 'rect': list(rect)})
        if matches:
            focus = matches[0]['page']
    return {'fileName': session['filename'], 'format': session['extension'][1:],
            'adapter': 'word' if session['extension'] != '.pdf' else 'pdf',
            'pageCount': len(session['pages']), 'pages': session['pages'],
            'focusPage': focus, 'location': location, 'matches': matches,
            'locationResolved': bool(matches), 'expiresInSeconds': max(0, int(_TTL - time.time() + session['created'])),
            'capabilities': {'preview': True, 'downloadOriginal': True, 'edit': False, 'fieldMapping': False}}


@router.get('/source-sessions/{session_id}/pages/{page_number}.png')
def source_page(session_id: str, page_number: int):
    session = _get(session_id)
    if not 1 <= page_number <= len(session['pages']):
        raise HTTPException(404, '页码不存在。')
    with pymupdf.open(stream=session['preview'], filetype='pdf') as pdf:
        pix = pdf[page_number - 1].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        return Response(pix.tobytes('png'), media_type='image/png')


@router.get('/source-sessions/{session_id}/original')
def source_original(session_id: str):
    session = _get(session_id)
    return Response(session['content'], media_type='application/octet-stream',
                    headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(session['filename'])})


@router.get('/source-sessions/{session_id}/preview.pdf')
def source_pdf(session_id: str):
    return Response(_get(session_id)['preview'], media_type='application/pdf')
