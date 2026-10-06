# 아키텍처

확장은 관찰과 사용자 상호작용만 담당하고 Native Host가 probe, 다운로드, 파일 및 프로세스 수명 주기를 소유한다.

1. `NetworkObserver`가 `requestId`별 URL, initiator, 안전한 요청 헤더와 응답 MIME을 결합한다.
2. `MediaCandidateDetector`는 manifest/direct media만 후보로 만들고 segment는 증거로만 사용한다.
3. `CandidateStore`는 canonical URL로 중복을 합치고 `chrome.storage.session`에 저장한다.
4. popup 요청은 `NativeHostClient`를 통해 versioned envelope로 전달된다.
5. Host는 입력과 DRM 신호를 검사한 뒤 FFprobe 또는 FFmpeg를 `shell=False`로 실행한다.
6. 다운로드는 `.partial` 파일에 기록되고 성공해야 최종 이름으로 이동된다.
7. Host는 URL·Cookie를 제외한 job 상태를 `%LOCALAPPDATA%\PersonalStreamDownloader\jobs`의 job별 JSON으로 기록한다. Native port가 끊겨도 실행 중 FFmpeg를 즉시 취소하지 않으며, 새 Host가 `list_jobs`와 PID 기반 cancel을 이어받는다.

브라우저 종속 호출은 background/content/UI 경계에 제한했다. 탐지·점수·URL 로직은 순수 TypeScript 모듈이어서 향후 Firefox adapter에서 재사용할 수 있다.

Native port는 service worker만 소유한다. popup은 runtime message만 사용하며 열릴 때 `list_jobs`를 다시 요청한다. service worker는 Host 단절 뒤 지수 backoff로 재연결하고 `storage.session`의 비민감 job 표시 상태를 동기화한다.

후보의 `requestCount`는 실제 `webRequest` 완료 관찰만 센다. DOM의 `currentSrc`와 Performance 리소스를 다시 스캔하는 것은 네트워크 요청으로 집계하지 않는다. 나중에 확인한 페이지 제목·URL은 기존 후보를 보강하되, 네트워크 응답 MIME처럼 더 강한 탐지 근거는 유지한다. 후보 저장 변경은 직렬 처리해 동시에 도착한 관찰이 서로 덮어쓰지 않게 한다.

Native Host 이벤트는 `NativeHostClient.onEvent`로 service worker에 직접 전달해 저장하며, popup으로 보내는 runtime 브로드캐스트와 분리한다. popup이 없더라도 이 저장 경로는 실행된다. popup은 `storage.onChanged`로 후보·작업·Host 연결 상태를 반영하고, 연결 복구 시 FFmpeg health를 다시 확인한다. 카드는 같은 DOM 요소를 재사용하므로 갱신 중에도 파일명과 세션 선택이 유지된다.

다운로드 worker는 실제 입력 FFprobe를 먼저 실행해 전체 길이와 영상·음성 트랙을 확인한다. 자연 길이와 사용자가 지정한 녹화 제한(`-t`)은 별개이며, 길이를 아는 경우에만 진행률과 ETA를 계산한다. `probing` → `downloading` → `verifying` 단계를 Native 이벤트와 job registry에 보존한다. popup은 처리한 영상 시간, 저장량, FFmpeg 처리 배속과 ETA를 표시하고, 길이 불명 스트림에는 불확정 진행 막대와 설명을 표시한다. `progress=end`는 완료가 아니며, 출력 검증과 원자적 rename 이후에만 완료/100%로 표시한다.

입력에 영상은 있지만 함께 저장할 음성이 없으면 기본적으로 `audio_stream_missing`으로 실패한다. 명시적인 `allowVideoOnly=true`만 무음 영상을 허용하며 경고를 남긴다. HLS master의 program 연결이 확인되면 같은 program의 영상·음성을 선택하고, MP4/DASH 등에서는 한 영상·음성 스트림을 선택한다. 임의의 별도 URL에서 음성을 추측해 합치지는 않는다. FFprobe의 임의 metadata tags는 저장하지 않으며, 선택된 stream index와 codec/해상도 등 제한된 요약만 보존한다. 완료 전 출력 파일도 FFprobe로 확인해 예상한 영상·음성이 빠지면 최종 파일로 rename하지 않는다.

0.1.2부터 수동 Probe의 유효한 길이는 service worker가 동일 후보·정확한 URL·요청 컨텍스트에 연결한다. Cookie/Origin/User-Agent/Referer와 URL은 SHA-256 입력으로만 사용하고, `storage.session`에는 digest와 길이·확인 시각만 저장한다. 캐시는 10분, 최대 100개이며 실패/길이 미확인/live Probe는 기존 항목을 무효화한다. Download의 `verifiedDurationSeconds`는 UI 임의 옵션이 아니라 이 캐시에서만 생성하며, 별도 녹화 제한 `durationSeconds`와 분리한다. 작업별 숫자 메타데이터는 popup 종료 및 worker 재연결/list_jobs 동기화에서도 유지된다.

Host는 여전히 매 다운로드마다 DRM·영상/음성을 다시 검사한다. 최신 FFprobe의 format 길이를 우선하고, 없으면 선택된 영상/음성 stream의 duration, duration_ts × time_base, 제한된 DURATION 태그를 확인한다. 그래도 길이를 모르는 경우에만 같은 컨텍스트의 Probe 힌트를 사용하며 `-t`에는 전달하지 않는다. `durationSource`는 format/stream/probe_hint/requested/unknown을 구분한다. media HLS의 ENDLIST 부재 또는 DASH dynamic으로 live가 명시 확인되면 rolling-window 길이와 이전 힌트를 버린다. 길이 미확인 자체를 live로 단정하지 않는다. HLS master만 읽고 live 여부를 단정하지 않는 한계가 있다.

popup은 전체 길이와 출처를 표시하고, 유효한 길이·처리 시간·처리 배속이 있을 때만 누락된 진행률/ETA를 계산한다. 종료 시점이 없는 live, 메타데이터 대기, Probe 후에도 길이를 확인하지 못한 경우의 설명을 분리한다. Host 버전도 표시하여 등록된 구형 실행파일과 새 extension 빌드의 혼용을 드러낸다.

0.2.0은 동일한 popup entrypoint를 `?view=sidepanel`에서도 사용한다. Native Port는 계속 service worker만 소유하며 UI 개수와 무관하다. `browser-controls.ts`가 기본 보기, 사용자 동작에 의한 sidePanel 열기, contextMenus, opt-in 알림을 담당한다. UI 설정은 기존 FFmpeg/폴더 설정과 별도의 `managerPreferences` 키에 저장한다.

후보 title/poster는 provenance를 포함하고, 강한 영상별 메타데이터가 약한 페이지 메타데이터로 덮이지 않는다. Probe 결과는 후보를 다시 upsert하지 않고 기존 후보의 숫자 summary만 직렬화해 갱신하므로, 응답 대기 중 제거된 후보를 되살리지 않는다. 작업 행 역시 jobId 기반 DOM을 재사용하여 진행률 갱신 중 체크·포커스·상세 펼침을 유지한다.

Native registry가 기록의 원본이다. `remove_jobs`는 terminal 기록만 제거하며, service worker는 제거 응답과 list_jobs/진행 이벤트를 같은 mutation queue에서 처리한다. 재생·탐색은 registry 기반 경로 검증을 거치므로 Host 재시작 이후의 작업도 처리한다. 파일 실행과 기록 제거는 프런트엔드 임의 경로가 아니라 UUID jobId로만 요청한다.
