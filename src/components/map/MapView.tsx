import { useRef } from 'react';
import { windColor } from '../../data/stats';
import type { AtisRecord } from '../../data/types';
import { IconArrowUp, IconPause, IconPlay } from '../icons';
import { BIRD_ZONES, birdColor, birdHead, birdSize, useLeafletMap } from './useLeafletMap';
import { WindCanvas } from './WindCanvas';

interface Props {
  recs: AtisRecord[];
  mapIdx: number;
  playing: boolean;
  windViz: boolean;
  aerial: boolean;
  /** 개발/스크린샷용 초기 줌 */
  initialZoom?: number;
  showVisCircle: boolean;
  onPick: (i: number) => void;
  onTogglePlay: () => void;
}

/** 스크러버 셀이 이 개수를 넘으면 화살표를 숨긴다 (너무 좁아짐) */
const ARROW_MAX_CELLS = 96;

const WIND_LEGEND: [string, string][] = [
  ['#5b8bc9', '≤6KT'],
  ['#4aa88c', '9'],
  ['#8fb84e', '12'],
  ['#d9b83a', '15'],
  ['#e08a35', '18'],
  ['#c8422e', '19KT+'],
];

export function MapView({ recs, mapIdx, playing, windViz, aerial, initialZoom, showVisCircle, onPick, onTogglePlay }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mi = Math.min(mapIdx, recs.length - 1);
  const cur = recs[mi];

  useLeafletMap(mapEl, { vis: cur.vis, visTxt: cur.visTxt, showVis: showVisCircle, activeRwy: cur.rwy, aerial }, initialZoom);

  const showArrows = recs.length <= ARROW_MAX_CELLS;

  return (
    <div className="mapview">
      <div ref={mapEl} className="mapview__map" />
      <WindCanvas dir={cur.dir} spd={cur.spd} visible={windViz} />

      {/* 플로팅 카드 */}
      <div className="map-cards">
        <div className="map-card">
          <span className="map-card__label">선택 시각 ATIS · {cur.time}</span>
          <div className="map-card__row">
            <span className="info-badge">{cur.letter}</span>
            <span className="map-card__main">
              {cur.wind} · RWY {cur.rwy}
            </span>
          </div>
          <span className="map-card__sub">
            VIS {cur.visTxt} · {cur.cloud} · QNH {cur.qnh}
          </span>
        </div>
        <div className="map-card map-card--birds">
          <div className="map-card__between">
            <span className="map-card__label">BIRD ACTIVITY</span>
            <span className="badge-orange">보고 {BIRD_ZONES.length}건</span>
          </div>
          {BIRD_ZONES.map((z) => (
            <div key={birdHead(z)} className="bird">
              <span className="bird__dot" style={{ background: birdColor(z) }} />
              <span>
                {z.kind} FLOCK · {z.nm}NM {z.dir} · {birdSize(z)}
              </span>
            </div>
          ))}
          <div className="map-card__foot">최근 7일 충돌/회피 보고 2건</div>
        </div>
      </div>

      {/* 타임 스크러버 */}
      <div className="scrubber">
        <div className="scrubber__play" onClick={onTogglePlay}>
          {playing ? <IconPause /> : <IconPlay />}
        </div>
        <div className="scrubber__body">
          <div className="scrubber__head">
            <span className="scrubber__label">타임라인 재생 · 풍향(화살표) / 풍속(색상)</span>
            <span className="scrubber__time">{cur.time}</span>
            <span className="scrubber__info">
              INFO {cur.letter} · {cur.wind} · VIS {cur.visTxt}
            </span>
          </div>
          <div className="scrubber__strip">
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
