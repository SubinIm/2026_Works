[CmdletBinding()] param([string]$FFmpegPath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$generated = Join-Path $root 'fixtures\generated'
if ($FFmpegPath) { $ffmpeg = (Resolve-Path -LiteralPath $FFmpegPath).Path } else { $ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source }
New-Item -ItemType Directory -Force -Path $generated | Out-Null
$direct = Join-Path $generated 'direct.mp4'
Push-Location $generated
try {
    & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=640x360:rate=30' -f lavfi -i 'sine=frequency=880:sample_rate=48000' -t 8 -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 60 -c:a aac -b:a 128k -shortest -movflags +faststart $direct
    if ($LASTEXITCODE) { throw 'direct MP4 fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -c copy -hls_time 2 -hls_playlist_type vod -hls_segment_filename 'hls-%03d.ts' 'stream.m3u8'
    if ($LASTEXITCODE) { throw 'MPEG-TS HLS fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -c copy -hls_segment_type fmp4 -hls_fmp4_init_filename 'fmp4-init.mp4' -hls_time 2 -hls_playlist_type vod -hls_segment_filename 'fmp4-%03d.m4s' 'fmp4.m3u8'
    if ($LASTEXITCODE) { throw 'fragmented MP4 HLS fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -map 0:v:0 -map 0:a:0 -c copy -f hls -hls_time 2 -hls_playlist_type vod -var_stream_map 'v:0,agroup:audio,name:video a:0,agroup:audio,name:audio,default:yes' -master_pl_name 'separate-av.m3u8' -hls_segment_filename 'separate-%v-%03d.ts' 'separate-%v.m3u8'
    if ($LASTEXITCODE) { throw '분리 A/V HLS master fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -map 0 -c copy -f dash -seg_duration 2 -init_seg_name 'dash-init-$RepresentationID$.m4s' -media_seg_name 'dash-chunk-$RepresentationID$-$Number%05d$.m4s' 'stream.mpd'
    if ($LASTEXITCODE) { throw 'DASH fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -map 0:v:0 -map 0:a:0 -c copy -adaptation_sets 'id=0,streams=v id=1,streams=a' -f dash -seg_duration 2 -init_seg_name 'separate-init-$RepresentationID$.m4s' -media_seg_name 'separate-chunk-$RepresentationID$-$Number%05d$.m4s' 'separate-av.mpd'
    if ($LASTEXITCODE) { throw '분리 A/V DASH fixture 생성 실패' }
    & $ffmpeg -hide_banner -loglevel error -y -i $direct -c copy -hls_time 1 -hls_list_size 3 -hls_flags omit_endlist -hls_segment_filename 'live-%03d.ts' 'live.m3u8'
    if ($LASTEXITCODE) { throw 'live-style HLS fixture 생성 실패' }
} finally { Pop-Location }
Write-Host "Fixture generation PASS: $generated"
