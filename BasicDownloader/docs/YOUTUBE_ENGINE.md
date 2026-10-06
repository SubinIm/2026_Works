# YouTube 보조 엔진 (0.3.0)

2026-10-06 사용자 승인으로 기존의 사이트별 extractor 제외 범위에 YouTube opt-in 예외를 추가했다. 일반 HTTP(S) 후보 파이프라인은 유지한다. 브라우저의 SABR/MediaSource blob을 직접 저장하는 구현은 아니다. 공식 yt-dlp가 같은 영상의 다른 재생 형식을 조회하고 영상·음성을 받아 FFmpeg로 stream copy 병합한다.

## 설정

1. `extension/dist`를 로드한 확장을 새로고침한다.
2. `scripts/install-host.ps1 -ExtensionId <실제 ID> -ExecutablePath native-host/dist/0.3.0/stream_host.exe`로 등록한다. 실행 중 작업은 먼저 완료한다.
3. 설정에서 YouTube 보조 엔진을 활성화한다. `yt-dlp.exe`, `node.exe`, `ffmpeg.exe`의 전체 경로를 넣고 저장한다.
4. YouTube 영상 페이지를 활성화하고 관리자에서 새로고침한다. 별도 `YouTube 페이지 다운로드` 영역의 형식 조회 또는 다운로드를 사용한다. blob 카드의 Probe/Download가 비활성화된 것은 정상이다.

검증용 엔진: `tools/youtube/2026.08.19/yt-dlp.exe`. 검증용 Node: `C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`. FFmpeg/FFprobe는 기존 설정을 유지한다. 폴더를 옮기면 실행 파일 경로도 갱신해야 한다.

최대 높이는 상한이다. 해당 높이가 없으면 더 낮은 최적 형식을 선택한다. MKV는 AV1/VP9+Opus 등을 원본 그대로 받을 수 있다. MP4는 플레이어 호환성을 위해 H.264+AAC 형식을 선택하며 해당 형식이 없으면 명확히 실패한다. 자동 재인코딩은 하지 않는다. 음성 전용도 MKV/MP4이며 MP3 변환이 아니다.

`시작 전 형식 조회`를 끄면 추가 metadata Probe를 생략한다. 다운로드용 주소 추출과 마지막 출력 FFprobe는 여전히 필요하다. 길이 정보가 없더라도 다운로드 바이트·속도·트랙 기준 진행률은 표시한다. 두 트랙의 비율을 동일 가중치로 합산하므로 첫 영상 트랙 완료가 전체 완료를 뜻하지 않는다. 병합·출력 검증 전 최대 98%, 검증 후 100%다. ETA는 마지막 트랙의 전송 예상치이며 병합·검증 시간은 포함하지 않는다.

쿠키는 보내지 않는다. 기존 후보 카드의 세션 포함 옵션과 무관하다. 로그인·비공개·연령 제한·멤버십·유료·진행 중 live는 지원 대상으로 검증하지 않았다. DRM을 해제하지 않는다. PO Token 또는 로그인 요구 시 사용자용 거부 메시지를 표시하며 자동 쿠키 전환을 하지 않는다. 사이트 변경·속도 제한 때문에 다른 영상의 성공을 보장할 수 없다.

## 실제 Host 검증 재현

```powershell
& native-host/.venv/Scripts/python.exe scripts/verify-youtube.py `
  --host native-host/dist/0.3.0/stream_host.exe `
  --engine tools/youtube/2026.08.19/yt-dlp.exe `
  --node 'C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  --ffmpeg 'C:\Program Files\DownloadHelper CoApp\ffmpeg.exe' `
  --root artifacts/youtube-acceptance-new `
  --url 'https://www.youtube.com/watch?v=D2cUkF-MPJU'
```

검증은 네트워크와 영상 제공 상태에 의존한다. 실패를 skip하지 않는다. 형식 조회, 시작 전 조회 켜짐/꺼짐 다운로드, 영상·음성·길이, FFmpeg null decode, 실제 엔진 프로세스 취소, partial 정리, 메시지·상태·로그의 raw URL 누출 여부를 검사한다. 검증용 다운로드 파일은 지정한 폴더에 남는다.

## 바이너리 출처

- 공식 릴리스: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- 공식 `yt-dlp.exe` SHA-256: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`
- 라이선스 및 번들 구성: https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/LICENSE
- JavaScript runtime 안내: https://github.com/yt-dlp/yt-dlp/wiki/EJS

실험적 SABR 빌드는 설치하지 않았다. 엔진 자동 다운로드·업데이트도 구현하지 않았다. 공식 엔진의 대체 조회 경로가 이 게스트 영상에서 실제로 성공한 결과만 보고한다.
