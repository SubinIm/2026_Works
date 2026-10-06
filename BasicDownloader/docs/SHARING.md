# 다른 컴퓨터에서 설치하기

저장소: [SubinIm/2026_Works](https://github.com/SubinIm/2026_Works). 세 확장프로그램은 각각 설치합니다.

## 설치용 ZIP

| 확장프로그램 | 다운로드 | 필요 환경 |
| --- | --- | --- |
| Basic Banner Blocker 0.10.2 | [설치용 ZIP](https://github.com/SubinIm/2026_Works/raw/refs/heads/main/BasicDownloader/packages/basic-banner-blocker-0.10.2.zip) | Chrome 128 이상 |
| Paperdesk 0.1.0 | [설치용 ZIP](https://github.com/SubinIm/2026_Works/raw/refs/heads/main/BasicDownloader/packages/paperdesk-0.1.0.zip) | Chrome 또는 Edge |
| Personal Stream Downloader 0.3.0 | [Windows x64 설치용 ZIP](https://github.com/SubinIm/2026_Works/raw/refs/heads/main/BasicDownloader/packages/personal-stream-downloader-0.3.0-windows-x64.zip) | Windows 10/11 x64, Chrome 127 이상, FFmpeg/FFprobe |

[SHA256SUMS.txt](../packages/SHA256SUMS.txt)에는 ZIP 파일의 SHA-256이 있습니다. 필요하면 PowerShell의 `Get-FileHash -Algorithm SHA256 '파일.zip'`으로 비교합니다.

## 공통 설치

1. 원하는 ZIP을 내려받아 계속 보관할 위치에 압축을 풉니다. 설치한 뒤 이 폴더를 삭제하거나 이동하면 확장프로그램을 사용할 수 없습니다.
2. Chrome에서 `chrome://extensions`를 엽니다. Paperdesk는 Edge의 `edge://extensions`에서도 설치할 수 있습니다.
3. **개발자 모드**를 켜고 **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. ZIP을 풀어 나온 폴더 안에서 다음 경로를 선택합니다. `manifest.json`이 바로 들어 있는 폴더입니다.

| 확장프로그램 | 선택할 폴더 |
| --- | --- |
| Basic Banner Blocker | `adblocker` |
| Paperdesk | `reference-manager/dist` |
| Personal Stream Downloader | `extension/dist` |

5. 확장프로그램을 도구 모음에 고정하고 기존 웹페이지를 새로고침합니다.

Chrome의 압축해제 설치 절차는 [공식 안내](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)에 따릅니다. 각 PC와 브라우저 프로필에서 직접 설치해야 합니다. GitHub 업로드만으로 자동 설치·업데이트·데이터 동기화가 되지는 않습니다.

## 다운로드 도구의 추가 설치

이 ZIP에는 현재 소스로 빌드한 `native-host/dist/stream_host.exe`가 포함되어 있습니다. 사용하는 PC에 Node.js나 Python을 설치할 필요는 없습니다. **FFmpeg와 FFprobe는 별도로 필요합니다.** [FFmpeg 공식 다운로드 페이지](https://ffmpeg.org/download.html)의 Windows 빌드 링크에서 두 실행파일이 포함된 빌드를 받습니다.

FFmpeg/FFprobe를 PATH에 추가하거나 다음 위치에 두 파일을 넣습니다.

```text
native-host/dist/tools/ffmpeg/bin/ffmpeg.exe
native-host/dist/tools/ffmpeg/bin/ffprobe.exe
```

Chrome 확장 관리 화면에서 Personal Stream Downloader의 **ID**를 복사합니다. ZIP을 푼 폴더에서 PowerShell을 열고 실행합니다. ID는 예시를 그대로 쓰지 말고 해당 PC에서 표시된 값을 사용합니다.

```powershell
.\scripts\install-host.ps1 -ExtensionId '여기에_32자리_확장_ID'
```

PowerShell 실행 정책으로 차단되면 해당 파일만 아래처럼 실행합니다. 시스템의 실행 정책을 영구 변경하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-host.ps1 -ExtensionId '여기에_32자리_확장_ID'
```

Chrome을 완전히 종료한 뒤 다시 열고 확장프로그램의 Host 연결 상태를 확인합니다. 등록은 현재 사용자 계정에만 적용됩니다. ZIP에 YouTube 보조 엔진은 포함하지 않습니다. 사용하려면 [별도 설정 안내](https://github.com/SubinIm/2026_Works/blob/main/BasicDownloader/docs/YOUTUBE_ENGINE.md)에 따라 yt-dlp와 Node.js를 직접 준비합니다.

제거할 때는 `scripts/uninstall-host.ps1`을 실행하고 Chrome에서 확장프로그램을 제거합니다. 저장한 영상은 자동 삭제하지 않습니다.

## 설정과 자료 옮기기

- **Basic Banner Blocker:** 기존 PC의 규칙 관리·백업에서 JSON을 내보내고 새 PC에서 가져옵니다.
- **Paperdesk:** 전체 백업으로 PDF를 포함한 JSON을 저장하고 새 PC에서 백업 가져오기를 실행합니다. 가져오기 파일은 최대 250 MB입니다.
- **다운로드 도구:** 새 PC에서 Host를 다시 등록하고 설정의 실행파일 경로를 해당 PC에 맞게 지정합니다. 다운로드 파일은 별도로 옮깁니다.

설정·자료·브라우저 세션·쿠키는 GitHub에 포함하지 않습니다.

## 업데이트와 개발

새 ZIP을 기존 설치 위치에 덮어쓰기 전에 설정과 자료를 백업합니다. 덮어쓴 뒤 확장 관리 화면의 **새로고침(↻)**을 누르고 웹페이지도 다시 엽니다. 다운로드 도구 업데이트 시에는 진행 중 작업이 끝난 뒤 Chrome을 종료하고 Host 실행파일도 교체합니다.

소스는 저장소의 `BasicDownloader` 폴더에 있습니다. 광고 차단기는 `adblocker`를 그대로 로드할 수 있습니다. Paperdesk는 `reference-manager`에서 `node build.mjs`, 다운로드 도구는 프로젝트 README의 빌드 절차를 사용합니다.

개발 환경에서 세 ZIP을 다시 만들려면:

```powershell
.\scripts\build-extension.ps1
.\scripts\build-host.ps1
node .\reference-manager\build.mjs
.\scripts\package-release.ps1
```

패키징은 `packages`에 ZIP과 SHA-256 목록을 만들며 테스트 프로필, 브라우저 생성 메타데이터, 로그, 의존성 캐시를 포함하지 않습니다. 광고 차단기의 공개 필터 원문과 출처·라이선스를 함께 포함합니다.
