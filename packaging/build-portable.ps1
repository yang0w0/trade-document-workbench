$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $projectRoot 'application'
$python = Join-Path $appRoot 'web_env/Scripts/python.exe'
& $python -m PyInstaller --noconfirm --onedir --noconsole --name ContainerPlanner `
    --distpath (Join-Path $PSScriptRoot 'dist') --workpath (Join-Path $PSScriptRoot 'build') `
    --specpath $PSScriptRoot --paths $appRoot --add-data "$appRoot/web;web" `
    --collect-all rapidocr --collect-all onnxruntime --collect-all pymupdf `
    --collect-all docx --collect-all openpyxl --collect-all xlrd `
    --collect-submodules uvicorn --collect-submodules server `
    --exclude-module matplotlib --exclude-module tkinter --exclude-module pytest `
    (Join-Path $PSScriptRoot 'launcher.py')
if ($LASTEXITCODE -ne 0) { throw 'Portable build failed' }
