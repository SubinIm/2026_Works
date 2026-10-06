[CmdletBinding(SupportsShouldProcess)] param()
$ErrorActionPreference = 'Stop'
$hostName = 'com.personal.stream_downloader'
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$manifestPath = Join-Path $env:LOCALAPPDATA "PersonalStreamDownloader\$hostName.json"
if ($PSCmdlet.ShouldProcess($key,'Native Host 등록 제거')) { Remove-Item -LiteralPath $key -Force -ErrorAction SilentlyContinue }
if ($manifestPath -and $PSCmdlet.ShouldProcess($manifestPath,'생성된 manifest 제거')) { Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue }
Write-Host 'Personal Stream Downloader Native Host 등록을 제거했습니다.'
