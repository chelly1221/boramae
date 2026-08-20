import { NOTICE_COLOR, NOTICE_KINDS, NOTICE_LABEL } from '../stats';
import type { AtisRecord, NoticeKind, TimeWindow } from '../types';
import { bucketize, DAY, fmtDate, fmtDay, fmtDT, fmtHM, HOUR, pct, runs, type Bucket } from './agg';

/*
 * 운영 공지 상세 파생값 — 종류별 전문 수(전문 1건에 같은 종류가 여러 문장이어도 1건), 해상도별(1시간·1일) 누적 건수,
 * UTC 시간대 분포, 흐름관리 대상별 지연(분) 통계, 종류별 요약(첫/마지막·구간 수·최장 구간), 공지 이벤트 구간
 * (같은 종류가 연속 전문에서 이어지는 범위, 수신 공백 3h 초과 시 분리), 분류되지 않은(OTHER) 문장 목록.
 * 건수 정의는 통계 카드(stats.ts computeNoticeCard)와 동일.
 */

/** 공지 구간 병합 허용 공백 (ms) */
export const NOTICE_RUN_GAP_MS = 3 * HOUR;
/** 이 기간(일) 이하이면 1시간 버킷, 초과하면 1일 버킷 */
export const NOTICE_HOUR_UNIT_MAX_DAYS = 7;
export type NoticeUnit = 'hour' | 'day';
export const NOTICE_UNIT_LABEL: Record<NoticeUnit, string> = { hour: '1시간', day: '1일' };

export const hasKind = (r: AtisRecord, k: NoticeKind) => r.notices.some((x) => x.kind === k);

export interface NoticeChipD {
  kind: NoticeKind;
  label: string;
  color: string;
  n: number;
  pct: number;
}

export interface NoticeRun {
  kind: NoticeKind;
  label: string;
  color: string;
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  n: number;
  /** 구간 첫 전문의 공지 문장 */
  text: string;
}

export interface NoticeSummary extends NoticeChipD {
  firstIdx: number;
  firstTs: number;
  lastIdx: number;
  lastTs: number;
  runCount: number;
  longest: NoticeRun | null;
  /** 대표 문장 (마지막 발생) */
  lastText: string;
}

export interface NoticeBucketItem {
  ts: number;
  label: string;
  title: string;
  /** chips 순서별 건수 */
  counts: number[];
  total: number;
  /** 공지가 있는 첫 전문 인덱스 (없으면 버킷 첫 전문, 그것도 없으면 null) */
  idx: number | null;
}

export interface FlowDest {
  dest: string;
  /** 해당 대상 흐름관리가 있는 전문 수 */
  n: number;
  meanMin: number;
  maxMin: number;
  /** 최대 지연 전문 인덱스 */
  maxIdx: number;
  lastIdx: number;
}

export interface OtherText {
  text: string;
  n: number;
  lastIdx: number;
}

export interface NoticeDetail {
  n: number;
  /** 공지가 1건 이상인 전문 수 */
  anyN: number;
  anyPct: number;
  chips: NoticeChipD[];
  top: NoticeChipD | null;
  /** 흐름관리 */
  flowN: number;
  flowMaxMin: number | null;
  flowMeanMin: number | null;
  flowDests: FlowDest[];
  wsN: number;
  /** 현재(마지막 전문) 유효 공지 종류 */
  current: NoticeKind[];
  /** 메인 차트 */
  unit: NoticeUnit;
  labelEvery: number | undefined;
  buckets: Bucket[];
  items: NoticeBucketItem[];
  maxBucketTotal: number;
  /** UTC 시간대별 — hourCounts[chipIdx][hour] */
  hourCounts: number[][];
  hourTotals: number[];
  maxHourTotal: number;
  summaries: NoticeSummary[];
  events: NoticeRun[];
  longestRun: NoticeRun | null;
  others: OtherText[];
}

export function pickNoticeUnit(win: TimeWindow): NoticeUnit {
  return (win.to - win.from) / DAY <= NOTICE_HOUR_UNIT_MAX_DAYS ? 'hour' : 'day';
}

export function computeNoticeDetail(recs: AtisRecord[], win: TimeWindow): NoticeDetail {
  const n = recs.length;

  // 종류별 전문 수
  const cnt = new Map<NoticeKind, number>();
  let anyN = 0;
  let flowN = 0;
  let flowMax: number | null = null;
  let flowSum = 0;
  let flowCnt = 0;
  let wsN = 0;
  const destMap = new Map<string, { n: number; sum: number; cnt: number; max: number; maxIdx: number; lastIdx: number }>();
  const otherMap = new Map<string, OtherText>();
  recs.forEach((r, i) => {
    if (!r.notices.length) return;
    anyN++;
    const kinds = new Set<NoticeKind>();
    const destsSeen = new Set<string>();
    r.notices.forEach((x) => {
      kinds.add(x.kind);
      if (x.kind === 'OTHER') {
        const o = otherMap.get(x.text) ?? { text: x.text, n: 0, lastIdx: i };
        o.n++;
        o.lastIdx = i;
        otherMap.set(x.text, o);
      }
      x.flow?.forEach((f) => {
        flowSum += f.min;
        flowCnt++;
        if (flowMax == null || f.min > flowMax) flowMax = f.min;
        const d = destMap.get(f.dest) ?? { n: 0, sum: 0, cnt: 0, max: -1, maxIdx: i, lastIdx: i };
        if (!destsSeen.has(f.dest)) {
          d.n++;
          destsSeen.add(f.dest);
        }
        d.sum += f.min;
        d.cnt++;
        if (f.min > d.max) {
          d.max = f.min;
          d.maxIdx = i;
        }
        d.lastIdx = i;
        destMap.set(f.dest, d);
      });
    });
    kinds.forEach((k) => cnt.set(k, (cnt.get(k) ?? 0) + 1));
    if (kinds.has('FLOW')) flowN++;
    if (kinds.has('WS')) wsN++;
  });
  const chips: NoticeChipD[] = NOTICE_KINDS.filter((k) => cnt.has(k))
    .map((k) => ({ kind: k, label: NOTICE_LABEL[k], color: NOTICE_COLOR[k], n: cnt.get(k) as number, pct: pct(cnt.get(k) as number, n) }))
    .sort((a, b) => b.n - a.n);
  const chipIdx = new Map<NoticeKind, number>();
  chips.forEach((c, i) => chipIdx.set(c.kind, i));
  const K = chips.length;

  const flowDests: FlowDest[] = [...destMap.entries()]
    .map(([dest, d]) => ({ dest, n: d.n, meanMin: d.cnt ? d.sum / d.cnt : 0, maxMin: d.max, maxIdx: d.maxIdx, lastIdx: d.lastIdx }))
    .sort((a, b) => b.n - a.n || a.dest.localeCompare(b.dest));

  const lastR = recs[n - 1];
  const current = lastR ? NOTICE_KINDS.filter((k) => hasKind(lastR, k)) : [];

  // 메인: 해상도별 종류 누적 건수
  const unit = pickNoticeUnit(win);
  const buckets = bucketize(recs, unit, win);
  const span = win.to - win.from;
  const labelOf = unit === 'day' ? fmtDay : span <= 2 * DAY ? fmtHM : (ts: number) => (ts % DAY === 0 ? fmtDay(ts) : '');
  const titleOf = unit === 'day' ? fmtDate : (ts: number) => `${fmtDT(ts)} ~ ${fmtHM(ts + HOUR)}`;
  let maxBucketTotal = 0;
  const items: NoticeBucketItem[] = buckets.map((b) => {
    const counts = new Array<number>(K).fill(0);
    let tot = 0;
    let idx: number | null = null;
    b.recs.forEach((r, j) => {
      if (!r.notices.length) return;
      if (idx == null) idx = b.idx[j];
      const kinds = new Set(r.notices.map((x) => x.kind));
      kinds.forEach((k) => {
        counts[chipIdx.get(k) as number]++;
        tot++;
      });
    });
    if (idx == null && b.idx.length) idx = b.idx[0];
    if (tot > maxBucketTotal) maxBucketTotal = tot;
    return { ts: b.ts, label: labelOf(b.ts), title: titleOf(b.ts), counts, total: tot, idx };
  });

  // 시간대별
  const hourCounts: number[][] = Array.from({ length: K }, () => new Array<number>(24).fill(0));
  recs.forEach((r) => {
    const kinds = new Set(r.notices.map((x) => x.kind));
    kinds.forEach((k) => hourCounts[chipIdx.get(k) as number][r.hour]++);
  });
  const hourTotals = new Array<number>(24).fill(0);
  hourCounts.forEach((row) => row.forEach((v, h) => (hourTotals[h] += v)));
  let maxHourTotal = 0;
  for (const v of hourTotals) if (v > maxHourTotal) maxHourTotal = v;

  // 종류별 요약 + 이벤트 구간
  const events: NoticeRun[] = [];
  let longestRun: NoticeRun | null = null;
  const summaries: NoticeSummary[] = chips.map((c) => {
    const rs = runs(recs, (r) => hasKind(r, c.kind), NOTICE_RUN_GAP_MS).map<NoticeRun>((run) => ({
      kind: c.kind,
      label: c.label,
      color: c.color,
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
      text: recs[run.start].notices.find((x) => x.kind === c.kind)?.text ?? '',
    }));
    let longest: NoticeRun | null = null;
    rs.forEach((r) => {
      events.push(r);
      if (!longest || r.durMs > longest.durMs || (r.durMs === longest.durMs && r.n > longest.n)) longest = r;
      if (!longestRun || r.durMs > longestRun.durMs || (r.durMs === longestRun.durMs && r.n > longestRun.n)) longestRun = r;
    });
    const first = rs[0];
    const last = rs[rs.length - 1];
    return {
      ...c,
      firstIdx: first ? first.start : -1,
      firstTs: first ? first.startTs : 0,
      lastIdx: last ? last.end : -1,
      lastTs: last ? last.endTs : 0,
      runCount: rs.length,
      longest,
      lastText: last ? (recs[last.end].notices.find((x) => x.kind === c.kind)?.text ?? '') : '',
    };
  });
  events.sort((a, b) => a.startTs - b.startTs || a.start - b.start);

  return {
    n,
    anyN,
    anyPct: pct(anyN, n),
    chips,
    top: chips[0] ?? null,
    flowN,
    flowMaxMin: flowMax,
    flowMeanMin: flowCnt ? flowSum / flowCnt : null,
    flowDests,
    wsN,
    current,
    unit,
    labelEvery: unit === 'hour' ? (span > 2 * DAY ? 1 : Math.max(1, Math.ceil(buckets.length / 13))) : undefined,
    buckets,
    items,
    maxBucketTotal,
    hourCounts,
    hourTotals,
    maxHourTotal,
    summaries,
    events,
    longestRun,
    others: [...otherMap.values()].sort((a, b) => b.n - a.n),
  };
}
