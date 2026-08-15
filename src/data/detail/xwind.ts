import type { AtisRecord, Runway, TimeWindow } from '../types';
import { autoUnit, bucketize, bucketValues, DAY, dayBuckets, fmtDay, hourCount, hourProfile, MIN, pct, runs, type Bucket, type Unit } from './agg';

/*
 * 측풍/배풍 상세 파생값 — 사용 활주로 기준 성분(AtisRecord.xw / tw)의 추이·한계 초과 이벤트·일별/시간대별 집계·활주로별 요약.
 * 한계 초과 판정은 통계 카드(stats.ts)와 동일: xw > xwLimit (기본 15KT). 배풍 기준은 TW_LIMIT_KT (5KT).
 */

/** 배풍 성분 주의 기준 (KT) — 초과(tw > 5) 건수 집계에 사용 */
export const TW_LIMIT_KT = 5;

/** 한계 초과 이벤트 (연속 구간 병합) */
export interface XwEvent {
  /** 구간 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  /** 끝 레코드 − 시작 레코드 (한 건이면 0) */
  durMs: number;
  /** 구간 레코드 수 */
  n: number;
  /** 구간 내 최대 측풍 레코드 인덱스·값 */
  peakIndex: number;
  peakXw: number;
  peakTw: number;
  peakRwy: Runway;
  peakWind: string;
  /** 차트 밴드용 종료 시각 — 다음 전문 시각(없으면 끝+30분) */
  bandTo: number;
}

/** 배풍 기준 초과 구간 (tw > TW_LIMIT_KT) */
export interface TwEvent {
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  n: number;
  peakIndex: number;
  peakTw: number;
  peakXw: number;
  peakRwy: Runway;
  peakWind: string;
}

/** 일별(또는 짧은 창에서는 시간별) 최대 측풍 */
export interface XwBucketStat {
  ts: number;
  label: string;
  /** 구간 최대 측풍 (KT), 레코드 없으면 null */
  maxXw: number | null;
  maxTw: number | null;
  meanXw: number | null;
  /** 한계 초과 건수 */
  exceed: number;
  n: number;
  /** 최대 측풍 레코드 인덱스 (원문 열기) */
  peakIndex: number | null;
}

/** 활주로별 요약 */
export interface RwyXwSummary {
  rwy: Runway;
  n: number;
  pct: number;
  meanXw: number;
  maxXw: number;
  maxXwIndex: number;
  exceed: number;
  meanTw: number;
  maxTw: number;
  maxTwIndex: number;
  twOver: number;
}

export interface XwindDetail {
  xwLimit: number;
  twLimit: number;
  n: number;
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  /** 버킷 대표값 — raw면 그대로, 집계 시 구간 최대 */
  xwValues: (number | null)[];
  twValues: (number | null)[];
  /** 버킷별 최대 측풍 레코드 인덱스 (빈 버킷은 null) — 점 클릭 → 원문, 툴팁 활주로·바람 표시용 */
  xwPeakIdx: (number | null)[];
  // 타일
  maxXw: number;
  maxXwIndex: number;
  maxTw: number;
  maxTwIndex: number;
  avgXw: number;
  avgTw: number;
  exceedCount: number;
  exceedPct: number;
  twOverCount: number;
  twOverPct: number;
  /** 마지막 전문 측풍/배풍 */
  lastXw: number;
  lastTw: number;
  // 이벤트
  events: XwEvent[];
  eventsTotalMs: number;
  twEvents: TwEvent[];
  // 보조
  /** 일별(창 ≤ 2일이면 시간별) 최대 측풍 */
  daily: XwBucketStat[];
  dailyUnit: 'hour' | 'day';
  /** UTC 시간대별 평균 측풍 */
  hourMeanXw: (number | null)[];
  hourMaxXw: (number | null)[];
  hourExceed: number[];
  /** hourExceed 최대값 (막대 농도 스케일용) */
  hourExceedMax: number;
  hourN: number[];
  byRwy: RwyXwSummary[];
}

const RWYS: Runway[] = ['32L/32R', '14L/14R'];

/** 시간 버킷 라벨 "HH" (UTC) */
const hourLabel = (ts: number) => String(new Date(ts).getUTCHours()).padStart(2, '0');

function maxLoop(recs: AtisRecord[], pick: (r: AtisRecord) => number): { v: number; i: number } {
  let v = -Infinity;
  let idx = -1;
  for (let i = 0; i < recs.length; i++) {
    const x = pick(recs[i]);
    if (x > v) {
      v = x;
      idx = i;
    }
  }
  return { v: idx < 0 ? NaN : v, i: idx };
}

/** 구간 내 pick 최대 레코드의 (원본 recs 기준) 인덱스 */
function peakIn(recs: AtisRecord[], start: number, end: number, pick: (r: AtisRecord) => number): number {
  let best = start;
  for (let i = start + 1; i <= end; i++) if (pick(recs[i]) > pick(recs[best])) best = i;
  return best;
}

export function computeXwindDetail(recs: AtisRecord[], win: TimeWindow, xwLimit: number): XwindDetail {
  const n = recs.length;
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  const bucketMax = (xsv: number[]) => {
    let m = -Infinity;
    for (const v of xsv) if (v > m) m = v;
    return m;
  };
  const xwValues = bucketValues(buckets, (r) => r.xw, bucketMax);
  const twValues = bucketValues(buckets, (r) => r.tw, bucketMax);
  const xwPeakIdx: (number | null)[] = buckets.map((b) => {
    if (!b.recs.length) return null;
    let pk = b.idx[0];
    let m = b.recs[0].xw;
    for (let k = 1; k < b.recs.length; k++) {
      if (b.recs[k].xw > m) {
        m = b.recs[k].xw;
        pk = b.idx[k];
      }
    }
    return pk;
  });

  // 전체 통계 (대형 배열 스프레드 회피 — 루프)
  let sumXw = 0;
  let sumTw = 0;
  let exceedCount = 0;
  let twOverCount = 0;
  for (const r of recs) {
    sumXw += r.xw;
    sumTw += r.tw;
    if (r.xw > xwLimit) exceedCount++;
    if (r.tw > TW_LIMIT_KT) twOverCount++;
  }
  const mx = maxLoop(recs, (r) => r.xw);
  const mt = maxLoop(recs, (r) => r.tw);

  // 한계 초과 이벤트 (연속 구간 병합)
  const events: XwEvent[] = runs(recs, (r) => r.xw > xwLimit).map((run) => {
    const pk = peakIn(recs, run.start, run.end, (r) => r.xw);
    const next = recs[run.end + 1];
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
      peakIndex: pk,
      peakXw: recs[pk].xw,
      peakTw: recs[pk].tw,
      peakRwy: recs[pk].rwy,
      peakWind: recs[pk].wind,
      bandTo: next ? next.ts : run.endTs + 30 * MIN,
    };
  });
  let eventsTotalMs = 0;
  for (const e of events) eventsTotalMs += e.durMs;

  const twEvents: TwEvent[] = runs(recs, (r) => r.tw > TW_LIMIT_KT).map((run) => {
    const pk = peakIn(recs, run.start, run.end, (r) => r.tw);
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
      peakIndex: pk,
      peakTw: recs[pk].tw,
      peakXw: recs[pk].xw,
      peakRwy: recs[pk].rwy,
      peakWind: recs[pk].wind,
    };
  });

  // 일별(짧은 창은 시간별) 최대 측풍
  const dailyUnit: 'hour' | 'day' = win.to - win.from <= 2 * DAY ? 'hour' : 'day';
  const dBuckets = dailyUnit === 'day' ? dayBuckets(recs, win) : bucketize(recs, 'hour', win);
  const daily: XwBucketStat[] = dBuckets.map((b) => {
    if (!b.recs.length) return { ts: b.ts, label: dailyUnit === 'day' ? fmtDay(b.ts) : hourLabel(b.ts), maxXw: null, maxTw: null, meanXw: null, exceed: 0, n: 0, peakIndex: null };
    let mxw = -Infinity;
    let mtw = -Infinity;
    let sx = 0;
    let ex = 0;
    let pk = b.idx[0];
    b.recs.forEach((r, k) => {
      if (r.xw > mxw) {
        mxw = r.xw;
        pk = b.idx[k];
      }
      if (r.tw > mtw) mtw = r.tw;
      sx += r.xw;
      if (r.xw > xwLimit) ex++;
    });
    return {
      ts: b.ts,
      label: dailyUnit === 'day' ? fmtDay(b.ts) : hourLabel(b.ts),
      maxXw: mxw,
      maxTw: mtw,
      meanXw: sx / b.recs.length,
      exceed: ex,
      n: b.recs.length,
      peakIndex: pk,
    };
  });

  // 시간대별 프로파일
  const hourMeanXw = hourProfile(recs, (r) => r.xw);
  const hourMaxXw = hourProfile(recs, (r) => r.xw, bucketMax);
  const hourExceed = hourCount(recs, (r) => r.xw > xwLimit);
  let hourExceedMax = 0;
  for (const c of hourExceed) if (c > hourExceedMax) hourExceedMax = c;
  const hourN = hourCount(recs, () => true);

  // 활주로별 요약
  const byRwy: RwyXwSummary[] = RWYS.map((rwy) => {
    let cnt = 0;
    let sx = 0;
    let st = 0;
    let mxw = -Infinity;
    let mxi = -1;
    let mtw = -Infinity;
    let mti = -1;
    let ex = 0;
    let tover = 0;
    for (let i = 0; i < n; i++) {
      const r = recs[i];
      if (r.rwy !== rwy) continue;
      cnt++;
      sx += r.xw;
      st += r.tw;
      if (r.xw > mxw) {
        mxw = r.xw;
        mxi = i;
      }
      if (r.tw > mtw) {
        mtw = r.tw;
        mti = i;
      }
      if (r.xw > xwLimit) ex++;
      if (r.tw > TW_LIMIT_KT) tover++;
    }
    return {
      rwy,
      n: cnt,
      pct: pct(cnt, n),
      meanXw: cnt ? sx / cnt : NaN,
      maxXw: cnt ? mxw : NaN,
      maxXwIndex: mxi,
      exceed: ex,
      meanTw: cnt ? st / cnt : NaN,
      maxTw: cnt ? mtw : NaN,
      maxTwIndex: mti,
      twOver: tover,
    };
  });

  const last = recs[n - 1];
  return {
    xwLimit,
    twLimit: TW_LIMIT_KT,
    n,
    unit,
    buckets,
    xs,
    xwValues,
    twValues,
    xwPeakIdx,
    maxXw: mx.v,
    maxXwIndex: mx.i,
    maxTw: mt.v,
    maxTwIndex: mt.i,
    avgXw: n ? sumXw / n : NaN,
    avgTw: n ? sumTw / n : NaN,
    exceedCount,
    exceedPct: pct(exceedCount, n),
    twOverCount,
    twOverPct: pct(twOverCount, n),
    lastXw: last?.xw ?? NaN,
    lastTw: last?.tw ?? NaN,
    events,
    eventsTotalMs,
    twEvents,
    daily,
    dailyUnit,
    hourMeanXw,
    hourMaxXw,
    hourExceed,
    hourExceedMax,
    hourN,
    byRwy,
  };
}
