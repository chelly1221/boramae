import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type RefObject } from 'react';
import tilesConfig from '../../../tiles.config.json';
import { RKSS, destination, nmToM, runwayDirPrefix, type Navaid, type RunwayEnd } from '../../data/airport';
import type { Runway } from '../../data/types';

/*
 * 오프라인 타일 (둘 다 빌드에 포함, 런타임 네트워크 요청 없음):
 *  - 베이스맵: CARTO 래스터, `tiles.config.json.basemap`의 줌 한 단계만 (npm run tiles)
 *  - 항공사진: 2023 김포공항 항공사진, z12–16 (npm run tiles:aerial) — 토글 오버레이
 * 받아둔 줌 밖은 타일을 스케일링해서 보여준다.
 */
const BASE = tilesConfig.basemap;
const AERIAL = tilesConfig.aerial;
const BASE_BOUNDS = L.latLngBounds([BASE.bbox.minLat, BASE.bbox.minLon], [BASE.bbox.maxLat, BASE.bbox.maxLon]);
const AERIAL_BOUNDS = L.latLngBounds([AERIAL.bbox.minLat, AERIAL.bbox.minLon], [AERIAL.bbox.maxLat, AERIAL.bbox.maxLon]);
/** 베이스맵만 있을 때 허용 줌 (native ±) */
const MIN_ZOOM = BASE.zoom - 1;
const MAX_ZOOM_BASE = BASE.zoom + 2;
/** 항공사진 켜면 여기까지 확대 허용 (z16 타일 스케일링) */
const MAX_ZOOM_AERIAL = AERIAL.maxZoom + 1;
const TRANSPARENT_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** 접근 경로 길이 / 출발 경로 길이 (NM) */
const APPROACH_NM = 5;
const DEPARTURE_NM = 3;

const PRIMARY = '#7f0d00';

export const ARP: L.LatLngTuple = [RKSS.arp.lat, RKSS.arp.lon];

const BRG: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const ll = (p: { lat: number; lon: number }): L.LatLngTuple => [p.lat, p.lon];
/** ARP에서 방위/거리(NM)만큼 떨어진 지점 */
const fromArp = (bearing: number, nm: number) => ll(destination(RKSS.arp, bearing, nmToM(nm)));

export interface BirdZone {
  /** HVY = 큰 무리, LGT = 작은 무리 */
  kind: 'HVY' | 'LGT';
  dir: keyof typeof BRG;
  nm: number;
  species?: string;
}

/** 지도 데모 데이터 (design/map.html) */
export const BIRD_ZONES: BirdZone[] = [
  { kind: 'HVY', dir: 'NW', nm: 5, species: '기러기' },
  { kind: 'LGT', dir: 'NE', nm: 3, species: '갈매기' },
  { kind: 'LGT', dir: 'SE', nm: 2 },
];

export const birdColor = (z: BirdZone) => (z.kind === 'HVY' ? '#e05a2b' : '#d98a0c');
export const birdSize = (z: BirdZone) => (z.kind === 'HVY' ? '큰 무리' : '작은 무리');
/** "HVY FLOCK 5NM NW" */
export const birdHead = (z: BirdZone) => `${z.kind} FLOCK ${z.nm}NM ${z.dir}`;

const STRIKE_REPORTS: [number, number, string][] = [
  [37.5665, 126.7845, '조류 충돌 보고 · 08-12 0640Z'],
  [37.5495, 126.799, '조류 회피 기동 · 08-14 2110Z'],
];

const pill = (text: string, color?: string, extraClass = '') =>
  L.divIcon({ className: '', html: `<div class="vis-pill ${extraClass}"${color ? ` style="color:${color}"` : ''}>${text}</div>`, iconSize: [0, 0] });

const navaidLabel = (n: Navaid) => `${n.name} · ${n.ident} ${n.freq} MHz${n.course != null ? ` · CRS ${n.course.toFixed(0)}°` : ''}`;

export interface MapState {
  /** 시정(km) */
  vis: number;
  visTxt: string;
  showVis: boolean;
  /** ATIS 사용 활주로 그룹 — 접근/출발 경로 방향 결정 */
  activeRwy: Runway;
  /** 항공사진 오버레이 */
  aerial: boolean;
}

interface Layers {
  map: L.Map;
  aerial: L.TileLayer;
  visCircle: L.Circle;
  visLabel: L.Marker;
  /** 활주로별 폴리라인 (id → layer) */
  runways: Map<string, L.Polyline>;
  /** 접근/출발 경로 — 사용 활주로 바뀔 때 다시 그림 */
  paths: L.LayerGroup;
}

/** 활주로 스트립의 두 끝 중 착륙 방향 접두("32"/"14")에 해당하는 끝과 반대 끝 */
function endsFor(strip: (typeof RKSS.runways)[number], prefix: string): { landing: RunwayEnd; departureEnd: RunwayEnd } {
  const [a, b] = strip.ends;
  return a.designator.startsWith(prefix) ? { landing: a, departureEnd: b } : { landing: b, departureEnd: a };
}

function drawPaths(group: L.LayerGroup, activeRwy: Runway) {
  group.clearLayers();
  const prefix = runwayDirPrefix(activeRwy);
  for (const strip of RKSS.runways) {
    const { landing, departureEnd } = endsFor(strip, prefix);
    // 접근: 착륙 시단에서 착륙 방위의 반대쪽으로 5NM
    const appStart = ll(landing.thr);
    const appEnd = ll(destination(landing.thr, (landing.heading + 180) % 360, nmToM(APPROACH_NM)));
    L.polyline([appEnd, appStart], { color: PRIMARY, weight: 2, dashArray: '6 6', opacity: 0.55 })
      .bindTooltip(`RWY ${landing.designator} 접근 경로 · ${APPROACH_NM}NM`)
      .addTo(group);
    // 출발: 이륙 활주 끝(반대 시단)에서 같은 방위로 3NM
    const depStart = ll(departureEnd.thr);
    const depEnd = ll(destination(departureEnd.thr, landing.heading, nmToM(DEPARTURE_NM)));
    L.polyline([depStart, depEnd], { color: PRIMARY, weight: 2, dashArray: '3 7', opacity: 0.4 })
      .bindTooltip(`RWY ${landing.designator} 출발 경로 · ${DEPARTURE_NM}NM`)
      .addTo(group);
  }
}

/**
 * Leaflet 지도를 컨테이너에 마운트하고 정적 레이어(베이스맵, 활주로, 항행시설, 조류 섹터, 충돌 보고)를 그린다.
 * `state`가 바뀌면 시정 원, 접근/출발 경로, 항공사진 오버레이를 갱신.
 */
export function useLeafletMap(container: RefObject<HTMLDivElement | null>, state: MapState, initialZoom?: number) {
  const ref = useRef<Layers | null>(null);
  const initialZoomRef = useRef(initialZoom);

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM_BASE,
      maxBounds: BASE_BOUNDS.pad(0.15),
      maxBoundsViscosity: 0.8,
    }).setView([37.576, 126.786], BASE.zoom);
    if (initialZoomRef.current != null) map.setView(ARP, initialZoomRef.current);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 베이스맵 — 받아둔 줌 하나만 native, 다른 줌은 스케일링. @2x(512px) 타일을 256px로 표시 → HiDPI 선명
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      minNativeZoom: BASE.zoom,
      maxNativeZoom: BASE.zoom,
      bounds: BASE_BOUNDS,
      tileSize: 256,
      detectRetina: false,
    }).addTo(map);

    // 항공사진 오버레이 (토글) — 범위 밖/누락 타일은 투명
    const aerial = L.tileLayer('/tiles-aerial/{z}/{x}/{y}.jpg', {
      attribution: '항공사진 © 한국공항공사 (2023)',
      minNativeZoom: AERIAL.minZoom,
      maxNativeZoom: AERIAL.maxZoom,
      bounds: AERIAL_BOUNDS,
      errorTileUrl: TRANSPARENT_PX,
      zIndex: 2,
    });

    // 활주로 2본 — 시단(THR) 좌표 기준
    const runways = new Map<string, L.Polyline>();
    for (const strip of RKSS.runways) {
      const line = L.polyline([ll(strip.ends[0].thr), ll(strip.ends[1].thr)], { color: PRIMARY, weight: 5, opacity: 0.9 })
        .bindTooltip(`RWY ${strip.id} · ${strip.length}×${strip.width}m`)
        .addTo(map);
      runways.set(strip.id, line);
    }

    // 접근/출발 경로 (사용 활주로에 따라 갱신)
    const paths = L.layerGroup().addTo(map);

    // 항행안전시설 — LOC/GP는 작은 점, VOR은 라벨 있는 원
    for (const n of RKSS.navaids) {
      if (n.type === 'VOR') {
        L.circleMarker(ll(n.pos), { radius: 6, color: '#6b8cae', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(navaidLabel(n)).addTo(map);
        L.marker(ll(destination(n.pos, 90, 260)), { icon: pill(`${n.ident} VOR ${n.freq}`, '#4d6f93', 'vis-pill--sm'), interactive: false, keyboard: false }).addTo(map);
      } else {
        L.circleMarker(ll(n.pos), {
          radius: n.type === 'LOC' ? 4 : 3,
          color: 'rgba(127,13,0,0.75)',
          weight: 1.5,
          fillColor: n.type === 'LOC' ? '#fff' : 'rgba(127,13,0,0.75)',
          fillOpacity: 1,
        })
          .bindTooltip(navaidLabel(n))
          .addTo(map);
      }
    }

    // 조류 활동 섹터: 해당 방위 ±22.5°, 보고 거리 ±1NM (ARP 기준)
    for (const z of BIRD_ZONES) {
      const b = BRG[z.dir];
      const color = birdColor(z);
      const tooltip = `${birdHead(z)} · ${birdSize(z)}${z.species ? ` (${z.species})` : ''}`;
      const pts: L.LatLngTuple[] = [];
      for (let a = b - 22.5; a <= b + 22.5; a += 4.5) pts.push(fromArp(a, Math.max(z.nm - 1, 0.5)));
      for (let a = b + 22.5; a >= b - 22.5; a -= 4.5) pts.push(fromArp(a, z.nm + 1));
      L.polygon(pts, { color, weight: 1.5, fillColor: color, fillOpacity: 0.18 }).addTo(map).bindTooltip(tooltip);
      L.marker(fromArp(b, z.nm), { icon: pill(birdHead(z), color), interactive: false, keyboard: false }).addTo(map);
    }

    // 최근 조류 충돌/회피 보고
    for (const [lat, lng, label] of STRIKE_REPORTS) {
      L.circleMarker([lat, lng], { radius: 6, color: '#c23a2b', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindTooltip(label);
    }

    // ARP 표식 + 시정 반경 (ARP 중심)
    L.circleMarker(ARP, { radius: 3, color: PRIMARY, weight: 1.5, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(`ARP · ${RKSS.arp.lat.toFixed(5)}, ${RKSS.arp.lon.toFixed(5)} · ${RKSS.arp.alt}m`)
      .addTo(map);
    const visCircle = L.circle(ARP, {
      radius: 8000,
      color: 'rgba(127,13,0,0.45)',
      weight: 2,
      dashArray: '8 7',
      fillColor: PRIMARY,
      fillOpacity: 0.03,
      interactive: false,
    }).addTo(map);
    const visLabel = L.marker(ARP, { icon: pill('VIS —'), interactive: false, keyboard: false }).addTo(map);

    ref.current = { map, aerial, visCircle, visLabel, runways, paths };

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      ref.current = null;
      map.remove();
    };
  }, [container]);

  // 시정 원
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const labelEl = r.visLabel.getElement();
    if (!state.showVis) {
      r.visCircle.setStyle({ opacity: 0, fillOpacity: 0 });
      if (labelEl) labelEl.style.display = 'none';
      return;
    }
    const rm = Math.min(state.vis, 10) * 1000;
    const col = state.vis < 10 ? '#c8871c' : 'rgba(127,13,0,0.45)';
    r.visCircle.setStyle({ opacity: 1, fillOpacity: 0.03, color: col });
    r.visCircle.setRadius(rm);
    r.visLabel.setLatLng([ARP[0] + rm / 111320, ARP[1]]);
    if (labelEl) {
      labelEl.style.display = '';
      const p = labelEl.querySelector<HTMLElement>('.vis-pill');
      if (p) {
        p.textContent = `VIS ${state.visTxt}`;
        p.style.color = col;
      }
    }
  }, [state.vis, state.visTxt, state.showVis]);

  // 사용 활주로 → 접근/출발 경로, 활주로 툴팁
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    drawPaths(r.paths, state.activeRwy);
    const prefix = runwayDirPrefix(state.activeRwy);
    for (const strip of RKSS.runways) {
      const { landing } = endsFor(strip, prefix);
      r.runways.get(strip.id)?.setTooltipContent(`RWY ${strip.id} · ${strip.length}×${strip.width}m · 사용 중 ${landing.designator}`);
    }
  }, [state.activeRwy]);

  // 항공사진 오버레이
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    if (state.aerial) {
      r.aerial.addTo(r.map);
      r.map.setMaxZoom(MAX_ZOOM_AERIAL);
    } else {
      r.map.setMaxZoom(MAX_ZOOM_BASE);
      r.aerial.remove();
    }
  }, [state.aerial]);
}
