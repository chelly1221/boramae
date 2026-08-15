import type { Approach, AtisRecord, Range } from './types';

/* ---------- 차트 헬퍼 (viewBox 560×130 기준) ---------- */

const CHART_W = 560;
const CHART_PAD = 10;

/** 값 배열을 SVG polyline points 문자열로 */
export function linePts(vals: number[], h: number, min: number, max: number): string {
  const rng = max - min || 1;
  const n = Math.max(vals.length - 1, 1);
  return vals
    .map((v, i) => {
      const x = CHART_PAD + (CHART_W - 2 * CHART_PAD) * (i / n);
      const y = h - CHART_PAD - (h - 2 * CHART_PAD) * ((v - min) / rng);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** 라인 아래를 채우는 폴리곤 points (baseline y=120) */
export const areaPts = (pts: string) => `${pts} 550,120 10,120`;

/** 도넛 섹터 path (바람 장미용) — 각도는 라디안, 0 = 북, 시계방향 */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`;
  return (
    `M${p(r0, a0)} L${p(r1, a0)} A${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 1 ${p(r1, a1)} ` +
    `L${p(r0, a1)} A${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 0 ${p(r0, a0)} Z`
  );
}

/* ---------- 파생 통계 ---------- */

export interface RwyEvent {
  /** 타임라인 상 위치 (0–100 %) */
  leftPct: number;
  time: string;
  label: string;
  wind: string;
  /** 해당 레코드 인덱스 */
  index: number;
}

export interface UpdBar {
  hour: number;
  count: number;
  heightPct: number;
  temp: boolean;
}

export interface AppBar {
  name: Approach;
  pct: number;
  fill: string;
}

export interface TagChip {
  tag: string;
  n: number;
  desc: string;
}

export interface Stats {
  total: number;
  firstTime: string;
  lastTime: string;
  interval: string;
  topRwy: string;
  avgQnh: number;
  // 온도/노점
  tempPts: string;
  dpPts: string;
  spreadNow: number;
  spreadMin: number;
  fogRisk: boolean;
  // 바람 장미 (3 속도 구간별 path)
  roseD: [string, string, string];
  domDir: string;
  domPct: number;
  // 측풍/배풍
  xwPts: string;
  thY: string;
  maxXw: number;
  xwExceed: number;
  maxTw: number;
  // 활주로
  p32: number;
  p14: number;
  rwyEvents: RwyEvent[];
  // 갱신 빈도
  updBars: UpdBar[];
  maxUpd: number;
  // 구름/접근
  cavokPct: number;
  minCeil: number | null;
  bknCount: number;
  appBars: AppBar[];
  // 시정
  lowVisCount: number;
  minVis: number;
  tsCount: number;
  // QNH
  qnhPts: string;
  qnhNow: number;
  qnhMax: number;
  qnhMin: number;
  qnhDelta: string;
  // 태그
  tagChips: TagChip[];
}

const DIR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const APP_COLORS: Record<Approach, string> = { ILS: '#7f0d00', RNP: '#b4451c', VOR: '#8c7a6e' };
const TAG_DESC: Record<string, string> = { BR: '박무', HZ: '연무', RA: '비', TS: '뇌전', FG: '안개' };
const INTERVAL_LABEL: Record<Range, string> = { '24h': '30분', '7d': '1시간', '30d': '3시간' };
/** 갱신 빈도 "임시 갱신" 판정 기준 (기간이 길수록 시간당 누적치가 커지므로 보정) */
const UPD_BASE_EXTRA: Record<Range, number> = { '24h': 0, '7d': 2, '30d': 4 };

export function computeStats(recs: AtisRecord[], range: Range, xwLimit: number): Stats {
  const cur = recs[recs.length - 1];
  const n = recs.length;

  // QNH
  const qnhs = recs.map((r) => r.qnh);
  const qnhMinV = Math.min(...qnhs);
  const qnhMaxV = Math.max(...qnhs);
  const qnhPts = linePts(qnhs, 130, qnhMinV - 0.5, qnhMaxV + 0.5);

  // 온도/노점
  const temps = recs.map((r) => r.t);
  const dps = recs.map((r) => r.dp);
  const tMin = Math.min(...dps) - 1;
  const tMax = Math.max(...temps) + 1;
  const spreads = recs.map((r) => r.t - r.dp);
  const spreadMin = Math.min(...spreads);

  // 바람 장미
  const rose: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);
  recs.forEach((r) => {
    const d = Math.round(r.dir / 45) % 8;
    const b = r.spd < 8 ? 0 : r.spd < 14 ? 1 : 2;
    rose[d][b]++;
  });
  const totals = rose.map((a) => a[0] + a[1] + a[2]);
  const maxT = Math.max(...totals);
  const roseD: [string, string, string] = ['', '', ''];
  rose.forEach((bins, i) => {
    const tot = totals[i];
    if (!tot) return;
    const R = 12 + (tot / maxT) * 66;
    let r0 = 6;
    const aC = (i * Math.PI) / 4;
    const hw = (17 * Math.PI) / 180;
    bins.forEach((cnt, bi) => {
      if (!cnt) return;
      const r1 = r0 + (R - 6) * (cnt / tot);
      roseD[bi] += sectorPath(100, 100, r0, r1, aC - hw, aC + hw) + ' ';
      r0 = r1;
    });
  });
  const domI = totals.indexOf(maxT);

  // 측풍/배풍
  const xws = recs.map((r) => r.xw);
  const xwScale = Math.max(20, xwLimit + 5);
  const xwPts = linePts(xws, 130, 0, xwScale);
  const thY = (130 - 10 - 110 * (xwLimit / xwScale)).toFixed(1);
  const xwExceed = recs.filter((r) => r.xw > xwLimit).length;

  // 활주로
  const c32 = recs.filter((r) => r.rwy[0] === '3').length;
  const p32 = Math.round((c32 / n) * 100);
  const p14 = 100 - p32;
  const rwyEventsAll: RwyEvent[] = [];
  recs.forEach((r, i) => {
    if (i > 0 && r.rwy !== recs[i - 1].rwy)
      rwyEventsAll.push({
        leftPct: (i / (n - 1)) * 100,
        time: r.time,
        label: `${recs[i - 1].rwy.slice(0, 2)} → ${r.rwy.slice(0, 2)}`,
        wind: r.wind,
        index: i,
      });
  });
  // 근접 이벤트는 마지막 것만 남겨 최소 7% 간격 확보 (라벨 겹침 방지)
  const evSpaced: RwyEvent[] = [];
  rwyEventsAll.forEach((e) => {
    while (evSpaced.length && e.leftPct - evSpaced[evSpaced.length - 1].leftPct < 7) evSpaced.pop();
    evSpaced.push(e);
  });

  // 갱신 빈도
  const upd = Array.from({ length: 24 }, () => 2);
  recs.forEach((r, i) => {
    if (i > 0 && r.rwy !== recs[i - 1].rwy) upd[r.hour]++;
    if (r.vis < 10) upd[r.hour]++;
  });
  const maxUpd = Math.max(...upd);
  const updBars: UpdBar[] = upd.map((count, hour) => ({
    hour,
    count,
    heightPct: Math.round((count / maxUpd) * 100),
    temp: count > 2 + UPD_BASE_EXTRA[range],
  }));

  // 구름 / 접근
  const cavok = recs.filter((r) => r.cloud === 'CAVOK').length;
  const ceils = recs.filter((r) => r.ceil != null).map((r) => r.ceil as number);
  const appBars: AppBar[] = (['ILS', 'RNP', 'VOR'] as Approach[]).map((name) => ({
    name,
    pct: Math.round((recs.filter((r) => r.app === name).length / n) * 100),
    fill: APP_COLORS[name],
  }));

  // 태그
  const tagCnt: Record<string, number> = {};
  recs.forEach((r) => r.tags.forEach((tg) => (tagCnt[tg] = (tagCnt[tg] || 0) + 1)));
  const tagChips: TagChip[] = Object.keys(tagCnt)
    .sort((a, b) => tagCnt[b] - tagCnt[a])
    .map((tag) => ({ tag, n: tagCnt[tag], desc: TAG_DESC[tag] ?? '' }));

  const lowVis = recs.filter((r) => r.vis < 10);

  return {
    total: n,
    firstTime: recs[0].time,
    lastTime: cur.time,
    interval: INTERVAL_LABEL[range],
    topRwy: p32 >= 50 ? '32L/32R' : '14L/14R',
    avgQnh: Math.round(qnhs.reduce((a, b) => a + b, 0) / n),
    tempPts: linePts(temps, 130, tMin, tMax),
    dpPts: linePts(dps, 130, tMin, tMax),
    spreadNow: cur.t - cur.dp,
    spreadMin,
    fogRisk: spreadMin <= 2,
    roseD: [roseD[0].trim(), roseD[1].trim(), roseD[2].trim()],
    domDir: DIR_LABELS[domI],
    domPct: Math.round((maxT / n) * 100),
    xwPts,
    thY,
    maxXw: Math.round(Math.max(...xws)),
    xwExceed,
    maxTw: Math.round(Math.max(...recs.map((r) => r.tw))),
    p32,
    p14,
    rwyEvents: evSpaced.slice(-5),
    updBars,
    maxUpd,
    cavokPct: Math.round((cavok / n) * 100),
    minCeil: ceils.length ? Math.min(...ceils) : null,
    bknCount: ceils.length,
    appBars,
    lowVisCount: lowVis.length,
    minVis: lowVis.length ? Math.min(...lowVis.map((r) => r.vis)) : 10,
    tsCount: recs.filter((r) => r.tags.includes('TS')).length,
    qnhPts,
    qnhNow: cur.qnh,
    qnhMax: Math.round(qnhMaxV),
    qnhMin: Math.round(qnhMinV),
    qnhDelta: (qnhMaxV - qnhMinV).toFixed(1),
    tagChips,
  };
}

/** 풍속(KT) → 스크러버/파티클 색 */
export function windColor(spd: number): string {
  return spd <= 6 ? '#5b8bc9' : spd <= 9 ? '#4aa88c' : spd <= 12 ? '#8fb84e' : spd <= 15 ? '#d9b83a' : spd <= 18 ? '#e08a35' : '#c8422e';
}

/** 풍속(KT) → 'r,g,b' (캔버스용) */
export function windColorRgb(spd: number): string {
  return spd <= 6 ? '91,139,201' : spd <= 9 ? '74,168,140' : spd <= 12 ? '143,184,78' : spd <= 15 ? '217,184,58' : spd <= 18 ? '224,138,53' : '200,66,46';
}
