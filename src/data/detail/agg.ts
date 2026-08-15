import type { AtisRecord, TimeWindow } from '../types';

/*
 * 상세 페이지 공용 집계·포맷 헬퍼. 패널별 파생값 계산(src/data/detail/<key>.ts)은 이 헬퍼 위에 만든다.
 * 시각은 전부 UTC epoch ms.
 */

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export type Unit = 'raw' | 'hour' | 'day';
export const UNIT_MS: Record<Unit, number> = { raw: 0, hour: HOUR, day: DAY };
export const UNIT_LABEL: Record<Unit, string> = { raw: '원본(전문 단위)', hour: '1시간', day: '1일' };

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ---------- 포맷 ---------- */

/** "2026-08-15 12:00Z" */
export function fmtDT(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}
/** "08-15" */
export function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** "2026-08-15" */
export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** "12:00Z" */
export function fmtHM(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}
/** "08-15 12:00Z" */
export function fmtDayHM(ts: number): string {
  return `${fmtDay(ts)} ${fmtHM(ts)}`;
}
/** ms → "3일 4시간" / "2시간 30분" / "45분" */
export function fmtDur(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}시간 ${mm}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}일 ${hh}시간` : `${d}일`;
}
/** 기간 창 라벨: "2026-08-08 12:00Z ~ 2026-08-15 12:00Z" */
export function fmtWindow(w: TimeWindow): string {
  return `${fmtDT(w.from)} ~ ${fmtDT(w.to)}`;
}
/** 시각 축 라벨 — 기간 길이에 따라 "HH:MMZ" 또는 "MM-DD" 또는 "MM-DD HH:MMZ" */
export function fmtAxis(ts: number, spanMs: number): string {
  if (spanMs <= 2 * DAY) return fmtHM(ts);
  if (spanMs <= 10 * DAY) return ts % DAY === 0 ? fmtDay(ts) : fmtDayHM(ts);
  return fmtDay(ts);
}
export function fmtNum(v: number, digits = 1): string {
  return Number.isFinite(v) ? v.toFixed(digits).replace(/\.0+$/, '') : '—';
}

/* ---------- 기본 통계 ---------- */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
export const min = (xs: number[]) => (xs.length ? Math.min(...xs) : NaN);
export const max = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** 풍향 평균 (벡터 평균, 0–360) */
export function meanDir(dirs: number[]): number {
  if (!dirs.length) return NaN;
  let x = 0;
  let y = 0;
  dirs.forEach((d) => {
    x += Math.sin((d * Math.PI) / 180);
    y += Math.cos((d * Math.PI) / 180);
  });
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}
export const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const dir8 = (d: number) => DIR8[Math.round(d / 45) % 8];
export const dir16 = (d: number) => DIR16[Math.round(d / 22.5) % 16];

/* ---------- 버킷 ---------- */

export interface Bucket {
  /** 버킷 시작 시각 (raw면 레코드 시각) */
  ts: number;
  /** 버킷에 속한 레코드 인덱스 (원본 recs 기준) */
  idx: number[];
  recs: AtisRecord[];
}

/** 레코드 수·기간에 맞는 자동 해상도: 점이 maxPts 이하가 되는 가장 세밀한 단위 */
export function autoUnit(recs: AtisRecord[], win: TimeWindow, maxPts = 800): Unit {
  if (recs.length <= maxPts) return 'raw';
  const span = win.to - win.from;
  if (span / HOUR <= maxPts) return 'hour';
  return 'day';
}

/**
 * 레코드를 시간 단위로 묶는다. raw면 레코드 1건 = 버킷 1개.
 * hour/day면 창(win) 전체를 빈 버킷 포함해 균일 간격으로 채운다 (차트 x축 균일화, 결측은 idx=[]).
 */
export function bucketize(recs: AtisRecord[], unit: Unit, win: TimeWindow): Bucket[] {
  if (unit === 'raw') return recs.map((r, i) => ({ ts: r.ts, idx: [i], recs: [r] }));
  const ms = UNIT_MS[unit];
  const start = Math.floor(win.from / ms) * ms;
  const end = Math.floor(win.to / ms) * ms;
  const buckets: Bucket[] = [];
  const byKey = new Map<number, Bucket>();
  for (let t = start; t <= end; t += ms) {
    const b: Bucket = { ts: t, idx: [], recs: [] };
    buckets.push(b);
    byKey.set(t, b);
  }
  recs.forEach((r, i) => {
    const b = byKey.get(Math.floor(r.ts / ms) * ms);
    if (b) {
      b.idx.push(i);
      b.recs.push(r);
    }
  });
  return buckets;
}

/** 버킷별 대표값 (빈 버킷은 null) */
export function bucketValues(buckets: Bucket[], pick: (r: AtisRecord) => number, agg: (xs: number[]) => number = mean): (number | null)[] {
  return buckets.map((b) => (b.recs.length ? agg(b.recs.map(pick)) : null));
}

/** UTC 시간대(0–23)별 프로파일 — 각 시간대에 속한 레코드의 agg 값 (없으면 null) */
export function hourProfile(recs: AtisRecord[], pick: (r: AtisRecord) => number, agg: (xs: number[]) => number = mean): (number | null)[] {
  const bins: number[][] = Array.from({ length: 24 }, () => []);
  recs.forEach((r) => bins[r.hour].push(pick(r)));
  return bins.map((xs) => (xs.length ? agg(xs) : null));
}

/** UTC 시간대(0–23)별 조건 충족 건수 */
export function hourCount(recs: AtisRecord[], pred: (r: AtisRecord) => boolean): number[] {
  const bins = Array(24).fill(0) as number[];
  recs.forEach((r) => {
    if (pred(r)) bins[r.hour]++;
  });
  return bins;
}

/** 일(UTC) 단위 그룹 — 창 전체를 빈 날 포함해 채움 */
export function dayBuckets(recs: AtisRecord[], win: TimeWindow): Bucket[] {
  return bucketize(recs, 'day', win);
}

/** 창이 포함하는 일수 (부분 일 포함, 최소 1) */
export function daysIn(win: TimeWindow): number {
  return Math.max(1, (win.to - win.from) / DAY);
}

/* ---------- 연속 구간(이벤트) ---------- */

export interface Run {
  /** 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  /** 지속 시간(ms) — 끝 레코드 시각 − 시작 레코드 시각 (한 건이면 0) */
  durMs: number;
  recs: AtisRecord[];
}

/**
 * 조건을 연속으로 만족하는 레코드 구간 목록 (이벤트 병합).
 * maxGapMs: 연속 레코드 사이 시간 간격이 이보다 크면(수신 공백) 구간을 끊는다 (기본 무제한).
 */
export function runs(recs: AtisRecord[], pred: (r: AtisRecord, i: number) => boolean, maxGapMs = Infinity): Run[] {
  const out: Run[] = [];
  let s = -1;
  const flush = (e: number) => {
    if (s < 0) return;
    out.push({ start: s, end: e, startTs: recs[s].ts, endTs: recs[e].ts, durMs: recs[e].ts - recs[s].ts, recs: recs.slice(s, e + 1) });
    s = -1;
  };
  recs.forEach((r, i) => {
    if (pred(r, i)) {
      if (s >= 0 && r.ts - recs[i - 1].ts > maxGapMs) flush(i - 1);
      if (s < 0) s = i;
    } else flush(i - 1);
  });
  flush(recs.length - 1);
  return out;
}

/** 값이 바뀌는 지점 목록 (i>0, key(recs[i]) !== key(recs[i-1])) */
export function changes<T>(recs: AtisRecord[], key: (r: AtisRecord) => T): { index: number; from: T; to: T }[] {
  const out: { index: number; from: T; to: T }[] = [];
  for (let i = 1; i < recs.length; i++) {
    const a = key(recs[i - 1]);
    const b = key(recs[i]);
    if (a !== b) out.push({ index: i, from: a, to: b });
  }
  return out;
}

/* ---------- 축 눈금 ---------- */

/** d3 스타일 nice ticks. integer=true면 눈금 간격을 1 이상 정수로 강제 (건수 축) */
export function niceTicks(lo: number, hi: number, count = 5, integer = false): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  let step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  if (integer) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** 시각 축 눈금 — 기간에 맞춰 1h/3h/6h/12h/1d/2d/7d/… 간격 */
export function timeTicks(from: number, to: number, maxTicks = 8): number[] {
  const span = to - from;
  const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY, 180 * DAY, 365 * DAY];
  const step = steps.find((s) => span / s <= maxTicks) ?? 365 * DAY;
  const out: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}
