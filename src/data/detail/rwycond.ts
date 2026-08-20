import { brakingRank } from '../stats';
import type { AtisRecord, RunwayCondition, TimeWindow } from '../types';
import { bucketize, DAY, fmtDate, fmtDay, fmtHM, HOUR, hourCount, niceTicks, pct, runs, type Bucket, type Unit } from './agg';

/*
 * 활주로 표면 상태 상세 파생값 — 보고 전문 수/비율, 버킷별 최저 RWYCC 추이, 활주로별 보고·최저 코드,
 * 오염 상태 키워드 빈도, 제동작용 등급 분포, 보고 구간(연속 보고 병합, 공백 3h 초과 시 분리), 보고 목록.
 * 정의는 통계 카드(stats.ts computeRwyCondCard)와 동일: 보고 전문 = rwyCond 1건 이상, 최저 RWYCC = 코드 중 최솟값.
 */

/** RWYCC 주의 기준 (이하) — 차트 임계선 */
export const RWYCC_CAUTION = 3;
/** RWYCC 위험 기준 (이하) */
export const RWYCC_DANGER = 1;
/** 보고 구간 병합 허용 공백 (ms) */
export const COND_RUN_GAP_MS = 3 * HOUR;

/** 오염 상태 키워드 (긴 것 먼저 — "WET SNOW"가 "WET"로도 세어지지 않게 별도 판정) */
export const CONTAM_KEYWORDS: { key: string; label: string; re: RegExp }[] = [
  { key: 'WET SNOW', label: '젖은 눈', re: /WET SNOW/ },
  { key: 'DRY SNOW', label: '마른 눈', re: /DRY SNOW/ },
  { key: 'COMPACTED SNOW', label: '다져진 눈', re: /COMPACTED SNOW/ },
  { key: 'DRIFTING SNOW', label: '날리는 눈', re: /DRIFTING SNOW/ },
  { key: 'SLUSH', label: '슬러시', re: /SLUSH/ },
  { key: 'ICE', label: '얼음', re: /\bICE\b/ },
  { key: 'FROST', label: '서리', re: /FROST/ },
  { key: 'STANDING WATER', label: '고인 물', re: /STANDING WATER/ },
  { key: 'WET', label: '젖음', re: /\bWET\b(?! SNOW)/ },
  { key: 'CHEMICALLY TREATED', label: '제설제 처리', re: /CHEMICALLY TREATED/ },
];

/** 보고 1건의 상태 문장 전체 (키워드 판정용) */
export function condText(c: RunwayCondition): string {
  return [c.note, ...c.parts, ...c.extra].join(' ').toUpperCase();
}

/** 보고 1건의 최저 코드 (코드 없으면 null) */
export const condMin = (c: RunwayCondition): number | null => (c.codes && c.codes.length ? Math.min(...c.codes) : null);

export const hasCond = (r: AtisRecord) => r.rwyCond.length > 0;

export interface CondTip {
  /** 버킷 최저 코드 (없으면 null) */
  code: number | null;
  /** 버킷 내 상태 보고 전문 수 */
  n: number;
  /** 최저 코드 보고 전문 인덱스 (코드 없으면 첫 보고 전문, 없으면 null) */
  index: number | null;
  summary: string;
}

export interface RwyRow {
  rwy: string;
  n: number;
  minCode: number | null;
  brakingN: number;
  /** 마지막 보고 전문 인덱스 */
  lastIdx: number | null;
}

export interface ContamRow {
  key: string;
  label: string;
  n: number;
  lastIdx: number | null;
}

export interface BrakingRow {
  grade: string;
  n: number;
  /** 보고 기체 (빈도순) */
  by: string[];
  lastIdx: number | null;
}

export interface CondRun {
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  n: number;
  /** 구간 최저 코드 (없으면 null) + 그 전문 인덱스 */
  minCode: number | null;
  minIdx: number | null;
  /** 구간에 등장한 활주로 */
  rwys: string[];
  /** 구간 최악 제동작용 */
  worstBraking: string | null;
}

export interface CondReportRow {
  index: number;
  ts: number;
  letter: string;
  cond: RunwayCondition;
}

export interface RwycondDetail {
  n: number;
  reportN: number;
  reportPct: number;
  /** 보고 건수 (전문 × 보고) */
  totalReports: number;
  minCode: number | null;
  minCodeRwy: string;
  minCodeIdx: number | null;
  minCodeTs: number | null;
  brakingN: number;
  worstBraking: string | null;
  last: CondReportRow | null;
  /* 메인 차트 */
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  values: (number | null)[];
  /** 고립 점 (앞뒤 결측) */
  isolated: (number | null)[];
  tips: CondTip[];
  /* 보조 */
  byRwy: RwyRow[];
  contam: ContamRow[];
  braking: BrakingRow[];
  hourN: number[];
  runs: CondRun[];
  longestRun: CondRun | null;
  reports: CondReportRow[];
}

/** 메인 차트 해상도 — 3일 이하 1시간, 그 외 1일 */
export function condUnit(win: TimeWindow): Unit {
  return win.to - win.from <= 3 * DAY ? 'hour' : 'day';
}

export function computeRwycondDetail(recs: AtisRecord[], win: TimeWindow): RwycondDetail {
  const n = recs.length;
  let reportN = 0;
  let totalReports = 0;
  let minCode: number | null = null;
  let minCodeRwy = '';
  let minCodeIdx: number | null = null;
  let brakingN = 0;
  let worstBraking: string | null = null;
  let last: CondReportRow | null = null;
  const rwyMap = new Map<string, RwyRow>();
  const contamMap = new Map<string, ContamRow>(CONTAM_KEYWORDS.map((k) => [k.key, { key: k.key, label: k.label, n: 0, lastIdx: null }]));
  const brakeMap = new Map<string, { n: number; by: Map<string, number>; lastIdx: number | null }>();
  const reports: CondReportRow[] = [];

  recs.forEach((r, i) => {
    if (!r.rwyCond.length) return;
    reportN++;
    totalReports += r.rwyCond.length;
    last = { index: i, ts: r.ts, letter: r.letter, cond: r.rwyCond[0] };
    const seenContam = new Set<string>();
    for (const c of r.rwyCond) {
      reports.push({ index: i, ts: r.ts, letter: r.letter, cond: c });
      const rwyKey = c.rwy || '미상';
      const row = rwyMap.get(rwyKey) ?? { rwy: rwyKey, n: 0, minCode: null, brakingN: 0, lastIdx: null };
      row.n++;
      row.lastIdx = i;
      const m = condMin(c);
      if (m != null) {
        if (row.minCode == null || m < row.minCode) row.minCode = m;
        if (minCode == null || m < minCode) {
          minCode = m;
          minCodeRwy = c.rwy;
          minCodeIdx = i;
        }
      }
      if (c.braking) {
        brakingN++;
        row.brakingN++;
        const grade = c.braking.toUpperCase();
        if (!worstBraking || brakingRank(grade) < brakingRank(worstBraking)) worstBraking = grade;
        const b = brakeMap.get(grade) ?? { n: 0, by: new Map<string, number>(), lastIdx: null };
        b.n++;
        b.lastIdx = i;
        if (c.reportedBy) b.by.set(c.reportedBy, (b.by.get(c.reportedBy) ?? 0) + 1);
        brakeMap.set(grade, b);
      }
      rwyMap.set(rwyKey, row);
      const txt = condText(c);
      for (const k of CONTAM_KEYWORDS) if (k.re.test(txt)) seenContam.add(k.key);
    }
    seenContam.forEach((k) => {
      const row = contamMap.get(k) as ContamRow;
      row.n++;
      row.lastIdx = i;
    });
  });

  /* 메인 차트 */
  const unit = condUnit(win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);
  const values: (number | null)[] = [];
  const tips: CondTip[] = [];
  buckets.forEach((b) => {
    let mn: number | null = null;
    let mnIdx: number | null = null;
    let cnt = 0;
    let firstIdx: number | null = null;
    let summary = '';
    b.recs.forEach((r, k) => {
      if (!r.rwyCond.length) return;
      cnt++;
      if (firstIdx == null) {
        firstIdx = b.idx[k];
        summary = r.rwyCond.map((c) => `${c.rwy ? `RWY${c.rwy} ` : ''}${c.codes ? c.codes.join('/') : c.braking ? `BA ${c.braking}` : c.extra[0] ?? ''}`).join(' · ');
      }
      for (const c of r.rwyCond) {
        const m = condMin(c);
        if (m != null && (mn == null || m < mn)) {
          mn = m;
          mnIdx = b.idx[k];
        }
      }
    });
    values.push(mn);
    tips.push({ code: mn, n: cnt, index: mnIdx ?? firstIdx, summary });
  });
  const isolated = values.map((v, i) => (v != null && values[i - 1] == null && values[i + 1] == null ? v : null));

  /* 보조 */
  const RWY_ORDER = ['14L', '14R', '32L', '32R', '미상'];
  const byRwy = [...rwyMap.values()].sort((a, b) => {
    const ia = RWY_ORDER.indexOf(a.rwy);
    const ib = RWY_ORDER.indexOf(b.rwy);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.rwy.localeCompare(b.rwy);
  });
  const contam = [...contamMap.values()].filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const braking: BrakingRow[] = [...brakeMap.entries()]
    .map(([grade, b]) => ({ grade, n: b.n, by: [...b.by.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k), lastIdx: b.lastIdx }))
    .sort((a, b) => brakingRank(a.grade) - brakingRank(b.grade));
  const hourN = hourCount(recs, hasCond);

  const condRuns: CondRun[] = runs(recs, hasCond, COND_RUN_GAP_MS).map((run) => {
    let mn: number | null = null;
    let mnIdx: number | null = null;
    const rwys: string[] = [];
    let worst: string | null = null;
    for (let i = run.start; i <= run.end; i++) {
      for (const c of recs[i].rwyCond) {
        const m = condMin(c);
        if (m != null && (mn == null || m < mn)) {
          mn = m;
          mnIdx = i;
        }
        if (c.rwy && !rwys.includes(c.rwy)) rwys.push(c.rwy);
        if (c.braking && (!worst || brakingRank(c.braking) < brakingRank(worst))) worst = c.braking.toUpperCase();
      }
    }
    return { start: run.start, end: run.end, startTs: run.startTs, endTs: run.endTs, durMs: run.durMs, n: run.end - run.start + 1, minCode: mn, minIdx: mnIdx, rwys, worstBraking: worst };
  });
  let longestRun: CondRun | null = null;
  for (const r of condRuns) if (!longestRun || r.durMs > longestRun.durMs) longestRun = r;

  return {
    n,
    reportN,
    reportPct: pct(reportN, n),
    totalReports,
    minCode,
    minCodeRwy,
    minCodeIdx,
    minCodeTs: minCodeIdx != null ? recs[minCodeIdx].ts : null,
    brakingN,
    worstBraking,
    last,
    unit,
    buckets,
    xs,
    values,
    isolated,
    tips,
    byRwy,
    contam,
    braking,
    hourN,
    runs: condRuns,
    longestRun,
    reports,
  };
}

/** 버킷 툴팁 제목 */
export function condBucketTitle(ts: number, unit: Unit): string {
  return unit === 'day' ? fmtDate(ts) : `${fmtDay(ts)} ${fmtHM(ts)} ~ ${fmtHM(ts + HOUR)}`;
}

/** 건수 막대 y 상한 — 정수 눈금이 나오고 최상단 눈금이 축 단위 표기와 겹치지 않을 만큼 여유를 둔다 (vis/tags와 동일 규칙) */
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
