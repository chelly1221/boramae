import { useCallback, useEffect, useMemo, useState } from 'react';
import { RawModal } from './components/RawModal';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatsView } from './components/StatsView';
import { Toolbar } from './components/Toolbar';
import { DetailView } from './components/detail/DetailView';
import { PANELS } from './components/detail/panels';
import { MapView } from './components/map/MapView';
import { exportCsv } from './data/csv';
import { DATA_START, MOCK_NOW, getRecords, getRecordsBetween, rangeWindow } from './data/mock';
import { computeHeatRows, computeStats } from './data/stats';
import type { AtisRecord, DetailKey, Range, TimeWindow, View } from './data/types';

/** 측풍 한계선 (KT) — 추후 설정 화면에서 조절 */
const XW_LIMIT = 15;
/** 지도 시정 원 표시 여부 */
const SHOW_VIS_CIRCLE = true;
/** 타임라인 재생 간격 (ms) */
const PLAY_INTERVAL = 350;
/** 지도 타임라인(스크러버) 최대 셀 수 — 초과 시 균등 간격으로 솎아냄 (30일 ≈ 1,500건 → 240) */
const MAP_MAX_CELLS = 240;

/** 균등 간격 샘플링 (마지막 레코드는 항상 포함) */
function thin(recs: AtisRecord[], max: number): AtisRecord[] {
  if (recs.length <= max) return recs;
  const step = Math.ceil(recs.length / max);
  const out: AtisRecord[] = [];
  for (let i = 0; i < recs.length; i += step) out.push(recs[i]);
  if (out[out.length - 1] !== recs[recs.length - 1]) out.push(recs[recs.length - 1]);
  return out;
}

/** ts → "YYYYMMDDHH" (CSV 파일명·해시용) */
function tsTag(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}`;
}

/** 해시의 YYYYMMDDHH 또는 epoch ms → ts */
function parseTs(v: string | null): number | null {
  if (!v) return null;
  if (/^\d{10}$/.test(v)) return Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10));
  if (/^\d{12,}$/.test(v)) return Number(v);
  return null;
}

/**
 * 개발/스크린샷 편의: `#view=map&range=7d&raw=3&idx=40&aerial=0&zoom=15` (idx = 타임 스크러버 위치) 또는
 * `#view=stats&detail=qnh&from=2026080100&to=2026081512` 형태의 해시로 초기 상태 지정
 */
function initialFromHash() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const view = p.get('view');
  const range = p.get('range');
  const raw = p.get('raw');
  // 항공사진 오버레이는 기본 ON — `aerial=0`일 때만 끔
  const aerial = p.get('aerial') !== '0';
  const zoom = p.get('zoom');
  const idx = p.get('idx');
  const detail = p.get('detail');
  const from = parseTs(p.get('from'));
  const to = parseTs(p.get('to'));
  return {
    view: (view === 'map' || view === 'import' ? view : 'stats') as View,
    range: (range === '7d' || range === '30d' ? range : '24h') as Range,
    rawIdx: raw != null && /^\d+$/.test(raw) ? Number(raw) : null,
    aerial,
    mapZoom: zoom != null && /^\d+$/.test(zoom) ? Number(zoom) : undefined,
    mapIdx: idx != null && /^\d+$/.test(idx) ? Number(idx) : null,
    detail: detail && detail in PANELS ? (detail as DetailKey) : null,
    win: from != null && to != null && to > from ? ({ from, to } as TimeWindow) : null,
  };
}
const INIT = initialFromHash();

/** 원문 모달 상태 — 탐색 중인 레코드 배열과 그 안의 인덱스 */
interface RawState {
  list: AtisRecord[];
  idx: number;
}

export default function App() {
  const [view, setView] = useState<View>(INIT.view);
  const [range, setRange] = useState<Range>(INIT.range);
  const [detail, setDetail] = useState<DetailKey | null>(INIT.detail);
  const [win, setWin] = useState<TimeWindow>(INIT.win ?? rangeWindow(INIT.range));
  const [mapIdx, setMapIdx] = useState(() => {
    const last = thin(getRecords(INIT.range), MAP_MAX_CELLS).length - 1;
    return INIT.mapIdx != null ? Math.min(INIT.mapIdx, last) : last;
  });
  const [playing, setPlaying] = useState(false);
  const [windViz, setWindViz] = useState(true);
  const [aerial, setAerial] = useState(INIT.aerial);
  const [raw, setRaw] = useState<RawState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // 데모: 시드 목데이터. 실제로는 Tauri 백엔드에서 기간별 레코드를 조회 (refreshTick이 재조회 트리거).
  const recs = useMemo(() => getRecords(range, refreshTick), [range, refreshTick]);
  const stats = useMemo(() => computeStats(recs, range, XW_LIMIT), [recs, range]);
  // 히트맵은 기간 선택과 무관하게 최근 7일
  const heatRecs = useMemo(() => getRecords('7d', refreshTick), [refreshTick]);
  const heatRows = useMemo(() => {
    const w = rangeWindow('7d');
    return computeHeatRows(heatRecs, w.from, w.to);
  }, [heatRecs]);
  // 상세 페이지: 사용자가 지정한 기간 창
  const detailRecs = useMemo(() => (detail ? getRecordsBetween(win.from, win.to, refreshTick) : []), [detail, win, refreshTick]);
  // 지도 타임라인은 솎아낸 레코드로 (셀 폭·재생 시간 확보)
  const mapRecs = useMemo(() => thin(recs, MAP_MAX_CELLS), [recs]);
  const last = recs.length - 1;
  const mapLast = mapRecs.length - 1;

  // 해시 초기 raw 지정 (개발용)
  useEffect(() => {
    if (INIT.rawIdx != null && recs.length) setRaw({ list: recs, idx: Math.min(INIT.rawIdx, recs.length - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRawIn = useCallback((list: AtisRecord[], i: number) => {
    if (!list.length) return;
    setRaw({ list, idx: Math.max(0, Math.min(i, list.length - 1)) });
  }, []);
  const openRaw = useCallback((i: number) => openRawIn(recs, i), [recs, openRawIn]);
  const openHeatRaw = useCallback((i: number) => openRawIn(heatRecs, i), [heatRecs, openRawIn]);
  const openDetailRaw = useCallback((i: number) => openRawIn(detailRecs, i), [detailRecs, openRawIn]);
  const openRawAtHour = useCallback(
    (h: number) => {
      for (let i = last; i >= 0; i--) if (recs[i].hour === h) return openRaw(i);
    },
    [recs, last, openRaw],
  );
  const closeRaw = useCallback(() => setRaw(null), []);
  const rawPrev = useCallback(() => setRaw((r) => (r ? { ...r, idx: Math.max(0, r.idx - 1) } : r)), []);
  const rawNext = useCallback(() => setRaw((r) => (r ? { ...r, idx: Math.min(r.list.length - 1, r.idx + 1) } : r)), []);

  // 상세 페이지 열기/닫기
  const openDetail = useCallback(
    (key: DetailKey) => {
      setWin(rangeWindow(range)); // 카드가 보여주던 기간으로 시작
      setDetail(key);
      setRaw(null);
    },
    [range],
  );
  const closeDetail = useCallback(() => {
    setDetail(null);
    setRaw(null);
  }, []);
  const changeView = (v: View) => {
    setView(v);
    setDetail(null);
    setRaw(null);
  };
  // ESC: 모달이 없을 때 상세 → 통계로
  useEffect(() => {
    if (!detail || raw) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, raw, closeDetail]);

  // 타임라인 재생: 350ms마다 전진, 끝에서 자동 정지
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setMapIdx((i) => {
        if (i >= mapLast) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_INTERVAL);
    return () => clearInterval(id);
  }, [playing, mapLast]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (mapIdx >= mapLast) setMapIdx(0);
    setPlaying(true);
  };

  const pickMapIdx = (i: number) => {
    setPlaying(false);
    setMapIdx(i);
  };

  const changeRange = (r: Range) => {
    setPlaying(false);
    setRange(r);
    setMapIdx(thin(getRecords(r), MAP_MAX_CELLS).length - 1);
    setRaw(null);
  };

  const rawRec = raw ? raw.list[Math.min(raw.idx, raw.list.length - 1)] : null;
  const showDetail = view === 'stats' && detail != null;
  const panel = detail ? PANELS[detail] : null;

  return (
    <div className="app">
      <Sidebar view={view} detail={showDetail ? detail : null} onChange={changeView} onOpenDetail={openDetail} lastTime={stats.lastTime} total={stats.total} />

      <div className="main">
        <Toolbar
          view={view}
          range={range}
          onRange={changeRange}
          detailTitle={showDetail && panel ? panel.title : undefined}
          detailSub={showDetail && panel ? panel.sub : undefined}
          onBack={closeDetail}
          windViz={windViz}
          onToggleWindViz={() => setWindViz((v) => !v)}
          aerial={aerial}
          onToggleAerial={() => setAerial((v) => !v)}
          onExportCsv={() => void exportCsv(showDetail ? detailRecs : recs, showDetail ? `${detail}_${tsTag(win.from)}-${tsTag(win.to)}` : range)}
          onRefresh={() => setRefreshTick((t) => t + 1)}
        />

        <div className="content">
          {view === 'stats' && !showDetail && (
            <StatsView
              stats={stats}
              heatRows={heatRows}
              xwLimit={XW_LIMIT}
              onOpenRaw={openRaw}
              onOpenHeatRaw={openHeatRaw}
              onOpenRawAtHour={openRawAtHour}
              onOpenDetail={openDetail}
            />
          )}
          {showDetail && detail && (
            <DetailView
              key={detail}
              detailKey={detail}
              recs={detailRecs}
              win={win}
              onWindow={setWin}
              now={MOCK_NOW}
              minTs={DATA_START}
              xwLimit={XW_LIMIT}
              onOpenRaw={openDetailRaw}
            />
          )}
          {view === 'map' && (
            <MapView
              recs={mapRecs}
              mapIdx={mapIdx}
              playing={playing}
              windViz={windViz}
              aerial={aerial}
              initialZoom={INIT.mapZoom}
              showVisCircle={SHOW_VIS_CIRCLE}
              onPick={pickMapIdx}
              onTogglePlay={togglePlay}
            />
          )}
          {view === 'import' && <SettingsView />}
        </div>
      </div>

      {rawRec && raw && (
        <RawModal rec={rawRec} pos={Math.min(raw.idx, raw.list.length - 1) + 1} total={raw.list.length} onPrev={rawPrev} onNext={rawNext} onClose={closeRaw} />
      )}
    </div>
  );
}
