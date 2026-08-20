# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**boramae — ATIS Analyzer**: 김포국제공항(RKSS) ATIS 전문(電文)을 폴더 감시로 자동 수집·파싱하여
통계 분석 / 지도 시각화 / 원문 열람을 제공하는 Tauri v2 데스크탑 앱. 사용자는 KAC 보라매(항공 운영·관제 지원) 담당자.

- Remote: git@github.com:chelly1221/boramae.git
- Status: **실데이터 연결 완료.** 감시 폴더(기본 `D:\`)의 음성 ATIS 텍스트 파일(*.TXT, 2024-07~)을 읽어 프론트 파서(`src/data/atis/parse.ts`)로 레코드를 만들고, 통계/지도/상세 13종(조류 포함)이 전부 그 레코드로 동작. 목데이터(`mock.ts`)는 삭제됨. 조류 활동(`birds`)은 전문에 아직 상세 보고가 없어 모델·카드·상세만 유지(항상 빈 배열, 일반 주의문은 운영 공지 `BIRDS`로 집계) — 전문에 조류 보고가 추가되면 파서만 확장하면 됨.

## Tech Stack

- **Tauri v2** (`src-tauri/`, crate `boramae`, lib `boramae_lib`) — Rust 백엔드 = **ATIS 파일 수집기 + SQLite 보관소**. 전문 파일은 1시간마다 폴더에 새로 쓰이므로 폴더 이벤트(notify) 대신 **파일 변경시각(mtime) 폴링**으로 감시한다(네트워크/이동식 매체 대응): 60초마다(`SCAN_INTERVAL_SECS`) `read_dir` 메타데이터로 이름+mtime을 훑어 DB와 다른 파일만 읽어(수정 후 2초 미만은 다음 스캔) `rusqlite`(bundled) DB **`atis.sqlite` — exe와 같은 폴더**(포터블: exe 폴더째 복사하면 DB·설정이 따라감; 그 폴더에 못 쓰면 `{app_data}`)에 upsert하고 (테이블 `atis_files(name PK,mtime,size,text,seen_at,src_dir)` — **파일명 기준, 폴더 경로와 무관하게 합쳐 보관**(예전 `files(dir,name)` 스키마는 열 때 자동 이관), `settings(key,value)` — 감시 폴더 `dir` 저장, 저널 DELETE 모드 = **단일 파일**, -wal/-shm 없음) `atis-files` 이벤트(500개 단위)로 프론트에 밀어 준다. 스캔마다 `atis-scan`(ScanStatus: at/in_dir/changed/took_ms/error). 폴더에서 지워진 파일도 DB에 남는다(누적 보관). 커맨드: `save_text_file`, `load_atis_db()`(시작 시 DB 전체를 즉시 적재 — 느린 D:\를 다시 읽지 않음), `start_atis_watch(dir)`(즉시 1회 + 주기 스캔 스레드, 재호출 시 교체) / `stop_atis_watch`, `scan_atis_now(dir)`(툴바 새로고침·설정 '지금 스캔'), `atis_db_path`, `atis_db_count()`, `atis_get_setting/atis_set_setting`(감시 폴더 등 — DB → localStorage → 기본 `D:\` 순으로 읽음). **파싱은 Rust가 아니라 프론트**에서 한다(파서 한 곳 유지 + Node로 커버리지 검증). 검증 기록: D:\ 13,755개 첫 스캔 ~80초에 DB 10.9MB, 두 번째 실행은 DB 적재 후 스캔 변경 0
- **React 19 + TypeScript + Vite 7** (`src/`) — 프론트엔드. 스타일은 `src/styles.css` 단일 파일(BEM식 클래스 + CSS 변수 토큰), CSS-in-JS/UI 라이브러리 없음
- 폰트: **Pretendard Variable** (npm `pretendard`, OFL) — `styles.css` 상단 `@font-face`가 `node_modules`의 woff2(≈2MB)를 참조해 빌드에 번들됨. `--font-sans` 1순위. 모노(`--font-mono`)는 시스템 폰트(Consolas 등)
- **오프라인 원칙**: 폰트·타일·Leaflet CSS 등 모든 리소스는 빌드에 포함, 런타임 네트워크 요청 없음 (CDN/웹폰트 링크 금지)
- 지도: **Leaflet 1.9** 직접 통합 (`src/components/map/useLeafletMap.ts`). 타일은 전부 오프라인(빌드 포함), 런타임 네트워크 요청 없음:
  - 베이스맵: CARTO Voyager, `tiles.config.json.basemap` 기준 줌 12 한 단계만 (`npm run tiles` → `public/tiles/`)
  - 항공사진 오버레이(**기본 ON**, 툴바 토글): 2023 김포공항 항공사진 z12–16, `tiles.config.json.aerial` 기준 원본(`C:/code/BRA_Gimpo.vol1/image_tiles_Gimpo_2023`)에서 가공 (`npm run tiles:aerial` → `public/tiles-aerial/`, WebP ~51MB). 원본 jpg에는 촬영 범위(공항 중심 원 + 활주로 방향 띠) 밖이 검정/흰색으로 구워져 있어, 스크립트가 z14 마스크(구멍 채움 → 침식/팽창으로 핵심/경계띠/바깥 3구역)로 여백을 투명 처리하고 전부 여백인 타일은 버린다 (`scripts/build-aerial-tiles.mjs`, devDependency `sharp`)
  - 오버레이 팔레트 2벌 (`useLeafletMap.ts`의 `LIGHT`/`BRIGHT`): 항공사진 ON이면 활주로·경로·시정 원·항행시설·조류 섹터가 밝은 색(활주로·연장선 노랑 `runway`, ARP·ILS 점 코랄 `primary`, 시정 원 흰색, VOR 하늘색, 조류 주황/노랑)으로 바뀌고 선 아래 어두운 헤일로가 깔림, 라벨 필은 `.mapview--aerial .vis-pill`로 어두운 배경(필 색은 `--pill-c`/`--pill-c-b` CSS 변수 두 벌), 바람 파티클도 더 밝고 진하게(`WindCanvas bright`). 재스타일은 `themed` 목록에 `setStyle` 일괄 적용
- **ATIS 데이터 파이프라인** (`src/data/atis/`): `source.ts`(Tauri: `load_atis_db`/`start_atis_watch`/`scan_atis_now` + 이벤트 ↔ 브라우저 dev: 미들웨어 `/__atis/files?dir&since` 폴링 60s, DB 없음; 폴더 설정은 localStorage `boramae.atisDir`, 기본 `D:\`) → `parse.ts`(문장 파서, 의존성 없음) → `store.ts`(파일별 파싱 결과 Map, (발행시각,레터) 중복은 파일명이 늦은 쪽만, ts 정렬, `recordsBetween` 이진 탐색, `anchorOf` = 마지막 전문 시각이 24h/7d/30d 기준점, `dataStart`) → `useAtis.ts`(적재·감시·즉시 스캔 `reload`·DB 전체 재적재 `reloadAll`·폴더 변경·일시중지 훅, 상태 {dir,status,error,watching,scan,scanning,loadedAt,db,store}). `vite.config.ts`의 `atisDevSource` 플러그인이 dev 서버에서 폴더를 읽어 줌(서버 메모리 캐시, 요청 직렬화). 파서 커버리지 점검: `npm run parse:check -- <폴더> [--verbose|--dump N]` (Node 타입 스트리핑으로 `src/data/atis/parse.ts`를 그대로 실행; 미인식 줄·제외 사유·필드 분포 출력). 로컬 복사본 `C:\code\atis-raw`(D:\ 사본)가 있으면 빠름
- 공항 정밀 좌표: `src/data/airport.ts` (RKSS ARP, 활주로 시단 4점, LOC/GP/VOR 위치·주파수·코스 — BRA SUITE config_BRA.js 출처). 활주로 진방위 135/315는 측풍 계산에도 사용
- CSV: `tauri-plugin-dialog`의 save 다이얼로그 + `save_text_file` 커맨드. 브라우저(vite dev)에서는 Blob 다운로드 폴백
- 앱 identifier `kr.co.airport.boramae`, 창 1280×800 (min 1024×680), **`maximized: true`로 최대화 상태 시작**, **`decorations: false`** — OS 타이틀바 없이 macOS 스타일 커스텀 타이틀바 사용:
  - `src/components/TrafficLights.tsx`: 사이드바 상단 신호등(닫기/최소화/확대) — `getCurrentWindow()`로 close/minimize/toggleMaximize, 포커스·최대화 상태 구독. 브라우저(vite dev)에서는 장식만
  - 드래그 영역: 사이드바(`<aside>`)와 툴바(`<header>`)에 `data-tauri-drag-region="deep"`, 클릭 가능한 묶음(`.nav`, `.airport`, `.toolbar__actions`, `.lights`)은 `"false"`로 제외. 더블클릭 → 최대화 토글은 Tauri 내장(drag.js)
  - 권한: `capabilities/default.json`에 `core:window:allow-start-dragging / allow-minimize / allow-toggle-maximize / allow-close`
  - `src/tauri.ts`의 `isTauri()`로 Tauri 웹뷰 여부 판별 (csv.ts, TrafficLights 공용)

## Commands

Windows 툴체인 기준 (아래 Environment 참고). WSL 셸에서 `npm`은 Windows npm으로 실행됨.

- `npm install` — 의존성 설치
- `npm run dev` — Vite 프론트만 (http://localhost:1420)
- `npm run build` — `tsc && vite build` (타입체크 포함, 프론트 검증용)
- `npm run tiles` — CARTO 베이스맵 타일 다운로드 (`tiles.config.json.basemap`, `--force`로 재다운로드). 커밋되어 있어 평소엔 불필요
- `npm run tiles:aerial` — 항공사진 타일 가공(여백 투명화 + WebP 변환, `tiles.config.json.aerial.source` → `public/tiles-aerial/`, 약 45초). 원본 없으면 건너뜀. 커밋되어 있어 평소엔 불필요
- `npm run parse:check -- D:\` — ATIS 파서 커버리지 점검 (파서 수정 후 반드시 실행: 미인식 줄 0, 제외는 2022-03 시운전 파일 + 필수 항목 누락만이어야 함)
- `npm run tauri dev` — 앱 개발 실행 (Windows 터미널에서 권장)
- `npm run tauri build` — 배포 빌드 (WSL에서는 `export PATH="/mnt/c/Users/레이더송신소/.cargo/bin:$PATH"` 후 실행, 약 2분). 산출물: **포터블 `src-tauri/target/release/boramae.exe`**(WebView2 런타임만 있으면 단독 실행, DB는 옆에 생성) + `target/release/bundle/{msi,nsis}` 설치본
- Rust만 검증: `cd src-tauri && cargo check` (WSL에서는 `/mnt/c/Users/레이더송신소/.cargo/bin/cargo.exe check`)
- 앱 동작 검증(WSL에서): `npm run dev` 백그라운드 → `src-tauri/target/debug/boramae.exe`(`cargo build` 산출물, 디버그는 devUrl 로드) 실행 → exe 옆 `atis.sqlite`(앱 종료 후 /tmp로 복사해 python sqlite3로 조회)
- WSL에서 `D:\`는 마운트돼 있지 않음(`/mnt/d` 없음, sudo 불가) — `cmd.exe /c dir D:\`, `powershell.exe`, Windows `node.exe`(`/mnt/c/nvm4w/nodejs/node.exe`)로 접근. 분석용 사본: `C:\code\atis-raw`(robocopy)

## Design Reference (`design/`)

`design/README.md`가 핸드오프 문서(화면 구성·토큰·인터랙션·상태 명세). **UI 구현 전 반드시 읽을 것.**

- `design/ATIS Analyzer.dc.html` — 메인 디자인. `<x-dc>` 내부 마크업(인라인 스타일)이 룩, 하단
  `<script type="text/x-dc">`의 `Component` 클래스가 상태·파생값 로직(KPI, 바람, 측풍, 히트맵 등).
  `recs()`의 시드 난수는 목데이터 → 실제 파서/DB로 대체.
- `design/map.html` — Leaflet 지도(활주로·접근경로·조류섹터·시정원·바람 파티클). 단독 실행 가능.
  부모→iframe `postMessage({type:'atis', dir, spd, vis, visTxt, showVis, showWind})`로 동기화.
- `design/support.js` — 프로토타입 런타임. 참조 불필요.
- `design/assets/boramae-e3905caf.png` — KAC 보라매 로고.

High-fidelity: 색·타이포·간격은 최종 의도값. Primary `#7f0d00`, 카드 radius 12px, 사이드바 208px (아이콘 22px·폰트 15px대로 확대 구현).

### 화면
- 사이드바(공항 목록 + 분석/지도/설정 내비 + 폴더 감시 상태 — 실제 적재/감시 상태·전체 전문 수·마지막 전문 시각). `분석`(view 키는 여전히 'stats') 아래에 상세 페이지 13종이 중첩 메뉴(`.nav__sub`, `PANEL_KEYS` 순서)로 펼쳐짐 — stats 뷰일 때만 표시, 클릭 → `openDetail(key)`. 상세가 열려 있으면 하위 항목이 선택 강조(primary), 부모는 `.nav__item--open` 은은한 톤
- 상단 툴바(기간 24h/7d/30d 세그먼트, CSV 내보내기, 새로고침, 지도 뷰에서 바람 시각화 토글). 상세 페이지에서는 `‹ 분석` 뒤로가기 + 패널 제목/부제, 기간 세그먼트 숨김(기간은 상세 페이지 안에서 지정), CSV는 상세 기간 레코드 내보냄
- 분석 뷰(`StatsView`): KPI 4장 + 카드 15종 (온도/노점, 바람(+최대 돌풍·CALM/VRB), 측풍/배풍, 활주로 비율(32/14 방향 + 현재 ARR/DEP), 전환 이벤트, 히트맵, 갱신 빈도, 구름/접근(접근 명칭별 동적 막대: ILS / ILS Z …), QNH, 시정(+RVR 보고), **활주로 표면 상태**, **운영 공지**, 기상 태그(+TREND 변화 예보 수), 조류 활동). **모든 카드는 `.card--link`로 클릭 → 상세 페이지** (KPI: 총 수신/발행 간격→update, 최다 활주로→runway, 평균 QNH→qnh). 카드 안의 클릭 요소(타임라인 도트·히트맵 셀·갱신 막대)는 stopPropagation. 레코드가 없으면(폴더 미설정/오류/적재 중) 빈 상태 카드
- 상세 페이지(`DetailView`, 디자인 시안에는 없음 — 자체 설계): 상단 `PeriodPicker`(프리셋 24시간/7일/30일/90일/이번 달/지난 달/올해 + 시작·종료 년/월/일/시 셀렉트 + ◀▶ 기간 이동, UTC) → 항목별 패널(`components/detail/panels/<Key>Panel.tsx`, 레지스트리 `panels/index.ts`의 `PANELS`). 패널 구성 관례: `StatTiles`(요약) → 메인 `TimeSeriesChart`(자동 해상도 raw/1시간/1일, 점 클릭 → 원문) → `.dgrid-2` 보조 차트(일별 집계·UTC 시간대 프로파일) → 이벤트 `DetailTable`(행 클릭 → 원문) → `.dsection__note`. ESC → 통계로 복귀
- 지도 뷰: Leaflet + 타임 스크러버(**현실 시간 기준 재생**: rAF 가상 시계가 실제 경과 × 배속(×300/×900/×1800/×3600, 기본 ×900 = 1시간이 4초)으로 흐르고 가상 시각 이하의 마지막 전문을 표시, 전문 공백 3h 초과는 건너뜀(`PLAY_GAP_SKIP_MS`), 헤더에 가상 시계 `.scrubber__clock`·배속 칩 `.scrubber__speed`, **타임라인은 캔버스 `Timeline.tsx` — 솎지 않고 실제 시각 비례**: 전문 i를 [ts_i, min(ts_{i+1}, ts_i+3h)) 구간의 풍속색 막대로 그리고(수신 공백은 빈칸), 막대가 14px 이상이면 풍향 화살표, 선택 테두리·호버 테두리(헤더에 호버 전문 정보)·재생선. 줌/팬은 시간 구간 `view {from,to}`(null=전체, `fullView`가 양끝 1% 여백): 휠 확대/축소(커서 시각 기준), 드래그·Shift+휠 이동, 더블클릭/'전체' 리셋, 헤더 −/+(선택 전문 기준), 최소 1시간; 재생 중 선택 전문이 구간 밖이면 30% 지점으로 따라감. 시각 축도 같은 캔버스: 눈금/라벨 간격은 픽셀 폭에 맞춰 1h·3h·6h·12h·1d·2d·7d·14d·30d 중 선택(라벨 ≥56px, 눈금 ≥7px), 00Z는 날짜 굵게. App은 기간 전체 레코드를 넘기고 재생도 전체 레코드 기준) + 플로팅 요약 카드(바람 · `RWY 32R↓ 32L↑` 착륙/이륙). **기간 지정**: 툴바 세그먼트의 '기간 지정'이 지도 우상단 `.map-period` 패널(상세와 같은 `PeriodPicker`)을 열고 `mapWin`(TimeWindow|null)을 둠 — 있으면 24h/7d/30d 대신 그 창의 레코드, 24h/7d/30d 클릭 시 해제. **사용 활주로 문자 라벨**: 착륙 시단 바깥 `ARR 32R ↓ 착륙`, 이륙 활주 시작점 바깥 `DEP 32L ↑ 이륙` 필(`.vis-pill--rwy`, 팔레트 키 `runway`) — 평행 활주로끼리 겹치지 않게 각자 바깥쪽으로 420m 비킴(`labelPos`), 같은 시단이면 DEP를 더 멀리. **부드러운 전환**: 시정 원 반경은 450ms ease-out rAF 보간(`visAnim`), 바람 파티클은 풍향(최단 각도)·풍속을 프레임당 8%씩 목표값으로 수렴(`WindCanvas` `EASE`). 조류 활동 섹터(부채꼴)와 BIRD ACTIVITY 카드는 **선택 시각 전문의 `birds`**를 그림(현재 데이터에는 없어 항상 '보고 없음'); 충돌/회피 보고 마커는 아직 정적 데모
- 설정 뷰: 감시 폴더(변경 = Tauri 디렉터리 다이얼로그/브라우저 prompt, 지금 스캔, 감시 일시중지) · 마지막 스캔 상태(시각·폴더 파일 수·변경 수·소요) · **보관 DB 카드**(경로·보관 수·적재 파일/전문/불완전 수·보유 기간, 'DB에서 다시 적재') · 최근 파일 12개(파싱 결과) · **불완전 전문 목록**(필수 항목 누락 사유별)
- 원문 모달: ←/→ 이전·다음, ESC 닫기. 탐색 목록은 열어준 쪽의 배열(현재 기간/히트맵 7일/상세 기간). 칩에 바람(변동 범위)·시정·현재기상·RVR·구름·온도·QNH·ARR/DEP·접근 명칭·TREND·상태 보고·공지 종류, 부제에 원본 파일명
- 조류 데이터 모델: `AtisRecord.birds: BirdReport[]` ({kind HVY|LGT, dir 8방위, nm}) — 전문 remarks의 `CTN BIRD ACTIVITY HVY FLOCK 5NM NW OF AD` 토큰에 대응(아직 실전문에 없음, 파서는 빈 배열). 표시 헬퍼(`BIRD_COLOR`, `BIRD_KIND_LABEL`, `birdHead`)와 카드 파생값 `computeBirdCard`는 `data/stats.ts`, 상세는 `data/detail/bird.ts`. CSV에 `birds` 열 포함

### 상태 모델
`view` ('stats'|'map'|'import'), `range` ('24h'|'7d'|'30d'), `detail` (DetailKey|null — stats 뷰 안의 상세 페이지), `win` (TimeWindow|null — 상세 조회 창, null이면 현재 range 창), `mapIdx` (number|null — null이면 마지막 전문), `playing`, `playSpeed` (300|900|1800|3600 배속), `playClock` (재생 가상 시각|null), `mapWin` (TimeWindow|null — 지도 사용자 지정 기간), `showMapPeriod`, `windViz`, `aerial`, `raw` ({list, idx}|null — 원문 모달이 탐색 중인 배열과 위치), 그리고 `useAtis()`의 {dir, status idle|loading|ready|error, error, watching, scan, scanning, paused, loadedAt, db, store}.
파생값은 전부 `store.records`(ts 오름차순 전체)에서 `recordsBetween`으로 잘라 계산. 기간 기준점(now)은 마지막 전문 시각.

## Architecture

```
src/
  main.tsx                     엔트리 (styles.css import)
  App.tsx                      전역 상태(view/range/mapIdx/playing/windViz/rawIdx), 재생 타이머, 뷰 라우팅
  styles.css                   디자인 토큰 + 전 컴포넌트 스타일
  tauri.ts                     isTauri() — Tauri 웹뷰/브라우저 구분
  data/
    types.ts                   AtisRecord(시각·바람 gust/var/vrb/calm·시정 cavok/rvr·구름 clouds/vv/ceil·온도·QNH·rwy 방향+arrRwy/depRwy·app/appName·주파수·tags/wx/wxTxt·recent·trend·rwyCond·notices·birds·wind·raw·file)·WxGroup·CloudLayer·RvrReport·RunwayCondition·Notice/NoticeKind·BirdReport·AtisFile·ImportedFile·DetailKey·TimeWindow·HeatRow
    airport.ts                 RKSS 정밀 좌표(ARP/활주로 시단/항행시설) + 측지 헬퍼(destination)
    atis/parse.ts              음성 ATIS 문장 파서 parseAtis(text, file, mtime) → {rec, reason, unknown} · toRecord(측풍/배풍) · fileNameTs/issueTs/wordNumber/parseWx/classifyNotice/parseFlow
    atis/store.ts              buildStore/mergeFiles(증분)/recordsBetween/anchorOf/rangeWindow/dataStart
    atis/source.ts             readDir/watchDir/pickDir (Tauri ↔ dev 미들웨어), 폴더 설정 localStorage
    atis/useAtis.ts            적재·감시 훅 (App에서 사용)
    stats.ts                   computeStats(recs, range, xwLimit): 카드 파생값(빈 배열이면 emptyStats) · computeHeatRows · TAG_DESC(2글자 코드 전부) · isPrecip/isTsCb · appColor · NOTICE_KINDS/LABEL/COLOR · BRAKING_ORDER/brakingRank · rwyccColor/rwyCondSummary · computeRwyCondCard/computeNoticeCard · windColor · BIRD_COLOR/birdHead/computeBirdCard
    csv.ts                     exportCsv (Tauri 다이얼로그 / Blob 폴백) — 돌풍·변동범위·CAVOK·RVR·현재기상·실링·ARR/DEP·접근·TREND·상태보고·공지·파일명 열 포함
    detail/agg.ts              상세 공용 집계·포맷 헬퍼 (autoUnit/bucketize/hourProfile/runs/changes/fmt*/niceTicks/timeTicks)
    detail/<key>.ts            패널별 순수 파생값 compute<Key>Detail(recs, win, …) — 컴포넌트에서 계산하지 않음 (rwycond.ts / notice.ts 포함 13종)
  components/
    Sidebar.tsx  Toolbar.tsx  StatsView.tsx  SettingsView.tsx  RawModal.tsx  icons.tsx
    TrafficLights.tsx          macOS 신호등 창 제어 (사이드바 상단) + useTauriWindow 훅
    detail/DetailView.tsx      상세 페이지 셸 (PeriodPicker + 패널)
    detail/PeriodPicker.tsx    기간 지정 (프리셋 + 년/월/일/시 + 이전/다음)
    detail/primitives.tsx      Section/Legend/StatTiles/DetailTable/Empty/useWidth
    detail/charts.tsx          TimeSeriesChart(시각축·툴팁·임계선·밴드) / BarChart(단일·누적·범위)
    detail/panels/index.ts     PANELS 레지스트리 (key → title/sub/Component), panels/types.ts PanelProps
    detail/panels/<Key>Panel.tsx  temp/wind/xwind/runway/heat/update/cloud/qnh/vis/tags/rwycond/notice/bird 13종 (각각 data/detail/<key>.ts와 짝)
    map/MapView.tsx            지도 뷰 (플로팅 카드 + 타임 스크러버)
    map/useLeafletMap.ts       Leaflet 마운트 + 정적 레이어(활주로/경로/충돌 보고) + 시정 원·접근경로·조류 섹터 갱신 + LIGHT/BRIGHT 팔레트
    map/WindCanvas.tsx         바람 파티클 캔버스 (rAF)
public/tiles/                  오프라인 베이스맵 타일 (생성물, `npm run tiles`) + manifest.json
public/tiles-aerial/           항공사진 타일 z12–16 WebP, 여백 투명 (생성물, `npm run tiles:aerial`) + manifest.json
scripts/check-parse.ts         ATIS 파서 커버리지 점검 (npm run parse:check)
scripts/fetch-tiles.mjs        CARTO 타일 다운로더 (Node, fetch)
scripts/build-aerial-tiles.mjs 항공사진 타일 가공기 (sharp: 여백 마스킹 → WebP)
tiles.config.json              basemap/aerial 설정 (스크립트와 앱이 공유)
vite.config.ts                 Vite 설정 + `atisDevSource` 개발용 ATIS 폴더 미들웨어 (/__atis/files)
src-tauri/
  src/main.rs                  진입점 → boramae_lib::run()
  src/lib.rs                   Tauri builder, 플러그인(dialog), SQLite(rusqlite) + mtime 폴링 스캐너, 커맨드(save_text_file / load_atis_db / start_atis_watch / stop_atis_watch / scan_atis_now / atis_db_path / atis_db_count), WatchState
  tauri.conf.json              창/번들 설정
  capabilities/default.json    권한 (core:default, core:window:allow-* 창 제어, dialog:default) — 플러그인 추가 시 갱신
design/                        디자인 핸드오프 (수정하지 말 것, 참조 전용)
```

### 참고 자료
- `C:\code\BRA_Gimpo.vol1\` (BRA SUITE, Cesium 기반 전파장애물 분석기) — `js/config_BRA.js`·`facilityDB.xlsx`(공항 좌표 원본), `image_tiles_Gimpo_2023/`(항공사진 z0–18, 999MB), `reference/김포공항_AIP.pdf`(공식 AIP — ATIS 파서 규격 근거). 지형/3D타일은 이 앱에 불필요.

### ATIS 전문 형식과 파서 (실데이터 기준, `npm run parse:check`로 검증)
- 원본: 폴더에 전문 1건 = `*.TXT` 1개, 파일명 `"YYYY, MM DD, Weekday, HH - MM - SS.TXT"`(UTC, 녹음 시각). 본문은 **METAR가 아니라 음성 ATIS 문장**(CRLF). 첫 줄 `ON AIR ID : …`는 운용자 임의 입력(무시). 발행 시각 = 파일 날짜 + 헤더 `INFORMATION X TIME HHMM UTC`(12시간 이상 차이 나면 전/다음 날 보정). 2022-03 파일 338개는 시운전 입력(필수 항목 없음 → 제외), 실데이터 2024-07-04~ (월별 수집 공백 있음)
- 문장 → 필드: `EXPECT ILS [Z] RWY32R APPROACH`/`EXPECT RNP APPROACH`/`LOC Y APPROACH` → app/appName/arrRwy · `DEPARTURE RWY32L` → depRwy · `SEOUL APPROACH/DEPARTURE FREQUENCY WILL BE n` → appFreq/depFreq(항상 119.1/125.15) · `RWY32R TOUCHDOWN WIND 320 AT 5 KNOTS` (+`AT GUST 15` → gust, 평균 풍속 없으면 gust로 대체) · `VARIABLE BETWEEN 230 AND 310[ 3 KNOTS]` → varFrom/varTo(풍향 없으면 VRB, 대표 풍향 = 범위 중앙) · `WIND CALM` · `CAV-OK`(vis 10, cavok) · `VISIBILITY 10KM | 8 KM | 4 THOUSAND 5 HUNDRED M | 2 HUNDRED 50 M`(낱말 숫자 `wordNumber`) · `WITH FBL TS RA BR [AND MOD SN]` → wx 묶음(강도 FBL/MOD/HVY = -/ /+) + tags(2글자 코드, 강도 제외·중복 제거) · `RWY32R TOUCHDOWN RVR … M` / `MID RVR` / `END RVR` → rvr · `CLOUD.` 다음 `FEW|SCT|BKN|OVC [CB] n THOUSAND n HUNDRED FEET` → clouds/ceil(BKN·OVC 최저), `NSC|SKC`, `SKY OBSCURED`+`VERTICAL VISIBILITY n HUNDRED FEET` → vv · `TEMPERATURE [MINUS] n CENTIGRADE` / `DEW POINT [MINUS] n` / `QNH 1009 HECTOPASCALS 2980 INCHES` · `ADVISE WEATHER.` 뒤 `RE RA`(recent) · `WS RWY14R`/`WINDSHEAR ALERT…`(공지 WS) · `TREND WEATHER.` 뒤 `NOSIG` | `BECMG [TL/FM HHMM Z]` | `TEMPO` + 이어지는 시정/현상/구름/NSW 줄 → trend/trendTxt · 활주로 상태 블록 `RWY14R CONDITION REPORT [AT 0600 UTC]` / `RUNWAY CONDITION CODES 5, 5, 5 [WET|DRY SNOW|DOWNGRADED]` / `FIRST|SECOND|THIRD PART …` / `RUNWAY WIDTH|DRIFTING SNOW|CHEMICALLY TREATED|CONDITION WET` / `TAXIWAY B2 POOR` / `RWY14L BRAKING ACTION REPORTED BY A380 AT 1230 UTC, GOOD TO MEDIUM` / `RWY32R RUNWAY CONDITION WET BRAKING ACTION GOOD TO MEDIUM REPORTED BY M A- 320` → rwyCond[] (가장 최근 엔트리에 이어 붙임) · 공지: `FLOCKS OF BIRDS VICINITY AIRPORT …`(BIRDS) / `GPS SIGNALS ARE UNRELIABLE …`, `EXCISE EXTREME CAUTION WHEN USING GPS`, `BECAUSE OF GEOMAGNETIC …`(GPS) / `FLOW CONTROL IN EFFECT [ON] RKPC BY 10 MINUTES [AND Y 711 BY 4 MINUTES]`(+다음 줄 `AND … BY n MINUTES` 이어쓰기 → flow[]) / `LOW LEVEL WINDSHEAR [ALERT] ADVISORIES IN EFFECT`(앞줄 `AT 3 THOUSAND FEET.`는 뒤 공지에 붙임) / `ADVICE ATC LOW VISIBILITY PROCEDURES …`, `CHECK YOUR QUALIFICATION FOR CAT-II…`, `LATEST CEILING AND VISIBILITY …`(LVP) / `GRASS CUTTING IN PROGRESS …` / `FLIGHT CHECK IN PROGR[E]SS …` / `USE CAUTION UNKNOWN FREE BALLOON ACTIVITY …` / `GP OUT OF SERVICE FOR RWY32L` / `WORK[ING] IN PROGRESS …` / `… AIRPORT CLOSED BETWEEN …`, `ALL AIRCRAFT PROHIBITED TAKE OFF …`(CLOSED). 규칙에 없는 줄은 `OTHER` 공지 + `unknown`(커버리지 점검에 표시, 운영 공지 상세의 "분류되지 않은 문장" 표)
- 필수 항목: 바람(또는 CALM/VRB)·시정(또는 CAVOK)·기온·노점·QNH·활주로(착륙 또는 이륙) — 하나라도 없으면 레코드를 만들지 않고 `reason`("바람 없음" 등)으로 설정 화면에 표시 (실데이터 ~0.7%: 바람 줄 자체가 빠진 전문). `rwy` 방향은 착륙 활주로 우선, 없으면 이륙 활주로. 측풍/배풍은 진방위 315/135 기준, CALM은 0
- 실데이터 특성(설계 근거): 정기 발행 **매시 :00**(70%), 나머지 임시 갱신(평균 간격 ~40분) · 접근은 ILS(+드물게 ILS Z)뿐 · 활주로 배치 3종 `ARR 14R·DEP 14L` / `ARR 32L·DEP 32R` / `ARR 32R·DEP 32L`이 비슷한 비중 + 같은 방향 내 L/R 교체가 잦음 · CAVOK 43% · 태그 RA>BR>SN>FG>TS>PR>HZ>DZ>SH · TREND는 NOSIG 96% · GPS 공지 95%, 조류 일반 주의 84% · 활주로 상태 보고는 겨울 619건(RWYCC 거의 5/5/5) · 돌풍 보고 0건(필드는 유지)

### 프론트 관례
- 파생값은 컴포넌트에서 계산하지 않고 `data/stats.ts`(카드) / `data/detail/<key>.ts`(상세)에 모은다 (디자인의 `renderVals()` 대응).
- 차트는 인라인 SVG. 카드는 viewBox 560×130 + `linePts`/`areaPts` 헬퍼, 상세는 `detail/charts.tsx`의 px 좌표 컴포넌트(컨테이너 폭 ResizeObserver). 차트 라이브러리 없음.
- 상세 CSS 클래스: `.detail .period* .dsection .dgrid-2(.--wide) .dgrid-3 .dtiles/.dtile .dtable .tchart/.bchart(+__tip) .dempty .dsection__note`, 패널 전용은 `.p<key>-*` 접두사로 styles.css 끝 "Detail panels" 섹션에 (현재 패널들은 인라인 style 소량 + 기존 클래스 재사용으로 추가 CSS 없음).
- 상세 차트 프리미티브 규약: `TimeSeriesChart`는 결측(null)에서 선을 끊고 점 1개짜리 세그먼트는 원으로 표시, `bands`는 폭 0도 최소 1.5px, `unit` 라벨과 겹치는 최상단 눈금 라벨은 자동 숨김. `BarChart`는 값이 전부 정수면 정수 눈금(`integer` prop으로 강제), `maxBarWidth`(기본 72px)로 막대 과대 방지, `lo`로 범위 막대·`stack`으로 누적. 이벤트 구간 병합은 `agg.runs(recs, pred, maxGapMs?)` (실데이터 수신 공백 대비 gap 옵션).
- 상세 패널 정의 기준(카드와 동일): 시정 저하 vis<10, 안개 위험 스프레드 ≤2°C, 강풍 ≥15KT·정온 ≤3KT, 측풍 한계 `XW_LIMIT`(15KT)·배풍 기준 5KT, 저실링 <1000FT, QNH 급변 |Δ| ≥ 3hPa/3h, **정기 발행 = 분 00(매시 정각), 임시 갱신 = 그 외, 공백 = 간격 ≥120분**, 활주로 전환 = 직전 전문과 rwy(방향) 다름 + 같은 방향 내 배치 교체(ARR/DEP 중 하나라도 다름)는 별도 표, 강수 = `isPrecip`(RA·SN·DZ·GR·GS·PL·SG·UP), TS/CB = TS 태그 또는 CB 구름(`isTsCb`), 접근 비율 = appName별, 활주로 상태 보고 전문 = rwyCond 1건 이상·최저 RWYCC = 코드 최솟값·임계 3(주의)/1(위험)·제동작용은 GOOD→…→POOR 순위·보고 구간 = 연속 병합(공백 3h 초과 분리), 운영 공지 = 전문당 종류별 1건·이벤트 구간 = 종류별 연속 병합(3h)·흐름관리는 flow[] 대상별 평균/최대 지연, 조류 보고 전문 = birds 1건 이상·무리 건수 = 전문 × 무리·활동 구간 = 연속 보고 병합(공백 3h 초과 시 분리)·새벽 20–23Z/저녁 07–10Z 집중 패턴 ≥60%.
- 개발/스크린샷 편의: URL 해시로 초기 상태 지정 가능 — `#view=map&range=7d&raw=3&idx=22&aerial=0&zoom=15` (항공사진은 기본 ON, `aerial=0`으로 끔; `idx`는 타임 스크러버 위치; 지도에서 `from/to`는 지도 기간, `period=1`은 기간 패널 열기), 상세는 `#view=stats&detail=rwycond&from=2024110100&to=2025033100` (YYYYMMDDHH UTC). 데이터 끝이 2026-08-02이므로 24h/7d/30d는 그 시각 기준.
- 시각 확인은 `npm run dev` 후 Windows Chrome 헤드리스로 스크린샷:
  `chrome.exe --headless=new --window-size=1280,800 --screenshot=<path> http://localhost:1420/#view=map`
  (WSL curl로는 Windows vite에 접근 불가 — 브라우저도 Windows 쪽을 써야 함. vite가 `::1`에만 바인딩된 경우가 있어 `127.0.0.1` 대신 `localhost` 사용, `--hide-scrollbars --virtual-time-budget=20000` 권장. 첫 요청은 D:\ 전체 읽기(~60초)라 `powershell Invoke-WebRequest 'http://localhost:1420/__atis/files?dir=D:\'`로 서버 캐시를 먼저 데우고, 크롬은 `timeout 120`으로 감싸 좀비 프로세스를 막을 것 — 남으면 `taskkill.exe /F /IM chrome.exe`)

## Environment / Toolchain

이 저장소는 `/mnt/c/code/boramae` (Windows 파일시스템, WSL에서 편집).
**빌드 툴체인은 Windows 쪽**에 있음 — WSL 리눅스에는 node/cargo 없음.

- Node v24 (nvm4w): `/mnt/c/nvm4w/nodejs/` — WSL PATH의 `npm`이 이걸 실행
- Rust/cargo 1.94 + `cargo-tauri`: `/mnt/c/Users/레이더송신소/.cargo/bin/` (WSL PATH에 없음, `.exe`로 직접 호출)
- Tauri 앱 실행/빌드는 Windows 터미널(PowerShell)에서 하는 것을 기본으로 가정. Linux용 빌드는 지원하지 않음.
- 주의: `create-tauri-app --force`는 디렉토리 기존 파일을 삭제함 (다시 쓰지 말 것)
- 앱 아이콘: 원본 `src-tauri/app-icon.png` (1024², 투명 배경) → `npm run tauri icon src-tauri/app-icon.png`로 `src-tauri/icons/` 재생성 (android/ios 폴더는 삭제).
  아이콘만 바꾼 뒤엔 `touch src-tauri/build.rs` 해야 exe 리소스에 재임베드됨. `public/favicon.png`도 같은 이미지로 맞출 것.

## Git

- Default branch: `main`
- Commit author: 3chan <chelly1221.com@gmail.com> (repo-local config)
- 커밋/푸시는 사용자가 요청할 때만 수행
