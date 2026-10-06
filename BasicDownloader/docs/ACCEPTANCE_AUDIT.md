# 실제 Chrome + FFmpeg acceptance audit

감사 일시: 2026-07-23 (Asia/Seoul)

## 1. 환경

| 도구 | 상태 | 실제 경로 / 버전 |
|---|---|---|
| Chrome | 발견 | `C:\Program Files\Google\Chrome\Application\chrome.exe`, 150.0.7871.129 |
| FFmpeg | 발견, PATH 밖 | `C:\Program Files\DownloadHelper CoApp\ffmpeg.exe`, c30f360955 (2023) |
| FFprobe | 발견, PATH 밖 | `C:\Program Files\DownloadHelper CoApp\ffprobe.exe`, c30f360955 (2023) |
| Python | 발견, 번들 | `C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`, 3.12.13 |
| Node.js | 발견, 번들 | `C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`, 24.14.0 |

유효한 Git metadata가 없다. `.git`에는 MATLAB Drive 표식만 있어 `git status`는 `not a git repository`로 종료된다.

## 2. 감사 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| Native port를 service worker가 소유 | PASS | `background/native-host-client.ts`와 `service-worker.ts`; popup은 runtime message만 사용 |
| popup 종료 중 Host job 지속 구조 | PASS (자동 구조/E2E) | popup 비의존 Host EXE job과 port 단절 E2E 통과 |
| popup 재개 시 동일 job 표시 | PASS (자동 구조), 실제 Chrome BLOCKED | popup이 열릴 때 `list_jobs` 요청; Chrome UI 미실행 |
| service worker 시작 시 job 복구 | PASS (자동 구조/E2E), 실제 Chrome BLOCKED | 시작 시 `syncHostState`; 새 Host EXE가 registry에서 running job 복구 |
| Host disconnect 재연결 | PASS (자동 구조) | 1~30초 지수 backoff와 `list_jobs` 동기화 |
| Cookie/Authorization 비저장 | PASS | job registry와 candidate storage에 header를 기록하지 않음; 인증 E2E에서 log/state 비노출 확인 |
| signed token storage/UI 비노출 | PASS | 저장 후보에는 redacted URL만 사용; TypeScript 회귀 테스트 통과 |
| 실제 signed URL 보존 | PASS | 유효 token을 요구하는 endpoint의 Probe 성공 |
| 입력 전용 FFmpeg 옵션 위치 | PASS | `-user_agent`/`-headers`가 `-i` 앞에 위치하는 단위 테스트 |
| progress pipe parsing | PASS | `-progress pipe:1`, stdout parser 및 실제 `job_progress` 이벤트 확인 |
| stderr/progress 분리 | PASS | stderr 전용 drain thread와 bounded deque; Native Host stderr 0바이트 확인 |
| MP4→MKV fallback 제한 | PASS | mux 오류 문자열만 허용; 403 다운로드 실패에서 MKV 미생성 |
| 인증/네트워크/DRM fallback 금지 | PASS | 403 E2E 및 unsupported DRM preflight 회귀 테스트 |
| Windows 자식 프로세스 취소 | PASS | `taskkill /PID ... /T /F`, 실제 PID 소멸 확인 |
| partial 원자적 완료 | PASS | 같은 디렉터리 `.partial` → `Path.replace`; 완료 후 partial 없음 |
| 실패/취소 partial 정책 | PASS | 취소 시 기본 삭제와 `keepPartial=true` 보존을 실제 FFmpeg로 확인 |
| Native Host stdout 순도 | PASS | 모든 EXE E2E frame decode 성공, Host stderr 0바이트 |
| DASH ContentProtection 범위 | PASS | 알려진 UUID/CENC marker만 차단; 임의 ContentProtection 허용; mp4protection은 Widevine으로 오분류하지 않음 |
| HLS AES-128/SAMPLE-AES 구분 | PASS | AES-128 허용, SAMPLE-AES unsupported 회귀 테스트 |
| 실제 Chrome HLS/DASH 탐지 | BLOCKED | Chrome 전용 제어 기능이 이 세션에 없어 unpacked UI 조작/검사 불가 |
| 실제 Chrome Native Host 연결 | BLOCKED | 실제 extension ID를 Chrome UI에서 얻고 등록해야 함 |
| 실제 사이트 검증 | NOT RUN | 이번 감사 범위는 로컬 fixture이며 사이트별 extractor는 비지원 |

## 3. 실제 FFmpeg 검증

`stream_host.exe`를 Native Messaging framing으로 직접 구동해 다음 6개 입력을 각각 Probe하고 stream-copy 다운로드했다.

| Fixture | Probe | Download | video+audio | duration 오차 ≤1초 | `ffmpeg -v error -i OUTPUT -f null -` |
|---|---|---|---|---|---|
| direct MP4 | PASS | PASS | PASS | PASS | PASS, stderr 없음 |
| MPEG-TS HLS VOD | PASS | PASS | PASS | PASS | PASS, stderr 없음 |
| fragmented MP4 HLS VOD | PASS | PASS | PASS | PASS | PASS, stderr 없음 |
| DASH | PASS | PASS | PASS | PASS | PASS, stderr 없음 |
| 분리 video/audio adaptation DASH | PASS | PASS | PASS | PASS | PASS, stderr 없음 |
| live-style HLS, 3초 제한 | PASS | PASS | PASS | PASS | PASS, stderr 없음 |

최종 `Get-Process ffmpeg`와 `Get-Process stream_host` 결과는 각각 0개였다.

## 4. 발견·수정한 결함

### HIGH — service worker/Host 재시작 후 job 복구 없음

- 재현: 기존 구현에서 `service-worker.ts`와 popup에 `list_jobs` 시작 동기화가 없었고, Host stdin EOF가 `jobs.shutdown()`을 호출했다.
- 기대: port 단절 뒤 실행 중 다운로드가 지속되고 새 Host가 같은 job을 조회·취소한다.
- 실제: 작업 취소 및 UI 상태 손실 구조였다.
- 원인: job이 Host 메모리에만 존재했다.
- 수정: `job_registry.py`, `jobs.py`, `__main__.py`, `service-worker.ts`, `native-host-client.ts`, `popup.ts`.
- 재시험: Host EXE port 단절 → 새 Host `list_jobs` running 복구 → cancel → PID 소멸 PASS.

### HIGH — signed query token이 extension storage/UI에 평문 저장

- 재현: 후보 전체 객체의 `url`과 `canonicalUrl`을 `storage.session`에 기록했다.
- 기대: 실제 요청에는 원문을 쓰되 storage/UI에는 token 평문이 없어야 한다.
- 실제: token이 저장 후보와 popup URL에 노출됐다.
- 원인: 전송 URL과 표시/저장 URL이 분리되지 않았다.
- 수정: `candidate-store.ts`, `service-worker.ts`, `candidates.test.ts`.
- 재시험: persisted candidate JSON에 secret 없음, 유효 signed endpoint Probe 성공 PASS.

### HIGH — 취소 accepted와 실제 process-tree 종료 불일치

- 재현: `taskkill` 반환을 무시해 접근 실패 후에도 accepted/cancelled를 기록했다.
- 기대: process tree가 실제 종료된 경우에만 취소 성공.
- 실제: 첫 시험에서 FFmpeg PID 45616이 요청 직후 남아 FAIL.
- 원인: `taskkill` exit code와 Popen 종료를 확인하지 않았다.
- 수정: `jobs.py`의 `_terminate_tree`와 detached cancel 상태 처리.
- 재시험: source Host와 배포 EXE 모두 PID 소멸, registry `cancelled`, orphan 0개 PASS.

### MEDIUM — fMP4/DASH fixture init/segment 이름 충돌

- 재현: 생성 후 fMP4 init과 DASH segment가 manifest 디렉터리에 없어 404.
- 기대: 모든 manifest 참조가 같은 fixture root에서 유효.
- 실제: fMP4 HLS와 DASH Probe 3건 FAIL.
- 원인: FFmpeg 기본 segment 이름이 실행 CWD에 생성되고 두 DASH가 같은 이름을 공유했다.
- 수정: `generate-fixtures.ps1`에서 생성 CWD 고정 및 fixture별 init/media 이름 지정.
- 재시험: 세 manifest Probe/Download/decode 모두 PASS.

### MEDIUM — DASH ContentProtection 과잉 차단

- 재현: `ContentProtection` 문자열 하나만 있어도 모두 unsupported.
- 기대: Widevine/PlayReady/CENC marker를 구분하고 mp4protection만으로 Widevine이라 단정하지 않음.
- 실제: 임의 metadata도 차단.
- 수정: `drm_detection.py`와 DRM fixture 7종.
- 재시험: clear/AES-128 허용, SAMPLE-AES·Widevine·PlayReady 차단, mp4protection generic CENC 분류 PASS.

### MEDIUM — FFmpeg stderr pipe 정체 가능성

- 재현: progress stdout을 다 읽은 후에만 stderr를 읽음.
- 기대: 두 pipe를 독립적으로 지속 소비.
- 수정: bounded stderr deque를 소비하는 별도 thread 추가.
- 재시험: 6종 실제 다운로드 progress 이벤트 및 Host stderr 순도 PASS.

## 5. 실행 명령

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-fixtures.ps1 -FFmpegPath 'C:\Program Files\DownloadHelper CoApp\ffmpeg.exe'

$env:PYTHONPATH='native-host\src'
$env:PSD_TEST_FFMPEG='C:\Program Files\DownloadHelper CoApp\ffmpeg.exe'
$env:PSD_TEST_HOST_EXE=(Resolve-Path 'native-host\dist\stream_host.exe').Path
& 'C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s native-host\tests -v
```

최종 결과: Python 18/18 PASS, TypeScript 8/8 PASS, skip 0.

## 6. Chrome에서 남은 최소 수동 단계

1. 서버 실행:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-fixture-server.ps1 `
     -FFmpegPath 'C:\Program Files\DownloadHelper CoApp\ffmpeg.exe' `
     -Python 'C:\Users\Acrob\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
   ```

2. `chrome://extensions`에서 개발자 모드를 켜고 `extension\dist`를 로드한다. 카드에 오류가 없어야 한다.
3. 실제 ID로 `powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-host.ps1 -ExtensionId <ID>`를 실행하고 Chrome을 완전히 재시작한다.
4. 확장 옵션에서 FFmpeg 경로를 `C:\Program Files\DownloadHelper CoApp\ffmpeg.exe`로 설정한다. popup 상단은 `Host · FFmpeg 정상`이어야 한다.
5. `http://127.0.0.1:8765/player/`에서 HLS와 DASH 버튼을 하나씩 누른다. popup에는 HLS/DASH manifest 카드가 각각 하나 나타나고 `.ts`/`.m4s` 카드는 없어야 한다.
6. 각 카드에서 Probe를 눌러 video/audio stream을 확인하고 Download 후 결과 파일을 위 null-output 명령으로 확인한다.
7. slow HLS로 다운로드를 시작하고 popup을 닫았다 다시 연다. 동일 job이 `running`이어야 한다.
8. 서비스 워커 검사 창에서 worker를 종료하고 popup을 다시 연다. Host 재연결 뒤 동일 job이 표시되어야 하며 console error를 저장한다.
9. 실행 중 `stream_host.exe`를 종료한다. popup에 단절 오류가 나타난 뒤 재연결/`list_jobs` 상태가 복구되어야 한다.
10. 취소 후 `Get-Process ffmpeg -ErrorAction SilentlyContinue`에 해당 PID가 없어야 한다.
11. 인증 버튼/링크로 Cookie opt-in과 signed URL을 검사하고 storage 두 영역에 `fixture-ok` 또는 token 값이 없는지 확인한다.

이 11단계를 실제 Chrome에서 완료하기 전에는 `로컬 E2E 완료`로 분류하지 않는다.

## 7. 현재 상태

**자동 검증 완료**. 구조 구현과 실제 FFmpeg/FFprobe/Native Host EXE E2E는 완료됐다. 실제 Chrome UI 검증은 BLOCKED이므로 `로컬 E2E 완료` 또는 `실제 사이트 검증 완료`는 아니다.

## 8. 브라우저 관찰 정보 활용 개선 — 2026-10-05

이번 변경은 확장 프로그램의 후보 집계, popup 상호작용, Native Port 이벤트 저장 경로를 대상으로 한다. 위 7월 FFmpeg 결과를 이번 실행 결과로 재사용하지 않는다.

### 발견한 결함과 수정

| 심각도 | 재현/원인 | 기대 동작 및 수정 | 수정 파일 |
|---|---|---|---|
| HIGH | popup 카드 삽입 뒤 Download/Start를 누르면 이미 비워진 DocumentFragment에서 옵션을 조회 | 실제 article을 유지하고 그 안에서 옵션 조회 | `extension/src/popup/popup.ts` |
| HIGH | Host 이벤트 저장을 같은 worker가 보낸 runtime 브로드캐스트 수신에 의존 | Port 소유자 callback으로 직접 저장; popup 수신 여부와 독립 | `extension/src/background/native-host-client.ts`, `service-worker.ts` |
| HIGH | 동시에 받은 후보 또는 작업 이벤트가 같은 storage 스냅샷을 덮어씀 | 후보·작업 변경을 각각 직렬화하고 최신 완료 상태 유지 | `candidate-store.ts`, `service-worker.ts` |
| MEDIUM | Host 복구 뒤에도 popup 최초 health 값이 남아 버튼이 갱신되지 않음 | storage 연결 변경과 새로고침에서 health 재확인 | `popup.ts`, `presentation.ts` |
| MEDIUM | DOM/Performance를 다시 읽을 때마다 요청 횟수가 증가 | 실제 webRequest만 집계, 페이지 제목/URL은 후보에 보강 | `candidate-detector.ts`, `candidate-store.ts` |
| MEDIUM | flat progress 이벤트의 문자열 `progress`가 기존 진행률 객체를 대체 | Host registry와 같은 중첩 progress 객체로 저장 | `service-worker.ts` |
| MEDIUM | 새로고침이 입력값을 버리거나 늦은 목록 응답이 최신 상태를 덮어씀 | 카드 DOM 재사용, 수정 파일명/세션 유지, 이전 목록 응답 무시 | `popup.ts` |

재현 및 재시험 명령 (작업 디렉터리 `extension`):

```powershell
node --experimental-strip-types --test tests/popup-interactions.test.ts
node --experimental-strip-types --test tests/native-host-client.test.ts
node --experimental-strip-types --test tests/candidates.test.ts tests/candidate-store.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.ts
node build.mjs
```

popup 테스트는 실제 popup entry point를 번들링해 합성 DOM에서 실행한다. Native Port 테스트는 Chrome API/Port를 모의 구현해 브로드캐스트 수신자가 없을 때의 worker 저장 경로를 확인한다. 둘 다 실제 Chrome 또는 FFmpeg 실행을 대신하는 검증은 아니다.

### 실행 제한

- 실제 브라우저: **BLOCKED**. 열린 `http://127.0.0.1:8765/player/` 탭 선택을 Browser Use 도구가 URL 보안 정책으로 거부했다. 다른 브라우저, CDP 또는 간접 UI 경로로 우회하지 않았다.
- 실제 FFmpeg 출력 재검증: **NOT RUN**. 이번 변경은 확장 프로그램만 대상으로 하며 Native Host Python/실행 파일은 변경하지 않았다.
- 최초 자동 시험에서 esbuild 상위 경로 접근이 샌드박스에 거부됐다. 로컬 테스트/빌드에 한정한 확장 권한 실행으로 재시험해 PASS했다.
- 최초 worker 통합 시험은 Node strip-only가 TypeScript parameter property를 처리하지 못해 FAIL했다. 배포와 동일하게 esbuild로 실제 worker 소스를 번들링해 실행하도록 테스트 harness를 수정했다. 검증 단언이나 실패 기준을 약화하지 않았다.

### 최종 재시험 결과

| 검사 | 상태 | 근거 |
|---|---|---|
| TypeScript | PASS | `tsc --noEmit`, exit 0 |
| 전체 확장 테스트 | PASS | 34/34, FAIL 0, skip 0 |
| popup 상호작용 | PASS | 6개 테스트: 마운트 뒤 Download/Start, 연결 복구, 입력값 유지, 작업 완료 갱신, 오래된 응답 거부, 요청 실패 처리 |
| Native Port/worker | PASS | 3개 테스트: popup 없는 이벤트 저장, 단절/복구, 실제 flat progress·outputPath 유지, 상태 경합, blob 요청의 Port 전달 차단 |
| 후보/저장소 | PASS | 12개 테스트: 네트워크 횟수, DOM metadata 보강, 동시 갱신, signed 원문 보존 및 저장소 redaction |
| 확장 빌드 | PASS | `node build.mjs`, exit 0; `extension/dist` 재생성 |
| 실제 Chrome 클릭·재생·다운로드 | BLOCKED | 브라우저 도구 URL 정책 거부 |
| 실제 FFmpeg 출력 재검증 | NOT RUN | 이번 변경에서 실행하지 않음 |

이번 변경의 상태는 **자동 검증 완료**다. 실제 Chrome acceptance나 로컬 E2E가 완료됐다는 의미는 아니다. 적용하려면 Chrome 확장 관리 화면에서 기존 unpacked 확장을 새로고침한 뒤 `MANUAL_TEST.md`의 2026-10-05 항목을 확인한다. 기존 후보에 저장된 과거 요청 횟수는 소급 보정하지 않으므로 횟수 재시험 시 후보를 초기화하고 player를 새로고침한다.

## 9. 연결된 실제 Chrome에서 재생 확인 — 2026-10-05

이번 실행에서는 Chrome 브라우저 연결이 동작했다. 이미 확인된 YouTube 영상 탭과 `http://127.0.0.1:8765/player/` 탭만 대상으로 했다. 전체 탭 조회는 무관한 로그인·세션 정보 노출 가능성 때문에 자동 승인 검토에서 거부되어, 다른 탭은 검사하지 않았다.

### 실제 관찰 결과

| 검사 | 상태 | 실제 근거 |
|---|---|---|
| YouTube 영상 재생 | PASS | 재생 버튼 클릭 후 2.506초 → 19.938초로 진행, 1920×1080, readyState 4, media error 없음; 44.647초에서 다시 일시정지 |
| Direct MP4 | PASS | 실제 재생 버튼 클릭 후 0.146초 → 8.000초, ended=true, 640×360, media error 없음 |
| HLS MPEG-TS | PASS | 0.080초 → 8.021초, ended=true, 640×360, media error 없음 |
| HLS fragmented MP4 | PASS | 8.067초까지 완료, ended=true, readyState 4, media error 없음 |
| DASH | PASS | 8.000초까지 완료, ended=true, 640×360, media error 없음 |
| 분리 A/V DASH | PASS | 8.000초까지 완료, ended=true, 640×360, media error 없음; 이는 플레이어 재생 검증이며 다운로드 출력의 stream 검증은 아님 |
| 기존 탭의 확장 content script | FAIL | `Extension context invalidated`가 5초마다 반복됨; 아래 결함 기록 참고 |
| fixture 페이지 새로고침 후 오류 재발 | PASS | 페이지 새로고침 후 두 차례 console error 조회에서 새 오류 0개, HLS 재생 완료; 새 코드의 실브라우저 재로드 시험을 뜻하지 않음 |
| Native Host 등록/프로세스 | PASS | 실제 HKCU 등록, manifest와 EXE 존재, 허용 ID `jpahdpgemdlibedhcodgolicnaieomoh`, Host 부모/자식 실행 확인 |
| 실제 확장 popup의 후보·Probe·Download | BLOCKED | Windows UI 도구가 현재 Chrome URL을 안전하게 판별하지 못해 접근 중단. 다른 UI/CDP 경로로 우회하지 않음 |
| 이번 실행에서 Native Host를 통한 다운로드·출력 FFprobe/decode | NOT RUN | 실제 popup 다운로드를 시작하지 못함. 등록/프로세스 존재만으로 Native Messaging 응답 성공을 주장하지 않음 |
| popup 종료/worker 재시작/취소·orphan 검사 | NOT RUN | 이번 실행에서 다운로드 job을 시작하지 않음 |
| 실제 사이트 인증/Cookie opt-in/DRM | NOT RUN | 외부 페이지는 재생만 확인했으며 Cookie 전달 또는 다운로드를 실행하지 않음 |

### 발견한 결함

- 심각도: **MEDIUM**. 확장을 재로드하면 이미 열린 페이지의 content script가 무효화된 runtime에 계속 메시지를 보내 콘솔 오류가 반복된다.
- 재현: fixture를 열고 확장을 재로드한 뒤 기존 fixture 탭에서 5초 이상 대기한다. `media-observer.js`의 `collect`에서 오류가 반복된다.
- 기대: 무효화된 script는 관찰자와 타이머를 정리하고 추가 호출을 멈춘다. 새 확장 script를 주입하려면 페이지 새로고침이 필요하다.
- 실제: Promise `.catch()`가 `sendMessage()`의 동기 예외를 처리하지 못하고, MutationObserver와 interval이 계속 살아 있다.
- 원인/수정 대상: `extension/src/content/media-observer.ts`; lifecycle 회귀 시험은 `extension/tests/media-observer.test.ts`.
- 수정: 매 수집 전 runtime 유효성 검사, 동기 예외와 Promise rejection 처리, 무효화 시 observer disconnect 및 interval clear. 이미 큐에 있는 callback도 추가 전송하지 않는다. 일시적인 receiver 부재는 계속 재시도한다.
- 수정 후 재시험: 실제 content entrypoint를 번들링한 VM 회귀 시험 7/7 PASS. 새 빌드를 Chrome에 재로드한 뒤 실제 invalidation 재현은 **NOT RUN**(Windows UI 접근 중단).

### 수정 후 자동 재시험

작업 디렉터리: `extension`.

| 재현/검증 명령 | 상태 | 결과 |
|---|---|---|
| `node --experimental-strip-types --test tests/media-observer.test.ts` | PASS | 7/7, skip 0; 동기/비동기 invalidation, 초기 무효 runtime, 큐 callback, 일시 receiver 오류, MP4/HLS/DASH 수집 검증 |
| `node --experimental-strip-types --test tests/*.test.ts` | PASS | 41/41, FAIL 0, skip 0; 기존 blob 차단 및 popup 회귀 포함 |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | exit 0 |
| `node build.mjs` | PASS | exit 0; `extension/dist` 재생성 |

대상 시험의 최초 sandbox 실행은 esbuild 설치 상위 디렉터리 접근 거부로 실패했다. 승인된 로컬 시험 실행으로 재시험했으며, 검증 조건을 완화하거나 skip하지 않았다. 소스/시험 수정 파일은 `extension/src/content/media-observer.ts`, `extension/tests/media-observer.test.ts`이며 이 문서와 빌드 산출물도 갱신했다.

### 환경 및 증거

- Chrome `153.0.8010.53`, Python `3.12.14`, Node `24.19.0`.
- FFmpeg/FFprobe: `C:\Program Files\DownloadHelper CoApp\ffmpeg.exe`, `ffprobe.exe`, 버전 `c30f360955` (2023).
- fixture 서버는 `127.0.0.1:8765`에서 실행 중이며 이전의 연결 거부 상태가 아니다.
- 실제 재생 스크린샷: `C:\Users\Acrob\.codex\visualizations\2026\07\22\019f8a63-32c0-7f03-8446-95452060ff33\youtube-playback-check.jpg`, `fixture-playback-check.jpg`.

현재 재생 확인은 실제 Chrome에서 수행했지만, **로컬 E2E 완료/실제 사이트 검증 완료는 아니다**. 다음 최소 수동 단계는 fixture 탭을 전면에 두고 Personal Stream Downloader 팝업을 여는 것이다. 팝업의 HLS/DASH 카드와 `Host · FFmpeg 정상` 상태를 확인하고, blob 카드의 Probe/Download/세션 체크박스가 비활성인지 확인해야 한다. 이후 로컬 HLS/DASH 카드에서 Probe 및 Download를 수행해야 다운로드 acceptance를 이어갈 수 있다.

## 10. 사용자 오류 화면 후 재확인 — 2026-10-05

- 사용자 화면의 `Cannot read properties of undefined (reading 'sendMessage')`와 `Extension context invalidated`를 해당 YouTube 탭의 console 기록에서도 확인했다.
- 기록된 stack은 `media-observer.js:13 (collect)`, `:17 (MutationObserver.observe.childList)`다. 현재 배포 파일은 13행이 `hasRuntime` 종료, 17행이 observer 정리, 23행이 `collect`, 41행이 try/catch 안의 `sendMessage`다. 따라서 해당 stack은 현재 배포 파일과 일치하지 않으며, 이전 주입 script/오류 기록의 근거다.
- 작성 중인 입력이 없음을 확인하고 해당 YouTube 탭만 새로고침했다. 새로고침 후 67초 관찰 시점에서 새 observer/runtime 오류 **0건**, readyState 4, media error 없음. 자동 재생된 영상은 다시 일시정지했다. Chrome 확장 관리 화면의 과거 오류 기록은 삭제하지 않았다.
- `extension/tests/media-observer.test.ts`에 실제 runtime 객체 부재, chrome 전역 부재, 실행 중 runtime 소실, 검사와 전송 사이 runtime 소실 시험을 추가했다. 모두 기존 production 코드로 PASS했으며 이번 확인에서 production 소스를 다시 수정하지 않았다.

| 검사 | 상태 | 결과 |
|---|---|---|
| `node --experimental-strip-types --test tests/media-observer.test.ts` | PASS | 11/11, skip 0 |
| `node --experimental-strip-types --test tests/*.test.ts` | PASS | 45/45, FAIL 0, skip 0 |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | exit 0 |
| 실제 YouTube 탭 새로고침 후 observer 오류 재발 | PASS | 67초 관찰 시 새 오류 0건 |
| Chrome 확장 관리 화면의 저장된 오류 기록 삭제/재확인 | NOT RUN | 기록은 보존했으며 관리 화면을 직접 조작하지 않음 |

확장을 재로드하면 이미 열린 다른 페이지에도 이전 script가 남을 수 있으므로, 해당 페이지 역시 새로고침해야 한다. 오류 목록에 항목이 남았다는 사실만으로 재발이라고 판단하지 않고, 이전 기록과 새로 발생한 오류를 구분한다. 이 확인은 content-script 오류 진단이며 전체 다운로드 E2E 완료를 뜻하지 않는다.

## 11. 진행률과 무음 다운로드 수정 — 0.1.1, 2026-10-05

### 실제 사용자 결과 파일 검사

사용자가 지정한 `C:\Users\Acrob\Downloads\PersonalStreamDownloader` 폴더에서 읽기 전용 FFprobe를 실행했다. 원본 파일은 수정하지 않았다.

| 파일 | FFprobe 결과 | 판단 |
|---|---|---|
| `download.mp4` | VP9 video 1개, 1920×1080, 1563.833초, audio 0개 | 소리 재생 설정 문제가 아니라 파일에 음성 트랙 자체가 없음 |
| `Stream Downloader Fixtures.mp4` | H.264 video + AAC audio, 8.000초 | 로컬 기본 fixture의 음성 저장은 정상 |

재현 명령:

```powershell
& 'C:\Program Files\DownloadHelper CoApp\ffprobe.exe' -v error -show_entries stream=index,codec_type,codec_name,width,height,duration:format=duration,size -of json 'C:\Users\Acrob\Downloads\PersonalStreamDownloader\download.mp4'
```

사용자가 선택한 원본 HLS URL은 확보하지 않았으므로 해당 YouTube 후보가 왜 영상 전용이었는지까지 단정하지 않는다. 이전 명령은 입력의 모든 stream을 매핑했으나 입력/출력 audio 존재를 확인하지 않았다. 영상 전용 HLS child를 선택하면 정상 종료 코드만으로 무음 파일을 완료 처리할 수 있었고, 같은 실패를 로컬 fixture로 재현했다.

### 결함 및 수정

| 심각도 | 결함 / 수정 전 결과 | 수정 | 수정 후 |
|---|---|---|---|
| HIGH | 영상 전용 입력을 경고 없이 완료 처리 | 비동기 입력 FFprobe 및 기본 audio 검증. `allowVideoOnly=true`로 명시 허용한 경우에만 무음 저장. 출력에도 예상 stream이 있어야 rename | 영상 전용 child 기본 실패, final 파일 없음; 명시 허용은 경고와 함께 성공 |
| MEDIUM | 자연 VOD 길이를 진행률 계산에 전달하지 않고 녹화 제한만 사용 | 원본 길이와 `-t` 제한을 분리하고 알려진 최소 길이로 percent/ETA 계산 | 8초 VOD와 제한 live에 실제 percent/ETA; 무제한 live에는 가짜 percent/ETA 없음 |
| MEDIUM | 여러 rendition을 모두 복사하고 popup에서 audio 개수를 확인하기 어려움 | 연결된 HLS program의 영상·음성 선택, Probe 가독성 개선, `MASTER 추정` 표기 | 분리 A/V master 결과 video+audio 및 decode 정상 |
| MEDIUM | 새 preflight 단계의 PID 없는 취소에서 `int(None)` 발생 | PID 부재 안전 처리, lock 안의 terminal 상태 확인 | 취소 회귀 테스트 PASS |

popup은 확인·다운로드·결과 검증 단계를 구분하고, 진행률·저장량·처리 영상 시간·배속·ETA를 표시한다. FFmpeg `progress=end`만으로 완료나 100%를 표시하지 않는다. 원본 길이가 불명확하면 불확정 진행 막대와 설명을 표시한다. 무음 오류와 Probe의 음성 트랙 개수는 접힌 기술 상세 밖에서 확인할 수 있다.

### 자동 검증 결과

| 검사 | 상태 | 근거 |
|---|---|---|
| 확장 전체 테스트 | PASS | 58/58, FAIL 0, skip 0 |
| TypeScript 및 확장 빌드 | PASS | `tsc --noEmit`, `node build.mjs`, exit 0; manifest 0.1.1 |
| Native 전체 소스 테스트 | PASS | unittest 34/34, skip 0; 25.701초 |
| 실제 FFmpeg 소스 Host E2E | PASS | 6/6, skip 0; 24.945초 |
| PyInstaller 실행파일 빌드 | PASS | `native-host/dist/0.1.1/stream_host.exe` 생성; 기존 실행파일 유지 |
| 새 실행파일의 실제 FFmpeg E2E | PASS | 6/6, skip 0; 30.450초 |
| 새 실행파일 health/framing | PASS | 명시적 settings 경로로 hostVersion 0.1.1, ffmpegAvailable true; stdout framing 외 데이터 없음, stderr 없음 |
| 새 버전 실제 Chrome popup/YouTube 재다운로드 | NOT RUN | 이번 수정은 소스/실행파일과 로컬 fixture에서 검증. Chrome 확장 새로고침 및 실제 사이트 후보 선택이 필요 |

실제 출력 검증 fixture 7종: direct MP4, HLS TS, HLS fMP4, 분리 A/V HLS master, DASH, 분리 A/V DASH, 시간 제한 live. 각각 결과 video/audio, 길이 오차 ≤1초, `ffmpeg -v error -i OUTPUT -f null -` exit 0 및 stderr 없음, 완료 후 partial 없음 확인. 추가로 무음 child의 기본 차단/명시 허용, 무제한 live의 정직한 진행 표시, 인증·DRM·redaction, Host 단절 후 복구·취소·orphan 없음·partial 정책을 검증했다.

주요 변경 파일: `extension/src/popup/*`, `extension/src/background/service-worker.ts`, `extension/src/shared/messages.ts`, 관련 extension 테스트, `native-host/src/stream_host/{jobs,progress,ffprobe,ffmpeg_commands,models,__main__}.py`, `native-host/tests/test_media_jobs.py`, `test_acceptance_e2e.py`, `scripts/generate-fixtures.ps1`, `fixtures/player/index.html`, 버전 파일 및 문서.

### 적용 상태와 제한

등록된 기존 Host 실행파일은 실행 중이므로 덮어쓰거나 종료하지 않았다. 새 0.1.1 실행파일은 별도 경로에 준비되어 있으며, 등록 경로 갱신은 사용자 선택 대기 상태다. 원래 EXE를 보존하므로 등록 경로를 되돌려 rollback할 수 있다. 현재 상태는 **자동 검증 완료(실제 Native EXE + FFmpeg 로컬 E2E 포함)**이며, Chrome 전체 acceptance 또는 실제 YouTube 다운로드 검증 완료가 아니다. 무음으로 이미 저장된 파일에서 없는 음성을 복원하지 않으며, 별도 임의 음성 URL을 추측해 합치지 않는다.

## 12. Probe 길이 전달 및 설치 버전 불일치 수정 — 0.1.2, 2026-10-05

### 실제 원인

수동 Probe 후에도 전체 길이가 없다고 표시된다는 사용자 보고를 조사했다. 등록 manifest는 여전히 `native-host/dist/stream_host.exe`를 가리켰고, 그 실행파일의 격리된 Native Messaging health 응답은 **hostVersion 0.1.0**이었다. extension과 Python 소스만 0.1.1이었다. 실제 저장된 기존 작업 3개에는 처리 시간은 있지만 전체 길이·Probe·percent/ETA 필드가 없었다. 이것은 구버전 등록의 근거이며, 현재 Chrome Port의 프로세스를 직접 검사한 결과로 표현하지 않는다.

추가로 service worker는 수동 Probe 결과를 popup에 반환하기만 했고 Download에 재사용하지 않았다. FFprobe 요약은 format.duration만 읽었으며, popup 역시 중첩 Probe의 길이를 fallback으로 쓰지 않았다. 따라서 기존의 '전체 길이를 알 수 없다'는 안내만으로 원본이 실제 길이 불명이라고 결론 내릴 수 없었다.

### 결함 및 수정

| 심각도 | 결함 | 수정 파일 / 조치 |
|---|---|---|
| HIGH | 등록된 0.1.0 Host와 새 extension 혼용으로 진행률·음성 검증 개선이 실제 실행되지 않음 | 버전 0.1.2 별도 EXE, popup Host 버전/구버전 경고. 사용자 승인 후 테스트한 경로로 등록 갱신 |
| MEDIUM | 수동 Probe 길이가 Download에 연결되지 않음 | `background/probe-duration-cache.ts`, `service-worker.ts`, `shared/messages.ts`: 동일 후보·URL·요청 컨텍스트의 검증된 숫자 길이만 캐시/전달; 작업 저장·복구에도 보존 |
| MEDIUM | format.duration이 없으면 stream 길이가 있어도 누락 | Native `ffprobe.py`: 선택된 영상/음성의 duration, duration_ts/time_base, 제한된 DURATION 태그 fallback |
| MEDIUM | 길이 미확인과 live를 혼동하거나 live window를 전체 길이로 오인할 가능성 | Native `__main__.py`, `ffprobe.py`, `jobs.py`, `models.py`: manifest 명시 판정과 `liveConfirmed`, 출처 `durationSource`; 확인된 live에서는 window/힌트를 버림 |
| MEDIUM | Host가 percent/ETA를 생략하면 Probe가 있어도 UI에서 활용하지 않음 | `popup/presentation.ts`, `popup.ts`: 전체 길이/출처 표시, 유효한 처리 시간·배속 기반 fallback, metadata 대기/확인 실패/live 안내 구분 |

길이 힌트는 FFmpeg `-t` 제한과 별개다. 새 Host는 최신 입력 FFprobe 결과를 우선하고, DRM·영상/음성 검사도 계속 수행한다. 캐시에는 SHA-256 digest·길이·확인 시각만 저장하며 URL, Cookie, Authorization을 저장하지 않는다. URL·세션 opt-in·실제 Cookie·Origin·Referer·User-Agent가 달라지면 다른 cache key가 된다. 만료는 10분, 최대 100개다.

### 시험 재현 명령

```powershell
# extension 디렉터리
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node build.mjs

# 저장소 루트: 소스 전체
$env:PYTHONPATH='native-host/src'
& .\native-host\.venv\Scripts\python.exe -m unittest discover -s native-host/tests -v

# native-host 디렉터리: 별도 EXE 빌드
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath dist/0.1.2 --workpath build/0.1.2 stream_host.spec

# 저장소 루트: 빌드 EXE + 실제 FFmpeg
$env:PSD_TEST_HOST_EXE=(Resolve-Path '.\native-host\dist\0.1.2\stream_host.exe').Path
& .\native-host\.venv\Scripts\python.exe -m unittest discover -s native-host/tests -p test_acceptance_e2e.py -v
```

### 실행 중 발견한 FAIL 기록

| 재현 | 기대 | 실제 / 원인 | 수정 및 재시험 |
|---|---|---|---|
| extension의 `tsc --noEmit` | 타입 검사 성공 | `presentation.ts` 버전 분해의 patch가 undefined일 수 있다는 TS18048 | 구조 분해 기본값 추가, 재시험 exit 0 |
| extension 전체 Node 시험 | 새 최소 Host 버전 0.1.2와 UI 경고 기준 일치 | 기존 시험은 0.1.1을 최신으로 기대하여 73 PASS / 1 FAIL | 0.1.1 경고를 명시적으로 검사하고 0.1.2 이상에서 경고 없음 검사. 재시험 74/74 PASS, skip 0 |
| EXE 전체 E2E의 `test_port_disconnect_recovery_cancel_and_partial_policy` | 실행 중 keepPartial 작업 취소 accepted=true | 최초 EXE 실행에서 accepted=false, 나머지 6개 PASS. 시험이 running snapshot 확인 뒤 3.5초 대기하고 오래된 상태로 취소하여, 실제 취소 시점의 실행 상태를 보장하지 않았음. 최초 실패의 terminal 상태는 기록되지 않아 완료됐다고 단정하지 않음 | `test_acceptance_e2e.py`: 실제 running PID와 nonempty partial 확인 즉시 취소. accepted, PID 종료, cancelled registry, nonempty 보존 partial 모두 검사. 수정 전 단독 재현 1/1 PASS, 수정 후 단독 1/1 PASS 및 전체 EXE 7/7 PASS; skip/조건 완화 없음 |

### 최종 자동 검증 결과

| 검사 | 상태 | 결과 |
|---|---|---|
| 확장 전체 테스트 | PASS | 75/75, FAIL 0, skip 0. 캐시 identity/만료/live/보안, 실제 worker 전달·복구, popup 표시·새 이벤트 우선, 기존 MP4/HLS/DASH·blob·오류 회귀 포함 |
| TypeScript 검사 | PASS | `tsc --noEmit` exit 0 |
| 확장 빌드 | PASS | `node build.mjs` exit 0, `extension/dist` 0.1.2 |
| Native 전체 소스 테스트 | PASS | 52/52, skip 0, 22.470초 |
| PyInstaller 빌드 | PASS | `native-host/dist/0.1.2/stream_host.exe`, 10,085,731 bytes |
| 빌드 EXE + 실제 FFmpeg E2E | PASS | 7/7, skip 0, 28.594초. 최초 실패 기록은 위 표에 별도 보존 |
| EXE health/framing | PASS | hostVersion 0.1.2, ffmpegAvailable true, stderr 없음, exit 0 |
| 취소 후 프로세스 검사 | PASS | 해당 FFmpeg PID 종료 직접 확인; 전체 시험 종료 후 Get-Process ffmpeg 0개 / ffprobe 0개 |
| Chrome Native Host 등록 경로 | PASS | 사용자 승인 후 0.1.2로 갱신, 실제 HKCU/manifest 경로 및 기존 단일 extension origin 일치 검증 |
| 새 버전 Chrome popup / 실제 사이트 재다운로드 | NOT RUN | 확장 재로드 후 실제 UI 확인 필요. Native 시험을 Chrome UI 시험으로 대체하지 않음 |

실제 파일 검사: MP4, HLS TS/fMP4/분리 A/V master, DASH/분리 A/V DASH, 제한 live의 결과 영상·음성 존재, 원본/제한 대비 duration 허용 오차 ≤1초, FFmpeg null decode exit 0 및 stderr 없음, 성공 후 partial 없음. 새 회귀는 **8초 원본에 3초 Probe 힌트를 전달해도 8초 영상·음성이 유지됨**을 확인했다. 명시 확인된 무제한 live에는 오래된 힌트를 보내도 percent/ETA가 생기지 않았으며, 제한 live는 지정한 길이 출처를 유지했다. Probe 결과와 작업 이벤트·저장 registry·list_jobs의 길이/출처도 대조했다.

### 등록 갱신과 적용 단계

이 절은 11절의 '등록 대기' 상태를 대체한다. 사용자의 **등록 경로도 새 버전으로 갱신** 승인을 받아 다음 명령을 실행했다.

```powershell
.\scripts\install-host.ps1 -ExtensionId jpahdpgemdlibedhcodgolicnaieomoh -ExecutablePath '.\native-host\dist\0.1.2\stream_host.exe'
```

- 실제 manifest: `C:\Users\Acrob\AppData\Local\PersonalStreamDownloader\com.personal.stream_downloader.json`
- 실제 등록 EXE: `C:\Users\Acrob\MATLAB Drive\2026_Works\BasicDownloader\native-host\dist\0.1.2\stream_host.exe`
- SHA-256: `62E61043C8AF1D9CC1787F6E4B169BAEF600630C00DD515C70FA9292D86D84C0`
- 이전 manifest 백업: `native-host/dist/0.1.2/previous-host-manifest.json`; 이전 EXE도 원래 경로에 유지했다.
- FFmpeg 설정, 기존 다운로드 파일, 실행 중인 사용자 Host/작업은 변경하거나 종료하지 않았다. 등록 변경만으로 기존 연결이 새 EXE로 교체되지는 않는다.

남은 최소 수동 단계: 진행 중인 작업이 끝난 뒤 `chrome://extensions`에서 Personal Stream Downloader를 새로고침하고 영상 페이지도 새로고침한다. popup 상단의 **Host v0.1.2 · FFmpeg 정상**을 확인한다. 동일 HTTP(S) 후보에서 Probe 길이를 확인하고 Download를 시작하면 전체 길이와 출처, 첫 진행/속도 표본 이후 진행률·예상 남은 시간이 나와야 한다. 종료 없는 live는 남은 시간을 만들지 않아야 한다.

이번 변경의 Chrome popup 실제 조작/실제 사이트 재다운로드는 **NOT RUN**이다. 앞서 Chrome 내부 extension URL 접근이 브라우저 도구에서 거부되었으며, 이를 다른 경로로 우회하지 않았다. Native EXE + FFmpeg 결과를 Chrome 전체 E2E PASS로 취급하지 않는다. 현재 상태는 **자동 검증 완료(실제 Native EXE + FFmpeg 검증 포함)**이며 전체 Chrome 로컬 E2E/실제 사이트 검증 완료는 아니다. 메타데이터 없는 원본은 여전히 전체 길이를 모를 수 있고, HLS master 자체로 live 여부를 단정하지 않는 한계가 남는다.

## 13. 다운로드 관리자 편의 기능 — 0.2.0, 2026-10-05

사용자가 제목 자동완성, 썸네일, 완료 파일 재생/탐색, 목록 토글/정리, 팝업/사이드바, 우클릭 및 추가 편의 기능을 전체 구현하도록 요청했다.

### 구현 범위

- 제목 자동완성 체크박스, 수동 수정 보호, `{title}`/`{quality}`/`{date}` 파일명 템플릿.
- 후보·기록 썸네일과 출처 구분, 안전한 기본 이미지. 영상 poster/메타 제목 우선, 페이지 대표 이미지 fallback.
- Probe로 확인한 선택 스트림의 해상도·영상/음성·길이 배지. 연결되지 않은 별도 HLS 오디오를 '음성 포함'으로 표시하지 않음.
- 같은 페이지 후보 묶기/펼치기. 동일 영상이라고 검증하지 않은 rendition을 임의로 합치지 않음.
- 읽기 전용 진행률, jobId 기반 행 재사용, 선택/포커스/상세 펼침 유지.
- 완료 파일 재생(Windows 기본 앱), Explorer에서 파일 선택, 경로 복사. Host 재시작 뒤 registry에서도 정확한 경로 복구.
- 목록 접기, 상태 필터, 다중 선택 제거, 완료 목록 비우기. **기록만 제거하고 영상/partial 파일은 유지**, active 작업은 보호.
- 목록 우클릭/명령 버튼/키보드 메뉴, 웹페이지 우클릭에서 관리자 열기. 자동 다운로드/자동 Cookie 전달 없음.
- 팝업/사이드바 선택 및 기본 보기 저장, 사이드바 활성 탭 변경 대응.
- 완료 기록의 canonical URL digest 기반 중복 경고. 새 다운로드는 명시적 선택 후 시작.
- 선택형 완료/실패 알림, 기본 꺼짐. 알림에는 제목/URL을 넣지 않음.

### 자동 검증 결과

| 검사 | 상태 | 결과 |
|---|---|---|
| 확장 전체 테스트 | PASS | 106/106, FAIL 0, skip 0 |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| 확장 빌드 | PASS | `node build.mjs`, manifest 0.2.0, popup/sidepanel 공용 bundle 및 PNG 아이콘 생성 |
| Native 전체 소스 | PASS | 64/64, skip 0, 23.955초 |
| 0.2.0 EXE 실제 FFmpeg E2E | PASS | 8/8, skip 0, 32.355초 |
| ACK 메타데이터 보강 회귀 | PASS | 동일 EXE에서 displayTitle/sourceKey/제목 redaction 검사 1/1 |
| Native health/framing | PASS | hostVersion 0.2.0, FFmpeg 정상, stdout 응답 1개 외 출력 없음, stderr 없음 |
| 시험 종료 후 orphan 검사 | PASS | FFmpeg 0개, FFprobe 0개; 사용자 Host 강제 종료 없음 |
| Native 등록 갱신 | PASS | 실제 HKCU manifest와 0.2.0 EXE, 기존 extension origin 일치 확인 |
| Chrome popup/sidepanel/contextMenus/알림 실제 화면 | NOT RUN | DOM/API 회귀로만 검증. 기존 Chrome 내부 extension URL 도구 접근 제한을 우회하지 않음 |
| Windows 기본 플레이어·Explorer 실제 실행 | NOT RUN | OS 호출 인수/안전 조건은 mock 검증. 사용자 앱을 실제로 실행하지 않음 |

확장 전체 재현: `extension`에서 `node --experimental-strip-types --test tests/*.test.ts`. Native 소스: 저장소 루트에서 `PYTHONPATH=native-host/src`로 `.\native-host\.venv\Scripts\python.exe -m unittest discover -s native-host/tests -v`. EXE E2E: `PSD_TEST_HOST_EXE`를 `native-host/dist/0.2.0/stream_host.exe` 절대 경로로 지정하고 동일 unittest의 `-p test_acceptance_e2e.py` 실행.

실제 FFmpeg 시험은 기존 MP4/HLS/DASH 분리 영상/음성, duration, null decode, DRM, 인증, 취소·partial 정책을 유지한다. 새 history E2E는 실제 fixture를 저장하고 Host 재시작 후 제목/출처 digest 복구를 확인한다. 기록 제거 후 실제 미디어 바이트가 변하지 않고 두 번째 Host 재시작에도 제거 기록이 다시 나타나지 않음을 확인했다. 실제 사용자 파일/기록은 테스트에 사용하지 않았다.

### 발견·수정 사항

| 심각도 | 문제 / 재현 | 기대·원인·수정 후 결과 |
|---|---|---|
| MEDIUM | 과거 작업의 폴더 열기가 현재 Host 메모리만 조회 | 원래 저장 폴더를 열어야 하나 재시작 후 기본 폴더로 대체됨. `jobs.py`/`__main__.py`에서 UUID registry 기반 경로 조회·검증으로 수정; 단위/E2E PASS |
| MEDIUM | Probe 대기 중 후보 초기화/탭 닫기 후 늦은 upsert로 후보 복구 가능 | 지운 후보와 signed URL을 복구하면 안 됨. `CandidateStore.updateProbeSummary`는 기존 행의 안전한 숫자만 원자 갱신; 전용 회귀 PASS |
| MEDIUM | 기록 제거 뒤 늦은 progress/list snapshot으로 목록 재등장 가능 | `service-worker.ts`의 같은 mutation queue와 제거 tombstone으로 차단; 실제 worker 회귀 PASS |
| LOW | 새 실패 필터/제거 목록에서 unsupported_drm 누락, displayTitle 필드 불일치 | DRM 거부도 terminal 기록으로 정리, 저장된 제목 표시; helper/DOM 회귀 PASS |
| TEST | 중간 전체 시험 89 PASS / 1 FAIL: 기존 audio 오류 시험이 모든 textContent에서 raw 문구 부재를 기대 | 새 접힌 작업 상세에만 raw JSON이 존재하므로 textContent에도 포함됨. `popup-interactions.test.ts`를 사용자용 요약 유지 및 raw 상세의 접힘 상태까지 검사하도록 구체화. 최종 106/106 PASS, skip 없음 |

### 0.2.6 무음 실패 후 후보 탐색 계속 (2026-10-06)

사용자 제공 결과는 해당 HLS 후보가 VP9 1080×1080/303초/video index 0/audioStreams=[]임을 입증한다. 이것만으로 다른 후보에도 음성이 없다고 판단할 수 없다. 실제 사용자 페이지 전체 후보와 당시 옵션 상태는 재현하지 못했다. 코드에서 확인한 결함은 (1) 전체 검사도 오래된 음성 유무 summary를 재사용함, (2) 자동으로 선택한 후보가 다운로드 중 audio_stream_missing으로 실패하면 나머지 후보로 진행하지 않음, (3) 다운로드 중 Probe 결과를 후보 카드에 반영하지 않음이다.

전체 검사는 매번 실제 Probe를 수행하도록 변경했다. 자동 다운로드로 시작된 작업이 audio_stream_missing으로 실패할 때만 실패 ID를 누적 제외하여 나머지 전체 후보를 확인한다. 동일 작업의 중복 이벤트로 재시작하지 않으며 인증/네트워크/DRM 오류는 이 재탐색을 실행하지 않는다. 수동 다운로드는 동의 없이 다른 후보를 시작하지 않고 '음성 있는 다른 후보 모두 확인' 버튼을 제공한다. 탭/페이지 변경, 후보 초기화, 자동 다운로드 옵션 해제의 기존 중단 조건을 유지한다. 자동화 연속 실행 상태는 열린 UI 수명 범위다.

작업에 안전한 candidateId/tabId를 연결하여 job progress/failure의 Probe summary를 후보 카드에 반영한다. 늦은 응답으로 삭제한 후보를 재생성하지 않는다. 음성·화질을 확인한 카드에는 URL 기반 MASTER 추정 표시를 숨기고, 미확인 상태는 'manifest URL 추정 · 구성 미확인'으로 표시한다. 검색 결과에는 영상+음성/영상만/음성만/검사 실패 개수를 구분한다. 음성만 존재하는 별도 후보를 임의로 다른 영상 후보에 합치지 않는다.

검사: TypeScript PASS, 확장 빌드 PASS(0.2.6), 전체 테스트 132/132 PASS, FAIL 0/skip 0. 추가 회귀는 오래된 positive/negative summary 재검사, 자동 무음 실패→두 번째 AV 후보 선택, 실패 후보 제외, 중복 이벤트 중복 다운로드 차단, 네트워크 오류 무재시도, 수동 작업 자동 전환 금지, worker 다운로드 Probe→후보 갱신이다. 테스트는 실제 extension bundle/mock Native Port 기반이다. 사용자 사이트의 Chrome 실행 및 실제 FFmpeg 재시험은 NOT RUN이며 Host 0.2.2는 변경하지 않았다.

적용 확인: 진행 중 작업 종료 후 확장 새로고침, 0.2.6 확인. 사이드바에서 전체 후보 Probe를 켜고 실행한다. 자동 다운로드를 켠 경우 무음 실패 후보가 제외되고 다음 유음 후보로 이어지는지 확인한다. 검사 결과의 후보별 분류 수를 확인한다. 이 버전은 해상도 선택 UI 추가가 아니라 오디오 판별/계속 탐색 경로 수정이다.

### 0.2.5 전체 Probe / 적합 후보 1개 자동 다운로드 (2026-10-05)

요청 재해석: 사용자가 원하는 것은 첫 AV 성공에서 중단하는 검색이 아니라, 옵션을 켜면 Probe 한 번으로 모든 후보를 확인하는 것이다. `batchProbe`와 `downloadAfterProbe`를 팝업/사이드바 및 설정에 추가했다(기본 false). 개별 카드 Probe도 batchProbe=true이면 전체 검사로 연결된다. 전체 모드는 실행 시점의 현재 페이지 HTTP(S) 후보 전부를 순차 확인하며 기존 summary를 재사용한다. blob은 제외하고 광고 의심 후보는 검사하더라도 자동 선택에서 제외한다. 첫 성공 이후도 계속하여 검증된 AV 후보 중 해상도/기존 우선순위로 1개를 선택한다. 기존 검색 모드의 20개 제한은 전체 모드에 적용하지 않는다.

downloadAfterProbe=true이면 선택 카드의 정상 start 경로로 1개만 요청한다. 쿠키 미포함, 음성 추출/무음 허용 해제 상태의 영상+음성 다운로드이며 파일명/컨테이너/시작 전 Probe 선택은 유지한다. 중복 확인은 우회하지 않는다. 적합 후보 없음, 후보 초기화, 탭/페이지 변경, 옵션 해제 시 자동 시작을 막는다. 팝업이 닫히면 검사 결과는 worker에서 보강될 수 있으나 자동 시작은 수행되지 않는다. 자동 시작을 원하면 검사 완료까지 사이드바/팝업을 유지해야 한다. 시작된 Native 작업의 수명주기는 기존과 동일하다.

새로고침 감사: popup refresh는 list_candidates/list_jobs/health만 요청하며 clear_candidates는 별도 후보 초기화 버튼에서만 실행한다. 일반 새로고침으로 기존 HTTP(S) 후보를 삭제하는 경로는 발견하지 못했다. blob-only snapshot은 네트워크 원본 요청이 관측되지 않은 상태일 수 있으며 목록 새로고침으로 해당 요청을 재현할 수 없다. 이를 UI에 설명한다. 실제 사용자 브라우저의 당시 원인은 재현하지 않았으므로 단정하지 않는다.

검사: TypeScript PASS, 확장 빌드 PASS(0.2.5), 전체 확장 테스트 129/129 PASS, FAIL 0/skip 0. 전체 25개 순회 및 마지막 고화질 선택, 자동 다운로드 on/off/일치 없음/후보 초기화/중복 확인, 설정 저장, 새로고침 후보 보존 회귀 포함. 실제 Chrome 새 UI는 NOT RUN. Native/FFmpeg는 변경하지 않았고 이번 버전에서 재실행하지 않았다. Host 0.2.2 등록은 유지했다.

### 0.2.4 영상+음성 후보 찾기 / 음성 전용 저장 (2026-10-05)

확장 0.2.4 / Host 0.2.2. '영상+음성 후보 찾기'는 현재 페이지 후보 중 blob/광고 의심을 제외하고 최대 20개까지 쿠키 없이 순차 확인한다. 기존 summary를 재사용하고 첫 linked 영상+음성 결과에서 멈춘다. 해당 카드를 대표로 올리고 파일명 옵션을 열지만 다운로드는 자동 시작하지 않는다. 오류는 실패 개수에 포함하고 다음 후보를 검사한다. 페이지/탭이 바뀌면 늦은 UI 응답은 적용하지 않는다. 탭별 중복 검색은 worker에서 하나로 합친다.

음성만 저장은 audioOnly strict boolean(default false), 기존 무음 허용과 상호 배타적이다. Probe 사용 시 선택된 음성 1개만 매핑하며, Probe 생략 시 첫 음성 트랙을 매핑한다. `-vn`/stream copy로 영상 없이 MP4/MKV에 저장한다(MP3 변환 아님). 출력 FFprobe로 음성 존재·영상 부재를 확인한다. 기존 DRM/partial/fallback/취소 검증과 시작 전 Probe 선택은 유지했다. 지원하지 않는 Host에는 UI와 worker 모두 요청을 차단한다.

| 검사 | 결과 | 근거 |
|---|---|---|
| TypeScript / 확장 빌드 | PASS | tsc --noEmit / node build.mjs exit 0 |
| 확장 전체 | PASS | 124/124, FAIL 0, skip 0; 실제 popup/worker bundle 및 순차 검색 helper 검사 |
| Native 전체 | PASS | 75/75, 27.557초 |
| 최종 EXE 실제 FFmpeg E2E | PASS | 10/10, 40.718초 |
| 음성 전용 MP4/HLS/DASH | PASS | 입력 Probe 켬/끔 6조합; 출력 audio만 존재, duration 8초±1초, null decode exit 0/stderr 없음, partial 없음 |
| 등록 / orphan 검사 | PASS | 기존 manifest 백업 후 Host 0.2.2 등록; 종료 후 FFmpeg/FFprobe 0개 |
| 실제 Chrome 새 UI | NOT RUN | synthetic DOM/API 검증이며 실브라우저 클릭 검증 아님 |

중간 실패(MEDIUM): `PYTHONPATH=native-host/src`에서 `.\native-host\.venv\Scripts\python.exe -m unittest discover -s native-host/tests -v` 실행 시 history restart/removal 시험에 FAIL 1 및 ERROR 1 발생. 기대는 활성 작업 기록의 정상 갱신/취소, 실제는 `job_registry.py`의 os.replace에서 WinError 5로 실패하여 stderr traceback 발생. Windows의 일시적 파일 접근 충돌에 대한 재시도가 없었다. `job_registry.py`에 WinError 5/32만 최대 10회 제한 재시도를 추가했다. 원자적 replace는 유지하며 영구 오류는 계속 실패하고 기존 기록은 보존한다. `test_registry_retry.py`로 일시/영구 실패를 재현 검증했다. 수정 후 전체 75/75 및 최종 EXE 10/10 PASS, skip 전환 없음.

등록 EXE: `native-host/dist/0.2.2/stream_host.exe`, SHA256 `3E26B1C50ABF086C5E389346668DCC2BD6C1F1010BE7CE8D43B4103444122D5B`. 기존 등록 백업: 같은 폴더 `previous-host-manifest.json`. 사용자 파일·설정·실행 중 Host는 강제 변경/종료하지 않았다. 진행 중 작업 종료 후 확장 새로고침 및 영상 페이지 재생으로 적용한다.

제한: AV 검색은 최대 20개/첫 성공 기준이지 사이트 전체 최고 화질 보장이 아니다. 로그인 쿠키가 필요한 후보는 개별 세션 opt-in Probe를 사용한다. 음성 전용 파일은 MP4/MKV 컨테이너로 저장하며 새 MP3/AAC 인코딩은 하지 않는다.

### 0.2.3 시작 전 Probe 선택 (2026-10-05)

확장 0.2.3 / Host 0.2.1. 후보 카드에 시작 전 Probe 체크(기본 true)를 추가했다. false는 원격 입력 FFprobe만 생략하며 수동 Probe/탐지 자동 Probe와 독립적이다. FFmpeg는 기본 첫 영상/음성 스트림을 저장하므로 고화질 선택은 보장하지 않는다. 검증된 길이 힌트가 없으면 ETA를 만들지 않는다. manifest DRM 검사와 최종 출력 FFprobe는 유지하고, 영상만 있는 출력은 무음 허용 없이는 실패 처리한다. 구형 Host는 UI에서 선택 불가이며 worker도 capability 확인 실패 시 요청을 거부한다. Native 필드는 strict boolean이다.

| 검사 | 결과 | 근거 |
|---|---|---|
| TypeScript / 확장 빌드 | PASS | tsc --noEmit / node build.mjs exit 0 |
| 확장 전체 | PASS | 120/120, FAIL 0, skip 0 |
| Native 전체 소스 | PASS | 69/69, 25.083초 |
| 최종 Host EXE 실제 FFmpeg | PASS | 9/9, 35.487초 |
| Probe 생략 MP4/HLS/DASH | PASS | 실제 파일 영상+음성, duration 8초±1초, FFmpeg null decode exit 0/stderr 비어 있음, partial 없음 |
| 입력/출력 Probe 분리 | PASS | 단위 테스트에서 원격 Probe 호출 없음, 로컬 출력 Probe 1회, DRM·무음 차단 유지 |
| orphan FFmpeg/FFprobe | PASS | 종료 후 Get-Process 결과 없음 |
| Host 등록 | PASS | 이전 manifest를 0.2.1/previous-host-manifest.json에 백업 후 기존 extension origin으로 새 EXE 등록 |
| 실제 Chrome 체크박스 | NOT RUN | popup bundle synthetic DOM 확인이며 실브라우저 UI 재검증은 아님 |

EXE: `native-host/dist/0.2.1/stream_host.exe`, SHA256 `21D1B497E5E0EB4D298B9357C0AF5318B681A7539909F959E3CAF52A8C23397C`. 기존 Host 0.2.0 바이너리와 다운로드/설정은 보존하고 실행 중 프로세스를 강제 종료하지 않았다. 진행 중 작업 종료 후 확장 새로고침으로 새 Host에 연결한다. 재현 명령은 기존 전체 테스트 명령과 동일하며 EXE 검증에는 PSD_TEST_HOST_EXE를 이 경로로 지정한다.

### 0.2.2 제목·썸네일 연결과 후보 표시 (2026-10-05)

원인: content script의 performance fallback은 확장자가 있는 URL만 수집했다. MIME으로만 탐지한 `/api/manifest/...` 후보에는 pageTitle/mediaTitle/thumbnail이 전달되지 않아 제목 체크박스가 정상 작동해도 결과가 `download`였다. NetworkObserver는 이제 탭 제목을 보강하며, content script는 후보 목록이 비어 있어도 페이지 메타데이터를 보낸다. CandidateStore가 같은 페이지/미지정 페이지의 후보에만 메타데이터를 연결하고 video-specific 정보는 보존한다. SPA 이전 페이지 후보를 새 제목으로 덮어쓰지 않는 회귀를 추가했다.

설정 최상단에 기본 파일명(default `download`)과 탐지 시 자동 Probe(default off)를 추가했다. 제목 체크 해제/제목 누락 시 기본 이름을 사용하며 이미 저장한 파일은 변경하지 않는다. 자동 Probe는 service worker의 순차 큐에서 실행하고 쿠키 미포함, blob/광고 의심/이미 확인한 후보 제외, 실패 자동 반복 없음, 대기 최대 100건으로 제한한다. worker 재시작 시 실패 시도 기억은 초기화되지만 성공한 probeSummary는 유지된다. 사용자가 자동 확인을 끄면 대기 요청을 건너뛰며 이미 시작된 요청은 완료될 수 있다.

같은 페이지 그룹은 대표 후보 하나만 기본 표시한다. HTTP(S), 광고 비의심, 확인된 영상+음성, 해상도, 기존 confidence 순으로 정렬한다. 이는 같은 영상임을 보장하지 않으며 다른 후보 토글과 수동 선택을 유지한다. 썸네일은 poster/OG/Twitter/itemprop thumbnailUrl에서 안전한 HTTP(S) URL만 사용한다. query/fragment 포함 이미지 거부, anonymous CORS/no-referrer 정책은 유지한다. 이미지 부재/CORS 거부는 아이콘으로 남는다.

세션 안내를 '미디어 주소의 로그인 쿠키 포함 (선택)'으로 구체화했다. 현재 구현은 chrome.cookies.getAll({url:downloadUrl})에 해당하는 쿠키만 전달하며 Authorization을 임의 수집하지 않는다. Referer는 쿠키 선택과 별개다.

| 검사 | 결과 | 근거 |
|---|---|---|
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| 확장 전체 테스트 | PASS | `node --experimental-strip-types --test tests/*.test.ts`, 118/118, FAIL 0, skip 0 |
| 제목→파일명→Download 전달 | PASS | 실제 popup bundle synthetic DOM 회귀 |
| MIME 후보 메타데이터/자동 Probe | PASS | 실제 worker bundle + mock Native Port; 쿠키 부재·Referer·Probe summary 검증 |
| 설정 UI 저장/로드 | PASS | 실제 options bundle synthetic DOM; 기본 이름·autoProbe 저장 검증 |
| 배포 빌드 | PASS | `node build.mjs`, extension/dist 0.2.2 |
| 실제 Chrome/YouTube 수정 후 | NOT RUN | 이번 검사는 mock DOM/API 기반이며 실사이트 재검증 아님 |
| 실제 FFmpeg 재시험 | NOT RUN | Host/FFmpeg 코드는 변경하지 않음; 이번 버전에서는 재실행하지 않음 |

중간 FAIL: 전체 테스트 명령에서 새 AutoProbeQueue의 TS parameter property가 Node strip-only 모드에 지원되지 않아 테스트 파일 로드 실패(115 PASS/1 FAIL). 기대는 전체 실행, 실제는 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. `auto-probe.ts`를 명시적 필드/생성자 할당으로 수정했고 최종 118/118 PASS로 재시험했다. skip 전환 없음.

적용: 진행 중 다운로드 종료 후 chrome://extensions에서 확장 새로고침, 버전 0.2.2 확인. 영상 페이지도 새로고침하여 새 content script를 주입하고 재생한다. 제목 자동완성 체크 시 파일명 입력값이 실제 제목으로 바뀌는지 확인한다. 설정 맨 위에서 기본 이름을 변경하고 제목 체크를 끄면 그 이름을 사용해야 한다. 자동 Probe를 켠 뒤 페이지를 재생하면 음성·화질 배지가 갱신되어야 하며 다운로드는 자동 시작하지 않아야 한다. 대표 1개와 나머지 토글, 썸네일 또는 안전한 기본 아이콘을 확인한다. Host 재등록 불필요. 기존 파일·기록·FFmpeg 경로는 보존했다.

추가 검토: 페이지 대표 제목/이미지가 플레이리스트의 실제 영상과 다른 경우가 남는다. 이를 확정된 video-specific 정보로 표시하지 않는다. 유료 다운로더와의 비교 성능·지원 사이트 범위는 검증하지 않았다.

### 0.2.1 팝업 크기 수정 (2026-10-05)

- 사용자 Chrome 캡처에서 팝업이 약 210px로 좁아지고 버튼 글자가 세로로 줄바꿈되는 현상 확인. 소스의 body `max-width:100vw`가 자동 크기 계산 시 초기 viewport 폭으로 내용을 제한할 수 있었다.
- 팝업 전용 html 크기를 720×600 CSS px로 명시하고 body의 viewport 최대 폭 제한을 해제했다. 내용은 세로 스크롤한다. 사이드바는 html/body 모두 별도 모드로 지정하여 가변 폭을 유지한다. 버튼은 글자 단위 대신 버튼 단위로 줄을 바꾼다.
- 수정: `extension/src/popup/popup.css`, `popup.ts`, `extension/public/manifest.json`(확장만 0.2.1), `extension/tests/popup-interactions.test.ts`, `popup-layout.test.ts`. Native Host 0.2.0과 다운로드 파일은 변경하지 않았다.

| 검사 | 결과 | 근거 |
|---|---|---|
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| 확장 전체 회귀 | PASS | `node --experimental-strip-types --test tests/*.test.ts`, 110/110, FAIL 0, skip 0 |
| 배포 빌드 | PASS | `node build.mjs`, exit 0, extension/dist 재생성 |
| 실제 Chrome 수정 후 크기 | NOT RUN | CSS 계약 및 synthetic DOM 검사이며 실제 브라우저 픽셀 검증은 아님 |

적용 확인: 진행 중 작업이 끝난 뒤 `chrome://extensions`에서 Personal Stream Downloader를 새로고침하고 버전 0.2.1 확인 → 툴바 팝업 다시 열기. 약 720px 폭으로 표시되고 재생/폴더 선택 버튼이 세로 글자로 깨지지 않아야 한다. 사이드바로 전환하면 가용 폭에 맞춰야 한다. 화면 배율에 따라 실제 물리 픽셀 크기는 다를 수 있다. Host 재등록은 필요하지 않다.

### 적용 및 제한

등록된 EXE는 `C:\Users\Acrob\MATLAB Drive\2026_Works\BasicDownloader\native-host\dist\0.2.0\stream_host.exe`다. SHA-256: `BB5BBAEFED1C6A8474ED55729C8EAFFFDA8AD9981F8EA932BBE4BB123E416092`. 이전 등록은 같은 0.2.0 폴더의 `previous-host-manifest.json`에 백업했고 이전 EXE는 보존했다. 다운로드 파일·FFmpeg 설정·실행 중 작업은 변경하지 않았다. 새 UI 권한은 sidePanel/contextMenus/notifications이며 minimum Chrome은 127이다.

수동 적용: 진행 중인 다운로드가 끝나면 `chrome://extensions`에서 확장을 새로고침하고 영상 페이지도 새로고침한다. 상단 Host v0.2.0 확인 → 제목 체크/썸네일 → 완료 목록 재생/폴더 선택 → 사이드바 전환과 페이지 우클릭 순서로 확인한다. 자세한 기대 결과는 MANUAL_TEST.md의 0.2.0 절에 기록했다.

제한: query를 가진 이미지나 CORS 거부 이미지는 기본 표시로 대체한다. 과거 기록은 제목/썸네일 정보가 없을 수 있고 썸네일은 브라우저 session 보존 범위다. 중복 경고는 정확한 canonical URL 기반이라 토큰이 바뀐 동일 영상을 항상 알아내지는 못한다. 현재 UI는 최근 100개 작업을 다룬다. 실제 파일 삭제·임의 오디오 합치기·내장 플레이어·일시정지/이어받기는 이번 범위에 포함하지 않는다. 현재 상태는 **자동 검증 완료(실제 Native EXE + FFmpeg E2E 포함)**이며 전체 Chrome/Windows UI acceptance 완료라고 표현하지 않는다.
# YouTube 재수집과 SABR 진단 0.2.7

2026-10-06 실제 테스트 Chrome의 열린 YouTube 일반 영상에서 blob 재생을 관측했다. 브라우저 리소스는 Googlevideo `/videoplayback` POST 요청이며 응답 MIME은 `application/vnd.yt-ump`였다. 현재 player response에는 `serverAbrStreamingUrl`만 있었고 HLS/DASH manifest와 adaptive 형식의 직접 URL은 없었다. Premium 미가입이 원인이라는 증거는 확보하지 않았다. Shorts의 동일 현상은 사용자 보고이며 실제 Shorts 검사는 NOT RUN이다.

수정 파일: `extension/src/background/page-media-scan.ts`, `service-worker.ts`, `network-observer.ts`, `extension/src/shared/url-utils.ts`, `extension/src/content/media-observer.ts`, `extension/src/popup/popup.ts`, `extension/public/manifest.json` 및 해당 회귀 검사.

- 새로고침에서 MAIN world의 현재 재생 요소·일반 페이지 resource 목록을 재수집한다. YouTube는 SPA의 이전 resource를 새 영상에 연결하지 않고 현재 video ID와 일치하는 player response가 제공한 manifest/직접 URL만 읽는다. 서명 해독이나 새 endpoint 생성은 하지 않는다.
- GET 미디어는 응답 헤더 단계에서 탐지하고 완료 이벤트에서 중복 등록하지 않는다. POST UMP는 다운로드 후보로 승격하지 않는다.
- 확장자 없는 Googlevideo의 명시적 MIME 힌트와 audio/webm을 식별하되 range/sq 조각을 독립 파일로 취급하지 않는다.
- SABR-only 원인을 UI에 표시하고 blob 버튼 비활성화를 유지한다. 후보 storage 변경이 안내를 덮어쓰던 실제 UI 결함도 수정했다.
- signed path와 추가 Google query 인증 값을 storage/UI에서 가린다. 실제 원문은 기존 in-memory 정책으로 유지한다.

| 검사 | 결과 | 근거와 한계 |
| --- | --- | --- |
| 단위 및 통합 회귀 | PASS | `node --experimental-strip-types --test tests/*.test.ts`, 142/142, skip 0 |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit` |
| 빌드 | PASS | `node build.mjs`, 실제 설치 버전 0.2.7 확인 |
| 실제 YouTube 진단 | PASS | 현재 영상 SABR 감지, 직접 URL 없는 형식 38개, blob-only. Premium 원인 추정은 하지 않음 |
| 실제 안내 표시 | PASS | 확장 UI의 refresh 핸들러 실행 후 SABR 문구·blob 버튼 비활성화 확인. toolbar popup을 마우스로 연 검사는 아님 |
| 기존 fixture 재수집과 Probe | PASS | 실제 Chrome에서 MP4/HLS/DASH 유지, 일괄 Probe 3개 모두 영상·음성, 실패 0 |
| SABR 영상 다운로드 | BLOCKED | 현재 Host의 FFmpeg 입력 방식이 지원하지 않는 전송 프로토콜. 다운로드 해결로 표현하지 않음 |
| 실제 Shorts와 팝업 수명주기 | NOT RUN | 이번 재시험 범위 밖 |

시험 중 Node strip-only 모드가 NetworkObserver의 기존 parameter property를 읽지 못해 constructor를 명시적 필드 할당으로 바꿨다. popup 시험의 tabId/URL mock 불일치도 실제 탭 모델에 맞게 보정했으며 검증 조건은 유지했다. 샌드박스에서 esbuild 상위 경로 조회가 차단된 검사는 허용된 실행 환경에서 재실행했다.

원래 요구의 특정 사이트 전용 extractor 제외 조건 아래에서는 SABR 다운로드를 범용 FFmpeg 경로로 해결할 수 없다. YouTube 전용 추출 엔진 도입은 별도 범위 결정이 필요하다. 관련 공개 이슈: https://github.com/yt-dlp/yt-dlp/issues/12482

## 0.2.8 도움말 정리와 첫 클릭 자동 다운로드 (2026-10-06)

확장만 0.2.8로 갱신했다. Native Host는 기존 0.2.2를 유지하며 등록·FFmpeg 설정·기존 파일·기록은 변경하지 않았다. 검사 중 새 로컬 fixture 다운로드 1개를 추가했다.

### 발견한 결함과 수정

1. **P1 — 자동 다운로드가 Probe 경로에만 적용됨.** 자동 다운로드 옵션을 켜도 카드의 Download/시작은 현재 후보를 바로 내려보냈으므로 무음 후보에서 먼저 실패할 수 있었다. `popup.ts`에서 Download/시작을 동일한 후보 검사·선택 경로에 연결했다. 선택된 AV 후보에만 다운로드를 요청하고 직접 입력한 이름·컨테이너·덮어쓰기 정책을 유지한다. 적합한 후보가 없으면 실패 작업을 만들지 않는다. 자동 시작 표식으로 재귀 검사를 방지한다.
2. **P2 — 설명이 기본 화면을 과도하게 차지함.** 옵션 설명은 호버/키보드 포커스/`?` 클릭 도움말로 이동했다. 주소·탐지 정보와 SABR/blob 제한 상세는 기본 접힘 상태다. 에러와 진행 상태는 숨기지 않는다.
3. **P2 — 브라우저 검사 중 도움말이 아래 버튼 클릭을 가로막음.** 360px 화면에서 자동 다운로드 도움말을 연 뒤 후보 펼침 버튼을 클릭하면 툴팁이 클릭을 받아 펼쳐지지 않았다. CSS `pointer-events:none`으로 설명이 클릭을 가로채지 않도록 수정했고 전역 Esc 닫기를 추가했다. 동일한 호버→펼침 클릭 재시험에서 `aria-expanded=true`를 확인했다.

Probe 생략·로그인 쿠키·음성만 저장·무음 허용을 명시적으로 선택한 경우 현재 후보를 사용하는 기존 동작을 유지한다. 다운로드 전 Probe는 여전히 선택 사항이다. 완료 원본 중복 경고도 유지한다.

수정 파일: `extension/src/popup/popup.html`, `popup.css`, `popup.ts`, `extension/public/manifest.json`, `extension/tests/popup-interactions.test.ts`, `popup-layout.test.ts`, `fixtures/player/acceptance-028.html`, 감사/수동 검사 문서. 배포 생성물 `extension/dist`도 재생성했다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 전체 확장 회귀 | PASS | `node --experimental-strip-types --test --test-reporter=tap tests/*.test.ts`, 147/147, FAIL 0, skip 0. MP4/HLS/DASH 기존 검사를 포함한다 |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| 빌드 | PASS | `node build.mjs`, exit 0. 실제 테스트 Chrome의 설치 버전 0.2.8 확인 |
| 첫 Download/시작 후보 전환 | PASS | 실제 popup 번들의 synthetic DOM 검사. 무음→AV 선택 후 요청 1회, 수동 이름/MKV 유지 |
| Probe 생략 보존 | PASS | 자동 다운로드 설정이 켜져 있어도 개별 Probe 생략 시 find_av/probe 요청 없음, download의 probeBeforeDownload=false |
| 후보 없음 | PASS | 적합한 후보 없음 안내, download 요청 0회 |
| 실제 Chrome 도움말 | PASS | 확장 문서를 탭에서 sidebar 모드로 검사. 호버 표시, 클릭 고정, Esc 닫기, 상세 기본 접힘 |
| 360px 도움말 레이아웃 | PASS | 도움말 폭 300px, 좌측 39.2px/우측 339.2px로 viewport 내부. 가로 overflow 없음. 도움말 표시 중 아래 후보 토글 클릭 성공 |
| 실제 Chrome 첫 클릭 HLS 다운로드 | PASS | 아래 fixture의 무음 카드 Download 1회 클릭. find_av 1회, download 1회(AV 후보), 4개 검사: AV 1/영상만 2/음성만 1/실패 0. 새 job은 completed, 실패 job 추가 없음 |
| 실제 FFprobe 출력 | PASS | H.264 640×360 영상 + AAC 음성, 길이 8.021333초(원본 약 8초) |
| 실제 FFmpeg 디코드 | PASS | 아래 명령 exit 0, stderr 출력 없음 |
| 완료 후 partial | PASS | 새 결과 이름에 해당하는 파일은 최종 MP4 1개만 존재 |
| 브라우저 console | PASS | 확장 UI 탭과 로컬 시험 페이지에서 error/warn 메시지 없음 |
| 실제 툴바 popup/도킹 sidebar·수명주기 전체 | NOT RUN | 이번 실제 UI 검사는 확장 문서를 탭에서 연 방식이다. 툴바 크기와 수명주기 전체 완료로 간주하지 않음 |
| 실제 YouTube SABR 다운로드 | BLOCKED | 기존 0.2.7 제한 유지. 이번 수정은 SABR 지원 엔진 도입이 아님 |

재현: 서버 실행 후 `http://127.0.0.1:8765/player/acceptance-028.html?run=firstclick-20261006-028`을 연다. 확장 새로고침 후 전체 후보 확인·확인 후 자동 다운로드를 체크하고 `separate-video.m3u8?acceptance=...` 무음 후보의 Download를 한 번 누른다. 기대: AV 후보가 선택되어 한 번의 요청으로 완료. 실제: `separate-av.m3u8?acceptance=...`가 선택되고 job `49b827cf-fe39-4736-994e-ff508c6b803c`가 완료됐다. chrome.runtime.sendMessage를 원본 함수에 전달하는 계측으로 요청 횟수를 확인했으며 Host 응답을 mock하지 않았다.

실제 결과: `C:\Users\Acrob\Downloads\PersonalStreamDownloader\0.2.8 첫 클릭 다운로드 검증.mp4` (892212 bytes).

```powershell
& 'C:\Program Files\DownloadHelper CoApp\ffprobe.exe' -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of json 'C:\Users\Acrob\Downloads\PersonalStreamDownloader\0.2.8 첫 클릭 다운로드 검증.mp4'
& 'C:\Program Files\DownloadHelper CoApp\ffmpeg.exe' -v error -i 'C:\Users\Acrob\Downloads\PersonalStreamDownloader\0.2.8 첫 클릭 다운로드 검증.mp4' -f null -
```

현재 변경분 상태: **자동 검증 완료 + 로컬 Chrome/Native Host/FFmpeg 첫 클릭 HLS E2E 완료**. 전체 실제 사이트 다운로드 검증 완료로 표현하지 않는다.

## 0.3.0 YouTube 보조 엔진 실제 검증 (2026-10-06)

### 결과와 범위

사용자의 별도 승인 후 YouTube opt-in 보조 엔진을 구현했다. 지정된 게스트 영상 `https://www.youtube.com/watch?v=D2cUkF-MPJU`에서 쿠키 없이 형식 조회와 실제 다운로드를 확인했다. 브라우저 SABR 자체를 FFmpeg로 읽는 구현이 아니라 공식 yt-dlp의 별도 형식 조회 경로다. 실험적 SABR 빌드, Cookie 추출, PO Token 자동 생성, DRM 우회는 하지 않았다.

엔진 2026.08.19 SHA-256은 `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`다. 설치 경로·출처·재현 명령은 [엔진 문서](YOUTUBE_ENGINE.md)에 기록했다. Native Host 등록은 0.2.2에서 `native-host/dist/0.3.0/stream_host.exe`로 갱신했고 이전 manifest는 해당 버전 폴더의 `previous-host-manifest.json`에 백업했다. 이전 EXE, 사용자 미디어 파일과 완료 기록은 유지했다.

### 결함 및 재시험

1. **P1, 진행 이벤트 미파싱 — FAIL → 수정 후 PASS.** 재현: `scripts/verify-youtube.py`를 위 엔진 문서의 명령으로 실행(첫 root `artifacts/youtube-acceptance-20261006/native`). 기대: 다운로드 중 유효한 progress 이벤트 1개 이상. 실제: 다운로드는 완료됐지만 progress 0개라 assertion 실패. 원인: yt-dlp의 누락 값이 `NA`로 렌더링되어 JSON 문법에 맞지 않았다. `native-host/src/stream_host/youtube.py`에서 `--output-na-placeholder null`을 지정하고 `native-host/tests/test_youtube.py`에 실제 출력 형태를 회귀 검사로 추가했다. EXE 재빌드 후 `native-retest` 폴더로 동일 명령 재실행: 조회 켜짐/꺼짐 모두 progress 14개, 출력 decode 및 partial 정리 PASS. 검증 기준을 변경하거나 skip하지 않았다.
2. **P2, ready 이후 설정 필요 문구 잔류 — FAIL → 수정 후 PASS.** 재현: 설정을 활성화한 상태에서 YouTube 페이지 관리자 새로 열기. 기대: Host ready면 쿠키 미전송 안내. 실제: 버튼은 활성화됐지만 'Host v0.3.0 및 YouTube 엔진 설정이 필요합니다'가 남았다. health 응답 전에 페이지 초기 문구가 설정되고 ready 전환 때 덮어쓰지 않은 것이 원인이다. `extension/src/popup/popup.ts`와 UI 회귀 검사 수정 후 새 빌드를 실제 Chrome에 reload: 쿠키 미전송 안내와 활성 버튼을 확인했다.

검증 도구 오류도 기록한다. 추가 worker 테스트에서 YouTube tab mock을 모든 기존 테스트에 적용해 기존 음악 fixture Referer assertion이 실패했다. mock을 해당 새 테스트에만 한정하고 전체 152개를 다시 통과시켰다. Chrome fixture 검사 첫 회는 재생하지 않은 `separate-av.mpd` 후보를 찾도록 잘못 지정해 candidate missing FAIL을 보고했다. 실제 플레이어가 요청한 `stream.mpd`를 확인한 뒤 같은 영상/음성/다운로드/decode 기준으로 재시험해 PASS였다. 두 항목은 제품 회귀가 아닌 시험 설정 결함이며 기준을 완화하지 않았다.

### 수정 파일

- Native: `youtube.py`(신규), `jobs.py`, `models.py`, `validation.py`, `__main__.py`, `__init__.py`, `pyproject.toml`, `tests/test_youtube.py`(신규).
- 확장: `shared/youtube-page.ts`(신규), `shared/models.ts`, `background/service-worker.ts`, `options/options.html`, `options.ts`, `popup/popup.html`, `popup.css`, `popup.ts`, `presentation.ts`, `public/manifest.json` 및 YouTube/worker/popup 테스트.
- 재현 및 문서: `scripts/verify-youtube.py`(신규), `docs/YOUTUBE_ENGINE.md`(신규), README, protocol, security, 본 감사 문서. `extension/dist`와 Host 0.3.0 EXE 재생성.

### 자동 및 실제 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit`, exit 0 |
| 확장 전체 회귀 | PASS | 152/152, FAIL 0, skip 0; blob 차단, 옵션 UI, 첫 클릭, URL/쿠키 방어 포함 |
| Native 전체 회귀 | PASS | unittest 83개, skip 없이 OK; 기존 fixture AV/길이/decode/인증/DRM/취소·복구 포함 |
| 확장 및 Host 빌드 | PASS | `node build.mjs`; PyInstaller Host 0.3.0 빌드 완료 |
| 컴파일 EXE Native framing 및 health | PASS | `verify-youtube.py`, Host 0.3.0, FFmpeg/YouTube available, Host stderr 빈 출력 |
| 게스트 형식 조회 | PASS | 영상 1개+음성 1개 선택, 길이 671초, 720p MKV의 형식 398+251-2; 높이 144~1080 조회 |
| 다운로드 전 조회 선택 | PASS | 켜짐/꺼짐 각각 실제 다운로드·decode 성공, 꺼짐의 inputProbeSkipped=true 확인 |
| 진행률 | PASS | 두 실제 Host 작업 각각 14개 progress, 단조 증가·최대 98%; UI 완료 시 100% |
| 취소 후 엔진 프로세스 | PASS | 실제 실행 중 extractor PID 42564 취소·종료 확인. FFmpeg 병합 순간 취소는 별도 NOT RUN |
| 완료 후 partial | PASS | Host 격리 임시 폴더·root partial 없음; Chrome 결과 폴더 최종 미디어만 존재 |
| 비밀 정보 미저장 | PASS | Host 프로토콜·registry·로그에서 signed Googlevideo URL/헤더/raw formats 없음; 실제 Chrome local/session storage에서도 Cookie/Authorization/raw formats 없음 |
| 실제 Chrome 설치 및 연결 | PASS | Chrome 확장 v0.3.0 Enabled, 실제 ID jpahdpgemdlibedhcodgolicnaieomoh, Host v0.3.0 FFmpeg 정상 |
| 실제 Chrome 형식 조회/첫 다운로드 클릭 | PASS | 별도 UI 버튼 클릭으로 AV 조회 후 한 번의 Download로 job 7e27fa42-e9ad-4c32-872f-4e1d8af78f08 completed |
| Chrome UI 문서 닫기·다시 열기 | PASS | 같은 job ID의 완료 상태 표시. toolbar popup 아닌 확장 문서 탭을 닫고 연 검사 |
| 확장 reload 뒤 완료 상태 복구 | PASS | 360p MP4 작업 시작 뒤 확장 reload, 새 SW sw-9와 새 UI에서 같은 job ID completed 복구 |
| reload 직후 running 상태 관측 | NOT RUN | 재조회 전에 짧은 다운로드가 완료됨. 실행 중 복구 증거로 간주하지 않음 |
| Chrome MP4/HLS/DASH 기존 경로 | PASS | 실제 기존 fixture 후보 탐지·Probe 모두 AV+8초, 각 Chrome→Host 다운로드 completed; 결과 모두 H.264/AAC+8.021초, null decode 오류 없음 |
| Chrome UI/SW console | PASS | 최종 확장 문서와 현재 service worker error/warn 메시지 없음 |
| 실제 toolbar popup·도킹 sidebar 전수 검사 | NOT RUN | DevTools에서 실제 확장 문서를 tab/sidebar CSS 모드로 검사한 범위 |
| Shorts·다른 계정·유료/연령 제한·YouTube live | NOT RUN | 지정 게스트 일반 영상만 실제 사이트 검사; 현재 완료된 VOD 지원 범위 |
| 브라우저 SABR 직접 저장 | NOT RUN | 별도 엔진 조회 경로이며 SABR 구현으로 주장하지 않음 |

### Chrome의 실제 출력

모든 출력은 `artifacts/youtube-acceptance-20261006/chrome`에 남겼다. 원본 Probe 길이 671초에 대해 허용 오차 max(2초, 1%) 내이며 FFmpeg `-v error -i OUTPUT -f null -` exit 0, stderr 없음이다.

| 출력 | 영상 | 음성 | 길이 |
| --- | --- | --- | --- |
| chrome-guest-720p.mkv | AV1 1280×720 | Opus | 671.468초 |
| chrome-guest-audio.mkv | 없음(음성 전용 선택) | Opus | 671.468초 |
| chrome-guest-360p-mp4.mp4 | H.264 640×360 | AAC | 671.497868초 |

Chrome 시험은 전용 DevTools 프로필에서 수행했다. 해당 프로필만 엔진을 opt-in하고 시험 출력 폴더를 지정했다. 일반 사용자 Chrome 프로필의 확장 설정을 복사·읽거나 Cookie를 추출하지 않았다. 일반 Chrome은 `extension/dist` 확장을 reload하고 엔진 opt-in/경로를 직접 설정해야 한다.

현재 상태: **자동 검증 완료 + 로컬 E2E 완료 + 지정된 게스트 YouTube VOD 실제 사이트 검증 완료**. 모든 YouTube 영상·계정·전송 방식 지원, 모든 원래 수명주기 acceptance 완료라는 의미는 아니다. 광고 blob 분류·제거, 진행 중 SW 강제 종료 직후 복구, 병합 순간 취소는 남은 항목이다.

