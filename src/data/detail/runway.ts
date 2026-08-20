import { RUNWAY_TRUE_HEADING } from '../airport';
import type { AtisRecord, Runway, TimeWindow } from '../types';
import { changes, DAY, dir8, fmtDate, fmtDay, fmtHM, HOUR, mean, median } from './agg';

/*
 * 활주로 사용 상세 파생값 — 사용 비율, 전환 이벤트(카드 rwyEvents와 동일 정의: 직전 전문과 rwy(방향)가 다름),
 * 유지 구간, 구간별 32/14 비율(누적 막대), 시간대별 전환·사용 프로파일, 전환 시 풍향 분포, 유지 시간 분포,
 * 활주로 배치(착륙 ARR / 이륙 DEP 조합: "ARR 32L · DEP 32R")별 사용 건수와 같은 방향 안의 배치 교체 이벤트(32L↔32R 등).
 */

export const RWY_32: Runway = '32L/32R';
export const RWY_14: Runway = '14L/14R';
/** 활주로 방향 접두 ("32" | "14") */
export const rwyPrefix = (rwy: Runway) => rwy.slice(0, 2);
const is32 = (r: AtisRecord) => r.rwy[0] === '3';

/** 전환 이벤트 1건 (recs[index]가 새 활주로의 첫 전문) */
export interface RwyChange {
  index: number;
  ts: number;
  from: Runway;
  to: Runway;
  /** "32 → 14" */
  label: string;
  wind: string;
  dir: number;
  spd: number;
  /** 전환 시 바람으로 계산한 직전 활주로의 배풍 성분 (KT) */
  twPrev: number;
  /** 새 활주로의 배풍 성분 (KT) — 레코드 값 */
  twNew: number;
  /** 새 활주로 유지 시간 (다음 전환까지, 마지막이면 기간 마지막 전문까지) */
  holdMs: number;
  /** 다음 전환이 없어 유지 중 (기간 끝까지) */
  ongoing: boolean;
}

/** 같은 활주로가 유지된 구간 */
export interface RwySegment {
  rwy: Runway;
  start: number;
  end: number;
  startTs: number;
  /** 다음 전환 시각 (마지막 구간이면 마지막 전문 시각) */
  endTs: number;
  durMs: number;
  /** 양끝이 모두 전환으로 닫힌 완전한 구간 */
  complete: boolean;
}

/** 시간 버킷별 32/14 사용 (누적 막대용) */
export interface RwyBucket {
  ts: number;
  /** x축 라벨 ('' = 라벨 생략) */
  label: string;
  /** 툴팁 제목 */
  title: string;
  n32: number;
  n14: number;
  /** 첫 레코드 인덱스 (원문 열기) — 없으면 null */
  index: number | null;
}

export interface HoldBin {
  label: string;
  n: number;
}

/** 활주로 배치 라벨 — "ARR 32L · DEP 32R" (없는 쪽은 —) */
export const rwyConfig = (r: AtisRecord) => `ARR ${r.arrRwy ?? '—'} · DEP ${r.depRwy ?? '—'}`;

/** 배치별 사용 건수 */
export interface RwyConfigCount {
  config: string;
  /** 방향 ('32L/32R' | '14L/14R') */
  rwy: Runway;
  n: number;
  pct: number;
  /** 마지막 사용 레코드 인덱스 (원문 열기) */
  lastIndex: number;
}

/** 같은 방향 안에서 착륙/이륙 활주로만 바뀐 이벤트 (recs[index]가 새 배치의 첫 전문) */
export interface RwyConfigChange {
  index: number;
  ts: number;
  from: string;
  to: string;
  rwy: Runway;
  wind: string;
}

export interface RunwayDetail {
  n: number;
  n32: number;
  n14: number;
  p32: number;
  p14: number;
  events: RwyChange[];
  /** 32 → 14 / 14 → 32 전환 횟수 */
  to14: number;
  to32: number;
  segments: RwySegment[];
  /** 전환 간격 평균/중앙값 (완전한 유지 구간 기준, ms). 없으면 NaN */
  holdMean: number;
  holdMedian: number;
  /** 최장 유지 구간 (부분 구간 포함) */
  longest: RwySegment | null;
  lastChange: RwyChange | null;
  /** 기간 마지막 전문의 활주로 + 유지 시간(마지막 전환 이후, 전환이 없으면 첫 전문 이후) */
  current: Runway;
  currentHoldMs: number;
  /** 하루당 전환 횟수 */
  perDay: number;
  /* 메인 차트 */
  bucketMs: number;
  buckets: RwyBucket[];
  /** true면 x라벨 간격을 차트가 자동으로 솎음(모든 버킷에 라벨 있음), false면 label이 ''가 아닌 버킷만 표시(labelEvery=1) */
  labelAuto: boolean;
  /* 보조 */
  /** UTC 시간대별 전환 건수 [→32, →14] */
  hourTo32: number[];
  hourTo14: number[];
  /** UTC 시간대별 32/14 사용 건수 */
  hourN32: number[];
  hourN14: number[];
  /** 전환 시 풍향 8방위별 건수 [→32, →14] + 평균 풍속 */
  dirTo32: number[];
  dirTo14: number[];
  dirSpd: (number | null)[];
  /** 유지 시간 분포 (완전한 구간) */
  holdBins: HoldBin[];
  /* 활주로 배치 (ARR/DEP) */
  /** 배치별 사용 건수 (건수 내림차순) */
  configs: RwyConfigCount[];
  /** 기간 마지막 전문의 배치 */
  currentConfig: string;
  /** 같은 방향 안의 배치 교체 이벤트 (시각순) */
  configChanges: RwyConfigChange[];
}

/** 진방위 활주로 heading 기준 배풍 성분 (KT, 0 이상) */
export function tailwindFor(rwy: Runway, dir: number, spd: number): number {
  const rel = ((dir - RUNWAY_TRUE_HEADING[rwy]) * Math.PI) / 180;
  return Math.max(0, -spd * Math.cos(rel));
}

/** 막대 수가 maxBars 이하가 되는 가장 세밀한 버킷 (1h/3h/6h/12h/1d) */
export function pickBucketMs(win: TimeWindow, maxBars = 168): number {
  const span = Math.max(1, win.to - win.from);
  const steps = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY];
  return steps.find((s) => span / s <= maxBars) ?? DAY;
}

/** 버킷 해상도 라벨 */
export function bucketLabel(ms: number): string {
  return ms >= DAY ? '1일' : `${Math.round(ms / HOUR)}시간`;
}

/** 유지 시간 히스토그램 구간 — (lo, hi] */
const HOLD_BINS: { label: string; lo: number; hi: number }[] = [
  { label: '≤1h', lo: -1, hi: HOUR },
  { label: '1–3h', lo: HOUR, hi: 3 * HOUR },
  { label: '3–6h', lo: 3 * HOUR, hi: 6 * HOUR },
  { label: '6–12h', lo: 6 * HOUR, hi: 12 * HOUR },
  { label: '12–24h', lo: 12 * HOUR, hi: DAY },
  { label: '1–3d', lo: DAY, hi: 3 * DAY },
  { label: '>3d', lo: 3 * DAY, hi: Infinity },
];

export function computeRunwayDetail(recs: AtisRecord[], win: TimeWindow): RunwayDetail {
  const n = recs.length;
  let n32 = 0;
  for (const r of recs) if (is32(r)) n32++;
  const n14 = n - n32;
  // 카드(stats.ts)와 동일: p32 = round(c32/n*100), p14 = 100 - p32
  const p32 = n ? Math.round((n32 / n) * 100) : 0;
  const p14 = n ? 100 - p32 : 0;

  /* ---------- 전환 이벤트 · 유지 구간 ---------- */
  const raw = changes(recs, (r) => r.rwy);
  const lastTs = recs[n - 1]?.ts ?? win.to;
  const events: RwyChange[] = raw.map((c, k) => {
    const r = recs[c.index];
    const nextTs = k + 1 < raw.length ? recs[raw[k + 1].index].ts : lastTs;
    return {
      index: c.index,
      ts: r.ts,
      from: c.from,
      to: c.to,
      label: `${rwyPrefix(c.from)} → ${rwyPrefix(c.to)}`,
      wind: r.wind,
      dir: r.dir,
      spd: r.spd,
      twPrev: tailwindFor(c.from, r.dir, r.spd),
      twNew: r.tw,
      holdMs: nextTs - r.ts,
      ongoing: k + 1 >= raw.length,
    };
  });
  let to14 = 0;
  let to32 = 0;
  for (const e of events) if (e.to === RWY_14) to14++; else to32++;

  const segments: RwySegment[] = [];
  if (n) {
    const bounds = [0, ...raw.map((c) => c.index)];
    bounds.forEach((s, k) => {
      const nextStart = k + 1 < bounds.length ? bounds[k + 1] : n;
      const e = nextStart - 1;
      const endTs = k + 1 < bounds.length ? recs[nextStart].ts : lastTs;
      segments.push({ rwy: recs[s].rwy, start: s, end: e, startTs: recs[s].ts, endTs, durMs: endTs - recs[s].ts, complete: k > 0 && k + 1 < bounds.length });
    });
  }
  const completeDurs = segments.filter((s) => s.complete).map((s) => s.durMs);
  const holdMean = mean(completeDurs);
  const holdMedian = median(completeDurs);
  let longest: RwySegment | null = null;
  for (const s of segments) if (!longest || s.durMs > longest.durMs) longest = s;
  const lastChange = events.length ? events[events.length - 1] : null;
  const current = recs[n - 1]?.rwy ?? RWY_32;
  const currentHoldMs = n ? lastTs - (lastChange ? lastChange.ts : recs[0].ts) : 0;
  const perDay = events.length / Math.max(1, (win.to - win.from) / DAY);

  /* ---------- 메인: 버킷별 32/14 ---------- */
  const bucketMs = pickBucketMs(win);
  const span = win.to - win.from;
  const start = Math.floor(win.from / bucketMs) * bucketMs;
  const end = Math.floor(win.to / bucketMs) * bucketMs;
  const nDays = Math.max(1, span / DAY);
  /** 일 경계 라벨 간격(일) — 시간 단위 버킷에서 라벨 ≤ 24개 */
  const dayEvery = Math.max(1, Math.ceil(nDays / 24));
  /** 400일 초과: 월 초 라벨(YYYY-MM)을 monthEvery개월 간격으로 */
  const monthEvery = Math.max(1, Math.ceil(nDays / 30 / 14));
  // 라벨 정책: 일 버킷 ≤400일이면 모든 버킷에 MM-DD를 달고 차트가 자동 솎음, 그 외는 여기서 고른 버킷만 라벨(labelEvery=1)
  const labelAuto = bucketMs >= DAY && nDays <= 400;
  const buckets: RwyBucket[] = [];
  const byKey = new Map<number, RwyBucket>();
  const nBuckets = Math.floor((end - start) / bucketMs) + 1;
  for (let t = start; t <= end; t += bucketMs) {
    const d = new Date(t);
    let label = '';
    if (bucketMs >= DAY) {
      if (labelAuto) label = fmtDay(t);
      else if (d.getUTCDate() === 1 && d.getUTCMonth() % monthEvery === 0) label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    } else if (span <= 2 * DAY) label = nBuckets <= 12 || d.getUTCHours() % 3 === 0 ? fmtHM(t) : '';
    else if (span <= 4 * DAY) label = t % DAY === 0 ? fmtDay(t) : t % (12 * HOUR) === 0 ? fmtHM(t) : '';
    else if (t % DAY === 0 && Math.round((t - start) / DAY) % dayEvery === 0) label = fmtDay(t);
    const title = bucketMs >= DAY ? fmtDate(t) : `${fmtDay(t)} ${fmtHM(t)} ~ ${fmtHM(t + bucketMs)}`;
    const b: RwyBucket = { ts: t, label, title, n32: 0, n14: 0, index: null };
    buckets.push(b);
    byKey.set(t, b);
  }
  recs.forEach((r, i) => {
    const b = byKey.get(Math.floor(r.ts / bucketMs) * bucketMs);
    if (!b) return;
    if (b.index == null) b.index = i;
    if (is32(r)) b.n32++;
    else b.n14++;
  });

  /* ---------- 보조 프로파일 ---------- */
  const hourTo32 = Array(24).fill(0) as number[];
  const hourTo14 = Array(24).fill(0) as number[];
  const dirTo32 = Array(8).fill(0) as number[];
  const dirTo14 = Array(8).fill(0) as number[];
  const dirSpds: number[][] = Array.from({ length: 8 }, () => []);
  for (const e of events) {
    const h = recs[e.index].hour;
    const d = Math.round(e.dir / 45) % 8;
    if (e.to === RWY_32) {
      hourTo32[h]++;
      dirTo32[d]++;
    } else {
      hourTo14[h]++;
      dirTo14[d]++;
    }
    dirSpds[d].push(e.spd);
  }
  const dirSpd = dirSpds.map((xs) => (xs.length ? mean(xs) : null));
  const hourN32 = Array(24).fill(0) as number[];
  const hourN14 = Array(24).fill(0) as number[];
  for (const r of recs) if (is32(r)) hourN32[r.hour]++; else hourN14[r.hour]++;

  const holdBins: HoldBin[] = HOLD_BINS.map((b) => ({ label: b.label, n: completeDurs.filter((d) => d > b.lo && d <= b.hi).length }));

  /* ---------- 활주로 배치 (ARR/DEP) ---------- */
  const cfgMap = new Map<string, RwyConfigCount>();
  const configChanges: RwyConfigChange[] = [];
  recs.forEach((r, i) => {
    const config = rwyConfig(r);
    const c = cfgMap.get(config);
    if (c) {
      c.n++;
      c.lastIndex = i;
    } else cfgMap.set(config, { config, rwy: r.rwy, n: 1, pct: 0, lastIndex: i });
    if (i > 0) {
      const p = recs[i - 1];
      if (p.rwy === r.rwy && (p.arrRwy !== r.arrRwy || p.depRwy !== r.depRwy)) configChanges.push({ index: i, ts: r.ts, from: rwyConfig(p), to: config, rwy: r.rwy, wind: r.wind });
    }
  });
  const configs = [...cfgMap.values()].sort((a, b) => b.n - a.n || a.config.localeCompare(b.config));
  for (const c of configs) c.pct = n ? Math.round((c.n / n) * 100) : 0;
  const currentConfig = n ? rwyConfig(recs[n - 1]) : '—';

  return {
    n,
    n32,
    n14,
    p32,
    p14,
    events,
    to14,
    to32,
    segments,
    holdMean,
    holdMedian,
    longest,
    lastChange,
    current,
    currentHoldMs,
    perDay,
    bucketMs,
    buckets,
    labelAuto,
    hourTo32,
    hourTo14,
    hourN32,
    hourN14,
    dirTo32,
    dirTo14,
    dirSpd,
    holdBins,
    configs,
    currentConfig,
    configChanges,
  };
}

/** 8방위 라벨 (전환 시 풍향 분포 x축) */
export const DIR8_LABELS = Array.from({ length: 8 }, (_, i) => dir8(i * 45));
