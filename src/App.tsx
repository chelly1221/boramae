import { useCallback, useEffect, useMemo, useState } from 'react';
import { RawModal } from './components/RawModal';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatsView } from './components/StatsView';
import { Toolbar } from './components/Toolbar';
import { MapView } from './components/map/MapView';
import { exportCsv } from './data/csv';
import { getHeatRows, getRecords } from './data/mock';
import { computeStats } from './data/stats';
import type { Range, View } from './data/types';

/** 측풍 한계선 (KT) — 추후 설정 화면에서 조절 */
const XW_LIMIT = 15;
/** 지도 시정 원 표시 여부 */
const SHOW_VIS_CIRCLE = true;
/** 타임라인 재생 간격 (ms) */
const PLAY_INTERVAL = 350;

/** 개발/스크린샷 편의: `#view=map&range=7d&raw=3&aerial=1` 형태의 해시로 초기 상태 지정 */
function initialFromHash() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const view = p.get('view');
  const range = p.get('range');
  const raw = p.get('raw');
  const aerial = p.get('aerial') === '1';
  const zoom = p.get('zoom');
  return {
    view: (view === 'map' || view === 'import' ? view : 'stats') as View,
    range: (range === '7d' || range === '30d' ? range : '24h') as Range,
    rawIdx: raw != null && /^\d+$/.test(raw) ? Number(raw) : null,
    aerial,
    mapZoom: zoom != null && /^\d+$/.test(zoom) ? Number(zoom) : undefined,
  };
}
const INIT = initialFromHash();

export default function App() {
  const [view, setView] = useState<View>(INIT.view);
  const [range, setRange] = useState<Range>(INIT.range);
  const [mapIdx, setMapIdx] = useState(() => getRecords(INIT.range).length - 1);
  const [playing, setPlaying] = useState(false);
  const [windViz, setWindViz] = useState(true);
  const [aerial, setAerial] = useState(INIT.aerial);
  const [rawIdx, setRawIdx] = useState<number | null>(INIT.rawIdx);
  const [refreshTick, setRefreshTick] = useState(0);

  // 데모: 시드 목데이터. 실제로는 Tauri 백엔드에서 기간별 레코드를 조회 (refreshTick이 재조회 트리거).
  const recs = useMemo(() => getRecords(range, refreshTick), [range, refreshTick]);
  const stats = useMemo(() => computeStats(recs, range, XW_LIMIT), [recs, range]);
  const heatRows = useMemo(() => getHeatRows(), []);
  const last = recs.length - 1;

  const openRaw = useCallback((i: number) => setRawIdx(Math.max(0, Math.min(i, last))), [last]);
  const openRawAtHour = useCallback(
    (h: number) => {
      for (let i = last; i >= 0; i--) if (recs[i].hour === h) return openRaw(i);
    },
    [recs, last, openRaw],
  );
  const closeRaw = useCallback(() => setRawIdx(null), []);
  const rawPrev = useCallback(() => setRawIdx((i) => (i == null ? null : Math.max(0, i - 1))), []);
  const rawNext = useCallback(() => setRawIdx((i) => (i == null ? null : Math.min(last, i + 1))), [last]);

  // 타임라인 재생: 350ms마다 전진, 끝에서 자동 정지
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setMapIdx((i) => {
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_INTERVAL);
    return () => clearInterval(id);
  }, [playing, last]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (mapIdx >= last) setMapIdx(0);
    setPlaying(true);
  };

  const pickMapIdx = (i: number) => {
    setPlaying(false);
    setMapIdx(i);
  };

  const changeRange = (r: Range) => {
    setPlaying(false);
    setRange(r);
    setMapIdx(getRecords(r).length - 1);
    setRawIdx(null);
  };

  const rawRec = rawIdx != null ? recs[Math.min(rawIdx, last)] : null;

  return (
    <div className="app">
      <Sidebar view={view} onChange={setView} lastTime={stats.lastTime} total={stats.total} />

      <div className="main">
        <Toolbar
          view={view}
          range={range}
          onRange={changeRange}
          windViz={windViz}
          onToggleWindViz={() => setWindViz((v) => !v)}
          aerial={aerial}
          onToggleAerial={() => setAerial((v) => !v)}
          onExportCsv={() => void exportCsv(recs, range)}
          onRefresh={() => setRefreshTick((t) => t + 1)}
        />

        <div className="content">
          {view === 'stats' && (
            <StatsView stats={stats} heatRows={heatRows} xwLimit={XW_LIMIT} onOpenRaw={openRaw} onOpenRawAtHour={openRawAtHour} />
          )}
          {view === 'map' && (
            <MapView
              recs={recs}
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

      {rawRec && (
        <RawModal
          rec={rawRec}
          pos={Math.min(rawIdx as number, last) + 1}
          total={recs.length}
          onPrev={rawPrev}
          onNext={rawNext}
          onClose={closeRaw}
        />
      )}
    </div>
  );
}
