import type { AtisRecord, TimeWindow } from '../types';
import { autoUnit, bucketize, bucketValues, DAY, dayBuckets, fmtDate, fmtDay, fmtDayHM, fmtHM, hourCount, MIN, niceTicks, pct, runs, type Bucket, type Unit } from './agg';

/*
 * 시정 / 특이기상 상세 파생값
 * - 시정 저하 = vis < 10 KM (통계 카드 lowVisCount와 동일 정의)
 * - 등급: ≥10 / 5–<10 / 1–<5 / <1 KM
 * - TS = tags에 'TS', 안개 = tags에 FG 또는 BR
 */

/** 시정 저하 기준 (KM, 미만) */
export const LOW_VIS_KM = 10;
/** 임계선 (KM) */
export const VIS_TH_5 = 5;
export const VIS_TH_1 = 1;

/** 시정 등급 인덱스: 0 ≥10 / 1 5–<10 / 2 1–<5 / 3 <1 */
export type VisGrade = 0 | 1 | 2 | 3;
export const VIS_GRADE_LABEL: string[] = ['≥10KM', '5–<10KM', '1–<5KM', '<1KM'];
/** 등급 색 (≥10은 중립, 저하 등급은 앰버 계열 농도) */
export const VIS_GRADE_COLOR: string[] = ['rgba(50,30,20,0.10)', '#e2b95f', '#c8871c', '#9a6a12'];

export function visGrade(v: number): VisGrade {
  return v >= 10 ? 0 : v >= 5 ? 1 : v >= 1 ? 2 : 3;
}

/** 시정 표기 — 카드와 동일: ≥1KM → "7KM", <1KM → "800M" */
export function fmtVis(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1) return `${Number(v.toFixed(1))}KM`;
  return `${Math.round(v * 1000)}M`;
}

export const isLowVis = (r: AtisRecord) => r.vis < LOW_VIS_KM;
export const isTS = (r: AtisRecord) => r.tags.includes('TS');
export const isFog = (r: AtisRecord) => r.tags.includes('FG') || r.tags.includes('BR');

/** 저시정 연속 구간(이벤트) */
export interface VisRun {
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  /** 지속 (끝 전문 − 시작 전문 시각) */
  durMs: number;
  /** 구간 내 전문 수 */
  n: number;
  minVis: number;
  /** 최저 시정 레코드 인덱스 (클릭 → 원문) */
  minIdx: number;
  minTs: number;
  /** 구간에 등장한 태그 (중복 제거, 등장 순) */
  tags: string[];
  /** 최저 시정 시점의 구름 */
  cloud: string;
  /** 최저 시정 시점의 바람 */
  wind: string;
}

export interface TsReport {
  index: number;
  ts: number;
  letter: string;
  wind: string;
  spd: number;
  vis: number;
  cloud: string;
  tags: string[];
}

export interface GradeBucket {
  ts: number;
  label: string;
  /** 툴팁 제목 (시간대 / 일 / 주 범위) */
  title: string;
  /** 등급별 건수 [≥10, 5–<10, 1–<5, <1] */
  counts: [number, number, number, number];
  n: number;
  /** 버킷 내 최저 시정 레코드 인덱스 (클릭 → 원문, 빈 버킷 null) */
  minIdx: number | null;
}

/** 등급 구성 버킷 단위 — 창 ≤3일 시간, ≤120일 일, 그 외 주(7일) */
export type GradeUnit = 'hour' | 'day' | 'week';
export const GRADE_UNIT_LABEL: Record<GradeUnit, string> = { hour: '1시간', day: '1일', week: '7일' };
/** 새벽 안개 시간대 (UTC, inclusive) — 자동 코멘트 판단용 */
export const DAWN_HOURS: [number, number] = [3, 6];
/** 새벽 시간대 저하 비중이 이 값 이상이면 "새벽 안개 패턴" 코멘트 (균등 분포 기대치 ≈17%) */
export const DAWN_PATTERN_PCT = 30;

export interface VisDetail {
  total: number;
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  /** 버킷별 최저 시정 (빈 버킷 null) */
  values: (number | null)[];

  lowCount: number;
  lowPct: number;
  minVis: number;
  minAt: number;
  minIdx: number;
  lastVis: number;

  lowRuns: VisRun[];
  lowRunTotalMs: number;
  /** 최장 저시정 구간 */
  longestRun: VisRun | null;

  tsCount: number;
  tsReports: TsReport[];
  /** TS 연속 구간 (차트 밴드용, to = 구간 다음 전문 시각) */
  tsBands: { from: number; to: number }[];

  under5Count: number;
  under1Count: number;
  fogCount: number;
  fgCount: number;
  brCount: number;

  /** 등급 구성 버킷 단위 (짧은 창은 시간, 그 외 일/주) */
  gradeUnit: GradeUnit;
  gradeBuckets: GradeBucket[];

  /** 등급 구성 막대 y 상한 (정수 눈금 보장) */
  gradeYMax: number;
  /** UTC 시간대별 시정 저하 건수 (등급별 [5–<10, 1–<5, <1]) */
  hourLow: [number, number, number][];
  hourLowTotal: number[];
  hourYMax: number;
  /** 시정 저하 최다 시간대 (없으면 null) */
  peakHour: number | null;
  peakHourCount: number;
  /** 새벽(03–06Z) 시정 저하 건수·비중(%) — 안개 패턴 코멘트용 */
  dawnLow: number;
  dawnPct: number;
}

/** 7일 단위 버킷 (창 시작 일 00Z 기준, 빈 버킷 포함) — agg에 주 단위가 없어 로컬 구현 */
function weekBuckets(recs: AtisRecord[], win: TimeWindow): Bucket[] {
  const ms = 7 * DAY;
  const start = Math.floor(win.from / DAY) * DAY;
  const buckets: Bucket[] = [];
  for (let t = start; t <= win.to; t += ms) buckets.push({ ts: t, idx: [], recs: [] });
  recs.forEach((r, i) => {
    const b = buckets[Math.floor((r.ts - start) / ms)];
    if (b) {
      b.idx.push(i);
      b.recs.push(r);
    }
  });
  return buckets;
}

/**
 * 건수 막대 y 상한 — 눈금 간격이 정수(≥1)이고 최상단 눈금이 축 상단(단위 라벨)과 겹치지 않도록(≤92%) 여유를 둔다.
 * (BarChart는 yMax를 그대로 축 상한으로 쓰고 niceTicks(0, yMax, 4)로 눈금을 만든다)
 */
export function countAxisMax(m: number): number {
  let y = Math.max(4, m * 1.15);
  for (let k = 0; k < 24; k++) {
    const t = niceTicks(0, y, 4);
    const step = t.length > 1 ? t[1] - t[0] : 1;
    if (step >= 1 && t[t.length - 1] <= 0.92 * y) return y;
    y *= 1.06;
  }
  return y;
}

export function computeVisDetail(recs: AtisRecord[], win: TimeWindow): VisDetail {
  const total = recs.length;
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  // 집계 시 구간 최저 시정 (저시정 이벤트가 평균에 묻히지 않도록)
  const values = bucketValues(buckets, (r) => r.vis, (v) => {
    let m = Infinity;
    for (const x of v) if (x < m) m = x;
    return m;
  });

  // 단일 루프 통계 (대형 배열 대비 스프레드 미사용)
  let lowCount = 0;
  let minVis = Infinity;
  let minIdx = -1;
  let under5Count = 0;
  let under1Count = 0;
  let fgCount = 0;
  let brCount = 0;
  let fogCount = 0;
  let tsCount = 0;
  const tsReports: TsReport[] = [];
  recs.forEach((r, i) => {
    if (r.vis < LOW_VIS_KM) lowCount++;
    if (r.vis < minVis) {
      minVis = r.vis;
      minIdx = i;
    }
    if (r.vis < VIS_TH_5) under5Count++;
    if (r.vis < VIS_TH_1) under1Count++;
    const fg = r.tags.includes('FG');
    const br = r.tags.includes('BR');
    if (fg) fgCount++;
    if (br) brCount++;
    if (fg || br) fogCount++;
    if (r.tags.includes('TS')) {
      tsCount++;
      tsReports.push({ index: i, ts: r.ts, letter: r.letter, wind: r.wind, spd: r.spd, vis: r.vis, cloud: r.cloud, tags: r.tags });
    }
  });
  if (!Number.isFinite(minVis)) minVis = LOW_VIS_KM;

  // 저시정 구간
  const lowRuns: VisRun[] = runs(recs, isLowVis).map((run) => {
    let best = run.start;
    const tags: string[] = [];
    for (let i = run.start; i <= run.end; i++) {
      const r = recs[i];
      if (r.vis < recs[best].vis) best = i;
      r.tags.forEach((t) => {
        if (!tags.includes(t)) tags.push(t);
      });
    }
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
      minVis: recs[best].vis,
      minIdx: best,
      minTs: recs[best].ts,
      tags,
      cloud: recs[best].cloud,
      wind: recs[best].wind,
    };
  });
  let lowRunTotalMs = 0;
  let longestRun: VisRun | null = null;
  lowRuns.forEach((r) => {
    lowRunTotalMs += r.durMs;
    if (!longestRun || r.durMs > longestRun.durMs) longestRun = r;
  });

  // TS 구간 밴드 — 한 건짜리 구간도 보이도록 다음 전문 시각(없으면 +30분)까지
  const tsBands = runs(recs, isTS).map((run) => ({ from: run.startTs, to: recs[run.end + 1]?.ts ?? run.endTs + 30 * MIN }));

  // 등급 구성 (창 ≤ 3일: 시간 버킷, ≤ 120일: 일 버킷, 그 외 주 버킷 — 1년 창에서 막대 366개가 되지 않도록)
  const span = win.to - win.from;
  const gradeUnit: GradeUnit = span <= 3 * DAY ? 'hour' : span <= 120 * DAY ? 'day' : 'week';
  const gradeSrc = gradeUnit === 'hour' ? bucketize(recs, 'hour', win) : gradeUnit === 'day' ? dayBuckets(recs, win) : weekBuckets(recs, win);
  const gradeBuckets: GradeBucket[] = gradeSrc.map((b) => {
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    let minIdx: number | null = null;
    b.recs.forEach((r, k) => {
      counts[visGrade(r.vis)]++;
      if (minIdx == null || r.vis < recs[minIdx].vis) minIdx = b.idx[k];
    });
    const label = gradeUnit === 'hour' ? fmtHM(b.ts) : fmtDay(b.ts);
    const title = gradeUnit === 'hour' ? `${fmtDayHM(b.ts)} 시간대` : gradeUnit === 'day' ? fmtDate(b.ts) : `${fmtDay(b.ts)} ~ ${fmtDay(Math.min(win.to, b.ts + 7 * DAY - MIN))} (7일)`;
    return { ts: b.ts, label, title, counts, n: b.recs.length, minIdx };
  });

  let gradeMax = 0;
  gradeBuckets.forEach((b) => {
    if (b.n > gradeMax) gradeMax = b.n;
  });

  // 시간대별 시정 저하 (등급별)
  const h5 = hourCount(recs, (r) => visGrade(r.vis) === 1);
  const h1 = hourCount(recs, (r) => visGrade(r.vis) === 2);
  const h0 = hourCount(recs, (r) => visGrade(r.vis) === 3);
  const hourLow: [number, number, number][] = h5.map((v, h) => [v, h1[h], h0[h]]);
  const hourLowTotal = hourLow.map(([a, b, c]) => a + b + c);
  let peakHour: number | null = null;
  let peakHourCount = 0;
  let dawnLow = 0;
  hourLowTotal.forEach((c, h) => {
    if (c > peakHourCount) {
      peakHourCount = c;
      peakHour = h;
    }
    if (h >= DAWN_HOURS[0] && h <= DAWN_HOURS[1]) dawnLow += c;
  });

  return {
    total,
    unit,
    buckets,
    xs,
    values,
    lowCount,
    lowPct: pct(lowCount, total),
    minVis,
    minAt: minIdx >= 0 ? recs[minIdx].ts : 0,
    minIdx,
    lastVis: recs[total - 1]?.vis ?? NaN,
    lowRuns,
    lowRunTotalMs,
    longestRun,
    tsCount,
    tsReports,
    tsBands,
    under5Count,
    under1Count,
    fogCount,
    fgCount,
    brCount,
    gradeUnit,
    gradeBuckets,
    gradeYMax: countAxisMax(gradeMax),
    hourLow,
    hourLowTotal,
    hourYMax: countAxisMax(peakHourCount),
    peakHour,
    peakHourCount,
    dawnLow,
    dawnPct: pct(dawnLow, lowCount),
  };
}
