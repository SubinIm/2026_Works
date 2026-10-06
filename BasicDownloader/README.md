# Personal Stream Downloader

이 저장소에는 다운로드 도구, **Basic Banner Blocker**, **Paperdesk**가 함께 있습니다. 다른 PC에 설치하려면 [공유·설치 안내](docs/SHARING.md)에서 원하는 확장프로그램의 설치용 ZIP을 받으세요. 광고 차단기와 Paperdesk는 빌드 도구 없이 설치할 수 있으며, 다운로드 도구의 Windows x64 ZIP에는 Native Host가 포함되어 있습니다.

Windows 10/11의 Chrome에서 현재 탭이 요청하는 일반 비 DRM MP4/WebM, HLS, MPEG-DASH를 탐지하고 로컬 FFmpeg로 stream copy 저장하는 개인용 도구다. 0.3.0부터 별도 opt-in YouTube 보조 엔진(yt-dlp)을 지원한다. DRM 우회, 화면 녹화, 재인코딩, telemetry는 제공하지 않는다.

## 요구 사항

- Chrome 127 이상(최신 버전 권장), Windows PowerShell 5.1 이상
- Node.js 20 이상과 npm
- Python 3.11 이상
- FFmpeg와 FFprobe (`PATH`, Host 옆 `tools\ffmpeg\bin`, 또는 `PSD_FFMPEG_PATH`)

`scripts\verify-environment.ps1`로 확인할 수 있다. FFmpeg 바이너리를 자동 다운로드하지 않는다.

## 빌드 및 설치

```powershell
.\scripts\build-extension.ps1
.\scripts\build-host.ps1
```

Chrome에서 `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드로 `extension\dist`를 선택한다. 표시된 extension ID로 다음을 실행한다.

```powershell
.\scripts\install-host.ps1 -ExtensionId abcdefghijklmnopqrstuvwxyzabcdef
```

스크립트는 `%LOCALAPPDATA%\PersonalStreamDownloader\com.personal.stream_downloader.json`과 현재 사용자 레지스트리만 만든다. Chrome을 재시작한다.

## 사용법

콘텐츠를 재생한 뒤 팝업 또는 사이드바에서 후보를 확인한다. Probe로 stream 정보를 확인하고 출력 이름/컨테이너/기존 파일 정책을 선택해 Download한다. 인증이 필요한 본인 세션만 `현재 사이트 세션 포함`을 작업별로 선택한다. `blob:` 카드는 직접 다운로드할 수 없고 같은 탭에서 탐지된 실제 HTTP(S) manifest를 선택해야 한다.

Auto는 MP4 stream copy를 사용하며 mux 호환성 실패 때만 MKV로 재시도한다. 네트워크/인증 실패를 MKV로 재시도하거나 자동 재인코딩하지 않는다. 전체 길이를 확인한 VOD는 진행률·예상 남은 시간을 표시하며, 종료 시점이 없는 live는 시간·크기·속도를 표시한다.

기본 출력은 `%USERPROFILE%\Downloads\PersonalStreamDownloader`다. `PSD_DOWNLOAD_ROOT` 환경 변수로 Host 시작 전에 변경할 수 있다.

### 0.3.0 YouTube 보조 엔진

브라우저가 SABR/MediaSource로 재생해서 `blob:`만 탐지되더라도, 현재 YouTube 영상 페이지를 별도 엔진으로 조회할 수 있다. **blob 주소를 FFmpeg에 전달하거나 SABR 바이트를 가로채는 방식이 아니다.**

설정에서 `YouTube 보조 엔진 사용`을 켜고 공식 `yt-dlp.exe` 및 `node.exe`의 전체 경로를 지정한다. 검증용 엔진은 `tools\youtube\2026.08.19\yt-dlp.exe`, Host는 `native-host\dist\0.3.0\stream_host.exe`다. 확장과 Host를 모두 갱신해야 한다. 자동 설치·업데이트는 하지 않는다.

YouTube 페이지에서 `YouTube 형식 조회` 또는 `YouTube 다운로드`를 사용한다. 최대 해상도, MKV/MP4, 음성만 저장을 선택할 수 있다. 시작 전 형식 조회는 선택 사항이며, 끄더라도 다운로드에 필요한 엔진의 주소 추출과 최종 FFprobe 검증은 수행한다. 영상과 음성은 같은 영상의 형식으로 선택·병합한다.

이번 경로는 **게스트·쿠키 미전송, 완료된 일반 영상**만 지원한다. 로그인·연령 제한·비공개·유료·live 및 PO Token 요구는 성공을 보장하지 않는다. 일반 후보 카드의 세션 체크박스는 YouTube 보조 엔진에 적용되지 않는다. 설정과 재현 절차는 [YouTube 엔진 문서](docs/YOUTUBE_ENGINE.md)에 정리했다.

### 0.2.0 다운로드 관리자

- `영상 제목을 파일명으로 사용` 체크박스: 직접 파일명을 수정하면 자동완성이 해제된다. 설정에서 `{title}`, `{quality}`, `{date}` 템플릿과 기본 동작을 지정할 수 있다.
- 제목·썸네일과 Probe로 확인한 해상도·영상/음성·길이를 표시한다. 페이지 대표 이미지는 영상 고유 poster와 구분하며, 썸네일이 없거나 보안/CORS 정책으로 읽지 못하면 기본 표시를 사용한다.
- 같은 페이지의 후보를 접어서 묶는다. 동일 영상/서로 다른 화질이라고 단정하지 않는다.
- 완료 목록에서 Windows 기본 플레이어로 재생, 탐색기에서 파일 선택, 경로 복사. 목록의 상세를 펼치거나 우클릭/`⋯` 메뉴로 명령에 접근할 수 있다.
- 진행 막대는 읽기 전용이다. 다운로드 목록 접기, 상태 필터, 다중 선택 제거, 완료 목록 비우기를 지원한다. **기록만 제거하며 영상·partial 파일은 삭제하지 않는다.** 진행 중 작업은 보호한다.
- 같은 canonical URL로 완료한 기록이 있으면 새 다운로드 전에 확인한다. 토큰이 바뀐 URL까지 동일 영상으로 판정하지 않으며, 기록을 제거하면 그 기록을 이용한 중복 경고도 사라진다.
- 팝업/사이드바 전환과 기본 보기 설정. 페이지·영상·링크 우클릭은 후보 관리자만 열며 자동 다운로드나 Cookie 전달을 하지 않는다.
- 완료·실패 알림은 설정에서 opt-in한다. 기본 비활성화이며 알림에는 제목·URL을 넣지 않는다.

새 파일 액션/기록 관리에는 Host **0.2.0**이 필요하다. 이 작업의 검증 실행파일은 `native-host\dist\0.2.0\stream_host.exe`다. 기존 실행 중 작업이 끝난 뒤 확장과 영상 페이지를 새로고침한다. 자동 검증 결과와 실제 Chrome에서 아직 확인할 항목은 [감사 기록](docs/ACCEPTANCE_AUDIT.md)을 참조한다.

## 로컬 fixture와 테스트

```powershell
.\scripts\start-fixture-server.ps1
cd extension
npm test
cd ..\native-host
$env:PYTHONPATH='src'
python -m unittest discover -s tests -v
```

fixture 스크립트는 direct MP4, MPEG-TS/fMP4 HLS와 DASH를 생성하고 Ctrl+C까지 localhost 서버를 유지한다. 상세 절차는 [수동 테스트](docs/MANUAL_TEST.md), 설계는 [아키텍처](docs/ARCHITECTURE.md), 메시지는 [프로토콜](docs/MESSAGE_PROTOCOL.md), 개인정보 처리는 [보안 문서](docs/SECURITY.md)를 참조한다.

PATH에 FFmpeg/Python이 없으면 다음처럼 실제 경로를 지정할 수 있다.

```powershell
.\scripts\start-fixture-server.ps1 -FFmpegPath 'C:\path\ffmpeg.exe' -Python 'C:\path\python.exe'
```

## 오류 해결

- `Host 미연결`: extension ID로 다시 설치하고 Chrome을 완전히 재시작한다.
- `FFmpeg ... 찾을 수 없습니다`: FFmpeg/FFprobe 두 파일을 PATH에 두거나 `PSD_FFMPEG_PATH`를 설정한다.
- 401/403: signed URL 만료, Referer 요구, 세션 Cookie 필요, DRM 또는 FFmpeg 요청 거부 가능성이 있다. 페이지를 새로고침해 새 URL을 얻고, 권한이 있는 경우에만 세션 포함을 선택한다.
- MP4 mux 실패: MKV 컨테이너로 명시적으로 다시 시도한다.

## 제거

```powershell
.\scripts\uninstall-host.ps1
```

그 뒤 Chrome에서 확장을 제거한다. 다운로드 파일은 자동 삭제하지 않는다.

## 지원 범위와 제한

일반 AES-128 HLS는 서버가 정상 key 접근을 허용하면 FFmpeg가 처리할 수 있다. Widevine/PlayReady/FairPlay, SAMPLE-AES, DASH CENC는 `unsupported_drm`으로 거부한다. 탐지는 best-effort이며 난독화된 전송, MSE 내부에서만 조립되는 데이터, 특정 사이트 전용 인증 흐름은 지원하지 않는다. 사용자는 본인이 접근·저장할 권리가 있는 콘텐츠에만 사용해야 한다.
