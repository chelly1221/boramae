# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**boramae — ATIS Analyzer**: 김포국제공항(RKSS) ATIS 전문(電文)을 폴더 감시로 자동 수집·파싱하여
통계 분석 / 지도 시각화 / 원문 열람을 제공하는 Tauri v2 데스크탑 앱. 사용자는 KAC 보라매(항공 운영·관제 지원) 담당자.

- Remote: git@github.com:chelly1221/boramae.git
- Status: 디자인 시안 전체를 React로 데모 구현 완료 (목데이터). 다음 단계는 Rust 백엔드(폴더 감시·파서·DB) 연결.

## Tech Stack

- **Tauri v2** (`src-tauri/`, crate `boramae`, lib `boramae_lib`) — Rust 백엔드. 현재 커맨드: `save_text_file(path, contents)`.
  예정: 폴더 감시(`notify` crate) → ATIS 파싱 → 로컬 DB → 프론트로 이벤트 push
- **React 19 + TypeScript + Vite 7** (`src/`) — 프론트엔드. 스타일은 `src/styles.css` 단일 파일(BEM식 클래스 + CSS 변수 토큰), CSS-in-JS/UI 라이브러리 없음
- 지도: **Leaflet 1.9** 직접 통합 (`src/components/map/useLeafletMap.ts`). 베이스맵은 **오프라인 CARTO 타일** — `tiles.config.json`(스타일/줌/bbox) 기준으로 `npm run tiles`가 `public/tiles/{z}/{x}/{y}.png`에 한 줌만 내려받고, Leaflet은 그 줌을 native로, 나머지는 스케일링. 런타임 네트워크 요청 없음
- CSV: `tauri-plugin-dialog`의 save 다이얼로그 + `save_text_file` 커맨드. 브라우저(vite dev)에서는 Blob 다운로드 폴백
- 앱 identifier `kr.co.airport.boramae`, 창 1280×800 (min 1024×680)

## Commands

Windows 툴체인 기준 (아래 Environment 참고). WSL 셸에서 `npm`은 Windows npm으로 실행됨.

- `npm install` — 의존성 설치
- `npm run dev` — Vite 프론트만 (http://localhost:1420)
- `npm run build` — `tsc && vite build` (타입체크 포함, 프론트 검증용)
- `npm run tiles` — CARTO 베이스맵 타일 다운로드 (`tiles.config.json` 참조, `--force`로 재다운로드). 타일은 git에 커밋되어 있어 평소엔 불필요
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

High-fidelity: 색·타이포·간격은 최종 의도값. Primary `#7f0d00`, 카드 radius 12px, 사이드바 208px.

### 화면
- 사이드바(공항 목록 + 통계 분석/지도/설정 내비 + 폴더 감시 상태)
- 상단 툴바(기간 24h/7d/30d 세그먼트, CSV 내보내기, 새로고침, 지도 뷰에서 바람 시각화 토글)
- 통계 분석 뷰: KPI 4장 + 카드 12종 (온도/노점, 바람장미, 측풍/배풍, 활주로 비율, 전환 이벤트, 히트맵, 갱신 빈도, 구름/접근, QNH, 시정, 기상 태그)
- 지도 뷰: Leaflet + 타임 스크러버(재생 350ms) + 플로팅 요약 카드
- 설정 뷰: 감시 폴더 / 최근 가져온 파일
- 원문 모달: ←/→ 이전·다음, ESC 닫기

### 상태 모델
`view` ('stats'|'map'|'import'), `range` ('24h'|'7d'|'30d'), `mapIdx`, `playing`, `windViz`, `rawIdx` (null=닫힘).
파생값은 전부 레코드 배열에서 계산.

## Architecture

```
src/
  main.tsx                     엔트리 (styles.css import)
  App.tsx                      전역 상태(view/range/mapIdx/playing/windViz/rawIdx), 재생 타이머, 뷰 라우팅
  styles.css                   디자인 토큰 + 전 컴포넌트 스타일
  data/
    types.ts                   AtisRecord 등 도메인 타입
    mock.ts                    시드 목데이터 (getRecords(range), getHeatRows()) — 백엔드 연결 시 대체 대상
    stats.ts                   computeStats(recs, range, xwLimit): 모든 파생값 (KPI·차트 points·바람장미 path·이벤트 등)
    csv.ts                     exportCsv (Tauri 다이얼로그 / Blob 폴백)
  components/
    Sidebar.tsx  Toolbar.tsx  StatsView.tsx  SettingsView.tsx  RawModal.tsx  icons.tsx
    map/MapView.tsx            지도 뷰 (플로팅 카드 + 타임 스크러버)
    map/useLeafletMap.ts       Leaflet 마운트 + 정적 레이어(활주로/경로/조류 섹터/충돌 보고) + 시정 원 갱신
    map/WindCanvas.tsx         바람 파티클 캔버스 (rAF)
public/tiles/                  오프라인 베이스맵 타일 (생성물, `npm run tiles`) + manifest.json
scripts/fetch-tiles.mjs        타일 다운로더 (Node, fetch)
tiles.config.json              타일 스타일·줌·bbox 설정 (스크립트와 앱이 공유)
src-tauri/
  src/main.rs                  진입점 → boramae_lib::run()
  src/lib.rs                   Tauri builder, 플러그인(dialog), 커맨드 등록
  tauri.conf.json              창/번들 설정
  capabilities/default.json    권한 (core:default, dialog:default) — 플러그인 추가 시 갱신
design/                        디자인 핸드오프 (수정하지 말 것, 참조 전용)
```

### 프론트 관례
- 파생값은 컴포넌트에서 계산하지 않고 `data/stats.ts`에 모은다 (디자인의 `renderVals()` 대응).
- 차트는 인라인 SVG (viewBox 560×130, `linePts`/`areaPts` 헬퍼). 차트 라이브러리 없음.
- 개발/스크린샷 편의: URL 해시로 초기 상태 지정 가능 — `#view=map&range=7d&raw=3`.
- 시각 확인은 `npm run dev` 후 Windows Chrome 헤드리스로 스크린샷:
  `chrome.exe --headless=new --window-size=1280,800 --screenshot=<path> http://127.0.0.1:1420/#view=map`
  (WSL curl로는 Windows vite에 접근 불가 — 브라우저도 Windows 쪽을 써야 함)

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
