# Chrome Web Store Listing — Paperdesk

Last updated: 2026-10-08. Version 0.9.0, local unpacked update. Store publication is not requested.

## Store Listing

Name: Paperdesk · 연구 자료 정리

Short description: 연구 탭과 PDF를 세부 분류하고 DOI·메모·인용을 내 PC에서 관리합니다.

Detailed description: 열린 연구 탭을 분류하고 원문·PDF 중복을 묶습니다. 저장한 자료의 탭을 선택해서 닫고, 선택한 PDF에서 제목·DOI·저자·발행처를 로컬로 읽어 기존 자료에 연결합니다. 메모·읽기 상태·기존 첨부를 보존하고 JSON 백업과 종류별 BibTeX를 지원합니다. 추정 결과는 저장 전에 수정할 수 있습니다. Chrome·Edge별 저장본을 선택한 로컬 폴더에 기록하고, 브라우저별 메모·읽기 상태를 유지하며 함께 볼 수 있습니다.

Category: Productivity. Single purpose: 개인 연구 자료 수집과 정리. Primary language: Korean.

## Graphics & Assets

Bundled P logo icons: PNG at 16, 32, 48 and 128 pixels for toolbar, extension manager, headers and favicons. Store-format screenshots still need preparation; screenshots should show the inline combined library and reset control.

## Permissions Justification

| Permission | Type | Purpose |
|---|---|---|
| activeTab | required | Capture metadata from the user-invoked active page |
| scripting | required | Extract bibliographic metadata from the invoked active page or reviewed tabs after per-origin optional access |
| unlimitedStorage | required | Store explicitly attached PDFs in local IndexedDB |
| sidePanel | required | Open the bundled capture form beside the current web page on an explicit button click |
| tabs | optional | Read tab titles/URLs on bulk review and recheck selected saved tabs before closing; revocable in library |
| http://*/* and https://*/* | optional host declaration | Read selected tabs, public bibliography landing pages and PDF files after a click and permission request for only those origins; revocable in library |

No host is granted at install. User-triggered bibliography reading requests only the selected tab/document and its stable bibliography/PDF origins. Grants persist until revoked. No history permission. An optional service worker observes active/loaded tabs only while saved-document visit recording is enabled; unmatched, incognito and pending-navigation tabs are not recorded. Executable PDF.js and worker, fonts and character maps are bundled with the Apache-2.0 license; no remote executable code. Public HTML is parsed in a detached document without running remote scripts (2 MB/12 seconds, credentials omitted, redirects rejected). DBpia, arXiv and Google Patents landing pages supply publicly available bibliographic fields. Reference DOI links, unrelated JSON-LD organizations/FAQ answers, patent assignees and submitted dates are not treated as document authors/DOI/publication dates. No signed proxy PDF fetching occurs.

Selected closure rechecks URL, saved record and pending navigation. Pinned, incognito and audible tabs are skipped. Library records are retained.

Official references: https://developer.chrome.com/docs/extensions/reference/api/permissions and https://developer.chrome.com/docs/extensions/reference/api/tabs#method-remove

## Privacy & Data Use

Local data includes selected titles, URLs, DOI, local PDF paths, bibliographic metadata, classifications, notes and explicitly attached PDFs. Unselected candidates are not saved. Known search/login/chat services are excluded; generic pages are unselected by default. Users review candidates because heuristics cannot identify every private website.

Stored shopping/car-parts titles and URLs can be reviewed as Other. This local heuristic uses bibliographic evidence to preserve research papers, patents, tools and technical documents. Users apply selected classification changes; notes, PDFs and reading state survive. Library and combined-folder views can hide shopping/Other without changing stored records. No new permissions are introduced.

No library data or local PDFs are sent to analysis services. Bundled PDF.js extracts metadata and first-three-page text/links locally, up to 50 MB. User-triggered PDF downloads and source links connect to that website. Downloads omit login cookies, reject redirects and credential-bearing/signed URLs. Original PDF entries remain linked with their notes and appear in backups. Backups contain paths and attachments; users choose where to share exported files.

AI APIs, telemetry, cloud sync and account integration are absent. User-triggered public DOI/title registration lookup is described below. arXiv DOI lookups use DataCite (api.datacite.org); other supported DOI and title lookups use Crossref. Only public identifiers or paper titles are sent; local paths, PDF bytes and notes are not sent. The queue spaces and caches registry requests and respects 429 Retry-After. Optional normal source-tab reading uses the user browser after an explicit lookup click and per-origin/tabs grant. Only successfully read temporary tabs created by that operation are closed; existing, navigated and blocked tabs are kept. DOI not displayed in an inspected source is distinguished from a failed lookup. Data is not sold or used outside research organization or for lending.

## Privacy Policy / Distribution / Developer Info

Privacy URL, public publisher/contact, store graphics and regions are required before store submission. Distribution: GitHub source and local unpacked extension. Support: https://github.com/SubinIm/2026_Works/issues

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.9.0 | 2026-10-08 | Select/edit saved tab candidates, durable local preferences/reset, paper-only default queue, inline Chrome/Edge folder variants and bundled brand icons | Local build |
| 0.8.2 | 2026-10-08 | Reviewed duplicate bibliography merging into an existing paper, retained PDF aliases and personal data, visible save-conflict recovery | Local build |
| 0.8.1 | 2026-10-08 | Verified 15-record source recovery: DataCite arXiv identifiers, version-aware bibliography, normal source tabs, KAIST catalog and PDF loader repair | Local build |
| 0.8.0 | 2026-10-08 | Validated filename identifiers and title registration search, granular queue/exclusions, direct duplicate repair and sidebar draft transfer | Local build |
| 0.7.1 | 2026-10-08 | Rendered IEEE header/abstract bibliography, early completion from open tabs, staged failure diagnostics and invalid metadata cleanup | Local build |
| 0.7.0 | 2026-10-08 | Default scholarly/incomplete queue, reviewed completeness, exact-DOI Crossref enrichment and source-tab/Scholar recovery | Local build |
| 0.6.1 | 2026-10-08 | Local PDF first, reviewed local file linking, reading contexts separate from titles, shopping/product kinds | Local build |
| 0.6.0 | 2026-10-08 | Existing-record bibliography review, hierarchical kinds, local document activity and optional saved-tab visit observer | Local build |
| 0.5.2 | 2026-10-08 | Parts119 and Korean vehicle-parts lookup classification regression fix | Local build |
| 0.5.1 | 2026-10-08 | Stored shopping/car-parts classification review, other kind and local/combined exclusion filter | Local build |
| 0.5.0 | 2026-10-08 | Reviewed page/PDF bibliography repair, own DOI links, patent/wiki/book kinds, template-metadata rejection | Local build |
| 0.4.0 | 2026-10-07 | Desktop Edge support, user-selected folder snapshots, shared PDF objects and per-browser combined view | Local build |
| 0.3.0 | 2026-10-07 | Selected saved-tab closing, detailed kinds, local PDF metadata/DOI matching, per-origin PDF access | Local build |
| 0.2.0 | 2026-10-07 | Bulk tab review, local topics, article/PDF identity, existing classification | Prior build |
| 0.1.0 | Existing | Single page capture, library, PDFs, backup/BibTeX | Prior build |

## Review Notes

Not submitted to Chrome Web Store. Tests and browser fixture UI verify local PDF worker and IndexedDB workflows. Actual extension permission prompts and real Chrome tab closing require user reload and first use; fixture API tests do not verify them. Arbitrary local path reading, OCR and login/paid downloads are absent. Source reading may close only successfully read temporary tabs created by that explicit operation; it keeps existing, changed, pinned, audible and blocked tabs.

Version 0.4 folder access: File System Access API opens a directory chooser only on a click; its browser permission is independent of extension permissions. The remembered directory handle and auto-save preference reside in a separate local IndexedDB. Auto-save runs only while the library is open and with a granted directory permission. Users may disconnect the folder; existing exports remain. JSON contains browser/client identity, metadata, notes and local source paths; attached PDF bytes are separate SHA256-named files. Snapshots are immutable per client. Combined view does not mutate either browser database. Imports add new records only; no automatic overwrite, deletion propagation, cloud upload or native host is present. The UI fixture does not verify OS picker permission or extension installation.

## Local document activity (0.6.0)

Paperdesk source/PDF openings and bibliography lookup attempts record separate local counters and timestamps, including failed allowed lookups. SHA-256 document fingerprints derive from a DOI/canonical resource identifier or local record ID, never device hardware or account identity. Counts and the latest 200 actions are stored in IndexedDB and exported in user-chosen backups/folder snapshots, with Chrome and Edge variants kept separate. Old visits are not backfilled. Automatic saved-document observation is off by default and requests the existing optional tabs permission when enabled. Activations and loads within a five-second pair are counted once; later activations or reloads count again. Revoking tabs permission disables automatic recording. Opening counters and automatic visits are displayed separately, since an opening may also be a visit. Worker state/preferences persist in IndexedDB; no global tab/history list or remote telemetry is retained. No additional permission is introduced.


0.6.1: Already attached or linked PDF bytes are read locally before any site request; local-only lookups request no extension permission. A user-selected PDF can be linked after review while preserving existing attachments. Figure/table page titles, selected excerpts and fragment contexts are stored as up to 100 separate reading references in the local record and user-directed backups/folder snapshots. Context collection runs only during page capture or bibliography review, never on background visits. No arbitrary local path scanning, new permission, OCR or remote upload is introduced. Shopping and product kinds include individual Cults 3D model listings without classifying the entire platform as a tool.

0.7.0: Completeness checks and reviewed bibliography state are local and included in user-directed backups/folder snapshots. Explicit DOI enrichment sends only selected DOIs to api.crossref.org after per-origin permission. Scholar search opens a normal tab with only title or DOI. Source recovery opens/reuses a normal non-incognito tab; redirected origins require permission before reading. No CAPTCHA solving, stealth crawling, paywall circumvention, full-PDF upload or background scholarly search. Manifest permissions and native-host contracts are unchanged.
Known DOI fallback during an explicit scholarly queue lookup uses the same per-origin permission; it performs no background search. Local-only records without a known DOI remain permission-free unless the user chooses DOI enrichment.

0.7.1: The existing user-triggered, per-origin page reader also reads visible IEEE document header/abstract facts. It does not inspect page runtime globals, credentials or cookies and ignores reference/recommended document facts. Complete open-tab metadata avoids additional background HTML/PDF requests. Failure messages retain stages while stripping URL query parameters and userinfo. Invalid legacy metadata is cleaned in reviewed proposals, without automatic database migration. Scholar viewer-address/filename queries are rejected. No new permissions, host contracts, login automation, CAPTCHA processing or store submission are introduced. Validation includes read-only capturePage evaluation on an actual open IEEE article plus isolated example-library UI and regression tests; actual extension reload remains a user step.

0.8.0: Selected document filename/URL identifiers (Nature and whitelisted Frontiers journal tokens) create DOI candidates locally; candidates are accepted only after an exact registered-DOI response. DOI-less scholarly titles use Crossref query.bibliographic after a click and optional api.crossref.org host grant. Requests include only DOI or title, never notes, local paths, attachments or references. Exact unambiguous titles with compatible supplied author/year fields can form a reviewed proposal; ambiguous or fuzzy matches require candidate selection and remain partial. Crossref primary resource URL/PDF link are validated before use. Local PDFs retain priority. No Google/Scholar automated scraping or restriction bypass occurs; Scholar remains a normal user-opened search tab, using a DOI candidate when a recognized filename lacks a title.

The persistent bibliographyExcluded flag is stored locally and included in backups/folder snapshots. Queue scopes separate scholarly and technical kinds; technical pages without PDF/DOI and confirmed/nonacademic/excluded records default to opt-out. Exclusion does not delete records. Popup captures can directly repair a duplicate record after review, retaining notes, existing PDF, reading state and activity; stale version/DOI conflicts are rejected.

The required sidePanel permission opens the same bundled form on an explicit user click, preserving popup inputs. The popup stays available. Sidebar tab title/URL access uses the existing optional tabs permission; page reading still requests per-origin access. Drafts reside in a separate local IndexedDB, scoped per window/tab, holding form fields and captured references only, with no PDF bytes or library notes. Saved tab drafts are deleted; unfinished drafts survive closure until resumed and saved. No background page reading is added by the sidebar. Chrome sidePanel.open requires Chrome 116+; unavailable implementations keep the popup. Edge uses its compatible sidebar API. No store publication or user-profile reload is performed by this update.

0.8.2: Saved bibliography review can propose linking a PDF placeholder to an already stored paper with the same verified DOI or exact scholarly resource URL. Similar titles alone do not merge; conflicting DOIs and distinct arXiv versions remain separate. The reviewed transaction checks target/source versions, preserves the primary attachment and notes, adds distinct source notes/tags/references, and retains each source PDF, reading state and activity in its linked record and backups. Linked originals are hidden from the default list and bibliography queue. Ambiguous targets or stale saves stay visible for review instead of closing the dialog as a success. No new permissions, external data transmission, automatic deletion or browser reload is introduced.

0.9.0: Library search/filter/collection settings and bibliography queue kind/opt-in settings persist per browser in local IndexedDB. Technical kinds are initially unchecked; individual explicit document lookups can still include their own kind. Reset clears these display/query preferences and disables automatic visit tracking, folder auto-save and remembered folder connection/view, retaining client identity, saved records, per-record exclusions, notes, attachments, history and existing exported files. Folder combined view adds read-only browser/client variants directly to the current filtered library, omits the current client's stale snapshot, and reloads an enabled view only when folder read permission is already granted. It never imports or edits remote snapshots automatically. Saved tab candidates are selectable and start with saved metadata/personal fields. No new release permission, data transmission, native host or user-profile reload is introduced. Development verification uses an isolated extension, origin-private test folder snapshots and a separate tabs-pregranted test-only manifest for live tab selection; the release retains optional tabs permission and OS picker/prompt behavior is unchanged.
