[CmdletBinding()] param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'native-host')
try {
    if (-not (Test-Path '.venv\Scripts\python.exe')) { & $Python -m venv .venv }
    $venvPython = (Resolve-Path '.venv\Scripts\python.exe').Path
    & $venvPython -m pip install -e '.[dev]'
    & $venvPython -m PyInstaller --clean --onefile --name stream_host --paths src launcher.py
    Write-Host "Native Host: $(Join-Path (Get-Location) 'dist\stream_host.exe')"
} finally { Pop-Location }
