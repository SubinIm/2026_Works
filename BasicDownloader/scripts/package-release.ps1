[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'packages'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null

function Add-PackageFile($Archive, [string]$RelativePath) {
    $file = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Archive, $file, $RelativePath.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
}

function Add-PackageDirectory($Archive, [string]$RelativePath) {
    $directory = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Required directory missing: $directory" }
    foreach ($file in (Get-ChildItem -LiteralPath $directory -Recurse -File | Sort-Object FullName)) {
        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        if ($relative -match '(^|/)(\.MATLABDriveTag|_metadata|node_modules|\.rollback|\.pending-backup)(/|$)' -or
            $relative -match '\.(log|tmp)$' -or $file.Name -in @('.build.lock', '.pending-build.json', '.gitignore')) { continue }
        Add-PackageFile $Archive $relative
    }
}

function New-Package([string]$Name, [string[]]$Files, [string[]]$Directories) {
    $zipPath = Join-Path $output $Name
    # Only replace the explicitly named ZIP in the chosen output directory.
    $stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $Files) { Add-PackageFile $archive $file }
        foreach ($directory in $Directories) { Add-PackageDirectory $archive $directory }
    } finally { $archive.Dispose(); $stream.Dispose() }
    Write-Host "Package: $zipPath"
    return $zipPath
}

$downloaderVersion = (Get-Content (Join-Path $root 'extension/public/manifest.json') -Raw | ConvertFrom-Json).version
$blockerVersion = (Get-Content (Join-Path $root 'adblocker/manifest.json') -Raw | ConvertFrom-Json).version
$paperVersion = (Get-Content (Join-Path $root 'reference-manager/dist/manifest.json') -Raw | ConvertFrom-Json).version
if (-not (Test-Path (Join-Path $root 'extension/dist/manifest.json'))) { throw 'Build extension first.' }
if ((Get-Content (Join-Path $root 'extension/dist/manifest.json') -Raw | ConvertFrom-Json).version -ne $downloaderVersion) { throw 'Extension build version is stale.' }
if (-not (Test-Path (Join-Path $root 'native-host/dist/stream_host.exe'))) { throw 'Build native host first.' }

$blockerFiles = @('docs/SHARING.md', 'adblocker/README.md', 'adblocker/manifest.json')
$blockerFiles += Get-ChildItem (Join-Path $root 'adblocker') -File | Where-Object { $_.Extension -in @('.js', '.html', '.css') } | ForEach-Object { "adblocker/$($_.Name)" }
$archives = @(
    New-Package "basic-banner-blocker-$blockerVersion.zip" $blockerFiles @('adblocker/icons', 'adblocker/rules', 'adblocker/filters')
    New-Package "paperdesk-$paperVersion.zip" @('docs/SHARING.md', 'reference-manager/README.md') @('reference-manager/dist')
    New-Package "personal-stream-downloader-$downloaderVersion-windows-x64.zip" @('docs/SHARING.md', 'README.md', 'scripts/install-host.ps1', 'scripts/uninstall-host.ps1', 'native-host/dist/stream_host.exe', 'native-host/THIRD_PARTY_NOTICES.md') @('extension/dist', 'native-host/licenses')
)
$hashLines = foreach ($archive in $archives) {
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($archive))"
}
[System.IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'), [string[]]$hashLines, [System.Text.UTF8Encoding]::new($false))
