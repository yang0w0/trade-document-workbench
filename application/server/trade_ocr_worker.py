"""Isolated, local OCR entry point. Input/output only travel through pipes."""
import base64
import ctypes
from dataclasses import asdict
import io
import json
import os
from pathlib import Path
import sys


def main():
    if os.name == 'nt':
        ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from PIL import Image
    from server.trade_documents import _ocr_image_local

    payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    image = Image.open(io.BytesIO(base64.b64decode(payload['image'])))
    rows = _ocr_image_local(image, payload['location'], payload.get('native_words'))
    sys.stdout.buffer.write(json.dumps([asdict(row) for row in rows], ensure_ascii=False).encode('utf-8'))


if __name__ == '__main__':
    main()
