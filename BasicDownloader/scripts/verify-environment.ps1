[CmdletBinding()] param()
$names = 'node','npm','python','ffmpeg','ffprobe','powershell'
foreach ($name in $names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { Write-Host "[OK] $name - $($cmd.Source)" } else { Write-Warning "[MISSING] $name" }
}
$common = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    'C:\Program Files\DownloadHelper CoApp\ffmpeg.exe',
    'C:\Program Files\DownloadHelper CoApp\ffprobe.exe',
    "$env:ProgramData\chocolatey\bin\ffmpeg.exe",
    "$env:USERPROFILE\scoop\shims\ffmpeg.exe",
    'C:\ffmpeg\bin\ffmpeg.exe'
)
foreach ($path in $common) { if (Test-Path -LiteralPath $path -PathType Leaf) { Write-Host "[FOUND] $path" } }
