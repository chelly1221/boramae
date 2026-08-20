import { appColor } from '../stats';
import type { AtisRecord, TimeWindow } from '../types';
import { autoUnit, bucketize, dayBuckets, daysIn, fmtDay, fmtHM, hourCount, MIN, runs, type Bucket, type Unit } from './agg';

/*
 * 구름 / 접근방식 상세 파생값 — 실링 추이(자동 해상도), 운량 구성·접근방식 비율(일별/시간별), 시간대별 CAVOK 비율,
 * 저실링 이벤트 구간. 카드(stats.ts)와 정의 일치: CAVOK = cloud === 'CAVOK', BKN 이상 = ceil != null.
 * 접근방식은 전문에 기재된 명칭(appName: "ILS" / "ILS Z" / …) 기준으로 기간 내 등장한 것만 동적으로 집계한다 (ILS는 항상 포함).
 */

/** 저실링 판정 기준 (FT) — 이하가 아닌 미만 */
export const LOW_CEIL_FT = 1000;
/** 매우 낮은 실링 (FT) — 차트 위험 임계선 */
export const VERY_LOW_CEIL_FT = 500;

/** 접근 명칭 목록 (건수 내림차순, ILS 항상 첫 번째) */
export function appNamesOf(recs: AtisRecord[]): string[] {
  const cnt = new Map<string, number>([['ILS', 0]]);
  recs.forEach((r) => cnt.set(r.appName, (cnt.get(r.appName) ?? 0) + 1));
  return [...cnt.entries()].sort((a, b) => (a[0] === 'ILS' ? -1 : b[0] === 'ILS' ? 1 : b[1] - a[1])).map(([k]) => k);
}
/** 접근 명칭별 색 (appNames 순서 기준) */
export function appColorMap(appNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  appNames.forEach((n, i) => (out[n] = appColor(n, i)));
  return out;
}

/** 운량 구성 범주 (cloud 코드 앞 3자 기준, 저실링은 실링 값 기준). CAVOK는 카드와 동일하게 cloud === 'CAVOK'만 (NSC/SKC 등은 NSC 범주) */
export type CloudCat = 'CAVOK' | 'NSC' | 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'LOW' | 'VV' | 'ETC';
export const CLOUD_CATS: CloudCat[] = ['CAVOK', 'NSC', 'FEW', 'SCT', 'BKN', 'OVC', 'LOW', 'VV', 'ETC'];
export const CLOUD_CAT_LABEL: Record<CloudCat, string> = {
  CAVOK: 'CAVOK',
  NSC: 'NSC/SKC',
  FEW: 'FEW',
  SCT: 'SCT',
  BKN: 'BKN',
  OVC: 'OVC',
  LOW: `저실링 <${LOW_CEIL_FT}FT`,
  VV: 'VV(수직시정)',
  ETC: '기타',
};
export const CLOUD_CAT_COLORS: Record<CloudCat, string> = {
  CAVOK: 'rgba(107,140,174,0.35)',
  NSC: 'rgba(140,122,110,0.3)',
  FEW: '#c4b8ad',
  SCT: '#8c7a6e',
  BKN: '#6b8cae',
  OVC: '#4a6a8f',
  LOW: '#b8770a',
  VV: '#c8422e',
  ETC: '#b3a79c',
};

const isCavok = (r: AtisRecord) => r.cloud === 'CAVOK';
const isLowCeil = (r: AtisRecord) => r.ceil != null && r.ceil < LOW_CEIL_FT;

/** 레코드 → 운량 범주 */
export function cloudCat(r: AtisRecord): CloudCat {
  if (isCavok(r)) return 'CAVOK';
  const c = r.cloud.trim().toUpperCase();
  if (c.startsWith('NSC') || c.startsWith('SKC') || c.startsWith('NCD') || c.startsWith('CLR')) return 'NSC';
  if (isLowCeil(r)) return 'LOW';
  const p = c.slice(0, 3);
  if (p === 'FEW' || p === 'SCT' || p === 'BKN' || p === 'OVC') return p;
  if (c.startsWith('VV')) return 'VV';
  return 'ETC';
}

export interface CloudTip {
  /** 버킷 최저 실링 (FT) — 없으면 null */
  ceil: number | null;
  /** 최저 실링 레코드 인덱스 (실링 없으면 버킷 첫 레코드, 빈 버킷이면 null) — 점 클릭 → 원문 */
  index: number | null;
  n: number;
  cavok: number;
  low: number;
  /** raw 해상도에서만: 구름 코드·접근 명칭·시정 */
  cloud?: string;
  app?: string;
  visTxt?: string;
}

export interface CompBar {
  ts: number;
  label: string;
  title: string;
  n: number;
  /** 범주별 건수 */
  cats: Record<CloudCat, number>;
  /** 접근 명칭별 건수 (appNames 키) */
  apps: Record<string, number>;
  /** 첫 레코드 인덱스 (없으면 null) */
  index: number | null;
}

export interface LowCeilEvent {
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  n: number;
  /** 구간 최저 실링 (FT) 및 그 레코드 인덱스 */
  minCeil: number;
  minIndex: number;
  /** 최저 실링 당시 구름 코드·시정·접근 명칭 */
  cloud: string;
  visTxt: string;
  vis: number;
  app: string;
}

export interface CloudDetail {
  n: number;
  unit: Unit;
  buckets: Bucket[];
  xs: number[];
  /** 버킷별 최저 실링 (FT) — 실링 보고가 없으면 null(선 끊김) */
  ceilValues: (number | null)[];
  /** 앞뒤가 모두 결측인 고립 점만 (선으로 그려지지 않으므로 점으로 표시) */
  ceilIsolated: (number | null)[];
  tips: CloudTip[];
  /** 실링 보고 건수 (= BKN 이상) */
  ceilCount: number;
  ceilPct: number;
  cavokCount: number;
  cavokPct: number;
  minCeil: number | null;
  maxCeil: number | null;
  minCeilAt: number | null;
  minCeilIndex: number | null;
  /** 실링 있는 레코드만의 평균 (FT) */
  meanCeil: number | null;
  lowCount: number;
  lowPct: number;
  lowEvents: LowCeilEvent[];
  /** 저실링 총 지속 시간 (ms, 구간 합) */
  lowDurMs: number;
  /** 저실링 구간 밴드 (차트 x 구간) */
  lowBands: { from: number; to: number }[];
  /** 기간 내 등장한 접근 명칭 (건수 내림차순, ILS 첫 번째) */
  appNames: string[];
  appColors: Record<string, string>;
  appCount: Record<string, number>;
  appPct: Record<string, number>;
  topApp: string;
  /** CB 구름층 보고 전문 수 / VV(수직시정·차폐) 전문 수 */
  cbCount: number;
  vvCount: number;
  /** 운량 구성·접근방식 막대 (2일 이하 창은 1시간, 그 외 1일) */
  compUnit: 'hour' | 'day';
  comp: CompBar[];
  /** comp 버킷 최대 전문 건수 (막대 y 상한용) */
  compMax: number;
  /** 데이터에 나타난 운량 범주 (고정 순서) */
  catsPresent: CloudCat[];
  catCount: Record<CloudCat, number>;
  /** UTC 시간대별 CAVOK 비율 (%), 레코드 없으면 null */
  hourCavokPct: (number | null)[];
  hourTotal: number[];
  hourCavok: number[];
  hourLow: number[];
  /** 구름 코드별 건수 (내림차순, 최대 10) — index는 마지막 발생 레코드 */
  codeFreq: { code: string; cat: CloudCat; n: number; pct: number; index: number }[];
  last: { cloud: string; ceil: number | null; app: string; ts: number } | null;
}

const emptyCats = (): Record<CloudCat, number> => ({ CAVOK: 0, NSC: 0, FEW: 0, SCT: 0, BKN: 0, OVC: 0, LOW: 0, VV: 0, ETC: 0 });
const isCb = (r: AtisRecord) => r.clouds.some((c) => c.cb);
const isVv = (r: AtisRecord) => r.vv != null || r.cloud.startsWith('VV');

export function computeCloudDetail(recs: AtisRecord[], win: TimeWindow): CloudDetail {
  const n = recs.length;
  const appNames = appNamesOf(recs);
  const appColors = appColorMap(appNames);
  const emptyApps = (): Record<string, number> => Object.fromEntries(appNames.map((a) => [a, 0]));
  const unit = autoUnit(recs, win);
  const buckets = bucketize(recs, unit, win);
  const xs = buckets.map((b) => b.ts);

  // 버킷별 최저 실링 + 툴팁 정보 (O(n))
  const ceilValues: (number | null)[] = [];
  const tips: CloudTip[] = [];
  buckets.forEach((b) => {
    let mn: number | null = null;
    let mnIdx: number | null = null;
    let cavok = 0;
    let low = 0;
    b.recs.forEach((r, k) => {
      if (r.ceil != null && (mn == null || r.ceil < mn)) {
        mn = r.ceil;
        mnIdx = b.idx[k];
      }
      if (isCavok(r)) cavok++;
      if (isLowCeil(r)) low++;
    });
    ceilValues.push(mn);
    const tip: CloudTip = { ceil: mn, index: mnIdx ?? b.idx[0] ?? null, n: b.recs.length, cavok, low };
    if (unit === 'raw' && b.recs[0]) {
      tip.cloud = b.recs[0].cloud;
      tip.app = b.recs[0].appName;
      tip.visTxt = b.recs[0].visTxt;
    }
    tips.push(tip);
  });

  const ceilIsolated = ceilValues.map((v, i) => (v != null && ceilValues[i - 1] == null && ceilValues[i + 1] == null ? v : null));

  // 전체 통계 (단일 루프)
  let ceilCount = 0;
  let ceilSum = 0;
  let cavokCount = 0;
  let lowCount = 0;
  let minCeil: number | null = null;
  let maxCeil: number | null = null;
  let minCeilIndex: number | null = null;
  let cbCount = 0;
  let vvCount = 0;
  const appCount = emptyApps();
  const catCount = emptyCats();
  const codeMap = new Map<string, { n: number; index: number; cat: CloudCat }>();
  recs.forEach((r, i) => {
    if (r.ceil != null) {
      ceilCount++;
      ceilSum += r.ceil;
      if (minCeil == null || r.ceil < minCeil) {
        minCeil = r.ceil;
        minCeilIndex = i;
      }
      if (maxCeil == null || r.ceil > maxCeil) maxCeil = r.ceil;
    }
    if (isCavok(r)) cavokCount++;
    if (isLowCeil(r)) lowCount++;
    if (isCb(r)) cbCount++;
    if (isVv(r)) vvCount++;
    appCount[r.appName] = (appCount[r.appName] ?? 0) + 1;
    const cat = cloudCat(r);
    catCount[cat]++;
    const code = r.cloud.trim() || '—';
    const e = codeMap.get(code);
    if (e) {
      e.n++;
      e.index = i;
    } else codeMap.set(code, { n: 1, index: i, cat });
  });
  const pctOf = (k: number) => (n ? Math.round((k / n) * 100) : 0);
  const appPct: Record<string, number> = Object.fromEntries(appNames.map((a) => [a, pctOf(appCount[a])]));
  const topApp = appNames.reduce((a, b) => (appCount[b] > appCount[a] ? b : a), 'ILS');

  // 저실링 이벤트 구간
  const lowEvents: LowCeilEvent[] = runs(recs, isLowCeil).map((run) => {
    let best = run.start;
    for (let i = run.start; i <= run.end; i++) if ((recs[i].ceil as number) < (recs[best].ceil as number)) best = i;
    const r = recs[best];
    return {
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
      minCeil: r.ceil as number,
      minIndex: best,
      cloud: r.cloud,
      visTxt: r.visTxt,
      vis: r.vis,
      app: r.appName,
    };
  });
  const lowDurMs = lowEvents.reduce((a, e) => a + e.durMs, 0);
  // 단발(전문 1건) 구간은 폭 0이라 차트에서 사라지므로 최소 1분 폭 부여 (프리미티브가 1.5px 이상으로 그림)
  const lowBands = lowEvents.map((e) => ({ from: e.startTs, to: e.endTs > e.startTs ? e.endTs : e.startTs + MIN }));

  // 운량 구성 / 접근방식 (2일 이하 창은 시간별, 그 외 일별)
  const compUnit: 'hour' | 'day' = daysIn(win) <= 2 ? 'hour' : 'day';
  const compBuckets = compUnit === 'hour' ? bucketize(recs, 'hour', win) : dayBuckets(recs, win);
  const comp: CompBar[] = compBuckets.map((b) => {
    const cats = emptyCats();
    const apps = emptyApps();
    b.recs.forEach((r) => {
      cats[cloudCat(r)]++;
      apps[r.appName] = (apps[r.appName] ?? 0) + 1;
    });
    const label = compUnit === 'hour' ? fmtHM(b.ts) : fmtDay(b.ts);
    const title = compUnit === 'hour' ? `${fmtDay(b.ts)} ${fmtHM(b.ts)}` : fmtDay(b.ts);
    return { ts: b.ts, label, title, n: b.recs.length, cats, apps, index: b.idx[0] ?? null };
  });
  const compMax = comp.reduce((m, c) => (c.n > m ? c.n : m), 0);
  const catsPresent = CLOUD_CATS.filter((c) => catCount[c] > 0);

  // 시간대별 CAVOK 비율
  const hourTotal = hourCount(recs, () => true);
  const hourCavok = hourCount(recs, isCavok);
  const hourLow = hourCount(recs, isLowCeil);
  const hourCavokPct = hourTotal.map((t, h) => (t ? Math.round((hourCavok[h] / t) * 100) : null));

  const codeFreq = [...codeMap.entries()]
    .map(([code, v]) => ({ code, cat: v.cat, n: v.n, pct: pctOf(v.n), index: v.index }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
    .slice(0, 10);

  const lastR = recs[n - 1];

  return {
    n,
    unit,
    buckets,
    xs,
    ceilValues,
    ceilIsolated,
    tips,
    ceilCount,
    ceilPct: pctOf(ceilCount),
    cavokCount,
    cavokPct: pctOf(cavokCount),
    minCeil,
    maxCeil,
    minCeilAt: minCeilIndex != null ? recs[minCeilIndex].ts : null,
    minCeilIndex,
    meanCeil: ceilCount ? Math.round(ceilSum / ceilCount) : null,
    lowCount,
    lowPct: pctOf(lowCount),
    lowEvents,
    lowDurMs,
    lowBands,
    appNames,
    appColors,
    appCount,
    appPct,
    topApp,
    cbCount,
    vvCount,
    compUnit,
    comp,
    compMax,
    catsPresent,
    catCount,
    hourCavokPct,
    hourTotal,
    hourCavok,
    hourLow,
    codeFreq,
    last: lastR ? { cloud: lastR.cloud, ceil: lastR.ceil, app: lastR.appName, ts: lastR.ts } : null,
  };
}
