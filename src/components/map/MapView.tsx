import { useEffect, useMemo, useRef, useState } from 'react';
import { autoUnit, fmtDayHM, fmtDT, HOUR } from '../../data/detail/agg';
import type { AtisRecord, TimeWindow } from '../../data/types';
import { PeriodPicker } from '../detail/PeriodPicker';
import { IconClose, IconPause, IconPlay } from '../icons';
import { fullView, Timeline, type TimeView } from './Timeline';
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
  /* ---------- 타임라인 시간 구간 (줌/팬): null = 전체 ---------- */
  const [view, setView] = useState<TimeView | null>(null);
  useEffect(() => setView(null), [recs]); // 기간이 바뀌면 전체로
  const full = useMemo(() => fullView(recs), [recs]);
  const v = view ?? full;
  const zoomed = view != null;
  const [hoverIdx, setHoverIdx] = useState(-1);
  const hoverRec = hoverIdx >= 0 ? recs[hoverIdx] : null;
  /** 보이는 구간의 전문 수 */
  const visibleN = useMemo(() => {
    let c = 0;
    for (const r of recs) if (r.ts >= v.from && r.ts <= v.to) c++;
    return c;
  }, [recs, v.from, v.to]);

  const zoomBy = (factor: number) => {
    const span = v.to - v.from;
    const pivot = cur && cur.ts >= v.from && cur.ts <= v.to ? cur.ts : v.from + span / 2;
    const nsp = Math.max(HOUR, span / factor);
    if (nsp >= full.to - full.from) {
      setView(null);
      return;
    }
    const k = (pivot - v.from) / span;
    let from = pivot - k * nsp;
    if (from < full.from) from = full.from;
    if (from + nsp > full.to) from = full.to - nsp;
    setView({ from, to: from + nsp });
  };

  // 재생 중 선택 전문이 구간 밖으로 나가면 따라가며 스크롤 (선택이 구간의 30% 지점에 오도록)
  const playRef = useRef(playing);
  playRef.current = playing;
  useEffect(() => {
    if (!playRef.current || !view || !cur) return;
    if (cur.ts >= view.from && cur.ts <= view.to) return;
    const span = view.to - view.from;
    let from = cur.ts - span * 0.3;
    if (from < full.from) from = full.from;
    if (from + span > full.to) from = full.to - span;
    setView({ from, to: from + span });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mi]);

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
            <span className="scrubber__label">
              타임라인 (실제 시각 비례) · 풍향(화살표) / 풍속(색상)
              {hoverRec && (
                <span className="scrubber__hover">
                  {' '}
                  · {fmtDT(hoverRec.ts)} INFO {hoverRec.letter} · {hoverRec.wind} · VIS {hoverRec.visTxt}
                </span>
              )}
            </span>
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
              <span className="scrubber__zoom-btn" onClick={() => zoomBy(1 / 1.6)}>
                −
              </span>
              <span className="scrubber__zoom-btn" onClick={() => zoomBy(1.6)}>
                +
              </span>
              <span className={`scrubber__zoom-btn${zoomed ? '' : ' scrubber__zoom-btn--off'}`} onClick={() => setView(null)}>
                전체
              </span>
            </div>
            <span className="scrubber__count">{zoomed ? `${visibleN.toLocaleString()} / ${n.toLocaleString()}건` : `${n.toLocaleString()}건`}</span>
            <span className="scrubber__time">{cur.time}</span>
            <span className="scrubber__info">
              INFO {cur.letter} · {cur.wind} · VIS {cur.visTxt}
            </span>
          </div>
          <Timeline recs={recs} sel={mi} onPick={onPick} view={view} onView={setView} playClock={playClock} onHover={setHoverIdx} />
          <div className="scrubber__foot">
            <span>{fmtDayHM(v.from)}</span>
            <div className="wind-legend">
              {WIND_LEGEND.map(([c, t]) => (
                <div key={t} className="wind-legend__item">
                  <span className="wind-legend__sw" style={{ background: c }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <span>{fmtDayHM(v.to)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
