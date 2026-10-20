@echo off
setlocal
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found. Install Python 3.11 or newer and add it to PATH.
    pause
    exit /b 1
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
    echo Python 3.11 or newer is required. Current Python is too old.
    pause
    exit /b 1
)

if not exist web_env\Scripts\python.exe (
    python -m venv web_env
    if errorlevel 1 ( echo Could not create the local Python environment. & pause & exit /b 1 )
)

web_env\Scripts\python -m pip install -r requirements-server.txt
if errorlevel 1 ( echo Dependency installation failed. & pause & exit /b 1 )

echo Starting the local application at http://127.0.0.1:8000
echo Keep this window open while using the application.
start "" /b web_env\Scripts\python -m uvicorn server.main:app --host 127.0.0.1 --port 8000
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8000
pause
