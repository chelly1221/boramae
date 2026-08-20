import type { AtisRecord, TimeWindow } from '../types';
import { bucketize, DAY, fmtDay, fmtHM, HOUR, median, MIN, type Bucket, type Unit } from './agg';

/*
 * 정보문자 갱신 빈도 상세 파생값
 * - 정기 발행 = 발행 분이 :00(매시 정각)인 전문, 임시 갱신 = 그 외 (RKSS ATIS는 매시 정각 정기 발행, 상태 변화 시 임시 갱신)
 * - 발행 간격 = 연속 전문의 발행 시각 차 (첫 전문은 간격 없음), 정상 간격 ≈ 60분
 * - 시간대별 일평균 = 시간대 건수 / 일수 (일수 = 첫~마지막 전문 시각 차, 최소 1일 — 통계 카드와 동일)
 */

/** 공백 판정 기준 (분) — 발행 간격이 이 값 이상이면 공백 이벤트 (정기 발행 1회 이상 누락) */
export const GAP_MIN = 120;
/** 정기 발행 기대 횟수 (회/시) — 카드의 UPD_REGULAR_PER_HOUR와 동일 */
export const REGULAR_PER_HOUR = 1;
/** 임시 갱신 판정에 쓰는 바람 변화 기준 (풍향 °, 풍속 KT) */
export const WIND_DIR_STEP = 30;
export const WIND_SPD_STEP = 5;

/** 정기 발행(:00 정각) 여부 — 분 단위로 판정 (초 단위 시각이 섞여도 동작) */
export function isRegular(ts: number): boolean {
  return Math.floor(ts / MIN) % 60 === 0;
}

export interface UpdateBucketItem {
  ts: number;
  /** 축 라벨 (짧게) */
  label: string;
  /** 툴팁 제목 (구간 전체) */
  title: string;
  regular: number;
  adhoc: number;
  /** 구간 첫 레코드 인덱스 (없으면 null) */
  firstIdx: number | null;
}

export interface HourItem {
  hour: number;
  regular: number;
  adhoc: number;
  /** 일평균 (건수 / 일수) */
  regularAvg: number;
  adhocAvg: number;
}

export interface IntervalBin {
  label: string;
  /** 툴팁 제목 (구간 설명) */
  title: string;
  /** 공백 구간(≥ GAP_MIN) 여부 */
  gap: boolean;
  count: number;
}

export interface AdhocItem {
  index: number;
  ts: number;
  letter: string;
  /** 직전 전문 대비 간격(분) — 첫 전문이면 null */
  gapMin: number | null;
  /** 직전 대비 변경 내용 추정 (문자열 목록) */
  changes: string[];
}

export interface GapItem {
  /** 공백 이후 첫 전문 인덱스 (클릭 → 원문) */
  index: number;
  fromTs: number;
  toTs: number;
  durMs: number;
  fromLetter: string;
  toLetter: string;
}

export interface UpdateDetail {
  n: number;
  regularN: number;
  adhocN: number;
  adhocPct: number;
  /** 일수 (첫~마지막 전문 시각 차 / 1일, 최소 1) — 카드와 동일 */
  days: number;
  perDay: number;
  /** 발행 간격(분) 통계 — 전문 1건이면 NaN */
  meanInterval: number;
  medianInterval: number;
  maxGap: GapItem | null;
  /** 최다 발행 시간대 (UTC) — 건수 동률이면 이른 시각 */
  peakHour: number;
  peakHourAvg: number;
  peakHourCount: number;
  /** 메인 차트 (해상도별 건수) */
  unit: Unit;
  buckets: Bucket[];
  items: UpdateBucketItem[];
  /** 라벨 표시 간격 (hour 단위에서 12h/6h/2h 등) */
  labelEvery: number | undefined;
  /** 메인 차트 y 상한 (정수 눈금 + 상단 여백) */
  yMax: number;
  /** 시간대별 일평균 y 상한 (정기 기준선 포함 + 여백) */
  hourYMax: number;
  /** 간격 히스토그램 y 상한 */
  binYMax: number;
  hourly: HourItem[];
  intervalBins: IntervalBin[];
  adhocs: AdhocItem[];
  gaps: GapItem[];
}

/** 메인 차트 해상도 — 8일 이하는 시간당, 그 이상은 일별 */
export function updateUnit(win: TimeWindow): Unit {
  return win.to - win.from <= 8 * DAY ? 'hour' : 'day';
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "08-15 12Z" */
const fmtDayH = (ts: number) => `${fmtDay(ts)} ${pad2(new Date(ts).getUTCHours())}Z`;

/** 활주로 배치 라벨 — "ARR 32L·DEP 32R" */
const cfg = (r: AtisRecord) => `ARR ${r.arrRwy ?? '—'}·DEP ${r.depRwy ?? '—'}`;

/** 두 전문의 차이 요약 (임시 갱신 사유 추정) */
export function describeChange(prev: AtisRecord | undefined, cur: AtisRecord): string[] {
  if (!prev) return ['기간 첫 전문'];
  const out: string[] = [];
  if (prev.arrRwy !== cur.arrRwy || prev.depRwy !== cur.depRwy) out.push(`활주로 ${cfg(prev)} → ${cfg(cur)}`);
  if (prev.cloud !== cur.cloud) out.push(`구름 ${prev.cloud} → ${cur.cloud}`);
  if (prev.wxTxt !== cur.wxTxt) out.push(`기상 ${prev.wxTxt || '없음'} → ${cur.wxTxt || '없음'}`);
  if (prev.visTxt !== cur.visTxt) out.push(`시정 ${prev.visTxt} → ${cur.visTxt}`);
  if (prev.rwyCond.length !== cur.rwyCond.length || prev.rwyCond.some((c, i) => JSON.stringify(c) !== JSON.stringify(cur.rwyCond[i]))) {
    out.push(cur.rwyCond.length ? (prev.rwyCond.length ? '활주로 상태 보고 변경' : '활주로 상태 보고 추가') : '활주로 상태 보고 해제');
  }
  const pk = new Set(prev.notices.map((n) => n.kind));
  const ck = new Set(cur.notices.map((n) => n.kind));
  const nAdded = [...ck].filter((k) => !pk.has(k));
  const nRemoved = [...pk].filter((k) => !ck.has(k));
  if (nAdded.length || nRemoved.length) out.push(`공지 ${[...nAdded.map((k) => '+' + k), ...nRemoved.map((k) => '−' + k)].join(' ')}`);
  else if (prev.notices.length && cur.notices.length && prev.notices.map((n) => n.text).join('|') !== cur.notices.map((n) => n.text).join('|')) out.push('공지 내용 변경');
  const dd = Math.abs(((prev.dir - cur.dir + 540) % 360) - 180);
  const ds = Math.abs(prev.spd - cur.spd);
  const windChanged = prev.wind !== cur.wind;
  if (windChanged && (dd >= WIND_DIR_STEP || ds >= WIND_SPD_STEP)) out.push(`바람 ${prev.wind} → ${cur.wind}`);
  if (!out.length) {
    if (windChanged) out.push(`바람 ${prev.wind} → ${cur.wind}`);
    else if (prev.qnh !== cur.qnh) out.push(`QNH ${prev.qnh} → ${cur.qnh}`);
    else if (prev.t !== cur.t || prev.dp !== cur.dp) out.push(`온도 ${prev.t}/${prev.dp} → ${cur.t}/${cur.dp}`);
    else out.push('변경 사항 없음');
  }
  return out;
}

export function computeUpdateDetail(recs: AtisRecord[], win: TimeWindow): UpdateDetail {
  const n = recs.length;
  let regularN = 0;
  for (const r of recs) if (isRegular(r.ts)) regularN++;
  const adhocN = n - regularN;
  const adhocPct = n ? Math.round((adhocN / n) * 100) : 0;

  const spanMs = n ? recs[n - 1].ts - recs[0].ts : 0;
  const days = Math.max(1, spanMs / DAY);
  const perDay = n / days;

  // 발행 간격 (분)
  const intervals: number[] = [];
  let maxGap: GapItem | null = null;
  const gaps: GapItem[] = [];
  for (let i = 1; i < n; i++) {
    const ms = recs[i].ts - recs[i - 1].ts;
    intervals.push(ms / MIN);
    const g: GapItem = { index: i, fromTs: recs[i - 1].ts, toTs: recs[i].ts, durMs: ms, fromLetter: recs[i - 1].letter, toLetter: recs[i].letter };
    if (!maxGap || ms > maxGap.durMs) maxGap = g;
    if (ms >= GAP_MIN * MIN) gaps.push(g);
  }
  const meanInterval = intervals.length ? spanMs / MIN / intervals.length : NaN;
  const medianInterval = intervals.length ? median(intervals) : NaN;

  // 간격 히스토그램 — 정상 간격 60분, 마지막 구간은 공백 판정(≥ GAP_MIN)과 같은 경계
  const intervalBins: IntervalBin[] = [
    { label: '≤15', title: '15분 이하', gap: false, count: 0 },
    { label: '15–30', title: '15분 초과 30분 이하', gap: false, count: 0 },
    { label: '30–60', title: '30분 초과 60분 이하 (정기 간격)', gap: false, count: 0 },
    { label: `60–${GAP_MIN}`, title: `60분 초과 ${GAP_MIN}분 미만`, gap: false, count: 0 },
    { label: `≥${GAP_MIN}`, title: `${GAP_MIN}분 이상 (공백)`, gap: true, count: 0 },
  ];
  const EPS = 1e-9;
  for (const m of intervals) {
    const bi = m <= 15 + EPS ? 0 : m <= 30 + EPS ? 1 : m <= 60 + EPS ? 2 : m < GAP_MIN - EPS ? 3 : 4;
    intervalBins[bi].count++;
  }

  // 시간대별 (정기/임시)
  const hReg = Array(24).fill(0) as number[];
  const hAd = Array(24).fill(0) as number[];
  for (const r of recs) (isRegular(r.ts) ? hReg : hAd)[r.hour]++;
  const hourly: HourItem[] = hReg.map((reg, h) => ({ hour: h, regular: reg, adhoc: hAd[h], regularAvg: reg / days, adhocAvg: hAd[h] / days }));
  let peakHour = 0;
  for (let h = 1; h < 24; h++) if (hReg[h] + hAd[h] > hReg[peakHour] + hAd[peakHour]) peakHour = h;
  const peakHourCount = hReg[peakHour] + hAd[peakHour];
  const peakHourAvg = peakHourCount / days;

  // 메인 차트 버킷
  const unit = updateUnit(win);
  const buckets = bucketize(recs, unit, win);
  const span = win.to - win.from;
  const ms = unit === 'hour' ? HOUR : DAY;
  const items: UpdateBucketItem[] = buckets.map((b) => {
    let reg = 0;
    for (const r of b.recs) if (isRegular(r.ts)) reg++;
    const label = unit === 'day' ? fmtDay(b.ts) : span <= 2 * DAY ? fmtHM(b.ts) : fmtDayH(b.ts);
    const title = unit === 'day' ? `${fmtDay(b.ts)} (00Z–24Z)` : `${fmtDayH(b.ts)} – ${pad2(new Date(b.ts + ms).getUTCHours())}Z`;
    return { ts: b.ts, label, title, regular: reg, adhoc: b.recs.length - reg, firstIdx: b.idx.length ? b.idx[0] : null };
  });
  // 마지막 막대의 라벨은 SVG 우측 여백(14px) 밖으로 잘릴 수 있어, 막대가 촘촘한 다일 창(“MM-DD HHZ” 라벨)에서는 비운다
  if (unit === 'hour' && span > 2 * DAY && items.length > 48) items[items.length - 1].label = '';
  let maxTotal = 0;
  for (const it of items) maxTotal = Math.max(maxTotal, it.regular + it.adhoc);
  const yMax = (Math.max(1, maxTotal) + 1) * 1.05;
  let maxHourAvg = 0;
  for (const h of hourly) maxHourAvg = Math.max(maxHourAvg, h.regularAvg + h.adhocAvg);
  const hourYMax = Math.max(REGULAR_PER_HOUR, maxHourAvg) * 1.15;
  let maxBin = 0;
  for (const b of intervalBins) maxBin = Math.max(maxBin, b.count);
  const binYMax = (Math.max(1, maxBin) + 1) * 1.08;
  // hour 단위 라벨 간격: 6시간 이하 1h, 1일 이하 2h, 3일 이하 6h, 그 이상 12h (day 단위는 자동)
  const labelEvery = unit === 'hour' ? (span <= 6 * HOUR ? 1 : span <= DAY ? 2 : span <= 3 * DAY ? 6 : 12) : undefined;

  // 임시 갱신 목록
  const adhocs: AdhocItem[] = [];
  recs.forEach((r, i) => {
    if (isRegular(r.ts)) return;
    adhocs.push({ index: i, ts: r.ts, letter: r.letter, gapMin: i > 0 ? (r.ts - recs[i - 1].ts) / MIN : null, changes: describeChange(recs[i - 1], r) });
  });

  return {
    n,
    regularN,
    adhocN,
    adhocPct,
    days,
    perDay,
    meanInterval,
    medianInterval,
    maxGap,
    peakHour,
    peakHourAvg,
    peakHourCount,
    unit,
    buckets,
    items,
    labelEvery,
    yMax,
    hourYMax,
    binYMax,
    hourly,
    intervalBins,
    adhocs,
    gaps,
  };
}
