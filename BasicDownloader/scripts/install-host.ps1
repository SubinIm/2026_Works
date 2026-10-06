[CmdletBinding()] param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$ExecutablePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'native-host\dist\stream_host.exe')
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.personal.stream_downloader'
$exe = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "실행 파일이 없습니다: $exe" }
$manifestDir = Join-Path $env:LOCALAPPDATA 'PersonalStreamDownloader'
$manifestPath = Join-Path $manifestDir "$hostName.json"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifest = [ordered]@{name=$hostName;description='Personal Stream Downloader native host';path=$exe;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Force -Path $key | Out-Null
Set-Item -LiteralPath $key -Value $manifestPath
if ((Get-Item -LiteralPath $key).GetValue('') -ne $manifestPath) { throw '레지스트리 등록 검증에 실패했습니다.' }
Write-Host "Manifest: $manifestPath"
Write-Host "Registry: HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\$hostName"
Write-Host "Host: $exe"
