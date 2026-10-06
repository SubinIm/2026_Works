[CmdletBinding()] param([int]$Port = 8765, [string]$Python = 'python', [string]$FFmpegPath = '', [string]$Npm = 'npm')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$generated = Join-Path $root 'fixtures\generated'
$player = Join-Path $root 'fixtures\player'
if (-not (Test-Path (Join-Path $generated 'direct.mp4'))) { & (Join-Path $PSScriptRoot 'generate-fixtures.ps1') -FFmpegPath $FFmpegPath }
if (-not (Test-Path (Join-Path $player 'vendor\hls.min.js'))) {
    Push-Location (Join-Path $root 'fixtures')
    try { & $Npm install; & $Npm run build-player } finally { Pop-Location }
}
Write-Host '[OK] fixture 확인 완료'
Write-Host "Server URL: http://127.0.0.1:$Port/"
Write-Host "Test page: http://127.0.0.1:$Port/player/"
Write-Host "Generated manifests: $generated"
try { & $Python (Join-Path $root 'fixtures\server.py') --port $Port --directory (Join-Path $root 'fixtures') } finally { Write-Host 'fixture 서버를 종료했습니다.' }
