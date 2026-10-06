# Native Messaging protocol v1

모든 frame은 4-byte little-endian UTF-8 byte length와 JSON body다. 최대 body는 1 MiB다.

```json
{"protocolVersion":1,"messageId":"uuid","type":"health_check","payload":{}}
```

Extension → Host:

- `hello {}`
- `health_check {}`
- `probe_media { url, mediaKind, requestContext, settings? }`
- `start_download { url, mediaKind, filename, container, overwrite, liveMode, durationSeconds?, verifiedDurationSeconds?, allowVideoOnly?, audioOnly?, probeBeforeDownload?, displayTitle?, sourceKey?, requestContext, keepPartial?, settings? }`
- `youtube_probe { url, maxHeight?, container?, audioOnly?, settings? }`
- `youtube_download { url, filename, maxHeight?, container?, audioOnly?, probeBeforeDownload?, overwrite?, keepPartial?, displayTitle?, sourceKey?, settings? }`
- `cancel_job { jobId }`
- `list_jobs {}`
- `open_output_folder { jobId }`
- `open_output_file { jobId }`
- `reveal_output_file { jobId }`
- `remove_jobs { jobIds }`
- `shutdown_when_idle {}`

Host 0.2.1의 `health_result.capabilities.optionalInputProbe=true`는 `probeBeforeDownload` 지원을 뜻한다. 이 필드는 strict boolean, 기본 true이며 false는 입력 FFprobe만 생략한다. manifest DRM 검사와 출력 FFprobe/음성 검증은 생략하지 않는다. 생략 시 기본 첫 영상/음성 스트림을 매핑하고, 기존 검증된 길이 힌트가 없으면 ETA는 미표시한다. 구형 Host에는 false를 보내지 않는다.

Host 0.2.2는 `health_result.capabilities.audioOnly=true`를 알린다. `audioOnly`는 기본 false인 strict boolean이며 `allowVideoOnly=true`와 동시에 설정할 수 없다. 선택된 음성 트랙만 stream copy하고 `-vn`으로 영상을 제외한다. 입력 Probe 생략 시 `0:a:0`을 사용한다. 출력에 음성이 없거나 영상이 남으면 실패 처리한다. 컨테이너는 기존 MP4/MKV이며 MP3 변환이 아니다.

확장 내부 `find_av {tabId,pageUrl,userAgent}`는 쿠키 없이 같은 페이지의 적격 후보를 최대 20개까지 순차 Probe하고 첫 영상+음성 후보 ID를 반환한다. 검증된 summary는 재사용하며, 오류는 다음 후보로 진행한다. 탭별 동시 중복 검색은 같은 Promise를 공유한다. 반환만으로 다운로드하지 않는다.

Host → Extension:

Host 0.3.0의 `capabilities.youtube=true`는 별도 YouTube 명령을 지원함을 뜻한다. `youtubeAvailable`은 설정된 실행 파일의 경로 검증 결과이며 네트워크 조회 성공 보장은 아니다. 설정은 `youtubeEnabled`, `ytDlpPath`, `jsRuntimePath`다. 이 명령의 URL은 HTTPS YouTube watch/shorts/youtu.be 영상 페이지로 제한·canonicalize한다. `requestContext`와 `includeSession`을 거부한다. 컨테이너는 MKV/MP4, 최대 높이는 정해진 목록 또는 null이며 임의 extractor 옵션을 받지 않는다. 반환하는 Probe는 안전한 제목·길이·선택된 영상/음성·가능한 높이·형식 ID만 포함한다. URL/헤더/raw format은 반환하지 않는다. 출력 FFprobe 검증 및 원자적 rename 후에만 완료한다. `list_jobs.engine`은 `youtube` 또는 `ffmpeg`다. YouTube 진행률은 트랙별 비율을 합산하고 98%에서 병합·검증을 기다린다.

- `hello_result { hostVersion, protocolVersion }`
- `health_result { ffmpegAvailable, ffmpegVersion?, error? }`
- `probe_result { format, duration, durationUnknown, isLive, bitrate, videoStreams, audioStreams, subtitleStreams }`
- `job_started { jobId, state, outputPath, displayTitle?, sourceKey? }`
- `job_progress { jobId, frame, fps, totalBytes, mediaSeconds, speed, percent?, etaSeconds?, progress }`
- `job_completed { jobId, outputPath }`
- `job_cancelled { jobId, accepted? }`
- `job_failed { jobId?, state?, errorSummary }`
- `protocol_error { errorSummary }`

`requestContext`는 `{ pageUrl, referer?, origin?, userAgent?, cookieHeader? }`다. 알 수 없는 type, 잘못된 schema/version, HTTP(S)가 아닌 URL은 거부한다.

0.2.0 파일 액션은 UUID `jobId`로 저장된 registry를 조회한다. 임의 경로/명령을 받지 않는다. 재생·파일 선택은 완료 상태이고 실제 존재하는 로컬 MP4/MKV에만 허용한다. 폴더 열기도 알려진 작업의 실제 저장 폴더만 연다. `remove_jobs`는 최대 100개 UUID를 받으며 terminal 기록만 제거하고 `health_result {removedJobIds,rejectedJobIds}`를 반환한다. 실제 영상·partial 파일은 제거하지 않는다.

`displayTitle`은 정제·redaction된 최대 300자 제목, `sourceKey`는 정확한 canonical URL의 SHA-256 64자리 hex다. `list_jobs`는 둘을 포함한다. raw URL/쿠키를 영속 저장하지 않는다. `verifiedDurationSeconds`는 양의 유한한 숫자여야 하며, 진행률 힌트일 뿐 녹화 길이 `-t`가 아니다. 최신 Probe와 명시 확인된 live 판정이 우선한다.
