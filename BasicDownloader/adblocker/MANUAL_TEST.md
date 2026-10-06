# Chrome 수동 검증

이 문서는 수동 검증 절차입니다. 모든 항목이 실제 Chrome에서 검증 완료되었다는 의미는 아닙니다. 대상은 일반 웹페이지의 광고 요청과 배너이며, 영상 내부 광고는 제외합니다.

## 준비

1. `chrome://extensions`에서 개발자 모드를 켜고, **압축해제된 확장 프로그램을 로드합니다**. 프로젝트의 `adblocker` 폴더를 선택합니다.
2. 프로젝트 최상위 폴더의 터미널에서 `node adblocker/fixtures/server.mjs`를 실행합니다. Node.js가 필요합니다. 포트를 바꾸려면 뒤에 숫자를 붙입니다.
3. Chrome에서 `http://127.0.0.1:8766/`을 엽니다. fixture 서버는 `127.0.0.1`에만 바인딩하고 정해진 파일만 제공합니다. 외부 광고 서버나 추적 도구에 요청하지 않습니다.
4. 확장 기능이 켜져 있고 현재 사이트의 차단도 켜져 있는지 확인합니다. 기존 수동 규칙이 있다면 팝업에서 해당 규칙을 복원하고 시작합니다.
5. Chrome 확장 관리 화면에서 서비스 워커 오류, 페이지 개발자 도구에서 콘텐츠 스크립트 오류가 없는지 확인합니다.
6. 팝업의 **현재 페이지 상태**에서 광고 요청 필터·페이지 연결·우클릭 메뉴를 확인합니다. **기본 규칙으로 숨김**, **공개 숨김 필터**, **숨김·이동 규칙**은 별개입니다. 공개 필터 수는 숨긴 광고 수가 아닌 적용 가능한 CSS 규칙 수입니다.

## 요소 숨김과 복원

### 사이드바 (0.5.0)

1. 확장을 새로고침한 뒤 아이콘 팝업의 **사이드바에서 열기**를 누릅니다. 팝업은 닫히고 Chrome 사이드바에 같은 설정이 표시되어야 합니다.
2. 같은 창에서 다른 웹사이트 탭을 선택하거나 현재 탭을 다른 주소로 이동합니다. 사이트명·저장한 규칙·연결 상태가 갱신되어야 합니다. 다른 창의 탭 전환은 현재 사이드바에 영향을 주지 않아야 합니다.
3. **요소 숨기기** 또는 **요소 이동시키기**를 시작합니다. 사이드바는 열린 채 유지되고 현재 웹페이지에 선택 도구가 표시되어야 합니다.
4. 현재 사이트 설정과 규칙 복원을 사용합니다. 선택한 사이트에만 적용되는지 확인합니다. 모두 복원 확인 도중 탭을 바꾸면 이전 확인창은 닫혀야 합니다.
5. Chrome 내부 페이지에서는 사이트 조작이 비활성화되어야 합니다. 사이드바 폭을 줄여 가로 스크롤 없이 사용할 수 있는지 확인합니다.

### 페이지에서 선택

| 동작 | 기대 결과 |
| --- | --- |
| 페이지를 연다 | `ins.adsbygoogle`와 `div[data-ad-client][data-ad-slot]` 예시 두 개가 숨겨지고 정상 제목·본문·영상 모형은 남는다. |
| 첫 번째 협찬 카드의 문구를 우클릭하고 **이 요소 숨기기…** 메뉴를 선택한다 | 대상이 강조 표시되며, **숨김 미리보기**로 숨긴 결과를 확인할 수 있다. 저장 전에는 영구 규칙이 생기지 않는다. |
| 미리보기를 취소한다 | 카드가 다시 보이고, 새로고침 후에도 보인다. |
| 다시 선택하고 필요하면 **상위 영역**으로 카드 전체를 선택한다 | 카드만 선택된다. 카드 아래의 체크 표시 문장은 선택되지 않는다. |
| 선택 결과를 저장한다 | 선택한 카드가 숨겨지고, 새로고침 후에도 숨겨진다. |
| 팝업에서 해당 수동 규칙을 복원한다 | 카드가 다시 나타나고 새로고침해도 나타난다. |
| 이미지 안쪽과 링크 안쪽을 각각 우클릭해 같은 절차를 반복한다 | 우클릭한 위치에서 미리보기가 시작되며, 관련 없는 본문이 선택되지 않는다. |
| 여러 수동 규칙을 만든 뒤 하나만 복원한다 | 선택한 규칙만 사라지고 다른 규칙은 계속 적용된다. |
| 현재 사이트의 수동 규칙 전체를 복원한다 | 해당 사이트의 수동 규칙만 삭제되며 자동 숨김은 계속 작동한다. |

미리보기 기능을 사용해 본문까지 함께 선택되는지 직접 확인합니다. 저장한 선택자가 사이트 구조 변경 후에도 항상 정확하다는 보장은 없습니다.

## 요소 이동과 복원 (0.4.0)

0.4.1 재적용 확인: 스포츠서울 기사에서 팝업의 **요소 이동시키기**로 광고 프레임 전체를 선택해 저장합니다. 새로고침 후 광고 ID·클래스가 달라져도 이동이 재적용되는지 확인합니다. 이전 버전에서 임의 이름을 저장한 규칙은 복원 후 다시 저장합니다. 광고 내부 이미지·문구를 선택하면 광고 내용이나 프레임 출처 변경의 영향을 받을 수 있습니다.

1. 확장을 0.4.0으로 새로고침하고 웹페이지도 다시 불러옵니다. 우클릭 메뉴에 **이 요소 숨기기…**와 **이 요소 이동시키기…**가 함께 있는지 확인합니다.
2. 수동 협찬 카드에서 이동 메뉴를 선택합니다. **이동 미리보기**에서 카드가 화면 밖으로 이동하고 정상 본문이 남아야 합니다. **취소 (Esc)**를 누르면 원래 위치로 돌아오고 규칙은 저장되지 않아야 합니다.
3. 다시 선택해 저장합니다. 팝업과 관리 화면에 이동 방식이 표시되고, 새로고침·동일 카드 재삽입 후에도 이동해야 합니다. 이동 전 자리가 남을 수 있습니다.
4. 규칙 일시 중지·재개, 사이트 차단 끄기·켜기, 규칙 삭제·복원에서 원래 위치와 사이트의 스타일이 복구되는지 확인합니다. 이동 중 페이지가 위치 스타일을 바꾸었다면 최신 값을 보존해야 합니다.
5. 일반 카드, 인라인 문구, 이미지와 iframe 상자를 각각 선택합니다. 프레임을 이동해도 프레임 자체를 새로 만들거나 문서를 다시 로드하면 안 됩니다. 이동할 수 없는 영역은 저장하지 않고 작은 다른 영역을 선택하도록 안내해야 합니다.
6. 좁은 외부 iframe 내부에서도 조작 패널의 제목·미리보기가 이동 모드로 표시되는지 확인합니다. 미리보기·저장·실행 취소는 해당 프레임 요소에만 적용되어야 합니다.
7. 이동 규칙을 JSON으로 내보내고 삭제한 뒤 가져옵니다. 숨김으로 바뀌지 않고 이동 방식이 유지되어야 합니다. 기존 버전 1 백업도 숨김 규칙으로 가져와야 합니다.

이동 기능은 별도의 광고 요청 차단을 해제하지 않습니다. 광고 로딩·통신이 남을 수 있으며 차단 감지 안내가 사라진다고 보장하지 않습니다.

## 동적으로 추가되는 요소

1. 페이지를 연 뒤 약 1.5초 기다리면 동적 협찬 카드가 나타납니다.
2. 카드 전체를 수동으로 숨기고 저장합니다.
3. **동일한 카드 재삽입** 버튼을 누릅니다. 상태 문구의 횟수는 늘지만 같은 ID로 다시 생성된 카드는 숨겨져야 합니다.
4. 새로고침한 뒤에도 지연 삽입된 카드가 숨겨지는지 확인합니다.
5. 해당 규칙을 복원한 뒤 버튼을 다시 누르면 카드가 보여야 합니다.

## 사이트와 프레임 범위

1. 같은 호스트 iframe의 협찬 카드만 숨깁니다. 프레임의 정상 제목과 문장이 남는지 확인합니다.
2. 다른 호스트 이름 iframe의 카드는 그대로 보여야 합니다. 두 iframe은 같은 `#frame-partner-panel` 선택자를 사용하지만 호스트 이름은 다릅니다.
3. 다른 호스트 iframe의 카드도 별도로 숨기고 새로고침합니다. 각각의 규칙이 정확한 프레임에 적용되어야 합니다.
4. 하단의 **다른 호스트 이름으로 열기** 링크로 `localhost` 최상위 페이지를 엽니다. `127.0.0.1` 최상위 페이지에서 저장한 수동 규칙이 이 페이지에 적용되면 안 됩니다.
5. 처음 페이지로 돌아와 iframe에서 저장한 규칙 하나를 복원합니다. 그 규칙의 카드만 다시 표시되는지 확인합니다.

규칙 범위는 최상위 페이지의 호스트 이름과 대상 프레임의 호스트 이름 조합입니다. 같은 호스트 이름의 다른 경로와 포트에는 규칙이 함께 적용될 수 있습니다. 다른 호스트 이름 iframe이 로드되지 않으면 `localhost`가 로컬 주소로 해석되는지 확인합니다.

6. **주소 없는 광고 프레임**의 `about:blank` 카드와 `srcdoc` 카드를 각각 우클릭합니다. 메뉴가 표시되고 선택·저장·복원이 가능해야 합니다.
7. 팝업의 **요소 숨기기**을 누르고 수동 협찬 카드를 클릭합니다. 링크가 열리지 않고 미리보기·저장 도구가 나타나야 합니다. Esc는 선택 모드를 종료합니다.

### 좁은 광고 프레임에서 조작 패널

1. 폭이 약 160px인 외부 광고 iframe 안의 요소를 우클릭하여 **이 요소 숨기기…**를 엽니다. 파란 선택 테두리는 광고 안에, 조작 패널은 최상위 웹페이지에 표시되어야 합니다. 패널이 iframe 폭으로 잘리면 안 됩니다.
2. 최상위 패널에서 상위·하위 영역, 미리보기·되돌리기, 저장·실행 취소를 조작합니다. 선택한 프레임 안의 요소에만 적용되고 정상 본문·인접 요소는 유지되어야 합니다.
3. 중첩된 다른 출처 프레임과 `srcdoc` 프레임에서도 같은 조작을 확인합니다. 저장 규칙의 사이트는 최상위 사이트, 프레임은 실제 선택한 문서의 출처여야 합니다.
4. 광고를 저장한 뒤 같은 프레임에서 두 번째 선택 도구를 엽니다. 앞서 표시된 **실행 취소**는 첫 번째 규칙을 복원하고 두 번째 선택 도구는 유지해야 합니다.
5. 선택 도구를 연 상태에서 광고 프레임이 다른 문서로 바뀌거나 사라지면 조작 패널도 닫혀야 합니다. 새 광고에 이전 선택 규칙을 저장하면 안 됩니다.
6. 저장 중에는 늦은 상태 확인 응답 때문에 버튼이 다시 켜지면 안 됩니다. Esc로 저장이 취소되었다는 잘못된 인상을 주지 않도록 저장 완료까지 기다립니다.

## 실제 네이버 홈 회귀 확인

1. 확장 버전 0.3.0을 새로고침한 뒤 `https://www.naver.com/`을 Ctrl+Shift+R로 엽니다.
2. 팝업의 페이지 연결과 필터 상태가 정상인지, **기본 규칙으로 숨김**이 반영되는지 확인합니다. 노출되는 광고 배치에 따라 수는 달라질 수 있습니다.
3. DevTools Network에서 관측된 `tveta/libs/glad/`, `tveta/libs/ndpsdk/` 광고 스크립트가 `ERR_BLOCKED_BY_CLIENT`로 차단되는지 확인합니다. 정상 검색 입력, 뉴스, 날씨, 일반 쇼핑 영역은 남아 있어야 합니다.
4. 자동 차단에서 남은 요소는 우클릭 메뉴 또는 팝업의 **요소 숨기기**으로 숨겼다가 복원합니다.

## 디시인사이드 댓글 광고 회귀 확인

1. 확장 0.3.0을 새로고침한 뒤 `https://gall.dcinside.com/board/view/?id=leagueoflegends6&no=15829502`를 다시 불러옵니다.
2. 댓글 사이의 파워링크·댓글돌이는 광고 행 전체가 숨겨져야 합니다. 일반 댓글, 답글, 댓글 입력과 페이지 이동은 남아 있어야 합니다.
3. 사이트의 댓글 새로고침으로 목록이 재생성되어도 광고 행은 다시 숨겨져야 합니다. 광고 문구·사진·순서가 달라져도 같은 전용 행 구조에는 적용됩니다.
4. 현재 사이트 차단을 끄면 광고 행이 복원되고, 다시 켜면 숨겨져야 합니다.
5. 자동 테스트는 같은 단어가 포함된 일반 댓글, 반복·중복 ID 광고, 광고 재삽입, 행 재정렬과 다른 호스트의 유사 구조를 별도로 검사합니다. 게시글 자체의 삭제·변경이나 광고 미노출은 로컬 구조 검증과 구분합니다.

## 스포츠서울 고정형 배너

1. 확장 버전 **0.4.0**을 새로고침하고 `https://www.sportsseoul.com/`을 Ctrl+Shift+R로 다시 엽니다. 양옆 160×600 쇼핑·게임 배너가 화면 밖으로 이동하는지 확인합니다. 기사 목록·이미지·메뉴·영상 링크는 남아 있어야 합니다.
2. 개발자 도구에서 광고 iframe 노드와 160×600 크기, 기존 `display` 값이 유지되는지 확인합니다. 외곽의 `translate`가 화면 밖 좌표를 만들어야 하며, 페이지 가로 스크롤은 증가하지 않아야 합니다. 재삽입·ID/클래스 변경 후에도 이동이 적용되어야 합니다.
3. 현재 사이트 차단을 끄면 외곽이 원래 위치로 복원되고 다시 켜면 화면 밖으로 이동해야 합니다. 기본 숨김 통계에는 이동된 요소도 포함되며 수동 규칙 개수는 늘어나지 않습니다. 같은 요소에 저장한 수동 숨김은 별도의 명시적 규칙입니다.
4. 여러 광고 교체 주기 동안 `Too many inventory failures` 안내가 재발하는지 확인합니다. 재발한다면 이동도 감지하거나 다른 차단 경로가 남은 것이므로 성공으로 기록하지 않습니다. 이미 안내로 바뀐 문서는 새로고침이 필요합니다.
5. `tests/sportsseoul-content.browser.test.mjs`는 실제 관측 구조를 재현해 프레임·크기 유지, 화면 밖 좌표, 재삽입·이름 변경·스타일 덮어쓰기·중지/복원과 정상 콘텐츠 보존을 검증합니다. 실제 광고 서버의 감지 회피 성공과는 별도 검증입니다.

관측 기록(2026-10-05): Chrome 실제 탭에서 빈 주소 iframe을 가진 외곽 span 4개, 기사 제목 링크 185개를 확인했습니다. 새 판별 조건은 광고 외곽 4개에만 일치했습니다. 별도 비교 탭에서 `html-load.com` 차단 시 `content-loader.com`으로 전환했고 광고가 남았습니다. 원본 HTML의 재시도 실패 분기에는 스타일 제거가 있으므로 도메인 전체 차단은 채택하지 않았습니다. 네트워크 기본 규칙은 기존 32개를 유지합니다.

0.3.2 실제 적용 결과: 사용자에게 정상 표시 확인을 받았고, 같은 Chrome 탭에서 광고 프레임 4개가 160×600·`display:block`을 유지하면서 화면 밖에 놓인 것을 확인했습니다. 기사 제목 링크 185개는 유지됐고 `error-report.com/modal` 안내 iframe은 0개였습니다. 미래의 재탐지까지 검증된 것은 아닙니다.

후속 확인(약 97초 뒤): 사용자가 같은 탭에서 `https://www.sportsseoul.com/news/read/1639264` 기사로 이동한 상태였습니다. 이 기사에서도 160×600 배너 2개가 화면 밖에 있고 안내 iframe은 0개, 본문 영역과 일반 이미지 29개는 표시됐습니다. 페이지 이동이 있었으므로 같은 문서에서 97초간 연속 성공했다고 해석하지 않습니다.

## 사이트 일시 정지와 전체 끄기

1. 자동 요소와 수동 요소가 숨겨진 상태에서 현재 사이트의 차단을 일시 정지합니다. 페이지를 새로고침했을 때 숨겼던 요소들이 표시되어야 합니다.
2. 현재 사이트의 차단을 다시 켭니다. 새로고침한 페이지에서 자동 요소와 저장된 수동 요소가 다시 숨겨져야 합니다.
3. 전체 기능을 끕니다. `127.0.0.1` 및 `localhost` 페이지 모두에서 차단이 중지되어야 합니다.
4. 전체 기능을 다시 켭니다. 사이트별 일시 정지 설정과 저장된 수동 규칙이 유지되어야 합니다.
5. 서로 다른 두 탭을 열고 설정을 바꿔, 기존 탭에서도 설정 변경이 반영되는지 확인합니다. 이미 로드한 광고 요청을 되돌릴 수는 없으므로 네트워크 차단 비교에는 항상 새로고침을 사용합니다.

## 네트워크 규칙 확인

이 fixture의 광고는 로컬 모형이므로, 요소가 사라지는 것만으로 네트워크 차단이 검증되지는 않습니다.

Chrome에서 제공하는 `chrome.declarativeNetRequest.testMatchOutcome()`은 실제 요청을 보내지 않고 규칙 일치를 확인하는 방법입니다. Chrome 103 이상에서 압축 해제 확장에 제공되는 개발용 API입니다. 실제 요청의 `onRuleMatchedDebug` 이벤트를 추가로 관찰하려면 별도의 `declarativeNetRequestFeedback` 권한이 필요합니다. 지원 조건은 [공식 DNR 문서](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-testMatchOutcome)를 확인합니다.

1. 확장 서비스 워커의 개발자 도구 콘솔을 엽니다.
2. 기본 규칙 파일에서 실제 차단 대상 호스트 하나를 고릅니다. 아래의 `AD_HOST_FROM_RULES`를 그 호스트 이름으로 교체합니다.
3. fixture 탭을 선택하고 아래 코드를 실행합니다. `tabId`가 fixture 탭의 ID인지 먼저 확인합니다. 확장 관리 화면이 선택되어 있다면 fixture 탭 ID를 직접 넣습니다.

```js
const fixtureTabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8766/*' });
const fixtureTab = fixtureTabs.find(tab => tab.url === 'http://127.0.0.1:8766/');
if (!fixtureTab) throw new Error('fixture 탭을 먼저 여세요.');
await chrome.declarativeNetRequest.testMatchOutcome({
  url: 'https://AD_HOST_FROM_RULES/banner.js',
  initiator: 'http://127.0.0.1:8766',
  type: 'script',
  tabId: fixtureTab.id
});
```

4. 반환된 `matchedRules`의 ID를 실제 규칙과 대조합니다. 기능 활성 상태에서 차단 규칙이 일치하는지, 사이트 일시 정지와 전체 끄기 상태에서는 최종적으로 요청이 허용되는 구성이 되는지 확인합니다. 허용 규칙이 추가되는 방식이면 단순히 결과 배열이 비어 있는지만 확인하지 말고 규칙의 action과 우선순위도 확인합니다.
5. 동일한 방식으로 `https://example.com/article.js` 같은 정상 요청이 광고 차단 규칙에 걸리지 않는지 확인합니다. `testMatchOutcome()`은 요청을 전송하지 않습니다.

실제 웹사이트에서 확인하려면 개발자 도구의 Network 탭을 연 채 새로고침하고 해당 광고 요청이 Chrome에 의해 차단되는지 확인합니다. 다른 광고 차단 확장 프로그램은 비교를 위해 꺼 둡니다. 네트워크 오류 표지만으로 이 확장 프로그램이 원인이라고 단정하지 말고, 이 확장의 활성·일시 정지 상태를 바꿔 비교합니다.

## 규칙 관리와 가져오기

1. 팝업의 **규칙 관리 · 백업**으로 관리 화면을 엽니다. 저장된 규칙을 사이트·선택자로 검색하고, 하나를 일시 중지하면 해당 요소만 복원되는지 확인합니다. 다시 켜면 숨겨져야 합니다.
2. 백업을 내보낸 다음 같은 파일을 선택합니다. 미리보기의 중복 건수를 확인하고 적용해도 규칙이 중복 생성되지 않아야 합니다. 파일을 선택만 했을 때는 설정이 바뀌지 않아야 합니다.
3. 지원하지 않는 JSON이나 손상된 파일을 고르면 오류가 표시되고 이전 파일의 적용 버튼도 비활성화되어야 합니다.
4. 광고 서버 규칙에 URL 대신 도메인만 입력합니다. 요청 출처를 지정하면 그 호스트와 하위 도메인에서 시작하는 제3자 요청에만 적용됩니다. 다른 회사 iframe의 요청은 별도 출처로 취급됩니다.
5. 네트워크 규칙을 끄거나 삭제한 뒤 새로고침하면 요청이 복원되는지 확인합니다. 사이트 예외와 전체 차단 끄기도 새로고침 후 사용자 규칙보다 우선해야 합니다.
6. 백업은 수동 숨김·광고 서버·사이트 예외만 합치며 전체 차단 상태는 바꾸지 않습니다. 기존 항목의 켜짐/꺼짐 설정이 중복 가져오기로 덮어써지지 않아야 합니다.

## 공개 필터

1. **규칙 관리 → 공개 광고 필터**에서 실제 활성 상태, EasyList/한국어 목록 버전, 생성 시각과 규칙 수를 확인합니다. 배포 파일 누락이나 브라우저 규칙 한도 오류가 있으면 수동 규칙 목록은 계속 사용할 수 있어야 합니다.
2. 일반 사이트에서 공개 필터를 끄고 새로고침해 비교합니다. 우클릭으로 저장한 규칙과 네이버·디시 기본 보완 규칙은 계속 적용되어야 합니다. 다시 켜도 수동 규칙이 사라지거나 중복되면 안 됩니다.
3. 전체 차단 또는 현재 사이트 차단을 끄면 공개 CSS 숨김도 해제되어야 합니다. 네트워크 변경 비교는 페이지를 새로고침합니다.
4. 정상 기사·검색 입력·영상 영역을 확인합니다. 공개 목록의 허용 예외가 있는 호스트는 해당 범주의 숨김을 적용하지 않아야 합니다. 예를 들어 포함된 EasyList는 localhost/일부 사설 IP에 범용 CSS 숨김 예외를 두므로 로컬 fixture만으로 범용 CSS 적용 여부를 판단하면 안 됩니다.
5. `tests/public-filters.browser.test.mjs`는 실제 확장을 별도 Edge 프로필에 로드하고, 외부 서버에 요청하지 않는 규칙 판정과 모형 페이지로 두 목록의 차단·허용, 동영상/문서 요청 제외, 공개 CSS·수동 규칙 독립성, 전체/사이트 중지를 검사합니다.

## 범위 제한

- 영상 내부 광고, 광고 차단 감지 우회, 모든 사이트의 광고 제거는 검증 범위에 포함하지 않습니다.
- Chrome 내부 페이지, Chrome 웹 스토어 등 확장 콘텐츠 스크립트가 실행되지 않는 페이지는 지원 대상이 아닙니다.
- cross-origin iframe, 동적 DOM 재생성, 과도하게 넓은 수동 선택자를 위 절차로 특히 확인합니다.
- 저장된 규칙을 삭제하거나 사이트 차단을 잠시 끄면 잘못 숨긴 콘텐츠를 복구할 수 있어야 합니다.

## 2026-10-06 Adblock-tester 검증 기록

공통 가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`를 적용했다. 별도 Chrome 153 테스트 프로필에 0.5.0만 설치하고 로컬 표본부터 확인한 뒤 Adblock-tester 3.1.1을 비교했다. 전체 차단 설정은 실제 확장 메시지 경로로 OFF→ON, ON 재탐색은 캐시 무시를 사용했다. 실제 UI 클릭 검사와 구분한다.

- 사이트 표시 점수: OFF 48/100, ON 75/100. 11개 서비스·22개 검사이며 차단률 75%라는 뜻은 아니다.
- PASS: 로컬 배너 2개 OFF 표시→ON 숨김과 정상 본문 보존. AdSense·Yandex Direct·GIF·PNG 요청은 OFF 200→ON ERR_BLOCKED_BY_CLIENT, 해당 DNR block 규칙과 대조했다. SWF 파일도 같은 차단 변화를 확인했다.
- FAIL(해당 추적 차단 기준): Google Analytics·Hotjar·Yandex.Metrica·Sentry·Bugsnag 로딩/전송이 남았다. 완전한 추적 방지는 현재 확장의 보장 범위가 아니다.
- 판정 제한: Custom은 OFF에서도 ORB 차단이며 일부 스크립트는 HTTP 200인데 사이트가 추정 통과를 표시했다. 기존 공개 목록의 48776번은 이 테스트 사이트의 `/banners/` 전용 차단 규칙이다. 점수로 일반 사이트 성능을 단정하지 않는다.
- PASS: 이번 자동 검사 111개, 실패 0개·생략 0개. Node·모의 메시지 Chrome DOM·실제 Edge 확장 검사를 포함하며 모두 실제 Chrome UI 검사는 아니다.
- BLOCKED: 실제 확장 action으로 팝업 대상이 생성됐지만 snapshot 전에 사라져 버튼 조작은 검증하지 못했다.
- NOT RUN: 이번 세션의 실제 사이드바, worker 종료·재시작/디버거 해제, 반복 성능 측정.
- 코드·필터 수정 없음. 최종 전체 차단/공개 필터 ON, 수동 규칙·사용자 요청 규칙·사이트 예외 0개. 개인 Chrome 프로필은 건드리지 않았다.

항목별 결과: `test-results/adblock-tester-20261006.json`. OFF/ON 화면·텍스트와 규칙 판정 파일은 같은 폴더의 `adblock-tester-*`, 자동 검사 로그는 `acceptance-20261006-tests.txt`에 있다.

## 2026-10-06 · 0.6.0 추적 차단 강화 검증

가이드: `docs/CHROME_EXTENSION_ACCEPTANCE.md`. 격리 Chrome 153 + DevTools MCP 1.10.1, 실제 소스 폴더의 확장, 다른 확장 없음. 개인 Chrome 설정은 변경하지 않음.

| 검사 | 결과 | 증거/범위 |
|---|---|---|
| 실제 옵션 UI의 두 스위치 조작 | PASS | 분석·추적 켬 후 오류 수집 켬. extension reload 후 저장 상태 유지 |
| Adblock-tester 분석·추적 ON | PASS | 캐시 무시 재로드 2회 모두 90/100. privacy-tracking-run1/2.json |
| Adblock-tester 두 설정 ON | PASS | 캐시 무시 재로드 2회 모두 100/100. privacy-both-run1/2.json. 최종 0.6.0 reload 후도 100 |
| 실제 요청 차단 | PASS | gtag, Hotjar, Metrica, Sentry, Bugsnag 요청 ERR_BLOCKED_BY_CLIENT. privacy-native-matches.json에서 dynamic DNR 일치 확인 |
| 일반 GTM 컨테이너 유지 | PASS | /gtm.js 요청 testMatchOutcome의 matchedRules 빈 배열 |
| 사이트 일시 중지 | PASS | 옵션 페이지의 내부 메시지로 tester 사이트 일시 중지 후 실제 페이지 재로드. gtag/Hotjar/Metrica/Sentry/Bugsnag 스크립트 모두 HTTP 200. 이후 예외 제거·재로드하여 100점 복원. 사용자 팝업 UI 검사는 아님 |
| 스포츠서울 홈 | PASS | 두 설정 ON 재로드 후 기사 링크 311개, 로드된 큰 이미지 32개, 광고 허용 안내/오류 iframe 없음 |
| 스포츠서울 기사 /news/read/1639264 | PASS | 두 설정 ON 재로드 및 지연 관측. 본문 2485자, 큰 이미지 12개, 광고 허용 안내/오류 iframe 없음 |
| 과거 고정 160×600 광고의 실사이트 이동 | NOT RUN | 이번 응답에 해당 광고 구조가 없어 재현되지 않음. 전체 광고 제거·감지 회피 성공을 의미하지 않음 |
| 저장 이동 규칙의 재로드 유지 | PASS (fixture) | 광고 이름·주변 구조 변경 재현을 포함한 기존 브라우저 테스트 통과 |
| 자동 테스트 | PASS | privacy-tests.txt: 114 통과, 0 실패, 0 건너뜀. Node 단위/모의 브라우저/네이티브 확장 테스트 혼합 |
| 옵션 페이지 콘솔 | PASS | 관측 시 error/warn 없음 |

사이트 예외는 최상위 문서의 allowAllRequests를 통해 다음 탐색부터 자식 프레임 요청까지 허용한다. `privacy-native-site-pause.json`의 고립된 하위 요청 testMatchOutcome는 이 문서 상태를 시뮬레이션하지 않으므로 세 결과가 같으며, 사이트 예외의 실패/성공 판정에 사용하지 않았다. 실제 페이지 재로드와 HTTP 200으로 별도 검증했다.

기존 OFF 48점/기본 광고 차단 75점 결과는 앞선 baseline 기록이다. 점수는 로딩 실패 등을 포함하는 사이트 자체 지표이며 범용 차단율이 아니다. 기존 공개 목록의 tester 배너 경로 전용 규칙은 그대로이고, 이번에는 서비스 공통 차단 규칙만 추가했다. EasyPrivacy 전체 도입이나 자동 필터 갱신은 하지 않았다. 광고 이동 코드는 유지했으며 스포츠서울 전체 허용 예외는 추가하지 않았다.

최종 테스트 프로필: 전체·공개 필터·분석 추적·오류 수집 켜짐, 사이트 예외 없음. 사용자 프로필에는 확장 새로고침과 선택 설정 활성화가 필요하다. 새 설정의 기본값은 둘 다 꺼짐.

최종 추가 수정: 옵션 화면의 영역 링크(`#privacy-heading` 등)를 열었을 때 설정 페이지 인증이 실패하던 기존 URL 비교를 수정했다. 동일 확장 ID와 정확한 파일 경로 검사는 유지하고 fragment만 제외한다. 새 회귀 테스트를 포함하여 영향 범위인 background/options 38개를 재실행해 모두 통과했다(`privacy-anchor-tests.txt`). 총 고유 테스트는 115개이며 전체 114개 통과 뒤 변경된 범위 38개를 재검증한 결과다. 실제 Chrome 0.6.0에서 fragment 주소로 열기·저장 상태 읽기를 다시 확인했다.

## 2026-10-06 · 두 번째 외부 벤치마크: AdBlockBench

- URL: https://adblockbench.com/ · 화면 표시 엔진 v3.0.0.
- 확장 0.6.0, 기존 격리 Chrome 153, 다른 확장 없음. 사용자 프로필 변경 없음. 소스·차단 규칙 변경 없음.
- 선정 이유: 34개 항목에서 광고 네트워크/요소 숨김, 추적, 지문, 개인정보 API, 지연 요청·worker를 분리한다. 6개 항목은 비채점이며 채점 신호는 네트워크 23, cosmetic 13, API 4이다. 기존 Adblock-tester와 동일한 점수 척도가 아니다.
- 설정 전환은 신뢰된 옵션 페이지의 runtime 메시지로 수행했다(메시지 통합 검사). 매번 캐시 무시 새로고침 후 실제 Run 버튼을 클릭하고 Test complete 표시까지 기다려 저장했다. UI 설정 스위치 재검증은 이 작업의 범위 밖이다.

| 모드 | 종합 | Network 점수/차단 수 | Cosmetic 점수/차단 수 | API 점수/차단 수 |
|---|---:|---|---|---|
| 전체 OFF | 0 | 0 · 0/23 | 0 · 0/13 | 0 · 0/4 |
| 기본 광고 차단(공개 필터 ON, 추가 두 설정 OFF) | 49 | 36 · 9/23 | 92 · 12/13 | 0 · 0/4 |
| 추적·오류 수집 모두 ON, 1회 | 54 | 46 · 11/23 | 92 · 12/13 | 0 · 0/4 |
| 추적·오류 수집 모두 ON, 2회 | 54 | 46 · 11/23 | 92 · 12/13 | 0 · 0/4 |

점수는 사이트의 가중 집계이며 차단 수를 단순 백분율로 환산한 값이 아니다. 전체 OFF도 2회 관측해 모두 0점이었으며 최종 완료 결과를 off.json에 저장했다. 강화 설정은 34개 테스트 중 blocked 12, leaked 16, inconclusive 0, not scored 6으로 표시되었다. 광고 형식은 12개 중 10개 통과, Video Pre-roll과 Social Feed Ad는 일부 신호 실패다. 동영상 광고는 현재 확장의 명시적 비목표이지만 이 벤치마크 총점에는 포함된다.

실제 네트워크에서 AdSense/DoubleClick/GA/Hotjar는 ERR_BLOCKED_BY_CLIENT. Facebook fbevents/픽셀, Clarity(204), 자체 Matomo, FingerprintJS, ScorecardResearch, LinkedIn/Pinterest/Reddit 픽셀 등은 응답이 도착했다. 별도 native testMatchOutcome에서도 GA/Hotjar는 dynamic 20000/20002, AdSense는 public_ads 51954가 일치했고 Facebook/Clarity/Matomo/FingerprintJS는 일치 규칙이 없었다. Session Replay 등의 그룹은 Hotjar가 차단되어도 Clarity가 통과하면 실패할 수 있어 개별 요청과 그룹 결과를 구분한다. 지연 주입 실패를 MV3 자체의 불가능성으로 해석하지 않는다.

오탐 관측: 벤치마크가 무해한 decoy로 분류한 https://advibe.click/decoy/gpt.js 도 차단되었으며 public_ads 416이 일치했다. 이는 경로 기반 공개 필터가 정상 파일도 막을 수 있다는 증거다. 사이트의 전체 사용자 Over-blocking 통계와 이번 실행의 관측값은 구분한다.

사이트의 서버 확인 표시는 confirmed 12, disagreement 0, couldn't verify 2. 자동화 브라우저 세션은 공개 통계 집계에서 제외됐다는 안내가 표시되었다. 사이트 점수를 객관적인 제품 순위나 모든 실사이트 차단율로 해석하지 않는다.

결론: 화면 요소 숨김은 비교적 강하지만 범용 추적 차단의 범위가 좁다. 다음 개선 후보는 EasyPrivacy 등의 지원 가능 규칙 검토·추적 서비스 확대이며, 브라우저 지문/API 보호는 별도 기능으로 평가해야 한다. 이번 요청은 검증이므로 벤치마크 전용 필터 추가, 사이트 전체 차단, 기능 확대는 하지 않았다. 스포츠서울 호환성은 이전 검증 결과를 그대로 참조하며 이번에는 재검증하지 않았다.

증거: test-results/adblockbench-{off,basic,enhanced-1,enhanced-2}.json, adblockbench-native-matches.json, adblockbench-enhanced.png.
최종 설정은 작업 전 상태로 복원: 전체/공개/추적/오류 수집 ON, 사이트 예외/사용자 규칙 없음.

## 2026-10-06 · 0.7.0 차단 강화·아이콘 검증

가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`를 적용한 격리 Chrome 153 / DevTools MCP 1.10.1. 실제 확장 0.7.0, 다른 확장 없음. 개인 브라우저 설정 변경 없음. 이전 저장 규칙과 일시 중지 기능 유지.

변경: 선택형 분석·추적 규칙 6 → 39개. 주요 SNS 픽셀, Clarity, Matomo/Piwik, 분석 서비스, FingerprintJS 로더와 제한된 analytics collection 패턴을 포함한다. 오류 수집 4개는 독립이며 IDs는 21000번대로 고정하여 다른 스위치와 무관하게 유지한다. 새 권한 없음. Canvas/audio API를 변조하지 않으며 동영상 내 광고는 구현하지 않았다. 새 규칙에는 벤치마크 전용 도메인·DOM 선택자가 없다. 일반 수집 패턴은 EasyPrivacy 참고 출처를 기록했다.

| 검사 | 결과 | 증거 |
|---|---|---|
| AdBlockBench 강화 ON, cache ignore reload | PASS | 75점 2회 동일; 이전 버전 동일 설정 54점. Network 21/23 (89점), Cosmetic 12/13 (92점), API 0/4 |
| Adblock-tester 강화 ON | PASS | 100점 유지; strengthen-adblock-tester.json |
| 실제 신규 요청 차단 | PASS | Facebook fbevents/픽셀, Clarity, Matomo, FingerprintJS, ScorecardResearch, LinkedIn/Pinterest/TikTok/Reddit 스크립트 ERR_BLOCKED_BY_CLIENT |
| 요청 범위 네이티브 검사 | PASS | strengthen-scope-checks.json 16건. 추적 스크립트·수집 hit는 block. 정상 Facebook API, Pinterest/LinkedIn 이미지, source map, 일반 API collect, GTM container, main_frame/media 제외는 일치 규칙 없음 |
| 스포츠서울 홈 | PASS | 강화 ON 재로드·지연 관측. 기사 링크 311, 본문 8924자, 큰 이미지 32; 광고 허용 안내/오류 iframe 없음 |
| 스포츠서울 기사 /news/read/1639264 | PASS | 본문 2485자, 큰 이미지 12; 광고 허용 안내/오류 iframe 없음 |
| 과거 고정 광고 실사이트 이동 | NOT RUN | 이번 응답에는 이동 대상 160×600 광고 구조 없음. 이동 코드 변경 없음; 저장 이동/새로고침 재현 테스트 PASS |
| 자동 테스트 | PASS | strengthen-tests.txt: 전체 115 통과, 실패/건너뜀 0. 추가 아이콘 회귀를 포함한 state 15개 재실행 PASS(strengthen-assets-tests.txt). 총 고유 테스트 116개 |
| 아이콘 파일 | PASS | 직접 작성한 SVG와 16/32/48/128px PNG. PNG 서명·실제 크기 검증, manifest icons/action 등록. 실제 확장 페이지에서 .brand-mark의 로컬 SVG URL과 favicon 확인 |
| 설정 페이지 콘솔 | PASS | error/warn 없음 |

AdBlockBench의 남은 실패는 Video Pre-roll(network), Social Feed Ad(cosmetic), MV3 Late Injection(network), Canvas/audio, Privacy Sandbox/opt-out API다. 마지막 유형은 이번 구현 범위 밖이다. 총점과 네트워크 점수는 사이트의 가중 점수로 단순 차단율과 다르다. 기존 공개 필터의 /decoy/gpt.js 오탐은 여전히 있으며 새 규칙으로 넓히거나 벤치마크만 예외 처리하지 않았다. /decoy/beacon은 HTTP 204로 유지.

서버 확인은 confirmed 12, disagreement 0, couldn't verify 2이며 자동화 세션은 공개 집계에서 제외되는 안내가 표시된다. 실측 결과의 제품 전체 순위·모든 사이트 차단 보장은 하지 않는다. 스포츠서울 페이지 표시 검증과 모든 광고 제거는 구분한다.

아이콘 원본 icons/mark.svg는 녹색 방패·체크 형태이며 자체 작성했다. 재생성 도구 tools/build-icons.mjs는 개발용이고 확장의 런타임 의존성이 아니다. 실제 팝업 수명주기 검사는 이번에 재수행하지 않았으며 popup.html 일반 확장 탭에서 아이콘 리소스를 확인했다.

최종 테스트 프로필: 전체·공개·추적·오류 수집 ON, 예외/사용자 규칙 없음. 새 기능의 기본 추적 설정은 종전처럼 OFF이며 기존 ON 설정은 유지된다. 사용자는 확장 관리 화면의 새로고침 뒤 웹페이지도 새로고침하면 적용된다.

## 2026-10-06 · 0.8.0 독립 영상 광고·지문 보호

가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`를 적용했다. 실제 소스 폴더의 0.8.0 확장, 격리 Chrome 153 / DevTools MCP 1.10.1, 다른 확장 없음. 개인 Chrome 프로필은 변경하지 않았다. 영상 광고·지문 보호는 실제 옵션 UI 스위치로 활성화했고 전체 OFF/ON 대조는 신뢰된 옵션 페이지의 runtime 메시지로 수행했다. 기존 추적·오류 수집 ON 설정은 유지했다. 두 새 기능의 설치 기본값은 OFF다.

변경: 영상 광고 스크립트/일부 광고 요청 DNR 2개, 선택형 Canvas·오디오 MAIN 문서 시작 스크립트, 광고 표시를 요구하는 피드 요소 숨김 2개. `scripting` 권한 추가. 전체·사이트 일시 중지가 우선하며 등록/저장 실패는 이전 상태로 복구한다. 스포츠서울 이동 코드는 변경하지 않았다. 벤치마크 전용 호스트나 점수 변경 코드는 추가하지 않았다.

| 검사 | 결과 | 증거/범위 |
|---|---|---|
| 새 옵션 UI 두 스위치 | PASS | 각각 독립 활성화. 브라우저 회귀 테스트도 다른 스위치를 유지하는지 검사. advanced-settings-ready.txt / advanced-final-settings.txt |
| AdBlockBench 강화 ON, cache ignore reload | PASS | 92점 2회 동일. Network 100점(23/23), Cosmetic 100점(13/13), API 53점(2/4). advanced-adblockbench-run1/2.json / advanced-adblockbench-92.png |
| AdBlockBench 전체 OFF 재로드 | PASS | 0점, 모든 채점 신호 통과. advanced-adblockbench-off.json. 검사 후 전체 ON 복원 |
| 실제 신규 영상 요청 차단 | PASS | IMA ima3.js 초기/지연 요청, DoubleClick pagead/ads?ad_type=video 모두 ERR_BLOCKED_BY_CLIENT. advanced-bench-network.txt |
| 지문 보호 실제 등록 | PASS | 패키지 스크립트, MAIN, document_start, allFrames false, persistAcrossSessions true. 확장 reload 후 저장된 설정에서 등록 복원. advanced-final-registration.json |
| Adblock-tester | PASS | 모든 선택 보호 ON에서 100/100. advanced-adblock-tester.json |
| 스포츠서울 홈 | PASS | 새 보호 모두 ON 재로드 후 main 8937자, 기사 링크 311개, 로드된 큰 이미지 34개. 광고 허용 안내/오류 iframe 없음. advanced-sports-home.json |
| 스포츠서울 기사 /news/read/1639264 | PASS | main 2498자, 큰 이미지 14개. 광고 허용 안내/오류 iframe 없음. advanced-sports-article.json/png |
| 네이티브 페이지 시작·사이트 예외 | PASS | 별도 실제 Edge 확장에서 첫 인라인 스크립트부터 Canvas/오디오 보호 적용. 사이트 일시 중지·재개와 설정 해제 후 재로드 값 복원. advanced.native.test.mjs |
| 정상 캔버스·오디오·HTML5 영상 | PASS (local) | 캔버스 표시 원본 보존, PNG dataURL/Blob 내보내기, 네이티브 오류 유지. 오디오 writable view/반복 읽기 안정, 미세 변경 <1e-6. canvas.captureStream → video.play 성공 |
| 일반 피드 보존 | PASS (fixture) | 광고 표시 있는 행 숨김, 일반 글·영상 포함 행 보존. 전체 OFF 후 복원 |
| 자동 테스트 | PASS | advanced-tests.txt: 120 통과, 실패/생략 0. 단위·모의 브라우저·실제 확장 검사 혼합 |
| 옵션 콘솔 | PASS | 관측한 error/warn 없음 |
| IMA 의존 실제 영상 사이트 재생 | NOT RUN | 일반 HTML5 영상 검사로 광고 SDK 의존 플레이어의 정상 재생을 보장하지 않음 |
| 과거 160×600 스포츠서울 광고 이동 | NOT RUN | 이번 응답에서 이전 고정 광고 구조가 없어 재현되지 않음. 기존 저장 이동 재삽입/재로드 회귀 테스트는 통과 |

벤치마크 서버 확인은 confirmed 12, disagreement 0, couldn't verify 2이며 자동화 세션은 공개 통계에서 제외됐다는 안내가 표시됐다. 검사 초기에 최상위 문서 ERR_CONNECTION_TIMED_OUT가 있었지만 전체 OFF 및 ON 모두 재접속에 성공했다. 타임아웃을 필터 차단 결과로 포함하지 않았다. 점수는 테스트 신호의 가중 집계이며 모든 실제 광고·추적 요청의 차단율이 아니다. 일부 서버 확인용 probe 요청은 HTTP 200으로 도착하므로 23/23을 모든 네트워크 요청 차단으로 표현하지 않는다.

남은 채점 실패는 Privacy Sandbox와 Opt-out Signals다. Chrome의 광고 개인정보 설정 변경이나 GPC 값 주입은 하지 않았다. 기존 공개 필터의 무해한 /decoy/gpt.js 차단 오탐은 그대로이며 /decoy/beacon은 HTTP 204다. 지문 보호는 미세 노이즈를 넣는 제한된 방식으로 최상위 Canvas·Audio만 대상으로 하며 삽입 프레임·Worker·WebGL 등의 우회와 지문 수집 전반을 막지는 못한다. 오디오 샘플과 이미지 내보내기 결과에 작은 차이가 생길 수 있다. 설정 해제·사이트 일시 중지 후 API 원복에는 재로드가 필요하다.

최종 격리 테스트 프로필은 전체·공개·추적·오류 수집·영상 광고·지문 보호 ON, 예외/사용자 규칙 없음이다. 개인 프로필에서는 확장 새로고침 뒤 새 옵션을 직접 켜고 웹페이지를 새로고침해야 한다. 이번에 팝업 수명주기와 실제 사이드바 조작을 재검증한 것은 아니다.

## 2026-10-06 · 0.8.1 디시 개죽이 방해 요소

대상: https://gall.dcinside.com/board/view/?id=dcbest&no=468195 . 가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`, 실제 소스의 확장 0.8.1, 격리 Chrome 153. 개인 프로필은 변경하지 않았다. 새 권한·옵션·네트워크 규칙은 추가하지 않았으며 기존 선택 설정과 저장 규칙을 유지했다.

관측: `body > style#styleGaejuki`가 콘텐츠 배경 투명화, `.moveimg` 이동 애니메이션, 일부 z-index를 정의했다. 실제 그림은 별도 `body > div#gaejukimg > img`이며 주소는 `https://nstatic.dcinside.com/dc/w/images/moveimg.png`였다. 같은 인라인 스크립트는 빈 전체 화면 `.click-blocker`를 만들어 3초 뒤 제거한다. STYLE 요소에 display:none만 설정해도 CSS는 계속 적용되므로 전용 시트의 media를 `not all`로 바꾸고 원래 값을 보관한다. 전용 이미지와 빈 클릭 방해 레이어는 기존 숨김·복원 경로를 사용한다. 일반 본문·메뉴·대화상자와 타 사이트에 대한 광범위한 fixed/z-index 필터는 추가하지 않았다.

| 검사 | 결과 | 증거/범위 |
|---|---|---|
| 실제 원인 관측 | PASS | gaejuki-before.json / gaejuki-structure.json. 움직이는 이미지와 스타일, 클릭 방해 코드 확인 |
| 실제 게시글 제거 | PASS | gaejuki-reproduced-on.json: 원래 요소가 DOM에 있는 상태에서 display:none, 스타일 media:not all. 본문 이미지 8개 모두 로드, 본문 표시 유지. gaejuki-after.png |
| 실제 사이트 일시 중지·재개 | PASS | 신뢰된 옵션 페이지 runtime 메시지로 전환. 중지 시 media:null/display:block, 재개 시 not all/none. gaejuki-site-paused/resumed.json. 사용자 팝업 UI 검사와 구분 |
| 재등장·스타일 재설정 | PASS (fixture) | 사이트가 display:block!important 또는 media:screen으로 바꾸거나 그림/시트를 교체해도 재적용. 중지 시 원래/새 media 값과 표시 복원 |
| 빈 전체 화면 클릭 방해 레이어 | PASS (fixture) | 알려진 시트·이미지와 빈 fixed/inset:0 구조일 때 숨김. 자식 버튼을 포함한 일반 대화상자 보존. 실제 레이어는 3초 수명으로 관측 시 이미 삭제되어 별도로 fixture 검증 |
| 정상 이미지·타 사이트 보존 | PASS (fixture) | 본문 안의 같은 그림 주소 보존. 유사 호스트·dcinside.com 루트·전용 구조가 없는 이미지/레이어는 숨기지 않음 |
| 관련 회귀 테스트 | PASS | gaejuki-regression-tests.txt: picker.browser + state 39개 통과, 실패/생략 0. 전체 자동 테스트를 이번에 다시 실행한 것은 아님. gaejuki-focused-tests.txt의 신규 2개는 이 39개에 포함 |

첫 새로고침에서는 사이트가 개죽이 요소를 보내지 않았다(gaejuki-after.json). 사이트 코드가 `gaejuki_ad=1; max-age=43200; path=/` 쿠키를 설정하는 것을 확인해, 격리 테스트 프로필의 해당 쿠키 하나만 지우고 다시 요청했다. 이후 실제 스타일/이미지가 응답에 포함되어 차단을 확인했으며 사이트가 쿠키를 1로 다시 설정한 상태도 기록했다. 개인 쿠키·설정 변경은 없다. 개죽이가 없는 응답만으로 차단 성공을 판정하지 않았다.

지연 삽입은 기존 MutationObserver와 40ms 예약 처리를 사용한다. 픽셀 단위의 순간 노출이 전혀 없다는 보장은 하지 않는다. CSSOM만 직접 수정하는 변형이나 다른 이미지 주소·다른 사이트의 새로운 방해 요소는 추가 확인이 필요하다. 다른 방해물은 기존 수동 요소 숨기기로 처리할 수 있다. 새 벤치마크 실행은 하지 않았으며 92/100점은 0.8.0에서 기록한 결과다. 최종 테스트 프로필은 기존 모든 보호 ON, 사이트 예외 없음으로 복원했다.

## 2026-10-06 · 0.9.0 남은 Sandbox·Opt-out 항목 보완

가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md` 적용, 격리 Chrome 153, 실제 확장 폴더 0.9.0. 새 옵션은 실제 설정 UI 스위치로 각각 켰으며 전체·사이트 예외의 복원은 별도 네이티브 Edge 확장의 메시지 통합 검사로 검증했다. 새로운 권한·원격 코드·벤치마크 전용 호스트 규칙은 추가하지 않았다. Chrome의 전역 privacy 설정은 변경하지 않았다.

조사: 벤치마크는 Sandbox API의 함수/속성 노출 및 navigator.globalPrivacyControl=true를 판정한다(api-benchmark-source.json). Chrome privacy API로 전역 광고 설정을 끄는 방법은 있지만 전체 프로필에 영향을 주며 API 노출 판정과 같지 않다. 사이트별 예외를 유지하기 위해 문서별 API 노출 제한과 실제 Permissions-Policy를 결합했다. GPC는 JS 속성뿐 아니라 실제 Sec-GPC: 1 요청 헤더를 더했다.

| 검사 | 결과 | 증거/범위 |
|---|---|---|
| 새 옵션 각각 독립 활성화 | PASS | privacy-api-options-ready.txt / privacy-api-options-sandbox.txt. 옵션 브라우저 테스트 포함 |
| AdBlockBench 초기 후보 | PASS (candidate) | privacy-api-bench-run1.json: 100점. 이후 네이티브 검사에서 발견한 탐색 요청 헤더 누락을 수정하고 최종 확장을 다시 로드 |
| AdBlockBench 최종 0.9.0 재로드 | PASS | privacy-api-bench-run2.json: 100점, Network 23/23, Cosmetic 13/13, API 4/4. blocked 28/leaked 0/not scored 6 |
| 실제 Chrome의 API·정책 | PASS | privacy-api-chrome-state.json: Topics/경매/token 함수 undefined, attributionSrc 노출 제거, GPC true. 지원하는 Topics/token 정책 allowsFeature false |
| 네이티브 실제 GPC 요청 | PASS | privacy-api-native-proof.json: 최상위 탐색·iframe·fetch 요청을 로컬 HTTP 서버가 Sec-GPC: 1로 수신. JS true도 첫 인라인 스크립트에서 확인 |
| 실제 Sandbox 정책 제한 | PASS | 기존 geolocation=() 정책 보존. Topics·Private State Token 지원 정책은 최상위/하위 프레임 모두 false. 하위 프레임의 원래 prototype은 그대로여도 정책 제한됨 |
| API·신호 해제와 사이트 예외 | PASS (native) | 사이트 일시 중지·전체 OFF·옵션 OFF 후 재로드하여 원래 함수/속성과 헤더 없는 상태 복원. 재개 후 다시 보호 |
| 여러 등록 스크립트의 갱신·복구 | PASS | 기존 지문 스크립트를 보존하며 GPC/Sandbox 추가·제거. 저장 실패 시 등록과 DNR 모두 이전 상태 복원. background 회귀 테스트 |
| Adblock-tester | PASS | 100점 유지. privacy-api-adblock-tester.json |
| 스포츠서울 홈 | PASS | main 8945자, 기사 링크 311개, 큰 로드 이미지 29개, 광고 허용 안내/오류 iframe 없음. privacy-api-sports-home.json |
| 스포츠서울 기사 /news/read/1639264 | PASS | main 2498자, 큰 이미지 14개, 광고 허용 안내/오류 iframe 없음. privacy-api-sports-article.json |
| 전체 자동 테스트 | PASS | privacy-api-all-tests.txt: 127개 통과, 실패/생략 0, 72초. Node/모의 UI/네이티브 확장 혼합 |
| 전체 사용자 Chrome/로그인/결제 호환성 | NOT RUN | 개인 프로필에 연결하지 않음. Private State Token을 사용하는 인증 사이트 등 모든 사이트를 보장하지 않음 |
| 유튜브 영상 광고 차단 | NOT IMPLEMENTED / NOT RUN | 사이트 전용 광고 메타데이터·플레이어 처리 코드는 추가하지 않았으며 광고 재생·스킵 성공 검사를 수행하지 않음 |

GPC 첫 후보의 DNR resourceTypes 생략은 main_frame 요청을 제외했다. 이를 발견한 네이티브 테스트는 실패했고, 탐색을 포함한 명시적 resourceTypes로 수정한 뒤 네이티브·전체 테스트가 통과했다. GPC는 기존 native true 값을 제거하지 않는다. JS 신호는 최상위 HTTP(S) 문서만 대상으로 하며 삽입 프레임·Worker에는 직접 주입하지 않아 브라우저 내장 GPC와 동일한 전 범위 구현은 아니다. 서버의 신호 준수를 강제하거나 기존 동의·쿠키를 삭제하는 기능도 아니다.

Sandbox의 최상위 API 노출 감소와 지원 Permissions-Policy 제한을 구분한다. HTTP(S) 문서 정책은 기존 정책에 append하며 미지원 기능 이름은 브라우저가 무시할 수 있다. 이번 브라우저에서 직접 확인한 정책은 Topics와 Private State Token이다. 지원되지 않는 경매 등의 API까지 모든 문맥에서 완전히 차단했다는 의미는 아니다. raw Topics 호출은 NotSupportedError였으며 원래 기능의 미지원 가능성이 있으므로 이 에러 하나를 정책의 인과 증거로 삼지 않았다. policy allowsFeature=false와 실제 초기 노출 감소를 별도로 검증했다. 이미 열린 문서와 기존 프레임의 API 원복에는 재로드가 필요하다.

벤치마크 총점은 모든 광고·개인정보 유출의 차단율이 아니다. 비채점 WebGL·하드웨어·글꼴·화면 정보·Storage Access·Eval 등 6개 항목은 그대로이며, 기존 공개 필터의 decoy 오탐을 수정한 것은 아니다. 최종 결과 화면 이미지는 도구 응답 지연으로 저장 확인하지 못했으며 점수는 완료된 페이지 텍스트 JSON으로 보관했다. 최종 실제 설정/등록은 privacy-api-final-state.json이다. 검사 도중 격리 브라우저에 존재한 사용자의 유튜브 #player-ads 수동 규칙도 유지했으며 벤치마크·스포츠서울 적용 대상이 아니다. 사이트 예외 없음, 전체·공개·선택 보호 ON으로 끝냈다.

유튜브 기술 검토: uBlock의 유지보수 필터에는 유튜브 응답의 adPlacements/adSlots 정리와 플레이어 관련 전용 처리 규칙이 존재한다. 따라서 기술적으로 불가능한 것은 아니며 현재의 일반 IMA 요청 차단과는 별도 구현이 필요하다. 광고·본문이 같은 스트림에 결합된 경우 URL 차단만으로는 구분하기 어렵다. 세션·플레이어·응답 변경에 대한 회귀와 지속 갱신이 필요하다. 이번에는 조사만 수행했다.

참조: [GPC 명세](https://w3c.github.io/gpc/), [Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/), [Chrome DNR](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [Chrome privacy API](https://developer.chrome.com/docs/extensions/reference/api/privacy), [uBlock 유튜브 필터](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt), [Google DAI](https://developers.google.com/ad-manager/dynamic-ad-insertion).

## 0.10.0 — 선택형 YouTube 영상 광고 차단 (2026-10-06)

`docs/CHROME_EXTENSION_ACCEPTANCE.md` 적용. 격리 Chrome 153의 실제 확장 ID `lkgompnmammgocelehiiofajddgdhdja`, 버전 0.10.0을 확인했다. 실제 옵션 스위치 클릭으로 YouTube 차단을 켰다. 초기 기본값은 OFF이고, 일반 IMA 차단과 독립적이며 기존 옵션·숨김 규칙·사이트 예외는 보존한다. 새 권한과 원격 코드, 벤치마크 전용 규칙은 없다.

구현은 지정한 YouTube 최상위 HTTPS 문서에서만 실행하는 패키지 MAIN 스크립트다. 초기 전역 재생 객체, Fetch·XHR의 지정한 재생 응답에서 알려진 광고 필드를 제거한다. Shorts의 명시적 광고 항목만 제외한다. URL 전체 차단이나 전역 JSON.parse 변경 없이 본 영상 URL·자막·오류·일반 응답을 유지한다. 광고 클래스가 있고 보이는 활성 건너뛰기 버튼에만 클릭한다. 영상을 끝으로 강제 이동하거나 볼륨·재생 속도를 바꾸지 않는다. 삽입 프레임에는 실행하지 않으며 설정 해제/사이트 일시 중지 후 초기 상태 복원에는 재로드가 필요하다.

| 검사 | 판정 | 증거와 범위 |
|---|---|---|
| 전체 회귀 | PASS | `test-results/youtube-all-tests.txt`: 140개 통과, 실패·취소·생략 0, 약 82초. 기존 배너·선택·이동·백업·GPC·Sandbox 검사 포함 |
| YouTube 집중 검사 | PASS | `test-results/youtube-focused-tests.txt`: 11개 통과, 실패·생략 0. 모의 응답 Chrome 검사·네이티브 확장 Edge 검사·단위 검사 구분 |
| 기본값·범위·독립 옵션 | PASS | 기본 OFF, 비불리언 거부, 정확한 YouTube 호스트·최상위 문서 등록, 일반 영상 DNR 변경 없음. `youtube.test.mjs` |
| 초기 데이터 실행 순서 | PASS (native fixture) | 실제 네이티브 확장에서 OFF의 광고 필드와 ON의 첫 인라인 스크립트 광고 필드 제거 비교. 단순 네트워크 실패를 성공으로 세지 않음 |
| Fetch 응답 | PASS (fixture) | Request 입력, 중첩 재생 데이터, JSON/text/arrayBuffer, clone 두 단계, URL/status/type/header 보존. 바뀐 본문의 옛 content-length/encoding/etag 제거. 비대상 요청·비JSON·HTTP 실패·AbortError 보존 |
| XHR 응답 | PASS (fixture) | 동기/비동기·text/json, responseURL/status·원래 InvalidStateError 보존. 완료 JSON 응답의 반복 읽기를 캐시해 동일 객체 유지 |
| Shorts 항목 | PASS (fixture) | `isAd=true` 항목만 제거. false·미확인 일반 항목과 본 영상은 보존 |
| 건너뛰기 | PASS (fixture/native) | 광고 상태의 보이는 활성 버튼만 클릭. 일반 재생·비활성/숨겨진 버튼 클릭 0. 동적 버튼 표시와 Shorts 플레이어 전환 처리. 강제 seeking 0 |
| 정상 미디어 보존 | PASS (fixture) | HTML5 본 영상 재생, 음량·속도·초기 seeking을 네이티브 대조군과 비교. Chromium MediaStream 속도 제한은 대조군에서도 같음 |
| 사이트·전체·옵션 해제 | PASS (native) | 실제 사이트 예외/전체 OFF/옵션 OFF 후 재로드하면 광고 객체·원래 fetch/XHR와 스킵 없는 상태 복원. 재개하면 다시 적용 |
| 설정 저장 오류 복구 | PASS (unit integration) | 저장 실패 시 추가 YouTube 등록을 되돌리고 기존 GPC 등록·DNR·설정 보존. 페이지 콘텐츠의 무권한 설정 요청 거부 |
| 실제 Chrome UI·재시작 | PASS | 실제 스위치 클릭, 확장 재로드로 새 worker sw-12 확인 후 재연 options ON·4개 스크립트 등록 유지. `youtube-enabled-state.json`, `youtube-after-restart.json` |
| 사용자 규칙 보존 | PASS | `youtube-before-enable.json`과 재시작 후 JSON에서 기존 숨김·요청 규칙 동일. 기존 `www.youtube.com`의 `#player-ads` 규칙 1개 보존 |
| 실제 Shorts 본 영상 | PASS (content) | `youtube-shorts-live.json`: 기존 조회한 Jg9LtkH7tj0, duration 54.321초/currentTime 23.164725초/readyState 4/재생 중/오류 없음. 패치 설치 및 초기 광고 필드 없음 |
| 실제 일반 재생 본 영상 | PASS (content) | `youtube-watch-live.json`: 같은 영상, currentTime 38.689753초/readyState 4/재생 중/오류 없음. 초기 광고 필드 없음 |
| 사용 중 다른 영상의 재생 | PASS (observation) | `youtube-spa-live.json`: 사용자가 이동한 다른 일반 영상 duration 2041.961초/currentTime 2.662초/readyState 4/재생 중/오류 없음. 이를 통제된 SPA 인과 검사로 세지 않음 |
| 스포츠서울 기존 기사 | PASS (content) | `youtube-sports-compat.json`: `/news/read/1639264`, 본문 2498자·큰 이미지 13개, 광고 허용 안내/오류 프레임 없음. YouTube 스크립트는 실행되지 않음 |
| 실제 광고 재생·차단 성공률 | NOT RUN | 실사이트 표본에서 광고 재생을 만나지 못했다. 광고 필드 없음·정상 본 영상 재생만으로 실제 광고 차단 성공을 확정하지 않음 |
| 광고 정보 정리를 통과한 건너뛰기 불가능 광고·서버 결합 광고·로그인별 실험 | NOT RUN / 제한 | 명확한 광고 정보·건너뛰기 제어가 없는 광고가 남을 수 있다. 모든 영상 서비스와 SSAI, 계정·국가별 성공률을 보장하지 않음 |
| 0.10.0 벤치마크 재측정 | NOT RUN | 기존 0.9.0의 100점 결과는 역사적 기록. 이번 변경은 YouTube 호스트만 대상으로 하며 새로운 벤치마크 점수를 주장하지 않음 |

첫 후보에서는 XHR json 응답의 반복 접근이 같은 객체로 유지되지 않아 실패했고, 완료 응답 캐시를 추가한 후 전체 회귀가 통과했다. 미디어 fixture의 최초 속도 기대값은 Chromium이 live MediaStream의 속도를 1로 제한하는 동작을 잘못 해석했다. 이를 네이티브 대조군 비교로 수정했다. 잠깐 시도한 녹화 Blob은 fixture 환경에서 재생되지 않아 해당 fixture를 사용하지 않았다. 최종 미디어 검사는 실제 재생 가능한 captureStream과 네이티브 대조군을 사용한다. 이전 후보 실패 파일은 `youtube-candidate-tests.txt`, 최종 전체 결과는 `youtube-all-tests.txt`다.

실사이트 검증 중 사용자가 격리 Chrome의 탭을 이동·닫았다. 읽기 시점의 URL·영상 상태를 각각 기록했으며 사용자 탭을 되돌리거나 사용자 규칙을 삭제하지 않았다. 개발 Chrome의 YouTube 옵션은 ON으로 남겼다. 일반 개인 Chrome은 확장 관리에서 0.10.0을 새로고침한 뒤 옵션을 켜고 YouTube 페이지를 새로고침해야 한다.

기술 참고: [uBlock의 현재 YouTube 광고 필터](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt). 알려진 광고 데이터 필드와 플레이어 제어의 개념을 참고했으며 scriptlet 코드는 복사하지 않고 자체 구현했다. 서버 결합 광고의 일반적 한계는 [Google DAI 문서](https://developers.google.com/ad-manager/dynamic-ad-insertion)를 참고했으며 모든 YouTube 영상이 이 방식이라는 의미는 아니다.

## 0.10.1 — 59초 부근 재생 오류 조사와 방어 수정 (2026-10-06)

사용자가 `https://www.youtube.com/watch?v=HL0_OWSv7xo`에서 초기 약 59초까지만 로드되고 다음 구간에서 오류가 난다고 보고했다. 실제 Chrome 153에서 같은 오류를 확인했다. 0.10.0에서 짧은 초기 재생만 확인했던 결과로 긴 재생 호환성을 보장할 수 없었다.

두 충돌 가능성을 보완했다. SABR 주소를 포함한 초기/추가 재생 응답은 중첩 envelope까지 통째로 보존한다. 일반 IMA/VAST 요청 차단에서 `youtube.com`·`youtube-nocookie.com`·`youtu.be` 요청 출처를 제외한다. 기본 배너 규칙과 공개 필터는 이미 영상 서비스에 예외를 두고 있었지만 선택형 VAST 규칙 22001은 이를 덮어쓸 수 있었다. 이 네트워크 충돌의 존재와 실제 장시간 오류의 단일 원인을 구분한다. 광고 자동 건너뛰기는 유지하며 인증·재생 오류 화면을 숨기거나 성공으로 바꾸지 않는다.

| 검사 | 판정 | 증거/해석 |
|---|---|---|
| 0.10.0 오류 재현 | FAIL (live) | `youtube-error-before.json`, `youtube-error-on-control.json`: 초기 response OK와 SABR 주소가 있어도 이후 오류 화면/readyState 0 |
| YouTube 옵션만 OFF | FAIL (long playback) | `youtube-error-off-control.json`에서는 광고 정상 로드. `youtube-error-off-after-ad.json`에서는 후속 오류. 이 옵션만 끄면 완전히 해결된다는 결론을 철회 |
| VAST 규칙의 YouTube 출처 충돌 | CONFIRMED | 이전 실제 testMatchOutcome에서 22001 차단 일치. 수정 후 같은 표본에는 GPC 헤더 23000만 일치하고 22001 차단 없음. testMatchOutcome의 단일 요청 검사를 프레임의 allowAllRequests 탐색 이력 증거로 사용하지 않음 |
| SABR 데이터 보존 | PASS (fixture/native) | 초기 전역 객체·Fetch·XHR text/json·중첩 envelope·heartbeat·서명 주소를 그대로 유지, ETag 변경 없음. 원래 일반 응답 정리는 유지. 보이는 활성 건너뛰기 여전히 실행 |
| 요청 예외와 일반 SDK 차단 | PASS (native) | Edge 실제 DNR에서 YouTube 출처 VAST에는 22001 비일치, 일반 fixture의 IMA에는 22000 일치. 페이지·영상 전체 허용 규칙은 추가하지 않음 |
| 최종 전체 자동 회귀 | PASS | `youtube-sabr-final-tests.txt`: 142개 통과, 실패·취소·생략 0, 약 85초. 보호 파일 수정 전의 141개 실행은 중간 후보 결과 |
| 집중 회귀 | PASS | `youtube-sabr-focused-tests.txt`: YouTube·일반 영상 네이티브 포함 14개 통과, 실패·생략 0 |
| 수정본 실제 장시간 재생 | FAIL / 미해결 | `youtube-sabr-live-start.json`: 초기 본 영상 38.76초 정상. `youtube-sabr-live-after-minute.json`: 이후 같은 오류. 방어 수정만으로 실사이트 문제가 해결됐다고 표현하지 않음 |
| 기존 프로필의 전체 사이트 일시 중지 | PARTIAL | `youtube-error-site-off-start.json`은 63.76초지만 readyState 1/버퍼링. 120초 탐색도 readyState 1이라 이 두 표본을 정상 재생으로 세지 않음. 이후 탭이 닫혀 지속 검사 중단 |
| 기존 프로필 일시 중지, 90초 시작 | PASS (snapshot only) | `youtube-paused-baseline-later.json`: 132.31865초/readyState 4/실제 본 영상 재생. 이를 1분 이상 연속 재생 성공으로 일반화하지 않음 |
| 확장 없는 새 비로그인 세션, 90초 시작 | PASS (snapshot only) | `youtube-clean-baseline-later.json`: 118.825558초/readyState 4/재생 중. native fetch/canvas, GPC false, YouTube 패치 없음 |
| 같은 새 비로그인 세션의 지속 재생 | FAIL (baseline) | `youtube-clean-baseline-over-two-minutes.json`: 같은 오류/readyState 0. `youtube-sabr-final-state.json`의 incognitoAllowed=false와 도구의 isolatedContext로 확장이 허용되지 않는 별도 세션임을 확인. 확장만의 문제라고 결론 내릴 수 없음 |
| 지문 보호만 OFF 비교 | NOT COMPLETE | 사용자가 해당 테스트 탭을 홈으로 이동해 `youtube-fingerprint-off-control.json`에 영상 없음. 정상/오류의 인과 증거로 사용하지 않음 |
| 설정·사용자 규칙 복원 | PASS | `youtube-sabr-final-state.json`: 기존 보호 옵션 모두 ON, YouTube ON, 사이트 예외 없음, 기존 사용자 숨김 규칙 1개 유지. 진단용 일시 중지·지문 OFF는 원복. 개인 쿠키·로그인·계정 데이터 삭제 없음 |
| 실제 로그인 비교 | NOT RUN / 사용자 확인 요청 | 테스트 프로필은 비로그인. 사용자에게 일반 Chrome의 로그인 상태에서 같은 오류가 나는지 물었으며 계정 로그인/로그아웃을 자동 조작하지 않음 |

완전한 사이트 일시 중지는 새 페이지 탐색부터 적용했고 이미 패치가 들어간 탭을 대조군으로 사용하지 않았다. 비교 중 사용자가 일부 탭을 이동·닫은 표본은 시점 관찰 또는 검사 중단으로 표시했다. 자동 회귀가 통과했어도 실사이트 장시간 재생 실패는 남아 있다. 원격 재생 세션·비로그인 접근 제한 등은 가능성이며 구체적인 서버 원인을 확정하지 않았다.

공통적인 비로그인 1분 제한은 아니다. 공식 안내는 특정 비로그인 접근을 제한할 수 있고 확장·네트워크·로그인 상태 등을 확인하라고 설명하지만 일률적 1분 상한을 설명하지 않는다. 이번 baseline은 영상의 90초 이후를 실제로 재생하다가 다시 실패했으므로 '영상 타임라인 1분 이후는 비로그인이라 절대 재생 불가'라는 해석도 맞지 않는다. [YouTube 공식 안내](https://support.google.com/youtube/answer/3037019?hl=en).

## 0.10.3 — 버튼 없는 광고와 SPA 초기 정보 누락 (2026-10-06)

사용자의 광고 잔류 보고를 로그인된 현재 영상 `https://www.youtube.com/watch?v=3CI2xlP361w`에서 확인했다. 사용자 탭의 15.021초 광고는 1.545454초에서 일시정지 상태였다. 현대 건너뛰기 버튼은 DOM에 있었지만 숨겨져 있었고 `ytInitialPlayerResponse`는 없었다. 현재 플레이어는 `getVideoData().video_id`와 `getPlayerResponse().videoDetails`에서 올바른 영상 ID 및 본 영상 길이 6294초를 제공했다. `getProgressState()`는 allowSeeking=false, duration=15.021을 반환했다. 증거: `test-results/youtube-remaining-ad-before.json`. 0.10.2의 활성 버튼·초기 응답 의존 조건이 이 광고를 처리하지 못했다. 일시정지한 사용자 탭은 재생하거나 위치를 바꾸지 않았다.

0.10.3은 현재 플레이어 응답을 우선하며 현재 영상 ID 또는 응답 ID가 URL과 충돌하면 오래된 초기 응답으로 대체하지 않는다. 현재 응답이 없을 때만 초기 응답을 대조한다. 버튼 없이도 기존 별도 광고 구간 보호 조건을 충족하면 종료한다. 본 영상과 합쳐진 스트림, 실제 끝 탐색 불가, 길이 충돌, 일시정지 및 불명확한 진행 정보는 처리하지 않는다. SABR 데이터 보존과 음량·속도·설정은 유지한다.

| 검사 | 판정 | 증거와 범위 |
|---|---|---|
| 0.10.2에서 남은 실제 광고 | CONFIRMED (live) | 초기 응답 없음·숨겨진 버튼·별도 15초 광고, 위 JSON. 일시정지 보존도 필요 |
| 관련 자동 회귀 | PASS | `youtube-spa-focused-tests.txt`: 15개 통과, 실패·생략 0 |
| 버튼 없는 광고 및 최신 SPA 정보 | PASS (fixture) | 초기 응답 없음·버튼 제거·현재 API만 존재, 실제 MP4 종료. 숨겨진 비활성 버튼도 방해하지 않음. synthetic click 0 |
| 정상 영상 보호 | PASS (fixture) | 결합 길이·오래된 초기 ID·현재 응답 ID 충돌·현재 영상 ID 충돌·불완전 현재 응답·진행 정보 없음/충돌에서 강제 이동 없음. 일시정지 보존·음량/속도 유지 |
| 실제 확장 등록 경로 | PASS (native Edge) | 등록된 MAIN 스크립트가 초기 정보·버튼 없는 광고를 재생 재개 후 종료. 일시정지 중에는 위치 유지. 옵션 OFF·사이트/전체 중지·해제 후 복원 검사 포함 |
| 전체 자동 회귀 | PASS | `youtube-spa-final-tests.txt`: 144개 통과, 실패·취소·생략 0, 약 87초. `node --check youtube-ads.js`도 통과 |
| 개인 프로필 최신 소스 적용 | PASS (live) | 사용자가 0.10.3으로 새로고침한 뒤 별도 탭에서 등록 스크립트 소스가 작업 폴더와 동일함을 확인. `youtube-103-installed-source.json`. 로그인 상태 유지 |
| 실제 광고 → 본 영상 전환 | PARTIAL (live observation) | `3CI2xlP361w` 새 탭에서 '테크니컬 아티스트 추천 AI' 광고와 건너뛰기 UI가 관측된 뒤 사용자/개발 도구의 버튼 클릭·미디어 위치 변경 없이 본 영상으로 복귀. 초기 종료 시점 기록이 없어 자동 종료 방식의 확정 증거로 세지 않음 |
| 실제 자동 종료의 진단 기록 | NOT CONFIRMED | 자체 탭에서 종료 코드의 비중단 관찰 지점을 설치 후 재로드 및 기존 지정 영상 `HL0_OWSv7xo`로 이동. 추가 광고가 없어 종료 이벤트 표본 없음. 관찰 지점·임시 데이터는 제거하고 Debugger 해제 |
| 실제 본 영상 긴 재생 | PASS (live observation) | `youtube-103-live-after-minute.json`: 디버거 해제 후 약 94.09초 동안 1058.46초 → 1152.55초 진행, readyState 4·재생 중·오류 없음. `youtube-103-live-normal.png` 화면. 자체 탭 정리, 사용자 일시정지 탭 유지 |

검증 가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`를 적용했다. 개인 프로필의 기존 규칙·인증·쿠키를 수정하지 않았다. 새 권한·인증 위장·일괄 미디어 차단은 추가하지 않았다.

## 0.10.2 — 로그인 세션의 건너뛰기 누락 보완 (2026-10-06)

사용자가 건너뛰기 버튼이 있는 광고 노출을 보고했고, `substance.core` 로그인 세션 사용을 지정했다. 기존 `Mr_Rocket` 프로필은 다른 프로필이라고 확인하여 사용하지 않았다. 새로 연결된 Chrome 프로필 `수빈`에서 YouTube의 `LOGGED_IN=true`를 확인했다. 계정 로그인/로그아웃, 쿠키·인증 정보 삭제는 수행하지 않았다. 공통 가이드 `docs/CHROME_EXTENSION_ACCEPTANCE.md`를 적용한다.

실제 현대 UI의 `.ytp-skip-ad-button`이 보이고 활성 상태여도 `button.click()`으로는 광고가 끝나지 않았다. 실제 UI 버튼 클릭은 본 영상으로 전환했다. 현재 로드된 플레이어 코드에서 `isTrusted=false`인 입력을 거부하는 분기를 확인했다. 이 결과를 계정 로그인 실패나 비로그인 재생 오류의 원인으로 일반화하지 않는다. 플레이어 소스를 살펴본 것이며 외부 코드를 확장에 복사하거나 실행하지 않았다.

현대 UI에는 반복 프로그램 클릭을 중지했다. 광고 클래스·보이는 활성 버튼·`getProgressState().allowSeeking=false`·현재 URL과 일치하는 초기 본 영상 정보·광고 진행 길이와 미디어 길이의 일치·별도의 본 영상 길이를 함께 확인한다. 미디어는 하나여야 하고 재생 중이며 준비 상태가 충분하고 길이가 유한해야 한다. 광고 끝 직전이 실제 seekable 범위에 있을 때만 그 광고 미디어를 끝 0.05초 전으로 이동해 종료를 유도한다. 일반/결합 스트림, 오래된 SPA 정보, 진행 정보 누락/충돌, 비활성·숨겨진 버튼에는 실행하지 않는다. 실제 광고에서도 `getAdState()`는 -1을 반환했으므로 이 API를 유일한 판별 기준으로 사용하지 않는다. 기존 UI의 클릭 방식과 SABR 데이터 보존은 유지한다.

검사 재개도 보완했다. DOM 변화를 동반하지 않는 CSS/레이아웃 변경과 탭 재표시, 미디어 진행·재생·데이터 로드에서 다시 검사한다. 미디어 이벤트 검사는 최소 250ms 간격으로 제한하고 기존 예약 타이머를 정리한다. 문서 시작 시 캡처한 타이머를 사용한다.

| 검사 | 판정 | 증거와 범위 |
|---|---|---|
| CSS 변화 후 검사 누락 재현 | CONFIRMED | `youtube-skip-wakeup-before.txt`: 수정 전 반응형 CSS로 다시 보이는 광고 플레이어의 자동 처리가 2초 내 재개되지 않음 |
| CSS·미디어 이벤트로 검사 재개 | PASS (fixture) | 화면 크기 변경, CSSOM 변경 후 미디어 이벤트로 재개. 일반 영상의 강제 seeking 없음 |
| 새 UI의 프로그램 클릭 거부 | CONFIRMED (live) | 로그인 세션의 활성 건너뛰기 버튼에서 프로그램 클릭 후 광고 유지, 실제 UI 클릭 후 본 영상 복귀. 읽은 실제 플레이어 코드도 해당 입력 거부 분기 포함 |
| 새 UI 광고 종료·본문 보호 | PASS (native media fixture) | 생성한 20초 파란 화면 MP4를 HTTP Range로 제공. 비활성 버튼은 진행하지 않고, 활성화 후 광고 ended로 전환. 거부되는 synthetic click 0. 음량 0.4·속도 1.25 보존. 결합 스트림·오래된 ID·정상 진행·불명확한 진행·길이 충돌에 강제 이동 없음 |
| 전체 최종 자동 회귀 | PASS | `youtube-skip-final-tests.txt`: 144개 통과, 실패·취소·생략 0, 약 83초. Chrome 모의 응답/실제 미디어·Edge 네이티브 확장·단위 검사를 포함. 이를 실제 광고 성공률로 표현하지 않음 |
| 기존 설정·규칙 보존 | PASS (개발 Chrome) | `youtube-skip-reload-comparison.json`: 0.10.1 → 0.10.2 재로드 전후 설정 동일, 사용자 수동 규칙 1개 보존, 보호 스크립트 4개 등록 유지 |
| 실제 로그인 광고 종료 방식 | PASS (직접 개발 검사) | `youtube-logged-ad-guard.json`: 광고 클래스/활성 버튼/allowSeeking=false, 광고 958.381초·본 영상 2042초·seekable 범위 확인. `youtube-logged-ad-seek-trial.json`: 광고 716.81초에서 958.331초로 이동. `youtube-logged-ad-seek-result.json`: 광고 상태 해제, 본 영상 660.80초/2041.961초·readyState 4·재생 중. 확장 자동 실행으로 집계하지 않음 |
| 광고 종료 이후 긴 재생 | PASS (live observation) | `youtube-logged-after-ad-later.json`: 약 102초 뒤 본 영상 762.89초/readyState 4/재생 중/오류 없음. 무한 지속 재생 또는 모든 로그인 세션에 대한 보장은 아님 |
| 실제 로그인 프로필에 최신 소스 적용 | PASS | 브라우저 정책이 chrome://extensions 접근을 거부하여 사용자가 직접 0.10.2 새로고침을 수행. 페이지 재로드 후 실제 등록 스크립트의 소스가 작업 폴더 소스와 동일함을 확인. `youtube-logged-installed-source.json` |
| 수정된 스크립트의 긴 본 영상 재생 | PASS (live observation) | 새 페이지의 889초 이후 약 115초 더 본 영상 재생, 1004.76초/readyState 4/오류 없음. 그 구간에는 광고 표본을 확인하지 못해 자동 광고 종료 성공으로 세지 않음 |
| 실제 자동 광고 종료의 성공률 | NOT RUN | 별도 광고 구간 종료 방식의 직접 검사와 모의 자동 실행은 통과. `youtube-logged-auto-probe.json`의 마지막 약 93초 관찰에서는 새 광고 없음, 본 영상 1058초 → 1151.19초/readyState 4/재생 중. seeking/seeked 표본은 광고 클래스가 없는 정상 재생 이력 복원으로 광고 종료 성공이 아님. 새 광고가 발생해 자동으로 종료되는 표본은 별도 확인 필요 |

실사이트 검사는 원래의 명시된 영상 `https://www.youtube.com/watch?v=HL0_OWSv7xo`를 사용했다. 개인 Chrome의 확장 관리 화면 접근 거부를 다른 도구나 CDP로 우회하지 않았다. 실제 웹페이지의 개발 검사는 사용자에게 공개한 범위에서 수행하며 관리 화면 조작·확장 업데이트와 구분한다. 테스트 fixture의 최초 MP4 응답은 Range 지원이 없어 seekable 끝이 0이었고, Range 응답을 추가한 뒤 네이티브 광고 종료 검사가 통과했다. 구현에도 실제 탐색 가능 범위를 검사하는 조건을 추가했다. 무리한 본 영상 끝 이동·속도 변경·인증 위장·원격 코드 실행은 추가하지 않았다. 미디어 관찰용 임시 이벤트 리스너와 자체 생성한 탭은 검사 후 정리했으며 원래 사용자의 Shorts 탭은 유지했다.
