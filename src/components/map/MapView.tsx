import { useMemo, useRef } from 'react';
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

  const showArrows = recs.length <= ARROW_MAX_CELLS;
  const [stripRef, stripW] = useWidth<HTMLDivElement>();
  const ticks = useMemo(() => axisTicks(recs, stripW), [recs, stripW]);

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
            <span className="scrubber__count">{recs.length.toLocaleString()}건</span>
            <span className="scrubber__time">{cur.time}</span>
            <span className="scrubber__info">
              INFO {cur.letter} · {cur.wind} · VIS {cur.visTxt}
            </span>
          </div>
          <div className="scrubber__strip" ref={stripRef}>
            {recs.map((r, i) => (
              <div
                key={i}
                className={`scrubber__cell${i === mi ? ' scrubber__cell--sel' : ''}`}
                title={`${r.time} · ${r.wind}`}
                style={{ background: windColor(r.spd) }}
                onClick={() => onPick(i)}
              >
                {showArrows && <IconArrowUp rotate={(Math.round(r.dir) + 180) % 360} />}
              </div>
            ))}
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
            <span>{recs[0].time}</span>
            <div className="wind-legend">
              {WIND_LEGEND.map(([c, t]) => (
                <div key={t} className="wind-legend__item">
                  <span className="wind-legend__sw" style={{ background: c }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <span>{recs[recs.length - 1].time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
