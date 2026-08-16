import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type RefObject } from 'react';
import tilesConfig from '../../../tiles.config.json';
import { RKSS, destination, nmToM, runwayDirPrefix, type Navaid, type RunwayEnd } from '../../data/airport';
import { BIRD_COLOR, BIRD_KIND_LABEL, birdHead } from '../../data/stats';
import type { BirdReport, Runway } from '../../data/types';

/*
 * 오프라인 타일 (둘 다 빌드에 포함, 런타임 네트워크 요청 없음):
 *  - 베이스맵: CARTO 래스터, `tiles.config.json.basemap`의 줌 한 단계만 (npm run tiles)
 *  - 항공사진: 2023 김포공항 항공사진, z12–16 WebP (npm run tiles:aerial, 촬영 범위 밖은 투명/타일 없음) — 기본 ON, 토글 오버레이
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

/**
 * 오버레이 색상 팔레트 — 밝은 베이스맵 위(LIGHT)와 항공사진 위(BRIGHT)에서 각각 잘 읽히도록 두 벌.
 * 항공사진 위에서는 밝은 색 + 선 아래 어두운 헤일로(halo)로 회색 포장면/초지 어디서든 대비를 확보한다.
 */
export interface Palette {
  bright: boolean;
  /** 활주로·접근/출발 경로·ARP·ILS 점 */
  primary: string;
  /** 시정 원 (정상 / 저하 <10km) */
  vis: string;
  visLow: string;
  /** VOR 표식 / 라벨 글자 */
  vor: string;
  vorText: string;
  birdHvy: string;
  birdLgt: string;
  strike: string;
  /** 선 아래 어두운 헤일로 불투명도 (0이면 안 보임) */
  halo: number;
}

export const LIGHT: Palette = {
  bright: false,
  primary: PRIMARY,
  vis: 'rgba(127,13,0,0.45)',
  visLow: '#c8871c',
  vor: '#6b8cae',
  vorText: '#4d6f93',
  birdHvy: BIRD_COLOR.HVY,
  birdLgt: BIRD_COLOR.LGT,
  strike: '#c23a2b',
  halo: 0,
};

export const BRIGHT: Palette = {
  bright: true,
  primary: '#ff6a4d',
  vis: '#ffffff',
  visLow: '#ffc857',
  vor: '#7fd3ff',
  vorText: '#9fe0ff',
  birdHvy: '#ff8a5c',
  birdLgt: '#ffcc4d',
  strike: '#ff7b7b',
  halo: 0.45,
};

const HALO_COLOR = '#0b0d12';
const paletteFor = (aerial: boolean) => (aerial ? BRIGHT : LIGHT);

export const ARP: L.LatLngTuple = [RKSS.arp.lat, RKSS.arp.lon];

const BRG: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const ll = (p: { lat: number; lon: number }): L.LatLngTuple => [p.lat, p.lon];
/** ARP에서 방위/거리(NM)만큼 떨어진 지점 */
const fromArp = (bearing: number, nm: number) => ll(destination(RKSS.arp, bearing, nmToM(nm)));

/** 조류 섹터 색 (지도 밖 UI는 라이트 팔레트) */
export const birdColor = (b: BirdReport, p: Palette = LIGHT) => (b.kind === 'HVY' ? p.birdHvy : p.birdLgt);
export const birdSize = (b: BirdReport) => BIRD_KIND_LABEL[b.kind];
export { birdHead };

const STRIKE_REPORTS: [number, number, string][] = [
  [37.5665, 126.7845, '조류 충돌 보고 · 08-12 0640Z'],
  [37.5495, 126.799, '조류 회피 기동 · 08-14 2110Z'],
];

/** 팔레트 키 → 라이트/브라이트 두 색을 CSS 변수로 심는 라벨 필. `.mapview--aerial`이 브라이트 쪽을 고른다 */
type PillColorKey = 'vis' | 'visLow' | 'vorText' | 'birdHvy' | 'birdLgt';
const pillVars = (key: PillColorKey) => `--pill-c:${LIGHT[key]};--pill-c-b:${BRIGHT[key]}`;
const pill = (text: string, key?: PillColorKey, extraClass = '') =>
  L.divIcon({ className: '', html: `<div class="vis-pill ${extraClass}"${key ? ` style="${pillVars(key)}"` : ''}>${text}</div>`, iconSize: [0, 0] });

const navaidLabel = (n: Navaid) => `${n.name} · ${n.ident} ${n.freq} MHz${n.course != null ? ` · CRS ${n.course.toFixed(0)}°` : ''}`;

export interface MapState {
  /** 시정(km) */
  vis: number;
  visTxt: string;
  showVis: boolean;
  /** ATIS 사용 활주로 그룹 — 접근/출발 경로 방향 결정 */
  activeRwy: Runway;
  /** 선택 시각 전문의 조류 활동 보고 → 부채꼴 섹터 */
  birds: BirdReport[];
  /** 항공사진 오버레이 */
  aerial: boolean;
}

/** 팔레트에 따라 다시 스타일을 먹일 레이어 (항공사진 토글 시 일괄 적용) */
interface Themed {
  layer: L.Path;
  style: (p: Palette) => L.PathOptions;
}

interface Layers {
  map: L.Map;
  aerial: L.TileLayer;
  visCircle: L.Circle;
  visHalo: L.Circle;
  visLabel: L.Marker;
  /** 활주로별 폴리라인 (id → layer) */
  runways: Map<string, L.Polyline>;
  /** 접근/출발 경로 — 사용 활주로 바뀔 때 다시 그림 */
  paths: L.LayerGroup;
  /** 조류 활동 섹터 — 선택 전문 바뀔 때 다시 그림 */
  birds: L.LayerGroup;
  themed: Themed[];
}

/** 활주로 스트립의 두 끝 중 착륙 방향 접두("32"/"14")에 해당하는 끝과 반대 끝 */
function endsFor(strip: (typeof RKSS.runways)[number], prefix: string): { landing: RunwayEnd; departureEnd: RunwayEnd } {
  const [a, b] = strip.ends;
  return a.designator.startsWith(prefix) ? { landing: a, departureEnd: b } : { landing: b, departureEnd: a };
}

/** 선 아래 깔리는 어두운 헤일로 스타일 (weight = 본선 + 4) */
const haloStyle = (weight: number, dashArray?: string) => (p: Palette): L.PathOptions => ({
  color: HALO_COLOR,
  weight: weight + 4,
  opacity: p.halo,
  dashArray,
  fill: false,
});

/** 헤일로 + 본선 두 겹의 폴리라인을 그룹에 추가 (헤일로는 라이트 팔레트에서 투명) */
function haloedLine(latlngs: L.LatLngTuple[], weight: number, main: (p: Palette) => L.PathOptions, pal: Palette, dashArray?: string) {
  const hs = haloStyle(weight, dashArray);
  const halo = L.polyline(latlngs, { ...hs(pal), interactive: false });
  const line = L.polyline(latlngs, main(pal));
  return { halo, line, themed: [{ layer: halo, style: hs }, { layer: line, style: main }] as Themed[] };
}

const approachStyle = (p: Palette): L.PathOptions => ({ color: p.primary, weight: 2, dashArray: '6 6', opacity: p.bright ? 0.9 : 0.55 });
const departureStyle = (p: Palette): L.PathOptions => ({ color: p.primary, weight: 2, dashArray: '3 7', opacity: p.bright ? 0.7 : 0.4 });

function drawPaths(group: L.LayerGroup, activeRwy: Runway, pal: Palette) {
  group.clearLayers();
  const prefix = runwayDirPrefix(activeRwy);
  for (const strip of RKSS.runways) {
    const { landing, departureEnd } = endsFor(strip, prefix);
    // 접근: 착륙 시단에서 착륙 방위의 반대쪽으로 5NM
    const appStart = ll(landing.thr);
    const appEnd = ll(destination(landing.thr, (landing.heading + 180) % 360, nmToM(APPROACH_NM)));
    const app = haloedLine([appEnd, appStart], 2, approachStyle, pal, '6 6');
    app.line.bindTooltip(`RWY ${landing.designator} 접근 경로 · ${APPROACH_NM}NM`);
    group.addLayer(app.halo).addLayer(app.line);
    // 출발: 이륙 활주 끝(반대 시단)에서 같은 방위로 3NM
    const depStart = ll(departureEnd.thr);
    const depEnd = ll(destination(departureEnd.thr, landing.heading, nmToM(DEPARTURE_NM)));
    const dep = haloedLine([depStart, depEnd], 2, departureStyle, pal, '3 7');
    dep.line.bindTooltip(`RWY ${landing.designator} 출발 경로 · ${DEPARTURE_NM}NM`);
    group.addLayer(dep.halo).addLayer(dep.line);
  }
}

/**
 * 조류 활동 섹터: 보고 방위 ±22.5°, 보고 거리 ±1NM (ARP 기준) 부채꼴 + 라벨 필.
 * 팔레트는 그릴 때 반영 (전문·항공사진 토글 어느 쪽이 바뀌어도 다시 그림).
 */
function drawBirds(group: L.LayerGroup, birds: BirdReport[], pal: Palette) {
  group.clearLayers();
  for (const z of birds) {
    const b = BRG[z.dir];
    const color = birdColor(z, pal);
    const tooltip = `${birdHead(z)} · ${birdSize(z)}`;
    const pts: L.LatLngTuple[] = [];
    for (let a = b - 22.5; a <= b + 22.5; a += 4.5) pts.push(fromArp(a, Math.max(z.nm - 1, 0.5)));
    for (let a = b + 22.5; a >= b - 22.5; a -= 4.5) pts.push(fromArp(a, z.nm + 1));
    L.polygon(pts, { color, weight: pal.bright ? 2 : 1.5, fillColor: color, fillOpacity: pal.bright ? 0.22 : 0.18 })
      .bindTooltip(tooltip)
      .addTo(group);
    L.marker(fromArp(b, z.nm), { icon: pill(birdHead(z), z.kind === 'HVY' ? 'birdHvy' : 'birdLgt'), interactive: false, keyboard: false }).addTo(group);
  }
}

/** 시정 원 색: 저하(<10km)면 경고색 */
const visColor = (p: Palette, vis: number) => (vis < 10 ? p.visLow : p.vis);

/**
 * Leaflet 지도를 컨테이너에 마운트하고 정적 레이어(베이스맵, 활주로, 항행시설, 조류 섹터, 충돌 보고)를 그린다.
 * `state`가 바뀌면 시정 원, 접근/출발 경로, 항공사진 오버레이(+오버레이 팔레트)를 갱신.
 */
export function useLeafletMap(container: RefObject<HTMLDivElement | null>, state: MapState, initialZoom?: number) {
  const ref = useRef<Layers | null>(null);
  const initialZoomRef = useRef(initialZoom);
  const initialAerialRef = useRef(state.aerial);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const pal = paletteFor(initialAerialRef.current);
    const themed: Themed[] = [];
    const theme = (layer: L.Path, style: (p: Palette) => L.PathOptions) => {
      themed.push({ layer, style });
      return layer;
    };

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM_BASE,
      maxBounds: BASE_BOUNDS.pad(0.15),
      maxBoundsViscosity: 0.8,
    }).setView([37.576, 126.786], BASE.zoom);
    if (initialZoomRef.current != null) map.setView(ARP, initialZoomRef.current);

    // 베이스맵 — 받아둔 줌 하나만 native, 다른 줌은 스케일링. @2x(512px) 타일을 256px로 표시 → HiDPI 선명
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      minNativeZoom: BASE.zoom,
      maxNativeZoom: BASE.zoom,
      bounds: BASE_BOUNDS,
      tileSize: 256,
      detectRetina: false,
    }).addTo(map);

    // 항공사진 오버레이 (기본 ON, 토글) — 범위 밖/누락 타일은 투명
    const aerial = L.tileLayer('/tiles-aerial/{z}/{x}/{y}.webp', {
      minNativeZoom: AERIAL.minZoom,
      maxNativeZoom: AERIAL.maxZoom,
      bounds: AERIAL_BOUNDS,
      errorTileUrl: TRANSPARENT_PX,
      zIndex: 2,
    });

    // 활주로 2본 — 시단(THR) 좌표 기준 (항공사진 위에서는 헤일로 포함)
    const runways = new Map<string, L.Polyline>();
    const runwayStyle = (p: Palette): L.PathOptions => ({ color: p.primary, weight: 5, opacity: p.bright ? 0.95 : 0.9 });
    for (const strip of RKSS.runways) {
      const { halo, line, themed: t } = haloedLine([ll(strip.ends[0].thr), ll(strip.ends[1].thr)], 5, runwayStyle, pal);
      halo.addTo(map);
      line.bindTooltip(`RWY ${strip.id} · ${strip.length}×${strip.width}m`).addTo(map);
      themed.push(...t);
      runways.set(strip.id, line);
    }

    // 접근/출발 경로 (사용 활주로에 따라 갱신 — 헤일로 포함, 팔레트는 다시 그릴 때 반영)
    const paths = L.layerGroup().addTo(map);

    // 항행안전시설 — LOC/GP는 작은 점, VOR은 라벨 있는 원. 항공사진 위: 흰 테두리 + 밝은 채움
    for (const n of RKSS.navaids) {
      if (n.type === 'VOR') {
        theme(L.circleMarker(ll(n.pos), { radius: 6 }), (p) => ({
          color: p.bright ? '#fff' : p.vor,
          weight: 2,
          fillColor: p.bright ? p.vor : '#fff',
          fillOpacity: 1,
        }))
          .bindTooltip(navaidLabel(n))
          .addTo(map);
        L.marker(ll(destination(n.pos, 90, 260)), { icon: pill(`${n.ident} VOR ${n.freq}`, 'vorText', 'vis-pill--sm'), interactive: false, keyboard: false }).addTo(map);
      } else {
        const loc = n.type === 'LOC';
        theme(L.circleMarker(ll(n.pos), { radius: loc ? 4 : 3 }), (p) =>
          p.bright
            ? { color: '#fff', weight: 1.5, fillColor: loc ? 'rgba(11,13,18,0.75)' : p.primary, fillOpacity: 1 }
            : { color: 'rgba(127,13,0,0.75)', weight: 1.5, fillColor: loc ? '#fff' : 'rgba(127,13,0,0.75)', fillOpacity: 1 },
        )
          .bindTooltip(navaidLabel(n))
          .addTo(map);
      }
    }

    // 조류 활동 섹터 (선택 전문 보고에 따라 갱신)
    const birds = L.layerGroup().addTo(map);

    // 최근 조류 충돌/회피 보고
    for (const [lat, lng, label] of STRIKE_REPORTS) {
      theme(L.circleMarker([lat, lng], { radius: 6 }), (p) => ({
        color: p.bright ? '#fff' : p.strike,
        weight: 2,
        fillColor: p.bright ? p.strike : '#fff',
        fillOpacity: 1,
      }))
        .addTo(map)
        .bindTooltip(label);
    }

    // ARP 표식 + 시정 반경 (ARP 중심, 헤일로 포함)
    theme(L.circleMarker(ARP, { radius: 3 }), (p) => ({
      color: p.bright ? '#fff' : p.primary,
      weight: 1.5,
      fillColor: p.bright ? p.primary : '#fff',
      fillOpacity: 1,
    }))
      .bindTooltip(`ARP · ${RKSS.arp.lat.toFixed(5)}, ${RKSS.arp.lon.toFixed(5)} · ${RKSS.arp.alt}m`)
      .addTo(map);
    const visHalo = L.circle(ARP, { radius: 8000, ...haloStyle(2, '8 7')(pal), interactive: false }).addTo(map);
    const visCircle = L.circle(ARP, {
      radius: 8000,
      color: pal.vis,
      weight: 2,
      dashArray: '8 7',
      fillColor: pal.bright ? '#fff' : PRIMARY,
      fillOpacity: 0.03,
      interactive: false,
    }).addTo(map);
    const visLabel = L.marker(ARP, { icon: pill('VIS —', 'vis'), interactive: false, keyboard: false }).addTo(map);

    ref.current = { map, aerial, visCircle, visHalo, visLabel, runways, paths, birds, themed };

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      ref.current = null;
      map.remove();
    };
  }, [container]);

  // 시정 원 (팔레트 바뀌어도 색을 다시 골라야 하므로 aerial 의존)
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const pal = paletteFor(state.aerial);
    const labelEl = r.visLabel.getElement();
    if (!state.showVis) {
      r.visCircle.setStyle({ opacity: 0, fillOpacity: 0 });
      r.visHalo.setStyle({ opacity: 0 });
      if (labelEl) labelEl.style.display = 'none';
      return;
    }
    const rm = Math.min(state.vis, 10) * 1000;
    const low = state.vis < 10;
    r.visCircle.setStyle({ opacity: 1, fillOpacity: 0.03, color: visColor(pal, state.vis), fillColor: pal.bright ? '#fff' : PRIMARY });
    r.visCircle.setRadius(rm);
    r.visHalo.setStyle({ opacity: pal.halo });
    r.visHalo.setRadius(rm);
    r.visLabel.setLatLng([ARP[0] + rm / 111320, ARP[1]]);
    if (labelEl) {
      labelEl.style.display = '';
      const p = labelEl.querySelector<HTMLElement>('.vis-pill');
      if (p) {
        p.textContent = `VIS ${state.visTxt}`;
        p.style.cssText = pillVars(low ? 'visLow' : 'vis');
      }
    }
  }, [state.vis, state.visTxt, state.showVis, state.aerial]);

  // 사용 활주로 → 접근/출발 경로, 활주로 툴팁 (팔레트 반영을 위해 aerial 의존)
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    drawPaths(r.paths, state.activeRwy, paletteFor(state.aerial));
    const prefix = runwayDirPrefix(state.activeRwy);
    for (const strip of RKSS.runways) {
      const { landing } = endsFor(strip, prefix);
      r.runways.get(strip.id)?.setTooltipContent(`RWY ${strip.id} · ${strip.length}×${strip.width}m · 사용 중 ${landing.designator}`);
    }
  }, [state.activeRwy, state.aerial]);

  // 조류 활동 섹터 (팔레트 반영을 위해 aerial 의존)
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    drawBirds(r.birds, state.birds, paletteFor(state.aerial));
  }, [state.birds, state.aerial]);

  // 항공사진 오버레이 + 오버레이 팔레트 전환
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const pal = paletteFor(state.aerial);
    if (state.aerial) {
      r.aerial.addTo(r.map);
      r.map.setMaxZoom(MAX_ZOOM_AERIAL);
    } else {
      r.map.setMaxZoom(MAX_ZOOM_BASE);
      r.aerial.remove();
    }
    for (const t of r.themed) t.layer.setStyle(t.style(pal));
  }, [state.aerial]);
}
