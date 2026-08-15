import type { AtisRecord, TimeWindow } from '../types';
import { autoUnit, bucketize, bucketValues, dayBuckets, fmtDay, HOUR, hourCount, hourProfile, MIN, mean, runs, UNIT_MS, type Bucket, type Unit } from './agg';

/*
 * 온도/노점 상세 파생값 — 기온·노점 추이(자동 해상도), 스프레드(기온−노점) 추이, 안개 위험 구간(스프레드 ≤ 2°C, 카드의 fogRisk와 동일 기준),
 * 일별 최고/최저, UTC 시간대별 평균 프로파일
 */

/** 안개 위험 판정 스프레드 기준 (°C) — stats.ts `fogRisk = spreadMin <= 2`와 동일 */
export const FOG_SPREAD_C = 2;

/** 마지막 전문으로 끝나는 구간의 유효 지속 시간 가정 (다음 전문이 없을 때, 정기 발행 간격) */
const FALLBACK_VALID_MS = 30 * MIN;
/** 전문 1건의 최대 유효 시간 — 다음 전문까지 공백이 이보다 길면(수신 결측 등) 구간 종료를 여기서 자른다 */
const MAX_VALID_MS = 60 * MIN;

export const spreadOf = (r: AtisRecord) => r.t - r.dp;
export const isFogRisk = (r: AtisRecord) => spreadOf(r) <= FOG_SPREAD_C;

export interface TempDaily {
  ts: number;
  label: string;
  tMax: number;
  tMin: number;
  tMean: number;
  dpMean: number;
  spreadMin: number;
  /** 최고 기온 / 최소 스프레드 레코드 인덱스 (원본 recs 기준, 막대 클릭 → 원문) */
  tMaxIndex: number;
  spreadMinIndex: number;
  /** 안개 위험(스프레드 ≤ 기준) 전문이 있었던 UTC 시간대 수 */
  fogHours: number;
  n: number;
}

export interface FogEvent {
  /** 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  /** 유효 지속 시간 — 다음 전문 발행 시각(최대 +1시간, 없으면 창 끝 또는 +30분) − 시작 시각 */
  durMs: number;
  /** 밴드 종료 시각 (= startTs + durMs) */
  untilTs: number;
  n: number;
  spreadMin: number;
  /** 최소 스프레드 레코드 인덱스 */
  spreadMinIndex: number;
  tAt: number;
  dpAt: number;
  /** 구간 최저 시정 (km) 및 표기 */
  visMin: number;
  visTxt: string;
  /** 구간에서 보고된 태그 (중복 제거) */
  tags: string[];
}

export interface TempDetail {
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  tVals: (number | null)[];
  dpVals: (number | null)[];
  /** 버킷 스프레드 — raw면 값, 집계면 버킷 내 최소 */
  spVals: (number | null)[];
  tAvg: number;
  tMax: number;
  tMaxAt: number;
  tMin: number;
  tMinAt: number;
  dpAvg: number;
  dpMin: number;
  spreadMin: number;
  spreadMinAt: number;
  spreadAvg: number;
  spreadNow: number;
  lastTs: number;
  /** 카드와 동일: spreadMin ≤ 기준 */
  fogRisk: boolean;
  fogCount: number;
  fogPct: number;
  /** 안개 위험 전문이 있었던 UTC 시간대 수 (기간 전체) */
  fogHours: number;
  fogTotalMs: number;
  fogEvents: FogEvent[];
  /** 안개 위험 밴드 — raw: 이벤트 구간, hour/day: 위험 전문 포함 버킷 병합 */
  bands: { from: number; to: number }[];
  daily: TempDaily[];
  hourT: (number | null)[];
  hourDp: (number | null)[];
  hourSpread: (number | null)[];
  hourFog: number[];
  /** UTC 시간대별 전문 수 */
  hourN: number[];
}

/** 소형 배열 최소값 (스프레드 없이 루프) */
function minLoop(xs: number[]): number {
  let m = Infinity;
  for (const v of xs) if (v < m) m = v;
  return Number.isFinite(m) ? m : NaN;
}

export function computeTempDetail(recs: AtisRecord[], win: TimeWindow): TempDetail {
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  const tVals = bucketValues(buckets, (r) => r.t);
  const dpVals = bucketValues(buckets, (r) => r.dp);
  const spVals = bucketValues(buckets, spreadOf, unit === 'raw' ? mean : minLoop);

  // 기본 통계 (O(n) 루프 — 대형 배열 안전)
  let tSum = 0;
  let dpSum = 0;
  let spSum = 0;
  let tMax = -Infinity;
  let tMin = Infinity;
  let dpMin = Infinity;
  let spreadMin = Infinity;
  let tMaxI = -1;
  let tMinI = -1;
  let spreadMinI = -1;
  let fogCount = 0;
  const fogHourSet = new Set<number>();
  recs.forEach((r, i) => {
    const sp = spreadOf(r);
    tSum += r.t;
    dpSum += r.dp;
    spSum += sp;
    if (r.t > tMax) {
      tMax = r.t;
      tMaxI = i;
    }
    if (r.t < tMin) {
      tMin = r.t;
      tMinI = i;
    }
    if (r.dp < dpMin) dpMin = r.dp;
    if (sp < spreadMin) {
      spreadMin = sp;
      spreadMinI = i;
    }
    if (sp <= FOG_SPREAD_C) {
      fogCount++;
      fogHourSet.add(Math.floor(r.ts / HOUR));
    }
  });
  const n = recs.length;
  const last = recs[n - 1];

  // 안개 위험 구간 (연속 전문 병합). 유효 종료 = 다음 전문 발행 시각 (수신 공백이 길면 최대 +1시간까지만)
  const fogEvents: FogEvent[] = runs(recs, isFogRisk).map((run) => {
    let best = run.start;
    let visMin = Infinity;
    let visI = run.start;
    const tagSet = new Set<string>();
    for (let i = run.start; i <= run.end; i++) {
      const r = recs[i];
      if (spreadOf(r) < spreadOf(recs[best])) best = i;
      if (r.vis < visMin) {
        visMin = r.vis;
        visI = i;
      }
      r.tags.forEach((t) => tagSet.add(t));
    }
    const next = recs[run.end + 1];
    const untilTs = Math.max(run.endTs, next ? Math.min(next.ts, run.endTs + MAX_VALID_MS) : Math.min(win.to, run.endTs + FALLBACK_VALID_MS));
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: untilTs - run.startTs,
      untilTs,
      n: run.end - run.start + 1,
      spreadMin: spreadOf(recs[best]),
      spreadMinIndex: best,
      tAt: recs[best].t,
      dpAt: recs[best].dp,
      visMin,
      visTxt: recs[visI].visTxt,
      tags: [...tagSet],
    };
  });
  // 차트 밴드: 원본 해상도면 이벤트 구간 그대로, 집계 해상도면 안개 위험 전문이 포함된 버킷을 연속 병합 (줄무늬 과밀 방지)
  let bands: { from: number; to: number }[];
  if (unit === 'raw') bands = fogEvents.map((e) => ({ from: e.startTs, to: e.untilTs }));
  else {
    const ms = UNIT_MS[unit];
    bands = [];
    buckets.forEach((b) => {
      if (!b.recs.some(isFogRisk)) return;
      const prev = bands[bands.length - 1];
      if (prev && prev.to === b.ts) prev.to = b.ts + ms;
      else bands.push({ from: b.ts, to: b.ts + ms });
    });
  }
  const fogTotalMs = fogEvents.reduce((a, e) => a + e.durMs, 0);

  // 일별 집계
  const daily: TempDaily[] = dayBuckets(recs, win)
    .filter((b) => b.recs.length)
    .map((b) => {
      let mx = -Infinity;
      let mn = Infinity;
      let ts = 0;
      let dps = 0;
      let spMin = Infinity;
      let mxI = b.idx[0];
      let spI = b.idx[0];
      const hours = new Set<number>();
      b.recs.forEach((r, j) => {
        const sp = spreadOf(r);
        if (r.t > mx) {
          mx = r.t;
          mxI = b.idx[j];
        }
        if (r.t < mn) mn = r.t;
        ts += r.t;
        dps += r.dp;
        if (sp < spMin) {
          spMin = sp;
          spI = b.idx[j];
        }
        if (sp <= FOG_SPREAD_C) hours.add(r.hour);
      });
      const k = b.recs.length;
      return { ts: b.ts, label: fmtDay(b.ts), tMax: mx, tMin: mn, tMean: ts / k, dpMean: dps / k, spreadMin: spMin, tMaxIndex: mxI, spreadMinIndex: spI, fogHours: hours.size, n: k };
    });

  return {
    unit,
    buckets,
    xs,
    tVals,
    dpVals,
    spVals,
    tAvg: n ? tSum / n : NaN,
    tMax: n ? tMax : NaN,
    tMaxAt: recs[tMaxI]?.ts ?? 0,
    tMin: n ? tMin : NaN,
    tMinAt: recs[tMinI]?.ts ?? 0,
    dpAvg: n ? dpSum / n : NaN,
    dpMin: n ? dpMin : NaN,
    spreadMin: n ? spreadMin : NaN,
    spreadMinAt: recs[spreadMinI]?.ts ?? 0,
    spreadAvg: n ? spSum / n : NaN,
    spreadNow: last ? spreadOf(last) : NaN,
    lastTs: last?.ts ?? 0,
    fogRisk: n > 0 && spreadMin <= FOG_SPREAD_C,
    fogCount,
    fogPct: n ? Math.round((fogCount / n) * 100) : 0,
    fogHours: fogHourSet.size,
    fogTotalMs,
    fogEvents,
    bands,
    daily,
    hourT: hourProfile(recs, (r) => r.t),
    hourDp: hourProfile(recs, (r) => r.dp),
    hourSpread: hourProfile(recs, spreadOf),
    hourFog: hourCount(recs, isFogRisk),
    hourN: hourCount(recs, () => true),
  };
}
