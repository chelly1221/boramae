import { sectorPath } from '../stats';
import type { AtisRecord, TimeWindow } from '../types';
import { autoUnit, bucketize, bucketValues, DIR16, DIR8, dir16, hourProfile, meanDir, MIN, niceTicks, pct, runs, UNIT_MS, type Bucket, type Unit } from './agg';

/*
 * 바람 상세 파생값 — 풍속/풍향 추이(자동 해상도), 바람장미(8방위 × 3속도), 16방위 빈도,
 * 시간대별 평균 풍속, 풍속 등급 분포, 강풍(≥15KT) 연속 구간 이벤트.
 * 바람장미 구간(<8 / 8–13 / ≥14KT)·주풍향 정의는 통계 카드(stats.ts computeStats)와 동일.
 */

/** 정온 판정 (KT 이하) */
export const CALM_KT = 3;
/** 강풍 판정 (KT 이상) */
export const STRONG_KT = 15;
/** 강풍 구간 밴드 여유 — 전문 1건짜리 구간도 차트에 보이도록 앞뒤로 넓힘 (ms) */
export const EVENT_PAD_MS = 15 * MIN;
/** 차트에 강풍 띠를 그리는 최대 구간 수 — 이보다 많으면(장기간) 띠가 노이즈가 되므로 생략하고 표로 안내 */
export const MAX_BANDS = 60;

/** 풍속 등급 (카드 바람장미 구간을 더 세분) */
export const SPEED_CLASSES: { label: string; lo: number; hi: number; color: string; desc: string }[] = [
  { label: '≤3', lo: 0, hi: 3, color: '#5b8bc9', desc: '정온' },
  { label: '4–7', lo: 4, hi: 7, color: '#4aa88c', desc: '약풍' },
  { label: '8–13', lo: 8, hi: 13, color: '#8fb84e', desc: '보통' },
  { label: '14–19', lo: 14, hi: 19, color: '#e08a35', desc: '강풍' },
  { label: '≥20', lo: 20, hi: Infinity, color: '#c8422e', desc: '매우 강함' },
];

/** 바람장미 속도 구간 (카드와 동일) */
export const ROSE_BINS = [
  { label: '< 8KT', color: 'rgba(127,13,0,0.28)' },
  { label: '8–13KT', color: 'rgba(127,13,0,0.58)' },
  { label: '≥ 14KT', color: '#7f0d00' },
];

export interface StrongWindEvent {
  /** 구간 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  /** 구간 내 전문 수 */
  count: number;
  /** 구간 내 최대 풍속과 그 시각·풍향·레코드 인덱스 */
  maxSpd: number;
  maxIndex: number;
  maxTs: number;
  maxDir: number;
  /** 구간 내 벡터 평균 풍향 */
  meanDir: number;
}

export interface DirFreq {
  label: string;
  count: number;
  pct: number;
  /** 해당 방위 평균 풍속 (없으면 NaN) */
  avgSpd: number;
}

export interface SpeedClass {
  label: string;
  desc: string;
  color: string;
  count: number;
  pct: number;
}

export interface WindDetail {
  n: number;
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  /** 버킷 평균 풍속 */
  spd: (number | null)[];
  /** 버킷 최대 풍속 (raw면 spd와 동일) */
  spdMax: (number | null)[];
  /** 버킷 벡터 평균 풍향 (0–360) */
  dir: (number | null)[];
  /** dir / 90 — 풍향 차트 y축을 0·90·180·270·360°(N/E/S/W/N) 눈금으로 그리기 위한 값 (niceTicks 우회) */
  dirQ: (number | null)[];
  /** 풍속 차트 y 상한 (강풍선·최대치 여유, 최상단 눈금이 단위 라벨과 겹치지 않게 조정) */
  yMaxSpd: number;
  avgSpd: number;
  maxSpd: number;
  maxAt: number;
  maxDir: number;
  maxIndex: number;
  /** 카드와 동일한 8방위 × 3속도 구간 도넛 섹터 path */
  roseD: [string, string, string];
  /** 8방위별 건수 (N,NE,…,NW) */
  rose8: number[];
  domDir: string;
  domPct: number;
  /** 벡터 평균 풍향 (도) */
  vecDir: number;
  calmCount: number;
  calmPct: number;
  strongCount: number;
  strongPct: number;
  events: StrongWindEvent[];
  /**
   * 차트용 강풍 띠 — 이벤트를 ±EVENT_PAD_MS 넓힌 뒤 창 안으로 자르고, 해상도(버킷) 이하 간격으로 붙은 구간은 병합.
   * (hour/day 해상도에서는 같은 버킷 안 여러 이벤트가 하나의 띠)
   */
  bands: { from: number; to: number }[];
  /** 16방위 빈도 */
  dir16: DirFreq[];
  /** UTC 시간대별 평균 풍속 */
  hourSpd: (number | null)[];
  /** UTC 시간대별 최대 풍속 */
  hourMax: (number | null)[];
  classes: SpeedClass[];
  /** 기간 마지막 전문 바람 ("DDD/SSKT") */
  last: string;
  lastIndex: number;
}

/**
 * 차트 y 상한 보정 — 최상단 눈금이 상한의 90%를 넘으면(눈금 라벨이 단위 라벨과 겹침) 상한을 올린다.
 * TimeSeriesChart/BarChart의 자동 상한은 최대치 바로 위에 눈금이 오는 경우가 있어 패널에서 명시한다.
 */
export function chartYMax(hi: number, tickCount = 4): number {
  let y = hi > 0 ? hi : 1;
  for (let k = 0; k < 3; k++) {
    const t = niceTicks(0, y, tickCount);
    const top = t[t.length - 1] ?? 0;
    if (top <= y * 0.9) break;
    y = top / 0.88;
  }
  return y;
}

const maxOf = (xs: number[]) => {
  let m = -Infinity;
  for (const v of xs) if (v > m) m = v;
  return Number.isFinite(m) ? m : NaN;
};

export function computeWindDetail(recs: AtisRecord[], win: TimeWindow): WindDetail {
  const n = recs.length;
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  const spd = bucketValues(buckets, (r) => r.spd);
  const spdMax = unit === 'raw' ? spd : bucketValues(buckets, (r) => r.spd, maxOf);
  const dir = bucketValues(buckets, (r) => r.dir, meanDir);
  const dirQ = dir.map((v) => (v == null ? null : v / 90));

  // 전체 통계 (O(n) 루프 — 대형 배열 스프레드 금지)
  let sumSpd = 0;
  let maxSpd = -Infinity;
  let maxIndex = -1;
  let calmCount = 0;
  let strongCount = 0;
  let sx = 0;
  let sy = 0;
  const rose: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);
  const c16 = Array(16).fill(0) as number[];
  const s16 = Array(16).fill(0) as number[];
  const cls = SPEED_CLASSES.map(() => 0);
  recs.forEach((r, i) => {
    sumSpd += r.spd;
    if (r.spd > maxSpd) {
      maxSpd = r.spd;
      maxIndex = i;
    }
    if (r.spd <= CALM_KT) calmCount++;
    if (r.spd >= STRONG_KT) strongCount++;
    const rad = (r.dir * Math.PI) / 180;
    sx += Math.sin(rad);
    sy += Math.cos(rad);
    // 바람장미: 카드(stats.ts)와 동일 구간
    const d8 = Math.round(r.dir / 45) % 8;
    rose[d8][r.spd < 8 ? 0 : r.spd < 14 ? 1 : 2]++;
    const d16 = Math.round(r.dir / 22.5) % 16;
    c16[d16]++;
    s16[d16] += r.spd;
    const ci = SPEED_CLASSES.findIndex((c) => r.spd <= c.hi);
    cls[ci < 0 ? cls.length - 1 : ci]++;
  });

  // 바람장미 path (stats.ts computeStats와 동일 기하)
  const rose8 = rose.map((a) => a[0] + a[1] + a[2]);
  const maxT = maxOf(rose8);
  const roseD: [string, string, string] = ['', '', ''];
  rose.forEach((bins, i) => {
    const tot = rose8[i];
    if (!tot || !maxT) return;
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
  const domI = n ? rose8.indexOf(maxT) : -1;

  // 강풍 연속 구간
  const events: StrongWindEvent[] = runs(recs, (r) => r.spd >= STRONG_KT).map((run) => {
    let best = run.start;
    for (let i = run.start; i <= run.end; i++) if (recs[i].spd > recs[best].spd) best = i;
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      count: run.end - run.start + 1,
      maxSpd: recs[best].spd,
      maxIndex: best,
      maxTs: recs[best].ts,
      maxDir: recs[best].dir,
      meanDir: meanDir(run.recs.map((r) => r.dir)),
    };
  });

  // 강풍 띠: 이벤트 ±여유 → 창 안으로 자름 → 해상도 이하 간격 병합
  const bands: { from: number; to: number }[] = [];
  const mergeGap = UNIT_MS[unit];
  for (const e of events) {
    const from = Math.max(win.from, e.startTs - EVENT_PAD_MS);
    const to = Math.min(win.to, e.endTs + EVENT_PAD_MS);
    if (to < from) continue;
    const prev = bands[bands.length - 1];
    if (prev && from - prev.to <= mergeGap) prev.to = Math.max(prev.to, to);
    else bands.push({ from, to });
  }

  // 풍속 차트 y 상한: 최대치/강풍선 위 여유 (최상단 눈금이 단위 라벨과 겹치지 않게)
  const yMaxSpd = chartYMax(Math.max(STRONG_KT + 3, (n ? maxSpd : 0) + 3), 5);

  const dir16Freq: DirFreq[] = DIR16.map((label, i) => ({ label, count: c16[i], pct: pct(c16[i], n), avgSpd: c16[i] ? s16[i] / c16[i] : NaN }));
  const classes: SpeedClass[] = SPEED_CLASSES.map((c, i) => ({ label: c.label, desc: c.desc, color: c.color, count: cls[i], pct: pct(cls[i], n) }));

  return {
    n,
    unit,
    buckets,
    xs,
    spd,
    spdMax,
    dir,
    dirQ,
    yMaxSpd,
    avgSpd: n ? sumSpd / n : NaN,
    maxSpd: n ? maxSpd : NaN,
    maxAt: recs[maxIndex]?.ts ?? 0,
    maxDir: recs[maxIndex]?.dir ?? NaN,
    maxIndex,
    roseD: [roseD[0].trim(), roseD[1].trim(), roseD[2].trim()],
    rose8,
    domDir: domI >= 0 ? DIR8[domI] : '—',
    domPct: pct(maxT || 0, n),
    vecDir: n ? ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360 : NaN,
    calmCount,
    calmPct: pct(calmCount, n),
    strongCount,
    strongPct: pct(strongCount, n),
    events,
    bands,
    dir16: dir16Freq,
    hourSpd: hourProfile(recs, (r) => r.spd),
    hourMax: hourProfile(recs, (r) => r.spd, maxOf),
    classes,
    last: recs[n - 1]?.wind ?? '—',
    lastIndex: n - 1,
  };
}

/** 풍향(도) → "225° SW" 표기 (북풍은 항공 관례대로 360°) */
export function fmtDir(d: number): string {
  if (!Number.isFinite(d)) return '—';
  const deg = Math.round(d) % 360 || 360;
  return `${String(deg).padStart(3, '0')}° ${dir16(d)}`;
}

/** 시간대별 프로파일에서 최대/최소 시각 인덱스 (null 제외) */
export function argMax(xs: (number | null)[]): number {
  let bi = -1;
  xs.forEach((v, i) => {
    if (v != null && (bi < 0 || v > (xs[bi] as number))) bi = i;
  });
  return bi;
}
