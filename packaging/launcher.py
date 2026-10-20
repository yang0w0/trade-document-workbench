"""Portable entry point for the maintained local web application."""
import multiprocessing
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser


def main():
    base = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1] / 'application'
    data = base / 'data'
    data.mkdir(exist_ok=True)
    os.environ.setdefault('LOADER_TEMPLATE_FILE', str(data / 'templates.json'))
    if sys.stdout is None:
        sys.stdout = open(data / 'server.log', 'a', encoding='utf-8', buffering=1)
        sys.stderr = sys.stdout
    import uvicorn
    from server.main import app
    sock = socket.socket()
    sock.bind(('127.0.0.1', int(os.environ.get('LOADER_PORT', '0'))))
    port = sock.getsockname()[1]
    (data / 'port.txt').write_text(str(port), encoding='utf-8')
    url = f'http://127.0.0.1:{port}'

    def open_page():
        for _ in range(100):
            try:
                with urllib.request.urlopen(url + '/api/health', timeout=1):
                    if not os.environ.get('LOADER_NO_BROWSER'):
                        webbrowser.open(url)
                    return
            except OSError:
                time.sleep(.1)
    threading.Thread(target=open_page, daemon=True).start()
    uvicorn.Server(uvicorn.Config(app, log_level='warning')).run(sockets=[sock])


def dispatch():
    multiprocessing.freeze_support()
    if len(sys.argv) == 2 and Path(sys.argv[1]).name == 'trade_ocr_worker.py':
        # A windowed PyInstaller executable clears Python's standard streams,
        # even when the parent supplies pipes. Reopen the inherited Win32 pipes.
        if getattr(sys, 'frozen', False) and os.name == 'nt':
            import ctypes
            import io
            import msvcrt

            get_handle = ctypes.windll.kernel32.GetStdHandle
            get_handle.argtypes = [ctypes.c_ulong]
            get_handle.restype = ctypes.c_void_p
            for name, handle_id, flags, mode in (
                ('stdin', -10, os.O_RDONLY, 'rb'),
                ('stdout', -11, os.O_WRONLY, 'wb'),
                ('stderr', -12, os.O_WRONLY, 'wb'),
            ):
                if getattr(sys, name) is None:
                    descriptor = msvcrt.open_osfhandle(get_handle(handle_id), flags | os.O_BINARY)
                    stream = os.fdopen(descriptor, mode)
                    setattr(sys, name, io.TextIOWrapper(stream, encoding='utf-8'))
        from server.trade_ocr_worker import main as ocr_main
        ocr_main()
    else:
        main()


if __name__ == '__main__':
    dispatch()
