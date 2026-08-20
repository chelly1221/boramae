import type { AtisRecord, BirdKind, BirdReport, Dir8, HeatCell, HeatRow, NoticeKind, Range } from './types';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "HHMMZ" — 좁은 라벨용 */
export const hhmmZ = (r: AtisRecord) => r.time.slice(-5);

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

/** 도넛 섹터 path (바람용) — 각도는 라디안, 0 = 북, 시계방향 */
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
  /** 접근 명칭 (appName: "ILS" / "ILS Z" / "RNP" / "LOC Y") */
  name: string;
  n: number;
  pct: number;
  fill: string;
}

/** 활주로 표면 상태 카드 */
export interface RwyCondCard {
  /** 상태 보고가 있는 전문 수 / 비율(%) */
  n: number;
  pct: number;
  /** 기간 내 최저 RWYCC (코드 보고가 없으면 null) */
  minCode: number | null;
  /** 최저 코드가 나온 보고 "2/0/1 RWY14R" */
  minCodeTxt: string;
  /** 제동작용 보고 수 */
  brakingN: number;
  /** 가장 나쁜 제동작용 ("MEDIUM TO POOR") */
  worstBraking: string | null;
  /** 마지막 상태 보고 전문 */
  last: { index: number; time: string; summary: string } | null;
}

export interface NoticeChip {
  kind: NoticeKind;
  label: string;
  color: string;
  /** 공지가 있는 전문 수 */
  n: number;
  pct: number;
}

/** 운영 공지 카드 */
export interface NoticeCard {
  /** 공지 종류별 전문 수 (내림차순) */
  chips: NoticeChip[];
  /** 공지가 1건 이상인 전문 수 */
  anyN: number;
  /** 흐름관리 최대 지연(분) — 없으면 null */
  flowMaxMin: number | null;
  /** 현재(마지막 전문) 유효 공지 종류 */
  current: NoticeKind[];
}

export interface TagChip {
  tag: string;
  n: number;
  desc: string;
}

export interface BirdCard {
  /** 조류 보고가 있는 전문 수 / 비율(%) */
  n: number;
  pct: number;
  /** HVY(큰 무리) 보고 전문 수 */
  hvy: number;
  /** 최다 보고 방위 (없으면 null) */
  topDir: { dir: Dir8; n: number } | null;
  /** 마지막 보고 전문 (인덱스·시각·내용) */
  last: { index: number; time: string; head: string; kind: BirdKind } | null;
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
  // 바람 (3 속도 구간별 path)
  roseD: [string, string, string];
  domDir: string;
  domPct: number;
  /** 최대 돌풍 (KT) — 돌풍 보고 없으면 null */
  gustMax: number | null;
  /** CALM·VRB 전문 비율 (%) */
  calmVrbPct: number;
  // 측풍/배풍
  xwPts: string;
  thY: string;
  maxXw: number;
  xwExceed: number;
  maxTw: number;
  // 활주로
  p32: number;
  p14: number;
  /** 현재(마지막 전문) 착륙/이륙 활주로 */
  arrRwy: string;
  depRwy: string;
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
  /** TS 태그 또는 CB 구름 보고 전문 수 */
  tsCount: number;
  /** RVR 보고 전문 수 */
  rvrCount: number;
  // QNH
  qnhPts: string;
  qnhNow: number;
  qnhMax: number;
  qnhMin: number;
  qnhDelta: string;
  // 태그
  tagChips: TagChip[];
  /** TREND BECMG/TEMPO 전문 수 */
  trendChangeN: number;
  // 활주로 표면 상태
  rwyCond: RwyCondCard;
  // 운영 공지
  notice: NoticeCard;
  // 조류 활동
  bird: BirdCard;
}

const DIR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** 접근 명칭별 색 (등장 순서대로 배정) */
const APP_PALETTE = ['#7f0d00', '#b4451c', '#8c7a6e', '#6b8cae', '#b8770a'];
/** 접근 명칭 → 색 (ILS 고정 primary) */
export function appColor(name: string, order: number): string {
  return name === 'ILS' ? APP_PALETTE[0] : APP_PALETTE[Math.min(APP_PALETTE.length - 1, Math.max(1, order))];
}
/** 기상현상 코드 설명 (전문 "WITH FBL TS RA BR" 의 2글자 코드) */
export const TAG_DESC: Record<string, string> = {
  BR: '박무',
  FG: '안개',
  HZ: '연무',
  FU: '연기',
  DU: '먼지',
  SA: '모래',
  VA: '화산재',
  RA: '비',
  SN: '눈',
  DZ: '이슬비',
  GR: '우박',
  GS: '싸락우박',
  PL: '얼음싸라기',
  SG: '싸락눈',
  IC: '세빙',
  UP: '미상 강수',
  TS: '뇌전',
  SH: '소나기성',
  FZ: '어는',
  MI: '얕은',
  BC: '조각',
  PR: '부분',
  DR: '낮은 날림',
  BL: '높은 날림',
  SQ: '스콜',
  PO: '먼지 회오리',
  FC: '깔때기 구름',
  SS: '모래폭풍',
  DS: '먼지폭풍',
};
/** 강수 계열 코드 (히트맵 '강수' 판정) */
export const PRECIP_TAGS = ['RA', 'SN', 'DZ', 'GR', 'GS', 'PL', 'SG', 'UP'];
export const isPrecip = (r: AtisRecord) => r.tags.some((t) => PRECIP_TAGS.includes(t));
/** TS 태그 또는 CB 구름 */
export const isTsCb = (r: AtisRecord) => r.tags.includes('TS') || r.clouds.some((c) => c.cb);

/** 운영 공지 종류 — 표시 순서 */
export const NOTICE_KINDS: NoticeKind[] = ['GPS', 'FLOW', 'WS', 'LVP', 'GRASS', 'FLTCK', 'BALLOON', 'GP_OTS', 'WIP', 'CLOSED', 'BIRDS', 'OTHER'];
export const NOTICE_LABEL: Record<NoticeKind, string> = {
  GPS: 'GPS 신호 불량',
  FLOW: '흐름관리',
  WS: '윈드시어',
  LVP: '저시정 절차',
  GRASS: '잔디 깎기',
  FLTCK: '비행검사',
  BALLOON: '자유기구 주의',
  GP_OTS: 'GP 운용 중단',
  WIP: '공사',
  CLOSED: '공항 폐쇄',
  BIRDS: '조류 주의(일반)',
  OTHER: '기타',
};
export const NOTICE_COLOR: Record<NoticeKind, string> = {
  GPS: '#6b8cae',
  FLOW: '#b4451c',
  WS: '#c8422e',
  LVP: '#9a6a12',
  GRASS: '#5f9a4e',
  FLTCK: '#7b6bb3',
  BALLOON: '#d98a0c',
  GP_OTS: '#7f0d00',
  WIP: '#8c7a6e',
  CLOSED: '#3c2a23',
  BIRDS: '#e05a2b',
  OTHER: '#b3a79c',
};
/** 제동작용 등급 순서 (나쁜 순) */
export const BRAKING_ORDER = ['POOR', 'MEDIUM TO POOR', 'MEDIUM', 'GOOD TO MEDIUM', 'GOOD'];
export const brakingRank = (b: string) => {
  const i = BRAKING_ORDER.indexOf(b.toUpperCase());
  return i < 0 ? BRAKING_ORDER.length : i;
};
export const BRAKING_LABEL: Record<string, string> = { POOR: '불량', 'MEDIUM TO POOR': '보통~불량', MEDIUM: '보통', 'GOOD TO MEDIUM': '양호~보통', GOOD: '양호' };
/** RWYCC 코드 → 색 (6 건조 … 0 결빙/불량) */
export function rwyccColor(code: number): string {
  return code >= 6 ? '#5f9a4e' : code >= 5 ? '#8fb84e' : code >= 4 ? '#d9b83a' : code >= 3 ? '#e08a35' : code >= 2 ? '#c8422e' : '#7f0d00';
}
/** 상태 보고 1건 요약 — "RWY32R 5/5/5 WET · 제동 GOOD TO MEDIUM" */
export function rwyCondSummary(c: AtisRecord['rwyCond'][number]): string {
  const parts: string[] = [];
  if (c.rwy) parts.push(`RWY${c.rwy}`);
  if (c.codes) parts.push(c.codes.join('/') + (c.note ? ` ${c.note}` : ''));
  else if (c.extra.length) parts.push(c.extra[0]);
  if (c.braking) parts.push(`제동 ${c.braking}`);
  return parts.join(' · ') || '상태 보고';
}

/** 활주로 표면 상태 카드 파생값 */
export function computeRwyCondCard(recs: AtisRecord[]): RwyCondCard {
  let n = 0;
  let minCode: number | null = null;
  let minCodeTxt = '';
  let brakingN = 0;
  let worst: string | null = null;
  let last: RwyCondCard['last'] = null;
  recs.forEach((r, i) => {
    if (!r.rwyCond.length) return;
    n++;
    for (const c of r.rwyCond) {
      if (c.codes) {
        const m = Math.min(...c.codes);
        if (minCode == null || m < minCode) {
          minCode = m;
          minCodeTxt = `${c.codes.join('/')}${c.rwy ? ` RWY${c.rwy}` : ''}`;
        }
      }
      if (c.braking) {
        brakingN++;
        if (!worst || brakingRank(c.braking) < brakingRank(worst)) worst = c.braking;
      }
    }
    last = { index: i, time: r.time, summary: r.rwyCond.map(rwyCondSummary).join(' / ') };
  });
  return { n, pct: recs.length ? Math.round((n / recs.length) * 100) : 0, minCode, minCodeTxt, brakingN, worstBraking: worst, last };
}

/** 운영 공지 카드 파생값 */
export function computeNoticeCard(recs: AtisRecord[]): NoticeCard {
  const cnt = new Map<NoticeKind, number>();
  let anyN = 0;
  let flowMaxMin: number | null = null;
  recs.forEach((r) => {
    if (!r.notices.length) return;
    anyN++;
    const kinds = new Set(r.notices.map((x) => x.kind));
    kinds.forEach((k) => cnt.set(k, (cnt.get(k) ?? 0) + 1));
    r.notices.forEach((x) => x.flow?.forEach((f) => (flowMaxMin = Math.max(flowMaxMin ?? 0, f.min))));
  });
  const chips: NoticeChip[] = NOTICE_KINDS.filter((k) => cnt.has(k))
    .map((k) => ({ kind: k, label: NOTICE_LABEL[k], color: NOTICE_COLOR[k], n: cnt.get(k) as number, pct: recs.length ? Math.round(((cnt.get(k) as number) / recs.length) * 100) : 0 }))
    .sort((a, b) => b.n - a.n);
  const lastR = recs[recs.length - 1];
  const current = lastR ? NOTICE_KINDS.filter((k) => lastR.notices.some((x) => x.kind === k)) : [];
  return { chips, anyN, flowMaxMin, current };
}
/** 조류 무리 규모별 색 (지도 섹터·카드·상세 공용, 베이스맵 톤) */
export const BIRD_COLOR: Record<BirdKind, string> = { HVY: '#e05a2b', LGT: '#d98a0c' };
export const BIRD_KIND_LABEL: Record<BirdKind, string> = { HVY: '큰 무리', LGT: '작은 무리' };
/** "HVY FLOCK 5NM NW" */
export const birdHead = (b: BirdReport) => `${b.kind} FLOCK ${b.nm}NM ${b.dir}`;

/** 조류 활동 카드 파생값 */
export function computeBirdCard(recs: AtisRecord[]): BirdCard {
  const dirCnt = new Map<Dir8, number>();
  let n = 0;
  let hvy = 0;
  let last: BirdCard['last'] = null;
  recs.forEach((r, i) => {
    if (!r.birds.length) return;
    n++;
    if (r.birds.some((b) => b.kind === 'HVY')) hvy++;
    r.birds.forEach((b) => dirCnt.set(b.dir, (dirCnt.get(b.dir) ?? 0) + 1));
    const main = r.birds.find((b) => b.kind === 'HVY') ?? r.birds[0];
    last = { index: i, time: r.time, head: birdHead(main), kind: main.kind };
  });
  let topDir: BirdCard['topDir'] = null;
  dirCnt.forEach((v, k) => {
    if (!topDir || v > topDir.n) topDir = { dir: k, n: v };
  });
  return { n, pct: recs.length ? Math.round((n / recs.length) * 100) : 0, hvy, topDir, last };
}
/** 갱신 빈도: 정기 발행은 매시 정각 1회(:00) — 일평균이 이를 넘으면 임시 갱신 포함으로 판정 */
export const UPD_REGULAR_PER_HOUR = 1;

export function computeStats(recs: AtisRecord[], range: Range, xwLimit: number): Stats {
  if (!recs.length) return emptyStats(xwLimit);
  const cur = recs[recs.length - 1];
  const n = recs.length;
  const spanMs = Math.max(1, cur.ts - recs[0].ts);
  const days = Math.max(1, spanMs / DAY_MS);

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

  // 바람
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
  let gustMax: number | null = null;
  let calmVrb = 0;
  for (const r of recs) {
    if (r.gust != null && (gustMax == null || r.gust > gustMax)) gustMax = r.gust;
    if (r.calm || r.vrb) calmVrb++;
  }

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
        leftPct: ((r.ts - recs[0].ts) / spanMs) * 100,
        time: range === '24h' ? hhmmZ(r) : r.time,
        label: `${recs[i - 1].rwy.slice(0, 2)} → ${r.rwy.slice(0, 2)}`,
        wind: r.wind,
        index: i,
      });
  });
  // 근접 이벤트는 마지막 것만 남겨 최소 간격 확보 (라벨 겹침 방지) — 24h는 "HHMMZ", 그 외는 "MM-DD HHMMZ" 라벨이라 더 넓게
  const minGapPct = range === '24h' ? 8 : 14;
  const evSpaced: RwyEvent[] = [];
  rwyEventsAll.forEach((e) => {
    while (evSpaced.length && e.leftPct - evSpaced[evSpaced.length - 1].leftPct < minGapPct) evSpaced.pop();
    evSpaced.push(e);
  });

  // 갱신 빈도: UTC 시간대별 발행 건수의 일평균 (정기 2회/시 초과분 = 임시 갱신)
  const updCnt = Array.from({ length: 24 }, () => 0);
  recs.forEach((r) => updCnt[r.hour]++);
  const upd = updCnt.map((c) => Math.round((c / days) * 10) / 10);
  const maxUpd = Math.max(...upd);
  const updBars: UpdBar[] = upd.map((count, hour) => ({
    hour,
    count,
    heightPct: Math.round((count / (maxUpd || 1)) * 100),
    temp: count > UPD_REGULAR_PER_HOUR + 0.05,
  }));

  // 구름 / 접근 — 접근 명칭은 데이터에 등장한 것만 (ILS 항상 포함)
  const cavok = recs.filter((r) => r.cloud === 'CAVOK').length;
  const ceils = recs.filter((r) => r.ceil != null).map((r) => r.ceil as number);
  const appCnt = new Map<string, number>([['ILS', 0]]);
  recs.forEach((r) => appCnt.set(r.appName, (appCnt.get(r.appName) ?? 0) + 1));
  const appBars: AppBar[] = [...appCnt.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] === 'ILS' ? -1 : 1))
    .map(([name, c], i) => ({ name, n: c, pct: Math.round((c / n) * 100), fill: appColor(name, i) }));

  // 태그
  const tagCnt: Record<string, number> = {};
  recs.forEach((r) => r.tags.forEach((tg) => (tagCnt[tg] = (tagCnt[tg] || 0) + 1)));
  const tagChips: TagChip[] = Object.keys(tagCnt)
    .sort((a, b) => tagCnt[b] - tagCnt[a])
    .map((tag) => ({ tag, n: tagCnt[tag], desc: TAG_DESC[tag] ?? '' }));

  const lowVis = recs.filter((r) => r.vis < 10);

  return {
    total: n,
    firstTime: range === '24h' ? hhmmZ(recs[0]) : recs[0].time,
    lastTime: range === '24h' ? hhmmZ(cur) : cur.time,
    interval: n > 1 ? `${Math.round(spanMs / 60000 / (n - 1))}분` : '—',
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
    gustMax,
    calmVrbPct: Math.round((calmVrb / n) * 100),
    xwPts,
    thY,
    maxXw: Math.round(Math.max(...xws)),
    xwExceed,
    maxTw: Math.round(Math.max(...recs.map((r) => r.tw))),
    p32,
    p14,
    arrRwy: cur.arrRwy ?? '—',
    depRwy: cur.depRwy ?? '—',
    rwyEvents: evSpaced.slice(-5),
    updBars,
    maxUpd: Math.round(maxUpd * 10) / 10,
    cavokPct: Math.round((cavok / n) * 100),
    minCeil: ceils.length ? Math.min(...ceils) : null,
    bknCount: ceils.length,
    appBars,
    lowVisCount: lowVis.length,
    minVis: lowVis.length ? Math.min(...lowVis.map((r) => r.vis)) : 10,
    tsCount: recs.filter(isTsCb).length,
    rvrCount: recs.filter((r) => r.rvr.length > 0).length,
    qnhPts,
    qnhNow: cur.qnh,
    qnhMax: Math.round(qnhMaxV),
    qnhMin: Math.round(qnhMinV),
    qnhDelta: (qnhMaxV - qnhMinV).toFixed(1),
    tagChips,
    trendChangeN: recs.filter((r) => r.trend === 'BECMG' || r.trend === 'TEMPO').length,
    rwyCond: computeRwyCondCard(recs),
    notice: computeNoticeCard(recs),
    bird: computeBirdCard(recs),
  };
}

/** 레코드가 없을 때의 빈 통계 (폴더 미설정·기간 내 전문 없음) */
function emptyStats(xwLimit: number): Stats {
  const xwScale = Math.max(20, xwLimit + 5);
  return {
    total: 0,
    firstTime: '—',
    lastTime: '—',
    interval: '—',
    topRwy: '—',
    avgQnh: 0,
    tempPts: '',
    dpPts: '',
    spreadNow: 0,
    spreadMin: 0,
    fogRisk: false,
    roseD: ['', '', ''],
    domDir: '—',
    domPct: 0,
    gustMax: null,
    calmVrbPct: 0,
    xwPts: '',
    thY: (130 - 10 - 110 * (xwLimit / xwScale)).toFixed(1),
    maxXw: 0,
    xwExceed: 0,
    maxTw: 0,
    p32: 0,
    p14: 0,
    arrRwy: '—',
    depRwy: '—',
    rwyEvents: [],
    updBars: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, heightPct: 0, temp: false })),
    maxUpd: 0,
    cavokPct: 0,
    minCeil: null,
    bknCount: 0,
    appBars: [],
    lowVisCount: 0,
    minVis: 10,
    tsCount: 0,
    rvrCount: 0,
    qnhPts: '',
    qnhNow: 0,
    qnhMax: 0,
    qnhMin: 0,
    qnhDelta: '0',
    tagChips: [],
    trendChangeN: 0,
    rwyCond: { n: 0, pct: 0, minCode: null, minCodeTxt: '', brakingN: 0, worstBraking: null, last: null },
    notice: { chips: [], anyN: 0, flowMaxMin: null, current: [] },
    bird: { n: 0, pct: 0, hvy: 0, topDir: null, last: null },
  };
}

/* ---------- 기상 히트맵 (일 × 24시간, UTC) ---------- */

const HEAT_COLOR = { fog: '#c8871c', rain: '#6b8cae', rwy: '#7f0d00' } as const;
const HEAT_NAME = { fog: '시정 저하', rain: '강수', rwy: '활주로 전환' } as const;
type HeatEv = keyof typeof HEAT_COLOR;

/**
 * 레코드에서 일 × 시간대 이벤트 히트맵 행을 만든다. [from, to] 창의 각 UTC 일이 한 행.
 * 셀 이벤트: 시정 저하(vis<10, 강수 제외) / 강수(RA·SN·DZ 등 강수 계열 태그) / 활주로 전환(직전 레코드와 다름).
 * 복합은 50/50 그라데이션. `index`는 셀 시간대의 첫 레코드 인덱스(원문 열기용).
 */
export function computeHeatRows(recs: AtisRecord[], from: number, to: number): HeatRow[] {
  const dayStart = Math.floor(from / DAY_MS) * DAY_MS;
  const rows: HeatRow[] = [];
  const cellMap = new Map<number, { ev: Set<HeatEv>; index: number }>();
  recs.forEach((r, i) => {
    const key = Math.floor(r.ts / HOUR_MS) * HOUR_MS;
    let c = cellMap.get(key);
    if (!c) {
      c = { ev: new Set(), index: i };
      cellMap.set(key, c);
    }
    if (isPrecip(r)) c.ev.add('rain');
    else if (r.vis < 10) c.ev.add('fog');
    if (i > 0 && r.rwy !== recs[i - 1].rwy) c.ev.add('rwy');
  });
  for (let d = dayStart; d <= to; d += DAY_MS) {
    const dt = new Date(d);
    const day = `${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    const cells: HeatCell[] = [];
    for (let h = 0; h < 24; h++) {
      const ts = d + h * HOUR_MS;
      const c = cellMap.get(ts);
      const label = `${day} ${pad2(h)}시 · `;
      const inWin = ts + HOUR_MS > from && ts <= to;
      if (!c || !c.ev.size) {
        cells.push({ bg: inWin ? 'rgba(50,30,20,0.05)' : 'rgba(50,30,20,0.02)', title: label + (inWin ? '정상' : '기간 외'), ts, index: c?.index ?? null });
        continue;
      }
      const ev = (['fog', 'rain', 'rwy'] as HeatEv[]).filter((e) => c.ev.has(e));
      const bg = ev.length === 1 ? HEAT_COLOR[ev[0]] : `linear-gradient(90deg, ${HEAT_COLOR[ev[0]]} 0 50%, ${HEAT_COLOR[ev[1]]} 50% 100%)`;
      cells.push({ bg, title: label + ev.map((e) => HEAT_NAME[e]).join(' + '), ts, index: c.index });
    }
    rows.push({ day, dayTs: d, cells });
  }
  return rows;
}

/** 풍속(KT) → 스크러버/파티클 색 */
export function windColor(spd: number): string {
  return spd <= 6 ? '#5b8bc9' : spd <= 9 ? '#4aa88c' : spd <= 12 ? '#8fb84e' : spd <= 15 ? '#d9b83a' : spd <= 18 ? '#e08a35' : '#c8422e';
}

/** 풍속(KT) → 'r,g,b' (캔버스용) */
export function windColorRgb(spd: number): string {
  return spd <= 6 ? '91,139,201' : spd <= 9 ? '74,168,140' : spd <= 12 ? '143,184,78' : spd <= 15 ? '217,184,58' : spd <= 18 ? '224,138,53' : '200,66,46';
}
