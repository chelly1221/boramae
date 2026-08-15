import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type RefObject } from 'react';
import tilesConfig from '../../../tiles.config.json';

/**
 * 오프라인 베이스맵: CARTO 래스터 타일을 `tiles.config.json`의 줌 한 단계만 bbox 범위로 미리 받아
 * `public/tiles/{z}/{x}/{y}.png`에 둔다 (`npm run tiles`). Leaflet은 그 줌을 native로 쓰고
 * 나머지 줌은 타일을 확대/축소해서 보여준다. 네트워크 요청 없음.
 */
const TILE_ZOOM = tilesConfig.zoom;
const TILE_BOUNDS = L.latLngBounds(
  [tilesConfig.bbox.minLat, tilesConfig.bbox.minLon],
  [tilesConfig.bbox.maxLat, tilesConfig.bbox.maxLon],
);
/** 스케일링으로 허용할 줌 범위 (native ±) */
const ZOOM_OUT_STEPS = 1;
const ZOOM_IN_STEPS = 2;

/** 공항 기준점 (ARP) */
export const ARP: L.LatLngTuple = [37.5583, 126.7906];

const BRG: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** ARP에서 방위/거리(NM)만큼 떨어진 지점 (평면 근사) */
function dest(bearing: number, nm: number): L.LatLngTuple {
  const d = nm * 1852;
  const rad = (bearing * Math.PI) / 180;
  return [ARP[0] + (d * Math.cos(rad)) / 111320, ARP[1] + (d * Math.sin(rad)) / (111320 * Math.cos((ARP[0] * Math.PI) / 180))];
}

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

const pill = (text: string, color?: string) =>
  L.divIcon({ className: '', html: `<div class="vis-pill"${color ? ` style="color:${color}"` : ''}>${text}</div>`, iconSize: [0, 0] });

export interface VisState {
  /** 시정(km) */
  vis: number;
  visTxt: string;
  show: boolean;
}

/**
 * Leaflet 지도를 컨테이너에 마운트하고 정적 레이어(활주로, 접근경로, 조류 섹터, 충돌 보고)를 그린다.
 * 시정 원은 `visState`가 바뀔 때마다 갱신.
 */
export function useLeafletMap(container: RefObject<HTMLDivElement | null>, visState: VisState) {
  const visRef = useRef<{ circle: L.Circle; label: L.Marker } | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      minZoom: TILE_ZOOM - ZOOM_OUT_STEPS,
      maxZoom: TILE_ZOOM + ZOOM_IN_STEPS,
      maxBounds: TILE_BOUNDS.pad(0.15),
      maxBoundsViscosity: 0.8,
    }).setView([37.576, 126.786], TILE_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      // 받아둔 줌 하나만 native — 다른 줌은 이 타일을 스케일링
      minNativeZoom: TILE_ZOOM,
      maxNativeZoom: TILE_ZOOM,
      bounds: TILE_BOUNDS,
      // @2x 타일(512px)을 256px로 표시 → HiDPI에서 선명
      tileSize: 256,
      detectRetina: false,
    }).addTo(map);

    // RKSS 활주로 2본 (진방위 ≈ 134.6°)
    L.polyline(
      [
        [37.5682, 126.7776],
        [37.548, 126.8034],
      ],
      { color: '#7f0d00', weight: 5, opacity: 0.9 },
    )
      .addTo(map)
      .bindTooltip('RWY 14R/32L · 사용 중');
    L.polyline(
      [
        [37.571, 126.7778],
        [37.5482, 126.8068],
      ],
      { color: '#7f0d00', weight: 5, opacity: 0.5 },
    )
      .addTo(map)
      .bindTooltip('RWY 14L/32R');

    // 접근/출발 경로
    L.polyline(
      [
        [37.548, 126.8034],
        [37.5227, 126.8357],
      ],
      { color: '#7f0d00', weight: 2, dashArray: '6 6', opacity: 0.55 },
    )
      .addTo(map)
      .bindTooltip('RWY 32L 접근 경로');
    L.polyline(
      [
        [37.5682, 126.7776],
        [37.5935, 126.7453],
      ],
      { color: '#7f0d00', weight: 2, dashArray: '6 6', opacity: 0.55 },
    )
      .addTo(map)
      .bindTooltip('RWY 14R 출발 경로');

    // 조류 활동 섹터: 해당 방위 ±22.5°, 보고 거리 ±1NM
    for (const z of BIRD_ZONES) {
      const b = BRG[z.dir];
      const color = birdColor(z);
      const tooltip = `${birdHead(z)} · ${birdSize(z)}${z.species ? ` (${z.species})` : ''}`;
      const pts: L.LatLngTuple[] = [];
      for (let a = b - 22.5; a <= b + 22.5; a += 4.5) pts.push(dest(a, Math.max(z.nm - 1, 0.5)));
      for (let a = b + 22.5; a >= b - 22.5; a -= 4.5) pts.push(dest(a, z.nm + 1));
      L.polygon(pts, { color, weight: 1.5, fillColor: color, fillOpacity: 0.18 }).addTo(map).bindTooltip(tooltip);
      L.marker(dest(b, z.nm), { icon: pill(birdHead(z), color), interactive: false, keyboard: false }).addTo(map);
    }

    // 최근 조류 충돌/회피 보고
    for (const [lat, lng, label] of STRIKE_REPORTS) {
      L.circleMarker([lat, lng], { radius: 6, color: '#c23a2b', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindTooltip(label);
    }

    // 시정 반경 (ARP 중심)
    const circle = L.circle(ARP, {
      radius: 8000,
      color: 'rgba(127,13,0,0.45)',
      weight: 2,
      dashArray: '8 7',
      fillColor: '#7f0d00',
      fillOpacity: 0.03,
      interactive: false,
    }).addTo(map);
    const label = L.marker(ARP, { icon: pill('VIS —'), interactive: false, keyboard: false }).addTo(map);
    visRef.current = { circle, label };

    // 컨테이너 크기 변화 대응
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      visRef.current = null;
      map.remove();
    };
  }, [container]);

  useEffect(() => {
    const v = visRef.current;
    if (!v) return;
    const labelEl = v.label.getElement();
    if (!visState.show) {
      v.circle.setStyle({ opacity: 0, fillOpacity: 0 });
      if (labelEl) labelEl.style.display = 'none';
      return;
    }
    const rm = Math.min(visState.vis, 10) * 1000;
    const col = visState.vis < 10 ? '#c8871c' : 'rgba(127,13,0,0.45)';
    v.circle.setStyle({ opacity: 1, fillOpacity: 0.03, color: col });
    v.circle.setRadius(rm);
    v.label.setLatLng([ARP[0] + rm / 111320, ARP[1]]);
    if (labelEl) {
      labelEl.style.display = '';
      const p = labelEl.querySelector<HTMLElement>('.vis-pill');
      if (p) {
        p.textContent = `VIS ${visState.visTxt}`;
        p.style.color = col;
      }
    }
  }, [visState.vis, visState.visTxt, visState.show]);
}
