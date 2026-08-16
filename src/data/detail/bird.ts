import type { AtisRecord, BirdKind, BirdReport, Dir8, TimeWindow } from '../types';
import { BIRD_COLOR, birdHead } from '../stats';
import { bucketize, DAY, DIR8, fmtDate, fmtDay, fmtDT, fmtHM, HOUR, runs, type Bucket } from './agg';

/*
 * 조류 활동 상세 파생값 — 보고 전문 수·무리 수, 해상도별(1시간·1일) 보고 추이(HVY/LGT 누적), 방위·거리 분포,
 * UTC 시간대 분포(새벽·저녁 집중 패턴), 방위 × 시간대 그리드, 활동 구간(연속 보고 병합) 목록.
 * 건수 정의: "보고 전문" = birds가 1건 이상인 전문 1건, "무리" = 전문 × 보고 무리 1건. 통계 카드(stats.ts computeBirdCard)와 동일.
 */

export const BIRD_KINDS: BirdKind[] = ['HVY', 'LGT'];
export const birdColorOf = (k: BirdKind) => BIRD_COLOR[k];

/** 메인 차트 해상도 — 건수 누적 막대이므로 원본 단위는 쓰지 않는다 */
export type BirdUnit = 'hour' | 'day';
export const BIRD_UNIT_LABEL: Record<BirdUnit, string> = { hour: '1시간', day: '1일' };
/** 이 기간(일) 이하이면 1시간 버킷, 초과하면 1일 버킷 */
export const BIRD_HOUR_UNIT_MAX_DAYS = 7;
/** 활동 구간 병합: 연속 보고 전문 사이 공백이 이보다 크면 구간을 끊는다 */
export const BIRD_RUN_GAP_MS = 3 * HOUR;
/** 새벽(06–09KST = 21–24Z, 20Z 포함) / 저녁(16–20KST = 07–11Z) 시간대 */
export const DAWN_HOURS = [20, 21, 22, 23];
export const DUSK_HOURS = [7, 8, 9, 10];
/** 새벽·저녁 집중 패턴 판정 비율(%) */
export const DAWN_DUSK_PATTERN_PCT = 60;

export interface KindCount {
  hvy: number;
  lgt: number;
  total: number;
}

export interface BirdDirRow extends KindCount {
  dir: Dir8;
  /** 무리 대비 비율(%) */
  pct: number;
  /** 첫 보고 전문 인덱스 */
  idx: number | null;
}

export interface BirdDistRow extends KindCount {
  nm: number;
}

export interface BirdBucketItem extends KindCount {
  ts: number;
  label: string;
  title: string;
  /** 버킷 내 조류 보고가 있는 첫 전문 인덱스 (없으면 null) */
  idx: number | null;
}

export interface BirdRun {
  /** 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  /** 구간 내 전문 수 */
  n: number;
  /** 구간 내 최대 규모 (HVY 우선) */
  maxKind: BirdKind;
  /** 구간에서 보고된 무리(중복 제거, 등장 순) */
  heads: string[];
  /** 최근접 거리(NM) */
  minNm: number;
}

export interface BirdHourCell {
  n: number;
  idx: number | null;
}

export interface BirdDetail {
  n: number;
  /** 조류 보고가 있는 전문 수 / 비율 */
  reported: number;
  reportedPct: number;
  /** HVY 포함 전문 수 */
  hvyRecs: number;
  /** 무리 단위 건수 */
  flocks: KindCount;
  /** 방위별 (N→NW 순) */
  dirs: BirdDirRow[];
  topDir: BirdDirRow | null;
  /** 거리별 (1NM 단위, 1..maxNm) */
  dists: BirdDistRow[];
  meanNm: number | null;
  nearest: { nm: number; idx: number; ts: number; head: string } | null;
  /** 메인 차트 */
  unit: BirdUnit;
  labelEvery: number | undefined;
  buckets: Bucket[];
  items: BirdBucketItem[];
  maxBucketTotal: number;
  /** UTC 시간대별 보고 전문 수 (HVY 포함 / LGT만) */
  hourHvy: number[];
  hourLgt: number[];
  hourTotals: number[];
  maxHourTotal: number;
  topHour: { hour: number; n: number; ties: number } | null;
  /** 새벽·저녁 집중: 보고 전문 중 DAWN/DUSK 시간대 비율 */
  dawnDusk: { dawn: number; dusk: number; pct: number; pattern: boolean };
  /** 방위 × 시간대 — grid[dirIdx][hour] (무리 단위) */
  grid: BirdHourCell[][];
  maxCell: number;
  /** 활동 구간 (시작 시각 오름차순) */
  events: BirdRun[];
  longest: BirdRun | null;
  /** 활동 구간 지속 시간 합 */
  totalDurMs: number;
  last: { idx: number; ts: number; head: string; kind: BirdKind; dir: Dir8; nm: number } | null;
}

export function pickBirdUnit(win: TimeWindow): BirdUnit {
  return (win.to - win.from) / DAY <= BIRD_HOUR_UNIT_MAX_DAYS ? 'hour' : 'day';
}

/** 전문의 대표 무리 — HVY 우선, 없으면 첫 보고 */
export const mainFlock = (r: AtisRecord): BirdReport | null => (r.birds.length ? (r.birds.find((b) => b.kind === 'HVY') ?? r.birds[0]) : null);
const hasHvy = (r: AtisRecord) => r.birds.some((b) => b.kind === 'HVY');

export function computeBirdDetail(recs: AtisRecord[], win: TimeWindow): BirdDetail {
  const n = recs.length;
  const K = DIR8.length;

  // 전문·무리 집계, 방위/거리, 시간대, 그리드
  let reported = 0;
  let hvyRecs = 0;
  const flocks: KindCount = { hvy: 0, lgt: 0, total: 0 };
  const dirs: BirdDirRow[] = DIR8.map((d) => ({ dir: d as Dir8, hvy: 0, lgt: 0, total: 0, pct: 0, idx: null }));
  const distMap = new Map<number, BirdDistRow>();
  const hourHvy = new Array<number>(24).fill(0);
  const hourLgt = new Array<number>(24).fill(0);
  const grid: BirdHourCell[][] = Array.from({ length: K }, () => Array.from({ length: 24 }, () => ({ n: 0, idx: null as number | null })));
  let nmSum = 0;
  let nearest: BirdDetail['nearest'] = null;
  let last: BirdDetail['last'] = null;
  let maxCell = 0;

  recs.forEach((r, i) => {
    if (!r.birds.length) return;
    reported++;
    if (hasHvy(r)) {
      hvyRecs++;
      hourHvy[r.hour]++;
    } else hourLgt[r.hour]++;
    r.birds.forEach((b) => {
      const kindKey = b.kind === 'HVY' ? 'hvy' : 'lgt';
      flocks[kindKey]++;
      flocks.total++;
      const di = DIR8.indexOf(b.dir);
      const row = dirs[di];
      row[kindKey]++;
      row.total++;
      if (row.idx == null) row.idx = i;
      let dr = distMap.get(b.nm);
      if (!dr) {
        dr = { nm: b.nm, hvy: 0, lgt: 0, total: 0 };
        distMap.set(b.nm, dr);
      }
      dr[kindKey]++;
      dr.total++;
      nmSum += b.nm;
      if (!nearest || b.nm < nearest.nm) nearest = { nm: b.nm, idx: i, ts: r.ts, head: birdHead(b) };
      const cell = grid[di][r.hour];
      cell.n++;
      if (cell.idx == null) cell.idx = i;
      if (cell.n > maxCell) maxCell = cell.n;
    });
    const m = mainFlock(r) as BirdReport;
    last = { idx: i, ts: r.ts, head: birdHead(m), kind: m.kind, dir: m.dir, nm: m.nm };
  });
  dirs.forEach((d) => (d.pct = flocks.total ? Math.round((d.total / flocks.total) * 100) : 0));
  let topDir: BirdDirRow | null = null;
  dirs.forEach((d) => {
    if (d.total > 0 && (!topDir || d.total > topDir.total)) topDir = d;
  });
  const maxNm = Math.max(0, ...distMap.keys());
  const dists: BirdDistRow[] = [];
  for (let nm = 1; nm <= maxNm; nm++) dists.push(distMap.get(nm) ?? { nm, hvy: 0, lgt: 0, total: 0 });

  // 메인: 해상도별 보고 전문 수 (HVY 포함 / LGT만 누적)
  const unit = pickBirdUnit(win);
  const buckets = bucketize(recs, unit, win);
  const span = win.to - win.from;
  const labelOf = unit === 'day' ? fmtDay : span <= 2 * DAY ? fmtHM : (ts: number) => (ts % DAY === 0 ? fmtDay(ts) : '');
  const titleOf = unit === 'day' ? fmtDate : (ts: number) => `${fmtDT(ts)} ~ ${fmtHM(ts + HOUR)}`;
  let maxBucketTotal = 0;
  const items: BirdBucketItem[] = buckets.map((b) => {
    let hvy = 0;
    let lgt = 0;
    let idx: number | null = null;
    b.recs.forEach((r, j) => {
      if (!r.birds.length) return;
      if (idx == null) idx = b.idx[j];
      if (hasHvy(r)) hvy++;
      else lgt++;
    });
    const total = hvy + lgt;
    if (total > maxBucketTotal) maxBucketTotal = total;
    return { ts: b.ts, label: labelOf(b.ts), title: titleOf(b.ts), hvy, lgt, total, idx };
  });

  // 시간대
  const hourTotals = hourHvy.map((v, h) => v + hourLgt[h]);
  let maxHourTotal = 0;
  let topHour: BirdDetail['topHour'] = null;
  hourTotals.forEach((v, h) => {
    if (v > maxHourTotal) maxHourTotal = v;
    if (v > 0 && (!topHour || v > topHour.n)) topHour = { hour: h, n: v, ties: 0 };
  });
  if (topHour) {
    const th = topHour as { hour: number; n: number; ties: number };
    th.ties = hourTotals.filter((v) => v === th.n).length;
  }
  const dawn = DAWN_HOURS.reduce((a, h) => a + hourTotals[h], 0);
  const dusk = DUSK_HOURS.reduce((a, h) => a + hourTotals[h], 0);
  const ddPct = reported ? Math.round(((dawn + dusk) / reported) * 100) : 0;
  const dawnDusk = { dawn, dusk, pct: ddPct, pattern: reported >= 4 && ddPct >= DAWN_DUSK_PATTERN_PCT };

  // 활동 구간
  let longest: BirdRun | null = null;
  let totalDurMs = 0;
  const events: BirdRun[] = runs(recs, (r) => r.birds.length > 0, BIRD_RUN_GAP_MS).map((run) => {
    const heads: string[] = [];
    let maxKind: BirdKind = 'LGT';
    let minNm = Infinity;
    run.recs.forEach((r) =>
      r.birds.forEach((b) => {
        const h = birdHead(b);
        if (!heads.includes(h)) heads.push(h);
        if (b.kind === 'HVY') maxKind = 'HVY';
        if (b.nm < minNm) minNm = b.nm;
      }),
    );
    const ev: BirdRun = { start: run.start, end: run.end, startTs: run.startTs, endTs: run.endTs, durMs: run.durMs, n: run.end - run.start + 1, maxKind, heads, minNm };
    totalDurMs += ev.durMs;
    if (!longest || ev.durMs > longest.durMs || (ev.durMs === longest.durMs && ev.n > longest.n)) longest = ev;
    return ev;
  });

  return {
    n,
    reported,
    reportedPct: n ? Math.round((reported / n) * 100) : 0,
    hvyRecs,
    flocks,
    dirs,
    topDir,
    dists,
    meanNm: flocks.total ? nmSum / flocks.total : null,
    nearest,
    unit,
    labelEvery: unit === 'hour' ? (span > 2 * DAY ? 1 : Math.max(1, Math.ceil(buckets.length / 13))) : undefined,
    buckets,
    items,
    maxBucketTotal,
    hourHvy,
    hourLgt,
    hourTotals,
    maxHourTotal,
    topHour,
    dawnDusk,
    grid,
    maxCell,
    events,
    longest,
    totalDurMs,
    last,
  };
}
