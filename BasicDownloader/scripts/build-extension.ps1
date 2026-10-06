[CmdletBinding()] param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'extension')
try {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm을 찾을 수 없습니다. Node.js 20 이상을 설치하고 PATH를 확인하세요.' }
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
} finally { Pop-Location }

