# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**boramae — ATIS Analyzer**: 김포국제공항(RKSS) ATIS 전문(電文)을 폴더 감시로 자동 수집·파싱하여
통계 분석 / 지도 시각화 / 원문 열람을 제공하는 Tauri v2 데스크탑 앱. 사용자는 KAC 보라매(항공 운영·관제 지원) 담당자.

- Remote: git@github.com:chelly1221/boramae.git
- Status: 디자인 시안 전체를 React로 데모 구현 완료 (목데이터) + 통계 카드 클릭 → **상세 페이지**(기간 년/월/일/시 지정, 항목별 통계·그래프·이벤트 목록) 구현. 다음 단계는 Rust 백엔드(폴더 감시·파서·DB) 연결.

## Tech Stack

- **Tauri v2** (`src-tauri/`, crate `boramae`, lib `boramae_lib`) — Rust 백엔드. 현재 커맨드: `save_text_file(path, contents)`.
  예정: 폴더 감시(`notify` crate) → ATIS 파싱 → 로컬 DB → 프론트로 이벤트 push
- **React 19 + TypeScript + Vite 7** (`src/`) — 프론트엔드. 스타일은 `src/styles.css` 단일 파일(BEM식 클래스 + CSS 변수 토큰), CSS-in-JS/UI 라이브러리 없음
- 폰트: **Pretendard Variable** (npm `pretendard`, OFL) — `styles.css` 상단 `@font-face`가 `node_modules`의 woff2(≈2MB)를 참조해 빌드에 번들됨. `--font-sans` 1순위. 모노(`--font-mono`)는 시스템 폰트(Consolas 등)
- **오프라인 원칙**: 폰트·타일·Leaflet CSS 등 모든 리소스는 빌드에 포함, 런타임 네트워크 요청 없음 (CDN/웹폰트 링크 금지)
- 지도: **Leaflet 1.9** 직접 통합 (`src/components/map/useLeafletMap.ts`). 타일은 전부 오프라인(빌드 포함), 런타임 네트워크 요청 없음:
  - 베이스맵: CARTO Voyager, `tiles.config.json.basemap` 기준 줌 12 한 단계만 (`npm run tiles` → `public/tiles/`)
  - 항공사진 오버레이(토글): 2023 김포공항 항공사진 z12–16, `tiles.config.json.aerial` 기준 원본(`C:/code/BRA_Gimpo.vol1/image_tiles_Gimpo_2023`)에서 복사 (`npm run tiles:aerial` → `public/tiles-aerial/`, ~59MB)
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
- `npm run tiles:aerial` — 항공사진 타일 복사 (`tiles.config.json.aerial.source` → `public/tiles-aerial/`). 원본 없으면 건너뜀
- `npm run tauri dev` — 앱 개발 실행 (Windows 터미널에서 권장)
- `npm run tauri build` — 배포 빌드
- Rust만 검증: `cd src-tauri && cargo check` (WSL에서는 `/mnt/c/Users/레이더송신소/.cargo/bin/cargo.exe check`)

## Design Reference (`design/`)

`design/README.md`가 핸드오프 문서(화면 구성·토큰·인터랙션·상태 명세). **UI 구현 전 반드시 읽을 것.**

- `design/ATIS Analyzer.dc.html` — 메인 디자인. `<x-dc>` 내부 마크업(인라인 스타일)이 룩, 하단
  `<script type="text/x-dc">`의 `Component` 클래스가 상태·파생값 로직(KPI, 바람장미, 측풍, 히트맵 등).
  `recs()`의 시드 난수는 목데이터 → 실제 파서/DB로 대체.
- `design/map.html` — Leaflet 지도(활주로·접근경로·조류섹터·시정원·바람 파티클). 단독 실행 가능.
  부모→iframe `postMessage({type:'atis', dir, spd, vis, visTxt, showVis, showWind})`로 동기화.
- `design/support.js` — 프로토타입 런타임. 참조 불필요.
- `design/assets/boramae-e3905caf.png` — KAC 보라매 로고.

High-fidelity: 색·타이포·간격은 최종 의도값. Primary `#7f0d00`, 카드 radius 12px, 사이드바 208px (아이콘 22px·폰트 15px대로 확대 구현).

### 화면
- 사이드바(공항 목록 + 통계 분석/지도/설정 내비 + 폴더 감시 상태). `통계 분석` 아래에 상세 페이지 10종이 중첩 메뉴(`.nav__sub`, `PANEL_KEYS` 순서)로 펼쳐짐 — stats 뷰일 때만 표시, 클릭 → `openDetail(key)`. 상세가 열려 있으면 하위 항목이 선택 강조(primary), 부모는 `.nav__item--open` 은은한 톤
- 상단 툴바(기간 24h/7d/30d 세그먼트, CSV 내보내기, 새로고침, 지도 뷰에서 바람 시각화 토글). 상세 페이지에서는 `‹ 통계 분석` 뒤로가기 + 패널 제목/부제, 기간 세그먼트 숨김(기간은 상세 페이지 안에서 지정), CSV는 상세 기간 레코드 내보냄
- 통계 분석 뷰: KPI 4장 + 카드 12종 (온도/노점, 바람장미, 측풍/배풍, 활주로 비율, 전환 이벤트, 히트맵, 갱신 빈도, 구름/접근, QNH, 시정, 기상 태그). **모든 카드는 `.card--link`로 클릭 → 상세 페이지** (KPI: 총 수신/발행 간격→update, 최다 활주로→runway, 평균 QNH→qnh). 카드 안의 클릭 요소(타임라인 도트·히트맵 셀·갱신 막대)는 stopPropagation
- 상세 페이지(`DetailView`, 디자인 시안에는 없음 — 자체 설계): 상단 `PeriodPicker`(프리셋 24시간/7일/30일/90일/이번 달/지난 달/올해 + 시작·종료 년/월/일/시 셀렉트 + ◀▶ 기간 이동, UTC) → 항목별 패널(`components/detail/panels/<Key>Panel.tsx`, 레지스트리 `panels/index.ts`의 `PANELS`). 패널 구성 관례: `StatTiles`(요약) → 메인 `TimeSeriesChart`(자동 해상도 raw/1시간/1일, 점 클릭 → 원문) → `.dgrid-2` 보조 차트(일별 집계·UTC 시간대 프로파일) → 이벤트 `DetailTable`(행 클릭 → 원문) → `.dsection__note`. ESC → 통계로 복귀
- 지도 뷰: Leaflet + 타임 스크러버(재생 350ms, 레코드가 240건 넘으면 균등 솎아냄) + 플로팅 요약 카드
- 설정 뷰: 감시 폴더 / 최근 가져온 파일
- 원문 모달: ←/→ 이전·다음, ESC 닫기. 탐색 목록은 열어준 쪽의 배열(현재 기간/히트맵 7일/상세 기간)

### 상태 모델
`view` ('stats'|'map'|'import'), `range` ('24h'|'7d'|'30d'), `detail` (DetailKey|null — stats 뷰 안의 상세 페이지), `win` (TimeWindow {from,to} — 상세 조회 창, 카드 클릭 시 현재 range 창으로 초기화), `mapIdx`, `playing`, `windViz`, `aerial`, `raw` ({list, idx}|null — 원문 모달이 탐색 중인 배열과 위치).
파생값은 전부 레코드 배열에서 계산.

## Architecture

```
src/
  main.tsx                     엔트리 (styles.css import)
  App.tsx                      전역 상태(view/range/mapIdx/playing/windViz/rawIdx), 재생 타이머, 뷰 라우팅
  styles.css                   디자인 토큰 + 전 컴포넌트 스타일
  tauri.ts                     isTauri() — Tauri 웹뷰/브라우저 구분
  data/
    types.ts                   AtisRecord(ts 포함)·DetailKey·TimeWindow·HeatRow 등 도메인 타입
    airport.ts                 RKSS 정밀 좌표(ARP/활주로 시단/항행시설) + 측지 헬퍼(destination)
    mock.ts                    결정적 목데이터: getRecordsBetween(from,to) / getRecords(range) / rangeWindow, MOCK_NOW·DATA_START — 백엔드 연결 시 대체 대상
    stats.ts                   computeStats(recs, range, xwLimit): 카드 파생값 · computeHeatRows(recs, from, to) · TAG_DESC · windColor
    csv.ts                     exportCsv (Tauri 다이얼로그 / Blob 폴백)
    detail/agg.ts              상세 공용 집계·포맷 헬퍼 (autoUnit/bucketize/hourProfile/runs/changes/fmt*/niceTicks/timeTicks)
    detail/<key>.ts            패널별 순수 파생값 compute<Key>Detail(recs, win, …) — 컴포넌트에서 계산하지 않음
  components/
    Sidebar.tsx  Toolbar.tsx  StatsView.tsx  SettingsView.tsx  RawModal.tsx  icons.tsx
    TrafficLights.tsx          macOS 신호등 창 제어 (사이드바 상단) + useTauriWindow 훅
    detail/DetailView.tsx      상세 페이지 셸 (PeriodPicker + 패널)
    detail/PeriodPicker.tsx    기간 지정 (프리셋 + 년/월/일/시 + 이전/다음)
    detail/primitives.tsx      Section/Legend/StatTiles/DetailTable/Empty/useWidth
    detail/charts.tsx          TimeSeriesChart(시각축·툴팁·임계선·밴드) / BarChart(단일·누적·범위)
    detail/panels/index.ts     PANELS 레지스트리 (key → title/sub/Component), panels/types.ts PanelProps
    detail/panels/<Key>Panel.tsx  temp/wind/xwind/runway/heat/update/cloud/qnh/vis/tags 10종 (각각 data/detail/<key>.ts와 짝)
    map/MapView.tsx            지도 뷰 (플로팅 카드 + 타임 스크러버)
    map/useLeafletMap.ts       Leaflet 마운트 + 정적 레이어(활주로/경로/조류 섹터/충돌 보고) + 시정 원 갱신
    map/WindCanvas.tsx         바람 파티클 캔버스 (rAF)
public/tiles/                  오프라인 베이스맵 타일 (생성물, `npm run tiles`) + manifest.json
public/tiles-aerial/           항공사진 타일 z12–16 (생성물, `npm run tiles:aerial`) + manifest.json
scripts/fetch-tiles.mjs        CARTO 타일 다운로더 (Node, fetch)
scripts/copy-aerial-tiles.mjs  항공사진 타일 복사기
tiles.config.json              basemap/aerial 설정 (스크립트와 앱이 공유)
src-tauri/
  src/main.rs                  진입점 → boramae_lib::run()
  src/lib.rs                   Tauri builder, 플러그인(dialog), 커맨드 등록
  tauri.conf.json              창/번들 설정
  capabilities/default.json    권한 (core:default, core:window:allow-* 창 제어, dialog:default) — 플러그인 추가 시 갱신
design/                        디자인 핸드오프 (수정하지 말 것, 참조 전용)
```

### 참고 자료
- `C:\code\BRA_Gimpo.vol1\` (BRA SUITE, Cesium 기반 전파장애물 분석기) — `js/config_BRA.js`·`facilityDB.xlsx`(공항 좌표 원본), `image_tiles_Gimpo_2023/`(항공사진 z0–18, 999MB), `reference/김포공항_AIP.pdf`(공식 AIP — ATIS 파서 규격 근거). 지형/3D타일은 이 앱에 불필요.

### 프론트 관례
- 파생값은 컴포넌트에서 계산하지 않고 `data/stats.ts`(카드) / `data/detail/<key>.ts`(상세)에 모은다 (디자인의 `renderVals()` 대응).
- 차트는 인라인 SVG. 카드는 viewBox 560×130 + `linePts`/`areaPts` 헬퍼, 상세는 `detail/charts.tsx`의 px 좌표 컴포넌트(컨테이너 폭 ResizeObserver). 차트 라이브러리 없음.
- 상세 CSS 클래스: `.detail .period* .dsection .dgrid-2(.--wide) .dgrid-3 .dtiles/.dtile .dtable .tchart/.bchart(+__tip) .dempty .dsection__note`, 패널 전용은 `.p<key>-*` 접두사로 styles.css 끝 "Detail panels" 섹션에 (현재 패널들은 인라인 style 소량 + 기존 클래스 재사용으로 추가 CSS 없음).
- 상세 차트 프리미티브 규약: `TimeSeriesChart`는 결측(null)에서 선을 끊고 점 1개짜리 세그먼트는 원으로 표시, `bands`는 폭 0도 최소 1.5px, `unit` 라벨과 겹치는 최상단 눈금 라벨은 자동 숨김. `BarChart`는 값이 전부 정수면 정수 눈금(`integer` prop으로 강제), `maxBarWidth`(기본 72px)로 막대 과대 방지, `lo`로 범위 막대·`stack`으로 누적. 이벤트 구간 병합은 `agg.runs(recs, pred, maxGapMs?)` (실데이터 수신 공백 대비 gap 옵션).
- 상세 패널 정의 기준(카드와 동일): 시정 저하 vis<10, 안개 위험 스프레드 ≤2°C, 강풍 ≥15KT·정온 ≤3KT, 측풍 한계 `XW_LIMIT`(15KT)·배풍 기준 5KT, 저실링 <1000FT, QNH 급변 |Δ| ≥ 3hPa/3h, 정기 발행 = 분 00/30(그 외 임시 갱신), 활주로 전환 = 직전 전문과 rwy 다름.
- 목데이터 의미(`mock.ts`): 정기 발행 :00/:30 + 상태 급변 시 :15/:45 임시 갱신, 계절(기온·풍향 NW↔SW·QNH·강수확률)·일변화, 안개 03–06Z, 태그 BR/FG/HZ/RA/SN/TS, 활주로는 느린 풍향 250°~70° → 32. `MOCK_NOW` = 2026-08-15 12:00Z, `DATA_START` = 2024-01-01.
- 개발/스크린샷 편의: URL 해시로 초기 상태 지정 가능 — `#view=map&range=7d&raw=3&aerial=1&zoom=15`, 상세는 `#view=stats&detail=qnh&from=2026080100&to=2026081512` (YYYYMMDDHH UTC).
- 시각 확인은 `npm run dev` 후 Windows Chrome 헤드리스로 스크린샷:
  `chrome.exe --headless=new --window-size=1280,800 --screenshot=<path> http://localhost:1420/#view=map`
  (WSL curl로는 Windows vite에 접근 불가 — 브라우저도 Windows 쪽을 써야 함. vite가 `::1`에만 바인딩된 경우가 있어 `127.0.0.1` 대신 `localhost` 사용, `--hide-scrollbars --virtual-time-budget=6000` 권장)

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
