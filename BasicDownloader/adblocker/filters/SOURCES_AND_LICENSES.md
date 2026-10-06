# 출처와 라이선스

이 기록은 개인 사용을 위해 내려받은 공개 필터의 출처와 변환 내용을 보존합니다. 각 저작물의 권리는 원저작자에게 있습니다. 원문 URL·수집 시각·버전·SHA-256은 `sources/provenance.json`에 있으며 빌드마다 갱신됩니다.

| 구성 요소 | 저작자 및 공식 출처 | 라이선스 |
| --- | --- | --- |
| EasyList | [EasyList authors](https://easylist.to/), [실제 원문](https://easylist.to/easylist/easylist.txt) | [공식 이중 라이선스 안내](https://easylist.to/pages/licence.html) 중 GPL-3.0-or-later 선택 |
| filterslists-KO Classic for AdGuard | [FilteringDev와 기여자](https://github.com/FilteringDev/filterslists-KO), List-KR 기반. 실제 고정 버전 CDN URL은 provenance 참조 | [저장소 LICENSE](https://github.com/FilteringDev/filterslists-KO/blob/master/LICENSE), GPL-3.0-only |
| @adguard/dnr-converter 2.0.0 | [Adguard Software Ltd.](https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/dnr-converter) | 패키지 선언 GPL-3.0-only, [저장소 LICENSE](https://github.com/AdguardTeam/tsurlfilter/blob/master/LICENSE) |
| @adguard/re2-wasm 1.2.0 | [AdGuard의 Google RE2-WASM 포크](https://github.com/AdguardTeam/re2-wasm) | 패키지 선언 Apache-2.0; 원문 LICENSE 포함 |

`licenses/GPL-3.0.txt`는 AdGuard 저장소에서 받은 GPL v3 원문입니다. `licenses/filterslists-KO-GPL-3.0.txt`는 한국어 필터 저장소의 LICENSE 원문이며 `licenses/re2-wasm-Apache-2.0.txt`는 설치한 1.2.0 패키지의 LICENSE 원문입니다. EasyList는 GPL의 후속 버전을 허용하는 분기를 선택했습니다. 변환 데이터는 원본의 라이선스 조건과 저작자 표시를 유지합니다. 변환기 전체 의존성의 고정 버전과 무결성 값은 `tools/filter-builder/pnpm-lock.yaml`에 있습니다.

로컬 수정 사항: Chromium MV3 조건부 분기 선택, 지원되지 않는 기능의 명시적 제외, 동영상·주 문서·미디어 차단 범위 제한, DNR 우선순위 재배치, 두 목록의 결합, 원본 매핑과 보고서 생성. 원본 `sources/*.txt` 파일의 내용은 변경하지 않았습니다. 생성된 데이터는 원본 목록의 모든 기능을 구현한 완전한 복제본이 아닙니다.

빌드 스크립트와 원본 필터 스냅샷을 함께 보관하여 결과를 다시 만들 수 있습니다. GitHub 공유용 ZIP에는 원본 필터 스냅샷과 출처·라이선스 전문을 포함합니다. 변환기와 빌드 스크립트는 [저장소의 대응 소스](https://github.com/SubinIm/2026_Works/tree/main/BasicDownloader/adblocker/tools/filter-builder)에 있으며, 변환된 데이터의 고지와 원본 라이선스 조건을 유지합니다.

## 0.7.0 선택형 추적 규칙의 참고 출처

`privacy-rules.js`의 서비스별 수집 주소를 검토할 때 EasyPrivacy와 서비스 문서를 참고했다. Matomo/Piwik 파일명과 `/analytics/collect?` 일반 수집 패턴은 EasyPrivacy 버전 `202610051633`에서 선택해 요청 유형을 제한하여 적용했다. 목록 전체를 포함하거나 자동으로 다운로드하지 않는다.

- EasyPrivacy authors: https://easylist.to/easylist/easyprivacy.txt · https://easylist.to/pages/licence.html · GPL-3.0-or-later (dual-license에서 선택), 전문은 `licenses/GPL-3.0.txt`.
- Matomo developers: https://developer.matomo.org/guides/tracking-javascript-guide
- Microsoft Clarity: https://learn.microsoft.com/en-us/clarity/

방패·체크 아이콘은 이 프로젝트에서 직접 작성한 SVG이며 외부 이미지·브랜드 자산을 사용하지 않았다.
