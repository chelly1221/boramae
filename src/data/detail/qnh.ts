import type { AtisRecord, TimeWindow } from '../types';
import { autoUnit, bucketize, bucketValues, dayBuckets, fmtDay, HOUR, hourProfile, max, mean, min, runs, type Bucket, type Unit } from './agg';

/*
 * QNH 상세 파생값 — 추이(자동 해상도), 일별 범위, 시간대별 편차(일변화), 3시간 변화율 급변 이벤트
 */

/** 3시간 변화율 급변 판정 기준 (hPa / 3h) */
export const QNH_JUMP_HPA = 3;

export interface QnhDaily {
  ts: number;
  label: string;
  mean: number;
  min: number;
  max: number;
  n: number;
}

export interface QnhJump {
  /** 구간 내 변화량 최대 레코드 인덱스 */
  index: number;
  ts: number;
  /** 3시간 전 대비 변화량 (hPa, +상승/−하강) */
  delta: number;
  from: number;
  to: number;
  /** 구간 시작/끝 (레코드 인덱스) */
  start: number;
  end: number;
}

export interface QnhDetail {
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  values: (number | null)[];
  avg: number;
  maxV: number;
  maxAt: number;
  minV: number;
  minAt: number;
  range: number;
  last: number;
  /** 시각별 3시간 변화량 (초기 3시간은 null) */
  delta3h: (number | null)[];
  maxJump: { delta: number; index: number } | null;
  jumps: QnhJump[];
  daily: QnhDaily[];
  /** UTC 시간대별 평균 − 전체 평균 (hPa) */
  hourAnomaly: (number | null)[];
}

export function computeQnhDetail(recs: AtisRecord[], win: TimeWindow): QnhDetail {
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  const values = bucketValues(buckets, (r) => r.qnh);
  const q = recs.map((r) => r.qnh);
  const avg = mean(q);
  const maxV = max(q);
  const minV = min(q);
  const maxI = q.indexOf(maxV);
  const minI = q.indexOf(minV);

  // 3시간 변화량: 각 레코드에서 3시간 이전(이하) 가장 최근 레코드와의 차
  const delta3h: (number | null)[] = [];
  let j = 0;
  recs.forEach((r, i) => {
    while (j < i && recs[j + 1].ts <= r.ts - 3 * HOUR) j++;
    delta3h.push(recs[j].ts <= r.ts - 3 * HOUR ? r.qnh - recs[j].qnh : null);
  });
  let maxJump: { delta: number; index: number } | null = null;
  delta3h.forEach((d, i) => {
    if (d != null && (!maxJump || Math.abs(d) > Math.abs(maxJump.delta))) maxJump = { delta: d, index: i };
  });
  // 급변 구간: |Δ3h| ≥ 기준 연속 구간 → 구간별 최대 1건
  const jumps: QnhJump[] = runs(recs, (_r, i) => delta3h[i] != null && Math.abs(delta3h[i] as number) >= QNH_JUMP_HPA).map((run) => {
    let best = run.start;
    for (let i = run.start; i <= run.end; i++) if (Math.abs(delta3h[i] as number) > Math.abs(delta3h[best] as number)) best = i;
    const d = delta3h[best] as number;
    return { index: best, ts: recs[best].ts, delta: d, from: recs[best].qnh - d, to: recs[best].qnh, start: run.start, end: run.end };
  });

  const daily: QnhDaily[] = dayBuckets(recs, win)
    .filter((b) => b.recs.length)
    .map((b) => {
      const v = b.recs.map((r) => r.qnh);
      return { ts: b.ts, label: fmtDay(b.ts), mean: mean(v), min: min(v), max: max(v), n: v.length };
    });

  const hourAnomaly = hourProfile(recs, (r) => r.qnh).map((v) => (v == null ? null : v - avg));

  return {
    unit,
    buckets,
    xs,
    values,
    avg,
    maxV,
    maxAt: recs[maxI]?.ts ?? 0,
    minV,
    minAt: recs[minI]?.ts ?? 0,
    range: maxV - minV,
    last: recs[recs.length - 1]?.qnh ?? NaN,
    delta3h,
    maxJump,
    jumps,
    daily,
    hourAnomaly,
  };
}
