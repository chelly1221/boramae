import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RawModal } from './components/RawModal';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatsView } from './components/StatsView';
import { Toolbar } from './components/Toolbar';
import { DetailView } from './components/detail/DetailView';
import { PeriodPicker } from './components/detail/PeriodPicker';
import { PANELS } from './components/detail/panels';
import { MapView, type PlaySpeed } from './components/map/MapView';
import { useAtis } from './data/atis/useAtis';
import { anchorOf, dataStart, rangeWindow, recordsBetween } from './data/atis/store';
import { exportCsv } from './data/csv';
import { computeHeatRows, computeStats } from './data/stats';
import type { AtisRecord, DetailKey, Range, TimeWindow, View } from './data/types';

/** 측풍 한계선 (KT) — 추후 설정 화면에서 조절 */
const XW_LIMIT = 15;
/** 지도 시정 원 표시 여부 */
const SHOW_VIS_CIRCLE = true;
/** 재생 중 전문 사이 공백이 이보다 크면(수신 공백·야간 등) 기다리지 않고 다음 전문으로 건너뜀 (가상 시각 기준) */
const PLAY_GAP_SKIP_MS = 3 * 3600000;
/** 재생 가상 시계 표시 갱신 간격 (ms) */
const PLAY_CLOCK_REFRESH_MS = 250;
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
 * `#view=stats&detail=qnh&from=2026080100&to=2026081512` 형태의 해시로 초기 상태 지정 (지도 뷰에서 from/to는 지도 기간, `period=1`이면 기간 패널 열림)
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
  const period = p.get('period') === '1';
  return {
    period,
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
  const [win, setWin] = useState<TimeWindow | null>(INIT.win);
  // 지도 타임 스크러버 위치 — null이면 마지막 전문
  const [mapIdx, setMapIdx] = useState<number | null>(INIT.mapIdx);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<PlaySpeed>(900);
  /** 재생 가상 시각 (epoch ms) — 실제 경과 시간 × 배속으로 진행 */
  const playVt = useRef(0);
  const [playClock, setPlayClock] = useState<number | null>(null);
  // 지도 사용자 지정 기간 (null이면 툴바 24h/7d/30d 기간) + 기간 지정 패널 표시
  const [mapWin, setMapWin] = useState<TimeWindow | null>(INIT.view === 'map' ? INIT.win : null);
  const [showMapPeriod, setShowMapPeriod] = useState(INIT.view === 'map' && INIT.period);
  const [windViz, setWindViz] = useState(true);
  const [aerial, setAerial] = useState(INIT.aerial);
  const [raw, setRaw] = useState<RawState | null>(null);

  // 감시 폴더의 전문 (적재·감시). 파생값은 전부 여기서 나온 레코드 배열로 계산.
  const atis = useAtis();
  const all = atis.store.records;
  /** 기간 기준점 — 마지막 전문 시각 */
  const now = useMemo(() => anchorOf(all), [all]);
  const minTs = useMemo(() => dataStart(all), [all]);

  const recs = useMemo(() => {
    const w = rangeWindow(range, now);
    return recordsBetween(all, w.from, w.to);
  }, [all, range, now]);
  const stats = useMemo(() => computeStats(recs, range, XW_LIMIT), [recs, range]);
  // 히트맵은 기간 선택과 무관하게 최근 7일
  const heatWin = useMemo(() => rangeWindow('7d', now), [now]);
  const heatRecs = useMemo(() => recordsBetween(all, heatWin.from, heatWin.to), [all, heatWin]);
  const heatRows = useMemo(() => computeHeatRows(heatRecs, heatWin.from, heatWin.to), [heatRecs, heatWin]);
  // 상세 페이지: 사용자가 지정한 기간 창 (없으면 현재 range 창)
  const detailWin = win ?? rangeWindow(range, now);
  const detailRecs = useMemo(() => (detail ? recordsBetween(all, detailWin.from, detailWin.to) : []), [all, detail, detailWin.from, detailWin.to]);
  // 지도: 사용자 지정 기간이 있으면 그 창, 없으면 툴바 기간. 타임라인은 솎아낸 레코드로 (셀 폭·재생 시간 확보)
  const mapSrc = useMemo(() => (mapWin ? recordsBetween(all, mapWin.from, mapWin.to) : recs), [all, mapWin, recs]);
  const mapRecs = useMemo(() => thin(mapSrc, MAP_MAX_CELLS), [mapSrc]);
  const last = recs.length - 1;
  const mapLast = mapRecs.length - 1;
  const mapPos = mapIdx == null ? mapLast : Math.min(mapIdx, mapLast);

  // 해시 초기 raw 지정 (개발용) — 첫 적재 후 한 번
  const rawInit = useRef(false);
  useEffect(() => {
    if (rawInit.current || INIT.rawIdx == null || !recs.length) return;
    rawInit.current = true;
    setRaw({ list: recs, idx: Math.min(INIT.rawIdx, recs.length - 1) });
  }, [recs]);

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
      setWin(rangeWindow(range, now)); // 카드가 보여주던 기간으로 시작
      setDetail(key);
      setRaw(null);
    },
    [range, now],
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

  // 타임라인 재생: 가상 시계가 실제 경과 시간 × 배속으로 흐르고, 가상 시각 이하의 마지막 전문을 표시 (현실 시간 기준 재생).
  // 전문 사이 공백이 PLAY_GAP_SKIP_MS보다 크면 건너뛴다. 마지막 전문에 닿으면 정지.
  useEffect(() => {
    if (!playing || mapRecs.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let shownAt = 0;
    // 가상 시각 이하의 마지막 전문 인덱스 (이진 탐색)
    const idxAt = (vt: number) => {
      let lo = 0;
      let hi = mapRecs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (mapRecs[mid].ts <= vt) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let vt = playVt.current + dt * playSpeed;
      let i = idxAt(vt);
      if (i >= mapLast) {
        playVt.current = mapRecs[mapLast].ts;
        setMapIdx(mapLast);
        setPlayClock(null);
        setPlaying(false);
        return;
      }
      const next = mapRecs[i + 1];
      if (next.ts - vt > PLAY_GAP_SKIP_MS) {
        vt = next.ts;
        i++;
      }
      playVt.current = vt;
      setMapIdx((prev) => (prev === i ? prev : i));
      if (now - shownAt >= PLAY_CLOCK_REFRESH_MS) {
        shownAt = now;
        setPlayClock(vt);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, playSpeed, mapRecs, mapLast]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      setPlayClock(null);
      return;
    }
    if (!mapRecs.length) return;
    // 끝에서 누르면 처음부터
    const start = mapPos >= mapLast ? 0 : mapPos;
    playVt.current = mapRecs[start].ts;
    setMapIdx(start);
    setPlayClock(playVt.current);
    setPlaying(true);
  };

  const pickMapIdx = (i: number) => {
    setPlaying(false);
    setPlayClock(null);
    setMapIdx(i);
    if (mapRecs[i]) playVt.current = mapRecs[i].ts;
  };

  const changeRange = (r: Range) => {
    setPlaying(false);
    setRange(r);
    setMapIdx(null);
    setMapWin(null); // 지도 사용자 지정 기간 해제 → 툴바 기간으로
    setRaw(null);
  };
  /** 지도 '기간 지정' 토글 — 열 때 현재 기간 창으로 초기화 */
  const toggleMapPeriod = () => {
    if (showMapPeriod) {
      setShowMapPeriod(false);
      return;
    }
    if (!mapWin) setMapWin(rangeWindow(range, now));
    setShowMapPeriod(true);
  };
  const changeMapWin = (w: TimeWindow) => {
    setPlaying(false);
    setMapWin(w);
    setMapIdx(null);
  };

  const rawRec = raw ? raw.list[Math.min(raw.idx, raw.list.length - 1)] : null;
  const showDetail = view === 'stats' && detail != null;
  const panel = detail ? PANELS[detail] : null;

  return (
    <div className="app">
      <Sidebar
        view={view}
        detail={showDetail ? detail : null}
        onChange={changeView}
        onOpenDetail={openDetail}
        lastTime={all.length ? all[all.length - 1].time : '—'}
        total={all.length}
        status={atis.status}
        watching={atis.watching}
        error={atis.error || atis.scan?.error || ''}
      />

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
          onExportCsv={() => void exportCsv(showDetail ? detailRecs : recs, showDetail ? `${detail}_${tsTag(detailWin.from)}-${tsTag(detailWin.to)}` : range)}
          onRefresh={() => void atis.reload()}
          loading={atis.status === 'loading' || atis.scanning}
          mapCustomPeriod={view === 'map' && mapWin != null}
          onMapPeriod={toggleMapPeriod}
        />

        <div className="content">
          {view === 'stats' && !showDetail && (atis.status !== 'ready' || !all.length) && (
            <div className="card" style={{ margin: 22 }}>
              <div className="dempty">
                {atis.status === 'loading'
                  ? `전문을 읽는 중 · ${atis.dir}`
                  : atis.status === 'error'
                    ? `폴더를 읽지 못했습니다 · ${atis.error} — 설정에서 폴더를 지정하세요`
                    : atis.scan?.error
                      ? `폴더 스캔 오류 · ${atis.scan.error}`
                      : `보관된 전문이 없습니다 · ${atis.dir} 의 파일을 스캔하는 중입니다 (첫 스캔은 파일 수에 따라 1분 이상 걸릴 수 있음)`}
              </div>
            </div>
          )}
          {view === 'stats' && !showDetail && atis.status === 'ready' && all.length > 0 && (
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
              win={detailWin}
              onWindow={setWin}
              now={now}
              minTs={minTs}
              xwLimit={XW_LIMIT}
              onOpenRaw={openDetailRaw}
            />
          )}
          {view === 'map' && mapRecs.length > 0 && (
            <MapView
              recs={mapRecs}
              mapIdx={mapPos}
              playing={playing}
              speed={playSpeed}
              onSpeed={setPlaySpeed}
              playClock={playClock}
              windViz={windViz}
              aerial={aerial}
              initialZoom={INIT.mapZoom}
              showVisCircle={SHOW_VIS_CIRCLE}
              onPick={pickMapIdx}
              onTogglePlay={togglePlay}
              period={{
                show: showMapPeriod,
                win: mapWin ?? rangeWindow(range, now),
                now,
                minTs,
                count: mapSrc.length,
                onChange: changeMapWin,
                onClose: () => setShowMapPeriod(false),
              }}
            />
          )}
          {view === 'map' && !mapRecs.length && (
            <div style={{ margin: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mapWin && <PeriodPicker win={mapWin} onChange={changeMapWin} now={now} minTs={minTs} count={0} unit="raw" />}
              <div className="card">
                <div className="dempty">{atis.status === 'loading' ? '전문을 읽는 중…' : mapWin ? '지정한 기간에 전문이 없습니다. 기간을 조정하세요.' : '표시할 전문이 없습니다. 설정에서 감시 폴더를 확인하세요.'}</div>
              </div>
            </div>
          )}
          {view === 'import' && (
            <SettingsView
              dir={atis.dir}
              status={atis.status}
              error={atis.error}
              watching={atis.watching}
              paused={atis.paused}
              loadedAt={atis.loadedAt}
              scan={atis.scan}
              scanning={atis.scanning}
              db={atis.db}
              store={atis.store}
              onChangeDir={() => void atis.changeDir()}
              onTogglePause={() => atis.setPaused((p) => !p)}
              onScanNow={() => void atis.reload()}
              onReloadAll={() => void atis.reloadAll()}
            />
          )}
        </div>
      </div>

      {rawRec && raw && (
        <RawModal rec={rawRec} pos={Math.min(raw.idx, raw.list.length - 1) + 1} total={raw.list.length} onPrev={rawPrev} onNext={rawNext} onClose={closeRaw} />
      )}
    </div>
  );
}
