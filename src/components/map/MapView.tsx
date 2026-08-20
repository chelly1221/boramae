import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { autoUnit, DAY, fmtDay, fmtDayHM, HOUR } from '../../data/detail/agg';
import { useWidth } from '../detail/primitives';
import { windColor } from '../../data/stats';
import type { AtisRecord, TimeWindow } from '../../data/types';
import { PeriodPicker } from '../detail/PeriodPicker';
import { IconArrowUp, IconClose, IconPause, IconPlay } from '../icons';
import { birdColor, birdHead, birdSize, useLeafletMap } from './useLeafletMap';
import { WindCanvas } from './WindCanvas';

/** 재생 배속 — 현실 시간 기준 (×900 = 실제 1초에 15분 = 1시간이 4초) */
export const PLAY_SPEEDS = [300, 900, 1800, 3600] as const;
export type PlaySpeed = (typeof PLAY_SPEEDS)[number];
/** 배속 → "1시간 = n초" 설명 */
export const speedNote = (s: PlaySpeed) => {
  const sec = 3600 / s;
  return `1시간 = ${sec >= 1 ? `${Number(sec.toFixed(1))}초` : `${Math.round(sec * 1000)}ms`}`;
};

interface Props {
  recs: AtisRecord[];
  mapIdx: number;
  playing: boolean;
  /** 재생 배속 (현실 시간 기준) */
  speed: PlaySpeed;
  onSpeed: (s: PlaySpeed) => void;
  /** 재생 중 가상 시각 (epoch ms) — 정지 중이면 null */
  playClock: number | null;
  windViz: boolean;
  aerial: boolean;
  /** 개발/스크린샷용 초기 줌 */
  initialZoom?: number;
  showVisCircle: boolean;
  onPick: (i: number) => void;
  onTogglePlay: () => void;
  /** 기간 지정 패널 (툴바 '기간 지정'으로 열고 닫음) */
  period: {
    show: boolean;
    win: TimeWindow;
    now: number;
    minTs: number;
    /** 기간 창 안의 전문 수 (솎아내기 전) */
    count: number;
    onChange: (w: TimeWindow) => void;
    onClose: () => void;
  };
}

/** 스크러버 셀이 이 개수를 넘으면 화살표를 숨긴다 (너무 좁아짐) */
const ARROW_MAX_CELLS = 96;
/** 보이는 구간을 이 셀 수 이하로 균등 솎아냄 (줌인하면 솎지 않고 전부 보임) */
const MAX_CELLS = 240;
/** 줌 최소 구간 (전문 수) */
const MIN_VIEW = 8;
/** 드래그로 판정하는 최소 이동 (px) — 그 미만은 클릭(선택) */
const DRAG_PX = 4;

/** [a, b) 구간 인덱스를 max개 이하로 균등 솎아낸 원본 인덱스 목록 (마지막은 항상 포함) */
function thinIdx(a: number, b: number, max: number): number[] {
  const n = b - a;
  if (n <= 0) return [];
  const step = Math.max(1, Math.ceil(n / max));
  const out: number[] = [];
  for (let i = a; i < b; i += step) out.push(i);
  if (out[out.length - 1] !== b - 1) out.push(b - 1);
  return out;
}
/** 시각 축 눈금 간격 (6시간) — 라벨은 폭에 맞춰 6h/12h/1d/2d/7d 중 하나로 솎음 */
const TICK_MS = 6 * HOUR;
const LABEL_STEPS = [6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
const LABEL_MIN_PX = 54;

interface AxisTick {
  ts: number;
  /** 스크러버 폭 대비 위치 (0–1) */
  x: number;
  /** 라벨 (없으면 눈금만) */
  label: string;
  /** 00Z(날짜 경계) 눈금 — 굵게 */
  day: boolean;
}

/**
 * 스크러버 시각 축. 셀은 전문 개수 기준 등간격이므로 눈금 시각을 이웃 전문 사이에서 보간해 셀 위치로 바꾼다
 * (전문 i의 시각 = 셀 i의 중앙). 눈금은 6시간마다, 라벨은 폭에 따라 6h/12h/1d/2d/7d 간격으로만 단다.
 */
function axisTicks(recs: AtisRecord[], width: number): AxisTick[] {
  const n = recs.length;
  if (n < 2 || width <= 0) return [];
  const t0 = recs[0].ts;
  const t1 = recs[n - 1].ts;
  const span = t1 - t0;
  if (span <= 0) return [];
  // 6h 눈금 수 기준으로 라벨 간격 선택
  const labelStep = LABEL_STEPS.find((st) => (width * st) / span >= LABEL_MIN_PX) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
  const showTicks = (width * TICK_MS) / span >= 5;
  const out: AxisTick[] = [];
  let i = 0;
  for (let t = Math.ceil(t0 / TICK_MS) * TICK_MS; t <= t1; t += TICK_MS) {
    while (i + 1 < n - 1 && recs[i + 1].ts <= t) i++;
    const a = recs[i].ts;
    const b = recs[i + 1].ts;
    const frac = b > a ? (t - a) / (b - a) : 0;
    const x = (i + 0.5 + Math.min(1, Math.max(0, frac))) / n;
    const day = t % DAY === 0;
    const labeled = t % labelStep === 0;
    if (!labeled && !showTicks) continue;
    out.push({ ts: t, x, label: labeled ? (day ? fmtDay(t) : `${String(new Date(t).getUTCHours()).padStart(2, '0')}Z`) : '', day });
  }
  return out;
}

const WIND_LEGEND: [string, string][] = [
  ['#5b8bc9', '≤6KT'],
  ['#4aa88c', '9'],
  ['#8fb84e', '12'],
  ['#d9b83a', '15'],
  ['#e08a35', '18'],
  ['#c8422e', '19KT+'],
];

export function MapView({ recs, mapIdx, playing, speed, onSpeed, playClock, windViz, aerial, initialZoom, showVisCircle, onPick, onTogglePlay, period }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mi = Math.min(mapIdx, recs.length - 1);
  const cur = recs[mi];

  useLeafletMap(mapEl, { vis: cur.vis, visTxt: cur.visTxt, showVis: showVisCircle, activeRwy: cur.rwy, arrRwy: cur.arrRwy, depRwy: cur.depRwy, birds: cur.birds, aerial }, initialZoom);

  const n = recs.length;
  /* ---------- 타임라인 뷰포트 (줌/팬): 원본 인덱스 [a, b) — null이면 전체 ---------- */
  const [view, setView] = useState<{ a: number; b: number } | null>(null);
  useEffect(() => setView(null), [recs]); // 기간이 바뀌면 전체로
  const a = view ? Math.max(0, Math.min(view.a, n - 1)) : 0;
  const b = view ? Math.max(a + 1, Math.min(view.b, n)) : n;
  const size = b - a;
  const zoomed = size < n;
  const cells = useMemo(() => thinIdx(a, b, MAX_CELLS), [a, b]);
  const visible = useMemo(() => cells.map((i) => recs[i]), [cells, recs]);
  const showArrows = cells.length <= ARROW_MAX_CELLS;
  const [stripRef, stripW] = useWidth<HTMLDivElement>();
  const ticks = useMemo(() => axisTicks(visible, stripW), [visible, stripW]);
  /** 선택 전문이 속한 셀 (솎인 경우 직전 셀) — 구간 밖이면 -1 */
  const selCell = useMemo(() => {
    if (mi < a || mi >= b) return -1;
    let k = 0;
    while (k + 1 < cells.length && cells[k + 1] <= mi) k++;
    return k;
  }, [cells, mi, a, b]);

  const setRange = (na: number, nsize: number) => {
    const sz = Math.max(Math.min(MIN_VIEW, n), Math.min(n, Math.round(nsize)));
    const start = Math.max(0, Math.min(Math.round(na), n - sz));
    if (sz >= n) setView(null);
    else setView({ a: start, b: start + sz });
  };
  /** 배율 zoom(>1 확대)로 pivot(구간 내 0–1 위치) 기준 줌 */
  const zoomAt = (factor: number, pivot: number) => {
    const p = a + pivot * size;
    const nsize = size / factor;
    setRange(p - pivot * nsize, nsize);
  };

  // 휠 줌 (네이티브 리스너 — passive:false 로 페이지 스크롤 방지)
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pivot = rect.width ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0.5;
      if (e.shiftKey) {
        // Shift+휠: 팬
        setRange(a + Math.sign(e.deltaY) * Math.max(1, size * 0.15), size);
      } else zoomAt(e.deltaY < 0 ? 1.3 : 1 / 1.3, pivot);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripRef, a, size, n]);

  // 드래그 팬 / 클릭 선택
  const drag = useRef<{ x0: number; a0: number; moved: boolean } | null>(null);
  const cellAt = (clientX: number) => {
    const el = stripRef.current;
    if (!el || !cells.length) return -1;
    const rect = el.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.floor(f * cells.length);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x0: e.clientX, a0: a, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < DRAG_PX) return;
    d.moved = true;
    if (!zoomed || !stripW) return;
    setRange(d.a0 - (dx / stripW) * size, size);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      const k = cellAt(e.clientX);
      if (k >= 0) onPick(cells[k]);
    }
  };

  // 재생 중 선택 전문이 구간 밖으로 나가면 따라가며 스크롤 (선택이 구간의 30% 지점에 오도록)
  useEffect(() => {
    if (!playing || !zoomed) return;
    if (mi >= a && mi < b) return;
    setRange(mi - size * 0.3, size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mi, playing]);

  return (
    <div className={`mapview${aerial ? ' mapview--aerial' : ''}`}>
      <div ref={mapEl} className="mapview__map" />
      <WindCanvas dir={cur.dir} spd={cur.spd} visible={windViz} bright={aerial} />

      {/* 기간 지정 패널 (상세 페이지와 같은 PeriodPicker) */}
      {period.show && (
        <div className="map-period">
          <PeriodPicker win={period.win} onChange={period.onChange} now={period.now} minTs={period.minTs} count={period.count} unit={autoUnit(recs, period.win)} />
          <div className="icon-btn map-period__close" title="닫기" onClick={period.onClose}>
            <IconClose />
          </div>
        </div>
      )}

      {/* 플로팅 카드 */}
      <div className="map-cards">
        <div className="map-card">
          <span className="map-card__label">선택 시각 ATIS · {cur.time}</span>
          <div className="map-card__row">
            <span className="info-badge">{cur.letter}</span>
            <span className="map-card__main">
              {cur.wind} · RWY {cur.arrRwy ?? '—'}↓ {cur.depRwy ?? '—'}↑
            </span>
          </div>
          <span className="map-card__sub">
            VIS {cur.visTxt} · {cur.cloud} · QNH {cur.qnh}
          </span>
        </div>
        <div className="map-card map-card--birds">
          <div className="map-card__between">
            <span className="map-card__label">BIRD ACTIVITY</span>
            <span className="badge-orange">{cur.birds.length ? `보고 ${cur.birds.length}건` : '보고 없음'}</span>
          </div>
          {cur.birds.length ? (
            cur.birds.map((z) => (
              <div key={birdHead(z)} className="bird">
                <span className="bird__dot" style={{ background: birdColor(z) }} />
                <span>
                  {z.kind} FLOCK · {z.nm}NM {z.dir} · {birdSize(z)}
                </span>
              </div>
            ))
          ) : (
            <span className="map-card__sub">선택 시각 전문에 조류 활동 보고 없음</span>
          )}
          <div className="map-card__foot">최근 7일 충돌/회피 보고 2건</div>
        </div>
      </div>

      {/* 타임 스크러버 */}
      <div className="scrubber">
        <div className="scrubber__play" onClick={onTogglePlay} title={playing ? '일시정지' : '재생'}>
          {playing ? <IconPause /> : <IconPlay />}
        </div>
        <div className="scrubber__body">
          <div className="scrubber__head">
            <span className="scrubber__label">타임라인 재생 (현실 시간 × 배속) · 풍향(화살표) / 풍속(색상)</span>
            {playClock != null && <span className="scrubber__clock">재생 {fmtDayHM(playClock)}</span>}
            <div className="scrubber__speed" title={`재생 배속 (현실 시간 기준) · ${speedNote(speed)} · 3시간 넘는 공백은 건너뜀`}>
              {PLAY_SPEEDS.map((sp) => (
                <span key={sp} className={`scrubber__speed-item${sp === speed ? ' scrubber__speed-item--active' : ''}`} title={speedNote(sp)} onClick={() => onSpeed(sp)}>
                  ×{sp}
                </span>
              ))}
            </div>
            <span className="scrubber__count" title="현재 배속">
              {speedNote(speed)}
            </span>
            <div className="scrubber__zoom" title="타임라인 줌 — 휠: 확대/축소 · 드래그 또는 Shift+휠: 이동 · 더블클릭: 전체">
              <span className="scrubber__zoom-btn" onClick={() => zoomAt(1 / 1.6, 0.5)}>
                −
              </span>
              <span className="scrubber__zoom-btn" onClick={() => zoomAt(1.6, selCell >= 0 ? (selCell + 0.5) / cells.length : 0.5)}>
                +
              </span>
              <span className={`scrubber__zoom-btn${zoomed ? '' : ' scrubber__zoom-btn--off'}`} onClick={() => setView(null)}>
                전체
              </span>
            </div>
            <span className="scrubber__count">{zoomed ? `${size.toLocaleString()} / ${n.toLocaleString()}건` : `${n.toLocaleString()}건`}</span>
            <span className="scrubber__time">{cur.time}</span>
            <span className="scrubber__info">
              INFO {cur.letter} · {cur.wind} · VIS {cur.visTxt}
            </span>
          </div>
          <div
            className={`scrubber__strip${zoomed ? ' scrubber__strip--zoomed' : ''}`}
            ref={stripRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onDoubleClick={() => setView(null)}
          >
            {cells.map((idx, k) => {
              const r = recs[idx];
              return (
                <div key={idx} className={`scrubber__cell${k === selCell ? ' scrubber__cell--sel' : ''}`} title={`${r.time} · ${r.wind}`} style={{ background: windColor(r.spd) }}>
                  {showArrows && <IconArrowUp rotate={(Math.round(r.dir) + 180) % 360} />}
                </div>
              );
            })}
          </div>
          {/* 시각 축: 6시간 눈금, 00Z는 날짜 */}
          <div className="scrubber__axis">
            {ticks.map((t) => (
              <div key={t.ts} className={`scrubber__tick${t.day ? ' scrubber__tick--day' : ''}${t.label ? ' scrubber__tick--labeled' : ''}`} style={{ left: `${(t.x * 100).toFixed(3)}%` }}>
                {t.label && <span>{t.label}</span>}
              </div>
            ))}
          </div>
          <div className="scrubber__foot">
            <span>{visible[0]?.time}</span>
            <div className="wind-legend">
              {WIND_LEGEND.map(([c, t]) => (
                <div key={t} className="wind-legend__item">
                  <span className="wind-legend__sw" style={{ background: c }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <span>{visible[visible.length - 1]?.time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
